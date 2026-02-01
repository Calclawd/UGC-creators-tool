/**
 * Negotiation — decide_next + agentmail_ingest_event + agentmail_send_reply
 *
 * Deterministic guardrails ladder: LLM extracts terms, logic decides action
 */

import {
  Lead,
  Campaign,
  ParsedReply,
  NegotiationDecision,
  DecideNextInput,
  AgentMailMessageEvent,
} from "./schemas.js";
import { AgentMailClient } from "./agentmail-client.js";

// =============================================================================
// REPLY PARSING (LLM would do this in production)
// =============================================================================

/**
 * Extract structured data from reply text.
 * In production, this would be an LLM call. Here we use heuristics.
 */
export function parseReplyText(text: string): Omit<ParsedReply, "raw"> {
  const lowerText = text.toLowerCase();

  // Intent detection
  let intent: ParsedReply["intent"] = "other";

  if (
    lowerText.includes("not interested") ||
    lowerText.includes("no thanks") ||
    lowerText.includes("pass") ||
    lowerText.includes("not looking")
  ) {
    intent = "not_interested";
  } else if (
    lowerText.includes("sounds good") ||
    lowerText.includes("interested") ||
    lowerText.includes("tell me more") ||
    lowerText.includes("let's chat")
  ) {
    intent = "interested";
  } else if (
    lowerText.includes("my rate") ||
    lowerText.includes("i charge") ||
    lowerText.includes("$") ||
    lowerText.includes("usd") ||
    lowerText.includes("per post")
  ) {
    intent = "sends_rate";
  } else if (
    lowerText.includes("what") ||
    lowerText.includes("how much") ||
    lowerText.includes("more info") ||
    lowerText.includes("details")
  ) {
    intent = "needs_info";
  } else if (
    lowerText.includes("deal") ||
    lowerText.includes("works for me") ||
    lowerText.includes("accept")
  ) {
    intent = "accepts";
  } else if (
    lowerText.includes("counter") ||
    lowerText.includes("how about") ||
    lowerText.includes("instead")
  ) {
    intent = "counter_offer";
  }

  // Rate extraction
  let rateUsd: number | undefined;
  const rateMatch = text.match(/\$\s*(\d{1,3}(?:,?\d{3})*(?:\.\d{2})?)/);
  if (rateMatch) {
    rateUsd = parseFloat(rateMatch[1].replace(/,/g, ""));
  } else {
    const numMatch = text.match(/(\d{3,5})\s*(?:usd|dollars?|bucks?)/i);
    if (numMatch) {
      rateUsd = parseFloat(numMatch[1]);
    }
  }

  // Exclusivity detection
  const asksExclusivity =
    lowerText.includes("exclusiv") ||
    lowerText.includes("only work with") ||
    lowerText.includes("no competitors");

  // Whitelisting detection
  const asksWhitelisting =
    lowerText.includes("whitelist") ||
    lowerText.includes("paid ads") ||
    lowerText.includes("ad rights") ||
    lowerText.includes("boost");

  // Timeline extraction
  let timeline: string | undefined;
  const timelineMatch = text.match(
    /(?:within|by|deadline|due)\s+(\d+\s*(?:days?|weeks?|months?))/i
  );
  if (timelineMatch) {
    timeline = timelineMatch[1];
  }

  return {
    intent,
    rateUsd,
    asksExclusivity,
    asksWhitelisting,
    timeline,
  };
}

// =============================================================================
// DECISION LADDER
// =============================================================================

/**
 * Deterministic negotiation decision based on guardrails.
 * The ladder is evaluated top-to-bottom; first match wins.
 */
export function decide_next_logic(
  reply: ParsedReply,
  campaign: Campaign,
  lead: Lead
): NegotiationDecision {
  const { guardrails, offerMenu } = campaign;
  const { escalation } = guardrails;
  const rationale: string[] = [];

  // 1. Not interested → pass
  if (reply.intent === "not_interested") {
    return {
      action: "pass",
      rationale: ["Creator declined interest"],
    };
  }

  // 2. Rate exceeds hard max → escalate
  if (reply.rateUsd && reply.rateUsd > guardrails.maxUsdPerDeal) {
    return {
      action: "escalate",
      rationale: [
        `Rate $${reply.rateUsd} exceeds max $${guardrails.maxUsdPerDeal}`,
      ],
    };
  }

  // 3. Rate exceeds soft max (baseline + aboveMaxPct) → escalate
  if (reply.rateUsd) {
    const threshold = guardrails.maxUsdPerDeal * (1 + escalation.aboveMaxPct / 100);
    if (reply.rateUsd > threshold) {
      return {
        action: "escalate",
        rationale: [
          `Rate $${reply.rateUsd} exceeds threshold $${Math.round(threshold)} (max + ${escalation.aboveMaxPct}%)`,
        ],
      };
    }
  }

  // 4. Asks exclusivity → escalate if configured
  if (reply.asksExclusivity && escalation.asksExclusivity) {
    return {
      action: "escalate",
      rationale: ["Creator requests exclusivity — needs human review"],
    };
  }

  // 5. Asks whitelisting/paid usage → escalate if configured
  if (reply.asksWhitelisting && escalation.asksWhitelisting) {
    return {
      action: "escalate",
      rationale: ["Creator requests whitelisting/ad rights — needs human review"],
    };
  }

  // 6. Usage unclear → clarify if configured
  if (reply.usage === undefined && escalation.unclearUsage && reply.intent === "sends_rate") {
    return {
      action: "clarify",
      rationale: ["Usage rights unclear — requesting clarification"],
      replyDraft: generateClarifyReply(lead, "usage"),
    };
  }

  // 7. Rate within baseline → accept
  if (reply.rateUsd) {
    // Find matching offer
    const matchingOffer = offerMenu.find((o) => {
      if (!o.baselineUsd) return false;
      return reply.rateUsd! <= o.baselineUsd;
    });

    if (matchingOffer) {
      return {
        action: "accept",
        rationale: [
          `Rate $${reply.rateUsd} within baseline $${matchingOffer.baselineUsd} for ${matchingOffer.key}`,
        ],
        replyDraft: generateAcceptReply(lead, reply.rateUsd, matchingOffer.key),
      };
    }
  }

  // 8. Rate above baseline but within max → counter
  if (reply.rateUsd && reply.rateUsd <= guardrails.maxUsdPerDeal) {
    // Find best offer to counter with
    const bestOffer = offerMenu.reduce((best, current) => {
      if (!current.baselineUsd) return best;
      if (!best || current.baselineUsd > (best.baselineUsd || 0)) {
        return current;
      }
      return best;
    }, offerMenu[0]);

    return {
      action: "counter",
      counterOffer: {
        offerKey: bestOffer.key,
        rateUsd: bestOffer.baselineUsd,
        usage: bestOffer.usage,
      },
      rationale: [
        `Rate $${reply.rateUsd} above baseline — countering with $${bestOffer.baselineUsd}`,
      ],
      replyDraft: generateCounterReply(lead, bestOffer.baselineUsd || 0, bestOffer.key),
    };
  }

  // 9. Needs info → provide info
  if (reply.intent === "needs_info") {
    return {
      action: "clarify",
      rationale: ["Creator needs more information"],
      replyDraft: generateInfoReply(lead, campaign),
    };
  }

  // 10. Interested but no rate → continue conversation
  if (reply.intent === "interested") {
    return {
      action: "clarify",
      rationale: ["Creator interested — continuing conversation"],
      replyDraft: generateInterestFollowup(lead, campaign),
    };
  }

  // 11. Default → clarify
  return {
    action: "clarify",
    rationale: ["Could not determine clear action — requesting clarification"],
    replyDraft: generateClarifyReply(lead, "general"),
  };
}

// =============================================================================
// REPLY GENERATION
// =============================================================================

function generateAcceptReply(lead: Lead, rate: number, offerKey: string): string {
  return `That works for us! $${rate} for the ${offerKey.replace(/_/g, " ")} package sounds great.

Let's lock it in. I'll send over a brief agreement with the details. What email should I use?

Looking forward to working together! 🙌`;
}

function generateCounterReply(lead: Lead, rate: number, offerKey: string): string {
  return `Appreciate you sharing your rates!

For this campaign, our budget for the ${offerKey.replace(/_/g, " ")} package is around $${rate}. This includes the deliverables we discussed.

Would that work on your end? Happy to discuss if you have questions about scope.`;
}

function generateClarifyReply(lead: Lead, topic: "usage" | "general"): string {
  if (topic === "usage") {
    return `Thanks for the details!

Quick clarification — for usage rights, we're looking at organic posting only (no paid amplification from our side). Does that align with your terms?

Let me know and we can finalize things.`;
  }

  return `Thanks for getting back to me!

Just want to make sure I understand your requirements correctly. Could you clarify:
- Your rate for the deliverables we discussed
- Any specific terms or timelines you have in mind

Happy to work through the details!`;
}

function generateInfoReply(lead: Lead, campaign: Campaign): string {
  const offer = campaign.offerMenu[0];
  return `Happy to share more details!

For this campaign, we're looking for:
${offer.deliverables.map((d) => `• ${d}`).join("\n")}

Compensation: ~$${offer.baselineUsd || "negotiable"} (flexible based on scope)
Usage: ${offer.usage.replace(/_/g, " ")}

Would this kind of collaboration interest you? Let me know if you have any questions!`;
}

function generateInterestFollowup(lead: Lead, campaign: Campaign): string {
  const offer = campaign.offerMenu[0];
  return `Awesome, glad you're interested! 🎉

Here's what we're thinking:
${offer.deliverables.map((d) => `• ${d}`).join("\n")}

Budget: ~$${offer.baselineUsd || "negotiable"}

Does this align with what you typically do? Let me know your thoughts or if you have a rate card to share.`;
}

// =============================================================================
// ENTRYPOINTS
// =============================================================================

export interface NegotiationContext {
  getState: <T>(key: string) => Promise<T | undefined>;
  setState: (key: string, value: unknown) => Promise<void>;
  log: (message: string) => void;
}

export async function decide_next(
  input: unknown,
  ctx: NegotiationContext
): Promise<NegotiationDecision> {
  const parsed = DecideNextInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid input: ${parsed.error.message}`);
  }

  const { lead, reply, campaign } = parsed.data;
  const decision = decide_next_logic(reply, campaign, lead);

  ctx.log(`Decision for @${lead.handle}: ${decision.action}`);
  ctx.log(`Rationale: ${decision.rationale.join(", ")}`);

  return decision;
}

export async function agentmail_ingest_event(
  input: unknown,
  ctx: NegotiationContext
): Promise<{ lead: Lead | null; reply: ParsedReply; decision: NegotiationDecision | null }> {
  const parsed = AgentMailMessageEvent.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid webhook event: ${parsed.error.message}`);
  }

  const event = parsed.data;
  const message = event.message;

  ctx.log(`Processing email from ${message.from}`);

  // Get leads and find matching one
  const leads = (await ctx.getState<Lead[]>("leads")) || [];
  const lead = leads.find(
    (l) =>
      l.email === message.from ||
      l.threadId === message.thread_id
  );

  // Parse the reply
  const text = message.text || message.preview || "";
  const parsedReply: ParsedReply = {
    ...parseReplyText(text),
    raw: text,
    receivedAt: message.created_at,
  };

  ctx.log(`Parsed intent: ${parsedReply.intent}, rate: ${parsedReply.rateUsd || "none"}`);

  if (!lead) {
    ctx.log(`No matching lead found for ${message.from}`);
    return { lead: null, reply: parsedReply, decision: null };
  }

  // Get campaign and make decision
  const campaign = await ctx.getState<Campaign>("campaign");
  if (!campaign) {
    throw new Error("No campaign configured");
  }

  const decision = decide_next_logic(parsedReply, campaign, lead);

  // Update lead status
  const updatedLead: Lead = {
    ...lead,
    status:
      decision.action === "escalate"
        ? "escalated"
        : decision.action === "pass"
        ? "lost"
        : decision.action === "accept"
        ? "won"
        : "negotiating",
    threadId: message.thread_id,
  };

  // Save updated lead
  const updatedLeads = leads.map((l) =>
    l.xUserId === lead.xUserId ? updatedLead : l
  );
  await ctx.setState("leads", updatedLeads);

  return { lead: updatedLead, reply: parsedReply, decision };
}

export async function agentmail_send_reply(
  input: {
    lead: Lead;
    decision: NegotiationDecision;
    threadId: string;
  },
  ctx: NegotiationContext
): Promise<{ sent: boolean; messageId?: string }> {
  const { lead, decision, threadId } = input;

  if (!decision.replyDraft) {
    ctx.log(`No reply draft for decision: ${decision.action}`);
    return { sent: false };
  }

  const agentmailConfig = await ctx.getState<{
    apiKey: string;
    inboxId: string;
  }>("agentmail");

  if (!agentmailConfig) {
    throw new Error("AgentMail not configured");
  }

  const client = new AgentMailClient({ apiKey: agentmailConfig.apiKey });

  ctx.log(`Sending reply to thread ${threadId}...`);

  const msg = await client.replyToThread(agentmailConfig.inboxId, threadId, {
    text: decision.replyDraft,
  });

  ctx.log(`Reply sent: ${msg.id}`);

  return { sent: true, messageId: msg.id };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const decideEntrypoint = {
  name: "decide_next",
  description: "Deterministic negotiation ladder — accept/counter/clarify/pass/escalate",
  inputSchema: DecideNextInput,
  handler: decide_next,
};

export const ingestEntrypoint = {
  name: "agentmail_ingest_event",
  description: "Handle AgentMail webhook, parse reply, trigger decision",
  inputSchema: AgentMailMessageEvent,
  handler: agentmail_ingest_event,
};

export const sendReplyEntrypoint = {
  name: "agentmail_send_reply",
  description: "Send negotiation reply via AgentMail",
  handler: agentmail_send_reply,
};

export default {
  decide: decideEntrypoint,
  ingest: ingestEntrypoint,
  sendReply: sendReplyEntrypoint,
};
