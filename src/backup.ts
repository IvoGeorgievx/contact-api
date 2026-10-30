import Database from 'better-sqlite3';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (!argument) {
    console.error('Usage: node dist/backup.js <new-backup-path>');
    process.exitCode = 1;
    return;
  }
  const destination = resolve(argument);
  // Do not import application config/db: backups must work before migration and without bot credentials.
  const db = new Database(process.env.SQLITE_PATH || './data/app.db', { readonly: true, fileMustExist: true });
  let reserved = false;
  try {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    closeSync(openSync(destination, 'wx', 0o600));
    reserved = true;
    await db.backup(destination);
    const snapshot = new Database(destination, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Invalid backup');
    } finally {
      snapshot.close();
    }
    console.log('Backup complete; integrity check passed');
  } catch (err) {
    if (reserved) rmSync(destination, { force: true });
    throw err;
  } finally {
    db.close();
  }
}

main().catch(() => {
  console.error('backup_failed');
  process.exitCode = 1;
});
