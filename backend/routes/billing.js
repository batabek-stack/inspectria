const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const {
  initializeSubscriptionCheckout,
  retrieveSubscriptionCheckout,
} = require("../services/iyzicoService");
const { sendBillingTrialReminderEmail } = require("../services/emailService");

const router = express.Router();

function platformAdminOnly(req, res, next) {
  if (!db.isPlatformAdmin(req.user)) {
    return res.status(403).json({ message: "Platform admin access required" });
  }
  next();
}

function orgAdminOnly(req, res, next) {
  if (!db.isOrgAdmin(req.user)) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

function addTrial(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 7);
  return next.toISOString();
}

function addBillingPeriod(date, billingCycle) {
  const next = new Date(date);
  if (billingCycle === "yearly") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

function amountFromCents(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
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
  const configured = (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.IYZICO_PUBLIC_APP_URL ||
    ""
  ).trim();
  if (configured) return configured.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function frontendBaseUrl(req) {
  const configured = (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  return publicBaseUrl(req);
}

async function createSubscriptionForOrganization({
  organizationId,
  planId,
  billingCycle,
  status = "trialing",
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

  if (!["trialing", "active", "past_due"].includes(status)) {
    const error = new Error("Invalid subscription status");
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
  const renewsAt = status === "trialing" ? addTrial(now) : addBillingPeriod(now, billingCycle);

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
        status,
        billingCycle,
        amountCents,
        String(paymentMethod || "Manual invoice").trim() || "Manual invoice",
        String(externalCustomerId || "").trim() || null,
        String(externalSubscriptionId || "").trim() || null,
        now.toISOString(),
        renewsAt,
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
      status,
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
    const basketId = `SUB-${req.user.organizationId}-${cleanPlanId}-${Date.now()}`;
    const callbackUrl = `${publicBaseUrl(req)}/api/billing/iyzico/callback`;
    const amountCents =
      billingCycle === "yearly" ? plan.yearly_price_cents : plan.monthly_price_cents;
    const currency = (process.env.IYZICO_CURRENCY || "USD").trim().toUpperCase();

    const payment = await db.one(
      `
      INSERT INTO payments
        (
          user_id,
          organization_id,
          billing_plan_id,
          conversation_id,
          basket_id,
          amount,
          currency,
          status
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
      RETURNING id
    `,
      [
        req.user.id,
        req.user.organizationId,
        cleanPlanId,
        conversationId,
        basketId,
        amountFromCents(amountCents),
        currency,
      ]
    );

    const iyzico = await initializeSubscriptionCheckout({
      callbackUrl,
      conversationId,
      pricingPlanReferenceCode,
      user: req.user,
      organizationName: organization.name,
    });

    if (iyzico.status !== "success") {
      await db.query(
        `
        UPDATE payments
        SET status = 'FAILED',
            raw_response = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
        [payment.id, JSON.stringify(iyzico)]
      );

      return res.status(400).json({
        message: iyzico.errorMessage || "iyzico checkout form could not be initialized",
        errorCode: iyzico.errorCode,
      });
    }

    if (!iyzico.token || (!iyzico.checkoutFormContent && !iyzico.paymentPageUrl)) {
      await db.query(
        `
        UPDATE payments
        SET status = 'FAILED',
            raw_response = $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
        [payment.id, JSON.stringify(iyzico)]
      );

      return res.status(400).json({ message: "iyzico checkout form could not be initialized" });
    }

    await db.transaction(async (client) => {
      await client.query(
        `
        UPDATE payments
        SET iyzico_token = $2,
            raw_response = $3::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `,
        [payment.id, iyzico.token, JSON.stringify(iyzico)]
      );

      await client.query(
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
    });

    res.json({
      success: true,
      token: iyzico.token,
      tokenExpireTime: iyzico.tokenExpireTime,
      checkoutFormContent: iyzico.checkoutFormContent,
      paymentPageUrl: iyzico.paymentPageUrl || "",
      conversationId,
      paymentId: payment.id,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
});

router.post("/iyzico/callback", async (req, res, next) => {
  try {
    const token = String(req.body?.token || req.query?.token || "").trim();
    const redirectBase = frontendBaseUrl(req);
    if (!token) return res.redirect(`${redirectBase}/payment/failed?reason=missing-token`);

    const result = await retrieveSubscriptionCheckout(token);

    const callbackResult = await db.transaction(async (client) => {
      const sessionResult = await client.query(
        "SELECT * FROM iyzico_checkout_sessions WHERE token = $1 FOR UPDATE",
        [token]
      );
      const checkoutSession = sessionResult.rows[0];
      if (!checkoutSession) {
        return { ok: false, redirect: `${redirectBase}/payment/failed?reason=unknown-payment` };
      }

      const paymentResult = await client.query(
        "SELECT * FROM payments WHERE iyzico_token = $1 FOR UPDATE",
        [token]
      );
      const payment = paymentResult.rows[0];
      if (!payment) {
        return { ok: false, redirect: `${redirectBase}/payment/failed?reason=unknown-payment` };
      }

      if (checkoutSession.status === "success" && payment.status === "PAID") {
        return { ok: true, alreadyPaid: true, paymentId: payment.id, checkoutSession };
      }

      const isSuccess = result.status === "success" && result.data?.referenceCode;
      const returnedPricingPlanReferenceCode = result.data?.pricingPlanReferenceCode || "";
      const hasPricingPlanMismatch =
        returnedPricingPlanReferenceCode &&
        returnedPricingPlanReferenceCode !== checkoutSession.pricing_plan_reference_code;
      const nextSessionStatus = isSuccess && !hasPricingPlanMismatch ? "success" : "failure";
      const nextPaymentStatus = nextSessionStatus === "success" ? "PAID" : "FAILED";

      await client.query(
        `
        UPDATE iyzico_checkout_sessions
        SET status = $1, result_json = $2, completed_at = NOW()
        WHERE id = $3
      `,
        [nextSessionStatus, JSON.stringify(result), checkoutSession.id]
      );

      await client.query(
        `
        UPDATE payments
        SET status = CASE WHEN $1 = 'FAILED' THEN 'FAILED' ELSE status END,
            iyzico_payment_id = $2,
            raw_response = $3::jsonb,
            updated_at = NOW()
        WHERE id = $4
          AND status <> 'PAID'
      `,
        [
          nextPaymentStatus,
          result.data?.referenceCode || result.paymentId || null,
          JSON.stringify(result),
          payment.id,
        ]
      );

      if (nextSessionStatus !== "success") {
        const reason = hasPricingPlanMismatch ? "plan-mismatch" : "payment-failed";
        return {
          ok: false,
          redirect: `${redirectBase}/payment/failed?payment=${payment.id}&reason=${reason}`,
        };
      }

      return { ok: true, paymentId: payment.id, checkoutSession };
    });

    if (!callbackResult.ok) return res.redirect(callbackResult.redirect);

    if (!callbackResult.alreadyPaid) {
      await createSubscriptionForOrganization({
        organizationId: callbackResult.checkoutSession.organization_id,
        planId: callbackResult.checkoutSession.billing_plan_id,
        billingCycle: callbackResult.checkoutSession.billing_cycle,
        status: "active",
        paymentMethod: "iyzico",
        externalCustomerId: result.data?.customerReferenceCode || "",
        externalSubscriptionId: result.data?.referenceCode || "",
      });

      await db.query(
        `
        UPDATE payments
        SET status = 'PAID',
            updated_at = NOW()
        WHERE id = $1
          AND status <> 'PAID'
      `,
        [callbackResult.paymentId]
      );
    }

    return res.redirect(`${redirectBase}/payment/success?payment=${callbackResult.paymentId}`);
  } catch (error) {
    console.error("iyzico callback error:", error);
    return res.redirect(`${frontendBaseUrl(req)}/payment/failed?reason=server-error`);
  }
});

router.post("/current/cancel", authRequired, platformAdminOnly, async (req, res, next) => {
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

async function runBillingTrialReminders() {
  const reminders = await db.many(`
    SELECT
      s.id AS "subscriptionId",
      s.renews_at AS "renewsAt",
      p.name AS "planName",
      o.name AS "organizationName",
      u.email,
      CEIL(EXTRACT(EPOCH FROM (s.renews_at - NOW())) / 86400)::int AS "daysBefore"
    FROM subscriptions s
    JOIN billing_plans p ON p.id = s.billing_plan_id
    JOIN organizations o ON o.id = s.organization_id
    JOIN users u ON u.organization_id = s.organization_id
    LEFT JOIN billing_trial_reminders btr
      ON btr.subscription_id = s.id
      AND btr.days_before = CEIL(EXTRACT(EPOCH FROM (s.renews_at - NOW())) / 86400)::int
    WHERE s.status = 'trialing'
      AND s.renews_at > NOW()
      AND CEIL(EXTRACT(EPOCH FROM (s.renews_at - NOW())) / 86400)::int IN (1, 2, 4)
      AND btr.id IS NULL
      AND u.role = 'admin'
      AND u.active = TRUE
      AND u.approval_status = 'approved'
      AND u.email <> ''
  `);

  for (const reminder of reminders) {
    try {
      await sendBillingTrialReminderEmail({
        to: reminder.email,
        organizationName: reminder.organizationName,
        planName: reminder.planName,
        renewsAt: reminder.renewsAt,
        daysBefore: reminder.daysBefore,
      });

      await db.query(
        `
        INSERT INTO billing_trial_reminders (subscription_id, days_before)
        VALUES ($1, $2)
        ON CONFLICT (subscription_id, days_before) DO NOTHING
      `,
        [reminder.subscriptionId, reminder.daysBefore]
      );
    } catch (error) {
      console.error("Billing trial reminder email failed", error);
    }
  }
}

module.exports = router;
module.exports.runBillingTrialReminders = runBillingTrialReminders;
