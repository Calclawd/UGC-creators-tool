# Webhook Adapter — Deployment Guide

This guide covers deploying the X Outreach webhook adapter to receive AgentMail events.

## Prerequisites

- AgentMail API key
- OpenClaw instance with hooks enabled
- Redis instance (optional but recommended for dedupe)

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Create .env file
cp .env.example .env
# Edit .env with your values

# 3. Run in development mode
npm run dev

# 4. Test endpoints
curl http://localhost:3000/health
curl http://localhost:3000/stats
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENTMAIL_WEBHOOK_SECRET` | ✅ | Svix signing secret (starts with `whsec_`) |
| `OPENCLAW_BASE_URL` | ✅ | Your OpenClaw instance URL |
| `OPENCLAW_HOOK_TOKEN` | ✅ | Auth token for `/hooks/agent` |
| `REDIS_URL` | ❌ | Redis connection string for dedupe |
| `PORT` | ❌ | Server port (default: 3000) |
| `LOG_LEVEL` | ❌ | debug, info, warn, error (default: info) |

---

## Deployment Options

### Option 1: Docker Compose (Self-hosted)

Best for: VPS, home server, existing Docker infrastructure

```bash
# 1. Clone and configure
cd webhook-adapter
cp .env.example .env
# Edit .env

# 2. Start services
docker-compose up -d

# 3. Check logs
docker-compose logs -f webhook

# 4. Test
curl http://localhost:3000/health
```

**With Redis debugging UI:**
```bash
docker-compose --profile debug up -d
# Redis Commander at http://localhost:8081
```

---

### Option 2: Fly.io (Recommended)

Best for: Quick deploy, global edge, auto-scaling

**Prerequisites:**
- [Install flyctl](https://fly.io/docs/hands-on/install-flyctl/)
- `fly auth login`

```bash
# 1. Launch (first time only)
cd webhook-adapter
fly launch --no-deploy
# Choose region, say no to Postgres

# 2. Set secrets
fly secrets set AGENTMAIL_WEBHOOK_SECRET=whsec_your_secret
fly secrets set OPENCLAW_BASE_URL=https://your-vps:18789
fly secrets set OPENCLAW_HOOK_TOKEN=your_token

# 3. (Optional) Add Upstash Redis
fly redis create
# Copy the connection string
fly secrets set REDIS_URL=redis://default:xxx@fly-xxx.upstash.io:6379

# 4. Deploy
fly deploy

# 5. Get your URL
fly status
# → https://x-outreach-webhook.fly.dev
```

**Your webhook URL:** `https://x-outreach-webhook.fly.dev/webhooks/agentmail`

---

### Option 3: Railway

Best for: GitHub integration, simple deploys

1. Connect your GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy

Railway will auto-detect the Dockerfile.

---

### Option 4: Render

Best for: Free tier available, simple setup

1. Create new Web Service
2. Connect GitHub repo
3. Set environment variables
4. Deploy

**render.yaml** (optional):
```yaml
services:
  - type: web
    name: x-outreach-webhook
    env: docker
    plan: free
    healthCheckPath: /health
    envVars:
      - key: AGENTMAIL_WEBHOOK_SECRET
        sync: false
      - key: OPENCLAW_BASE_URL
        sync: false
      - key: OPENCLAW_HOOK_TOKEN
        sync: false
```

---

### Option 5: Cloudflare Workers (Advanced)

For edge deployment, you'll need to rewrite the adapter using Hono or itty-router. The current Express implementation won't work directly.

---

## Redis Options

### Upstash (Recommended for cloud)

1. Create account at [upstash.com](https://upstash.com)
2. Create Redis database
3. Copy connection string
4. Set `REDIS_URL` env var

Free tier: 10,000 commands/day

### Fly.io Redis

```bash
fly redis create
```

### Self-hosted

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
# REDIS_URL=redis://localhost:6379
```

### Without Redis

Dedupe will be disabled. AgentMail retries may cause duplicate processing. Not recommended for production.

---

## Registering with AgentMail

After deployment, register your webhook URL with AgentMail:

### Via API

```bash
curl -X POST https://api.agentmail.to/v0/webhooks \
  -H "Authorization: Bearer YOUR_AGENTMAIL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-webhook-url.com/webhooks/agentmail",
    "event_types": ["message.received"]
  }'
```

**Response:**
```json
{
  "id": "wh_abc123",
  "url": "https://your-webhook-url.com/webhooks/agentmail",
  "secret": "whsec_your_signing_secret",
  "event_types": ["message.received"]
}
```

Save the `secret` — this is your `AGENTMAIL_WEBHOOK_SECRET`.

### Via Bootstrap

If you use `x_outreach_bootstrap`, it will create the webhook automatically:

```json
{
  "agentmail": {
    "apiKey": "YOUR_KEY",
    "webhook": {
      "url": "https://your-webhook-url.com/webhooks/agentmail"
    }
  }
}
```

---

## Monitoring

### Health Check

```bash
curl https://your-url.com/health
```

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "redis": "ready"
}
```

### Metrics (Prometheus)

```bash
curl https://your-url.com/metrics
```

```
webhook_received_total 150
webhook_verified_total 148
webhook_failed_total 2
webhook_deduplicated_total 5
openclaw_wake_success_total 143
openclaw_wake_failed_total 0
uptime_seconds 3600
```

### JSON Stats

```bash
curl https://your-url.com/stats
```

```json
{
  "webhooksReceived": 150,
  "webhooksVerified": 148,
  "webhooksFailed": 2,
  "webhooksDeduplicated": 5,
  "openclawWakeSuccess": 143,
  "openclawWakeFailed": 0,
  "uptimeSeconds": 3600,
  "redis": "ready"
}
```

---

## Testing

### Local Test Script

```bash
npx tsx test-webhook.ts
```

### Test with Real Webhook

1. Deploy the adapter
2. Register webhook with AgentMail
3. Send an email to your AgentMail inbox
4. Check adapter logs for processing

### Manual Test (Signature Verification)

AgentMail requires valid Svix signatures. You can't easily test with curl unless you generate valid signatures.

---

## Troubleshooting

### "Missing Svix headers"

The request doesn't have the required `svix-id`, `svix-timestamp`, `svix-signature` headers. This happens when:
- Testing with curl (expected)
- Webhook URL is wrong

### "Invalid signature"

The Svix signature verification failed. Check:
- `AGENTMAIL_WEBHOOK_SECRET` matches the webhook's secret
- You're using the secret from webhook creation, not your API key

### "OpenClaw wake failed"

The adapter couldn't reach OpenClaw. Check:
- `OPENCLAW_BASE_URL` is correct and accessible
- `OPENCLAW_HOOK_TOKEN` is valid
- OpenClaw hooks are enabled

### "Redis error"

Check:
- `REDIS_URL` is correct
- Redis is running and accessible
- Network/firewall allows connection

### Duplicate Processing

Without Redis, the adapter can't dedupe. AgentMail may retry webhooks on:
- 5xx responses
- Timeouts
- Network errors

Enable Redis for production use.

---

## Security Checklist

- [ ] HTTPS enabled (required for production)
- [ ] Svix signature verification working
- [ ] Environment variables not in code
- [ ] Redis secured (password, network)
- [ ] OpenClaw token rotated periodically
- [ ] Logs don't contain sensitive data

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌───────────┐
│  AgentMail  │────▶│  Webhook Adapter │────▶│  OpenClaw │
│   (email)   │     │  (this service)  │     │  (agent)  │
└─────────────┘     └────────┬─────────┘     └───────────┘
                             │
                             ▼
                      ┌─────────────┐
                      │    Redis    │
                      │  (dedupe)   │
                      └─────────────┘
```

1. Email arrives at AgentMail inbox
2. AgentMail sends webhook to adapter
3. Adapter verifies Svix signature
4. Adapter checks Redis for duplicate
5. Adapter wakes OpenClaw agent
6. Agent processes email and responds
