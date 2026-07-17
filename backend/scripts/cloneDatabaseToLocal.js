const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function cleanEnvUrl(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

const sourceUrl = cleanEnvUrl(
  process.env.SOURCE_DATABASE_URL ||
    process.env.RENDER_DATABASE_URL ||
    process.env.RENDER_POSTGRES_URL
);
const targetUrl = cleanEnvUrl(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL);
const backupDir = path.join(__dirname, "..", "..", "backups", "db");

function usage() {
  console.log(`
Usage:
  SOURCE_DATABASE_URL="postgres://..." npm run db:clone

Optional:
  LOCAL_DATABASE_URL="postgres://inspectra:inspectra@localhost:5432/inspectra"

The script downloads a JSON backup from SOURCE_DATABASE_URL, restores it into
the local DATABASE_URL target, resets serial sequences, and verifies row counts
plus content checksums.
`);
}

function requireUrl(name, value) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
}

function describeUrl(url) {
  return `${url.username || "(no-user)"}@${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

function assertLocalTarget(target) {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(target.hostname)) {
    throw new Error(
      `Refusing to restore into a non-local target (${describeUrl(target)}). Set LOCAL_DATABASE_URL to a localhost database.`
    );
  }
}

function shouldUseSsl(databaseUrl, envName) {
  const url = new URL(databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  return (
    process.env[envName] === "require" ||
    url.searchParams.get("sslmode") === "require" ||
    !localHosts.has(url.hostname)
  );
}

function poolFor(connectionString, envName) {
  return new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString, envName) ? { rejectUnauthorized: false } : undefined,
  });
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tableKey(table) {
  return `${table.schema}.${table.name}`;
}

async function query(client, text, params = []) {
  const result = await client.query(text, params);
  return result.rows;
}

async function publicTables(client) {
  return query(
    client,
    `
    SELECT table_schema AS schema, table_name AS name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `
  );
}

async function tableColumns(client, table) {
  const rows = await query(
    client,
    `
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position
  `,
    [table.schema, table.name]
  );

  return rows.map((row) => row.name);
}

async function tableDependencies(client, tables) {
  const keys = new Set(tables.map(tableKey));
  const rows = await query(
    client,
    `
    SELECT
      tc.table_schema AS child_schema,
      tc.table_name AS child_table,
      ccu.table_schema AS parent_schema,
      ccu.table_name AS parent_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `
  );

  const deps = new Map(tables.map((table) => [tableKey(table), new Set()]));
  for (const row of rows) {
    const child = `${row.child_schema}.${row.child_table}`;
    const parent = `${row.parent_schema}.${row.parent_table}`;
    if (keys.has(child) && keys.has(parent) && child !== parent) {
      deps.get(child).add(parent);
    }
  }

  return deps;
}

function sortTables(tables, deps) {
  const byKey = new Map(tables.map((table) => [tableKey(table), table]));
  const remaining = new Set(byKey.keys());
  const sorted = [];

  while (remaining.size) {
    const ready = [...remaining].filter((key) =>
      [...(deps.get(key) || [])].every((dep) => !remaining.has(dep))
    );

    if (!ready.length) {
      throw new Error(`Could not sort table dependencies: ${[...remaining].join(", ")}`);
    }

    ready.sort();
    for (const key of ready) {
      sorted.push(byKey.get(key));
      remaining.delete(key);
    }
  }

  return sorted;
}

async function readTable(client, table, columns) {
  const fullName = `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;
  const orderBy = columns.map(quoteIdent).join(", ");
  return query(client, `SELECT * FROM ${fullName} ORDER BY ${orderBy}`);
}

function canonicalJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Buffer.isBuffer(value)) return JSON.stringify(value.toString("base64"));
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksumRows(rows) {
  const hash = crypto.createHash("sha256");
  for (const row of rows) {
    hash.update(canonicalJson(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function createBackup(source) {
  const client = await source.connect();
  try {
    const tables = await publicTables(client);
    const deps = await tableDependencies(client, tables);
    const sortedTables = sortTables(tables, deps);
    const backup = {
      createdAt: new Date().toISOString(),
      source: "redacted",
      tables: [],
    };

    for (const table of sortedTables) {
      const columns = await tableColumns(client, table);
      const rows = await readTable(client, table, columns);
      backup.tables.push({
        schema: table.schema,
        name: table.name,
        columns,
        rows,
        count: rows.length,
        checksum: checksumRows(rows),
      });
      console.log(`Backed up ${tableKey(table)}: ${rows.length} rows`);
    }

    await fs.promises.mkdir(backupDir, { recursive: true });
    const fileName = `render-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const filePath = path.join(backupDir, fileName);
    await fs.promises.writeFile(filePath, JSON.stringify(backup, null, 2));
    return { backup, filePath };
  } finally {
    client.release();
  }
}

async function initTargetSchema() {
  process.env.DATABASE_URL = targetUrl;
  process.env.PGSSLMODE = process.env.LOCAL_PGSSLMODE || "disable";
  const db = require("../db");
  await db.initDb();
  await db.pool.end();
}

async function truncateTarget(client, tables) {
  if (!tables.length) return;
  const names = tables
    .map((table) => `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`)
    .join(", ");
  await client.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

async function insertRows(client, tableBackup) {
  if (!tableBackup.rows.length) return;

  const tableName = `${quoteIdent(tableBackup.schema)}.${quoteIdent(tableBackup.name)}`;
  const columns = tableBackup.columns.map(quoteIdent).join(", ");
  const placeholders = tableBackup.columns.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;

  for (const row of tableBackup.rows) {
    await client.query(sql, tableBackup.columns.map((column) => row[column]));
  }
}

async function resetSequences(client) {
  const rows = await query(
    client,
    `
    SELECT
      ns.nspname AS schema,
      seq.relname AS sequence_name,
      tbl.relname AS table_name,
      col.attname AS column_name
    FROM pg_class seq
    JOIN pg_namespace ns ON ns.oid = seq.relnamespace
    JOIN pg_depend dep ON dep.objid = seq.oid
    JOIN pg_class tbl ON tbl.oid = dep.refobjid
    JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
      AND ns.nspname = 'public'
  `
  );

  for (const row of rows) {
    const sequence = `${quoteIdent(row.schema)}.${quoteIdent(row.sequence_name)}`;
    const table = `${quoteIdent(row.schema)}.${quoteIdent(row.table_name)}`;
    const column = quoteIdent(row.column_name);
    await client.query(
      `SELECT setval($1, COALESCE((SELECT MAX(${column}) FROM ${table}), 0) + 1, false)`,
      [sequence]
    );
  }
}

async function restoreBackup(target, backup) {
  const client = await target.connect();
  try {
    await client.query("BEGIN");
    await truncateTarget(client, backup.tables);

    for (const tableBackup of backup.tables) {
      await insertRows(client, tableBackup);
      console.log(`Restored ${tableBackup.schema}.${tableBackup.name}: ${tableBackup.count} rows`);
    }

    await resetSequences(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verifyBackup(target, backup) {
  const client = await target.connect();
  try {
    const failures = [];

    for (const tableBackup of backup.tables) {
      const table = { schema: tableBackup.schema, name: tableBackup.name };
      const rows = await readTable(client, table, tableBackup.columns);
      const checksum = checksumRows(rows);

      if (rows.length !== tableBackup.count || checksum !== tableBackup.checksum) {
        failures.push({
          table: `${tableBackup.schema}.${tableBackup.name}`,
          expectedCount: tableBackup.count,
          actualCount: rows.length,
          expectedChecksum: tableBackup.checksum,
          actualChecksum: checksum,
        });
      }
    }

    if (failures.length) {
      console.error(JSON.stringify(failures, null, 2));
      throw new Error("Local restore verification failed.");
    }

    console.log("Verification passed: local row counts and checksums match the backup.");
  } finally {
    client.release();
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    usage();
    return;
  }

  const source = requireUrl("SOURCE_DATABASE_URL", sourceUrl);
  const target = requireUrl("LOCAL_DATABASE_URL or DATABASE_URL", targetUrl);
  assertLocalTarget(target);

  if (source.href === target.href) {
    throw new Error("Source and target DATABASE_URL values are identical.");
  }

  console.log(`Source: ${describeUrl(source)}`);
  console.log(`Target: ${describeUrl(target)}`);
  console.log("Creating local schema if needed...");
  await initTargetSchema();

  const sourcePool = poolFor(sourceUrl, "SOURCE_PGSSLMODE");
  const targetPool = poolFor(targetUrl, "LOCAL_PGSSLMODE");

  try {
    const { backup, filePath } = await createBackup(sourcePool);
    console.log(`Backup saved to ${filePath}`);
    await restoreBackup(targetPool, backup);
    await verifyBackup(targetPool, backup);
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
