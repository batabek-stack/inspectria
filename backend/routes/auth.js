const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const { sendPasswordResetCode } = require("../services/emailService");

const router = express.Router();

function createExpiry(days = 7) {
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires.toISOString();
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
        u.email,
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
    const { username, password, name, email, organizationName } = req.body || {};

    if (!username || !password || !name || !email || !organizationName) {
      return res.status(400).json({
        message: "email, username, password, name and organizationName are required",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim();
    const cleanName = String(name).trim();
    const cleanOrganizationName = String(organizationName).trim();

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
      let role = "user";
      let approvalTarget = "organization";

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
        if (!existingOrganization.rows[0].active) {
          throw Object.assign(new Error("Organization is inactive"), {
            statusCode: 400,
          });
        }

        organizationId = existingOrganization.rows[0].id;
      } else {
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
        approvalTarget = "platform";
      }

      const existingUser = await client.query(
        `
        SELECT id
        FROM users
        WHERE organization_id = $1
          AND LOWER(username) = LOWER($2)
      `,
        [organizationId, cleanUsername]
      );

      if (existingUser.rows[0]) {
        throw Object.assign(new Error("Username already exists in this organization"), {
          statusCode: 400,
        });
      }

      await client.query(
        `
        INSERT INTO users
          (organization_id, email, username, password_hash, name, role, active, approval_status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE, 'pending', NOW())
      `,
        [organizationId, cleanEmail, cleanUsername, passwordHash, cleanName, role]
      );

      return { approvalTarget };
    });

    res.json({
      success: true,
      message:
        registration.approvalTarget === "platform"
          ? "Registration submitted. Please wait for platform approval."
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
