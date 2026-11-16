// Date-based archival takes effect on every request, even after long downtime.
// Rows and their photos stay intact; only active lists exclude old reports.
const REPORT_RETENTION_DAYS = 90;
const cutoffSql = `NOW() - INTERVAL '${REPORT_RETENTION_DAYS} days'`;

function reportPeriodWhere(alias, archived) {
  return `${alias}.completed_at ${archived ? '<' : '>='} ${cutoffSql}`;
}

function walkthroughPeriodWhere(alias, archived) {
  const completedAt = `COALESCE(${alias}.completed_at, ${alias}.updated_at, ${alias}.created_at)`;
  return archived
    ? `(${alias}.status = 'completed' AND ${completedAt} < ${cutoffSql})`
    : `(${alias}.status <> 'completed' OR ${completedAt} >= ${cutoffSql})`;
}

function archivePagination(query, params) {
  const limit = Number(query.limit);
  const offset = Number(query.offset);
  params.push(Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20);
  const limitParameter = params.length;
  params.push(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0);
  return `LIMIT $${limitParameter} OFFSET $${params.length}`;
}

module.exports = { reportPeriodWhere, walkthroughPeriodWhere, archivePagination };
