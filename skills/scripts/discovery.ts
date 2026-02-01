/**
 * discover_leads — Lead discovery entrypoint
 *
 * Actions:
 * 1. Build query from campaign topics + exclusions
 * 2. Search X recent tweets (7-day window)
 * 3. Extract unique users, fetch profiles
 * 4. Score leads based on signals
 * 5. Dedupe against existing leads
 * 6. Return sorted by score
 */

import {
  Lead,
  Campaign,
  DiscoverLeadsInput,
  DiscoverLeadsOutput,
} from "./schemas.js";
import { XClient, XUser } from "./x-client.js";

// =============================================================================
// QUERY BUILDER
// =============================================================================

function buildSearchQuery(campaign: Campaign, customQuery?: string): string {
  if (customQuery) {
    return customQuery;
  }

  // Combine topics with OR
  const topicPart = campaign.topics.map((t) => `(${t})`).join(" OR ");

  // Add exclusions
  const exclusions = campaign.antiTopics.map((t) => `-${t}`).join(" ");

  // Exclude retweets and replies for cleaner results
  const filters = "-is:retweet -is:reply";

  return `${topicPart} ${exclusions} ${filters}`.trim();
}

// =============================================================================
// LEAD SCORING
// =============================================================================

interface ScoringContext {
  creatorSignals: string[];
}

function scoreLead(
  user: XUser,
  tweetText: string,
  ctx: ScoringContext
): { score: number; reasons: string[] } {
  let score = 50; // Base score
  const reasons: string[] = [];

  const bio = user.description?.toLowerCase() || "";
  const combinedText = `${bio} ${tweetText}`.toLowerCase();

  // Creator signals in bio
  for (const signal of ctx.creatorSignals) {
    if (bio.includes(signal.toLowerCase())) {
      score += 15;
      reasons.push(`Bio contains "${signal}"`);
    }
  }

  // Follower count signals
  const followers = user.public_metrics?.followers_count || 0;
  if (followers >= 100_000) {
    score += 20;
    reasons.push("100K+ followers");
  } else if (followers >= 10_000) {
    score += 15;
    reasons.push("10K+ followers");
  } else if (followers >= 1_000) {
    score += 10;
    reasons.push("1K+ followers");
  } else if (followers < 500) {
    score -= 10;
    reasons.push("Low follower count");
  }

  // Engagement ratio (followers to following)
  const following = user.public_metrics?.following_count || 1;
  const ratio = followers / following;
  if (ratio > 10) {
    score += 10;
    reasons.push("Strong follower ratio");
  } else if (ratio < 0.5) {
    score -= 5;
    reasons.push("Low follower ratio");
  }

  // DM availability signals
  if (bio.includes("dms open") || bio.includes("dm open")) {
    score += 10;
    reasons.push("DMs open");
  }
  if (bio.includes("collab") || bio.includes("partnership")) {
    score += 10;
    reasons.push("Open to collabs");
  }

  // Protected account (can't DM without following)
  if (user.protected) {
    score -= 20;
    reasons.push("Protected account");
  }

  // Email in bio
  if (bio.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i)) {
    score += 5;
    reasons.push("Email in bio");
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}

function extractEmailFromBio(bio: string): string | undefined {
  const match = bio.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
  return match ? match[1] : undefined;
}

// =============================================================================
// DISCOVERY ENTRYPOINT
// =============================================================================

export interface DiscoveryContext {
  getState: <T>(key: string) => Promise<T | undefined>;
  setState: (key: string, value: unknown) => Promise<void>;
  log: (message: string) => void;
}

export async function discover_leads(
  input: unknown,
  ctx: DiscoveryContext
): Promise<DiscoverLeadsOutput> {
  // Parse input
  const parsed = DiscoverLeadsInput.safeParse(input);
  const maxResults = parsed.success ? parsed.data.maxResults : 50;
  const customQuery = parsed.success ? parsed.data.customQuery : undefined;

  // Get state
  const campaign = await ctx.getState<Campaign>("campaign");
  if (!campaign) {
    throw new Error("No campaign configured. Run x_outreach_bootstrap first.");
  }

  const xConfig = await ctx.getState<{
    bearerToken: string;
    userAccessToken: string;
  }>("x");
  if (!xConfig) {
    throw new Error("X credentials not configured.");
  }

  const existingLeads = (await ctx.getState<Lead[]>("leads")) || [];
  const existingHandles = new Set(existingLeads.map((l) => l.handle.toLowerCase()));

  // Build query
  const query = buildSearchQuery(campaign, customQuery);
  ctx.log(`Search query: ${query}`);

  // Search
  const xClient = new XClient(xConfig);
  const { tweets, users } = await xClient.searchRecent(query, {
    maxResults: Math.min(maxResults * 2, 100), // Fetch extra to account for dedupe
  });

  ctx.log(`Found ${tweets.length} tweets from ${users.size} unique users`);

  // Score and dedupe
  const newLeads: Lead[] = [];
  const seenUserIds = new Set<string>();

  for (const tweet of tweets) {
    const userId = tweet.author_id;
    if (seenUserIds.has(userId)) continue;
    seenUserIds.add(userId);

    const user = users.get(userId);
    if (!user) continue;

    // Skip if already in leads
    if (existingHandles.has(user.username.toLowerCase())) {
      continue;
    }

    const { score, reasons } = scoreLead(tweet.text, user.description || "", {
      creatorSignals: campaign.creatorSignals,
    });

    const email = extractEmailFromBio(user.description || "");

    const lead: Lead = {
      xUserId: userId,
      handle: user.username,
      displayName: user.name,
      bio: user.description,
      recentPostId: tweet.id,
      email,
      score,
      reasons,
      status: "new",
      dmCount: 0,
      emailCount: 0,
    };

    newLeads.push(lead);
  }

  // Sort by score descending
  newLeads.sort((a, b) => b.score - a.score);

  // Limit results
  const results = newLeads.slice(0, maxResults);

  // Merge with existing leads and save
  const allLeads = [...existingLeads, ...results];
  await ctx.setState("leads", allLeads);

  ctx.log(`Discovered ${results.length} new leads`);

  return {
    leads: results,
    query,
    total: results.length,
  };
}

// =============================================================================
// LUCID/DAYDREAMS EXPORT
// =============================================================================

export const entrypoint = {
  name: "discover_leads",
  description: "Search X for leads matching campaign topics, score and dedupe",
  inputSchema: DiscoverLeadsInput,
  outputSchema: DiscoverLeadsOutput,
  handler: discover_leads,
};

export default entrypoint;
