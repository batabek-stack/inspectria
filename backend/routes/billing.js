const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const {
  initializeSubscriptionCheckout,
  retrieveSubscriptionCheckout,
} = require("../services/iyzicoService");

const router = express.Router();

function platformAdminOnly(req, res, next) {
  if (!db.isPlatformAdmin(req.user)) {
    return res.status(403).json({ message: "Platform admin access required" });
  }
  next();
}

function addTrial(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 7);
  return next.toISOString();
}

function orgAdminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Organization admin access required" });
  }
  next();
}

async function billingUsageForOrganization(organizationId) {
  if (!organizationId) return null;

  const usage = await db.one(
    `
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE organization_id = $1 AND active = TRUE) AS "userCount",
      (SELECT COUNT(*)::int FROM checklists WHERE organization_id = $1) AS "templateCount"
  `,
    [organizationId]
  );

  return usage || { userCount: 0, templateCount: 0 };
}

async function activeSubscriptionForOrganization(organizationId) {
  return db.one(
    `
    SELECT
      s.id,
      s.organization_id AS "organizationId",
      s.billing_plan_id AS "billingPlanId",
      s.status,
      s.billing_cycle AS "billingCycle",
      s.amount_cents AS "amountCents",
      s.currency,
      s.payment_method AS "paymentMethod",
      s.external_customer_id AS "externalCustomerId",
      s.external_subscription_id AS "externalSubscriptionId",
      s.started_at AS "startedAt",
      s.renews_at AS "renewsAt",
      s.canceled_at AS "canceledAt",
      s.created_at AS "createdAt",
      o.name AS "organizationName",
      p.code AS "planCode",
      p.name AS "planName",
      p.description AS "planDescription",
      p.user_limit AS "userLimit",
      p.checklist_limit AS "checklistLimit",
      p.report_retention_days AS "reportRetentionDays"
    FROM subscriptions s
    JOIN organizations o ON o.id = s.organization_id
    JOIN billing_plans p ON p.id = s.billing_plan_id
    WHERE s.organization_id = $1
      AND s.status IN ('trialing', 'active', 'past_due')
    ORDER BY s.id DESC
    LIMIT 1
  `,
    [organizationId]
  );
}

async function listSubscriptions() {
  return db.many(`
    SELECT
      s.id,
      s.organization_id AS "organizationId",
      s.billing_plan_id AS "billingPlanId",
      s.status,
      s.billing_cycle AS "billingCycle",
      s.amount_cents AS "amountCents",
      s.currency,
      s.payment_method AS "paymentMethod",
      s.external_customer_id AS "externalCustomerId",
      s.external_subscription_id AS "externalSubscriptionId",
      s.started_at AS "startedAt",
      s.renews_at AS "renewsAt",
      s.canceled_at AS "canceledAt",
      s.created_at AS "createdAt",
      o.name AS "organizationName",
      p.code AS "planCode",
      p.name AS "planName",
      p.description AS "planDescription",
      p.user_limit AS "userLimit",
      p.checklist_limit AS "checklistLimit",
      p.report_retention_days AS "reportRetentionDays"
    FROM subscriptions s
    JOIN organizations o ON o.id = s.organization_id
    JOIN billing_plans p ON p.id = s.billing_plan_id
    ORDER BY s.id DESC
  `);
}

function iyzicoReferenceForPlan(plan, billingCycle) {
  return billingCycle === "yearly"
    ? plan.iyzico_yearly_pricing_plan_reference_code
    : plan.iyzico_monthly_pricing_plan_reference_code;
}

function publicBaseUrl(req) {
  const configured = (process.env.PUBLIC_APP_URL || process.env.IYZICO_PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

async function createSubscriptionForOrganization({
  organizationId,
  planId,
  billingCycle,
  paymentMethod,
  externalCustomerId = "",
  externalSubscriptionId = "",
}) {
  const cleanOrganizationId = Number(organizationId);
  const cleanPlanId = Number(planId);

  if (!cleanOrganizationId || !cleanPlanId) {
    const error = new Error("Organization and billing plan are required");
    error.statusCode = 400;
    throw error;
  }

  if (!["monthly", "yearly"].includes(billingCycle)) {
    const error = new Error("Invalid billing cycle");
    error.statusCode = 400;
    throw error;
  }

  const organization = await db.one("SELECT id FROM organizations WHERE id = $1", [
    cleanOrganizationId,
  ]);
  if (!organization) {
    const error = new Error("Organization not found");
    error.statusCode = 404;
    throw error;
  }

  const plan = await db.one("SELECT * FROM billing_plans WHERE id = $1 AND active = TRUE", [
    cleanPlanId,
  ]);
  if (!plan) {
    const error = new Error("Billing plan not found");
    error.statusCode = 404;
    throw error;
  }

  const now = new Date();
  const amountCents =
    billingCycle === "yearly" ? plan.yearly_price_cents : plan.monthly_price_cents;
  const trialEndsAt = addTrial(now);

  const subscriptionId = await db.transaction(async (client) => {
    await client.query(
      `
      UPDATE subscriptions
      SET status = 'canceled', canceled_at = NOW()
      WHERE organization_id = $1
        AND status IN ('trialing', 'active', 'past_due')
    `,
      [cleanOrganizationId]
    );

    const result = await client.query(
      `
      INSERT INTO subscriptions
        (
          organization_id,
          billing_plan_id,
          status,
          billing_cycle,
          amount_cents,
          currency,
          payment_method,
          external_customer_id,
          external_subscription_id,
          started_at,
          renews_at
        )
      VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, $9, $10)
      RETURNING id
    `,
      [
        cleanOrganizationId,
        cleanPlanId,
        "trialing",
        billingCycle,
        amountCents,
        String(paymentMethod || "Manual invoice").trim() || "Manual invoice",
        String(externalCustomerId || "").trim() || null,
        String(externalSubscriptionId || "").trim() || null,
        now.toISOString(),
        trialEndsAt,
      ]
    );

    await client.query("UPDATE organizations SET plan = $1 WHERE id = $2", [
      plan.code,
      cleanOrganizationId,
    ]);

    return result.rows[0].id;
  });

  return {
    subscriptionId,
    subscription: await activeSubscriptionForOrganization(cleanOrganizationId),
  };
}

router.get("/plans", authRequired, async (_req, res, next) => {
  try {
    const plans = await db.many(`
      SELECT
        id,
        code,
        name,
        description,
        monthly_price_cents AS "monthlyPriceCents",
        yearly_price_cents AS "yearlyPriceCents",
        user_limit AS "userLimit",
        checklist_limit AS "checklistLimit",
        report_retention_days AS "reportRetentionDays",
        iyzico_monthly_pricing_plan_reference_code AS "iyzicoMonthlyPricingPlanReferenceCode",
        iyzico_yearly_pricing_plan_reference_code AS "iyzicoYearlyPricingPlanReferenceCode",
        active
      FROM billing_plans
      WHERE active = TRUE
      ORDER BY monthly_price_cents
    `);

    res.json(plans);
  } catch (error) {
    next(error);
  }
});

router.get("/summary", authRequired, async (req, res, next) => {
  try {
    const plans = await db.many(`
      SELECT
        id,
        code,
        name,
        description,
        monthly_price_cents AS "monthlyPriceCents",
        yearly_price_cents AS "yearlyPriceCents",
        user_limit AS "userLimit",
        checklist_limit AS "checklistLimit",
        report_retention_days AS "reportRetentionDays",
        iyzico_monthly_pricing_plan_reference_code AS "iyzicoMonthlyPricingPlanReferenceCode",
        iyzico_yearly_pricing_plan_reference_code AS "iyzicoYearlyPricingPlanReferenceCode",
        active
      FROM billing_plans
      WHERE active = TRUE
      ORDER BY monthly_price_cents
    `);

    if (db.isPlatformAdmin(req.user)) {
      return res.json({
        plans,
        subscriptions: await listSubscriptions(),
        currentSubscription: null,
        usage: null,
      });
    }

    const currentSubscription = req.user.organizationId
      ? await activeSubscriptionForOrganization(req.user.organizationId)
      : null;

    return res.json({
      plans,
      currentSubscription,
      subscriptions: [],
      usage: await billingUsageForOrganization(req.user.organizationId),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/subscriptions", authRequired, platformAdminOnly, async (req, res, next) => {
  try {
    const {
      organizationId,
      planId,
      billingCycle = "monthly",
      status = "active",
      paymentMethod = "Manual invoice",
      externalCustomerId = "",
      externalSubscriptionId = "",
    } = req.body || {};

    const result = await createSubscriptionForOrganization({
      organizationId,
      planId,
      billingCycle,
      paymentMethod,
      externalCustomerId,
      externalSubscriptionId,
    });

    res.status(201).json({
      success: true,
      subscription: result.subscription,
      subscriptionId: result.subscriptionId,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
});

router.post("/current/renew", authRequired, orgAdminOnly, async (req, res, next) => {
  try {
    if (!req.user.organizationId) {
      return res.status(400).json({ message: "Organization is required" });
    }

    const { planId, billingCycle = "monthly", paymentMethod = "Self-service renewal" } = req.body || {};
    const result = await createSubscriptionForOrganization({
      organizationId: req.user.organizationId,
      planId,
      billingCycle,
      status: "active",
      paymentMethod,
    });

    res.status(201).json({
      success: true,
      subscription: result.subscription,
      subscriptionId: result.subscriptionId,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
});

router.post("/iyzico/checkout", authRequired, orgAdminOnly, async (req, res, next) => {
  try {
    if (!req.user.organizationId) {
      return res.status(400).json({ message: "Organization is required" });
    }

    const { planId, billingCycle = "monthly" } = req.body || {};
    const cleanPlanId = Number(planId);
    if (!cleanPlanId) return res.status(400).json({ message: "Billing plan is required" });
    if (!["monthly", "yearly"].includes(billingCycle)) {
      return res.status(400).json({ message: "Invalid billing cycle" });
    }

    const plan = await db.one("SELECT * FROM billing_plans WHERE id = $1 AND active = TRUE", [
      cleanPlanId,
    ]);
    if (!plan) return res.status(404).json({ message: "Billing plan not found" });

    const pricingPlanReferenceCode = iyzicoReferenceForPlan(plan, billingCycle);
    if (!pricingPlanReferenceCode) {
      return res.status(400).json({
        message: `iyzico ${billingCycle} pricing plan reference code is missing for ${plan.name}`,
      });
    }

    const organization = await db.one("SELECT id, name FROM organizations WHERE id = $1", [
      req.user.organizationId,
    ]);
    if (!organization) return res.status(404).json({ message: "Organization not found" });

    const conversationId = `inspectria-${req.user.organizationId}-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const callbackUrl = `${publicBaseUrl(req)}/api/billing/iyzico/callback`;

    const iyzico = await initializeSubscriptionCheckout({
      callbackUrl,
      conversationId,
      pricingPlanReferenceCode,
      user: req.user,
      organizationName: organization.name,
    });

    if (!iyzico.token || !iyzico.checkoutFormContent) {
      return res.status(400).json({ message: "iyzico checkout form could not be initialized" });
    }

    await db.query(
      `
      INSERT INTO iyzico_checkout_sessions
        (
          organization_id,
          billing_plan_id,
          billing_cycle,
          token,
          conversation_id,
          pricing_plan_reference_code,
          created_by_user_id
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
      [
        req.user.organizationId,
        cleanPlanId,
        billingCycle,
        iyzico.token,
        conversationId,
        pricingPlanReferenceCode,
        req.user.id,
      ]
    );

    res.json({
      success: true,
      token: iyzico.token,
      tokenExpireTime: iyzico.tokenExpireTime,
      checkoutFormContent: iyzico.checkoutFormContent,
      conversationId,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
});

router.post("/iyzico/callback", async (req, res, next) => {
  try {
    const token = String(req.body?.token || req.query?.token || "").trim();
    if (!token) return res.status(400).send("Missing iyzico token");

    const checkoutSession = await db.one(
      "SELECT * FROM iyzico_checkout_sessions WHERE token = $1",
      [token]
    );
    if (!checkoutSession) return res.status(404).send("Checkout session not found");

    if (checkoutSession.status === "success") {
      return res.redirect("/#login");
    }

    const result = await retrieveSubscriptionCheckout(token);
    const isSuccess = result.status === "success" && result.data?.referenceCode;

    await db.query(
      `
      UPDATE iyzico_checkout_sessions
      SET status = $1, result_json = $2, completed_at = NOW()
      WHERE id = $3
    `,
      [isSuccess ? "success" : "failure", JSON.stringify(result), checkoutSession.id]
    );

    if (!isSuccess) {
      return res.status(400).send(result.errorMessage || "iyzico payment failed");
    }

    await createSubscriptionForOrganization({
      organizationId: checkoutSession.organization_id,
      planId: checkoutSession.billing_plan_id,
      billingCycle: checkoutSession.billing_cycle,
      paymentMethod: "iyzico",
      externalCustomerId: result.data.customerReferenceCode || "",
      externalSubscriptionId: result.data.referenceCode || "",
    });

    return res.redirect("/#login");
  } catch (error) {
    next(error);
  }
});

router.post("/current/cancel", authRequired, orgAdminOnly, async (req, res, next) => {
  try {
    if (!req.user.organizationId) {
      return res.status(400).json({ message: "Organization is required" });
    }

    const subscription = await activeSubscriptionForOrganization(req.user.organizationId);
    if (!subscription) {
      return res.status(404).json({ message: "Active subscription not found" });
    }

    await db.query(
      `
      UPDATE subscriptions
      SET status = 'canceled', canceled_at = NOW()
      WHERE id = $1
    `,
      [subscription.id]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/subscriptions/:id/cancel", authRequired, platformAdminOnly, async (req, res, next) => {
  try {
    const subscriptionId = Number(req.params.id);
    if (!subscriptionId) return res.status(400).json({ message: "Invalid subscription id" });

    const existing = await db.one("SELECT * FROM subscriptions WHERE id = $1", [subscriptionId]);
    if (!existing) return res.status(404).json({ message: "Subscription not found" });

    await db.query(
      `
      UPDATE subscriptions
      SET status = 'canceled', canceled_at = NOW()
      WHERE id = $1
    `,
      [subscriptionId]
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
