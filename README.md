# Contact API

Express API that receives contact form submissions from Cloudflare Pages,
stores in SQLite, and sends Telegram notifications.

## Architecture

```
Cloudflare Pages browser
  -> VPS Nginx (HTTPS)
  -> Docker (Express)
  -> SQLite store -> Telegram notify
```

## Requirements

- Node.js 20+
- Docker & Docker Compose
- Nginx on the VPS
- Cloudflare WAF / Rate limiting (recommended on api subdomain)
- Telegram bot token + chat ID

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (default: `http://localhost:3000`) |
| `SQLITE_PATH` | No | Path to SQLite database file |
| `IP_HASH_SECRET` | Yes | Secret for HMAC IP hashing |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Yes | Telegram chat ID |

## Deployment

### 1. Clone and configure

```bash
git clone <repo> /opt/contact-api
cd /opt/contact-api
cp .env.example .env
# edit .env with real values
mkdir -p data
sudo chown -R 1000:1000 data
```

### 2. Set up Nginx

```bash
sudo cp nginx-site.conf /etc/nginx/sites-available/api.vezora-branding.com
sudo ln -s /etc/nginx/sites-available/api.vezora-branding.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 3. Start the API

```bash
sudo docker compose up -d
```

### 4. Verify

```bash
curl https://api.vezora-branding.com/health
```

## API

### `POST /api/contact`

**Request body:**
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+123456789",
  "message": "I need help with branding"
}
```

**Success response (`202 Accepted`):**
```json
{
  "success": true,
  "message": "Message received"
}
```

**Validation error (`400`):**
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email address" }
  ]
}
```

**Rate limited (`429`):**
```json
{
  "success": false,
  "error": "Too many requests, please try again later"
}
```

### `GET /health`

```json
{
  "status": "ok",
  "timestamp": "2026-06-16T12:00:00.000Z"
}
```
