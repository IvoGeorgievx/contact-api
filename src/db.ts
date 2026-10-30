import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(config.sqlitePath), { recursive: true });

    const connection = new Database(config.sqlitePath);
    try {
      connection.pragma('journal_mode = WAL');
      connection.pragma('foreign_keys = ON');

      connection.transaction(() => {
        connection.exec(`
          CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            message TEXT NOT NULL,
            ip_hash TEXT,
            user_agent TEXT,
            turnstile_success INTEGER NOT NULL DEFAULT 0,
            telegram_status TEXT NOT NULL DEFAULT 'pending',
            telegram_error TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            source TEXT NOT NULL DEFAULT 'legacy'
          )
        `);
        const columns = connection.pragma('table_info(submissions)') as { name: string }[];
        if (!columns.some(column => column.name === 'source')) {
          connection.exec("ALTER TABLE submissions ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'");
        }
      }).immediate();
      db = connection;
    } catch (err) {
      connection.close();
      throw err;
    }
  }
  return db;
}

export interface Submission {
  source: 'main-website' | 'studio';
  name: string;
  email: string;
  phone: string;
  message: string;
  ip_hash: string | null;
  user_agent: string | null;
  turnstile_success: boolean;
  telegram_status: string;
  telegram_error: string | null;
}

export function insertSubmission(data: Submission): number {
  const stmt = getDb().prepare(`
    INSERT INTO submissions (name, email, phone, message, source, ip_hash, user_agent, turnstile_success, telegram_status, telegram_error)
    VALUES (@name, @email, @phone, @message, @source, @ip_hash, @user_agent, @turnstile_success, @telegram_status, @telegram_error)
  `);
  const result = stmt.run({
    name: data.name,
    email: data.email,
    phone: data.phone,
    message: data.message,
    source: data.source,
    ip_hash: data.ip_hash,
    user_agent: data.user_agent,
    turnstile_success: data.turnstile_success ? 1 : 0,
    telegram_status: data.telegram_status,
    telegram_error: data.telegram_error,
  });
  return Number(result.lastInsertRowid);
}

export function updateTelegramStatus(
  id: number,
  status: string,
  error: string | null = null,
): void {
  getDb()
    .prepare(
      'UPDATE submissions SET telegram_status = ?, telegram_error = ? WHERE id = ?',
    )
    .run(status, error, id);
}
