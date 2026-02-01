/**
 * plan_outreach + send_outreach + ingest_replies_x — Outreach entrypoints
 *
 * plan_outreach: Route leads to channels (DM, email, public reply)
 * send_outreach: Execute outreach with rate limiting and caps
 * ingest_replies_x: Pull and parse X DM replies
 */

import {
  Lead,
  Campaign,
  PlannedOutreach,
  PlanOutreachInput,
  PlanOutreachOutput,
  SendOutreachInput,
  SendOutreachOutput,
  OutreachChannel,
  ParsedReply,
} from "./schemas.js";
import { XClient } from "./x-client.js";
import { AgentMailClient } from "./agentmail-client.js";
import { parseReplyText } from "./negotiation.js";

// =============================================================================
// TEMPLATES
// =============================================================================

function generateOutreachTemplate(
  lead: Lead,
  campaign: Campaign,
  channel: "x_dm" | "email" | "x_reply"
): string {
  const name = lead.displayName || lead.handle;
  const firstOffer = campaign.offerMenu[0];

  if (channel === "x_dm") {
    return `Hey ${name}! 👋

Saw your content and loved it. We're looking for creators in the ${campaign.topics[0].split(" ")[0]} space for some paid collabs.

Quick overview:
• ${firstOffer.deliverables.join(", ")}
• Competitive rates (starting ~$${firstOffer.baselineUsd || "negotiable"})

Would you be interested in chatting? Happy to share more details!`;
  }

  if (channel === "email") {
    return `Hi ${name},

I came across your work on X (@${lead.handle}) and was impressed by your content.

We're reaching out to select creators for a potential collaboration on ${campaign.name}.

What we're looking for:
${firstOffer.deliverables.map((d) => `• ${d}`).join("\n")}

We offer competitive compensation and flexible terms. Would you be open to a quick chat to discuss?

Looking forward to hearing from you!

Best,
${campaign.name} Team`;
  }

  // x_reply (public)
  return `Hey @${lead.handle}! Love your content 🔥 DM me if you're open to collab opportunities!`;
}

// =============================================================================
// PLAN OUTREACH
// =============================================================================

export interface OutreachContext {
  getState: <T>(key: string) => Promise<T | undefined>;
  setState: (key: string, value: unknown) => Promise<void>;
  log: (message: string) => void;
}

export async function plan_outreach(
  input: unknown,
  ctx: OutreachContext
): Promise<PlanOutreachOutput> {
  const parsed = PlanOutreachInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid input: ${parsed.error.message}`);
  }

  const { leads } = parsed.data;

  const campaign = await ctx.getState<Campaign>("campaign");
  if (!campaign) {
    throw new Error("No campaign configured.");
  }

  const planned: PlannedOutreach[] = [];
  const skipped: Array<{ lead: Lead; reason: string }> = [];

  for (const lead of leads) {
    // Skip already contacted leads
    if (
      lead.status !== "new" &&
      lead.status !== "queued"
    ) {
      skipped.push({ lead, reason: `Already in status: ${lead.status}` });
      continue;
    }

    // Determine channel
    let channel: "x_dm" | "email" | "x_reply";

    if (lead.preferredChannel) {
      channel = lead.preferredChannel;
    } else if (campaign.outreach.preferDmIfOpen && !lead.bio?.includes("protected")) {
      // Assume DMs might be open if not protected
      // Check for signals that DMs are available
      const bioLower = lead.bio?.toLowerCase() || "";
      const dmsLikelyOpen =
        bioLower.includes("dm") ||
        bioLower.includes("open") ||
        bioLower.includes("collab") ||
        bioLower.includes("inquir");

      if (dmsLikelyOpen) {
        channel = "x_dm";
      } else if (lead.email && campaign.outreach.emailEnabled) {
        channel = "email";
      } else {
        channel = "x_reply";
      }
    } else if (lead.email && campaign.outreach.emailEnabled) {
      channel = "email";
    } else {
      channel = "x_reply";
    }

    const template = generateOutreachTemplate(lead, campaign, channel);

    planned.push({
      lead: { ...lead, status: "queued" },
      channel,
      template,
    });
  }

  ctx.log(`Planned ${planned.length} outreach, skipped ${skipped.length}`);

  return { planned, skipped };
}

// =============================================================================
// SEND OUTREACH
// =============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJitterMs(maxMinutes: number): number {
  // Random delay between 0 and maxMinutes (converted to ms)
  return Math.floor(Math.random() * maxMinutes * 60 * 1000);
}

export async function send_outreach(
  input: unknown,
  ctx: OutreachContext
): Promise<SendOutreachOutput> {
  const parsed = SendOutreachInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid input: ${parsed.error.message}`);
  }

  const { planned } = parsed.data;

  const campaign = await ctx.getState<Campaign>("campaign");
  if (!campaign) {
    throw new Error("No campaign configured.");
  }

  const xConfig = await ctx.getState<{
    bearerToken: string;
    userAccessToken: string;
  }>("x");
  if (!xConfig) {
    throw new Error("X credentials not configured.");
  }

  const agentmailConfig = await ctx.getState<{
    apiKey: string;
    inboxId: string;
    inboxEmail: string;
  }>("agentmail");

  // Get and check daily DM cap
  let dailyDmCount = (await ctx.getState<number>("dailyDmCount")) || 0;
  const lastDmDate = await ctx.getState<string>("lastDmDate");
  const today = new Date().toISOString().split("T")[0];

  // Reset count if new day
  if (lastDmDate !== today) {
    dailyDmCount = 0;
    await ctx.setState("lastDmDate", today);
  }

  const existingLeads = (await ctx.getState<Lead[]>("leads")) || [];
  const leadMap = new Map(existingLeads.map((l) => [l.xUserId, l]));

  const xClient = new XClient(xConfig);
  const agentmail = agentmailConfig
    ? new AgentMailClient({ apiKey: agentmailConfig.apiKey })
    : null;

  const results: SendOutreachOutput["results"] = [];
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of planned) {
    const { lead, channel, template } = item;

    try {
      if (channel === "x_dm") {
        // Check DM cap
        if (dailyDmCount >= campaign.outreach.dmDailyCap) {
          ctx.log(`DM cap reached (${dailyDmCount}/${campaign.outreach.dmDailyCap})`);
          skipped++;
          results.push({
            leadHandle: lead.handle,
            channel,
            success: false,
            error: "Daily DM cap reached",
          });
          continue;
        }

        // Apply jitter
        if (dailyDmCount > 0) {
          const jitter = getJitterMs(campaign.outreach.dmJitterMinutes);
          ctx.log(`Jitter delay: ${Math.round(jitter / 1000)}s`);
          await sleep(jitter);
        }

        // Send DM
        ctx.log(`Sending DM to @${lead.handle}...`);
        await xClient.sendDM(lead.xUserId, template);

        dailyDmCount++;
        await ctx.setState("dailyDmCount", dailyDmCount);

        // Update lead
        const updatedLead: Lead = {
          ...lead,
          status: "dm_sent",
          lastContactAt: new Date().toISOString(),
          dmCount: lead.dmCount + 1,
        };
        leadMap.set(lead.xUserId, updatedLead);

        sent++;
        results.push({ leadHandle: lead.handle, channel, success: true });
      } else if (channel === "email") {
        if (!agentmail || !agentmailConfig?.inboxId) {
          skipped++;
          results.push({
            leadHandle: lead.handle,
            channel,
            success: false,
            error: "AgentMail not configured",
          });
          continue;
        }

        if (!lead.email) {
          skipped++;
          results.push({
            leadHandle: lead.handle,
            channel,
            success: false,
            error: "No email address",
          });
          continue;
        }

        ctx.log(`Sending email to ${lead.email}...`);
        const msg = await agentmail.sendMessage(agentmailConfig.inboxId, {
          to: [lead.email],
          subject: `Collaboration opportunity - ${campaign.name}`,
          text: template,
        });

        // Update lead
        const updatedLead: Lead = {
          ...lead,
          status: "email_sent",
          lastContactAt: new Date().toISOString(),
          emailCount: lead.emailCount + 1,
          threadId: msg.thread_id,
        };
        leadMap.set(lead.xUserId, updatedLead);

        sent++;
        results.push({ leadHandle: lead.handle, channel, success: true });
      } else {
        // x_reply — return draft, don't auto-send public replies
        ctx.log(`Public reply draft for @${lead.handle}: ${template}`);

        // Update lead status
        const updatedLead: Lead = {
          ...lead,
          status: "public_replied",
        };
        leadMap.set(lead.xUserId, updatedLead);

        sent++;
        results.push({ leadHandle: lead.handle, channel, success: true });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`@${lead.handle}: ${errorMsg}`);
      results.push({
        leadHandle: lead.handle,
        channel,
        success: false,
        error: errorMsg,
      });
    }
  }

  // Save updated leads
  await ctx.setState("leads", Array.from(leadMap.values()));

  ctx.log(`Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors.length}`);

  return { sent, skipped, errors, results };
}

// =============================================================================
// INGEST X DM REPLIES
// =============================================================================

export interface IngestRepliesXInput {
  since?: string; // ISO datetime, only fetch newer events
}

export interface IngestRepliesXOutput {
  replies: Array<{
    lead: Lead;
    parsed: ParsedReply;
    rawEvent: any;
    receivedAt: string;
  }>;
  lastEventAt?: string;
}

export async function ingest_replies_x(
  input: IngestRepliesXInput,
  ctx: OutreachContext
): Promise<IngestRepliesXOutput> {
  const xConfig = await ctx.getState<{
    bearerToken: string;
    userAccessToken: string;
  }>("x");
  
  if (!xConfig) {
    throw new Error("X credentials not configured.");
  }

  const existingLeads = (await ctx.getState<Lead[]>("leads")) || [];
  const leadByUserId = new Map(existingLeads.map((l) => [l.xUserId, l]));

  // Only check leads that have been contacted via DM
  const dmLeads = existingLeads.filter(
    (l) => l.status === "dm_sent" || l.status === "negotiating"
  );

  if (dmLeads.length === 0) {
    ctx.log("No DM-contacted leads to check for replies");
    return { replies: [] };
  }

  const xClient = new XClient(xConfig);
  const replies: IngestRepliesXOutput["replies"] = [];
  let lastEventAt: string | undefined;

  // For each DM'd lead, check for new messages
  for (const lead of dmLeads) {
    try {
      ctx.log(`Checking DM events for @${lead.handle}...`);

      // Get DM events with this participant
      const { events } = await xClient.getDMEvents(`dm_conversation_${lead.xUserId}`, {
        maxResults: 20,
      });

      for (const event of events) {
        // Skip our own messages
        if (event.senderId !== lead.xUserId) continue;

        // Skip if before 'since' filter
        if (input.since && event.createdAt < input.since) continue;

        // Skip if before lastContactAt (already processed)
        if (lead.lastContactAt && event.createdAt <= lead.lastContactAt) continue;

        // Parse the reply
        const parsedFields = parseReplyText(event.text);
        const parsed: ParsedReply = {
          ...parsedFields,
          raw: event.text,
          receivedAt: event.createdAt,
        };

        replies.push({
          lead,
          parsed,
          rawEvent: event,
          receivedAt: event.createdAt,
        });

        // Track latest event
        if (!lastEventAt || event.createdAt > lastEventAt) {
          lastEventAt = event.createdAt;
        }
      }
    } catch (err) {
      ctx.log(`Error fetching DMs for @${lead.handle}: ${err}`);
      // Continue with other leads
    }
  }

  // Update lead statuses for those who replied
  if (replies.length > 0) {
    const updatedLeads = existingLeads.map((lead) => {
      const reply = replies.find((r) => r.lead.xUserId === lead.xUserId);
      if (reply) {
        return {
          ...lead,
          status: "replied" as const,
          lastContactAt: reply.receivedAt,
        };
      }
      return lead;
    });
    await ctx.setState("leads", updatedLeads);
  }

  ctx.log(`Found ${replies.length} new DM replies`);

  return { replies, lastEventAt };
}

// =============================================================================
// LUCID/DAYDREAMS EXPORTS
// =============================================================================

export const planEntrypoint = {
  name: "plan_outreach",
  description: "Route leads to optimal outreach channel (DM, email, public reply)",
  inputSchema: PlanOutreachInput,
  outputSchema: PlanOutreachOutput,
  handler: plan_outreach,
};

export const sendEntrypoint = {
  name: "send_outreach",
  description: "Execute outreach with rate limiting, jitter, and daily caps",
  inputSchema: SendOutreachInput,
  outputSchema: SendOutreachOutput,
  handler: send_outreach,
};

export const ingestXEntrypoint = {
  name: "ingest_replies_x",
  description: "Pull and parse X DM replies for negotiation",
  handler: ingest_replies_x,
};

export default { 
  plan: planEntrypoint, 
  send: sendEntrypoint,
  ingestX: ingestXEntrypoint,
};
