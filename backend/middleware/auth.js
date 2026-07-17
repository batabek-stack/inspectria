const db = require("../db");

function getToken(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

async function authRequired(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const session = await db.one(
      `
      SELECT
        s.*,
        u.id AS user_id,
        u.organization_id,
        u.email,
        u.username,
        u.name,
        u.role,
        u.active,
        u.approval_status,
        u.last_login_at,
        o.name AS organization_name,
        COALESCE(o.active, TRUE) AS organization_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN organizations o ON o.id = u.organization_id
      WHERE s.token = $1
    `,
      [token]
    );

    if (!session) return res.status(401).json({ message: "Invalid session" });
    if (!session.active) return res.status(403).json({ message: "User is inactive" });
    if (!session.organization_active) {
      return res.status(403).json({ message: "Organization is inactive" });
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      await db.query("DELETE FROM sessions WHERE token = $1", [token]);
      return res.status(401).json({ message: "Session expired" });
    }

    req.user = {
      id: session.user_id,
      organizationId: session.organization_id,
      organizationName: session.organization_name,
      email: session.email || "",
      username: session.username,
      name: session.name,
      role: session.role,
      active: Boolean(session.active),
      approvalStatus: session.approval_status,
      lastLoginAt: session.last_login_at,
    };
    next();
  } catch (error) {
    next(error);
  }
}

function adminOnly(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "platform_admin")) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

module.exports = { authRequired, adminOnly };
