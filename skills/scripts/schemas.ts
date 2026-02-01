/**
 * X Outreach Agent — Schemas
 *
 * Zod v4 schemas for all data types.
 * Modern ESM imports, no mock data.
 */

import { z } from "zod";

// =============================================================================
// CAMPAIGN
// =============================================================================

export const OfferItem = z.object({
  key: z.string().min(1),
  deliverables: z.array(z.string()).min(1),
  usage: z
    .enum(["organic_only", "organic_plus_repost", "paid_usage_ok"])
    .default("organic_only"),
  baselineUsd: z.number().positive().optional(),
});

export type OfferItem = z.infer<typeof OfferItem>;

export const EscalationConfig = z.object({
  aboveMaxPct: z.number().min(0).max(500).default(20),
  asksExclusivity: z.boolean().default(true),
  asksWhitelisting: z.boolean().default(true),
  unclearUsage: z.boolean().default(true),
});

export type EscalationConfig = z.infer<typeof EscalationConfig>;

export const Guardrails = z.object({
  maxUsdPerDeal: z.number().positive(),
  maxUsdPerDeliverable: z.number().positive().optional(),
  allowPaidUsage: z.boolean().default(false),
  escalation: EscalationConfig.default({}),
});

export type Guardrails = z.infer<typeof Guardrails>;

export const OutreachConfig = z.object({
  dmDailyCap: z.number().int().min(1).max(500).default(50),
  dmJitterMinutes: z.number().int().min(0).max(360).default(90),
  followUps: z.number().int().min(0).max(3).default(1),
  preferDmIfOpen: z.boolean().default(true),
  emailEnabled: z.boolean().default(true),
});

export type OutreachConfig = z.infer<typeof OutreachConfig>;

export const Campaign = z.object({
  name: z.string().min(1),
  topics: z.array(z.string().min(1)).min(1),
  antiTopics: z.array(z.string()).default([]),
  creatorSignals: z.array(z.string()).default([]),
  offerMenu: z.array(OfferItem).min(1),
  guardrails: Guardrails,
  outreach: OutreachConfig.default({}),
});

export type Campaign = z.infer<typeof Campaign>;

// =============================================================================
// LEAD
// =============================================================================

export const LeadStatus = z.enum([
  "new",
  "queued",
  "dm_sent",
  "email_sent",
  "public_replied",
  "replied",
  "negotiating",
  "won",
  "lost",
  "escalated",
]);

export type LeadStatus = z.infer<typeof LeadStatus>;

export const OutreachChannel = z.enum(["x_dm", "email", "x_reply"]);

export type OutreachChannel = z.infer<typeof OutreachChannel>;

export const Lead = z.object({
  xUserId: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string().optional(),
  bio: z.string().optional(),
  recentPostId: z.string().optional(),

  email: z.string().email().optional(),
  preferredChannel: OutreachChannel.optional(),

  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).default([]),

  status: LeadStatus.default("new"),
  lastContactAt: z.string().datetime().optional(),

  // Counters for tracking
  dmCount: z.number().int().default(0),
  emailCount: z.number().int().default(0),

  // Thread tracking for email
  threadId: z.string().optional(),
});

export type Lead = z.infer<typeof Lead>;

// =============================================================================
// PARSED REPLY
// =============================================================================

export const ReplyIntent = z.enum([
  "interested",
  "not_interested",
  "needs_info",
  "sends_rate",
  "accepts",
  "counter_offer",
  "other",
]);

export type ReplyIntent = z.infer<typeof ReplyIntent>;

export const ParsedReply = z.object({
  intent: ReplyIntent,
  rateUsd: z.number().positive().optional(),
  deliverables: z.array(z.string()).optional(),
  usage: z.string().optional(),
  timeline: z.string().optional(),
  asksExclusivity: z.boolean().optional(),
  asksWhitelisting: z.boolean().optional(),
  raw: z.string().min(1),
  receivedAt: z.string().datetime().optional(),
});

export type ParsedReply = z.infer<typeof ParsedReply>;

// =============================================================================
// NEGOTIATION DECISION
// =============================================================================

export const NegotiationAction = z.enum([
  "accept",
  "counter",
  "clarify",
  "pass",
  "escalate",
]);

export type NegotiationAction = z.infer<typeof NegotiationAction>;

export const CounterOffer = z.object({
  offerKey: z.string().optional(),
  rateUsd: z.number().positive().optional(),
  usage: z.string().optional(),
  notes: z.string().optional(),
});

export type CounterOffer = z.infer<typeof CounterOffer>;

export const NegotiationDecision = z.object({
  action: NegotiationAction,
  counterOffer: CounterOffer.optional(),
  rationale: z.array(z.string()).default([]),
  replyDraft: z.string().optional(),
});

export type NegotiationDecision = z.infer<typeof NegotiationDecision>;

// =============================================================================
// BOOTSTRAP
// =============================================================================

export const AgentMailConfig = z.object({
  apiKey: z.string().min(1),
  inboxId: z.string().default(""),
  inboxEmail: z.string().default(""),
  webhook: z.object({
    url: z.string().url(),
    secret: z.string().default(""),
    webhookId: z.string().default(""),
    eventTypes: z.array(z.string()).default(["message.received"]),
  }),
});

export type AgentMailConfig = z.infer<typeof AgentMailConfig>;

export const OpenClawConfig = z.object({
  baseUrl: z.string().url(),
  token: z.string().min(1),
  path: z.string().default("/hooks"),
});

export type OpenClawConfig = z.infer<typeof OpenClawConfig>;

export const XConfig = z.object({
  bearerToken: z.string().min(1),
  userAccessToken: z.string().min(1),
});

export type XConfig = z.infer<typeof XConfig>;

export const BootstrapPayload = z.object({
  agentmail: AgentMailConfig,
  openclaw: OpenClawConfig,
  x: XConfig,
  campaign: Campaign,
});

export type BootstrapPayload = z.infer<typeof BootstrapPayload>;

export const BootstrapOutput = z.object({
  ready: z.boolean(),
  inboxEmail: z.string().email().optional(),
  webhookId: z.string().optional(),
  errors: z.array(z.string()).default([]),
});

export type BootstrapOutput = z.infer<typeof BootstrapOutput>;

// =============================================================================
// DISCOVERY
// =============================================================================

export const DiscoverLeadsInput = z.object({
  maxResults: z.number().int().min(10).max(100).default(50),
  customQuery: z.string().optional(),
});

export type DiscoverLeadsInput = z.infer<typeof DiscoverLeadsInput>;

export const DiscoverLeadsOutput = z.object({
  leads: z.array(Lead),
  query: z.string(),
  total: z.number().int(),
});

export type DiscoverLeadsOutput = z.infer<typeof DiscoverLeadsOutput>;

// =============================================================================
// OUTREACH
// =============================================================================

export const PlannedOutreach = z.object({
  lead: Lead,
  channel: OutreachChannel,
  template: z.string(),
});

export type PlannedOutreach = z.infer<typeof PlannedOutreach>;

export const PlanOutreachInput = z.object({
  leads: z.array(Lead),
});

export type PlanOutreachInput = z.infer<typeof PlanOutreachInput>;

export const PlanOutreachOutput = z.object({
  planned: z.array(PlannedOutreach),
  skipped: z.array(
    z.object({
      lead: Lead,
      reason: z.string(),
    })
  ),
});

export type PlanOutreachOutput = z.infer<typeof PlanOutreachOutput>;

export const SendOutreachInput = z.object({
  planned: z.array(PlannedOutreach),
});

export type SendOutreachInput = z.infer<typeof SendOutreachInput>;

export const OutreachResult = z.object({
  leadHandle: z.string(),
  channel: OutreachChannel,
  success: z.boolean(),
  error: z.string().optional(),
});

export type OutreachResult = z.infer<typeof OutreachResult>;

export const SendOutreachOutput = z.object({
  sent: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.string()),
  results: z.array(OutreachResult),
});

export type SendOutreachOutput = z.infer<typeof SendOutreachOutput>;

// =============================================================================
// NEGOTIATION / AGENTMAIL EVENTS
// =============================================================================

export const AgentMailMessageEvent = z.object({
  event_id: z.string(),
  event_type: z.literal("message.received"),
  timestamp: z.string().datetime().optional(),
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
    created_at: z.string().datetime().optional(),
  }),
});

export type AgentMailMessageEvent = z.infer<typeof AgentMailMessageEvent>;

export const DecideNextInput = z.object({
  lead: Lead,
  reply: ParsedReply,
  campaign: Campaign,
});

export type DecideNextInput = z.infer<typeof DecideNextInput>;

// =============================================================================
// STATE
// =============================================================================

export const OutreachState = z.object({
  dmsSentToday: z.number().int().default(0),
  dmResetAt: z.string().datetime(),
  backoffUntil: z.string().datetime().optional(),
  backoffMultiplier: z.number().default(1),
});

export type OutreachState = z.infer<typeof OutreachState>;

export const ScoringWeights = z.object({
  signalMatch: z.number().default(20),
  signalMaxTotal: z.number().default(60),
  engagementBase: z.number().default(10),
  engagementMax: z.number().default(30),
  accountQuality: z.number().default(10),
});

export type ScoringWeights = z.infer<typeof ScoringWeights>;
