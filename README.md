# Contact API

Public contact-form intake: browser -> host Nginx (HTTPS) -> Docker -> SQLite -> Telegram.
One API endpoint serves multiple websites. Production domains belong in the server's configuration, not this repository's examples.

## Requirements

- Node.js 24 LTS for local development, or Docker with Compose v2.
- Host Nginx with a valid TLS certificate for the API hostname.
- A Telegram bot token, target chat ID and a randomly generated IP-hashing key.

## Configuration

For a **new installation**, copy `.env.example` to `.env` and edit it. **For an upgrade, keep the existing `.env`; do not replace it with the example.**

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Use `production` on the server. |
| `PORT` | Container listener, normally `3000`; keep it aligned with the published port. |
| `ALLOWED_ORIGINS` | Exact comma-separated HTTPS frontend origins, without paths or trailing slashes. Include every real website origin, including any `www` variant in use. |
| `TRUSTED_PROXIES` | Comma-separated **explicit proxy peer IPs**, optionally `loopback`. Default is `loopback`; an empty value trusts no proxies. Subnets, hop counts and blanket trust are rejected. See the ingress check below. |
| `SQLITE_PATH` | Keep the existing path on upgrade; default container example is `/app/data/app.db`. For local development use `./data/app.db`. |
| `IP_HASH_SECRET` | Keep your existing key; for a new installation generate one with `openssl rand -hex 32`. Never use the example placeholder. |
| `TELEGRAM_BOT_TOKEN` | Actual bot token; never put it in frontend code or Git. |
| `TELEGRAM_CHAT_ID` | Chat receiving all notifications; source is included in the notification. |

The public `.env.example` intentionally contains only `https://example.com`. Set all actual frontend origins privately in production. Environment changes require container recreation, not just a Git pull or process restart.

`.env*` files (except `.env.example`), database files, `data/` and `backups/` are ignored by Git. Keep backup access restricted and copy verified backups off the VPS.

## API and frontend integration

### `POST /api/contact`

Send `Content-Type: application/json` from an allowed browser origin:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+123456789",
  "message": "I need help with branding",
  "source": "main-website"
}
```

- `source`: optional; `main-website` or `studio`. Omitted values default to `main-website` so the existing frontend keeps working. Other values, including null and empty strings, return 400.
- Existing rows acquire `source = legacy`; their original fields and IDs are retained. The startup migration is transactional and safe to run again.
- Field limits remain name 100, email 255, phone 50 and message 5000 UTF-16 units. All four fields are required.
- Source is caller-supplied attribution, **not proof of identity**. Origin checks are browser protections, not authentication or proof of a human.

Frontend hidden fields:

```html
<!-- Main form -->
<input type="hidden" name="source" value="main-website">

<!-- Studio form -->
<input type="hidden" name="source" value="studio">
```

If your frontend builds JSON manually, explicitly include the hidden value:

```js
const formData = new FormData(form);
const payload = {
  name: formData.get('name'),
  email: formData.get('email'),
  phone: formData.get('phone'),
  message: formData.get('message'),
  source: formData.get('source'),
};
// Send JSON.stringify(payload) to your configured API URL with application/json.
```

Deploy the backend first, then update the forms. The old backend ignores unknown fields, but does not store their source. The new studio form must send `studio` to distinguish it from the backwards-compatible default.

Successful durable receipt remains **202**, with the unchanged response:

```json
{"success":true,"message":"Message received"}
```

This acknowledges SQLite storage, not guaranteed Telegram delivery. Long notifications are split safely with source, submission ID and part numbers, under one six-second deadline. A row is `sent` only if every part succeeds; ordinary delivery failures are `failed` with a sanitized category and delivered-part count. There are no automatic retries: manual recovery must account for already delivered parts. If status bookkeeping fails, the durable row can remain `sending`; its ID is logged and the API still returns 202 to avoid inviting duplicate intake.

Errors preserve the `{success:false,error:...}` shape: 400 invalid fields/JSON, 403 missing or rejected Origin, 413 oversized JSON, 415 unsupported body encoding/charset, 429 quota exhausted, and generic 500 if storage fails before receipt. Validation failures also include field-level `details`. Error logs do not include request bodies, provider response bodies or credentials. Requests receive an `X-Request-ID` for diagnostics.

### `GET /health`

Returns `{"status":"ok","timestamp":"..."}` after successful database initialization. This is a process-startup/liveness check, not a Telegram delivery or ongoing database-health guarantee.

## Tests and image build

```sh
npm ci
npm test
npm run typecheck
```

Tests use disposable **real SQLite databases**, local HTTP and a stubbed Telegram transport; no real bot calls are made. They cover migration/old inserts, source attribution, failure containment, parser privacy, proxy quotas, notification boundaries and WAL-aware backup.

The Docker build runs the same suite on Node 24/Linux with the actual native SQLite addon. The final image runs as `node` and contains production dependencies and compiled code, not tests or source.

```sh
docker build --target test -t contact-api:test .
docker build -t contact-api:upgrade .
```

Both stages use the same pinned Node image digest. Periodically review/update that digest and the lockfile to receive runtime security updates. Rebuild and retest; do not copy host `node_modules` into Linux containers.

## New server installation

1. Clone into a persistent directory such as `/opt/contact-api` and configure the private `.env`.
2. Create `data/` and give container UID/GID 1000 write access: `mkdir -p data && sudo chown 1000:1000 data`.
3. Adapt `nginx-site.conf`: replace `api.example.com` and certificate paths with the real API hostname. Install it into Nginx and run `sudo nginx -t` before reloading.
4. Build with `docker compose build api`, then verify proxy identity as described below and set `TRUSTED_PROXIES` accordingly.
5. Start with `docker compose up -d --no-build --wait --wait-timeout 60 api`, then verify health through Nginx.

The template assumes **host Nginx is the public ingress**, with no Cloudflare proxy/CDN before it. Nginx overwrites `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto` with authoritative values. If another proxy is added, first configure trusted real-client-IP handling at Nginx; never blindly trust caller-supplied forwarding headers.

## Verify the host-to-container peer

Host loopback publishing does not mean the application sees a loopback peer. Trusting only `loopback` can make unrelated visitors share one quota.

After building the service image, run this short-lived, host-loopback-only diagnostic on the **same Compose network**, without sending traffic to the real API or consuming its quota. Choose a free host port if 3001 is occupied. The name must not already belong to another container.

```sh
docker compose run -d --no-deps --name contact-api-peer-check \
  -p 127.0.0.1:3001:3001 api \
  node -e 'require("node:http").createServer((req,res)=>res.end(req.socket.remoteAddress)).listen(3001,"0.0.0.0")'
curl --fail --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:3001
docker rm -f contact-api-peer-check
```

Add the **observed peer IP** to `TRUSTED_PROXIES` in `.env`, alongside `loopback`. IPv4-mapped IPv6 addresses are accepted as explicit IPs; CIDR prefixes are not. Do not copy a gateway from another server or trust all private networks. Recheck if Docker networking changes. The diagnostic observes the published-port hop; the installed Nginx must also overwrite forwarding headers as in the template.

## One-release manual upgrade

This procedure allows a short maintenance window. Run from the existing checkout using the same Compose project/directory. **Do not run `docker compose down`, delete data, or replace the real Nginx configuration with the generic template.** If you have Compose overrides or an external log collector, preserve them and review the new bounded `json-file` logging configuration before deployment.

### 1. Keep rollback artifacts, then build while the old API runs

In a persistent shell:

```sh
set -e
CONTAINER=$(docker compose ps -q api)
test -n "$CONTAINER"
OLD_IMAGE=$(docker inspect --format '{{.Image}}' "$CONTAINER")
docker image tag "$OLD_IMAGE" contact-api:rollback
cp .env .env.pre-upgrade
chmod 600 .env .env.pre-upgrade

# Pull/check out the reviewed release using your normal Git workflow.
docker compose build api
```

Keep the rollback image until the upgrade is verified; do not prune it. Preserve a copy of the installed Nginx configuration too. Record the old release revision if you need to recover previous Compose overrides.

Privately edit `.env`: retain every existing allowed frontend origin, append the new frontend origin, retain the database path and secrets, and configure the verified `TRUSTED_PROXIES`. Do not copy the public example over it. Apply only the reviewed forwarding-header changes to the installed Nginx file, preserving real server names/certificates, and check it with `sudo nginx -t`. Delay the reload until the new API is ready.

### 2. Stop, back up and start the combined upgrade

```sh
docker compose stop api
BACKUP_FILE="/app/data/backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).db"
docker compose run --rm --no-deps api node dist/backup.js "$BACKUP_FILE"
# Continue only after "Backup complete; integrity check passed".
docker compose up -d --no-build --wait --wait-timeout 60 api
sudo nginx -t
sudo systemctl reload nginx
```

The one-off backup uses the newly built tooling, opens the **old database without application initialization**, includes committed WAL state, checks the snapshot and refuses to overwrite an existing destination. No migration runs until the new API starts. The example backup path assumes the existing `/app/data` bind mount; if your data path differs, choose a backed-up destination inside a persistent mount.

Do not copy just a live `.db` file while WAL writes are active. Store a verified copy off-host as well. Restrict the `backups/` directory to the operator/container UID; backup files are created with mode 0600.

### 3. Verify, then update the frontends

- Check `docker compose ps`, health through your real HTTPS API URL, and sanitized logs.
- Check that the source column exists and pre-existing rows/IDs remain; a backup provides the reference.
- Submit one owner-controlled old-format form and one studio form. Confirm 202 receipt, source attribution and Telegram output; avoid exhausting live quotas.
- Then deploy the hidden fields/JSON source values on the frontend websites.
- If a healthy container still cannot notify Telegram, inspect the saved row's sanitized status/error and bot/chat configuration. Health alone does not certify delivery.

### Rollback without losing new submissions

Retain the expanded database **and the current `.env`, including every newly allowed frontend origin**. The old application explicitly names its insert columns, so additional `source` defaults to `legacy` on rollback. It ignores the new source field and proxy configuration variable, but still checks `ALLOWED_ORIGINS`: restoring the pre-upgrade origin list would reject the new frontend with 403. Source attribution is degraded while the old application is running, but existing records are retained.

Create an ignored local override named `compose.rollback.local.yml`:

```yaml
services:
  api:
    image: contact-api:rollback
```

Then, if rollback is necessary:

```sh
docker compose -f docker-compose.yml -f compose.rollback.local.yml \
  up -d --no-build api
```

Restore configuration selectively only if configuration itself caused the failure; keep the expanded frontend allowlist. Restore the saved installed Nginx configuration if its changes also need rollback, validate it, and reload. Use the same project name/directory and preserve any existing deployment overrides. The rollback image predates the new healthcheck, so verify its `/health` response directly.

**Do not restore the pre-upgrade database snapshot merely to roll back code.** It would discard submissions received afterward. Restore a database only for actual recovery with a separate data-preservation plan. The rollback image restores old security/reliability limitations, so treat it as temporary.

## Backups outside upgrades

The backup command also supports online snapshots using SQLite's backup API:

```sh
docker compose run --rm --no-deps api node dist/backup.js \
  "/app/data/backups/manual-$(date -u +%Y%m%dT%H%M%SZ).db"
```

It does not need Telegram credentials when invoked outside Compose. Set `SQLITE_PATH` to the existing database and pass a new destination. Test restoring snapshots in a disposable location. Configure retention, off-host copies, access permissions and free-space monitoring for both submissions and backups; Docker log rotation does not limit SQLite growth.
