# X Outreach Agent

**Autonomous UGC creator discovery, multi-channel outreach, and deterministic rate negotiation for sponsorship deals.**

Discover creators on X (Twitter), reach out via DM or email, and negotiate rates automatically—all within your budget constraints.

## What It Does

```
1. DISCOVER → Search X for UGC creators matching your criteria
2. ROUTE    → Choose best channel: X DM (preferred) or Email (fallback)
3. OUTREACH → Send personalized pitch
4. INGEST   → Monitor replies via webhooks + polling
5. NEGOTIATE → Deterministic decision engine:
               - Accept if rate ≤ baseline
               - Counter if rate ≤ max budget
               - Escalate if deal exceeds limits
               - Clarify if unclear/needs info
6. REPLY    → Send counter-offer or pass
```

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Calclawd/UGC-creators-tool
cd x-outreach-agent
npm install
npm run build
```

### 2. Get API Keys

- **X API:** https://developer.x.com/en/portal/dashboard
  - Need bearer token + user OAuth token
- **AgentMail:** https://agentmail.to
  - Need API key + webhook secret
- **OpenClaw:** VPS with webhook access

### 3. Environment Setup

```bash
cp .env.example .env

# Edit .env with your tokens:
X_BEARER_TOKEN=your_bearer_token
X_USER_ACCESS_TOKEN=your_user_token
AGENTMAIL_API_KEY=your_agentmail_key
AGENTMAIL_WEBHOOK_SECRET=your_webhook_secret
OPENCLAW_BASE_URL=https://your-vps:18789
OPENCLAW_HOOK_TOKEN=your_hook_token
```

### 4. Deploy Webhook Adapter

The webhook adapter receives AgentMail replies and triggers negotiation logic:

```bash
cd webhook-adapter
npm install
npm start
# → Listening on http://localhost:3000
```

Or with Docker:

```bash
docker build -t x-outreach-webhook .
docker run -p 3000:3000 --env-file ../.env x-outreach-webhook
```

### 5. Bootstrap the Agent

Send this payload to your Lucid agent:

```json
{
  "action": "x_outreach_bootstrap",
  "input": {
    "campaign": {
      "name": "TikTok Creator Partnership Q1",
      "topics": ["tiktok", "creator economy", "viral marketing"],
      "antiTopics": ["scam", "fake followers"],
      "dailyDmLimit": 50,
      "maxUsdPerDeal": 5000,
      "aboveMaxPct": 20
    },
    "x": {
      "bearerToken": process.env.X_BEARER_TOKEN,
      "userAccessToken": process.env.X_USER_ACCESS_TOKEN
    },
    "agentmail": {
      "apiKey": process.env.AGENTMAIL_API_KEY,
      "webhook": {
        "url": "https://your-public-domain/webhooks/agentmail"
      }
    },
    "openclaw": {
      "baseUrl": process.env.OPENCLAW_BASE_URL,
      "token": process.env.OPENCLAW_HOOK_TOKEN
    }
  }
}
```

Response:

```json
{
  "ready": true,
  "inboxEmail": "campaign_xyz@agentmail.to",
  "webhookId": "webhook_123",
  "errors": []
}
```

## Entrypoints

| Entrypoint | Purpose | Trigger |
|-----------|---------|---------|
| `x_outreach_bootstrap` | Initialize X, AgentMail, webhooks | Once per campaign |
| `discover_leads` | Search X for creators | On demand or scheduled |
| `plan_outreach` | Route lead to channel | Per-lead decision |
| `send_outreach` | Send DM or email | Per-lead action |
| `ingest_replies_x` | Poll X DM events | Polling loop |
| `agentmail_ingest_event` | Handle email replies | Webhook trigger |
| `decide_next` | Negotiate via decision engine | Per reply |
| `agentmail_send_reply` | Send negotiation response | Decision output |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BOOTSTRAP                             │
│ • Validate X tokens                                      │
│ • Create AgentMail inbox                                │
│ • Register webhook listener                             │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│                    DISCOVERY                             │
│ X API Search (7-day window)                             │
│ • Score leads by signals, followers, DM access         │
│ • Extract email from bio                               │
│ • Return sorted by score                               │
└─────────────┬───────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│                   ROUTING                                │
│ Email available?   → use email (preferred)             │
│ DMs open + cap ok? → use X DM                          │
│ Else              → draft for human                     │
└─────────────┬───────────────────────────────────────────┘
              │
      ┌───────┴────────┐
      ▼                ▼
 [X DM]          [Email]
 OAuth token   AgentMail API
      │                │
      └────────┬───────┘
              ▼
   ┌──────────────────────────┐
   │   WAIT FOR REPLIES       │
   │ • X: polling DM_events   │
   │ • Email: webhook trigger │
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │  PARSE REPLY TEXT        │
   │ • Extract intent         │
   │ • Extract rate ($XXX)    │
   │ • Check for conditions   │
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │  DECISION ENGINE         │
   │ Ladder of logic:         │
   │ 1. Not interested? PASS  │
   │ 2. Rate too high? ESC    │
   │ 3. Rate OK? ACCEPT       │
   │ 4. Default? CLARIFY      │
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │   SEND REPLY             │
   │ Accept / Counter / Pass  │
   │ Update lead status       │
   └──────────────────────────┘
```

## Negotiation Logic

The `decide_next` entrypoint uses a **deterministic ladder** (first match wins):

```typescript
1. intent = "not_interested"         → PASS (reject)
2. rate > maxUsdPerDeal              → ESCALATE (too expensive)
3. rate > max * (1 + aboveMaxPct)    → ESCALATE (exceed threshold)
4. asksExclusivity = true            → ESCALATE (requires approval)
5. asksWhitelisting = true           → ESCALATE (requires approval)
6. usageUnclear = true               → CLARIFY (get details)
7. rate <= baselineOffer             → ACCEPT (great deal)
8. rate <= maxUsd                    → COUNTER (with best offer)
9. intent = "needs_info"             → CLARIFY (send details)
10. intent = "interested"            → CLARIFY (request rate)
11. default                          → CLARIFY (follow up)
```

This is **not** an LLM decision—it's a rules-based ladder with clear thresholds.

## Configuration

### Campaign Settings

```typescript
{
  "name": "My Campaign",
  "topics": ["creator", "influencer"],      // What to search for
  "antiTopics": ["scam", "bot"],            // What to exclude
  "dailyDmLimit": 50,                       // Max X DMs per day
  "maxUsdPerDeal": 5000,                    // Max budget per creator
  "aboveMaxPct": 20,                        // % above max for escalation
  "outreachTemplate": "Hi {name}...",       // Optional custom template
  "negotiationBudget": 1000,                // Total negotiation budget
}
```

### Environment Variables

See `.env.example` for full list. Required:

- `X_BEARER_TOKEN` — X API bearer token (read access)
- `X_USER_ACCESS_TOKEN` — X user OAuth token (DM access)
- `AGENTMAIL_API_KEY` — AgentMail API key
- `AGENTMAIL_WEBHOOK_SECRET` — Webhook verification secret
- `OPENCLAW_BASE_URL` — VPS base URL for callbacks
- `OPENCLAW_HOOK_TOKEN` — Hook token for authentication

Optional:

- `REDIS_URL` — Redis for persistent state (production)

## Utilities

**New in v1.1:**

- **Logger** — Structured logging with components
- **Retry** — Exponential backoff for API calls
- **Cache** — In-memory caching with TTL
- **Config** — Configuration validation & management

See `skills/scripts/utils/` for implementation.

## Examples

See `examples/` for:
- Bootstrap payload
- Lead discovery queries
- Outreach templates
- Negotiation scenarios
- Webhook events

## Troubleshooting

### "Authentication required" on X API calls

Check:
- Bearer token is valid (read-only scope needed)
- User OAuth token is not expired
- Both tokens are for the same X app

### AgentMail webhook not triggering

Check:
- Webhook adapter is running and accessible
- `OPENCLAW_BASE_URL` is publicly reachable
- `OPENCLAW_HOOK_TOKEN` matches in .env
- Webhook secret matches in AgentMail dashboard

### Stuck on "X DM cap"

Check:
- `dailyDmLimit` is high enough
- Date hasn't reset yet (check `lastDmDate`)
- X API rate limits (wait 15 minutes)

## Production Deployment

1. **Use Redis** for persistent state:
   ```bash
   export REDIS_URL=redis://your-redis:6379
   ```

2. **Deploy webhook adapter** to stable public URL

3. **Set up monitoring:**
   - Log aggregation (see Logger utility)
   - Webhook delivery tracking
   - Lead pipeline metrics

4. **Rate limiting:**
   - X API: 450 requests/15 min (search), 200 DM/day
   - AgentMail: ~100 emails/minute
   - Configure according to your plan

## Contributing

Improvements welcome! Areas for enhancement:

- [ ] LLM-based reply parsing (vs heuristics)
- [ ] Multi-language support
- [ ] Advanced lead scoring
- [ ] A/B testing outreach templates
- [ ] Analytics dashboard
- [ ] Automated follow-ups

## License

MIT

## Support

- **GitHub:** https://github.com/Calclawd/UGC-creators-tool
- **Issues:** https://github.com/Calclawd/UGC-creators-tool/issues
- **X Docs:** https://developer.x.com
- **AgentMail Docs:** https://docs.agentmail.to

---

**Built for:** UGC creators, agencies, brand partnerships  
**Powered by:** Lucid Agents, X API, AgentMail, OpenClaw  
**Status:** Production-ready ✅
