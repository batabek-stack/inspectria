// Integration check using temporary tables; existing reports are never changed.
const assert = require('node:assert/strict');
const db = require('../db');
const { archivePagination } = require('../reportRetention');
const reports = require('../routes/reports');
const walkthroughs = require('../routes/walkthroughs');

async function request(router, path, user, query = {}) {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods.get);
  const handler = route.route.stack.at(-1).handle;
  return new Promise((resolve, reject) => handler({ user, query }, { json: resolve }, reject));
}

async function main() {
  const client = await db.pool.connect();
  const original = { many: db.many, one: db.one };
  try {
    await client.query('BEGIN');
    for (const table of ['organizations', 'users', 'assignments', 'checklists',
      'checklist_items', 'checklist_sections', 'reports', 'report_items',
      'report_photos', 'report_notifications', 'walkthroughs', 'walkthrough_sections']) {
      await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    db.many = async (sql, params) => (await client.query(sql, params)).rows;
    db.one = async (sql, params) => (await client.query(sql, params)).rows[0] || null;
    await client.query(`
      INSERT INTO organizations (id, name) VALUES (1, 'One'), (2, 'Two');
      INSERT INTO users (id, name) VALUES (1, 'User One'), (2, 'User Two');
      INSERT INTO checklists (id, title) VALUES (1, 'Checklist');
      INSERT INTO assignments (id, organization_id, checklist_id, assigned_to_user_id, assigned_by_user_id)
        VALUES (1, 1, 1, 1, 1), (2, 2, 1, 2, 2), (3, 1, 1, 2, 1);
      INSERT INTO reports (id, organization_id, assignment_id, completed_by_user_id, completed_at, status)
        VALUES (1, 1, 1, 1, NOW() - INTERVAL '89 days', 'Completed'),
               (2, 1, 1, 1, NOW() - INTERVAL '90 days', 'Completed'),
               (3, 1, 1, 1, NOW() - INTERVAL '91 days', 'Completed'),
               (4, 2, 2, 2, NOW() - INTERVAL '91 days', 'Completed'),
               (5, 1, 3, 2, NOW() - INTERVAL '91 days', 'Completed');
      INSERT INTO report_items (id, report_id, question) VALUES (1, 3, 'Archived question');
      INSERT INTO report_photos (id, report_item_id, file_path) VALUES (1, 1, '/uploads/archive.jpg');
      INSERT INTO report_notifications (id, report_id, recipient_user_id) VALUES (1, 1, 1), (2, 3, 1);
      INSERT INTO walkthroughs (id, organization_id, created_by_user_id, title, status, completed_at, updated_at)
        VALUES (1, 1, 1, 'Recent', 'completed', NOW() - INTERVAL '89 days', NOW()),
               (2, 1, 1, 'Boundary', 'completed', NOW() - INTERVAL '90 days', NOW()),
               (3, 1, 1, 'Old', 'completed', NOW() - INTERVAL '91 days', NOW()),
               (4, 1, 1, 'Draft', 'draft', NULL, NOW() - INTERVAL '200 days'),
               (5, 2, 2, 'Other org', 'completed', NOW() - INTERVAL '91 days', NOW()),
               (6, 1, 2, 'Other user', 'completed', NOW() - INTERVAL '91 days', NOW()),
               (7, 1, 1, 'Legacy', 'completed', NULL, NOW() - INTERVAL '91 days');
    `);
    const admin = { role: 'admin', id: 1, organizationId: 1 };
    const user = { role: 'user', id: 1, organizationId: 1 };
    const platform = { role: 'platform_admin', id: 1 };
    const ids = rows => rows.map(row => row.id).sort((a, b) => a - b);
    assert.deepEqual(ids(await request(reports, '/', admin)), [1, 2]);
    assert.deepEqual(ids(await request(reports, '/', admin, { archived: 'true' })), [3, 5]);
    const archived = await request(reports, '/', user, { archived: 'true' });
    assert.deepEqual(ids(archived), [3]);
    assert.equal(archived[0].items[0].question, 'Archived question');
    assert.deepEqual(archived[0].items[0].photos, ['/uploads/archive.jpg']);
    assert.deepEqual(ids(await request(reports, '/', platform, { archived: 'true' })), [3, 4, 5]);
    assert.deepEqual(ids(await request(reports, '/', admin, { archived: 'true', limit: '1', offset: '1' })), [3]);
    assert.equal((await request(reports, '/unread-count', admin)).count, 1);
    assert.deepEqual(ids(await request(walkthroughs, '/', admin)), [1, 2, 4]);
    assert.deepEqual(ids(await request(walkthroughs, '/', admin, { archived: 'true' })), [3, 6, 7]);
    assert.deepEqual(ids(await request(walkthroughs, '/', user, { archived: 'true' })), [3, 7]);
    assert.deepEqual(ids(await request(walkthroughs, '/', platform, { archived: 'true' })), [3, 5, 6, 7]);
    assert.equal((await request(walkthroughs, '/', admin, { archived: 'true', limit: '1', offset: '1' })).length, 1);
    for (const [query, expected] of [
      [{}, [20, 0]], [{ limit: '9999', offset: '-1' }, [50, 0]],
      [{ limit: 'bad', offset: 'bad' }, [20, 0]], [{ limit: '0', offset: '1.5' }, [20, 0]],
    ]) {
      const params = [1];
      assert.equal(archivePagination(query, params), 'LIMIT $2 OFFSET $3');
      assert.deepEqual(params, [1, ...expected]);
    }
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM reports')).rows[0].count, 5);
    console.log('PASS: 90-day boundary, archive paging, tenant/user access, photos, unread counts, drafts, legacy dates, and data preservation.');
  } finally {
    Object.assign(db, original);
    await client.query('ROLLBACK');
    client.release();
    await db.pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
