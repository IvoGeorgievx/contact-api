import { isIP } from 'node:net';

const trustedProxies = (process.env.TRUSTED_PROXIES ?? 'loopback')
  .split(',').map(value => value.trim()).filter(Boolean);
if (trustedProxies.some(value => value !== 'loopback' && isIP(value) === 0)) {
  throw new Error('TRUSTED_PROXIES must contain only loopback or explicit proxy IP addresses');
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim()),

  trustedProxies,

  sqlitePath: process.env.SQLITE_PATH || './data/app.db',

  ipHashSecret: process.env.IP_HASH_SECRET || '',

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
} as const;

const requiredVars = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'IP_HASH_SECRET',
] as const;

const missing = requiredVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(', ')}`
  );
}
