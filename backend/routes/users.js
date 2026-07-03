const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const { sendWelcomeEmail } = require("../services/emailService");

const router = express.Router();

function normalizeRole(role) {
  return role === "admin" || role === "user" ? role : null;
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function resetUrl(req, token) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return `${origin}/#reset-password?token=${encodeURIComponent(token)}`;
}

function createTemporaryPassword() {
  return `${crypto.randomBytes(12).toString("base64url")}A1!`;
}

async function getOrganizationPlanCode(organizationId) {
  if (!organizationId) return "";

  const organization = await db.one(
    `
    SELECT
      o.plan,
      p.code AS subscription_plan_code
    FROM organizations o
    LEFT JOIN subscriptions s
      ON s.organization_id = o.id
      AND s.status IN ('trialing', 'active', 'past_due')
    LEFT JOIN billing_plans p ON p.id = s.billing_plan_id
    WHERE o.id = $1
    ORDER BY s.id DESC NULLS LAST
    LIMIT 1
  `,
    [organizationId]
  );

  return String(organization?.subscription_plan_code || organization?.plan || "").toLowerCase();
}

router.get("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const scopeIds = await db.getManagedOrganizationIds(req.user);
    if (scopeIds.length === 0) return res.json([]);

    const users = await db.many(
      `
      SELECT
        u.id,
        u.organization_id AS "organizationId",
        o.name AS "organizationName",
        u.email,
        u.username,
        u.name,
        u.role,
        u.active,
        u.approval_status AS "approvalStatus",
        u.created_at
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE u.organization_id = ANY($1::int[])
        AND u.role != 'platform_admin'
      ORDER BY
        CASE u.approval_status WHEN 'pending' THEN 0 ELSE 1 END,
        u.id
    `,
      [scopeIds]
    );

    res.json(users);
  } catch (error) {
    next(error);
  }
});

router.post("/", authRequired, adminOnly, async (req, res, next) => {
  try {
    const { username, password, name, email, role, organizationId } = req.body || {};
    const nextRole = normalizeRole(role);
    const targetOrganizationId = db.isPlatformAdmin(req.user)
      ? Number(organizationId || req.user.organizationId)
      : Number(organizationId || req.user.organizationId);

    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!username || !password || !name || !cleanEmail || !nextRole || !targetOrganizationId) {
      return res.status(400).json({
        message: "email, username, password, name, role and organization are required",
      });
    }

    if (!cleanEmail.includes("@")) {
      return res.status(400).json({ message: "A valid email address is required" });
    }

    const org = await db.one("SELECT id FROM organizations WHERE id = $1", [
      targetOrganizationId,
    ]);
    if (!org) return res.status(400).json({ message: "Organization not found" });

    if (!(await db.userCanManageOrganization(req.user, targetOrganizationId))) {
      return res.status(403).json({ message: "Organization is outside your access scope" });
    }

    const existingUser = await db.one(
      `
      SELECT id
      FROM users
      WHERE organization_id = $1
        AND LOWER(username) = LOWER($2)
    `,
      [targetOrganizationId, String(username).trim()]
    );

    if (existingUser) {
      return res.status(400).json({
        message: "Username already exists in this organization",
      });
    }

    const result = await db.one(
      `
        INSERT INTO users
        (organization_id, email, username, password_hash, name, role, active, approval_status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'approved', NOW())
      RETURNING
        id,
        organization_id AS "organizationId",
        email,
        role
    `,
      [
        targetOrganizationId,
        cleanEmail,
        String(username).trim(),
        await bcrypt.hash(String(password), 10),
        String(name).trim(),
        nextRole,
      ]
    );

    let welcomeEmailSent = false;
    let welcomeEmailError = "";

    try {
      const planCode = await getOrganizationPlanCode(result.organizationId);
      await sendWelcomeEmail({
        to: result.email,
        role: result.role,
        isEnterprise: planCode === "enterprise",
      });
      welcomeEmailSent = true;
    } catch (error) {
      welcomeEmailError =
        error instanceof Error ? error.message : "Welcome email could not be sent";
      console.error("Welcome email failed for newly created user", {
        userId: result.id,
        email: result.email,
        error: welcomeEmailError,
      });
    }

    res.json({
      success: true,
      userId: result.id,
      welcomeEmailSent,
      welcomeEmailError: welcomeEmailError || undefined,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    const { username, password, name, email, role, active, approvalStatus } = req.body || {};

    if (!userId) {
      return res.status(400).json({
        message: "Invalid user id",
      });
    }

    const existingUser = await db.one(
      `
      SELECT id, organization_id, email, username, name, role, active, approval_status
      FROM users u
      WHERE u.id = $1
    `,
      [userId]
    );

    if (!existingUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!(await db.userCanManageOrganization(req.user, existingUser.organization_id))) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (existingUser.role === "platform_admin" && !db.isPlatformAdmin(req.user)) {
      return res.status(403).json({ message: "Platform admin cannot be changed here" });
    }

    const nextUsername =
      typeof username === "string" ? username.trim() : existingUser.username;
    const nextEmail =
      typeof email === "string" ? email.trim().toLowerCase() : existingUser.email;
    const nextName = typeof name === "string" ? name.trim() : existingUser.name;
    const nextRole =
      existingUser.role === "platform_admin"
        ? "platform_admin"
        : role
          ? normalizeRole(role)
          : existingUser.role;
    const nextActive =
      typeof active === "boolean" ? active : Boolean(existingUser.active);
    const nextApprovalStatus = approvalStatus || existingUser.approval_status;

    const updatesProfile = [
      "email",
      "username",
      "name",
      "role",
      "active",
      "approvalStatus",
    ].some((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field));

    if ((updatesProfile && !nextEmail) || !nextUsername || !nextName) {
      return res.status(400).json({
        message: "email, username and name are required",
      });
    }

    if (updatesProfile && !nextEmail.includes("@")) {
      return res.status(400).json({ message: "A valid email address is required" });
    }

    if (!nextRole) {
      return res.status(400).json({
        message: "role must be admin or user",
      });
    }

    if (!["pending", "approved", "rejected"].includes(nextApprovalStatus)) {
      return res.status(400).json({
        message: "approvalStatus must be pending, approved or rejected",
      });
    }

    const duplicateUser = await db.one(
      `
      SELECT id
      FROM users
      WHERE id != $1
        AND LOWER(username) = LOWER($2)
        AND (
          (organization_id IS NULL AND $3::int IS NULL)
          OR organization_id = $3::int
        )
    `,
      [userId, nextUsername, existingUser.organization_id]
    );

    if (duplicateUser) {
      return res.status(400).json({
        message: "Username already exists in this organization",
      });
    }

    const passwordHash =
      typeof password === "string" && password.trim()
        ? await bcrypt.hash(password, 10)
        : null;

    const shouldSendWelcomeEmail =
      existingUser.approval_status !== "approved" &&
      nextApprovalStatus === "approved" &&
      nextActive &&
      Boolean(nextEmail);

    const updatedUser = await db.one(
      `
      UPDATE users
      SET
        username = $1,
        email = $2,
        password_hash = COALESCE($3, password_hash),
        name = $4,
        role = $5,
        active = $6,
        approval_status = $7
      WHERE id = $8
      RETURNING
        id,
        organization_id AS "organizationId",
        email,
        username,
        name,
        role,
        active,
        approval_status AS "approvalStatus",
        created_at
    `,
      [
        nextUsername,
        nextEmail,
        passwordHash,
        nextName,
        nextRole,
        nextActive,
        nextApprovalStatus,
        userId,
      ]
    );

    let welcomeEmailSent = false;
    let welcomeEmailError = "";

    if (shouldSendWelcomeEmail) {
      try {
      const planCode = await getOrganizationPlanCode(updatedUser.organizationId);
        await sendWelcomeEmail({
          to: updatedUser.email,
          role: updatedUser.role,
          isEnterprise: planCode === "enterprise",
        });
        welcomeEmailSent = true;
      } catch (error) {
        welcomeEmailError = error instanceof Error ? error.message : "Welcome email could not be sent";
        console.error("Welcome email failed", {
          userId: updatedUser.id,
          email: updatedUser.email,
          error: welcomeEmailError,
        });
      }
    }

    res.json({
      success: true,
      user: updatedUser,
      welcomeEmailSent,
      welcomeEmailError: welcomeEmailError || undefined,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/password-reset-link", authRequired, adminOnly, async (req, res, next) => {
  try {
    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const targetUser = await db.one(
      `
      SELECT u.id, u.organization_id, u.role
      FROM users u
      WHERE u.id = $1
    `,
      [userId]
    );

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!(await db.userCanManageOrganization(req.user, targetUser.organization_id))) {
      return res.status(404).json({ message: "User not found" });
    }

    if (targetUser.role === "platform_admin" && !db.isPlatformAdmin(req.user)) {
      return res.status(403).json({ message: "Platform admin cannot be reset here" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await db.transaction(async (client) => {
      await client.query(
        `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL
      `,
        [userId]
      );

      await client.query(
        `
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
      `,
        [userId, tokenHash, expiresAt]
      );
    });

    res.json({
      success: true,
      resetUrl: resetUrl(req, token),
      expiresAt,
      delivery: "manual",
      emailReminder:
        "Email is not enabled yet. When email delivery is added, send this reset URL through the mail provider instead of showing it to admins.",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/temporary-password", authRequired, adminOnly, async (req, res, next) => {
  try {
    if (!db.isPlatformAdmin(req.user)) {
      return res.status(403).json({ message: "Platform admin access required" });
    }

    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (Number(req.user.id) === userId) {
      return res.status(400).json({ message: "You cannot reset your own password here" });
    }

    const targetUser = await db.one(
      `
      SELECT u.id, u.organization_id, u.username, u.role
      FROM users u
      WHERE u.id = $1
    `,
      [userId]
    );

    if (!targetUser || targetUser.role === "platform_admin") {
      return res.status(404).json({ message: "User not found" });
    }

    if (!(await db.userCanManageOrganization(req.user, targetUser.organization_id))) {
      return res.status(404).json({ message: "User not found" });
    }

    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await db.transaction(async (client) => {
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        passwordHash,
        userId,
      ]);
      await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await client.query(
        `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = $1
          AND used_at IS NULL
      `,
        [userId]
      );
    });

    res.json({
      success: true,
      username: targetUser.username,
      temporaryPassword,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authRequired, adminOnly, async (req, res, next) => {
  try {
    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({
        message: "Invalid user id",
      });
    }

    if (req.user && Number(req.user.id) === userId) {
      return res.status(400).json({
        message: "You cannot delete your own account",
      });
    }

    const user = await db.one(
      `
      SELECT u.id, u.organization_id, u.role
      FROM users u
      WHERE u.id = $1
    `,
      [userId]
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!(await db.userCanManageOrganization(req.user, user.organization_id))) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (user.role === "platform_admin") {
      return res.status(400).json({ message: "Platform admin cannot be deleted" });
    }

    await db.query("DELETE FROM users WHERE id = $1", [userId]);

    res.json({
      success: true,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
