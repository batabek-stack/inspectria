const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const {
  sendPasswordResetCode,
  sendUserRegistrationRequestEmail,
  sendWelcomeEmail,
} = require("../services/emailService");

const router = express.Router();

function createExpiry(days = 7) {
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires.toISOString();
}

function addTrial(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 7);
  return next.toISOString();
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function resetCodeSecret() {
  return (
    process.env.PASSWORD_RESET_CODE_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.DATABASE_URL ||
    "inspectria-password-reset-code"
  );
}

function hashResetCode(userId, code) {
  return crypto
    .createHmac("sha256", resetCodeSecret())
    .update(`${userId}:${String(code)}`)
    .digest("hex");
}

function createResetCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function userManagementLoginUrl() {
  return (
    process.env.ADMIN_USER_MANAGEMENT_URL ||
    "https://inspectria.com/login?admin=users"
  );
}

async function findPasswordResetUser(username, email) {
  return db.one(
    `
    SELECT
      u.id,
      u.email,
      u.username
    FROM users u
    LEFT JOIN organizations o ON o.id = u.organization_id
    WHERE LOWER(u.username) = LOWER($1)
      AND LOWER(u.email) = LOWER($2)
      AND u.active = TRUE
      AND u.approval_status = 'approved'
      AND COALESCE(o.active, TRUE) = TRUE
    ORDER BY
      CASE WHEN u.role = 'platform_admin' THEN 0 ELSE 1 END,
      u.id
    LIMIT 1
  `,
    [String(username || "").trim(), String(email || "").trim().toLowerCase()]
  );
}

function publicUser(user) {
  return {
    id: user.id,
    organizationId: user.organization_id ?? user.organizationId ?? null,
    organizationName: user.organization_name ?? user.organizationName ?? null,
    email: user.email || "",
    username: user.username,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
    approvalStatus: user.approval_status ?? user.approvalStatus,
    lastLoginAt: user.last_login_at ?? user.lastLoginAt ?? null,
  };
}

async function assertTrialEmailAvailable(client, email, { excludeUserId = null } = {}) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) {
    throw Object.assign(new Error("A valid email address is required"), { statusCode: 400 });
  }

  const claimResult = await client.query(
    `
    SELECT 1
    FROM billing_trial_email_claims
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1
  `,
    [cleanEmail]
  );
  if (claimResult.rows[0]) {
    throw Object.assign(
      new Error("This email address has already used a free trial. Please sign in or contact support."),
      { statusCode: 400 }
    );
  }

  const userResult = await client.query(
    `
    SELECT 1
    FROM users
    WHERE LOWER(email) = LOWER($1)
      AND ($2::int IS NULL OR id <> $2::int)
    LIMIT 1
  `,
    [cleanEmail, excludeUserId]
  );
  if (userResult.rows[0]) {
    throw Object.assign(
      new Error("This email address has already been used. Please sign in or contact support."),
      { statusCode: 400 }
    );
  }
}

async function claimTrialEmail(client, { email, organizationId, userId }) {
  await client.query(
    `
    INSERT INTO billing_trial_email_claims (email, organization_id, user_id)
    VALUES (LOWER($1), $2, $3)
  `,
    [String(email || "").trim().toLowerCase(), organizationId, userId]
  );
}

async function activatePendingTrialAdmin(user) {
  if (
    user.approval_status !== "pending" ||
    user.active ||
    !user.organization_id
  ) {
    return false;
  }

  return db.transaction(async (client) => {
    const approvedAdminResult = await client.query(
      `
      SELECT 1
      FROM users
      WHERE organization_id = $1
        AND role = 'admin'
        AND active = TRUE
        AND approval_status = 'approved'
      LIMIT 1
    `,
      [user.organization_id]
    );

    if (approvedAdminResult.rows[0]) return false;

    const userCountResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE organization_id = $1
    `,
      [user.organization_id]
    );
    const isFirstOrganizationUser = Number(userCountResult.rows[0]?.count || 0) <= 1;
    if (user.role !== "admin" && !isFirstOrganizationUser) return false;

    await assertTrialEmailAvailable(client, user.email, { excludeUserId: user.id });

    const planCode = (process.env.DEFAULT_TRIAL_PLAN_CODE || "starter").trim().toLowerCase();
    const planResult = await client.query(
      `
      SELECT id, code, monthly_price_cents
      FROM billing_plans
      WHERE LOWER(code) = $1
        AND active = TRUE
      LIMIT 1
    `,
      [planCode]
    );
    const trialPlan = planResult.rows[0];
    if (!trialPlan) {
      throw Object.assign(new Error(`Default trial plan not found: ${planCode}`), {
        statusCode: 500,
      });
    }

    const activeSubscriptionResult = await client.query(
      `
      SELECT 1
      FROM subscriptions
      WHERE organization_id = $1
        AND status IN ('trialing', 'active', 'past_due')
      LIMIT 1
    `,
      [user.organization_id]
    );

    if (!activeSubscriptionResult.rows[0]) {
      await client.query(
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
            started_at,
            renews_at
          )
        VALUES ($1, $2, 'trialing', 'monthly', $3, 'USD', 'Free trial', NOW(), $4)
      `,
        [user.organization_id, trialPlan.id, trialPlan.monthly_price_cents, addTrial(new Date())]
      );
    }

    await client.query("UPDATE organizations SET plan = $1 WHERE id = $2", [
      trialPlan.code,
      user.organization_id,
    ]);

    await client.query(
      `
      UPDATE users
      SET active = TRUE,
          approval_status = 'approved',
          role = 'admin'
      WHERE id = $1
    `,
      [user.id]
    );

    await claimTrialEmail(client, {
      email: user.email,
      organizationId: user.organization_id,
      userId: user.id,
    });

    return true;
  });
}

router.post("/login", async (req, res, next) => {
  try {
    const { username, password, organizationName } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const cleanOrganizationName = String(organizationName || "").trim();

    const user = await db.one(
      `
      SELECT
        u.id,
        u.organization_id,
        o.name AS organization_name,
        u.email,
        u.username,
        u.password_hash,
        u.name,
        u.role,
        u.active,
        u.approval_status,
        u.last_login_at,
        COALESCE(o.active, TRUE) AS organization_active
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE LOWER(u.username) = LOWER($1)
        AND (
          u.role = 'platform_admin'
          OR
          ($2 = '' AND u.organization_id IS NULL)
          OR LOWER(o.name) = LOWER($2)
        )
      ORDER BY
        CASE WHEN u.role = 'platform_admin' THEN 0 ELSE 1 END,
        u.id
      LIMIT 1
    `,
      [String(username).trim(), cleanOrganizationName]
    );

    if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.active) {
      const activatedTrialAdmin = await activatePendingTrialAdmin(user);
      if (activatedTrialAdmin) {
        user.active = true;
        user.approval_status = "approved";
        user.role = "admin";
      }
    }

    if (!user.active) {
      return res.status(403).json({
        message:
          user.approval_status === "pending"
            ? "Your account is waiting for admin approval"
            : "User is inactive",
      });
    }

    if (!user.organization_active) {
      return res.status(403).json({ message: "Organization is inactive" });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const createdAt = new Date().toISOString();
    const expiresAt = createExpiry(7);

    await db.transaction(async (client) => {
      const activeDraft = await client.query(
        `
        SELECT 1
        FROM draft_reports d
        JOIN assignments a ON a.id = d.assignment_id
        WHERE d.user_id = $1
          AND a.status = 'assigned'
        LIMIT 1
      `,
        [user.id]
      );

      if (!activeDraft.rows[0]) {
        await client.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
      }

      await client.query(
        `
        INSERT INTO sessions (user_id, token, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
      `,
        [user.id, token, createdAt, expiresAt]
      );

      await client.query("UPDATE users SET last_login_at = $1 WHERE id = $2", [
        createdAt,
        user.id,
      ]);
    });

    user.last_login_at = createdAt;

    res.json({
      token,
      expiresAt,
      user: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/register", async (req, res, next) => {
  try {
    const { username, password, name, email, organizationName, createOrganization } = req.body || {};

    if (!username || !password || !name || !email || !organizationName) {
      return res.status(400).json({
        message: "email, username, password, name and organizationName are required",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim();
    const cleanName = String(name).trim();
    const cleanOrganizationName = String(organizationName).trim();
    const shouldCreateOrganization = createOrganization === true;

    if (!cleanEmail || !cleanUsername || !cleanName || !cleanOrganizationName) {
      return res.status(400).json({
        message: "email, username, name and organizationName are required",
      });
    }

    if (!cleanEmail.includes("@")) {
      return res.status(400).json({ message: "A valid email address is required" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const registration = await db.transaction(async (client) => {
      let organizationId;
      let organizationNameForEmail = cleanOrganizationName;
      let role = "user";
      let approvalTarget = "organization";
      let trialPlanName = "";

      const existingOrganization = await client.query(
        `
        SELECT id, active
        FROM organizations
        WHERE LOWER(name) = LOWER($1)
        LIMIT 1
      `,
        [cleanOrganizationName]
      );

      if (existingOrganization.rows[0]) {
        if (shouldCreateOrganization) {
          throw Object.assign(
            new Error("Organization already exists. Use Create User Request to join it."),
            { statusCode: 400 }
          );
        }

        if (!existingOrganization.rows[0].active) {
          throw Object.assign(new Error("Organization is inactive"), {
            statusCode: 400,
          });
        }

        organizationId = existingOrganization.rows[0].id;
      } else {
        if (!shouldCreateOrganization) {
          throw Object.assign(
            new Error("Organization not found. Use Create New Organization to request a new organization."),
            { statusCode: 400 }
          );
        }

        await assertTrialEmailAvailable(client, cleanEmail);

        const orgResult = await client.query(
          `
          INSERT INTO organizations (name, active)
          VALUES ($1, TRUE)
          RETURNING id
        `,
          [cleanOrganizationName]
        );

        organizationId = orgResult.rows[0].id;
        role = "admin";
        approvalTarget = "trial";

        const planCode = (process.env.DEFAULT_TRIAL_PLAN_CODE || "starter").trim().toLowerCase();
        const planResult = await client.query(
          `
          SELECT id, code, name, monthly_price_cents
          FROM billing_plans
          WHERE LOWER(code) = $1
            AND active = TRUE
          LIMIT 1
        `,
          [planCode]
        );
        const trialPlan = planResult.rows[0];
        if (!trialPlan) {
          throw Object.assign(new Error(`Default trial plan not found: ${planCode}`), {
            statusCode: 500,
          });
        }

        trialPlanName = trialPlan.name;
        await client.query(
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
              started_at,
              renews_at
            )
          VALUES ($1, $2, 'trialing', 'monthly', $3, 'USD', 'Free trial', NOW(), $4)
        `,
          [organizationId, trialPlan.id, trialPlan.monthly_price_cents, addTrial(new Date())]
        );

        await client.query("UPDATE organizations SET plan = $1 WHERE id = $2", [
          trialPlan.code,
          organizationId,
        ]);
      }

      const existingUser = await client.query(
        `
        SELECT id, username, email
        FROM users
        WHERE organization_id = $1
          AND (
            LOWER(username) = LOWER($2)
            OR LOWER(email) = LOWER($3)
          )
      `,
        [organizationId, cleanUsername, cleanEmail]
      );

      if (existingUser.rows[0]) {
        const duplicateField =
          String(existingUser.rows[0].email || "").toLowerCase() === cleanEmail
            ? "Email"
            : "Username";
        throw Object.assign(
          new Error(`${duplicateField} already exists in this organization`),
          { statusCode: 400 }
        );
      }

      const userInsertResult = await client.query(
        `
        INSERT INTO users
          (organization_id, email, username, password_hash, name, role, active, approval_status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING id
      `,
        [
          organizationId,
          cleanEmail,
          cleanUsername,
          passwordHash,
          cleanName,
          role,
          approvalTarget === "trial",
          approvalTarget === "trial" ? "approved" : "pending",
        ]
      );

      if (approvalTarget === "trial") {
        await claimTrialEmail(client, {
          email: cleanEmail,
          organizationId,
          userId: userInsertResult.rows[0].id,
        });
      }

      return {
        approvalTarget,
        organizationId,
        organizationName: organizationNameForEmail,
        role,
        trialPlanName,
      };
    });

    if (registration.approvalTarget === "organization") {
      const admins = await db.many(
        `
        SELECT email
        FROM users
        WHERE organization_id = $1
          AND role = 'admin'
          AND active = TRUE
          AND approval_status = 'approved'
          AND email <> ''
      `,
        [registration.organizationId]
      );

      const recipients = admins.map((admin) => admin.email).filter(Boolean);
      if (recipients.length > 0) {
        sendUserRegistrationRequestEmail({
          to: recipients,
          organizationName: registration.organizationName,
          requesterName: cleanName,
          requesterUsername: cleanUsername,
          requesterEmail: cleanEmail,
          loginUrl: userManagementLoginUrl(),
        }).catch((emailError) => {
          console.error("User registration notification email failed.", emailError);
        });
      }
    }

    if (registration.approvalTarget === "trial") {
      sendWelcomeEmail({
        to: cleanEmail,
        role: registration.role,
        isEnterprise: false,
      }).catch((emailError) => {
        console.error("Trial welcome email failed.", emailError);
      });
    }

    res.json({
      success: true,
      message:
        registration.approvalTarget === "trial"
          ? `Your 7-day ${registration.trialPlanName || "trial"} has started. You can log in now and activate billing before the trial ends.`
          : "Registration submitted. Please wait for your organization admin to approve it.",
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    next(error);
  }
});

router.get("/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

router.post("/logout", authRequired, async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    await db.query("DELETE FROM sessions WHERE token = $1", [token]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/password-reset/request-code", async (req, res, next) => {
  try {
    const { username, email } = req.body || {};
    const cleanUsername = String(username || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanUsername || !cleanEmail) {
      return res.status(400).json({ message: "Username and email are required" });
    }

    if (!cleanEmail.includes("@")) {
      return res.status(400).json({ message: "A valid email address is required" });
    }

    const genericResponse = {
      success: true,
      message: "If the account exists, a 6-digit reset code has been sent to the registered email address.",
    };

    const user = await findPasswordResetUser(cleanUsername, cleanEmail);
    if (!user) {
      return res.json(genericResponse);
    }

    const code = createResetCode();
    const codeHash = hashResetCode(user.id, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.transaction(async (client) => {
      await client.query(
        `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL
      `,
        [user.id]
      );

      await client.query(
        `
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
      `,
        [user.id, codeHash, expiresAt]
      );
    });

    try {
      await sendPasswordResetCode({
        to: user.email,
        username: user.username,
        code,
      });
    } catch (emailError) {
      await db.query(
        `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE token_hash = $1
      `,
        [codeHash]
      );

      return res.status(503).json({
        message:
          emailError instanceof Error
            ? emailError.message
            : "Password reset email could not be sent.",
      });
    }

    res.json(genericResponse);
  } catch (error) {
    next(error);
  }
});

router.post("/password-reset/verify-code", async (req, res, next) => {
  try {
    const { username, email, code } = req.body || {};
    const cleanUsername = String(username || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanCode = String(code || "").trim();

    if (!cleanUsername || !cleanEmail || !cleanCode) {
      return res.status(400).json({ message: "Username, email and reset code are required" });
    }

    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ message: "Reset code must be 6 digits" });
    }

    const user = await findPasswordResetUser(cleanUsername, cleanEmail);
    if (!user) {
      return res.status(400).json({ message: "Reset code is invalid or expired" });
    }

    const codeToken = await db.one(
      `
      SELECT id, user_id
      FROM password_reset_tokens
      WHERE user_id = $1
        AND token_hash = $2
        AND used_at IS NULL
        AND expires_at > NOW()
    `,
      [user.id, hashResetCode(user.id, cleanCode)]
    );

    if (!codeToken) {
      return res.status(400).json({ message: "Reset code is invalid or expired" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await db.transaction(async (client) => {
      await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [
        codeToken.id,
      ]);

      await client.query(
        `
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
      `,
        [user.id, hashResetToken(resetToken), expiresAt]
      );
    });

    res.json({
      success: true,
      token: resetToken,
      expiresAt,
      message: "Reset code verified.",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/password-reset/complete", async (req, res, next) => {
  try {
    const { token, password } = req.body || {};

    if (!token || !password) {
      return res.status(400).json({ message: "Reset token and new password are required" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const resetToken = await db.one(
      `
      SELECT id, user_id
      FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > NOW()
    `,
      [hashResetToken(token)]
    );

    if (!resetToken) {
      return res.status(400).json({ message: "Reset link is invalid or expired" });
    }

    await db.transaction(async (client) => {
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        await bcrypt.hash(String(password), 10),
        resetToken.user_id,
      ]);

      await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [
        resetToken.id,
      ]);

      await client.query("DELETE FROM sessions WHERE user_id = $1", [resetToken.user_id]);
    });

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
