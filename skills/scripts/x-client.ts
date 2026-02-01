/**
 * X API Client — Rate-limited wrapper for Twitter API v2
 *
 * Handles:
 * - Recent search (bearer token)
 * - User lookup (bearer token)
 * - DM send (user OAuth)
 * - DM conversations (user OAuth)
 * - Exponential backoff on 429
 */

import { z } from "zod";

// =============================================================================
// TYPES
// =============================================================================

export interface XClientConfig {
  bearerToken: string;
  userAccessToken: string;
}

export interface RateLimitState {
  remaining: number;
  reset: number; // Unix timestamp
  limit: number;
}

export const XUser = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  description: z.string().optional(),
  public_metrics: z
    .object({
      followers_count: z.number(),
      following_count: z.number(),
      tweet_count: z.number(),
    })
    .optional(),
  protected: z.boolean().optional(),
});

export type XUser = z.infer<typeof XUser>;

export const XTweet = z.object({
  id: z.string(),
  text: z.string(),
  author_id: z.string(),
  created_at: z.string().optional(),
  public_metrics: z
    .object({
      like_count: z.number(),
      retweet_count: z.number(),
      reply_count: z.number(),
    })
    .optional(),
});

export type XTweet = z.infer<typeof XTweet>;

// =============================================================================
// RATE LIMIT HANDLING
// =============================================================================

function parseRateLimitHeaders(headers: Headers): RateLimitState | null {
  const remaining = headers.get("x-rate-limit-remaining");
  const reset = headers.get("x-rate-limit-reset");
  const limit = headers.get("x-rate-limit-limit");

  if (remaining && reset && limit) {
    return {
      remaining: parseInt(remaining, 10),
      reset: parseInt(reset, 10),
      limit: parseInt(limit, 10),
    };
  }
  return null;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithBackoff(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);

    if (res.status === 429) {
      const rateLimit = parseRateLimitHeaders(res.headers);
      const retryAfter = res.headers.get("retry-after");

      let waitMs: number;
      if (retryAfter) {
        waitMs = parseInt(retryAfter, 10) * 1000;
      } else if (rateLimit) {
        waitMs = Math.max(0, (rateLimit.reset - Date.now() / 1000) * 1000);
      } else {
        // Exponential backoff: 1s, 2s, 4s
        waitMs = Math.pow(2, attempt) * 1000;
      }

      // Add jitter (0-500ms)
      waitMs += Math.random() * 500;

      console.log(`Rate limited. Waiting ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
      continue;
    }

    return res;
  }

  throw lastError || new Error("Max retries exceeded");
}

// =============================================================================
// X CLIENT
// =============================================================================

export class XClient {
  private bearerToken: string;
  private userToken: string;
  private baseUrl = "https://api.twitter.com/2";

  constructor(config: XClientConfig) {
    this.bearerToken = config.bearerToken;
    this.userToken = config.userAccessToken;
  }

  private bearerHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      "Content-Type": "application/json",
    };
  }

  private userHeaders(): HeadersInit {
    // Note: For proper OAuth 2.0 User Context, use the user access token
    // For OAuth 1.0a, you'd need to sign the request (not shown here)
    return {
      Authorization: `Bearer ${this.userToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Search recent tweets (last 7 days)
   * Rate limit: 450 requests / 15 min (app), 180 / 15 min (user)
   */
  async searchRecent(
    query: string,
    options: {
      maxResults?: number;
      nextToken?: string;
    } = {}
  ): Promise<{
    tweets: XTweet[];
    users: Map<string, XUser>;
    nextToken?: string;
  }> {
    const params = new URLSearchParams({
      query,
      max_results: String(Math.min(options.maxResults || 100, 100)),
      "tweet.fields": "author_id,created_at,public_metrics",
      expansions: "author_id",
      "user.fields": "id,username,name,description,public_metrics,protected",
    });

    if (options.nextToken) {
      params.set("next_token", options.nextToken);
    }

    const res = await fetchWithBackoff(
      `${this.baseUrl}/tweets/search/recent?${params}`,
      { headers: this.bearerHeaders() }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X search failed: ${res.status} ${err}`);
    }

    const data = await res.json();

    const tweets: XTweet[] = (data.data || []).map((t: unknown) =>
      XTweet.parse(t)
    );

    const users = new Map<string, XUser>();
    for (const u of data.includes?.users || []) {
      const parsed = XUser.parse(u);
      users.set(parsed.id, parsed);
    }

    return {
      tweets,
      users,
      nextToken: data.meta?.next_token,
    };
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<XUser | null> {
    const params = new URLSearchParams({
      "user.fields": "id,username,name,description,public_metrics,protected",
    });

    const res = await fetchWithBackoff(
      `${this.baseUrl}/users/by/username/${username}?${params}`,
      { headers: this.bearerHeaders() }
    );

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X getUserByUsername failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return data.data ? XUser.parse(data.data) : null;
  }

  /**
   * Get users by IDs (batch)
   */
  async getUsersByIds(ids: string[]): Promise<XUser[]> {
    if (ids.length === 0) return [];

    // Max 100 per request
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) {
      batches.push(ids.slice(i, i + 100));
    }

    const users: XUser[] = [];

    for (const batch of batches) {
      const params = new URLSearchParams({
        ids: batch.join(","),
        "user.fields": "id,username,name,description,public_metrics,protected",
      });

      const res = await fetchWithBackoff(`${this.baseUrl}/users?${params}`, {
        headers: this.bearerHeaders(),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`X getUsersByIds failed: ${res.status} ${err}`);
      }

      const data = await res.json();
      for (const u of data.data || []) {
        users.push(XUser.parse(u));
      }
    }

    return users;
  }

  /**
   * Send DM to user
   * Requires user OAuth — app-only not supported
   */
  async sendDM(participantId: string, text: string): Promise<{ dmId: string }> {
    const res = await fetchWithBackoff(
      `${this.baseUrl}/dm_conversations/with/${participantId}/messages`,
      {
        method: "POST",
        headers: this.userHeaders(),
        body: JSON.stringify({
          text,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X sendDM failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return { dmId: data.data?.dm_event_id || "unknown" };
  }

  /**
   * List DM conversations
   * Requires user OAuth
   */
  async listDMConversations(options: {
    maxResults?: number;
    paginationToken?: string;
  } = {}): Promise<{
    conversations: Array<{
      id: string;
      participantIds: string[];
    }>;
    nextToken?: string;
  }> {
    const params = new URLSearchParams({
      max_results: String(Math.min(options.maxResults || 20, 100)),
      "dm_event.fields": "id,text,created_at,sender_id",
    });

    if (options.paginationToken) {
      params.set("pagination_token", options.paginationToken);
    }

    const res = await fetchWithBackoff(
      `${this.baseUrl}/dm_conversations?${params}`,
      { headers: this.userHeaders() }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X listDMConversations failed: ${res.status} ${err}`);
    }

    const data = await res.json();

    return {
      conversations: (data.data || []).map((c: any) => ({
        id: c.id,
        participantIds: c.participant_ids || [],
      })),
      nextToken: data.meta?.next_token,
    };
  }

  /**
   * Get DM events for a conversation
   */
  async getDMEvents(
    conversationId: string,
    options: { maxResults?: number; paginationToken?: string } = {}
  ): Promise<{
    events: Array<{
      id: string;
      text: string;
      senderId: string;
      createdAt: string;
    }>;
    nextToken?: string;
  }> {
    const params = new URLSearchParams({
      max_results: String(Math.min(options.maxResults || 20, 100)),
      "dm_event.fields": "id,text,created_at,sender_id",
    });

    if (options.paginationToken) {
      params.set("pagination_token", options.paginationToken);
    }

    const res = await fetchWithBackoff(
      `${this.baseUrl}/dm_conversations/${conversationId}/dm_events?${params}`,
      { headers: this.userHeaders() }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X getDMEvents failed: ${res.status} ${err}`);
    }

    const data = await res.json();

    return {
      events: (data.data || []).map((e: any) => ({
        id: e.id,
        text: e.text || "",
        senderId: e.sender_id,
        createdAt: e.created_at,
      })),
      nextToken: data.meta?.next_token,
    };
  }
}

export default XClient;
