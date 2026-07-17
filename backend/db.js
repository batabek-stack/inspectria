const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config();

const connectionString =
  process.env.DATABASE_URL || "postgres://inspectra:inspectra@localhost:5432/inspectra";

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
});

const insecureSeedPasswords = new Set([
  "",
  "1234",
  "password",
  "admin",
  "changeme",
  "changeme123",
  "changeme123!",
]);

function requiredEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required for first-time admin account creation.`);
  }
  return value;
}

function requiredSeedPassword(name) {
  const value = requiredEnv(name);
  const normalized = value.toLowerCase();

  if (value.length < 12 || insecureSeedPasswords.has(normalized)) {
    throw new Error(`${name} must be at least 12 characters and must not be a default password.`);
  }

  return value;
}

async function query(text, params = []) {
  return pool.query(text, params);
}

async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function many(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureColumn(tableName, columnName, ddl) {
  const column = await one(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
  `,
    [tableName, columnName]
  );

  if (!column) {
    await query(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
  }
}

async function dropConstraintIfExists(tableName, constraintName) {
  const constraint = await one(
    `
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = $1
      AND constraint_name = $2
  `,
    [tableName, constraintName]
  );

  if (constraint) {
    await query(`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName}`);
  }
}

async function ensureForeignKeyCascade(tableName, constraintName, columnName, referencedTableName) {
  const constraint = await one(
    `
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = $1
      AND c.conname = $2
      AND c.contype = 'f'
  `,
    [tableName, constraintName]
  );

  const expectedDefinition =
    `FOREIGN KEY (${columnName}) REFERENCES ${referencedTableName}(id) ON DELETE CASCADE`;

  if (
    constraint &&
    String(constraint.definition || "").toUpperCase() === expectedDefinition.toUpperCase()
  ) {
    return;
  }

  if (constraint) {
    await query(`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraintName}`);
  }

  await query(`
    ALTER TABLE ${tableName}
    ADD CONSTRAINT ${constraintName}
    FOREIGN KEY (${columnName})
    REFERENCES ${referencedTableName}(id)
    ON DELETE CASCADE
  `);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      parent_organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL DEFAULT 'standard',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('platform_admin', 'admin', 'user')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      approval_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (approval_status IN ('pending', 'approved', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      imported_from_checklist_id INTEGER REFERENCES checklists(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      image_path TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS template_shares (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      shared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source_organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      recipient_email TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      imported_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      imported_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS community_templates (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      shared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source_organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (checklist_id)
    );

    CREATE TABLE IF NOT EXISTS app_messages (
      id SERIAL PRIMARY KEY,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      template_share_id INTEGER REFERENCES template_shares(id) ON DELETE CASCADE,
      message_type TEXT NOT NULL DEFAULT 'template_share',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS checklist_sections (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id SERIAL PRIMARY KEY,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      section_id INTEGER REFERENCES checklist_sections(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer_type TEXT NOT NULL DEFAULT 'FORMAT1',
      options_json TEXT,
      conditional_section_title TEXT NOT NULL DEFAULT '',
      conditional_items_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
      assigned_to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      completed_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_notifications (
      id SERIAL PRIMARY KEY,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (report_id, recipient_user_id)
    );

    CREATE TABLE IF NOT EXISTS report_items (
      id SERIAL PRIMARY KEY,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      checklist_item_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT,
      answer_type TEXT NOT NULL DEFAULT 'FORMAT1',
      comment TEXT,
      section_title TEXT
    );

    CREATE TABLE IF NOT EXISTS report_photos (
      id SERIAL PRIMARY KEY,
      report_item_id INTEGER NOT NULL REFERENCES report_items(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      data_url TEXT
    );

    CREATE TABLE IF NOT EXISTS draft_reports (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      form_json TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (assignment_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS upload_cleanup_queue (
      id SERIAL PRIMARY KEY,
      file_path TEXT NOT NULL,
      reason TEXT NOT NULL,
      delete_after TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      UNIQUE (file_path, reason)
    );

    CREATE TABLE IF NOT EXISTS walkthroughs (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS walkthrough_sections (
      id SERIAL PRIMARY KEY,
      walkthrough_id INTEGER NOT NULL REFERENCES walkthroughs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS walkthrough_items (
      id SERIAL PRIMARY KEY,
      section_id INTEGER NOT NULL REFERENCES walkthrough_sections(id) ON DELETE CASCADE,
      comment TEXT NOT NULL,
      severity TEXT,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS walkthrough_photos (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES walkthrough_items(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
      sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      report_type TEXT NOT NULL CHECK (report_type IN ('checklist', 'walkthrough')),
      report_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      cc_email TEXT,
      subject TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
      error_message TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS billing_plans (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      monthly_price_cents INTEGER NOT NULL,
      yearly_price_cents INTEGER NOT NULL,
      user_limit INTEGER NOT NULL,
      checklist_limit INTEGER NOT NULL,
      report_retention_days INTEGER NOT NULL,
      iyzico_monthly_pricing_plan_reference_code TEXT,
      iyzico_yearly_pricing_plan_reference_code TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      billing_plan_id INTEGER NOT NULL REFERENCES billing_plans(id),
      status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
      billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      payment_method TEXT NOT NULL DEFAULT 'Manual invoice',
      external_customer_id TEXT,
      external_subscription_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      renews_at TIMESTAMPTZ NOT NULL,
      canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS iyzico_checkout_sessions (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      billing_plan_id INTEGER NOT NULL REFERENCES billing_plans(id),
      billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
      token TEXT UNIQUE NOT NULL,
      conversation_id TEXT UNIQUE NOT NULL,
      pricing_plan_reference_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'initialized'
        CHECK (status IN ('initialized', 'success', 'failure')),
      result_json TEXT,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
      ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
      ON password_reset_tokens(expires_at)
      WHERE used_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_checklists_organization_id ON checklists(organization_id);
    CREATE INDEX IF NOT EXISTS idx_template_shares_checklist_id
      ON template_shares(checklist_id);
    CREATE INDEX IF NOT EXISTS idx_template_shares_expires_at
      ON template_shares(expires_at)
      WHERE imported_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_community_templates_created_at
      ON community_templates(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_community_templates_source_org
      ON community_templates(source_organization_id);
    CREATE INDEX IF NOT EXISTS idx_app_messages_recipient_user_id
      ON app_messages(recipient_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_app_messages_unread
      ON app_messages(recipient_user_id)
      WHERE read_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_assignments_organization_id ON assignments(organization_id);
    CREATE INDEX IF NOT EXISTS idx_reports_organization_id ON reports(organization_id);
    CREATE INDEX IF NOT EXISTS idx_report_notifications_recipient_unread
      ON report_notifications(recipient_user_id, created_at DESC)
      WHERE read_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_report_notifications_organization
      ON report_notifications(organization_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_drafts_organization_id ON draft_reports(organization_id);
    CREATE INDEX IF NOT EXISTS idx_upload_cleanup_queue_delete_after
      ON upload_cleanup_queue(delete_after)
      WHERE processed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_walkthroughs_organization_id
      ON walkthroughs(organization_id);
    CREATE INDEX IF NOT EXISTS idx_walkthroughs_created_by_user_id
      ON walkthroughs(created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_walkthrough_sections_walkthrough_id
      ON walkthrough_sections(walkthrough_id);
    CREATE INDEX IF NOT EXISTS idx_walkthrough_items_section_id
      ON walkthrough_items(section_id);
    CREATE INDEX IF NOT EXISTS idx_email_logs_organization_id
      ON email_logs(organization_id);
    CREATE INDEX IF NOT EXISTS idx_email_logs_report
      ON email_logs(report_type, report_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id
      ON subscriptions(organization_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_active_org
      ON subscriptions(organization_id)
      WHERE status IN ('trialing', 'active', 'past_due');
    CREATE INDEX IF NOT EXISTS idx_iyzico_checkout_sessions_token
      ON iyzico_checkout_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_iyzico_checkout_sessions_organization_id
      ON iyzico_checkout_sessions(organization_id);
  `);

  await ensureForeignKeyCascade(
    "users",
    "users_organization_id_fkey",
    "organization_id",
    "organizations"
  );

  await ensureColumn(
    "organizations",
    "parent_organization_id",
    "parent_organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE"
  );

  await query(`
    CREATE INDEX IF NOT EXISTS idx_organizations_parent_organization_id
      ON organizations(parent_organization_id);
  `);

  await ensureColumn(
    "billing_plans",
    "iyzico_monthly_pricing_plan_reference_code",
    "iyzico_monthly_pricing_plan_reference_code TEXT"
  );
  await ensureColumn(
    "billing_plans",
    "iyzico_yearly_pricing_plan_reference_code",
    "iyzico_yearly_pricing_plan_reference_code TEXT"
  );

  await query(`
    INSERT INTO billing_plans
      (code, name, description, monthly_price_cents, yearly_price_cents, user_limit, checklist_limit, report_retention_days)
    VALUES
      ('starter', 'Starter', 'Small teams starting digital inspection workflows.', 2900, 29000, 5, 25, 90),
      ('professional', 'Professional', 'Hotels and departments running daily inspection operations.', 7900, 79000, 25, -1, 365),
      ('enterprise', 'Enterprise', 'Multi-property operations with extended retention and controlled scale.', 14900, 149000, 100, -1, 1095)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      monthly_price_cents = EXCLUDED.monthly_price_cents,
      yearly_price_cents = EXCLUDED.yearly_price_cents,
      user_limit = EXCLUDED.user_limit,
      checklist_limit = EXCLUDED.checklist_limit,
      report_retention_days = EXCLUDED.report_retention_days,
      active = TRUE
  `);

  await query(
    `
    UPDATE billing_plans
    SET
      iyzico_monthly_pricing_plan_reference_code = COALESCE(NULLIF($1, ''), iyzico_monthly_pricing_plan_reference_code),
      iyzico_yearly_pricing_plan_reference_code = COALESCE(NULLIF($2, ''), iyzico_yearly_pricing_plan_reference_code)
    WHERE code = 'starter'
  `,
    [
      process.env.IYZICO_STARTER_MONTHLY_PRICING_PLAN_REFERENCE_CODE || "",
      process.env.IYZICO_STARTER_YEARLY_PRICING_PLAN_REFERENCE_CODE || "",
    ]
  );
  await query(
    `
    UPDATE billing_plans
    SET
      iyzico_monthly_pricing_plan_reference_code = COALESCE(NULLIF($1, ''), iyzico_monthly_pricing_plan_reference_code),
      iyzico_yearly_pricing_plan_reference_code = COALESCE(NULLIF($2, ''), iyzico_yearly_pricing_plan_reference_code)
    WHERE code = 'professional'
  `,
    [
      process.env.IYZICO_PROFESSIONAL_MONTHLY_PRICING_PLAN_REFERENCE_CODE || "",
      process.env.IYZICO_PROFESSIONAL_YEARLY_PRICING_PLAN_REFERENCE_CODE || "",
    ]
  );
  await query(
    `
    UPDATE billing_plans
    SET
      iyzico_monthly_pricing_plan_reference_code = COALESCE(NULLIF($1, ''), iyzico_monthly_pricing_plan_reference_code),
      iyzico_yearly_pricing_plan_reference_code = COALESCE(NULLIF($2, ''), iyzico_yearly_pricing_plan_reference_code)
    WHERE code = 'enterprise'
  `,
    [
      process.env.IYZICO_ENTERPRISE_MONTHLY_PRICING_PLAN_REFERENCE_CODE || "",
      process.env.IYZICO_ENTERPRISE_YEARLY_PRICING_PLAN_REFERENCE_CODE || "",
    ]
  );

  await dropConstraintIfExists("users", "users_username_key");
  await ensureColumn("users", "email", "email TEXT NOT NULL DEFAULT ''");

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_username_unique
      ON users (LOWER(username))
      WHERE organization_id IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_username_unique
      ON users (organization_id, LOWER(username))
      WHERE organization_id IS NOT NULL;
  `);

  await ensureColumn("checklists", "organization_id", "organization_id INTEGER");
  await ensureColumn(
    "checklists",
    "imported_from_checklist_id",
    "imported_from_checklist_id INTEGER REFERENCES checklists(id) ON DELETE SET NULL"
  );
  await query(`
    CREATE INDEX IF NOT EXISTS idx_checklists_imported_from
      ON checklists(organization_id, imported_from_checklist_id)
      WHERE imported_from_checklist_id IS NOT NULL
  `);
  await ensureColumn("checklists", "image_path", "image_path TEXT NOT NULL DEFAULT ''");
  await ensureColumn(
    "checklist_items",
    "conditional_section_title",
    "conditional_section_title TEXT NOT NULL DEFAULT ''"
  );
  await ensureColumn(
    "checklist_items",
    "conditional_items_json",
    "conditional_items_json TEXT NOT NULL DEFAULT '[]'"
  );
  await ensureColumn("assignments", "organization_id", "organization_id INTEGER");
  await ensureColumn("reports", "organization_id", "organization_id INTEGER");
  await ensureColumn("report_photos", "data_url", "data_url TEXT");
  await ensureColumn("draft_reports", "organization_id", "organization_id INTEGER");

  const defaultOrgName = process.env.DEFAULT_ORGANIZATION_NAME || "Inspectria Demo";
  const org = await one(
    `
    INSERT INTO organizations (name)
    VALUES ($1)
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `,
    [defaultOrgName]
  );

  await query("UPDATE checklists SET organization_id = $1 WHERE organization_id IS NULL", [
    org.id,
  ]);
  await query("UPDATE assignments SET organization_id = $1 WHERE organization_id IS NULL", [
    org.id,
  ]);
  await query("UPDATE reports SET organization_id = $1 WHERE organization_id IS NULL", [
    org.id,
  ]);
  await query("UPDATE draft_reports SET organization_id = $1 WHERE organization_id IS NULL", [
    org.id,
  ]);

  const userCount = Number((await one("SELECT COUNT(*)::int AS count FROM users")).count);
  if (userCount === 0) {
    const platformUsername = requiredEnv("PLATFORM_ADMIN_USERNAME");
    const platformPassword = requiredSeedPassword("PLATFORM_ADMIN_PASSWORD");
    const tenantAdminUsername = requiredEnv("DEFAULT_ADMIN_USERNAME");
    const tenantAdminPassword = requiredSeedPassword("DEFAULT_ADMIN_PASSWORD");

    const platformHash = await bcrypt.hash(platformPassword, 10);
    const adminHash = await bcrypt.hash(tenantAdminPassword, 10);

    await query(
      `
      INSERT INTO users
        (organization_id, username, password_hash, name, role, active, approval_status)
      VALUES
        (NULL, $1, $2, 'Platform Admin', 'platform_admin', TRUE, 'approved'),
        ($3, $4, $5, 'Bozkurt', 'admin', TRUE, 'approved')
    `,
      [platformUsername, platformHash, org.id, tenantAdminUsername, adminHash]
    );
  }
}

function isPlatformAdmin(user) {
  return user && user.role === "platform_admin";
}

function isOrgAdmin(user) {
  return user && (user.role === "admin" || user.role === "platform_admin");
}

async function getManagedOrganizationIds(user) {
  if (!user) return [];
  if (isPlatformAdmin(user)) {
    const rows = await many("SELECT id FROM organizations ORDER BY id");
    return rows.map((row) => Number(row.id));
  }

  if (!user.organizationId) return [];

  const rows = await many(
    `
    WITH RECURSIVE organization_scope AS (
      SELECT id
      FROM organizations
      WHERE id = $1

      UNION ALL

      SELECT child.id
      FROM organizations child
      JOIN organization_scope parent
        ON child.parent_organization_id = parent.id
    )
    SELECT id
    FROM organization_scope
    ORDER BY id
  `,
    [user.organizationId]
  );

  return rows.map((row) => Number(row.id));
}

async function userCanManageOrganization(user, organizationId) {
  if (isPlatformAdmin(user)) return true;
  const targetOrganizationId = Number(organizationId);
  if (!targetOrganizationId) return false;

  const row = await one(
    `
    WITH RECURSIVE organization_scope AS (
      SELECT id
      FROM organizations
      WHERE id = $1

      UNION ALL

      SELECT child.id
      FROM organizations child
      JOIN organization_scope parent
        ON child.parent_organization_id = parent.id
    )
    SELECT id
    FROM organization_scope
    WHERE id = $2
    LIMIT 1
  `,
    [user?.organizationId || null, targetOrganizationId]
  );

  return Boolean(row);
}

module.exports = {
  pool,
  query,
  one,
  many,
  transaction,
  initDb,
  isPlatformAdmin,
  isOrgAdmin,
  getManagedOrganizationIds,
  userCanManageOrganization,
};
