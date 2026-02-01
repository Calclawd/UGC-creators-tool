# X API Reference

## Authentication

### Bearer Token (App-Only)
Used for: Recent search, user lookup  
Header: `Authorization: Bearer <token>`

### User OAuth Token
Used for: DM send/read (required, app-only NOT supported)  
Header: `Authorization: Bearer <user_access_token>`

## Endpoints

### Recent Search

Search tweets from last 7 days.

```
GET https://api.twitter.com/2/tweets/search/recent
```

**Auth:** Bearer token

**Query params:**
- `query` (required): Search query, max 512 chars
- `max_results`: 10-100, default 10
- `expansions`: `author_id,entities.mentions.username`
- `tweet.fields`: `created_at,public_metrics,entities`
- `user.fields`: `description,public_metrics,verified`

**Example query building:**
```typescript
const topics = [
  "(ugc OR creator OR thread)",
  "(crypto OR blockchain OR gaming)",
  "(collab OR sponsor)"
];
const query = topics.join(" ");
// Result: (ugc OR creator OR thread) (crypto OR blockchain OR gaming) (collab OR sponsor)
```

**Response:**
```json
{
  "data": [
    {
      "id": "1234567890",
      "text": "Tweet content...",
      "author_id": "9876543210",
      "created_at": "2024-01-15T12:00:00.000Z",
      "public_metrics": {
        "retweet_count": 10,
        "reply_count": 5,
        "like_count": 100
      }
    }
  ],
  "includes": {
    "users": [
      {
        "id": "9876543210",
        "username": "creator_handle",
        "name": "Creator Name",
        "description": "Bio with DMs open",
        "public_metrics": {
          "followers_count": 50000,
          "following_count": 500
        }
      }
    ]
  },
  "meta": {
    "next_token": "abc123",
    "result_count": 10
  }
}
```

**Rate limit:** 450 requests / 15 min

### User Lookup by ID

Get user details.

```
GET https://api.twitter.com/2/users/:id
```

**Auth:** Bearer token

**Query params:**
- `user.fields`: `description,public_metrics,verified,protected`

**Check DM eligibility:** User object does not directly expose "DMs open" — infer from bio signals or attempt DM and handle errors.

### Send Direct Message

Send DM to a user.

```
POST https://api.twitter.com/2/dm_conversations/with/:participant_id/messages
```

**Auth:** User OAuth token (required)

**Body:**
```json
{
  "text": "Message content..."
}
```

**Response:**
```json
{
  "data": {
    "dm_conversation_id": "conv_123",
    "dm_event_id": "event_456"
  }
}
```

**Rate limit:** 500 messages / 24 hours (per user)

**Error codes:**
- `403`: User has DMs disabled or doesn't follow you
- `429`: Rate limit exceeded

### List DM Events

Get DM events in a conversation.

```
GET https://api.twitter.com/2/dm_conversations/with/:participant_id/dm_events
```

**Auth:** User OAuth token

**Query params:**
- `dm_event.fields`: `created_at,sender_id,text`
- `max_results`: 1-100

**Response:**
```json
{
  "data": [
    {
      "id": "event_789",
      "event_type": "MessageCreate",
      "text": "Reply message...",
      "sender_id": "9876543210",
      "created_at": "2024-01-15T14:00:00.000Z"
    }
  ]
}
```

## Rate Limit Handling

All endpoints return `429 Too Many Requests` when limits exceeded.

**Headers on 429:**
- `x-rate-limit-limit`: Request limit
- `x-rate-limit-remaining`: Remaining requests
- `x-rate-limit-reset`: Unix timestamp when limit resets

**Backoff strategy:**
```typescript
async function withBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let delay = 1000;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e.status !== 429) throw e;
      const resetTime = e.headers?.["x-rate-limit-reset"];
      if (resetTime) {
        delay = (parseInt(resetTime) * 1000) - Date.now() + 1000;
      } else {
        delay *= 2;
      }
      await sleep(Math.min(delay, 60000));
    }
  }
  throw new Error("Max retries exceeded");
}
```

## Automation Rules

From X's automation policy:
- Don't send unsolicited bulk DMs
- Don't automate DMs that appear spammy
- Include opt-out mechanism
- Rate-limit outreach to appear human
- Don't scrape or store data beyond API terms

**Safe practices:**
- Cap DMs to 40-50/day
- Add random jitter (1-3 hours between messages)
- Personalize each message
- Stop immediately if user requests
- Keep conversation logs for compliance
