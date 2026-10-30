const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { setup, validContact } = require('./helpers.cjs');
setup();
const Database = require('better-sqlite3');
const original = new Database(process.env.SQLITE_PATH);
original.exec(`CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL,
  phone TEXT NOT NULL, message TEXT NOT NULL, ip_hash TEXT, user_agent TEXT,
  turnstile_success INTEGER NOT NULL DEFAULT 0, telegram_status TEXT NOT NULL DEFAULT 'pending',
  telegram_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
original.prepare('INSERT INTO submissions (name,email,phone,message) VALUES (?,?,?,?)')
  .run('Existing Person', 'existing@example.com', '123', 'Keep this record');
const oldRow = original.prepare('SELECT * FROM submissions').get();
original.close();
const { getDb, insertSubmission } = require('../dist/db.js');
const { contactSchema } = require('../dist/validation.js');
after(() => getDb().close());

test('migration preserves old records and idempotent startup adds historical source', () => {
  const db = getDb();
  const migrated = db.prepare('SELECT * FROM submissions WHERE id = 1').get();
  assert.equal(migrated.source, 'legacy');
  const { source, ...unchanged } = migrated;
  assert.deepEqual(unchanged, oldRow);
  assert.equal(getDb(), db);
  // Re-open through a fresh application module, exercising startup migration twice.
  delete require.cache[require.resolve('../dist/db.js')];
  const restarted = require('../dist/db.js').getDb();
  assert.equal(restarted.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
  restarted.close();
});

test('source is validated and old clients default to main-website', () => {
  assert.equal(contactSchema.parse(validContact).source, 'main-website');
  assert.equal(contactSchema.parse({ ...validContact, source: 'studio' }).source, 'studio');
  assert.equal(contactSchema.safeParse({ ...validContact, source: '<invalid>' }).success, false);
  assert.equal(contactSchema.safeParse({ ...validContact, source: null }).success, false);
  for (const email of ["o'connor@example.com", 'first_last+tag@example.com']) {
    assert.equal(contactSchema.safeParse({ ...validContact, email }).success, true);
  }
});

test('source is stored through bound parameters and old application inserts still work', () => {
  const id = insertSubmission({ ...validContact, source: 'studio', ip_hash: null, user_agent: null,
    turnstile_success: false, telegram_status: 'sending', telegram_error: null });
  assert.equal(getDb().prepare('SELECT source FROM submissions WHERE id = ?').get(id).source, 'studio');
  const oldInsert = getDb().prepare('INSERT INTO submissions (name,email,phone,message) VALUES (?,?,?,?)');
  const row = oldInsert.run('Old App', 'old@example.com', '0', 'Rollback compatibility');
  assert.equal(getDb().prepare('SELECT source FROM submissions WHERE id = ?').get(row.lastInsertRowid).source, 'legacy');
});
