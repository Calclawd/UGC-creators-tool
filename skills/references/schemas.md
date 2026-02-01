# Schemas Reference

All schemas use Zod v4. Import with modern ESM syntax.

```typescript
import { z } from "zod";
```

## Campaign Config

Root configuration for an outreach campaign.

```typescript
export const Campaign = z.object({
  name: z.string().min(1),
  topics: z.array(z.string().min(1)).min(1),
  antiTopics: z.array(z.string()).default([]),
  creatorSignals: z.array(z.string()).default([]),

  offerMenu: z.array(z.object({
    key: z.string().min(1),
    deliverables: z.array(z.string()).min(1),
    usage: z.enum(["organic_only", "organic_plus_repost", "paid_usage_ok"]).default("organic_only"),
    baselineUsd: z.number().positive().optional()
  })).min(1),

  guardrails: z.object({
    maxUsdPerDeal: z.number().positive(),
    maxUsdPerDeliverable: z.number().positive().optional(),
    allowPaidUsage: z.boolean().default(false),
    escalation: z.object({
      aboveMaxPct: z.number().min(0).max(500).default(20),
      asksExclusivity: z.boolean().default(true),
      asksWhitelisting: z.boolean().default(true),
      unclearUsage: z.boolean().default(true)
    }).default({})
  }),

  outreach: z.object({
    dmDailyCap: z.number().int().min(1).max(500).default(50),
    dmJitterMinutes: z.number().int().min(0).max(360).default(90),
    followUps: z.number().int().min(0).max(3).default(1),
    preferDmIfOpen: z.boolean().default(true),
    emailEnabled: z.boolean().default(true)
  })
});

export type Campaign = z.infer<typeof Campaign>;
```

## Lead

Represents a discovered creator/lead.

```typescript
export const Lead = z.object({
  xUserId: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string().optional(),
  bio: z.string().optional(),
  recentPostId: z.string().optional(),

  email: z.string().email().optional(),
  preferredChannel: z.enum(["x_dm", "email", "x_reply"]).optional(),

  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).default([]),

  status: z.enum([
    "new",
    "queued",
    "dm_sent",
    "email_sent",
    "public_replied",
    "replied",
    "negotiating",
    "won",
    "lost",
    "escalated"
  ]).default("new"),

  lastContactAt: z.string().datetime().optional()
});

export type Lead = z.infer<typeof Lead>;
```

## ParsedReply

Structured extraction from inbound reply (DM or email).

```typescript
export const ParsedReply = z.object({
  intent: z.enum(["interested", "not_interested", "needs_info", "sends_rate", "other"]),
  rateUsd: z.number().positive().optional(),
  deliverables: z.array(z.string()).optional(),
  usage: z.string().optional(),
  timeline: z.string().optional(),
  asksExclusivity: z.boolean().optional(),
  asksWhitelisting: z.boolean().optional(),
  raw: z.string().min(1)
});

export type ParsedReply = z.infer<typeof ParsedReply>;
```

## NegotiationDecision

Output of deterministic negotiation ladder.

```typescript
export const NegotiationDecision = z.object({
  action: z.enum(["accept", "counter", "clarify", "pass", "escalate"]),
  counterOffer: z.object({
    offerKey: z.string().optional(),
    rateUsd: z.number().positive().optional(),
    usage: z.string().optional(),
    notes: z.string().optional()
  }).optional(),
  rationale: z.array(z.string()).default([])
});

export type NegotiationDecision = z.infer<typeof NegotiationDecision>;
```

## Bootstrap Payload

Full config passed to `x_outreach_bootstrap`.

```typescript
export const BootstrapPayload = z.object({
  agentmail: z.object({
    apiKey: z.string().min(1),
    inboxId: z.string().default(""),
    inboxEmail: z.string().default(""),
    webhook: z.object({
      url: z.string().url(),
      secret: z.string().default(""),
      webhookId: z.string().default(""),
      eventTypes: z.array(z.string()).default(["message.received"])
    })
  }),

  openclaw: z.object({
    baseUrl: z.string().url(),
    token: z.string().min(1),
    path: z.string().default("/hooks")
  }),

  x: z.object({
    bearerToken: z.string().min(1),
    userAccessToken: z.string().min(1)
  }),

  campaign: Campaign
});

export type BootstrapPayload = z.infer<typeof BootstrapPayload>;
```

## AgentMail Webhook Event

Payload structure for `message.received` events.

```typescript
export const AgentMailWebhookEvent = z.object({
  event_id: z.string(),
  event_type: z.literal("message.received"),
  timestamp: z.string().datetime(),
  message: z.object({
    id: z.string(),
    inbox_id: z.string(),
    thread_id: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    preview: z.string().optional(),
    received_at: z.string().datetime()
  })
});

export type AgentMailWebhookEvent = z.infer<typeof AgentMailWebhookEvent>;
```

## Scoring Config

Weights for lead scoring algorithm.

```typescript
export const ScoringWeights = z.object({
  signalMatch: z.number().default(20),      // per signal found in bio
  signalMaxTotal: z.number().default(60),   // cap on signal points
  engagementBase: z.number().default(10),   // min engagement points
  engagementMax: z.number().default(30),    // max engagement points
  accountQuality: z.number().default(10)    // follower ratio / age
});

export type ScoringWeights = z.infer<typeof ScoringWeights>;
```

## Outreach State

Tracks daily caps and backoff state.

```typescript
export const OutreachState = z.object({
  dmsSentToday: z.number().int().default(0),
  dmResetAt: z.string().datetime(),
  backoffUntil: z.string().datetime().optional(),
  backoffMultiplier: z.number().default(1)
});

export type OutreachState = z.infer<typeof OutreachState>;
```
