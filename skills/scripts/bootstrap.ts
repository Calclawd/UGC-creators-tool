/**
 * x_outreach_bootstrap — One-shot setup entrypoint
 *
 * Actions:
 * 1. Validate X credentials (bearer for search, user token for DMs)
 * 2. Create AgentMail inbox if inboxId is empty
 * 3. Register AgentMail webhook pointing to adapter URL
 * 4. Store webhook secret securely
 * 5. Persist campaign config to agent state
 */

import {
  BootstrapPayload,
  BootstrapOutput,
  type Campaign,
} from "./schemas.js";

// =============================================================================
// AGENTMAIL CLIENT (inline for bootstrap)
// =============================================================================

interface AgentMailClient {
  apiKey: string;
  baseUrl: string;
}

async function createInbox(
  client: AgentMailClient,
  displayName: string
): Promise<{ id: string; email: string }> {
  const res = await fetch(`${client.baseUrl}/v0/inboxes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${client.apiKey}`,
    },
    body: JSON.stringify({ display_name: displayName }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AgentMail createInbox failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { id: data.id, email: data.email };
}

async function createWebhook(
  client: AgentMailClient,
  url: string,
  eventTypes: string[]
): Promise<{ id: string; secret: string }> {
  const res = await fetch(`${client.baseUrl}/v0/webhooks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${client.apiKey}`,
    },
    body: JSON.stringify({
      url,
      event_types: eventTypes,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AgentMail createWebhook failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { id: data.id, secret: data.secret };
}

// =============================================================================
// X API VALIDATION
// =============================================================================

async function validateXBearerToken(token: string): Promise<boolean> {
  // Test with a simple search query
  const res = await fetch(
    "https://api.twitter.com/2/tweets/search/recent?query=test&max_results=10",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  // 200 = valid, 401 = invalid, 429 = rate limited but valid
  return res.status === 200 || res.status === 429;
}

async function validateXUserToken(
  bearerToken: string,
  userToken: string
): Promise<boolean> {
  // For user OAuth, we'd typically use OAuth 1.0a or OAuth 2.0 PKCE
  // This is a simplified check — in production, verify with /2/users/me
  // For now, just check the token is non-empty and properly formatted
  if (!userToken || userToken.length < 20) {
    return false;
  }

  // Attempt to get authenticated user info
  // Note: This requires proper OAuth setup — simplified here
  try {
    const res = await fetch("https://api.twitter.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });
    return res.status === 200 || res.status === 429;
  } catch {
    // If OAuth 1.0a is being used, this simple check won't work
    // In that case, we trust the token format
    return userToken.length > 20;
  }
}

// =============================================================================
// BOOTSTRAP ENTRYPOINT
// =============================================================================

export interface BootstrapContext {
  setState: (key: string, value: unknown) => Promise<void>;
  getState: <T>(key: string) => Promise<T | undefined>;
  log: (message: string) => void;
}

export async function x_outreach_bootstrap(
  input: unknown,
  ctx: BootstrapContext
): Promise<BootstrapOutput> {
  const errors: string[] = [];

  // 1. Parse and validate input
  const parsed = BootstrapPayload.safeParse(input);
  if (!parsed.success) {
    return {
      ready: false,
      errors: [`Invalid bootstrap payload: ${parsed.error.message}`],
    };
  }

  const payload = parsed.data;
  ctx.log("Bootstrap payload validated");

  // 2. Validate X credentials
  ctx.log("Validating X bearer token...");
  const bearerValid = await validateXBearerToken(payload.x.bearerToken);
  if (!bearerValid) {
    errors.push("X bearer token is invalid or expired");
  }

  ctx.log("Validating X user token...");
  const userValid = await validateXUserToken(
    payload.x.bearerToken,
    payload.x.userAccessToken
  );
  if (!userValid) {
    errors.push("X user access token appears invalid");
  }

  // 3. Setup AgentMail
  const agentmailClient: AgentMailClient = {
    apiKey: payload.agentmail.apiKey,
    baseUrl: "https://api.agentmail.to",
  };

  let inboxId = payload.agentmail.inboxId || "";
  let inboxEmail = payload.agentmail.inboxEmail || "";
  let webhookId = payload.agentmail.webhook.webhookId || "";
  let webhookSecret = payload.agentmail.webhook.secret || "";

  // Create inbox if not provided
  if (!inboxId) {
    ctx.log("Creating AgentMail inbox...");
    try {
      const inbox = await createInbox(
        agentmailClient,
        `${payload.campaign.name} Outreach`
      );
      inboxId = inbox.id;
      inboxEmail = inbox.email;
      ctx.log(`Inbox created: ${inboxEmail}`);
    } catch (err) {
      errors.push(`Failed to create AgentMail inbox: ${err}`);
    }
  }

  // Create webhook if inbox exists and webhook not provided
  if (inboxId && !webhookId) {
    ctx.log("Registering AgentMail webhook...");
    try {
      const webhook = await createWebhook(
        agentmailClient,
        payload.agentmail.webhook.url,
        payload.agentmail.webhook.eventTypes
      );
      webhookId = webhook.id;
      webhookSecret = webhook.secret;
      ctx.log(`Webhook registered: ${webhookId}`);
    } catch (err) {
      errors.push(`Failed to create AgentMail webhook: ${err}`);
    }
  }

  // 4. Persist state
  if (errors.length === 0) {
    await ctx.setState("campaign", payload.campaign);
    await ctx.setState("x", {
      bearerToken: payload.x.bearerToken,
      userAccessToken: payload.x.userAccessToken,
    });
    await ctx.setState("agentmail", {
      apiKey: payload.agentmail.apiKey,
      inboxId,
      inboxEmail,
      webhookId,
      webhookSecret,
    });
    await ctx.setState("openclaw", payload.openclaw);
    await ctx.setState("leads", []);
    await ctx.setState("dailyDmCount", 0);
    await ctx.setState("lastDmDate", new Date().toISOString().split("T")[0]);

    ctx.log("Bootstrap complete — state persisted");
  }

  return {
    ready: errors.length === 0,
    inboxEmail: inboxEmail || undefined,
    webhookId: webhookId || undefined,
    errors,
  };
}

// =============================================================================
// LUCID/DAYDREAMS EXPORT
// =============================================================================

export const entrypoint = {
  name: "x_outreach_bootstrap",
  description: "One-shot setup: AgentMail inbox + webhook, validate X credentials, store campaign config",
  inputSchema: BootstrapPayload,
  outputSchema: BootstrapOutput,
  handler: x_outreach_bootstrap,
};

export default entrypoint;
