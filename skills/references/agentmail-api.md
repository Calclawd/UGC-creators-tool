# AgentMail API Reference

Base URL: `https://api.agentmail.io`

## Authentication

Header: `Authorization: Bearer <api_key>`

## Endpoints

### Create Inbox

```
POST /v0/inboxes
```

**Body:**
```json
{
  "name": "outreach-inbox",
  "email_prefix": "outreach"
}
```

**Response:**
```json
{
  "id": "inb_abc123",
  "email": "outreach@mail.agentmail.io",
  "name": "outreach-inbox",
  "created_at": "2024-01-15T12:00:00.000Z"
}
```

### List Inboxes

```
GET /v0/inboxes
```

**Response:**
```json
{
  "data": [
    {
      "id": "inb_abc123",
      "email": "outreach@mail.agentmail.io",
      "name": "outreach-inbox"
    }
  ]
}
```

### Create Webhook

Subscribe to real-time events.

```
POST /v0/webhooks
```

**Body:**
```json
{
  "url": "https://your-host.com/webhooks/agentmail",
  "event_types": ["message.received"],
  "inbox_ids": ["inb_abc123"]
}
```

**Response:**
```json
{
  "id": "whk_xyz789",
  "url": "https://your-host.com/webhooks/agentmail",
  "secret": "whsec_abcdef123456",
  "event_types": ["message.received"],
  "inbox_ids": ["inb_abc123"],
  "created_at": "2024-01-15T12:00:00.000Z"
}
```

**Important:** Store the `secret` — needed for Svix signature verification.

### List Webhooks

```
GET /v0/webhooks
```

### Delete Webhook

```
DELETE /v0/webhooks/:webhook_id
```

### Send Message

Send email from an inbox.

```
POST /v0/inboxes/:inbox_id/messages/send
```

**Body:**
```json
{
  "to": ["creator@example.com"],
  "subject": "Partnership opportunity",
  "text": "Plain text body...",
  "html": "<p>HTML body...</p>",
  "reply_to_message_id": "msg_optional_for_threading"
}
```

**Response:**
```json
{
  "id": "msg_def456",
  "inbox_id": "inb_abc123",
  "thread_id": "thr_ghi789",
  "to": ["creator@example.com"],
  "subject": "Partnership opportunity",
  "sent_at": "2024-01-15T12:05:00.000Z"
}
```

### Reply to Thread

```
POST /v0/inboxes/:inbox_id/threads/:thread_id/messages
```

**Body:**
```json
{
  "text": "Reply content...",
  "html": "<p>Reply content...</p>"
}
```

### Get Thread

```
GET /v0/inboxes/:inbox_id/threads/:thread_id
```

**Response:**
```json
{
  "id": "thr_ghi789",
  "inbox_id": "inb_abc123",
  "subject": "Re: Partnership opportunity",
  "messages": [
    {
      "id": "msg_001",
      "from": "outreach@mail.agentmail.io",
      "to": ["creator@example.com"],
      "text": "Original message...",
      "sent_at": "2024-01-15T12:05:00.000Z"
    },
    {
      "id": "msg_002",
      "from": "creator@example.com",
      "to": ["outreach@mail.agentmail.io"],
      "text": "Creator's reply...",
      "received_at": "2024-01-15T14:30:00.000Z"
    }
  ]
}
```

## Webhook Events

### Event Structure

All webhook payloads are signed with Svix.

```json
{
  "event_id": "evt_unique123",
  "event_type": "message.received",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "message": {
    "id": "msg_002",
    "inbox_id": "inb_abc123",
    "thread_id": "thr_ghi789",
    "from": "creator@example.com",
    "to": ["outreach@mail.agentmail.io"],
    "subject": "Re: Partnership opportunity",
    "text": "I'm interested! My rate is $800...",
    "html": "<p>I'm interested! My rate is $800...</p>",
    "preview": "I'm interested! My rate is $800...",
    "received_at": "2024-01-15T14:30:00.000Z"
  }
}
```

### Event Types

| Type | Description |
|------|-------------|
| `message.received` | New inbound email |
| `message.sent` | Outbound email confirmed |
| `message.bounced` | Delivery failed |
| `message.complained` | Marked as spam |

### Signature Verification

AgentMail uses Svix for webhook signatures. **CRITICAL:** Verify against raw request body, not parsed JSON.

**Headers:**
- `svix-id`: Unique message ID
- `svix-timestamp`: Unix timestamp
- `svix-signature`: Signature(s)

**Verification (Node.js):**
```typescript
import { Webhook } from "svix";

const wh = new Webhook(process.env.AGENTMAIL_WEBHOOK_SECRET);

// IMPORTANT: Use raw body string, not parsed object
const rawBody = req.body.toString("utf8");

const headers = {
  "svix-id": req.header("svix-id"),
  "svix-timestamp": req.header("svix-timestamp"),
  "svix-signature": req.header("svix-signature")
};

try {
  const event = wh.verify(rawBody, headers);
  // Valid - process event
} catch (err) {
  // Invalid signature - reject
  return res.status(400).end();
}
```

### Retry Behavior

AgentMail retries failed webhook deliveries:
- Immediate retry on 5xx
- Exponential backoff up to 24 hours
- Same `event_id` on retries — dedupe by this

**Dedupe pattern:**
```typescript
const seen = await redis.get(`event:${event.event_id}`);
if (seen) return res.status(204).end(); // Already processed
await redis.set(`event:${event.event_id}`, "1", "EX", 86400 * 30);
```

## Error Responses

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Missing required field: to"
  }
}
```

| Code | HTTP | Description |
|------|------|-------------|
| `invalid_request` | 400 | Malformed request |
| `unauthorized` | 401 | Invalid/missing API key |
| `not_found` | 404 | Resource doesn't exist |
| `rate_limited` | 429 | Too many requests |
| `internal_error` | 500 | Server error |
