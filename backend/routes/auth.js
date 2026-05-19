const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

function createExpiry(days = 7) {
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires.toISOString();
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    organizationId: user.organization_id ?? user.organizationId ?? null,
    organizationName: user.organization_name ?? user.organizationName ?? null,
    username: user.username,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
    approvalStatus: user.approval_status ?? user.approvalStatus,
  };
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
        u.username,
        u.password_hash,
        u.name,
        u.role,
        u.active,
        u.approval_status,
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

    await db.query(
      `
      INSERT INTO sessions (user_id, token, created_at, expires_at)
      VALUES ($1, $2, $3, $4)
    `,
      [user.id, token, createdAt, expiresAt]
    );

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
    const { username, password, name, organizationName } = req.body || {};

    if (!username || !password || !name || !organizationName) {
      return res.status(400).json({
        message: "username, password, name and organizationName are required",
      });
    }

    const cleanUsername = String(username).trim();
    const cleanName = String(name).trim();
    const cleanOrganizationName = String(organizationName).trim();

    if (!cleanUsername || !cleanName || !cleanOrganizationName) {
      return res.status(400).json({
        message: "username, name and organizationName are required",
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    await db.transaction(async (client) => {
      const orgResult = await client.query(
        `
        INSERT INTO organizations (name, active)
        VALUES ($1, TRUE)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `,
        [cleanOrganizationName]
      );

      const existingUser = await client.query(
        `
        SELECT id
        FROM users
        WHERE organization_id = $1
          AND LOWER(username) = LOWER($2)
      `,
        [orgResult.rows[0].id, cleanUsername]
      );

      if (existingUser.rows[0]) {
        throw Object.assign(new Error("Username already exists in this organization"), {
          statusCode: 400,
        });
      }

      await client.query(
        `
        INSERT INTO users
          (organization_id, username, password_hash, name, role, active, approval_status, created_at)
        VALUES ($1, $2, $3, $4, 'admin', FALSE, 'pending', NOW())
      `,
        [orgResult.rows[0].id, cleanUsername, passwordHash, cleanName]
      );
    });

    res.json({
      success: true,
      message: "Registration submitted. Please wait for platform approval.",
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
