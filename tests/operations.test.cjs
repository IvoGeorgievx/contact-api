const assert = require('node:assert/strict');
const { test } = require('node:test');
const { join, resolve } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { setup } = require('./helpers.cjs');
const directory = setup();

function backup(source, destination) {
  return spawnSync(process.execPath, [resolve('dist/backup.js'), destination], {
    env: { ...process.env, SQLITE_PATH: source }, encoding: 'utf8', timeout: 10000,
  });
}

test('backup captures committed WAL records without running application migrations', () => {
  const source = join(directory, 'wal-source.db');
  const destination = join(directory, 'backups', 'snapshot.db');
  const db = new Database(source);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('wal_autocheckpoint = 0');
    db.exec("CREATE TABLE submissions (id INTEGER PRIMARY KEY, message TEXT); INSERT INTO submissions VALUES (1, 'PRIVATE_BACKUP_ROW');");
    const result = backup(source, destination);
    assert.equal(result.status, 0, result.stderr);
    const snapshot = new Database(destination, { readonly: true });
    try {
      assert.equal(snapshot.pragma('quick_check', { simple: true }), 'ok');
      assert.equal(snapshot.prepare('SELECT message FROM submissions').get().message, 'PRIVATE_BACKUP_ROW');
      assert.ok(!snapshot.pragma('table_info(submissions)').some(column => column.name === 'source'));
    } finally { snapshot.close(); }
    assert.ok(!db.pragma('table_info(submissions)').some(column => column.name === 'source'));
    assert.ok(!(result.stdout + result.stderr).includes('PRIVATE_BACKUP_ROW'));
  } finally { db.close(); }
});

test('backup refuses to overwrite a file and a failed source does not create a database', () => {
  const source = join(directory, 'existing.db');
  const db = new Database(source);
  db.exec('CREATE TABLE example (id INTEGER)'); db.close();
  const destination = join(directory, 'existing-backup.db');
  writeFileSync(destination, 'KEEP_EXISTING_BACKUP');
  const overwrite = backup(source, destination);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /backup_failed/);
  assert.equal(readFileSync(destination, 'utf8'), 'KEEP_EXISTING_BACKUP');
  const missing = join(directory, 'missing-source.db');
  const absent = backup(missing, join(directory, 'must-not-exist.db'));
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /backup_failed/);
  assert.throws(() => readFileSync(missing), { code: 'ENOENT' });
});

test('startup refuses an incompatible schema before listening and emits no database details', () => {
  const path = join(directory, 'invalid-schema.db');
  const db = new Database(path);
  db.exec('CREATE VIEW submissions AS SELECT 1 AS id'); db.close();
  const result = spawnSync(process.execPath, [resolve('dist/index.js')], {
    env: { ...process.env, SQLITE_PATH: path }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes('Server listening'));
  assert.match(result.stderr, /database_start_failed/);
  assert.ok(!result.stderr.includes(path));
});

test('proxy configuration rejects blanket trust, hop counts and subnet expressions', () => {
  for (const value of ['true', '1', 'uniquelocal', '0.0.0.0/0', '::ffff:10.0.0.0/8']) {
    const result = spawnSync(process.execPath, ['-e', "require('./dist/config.js')"], {
      env: { ...process.env, TRUSTED_PROXIES: value }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, value);
  }
});
