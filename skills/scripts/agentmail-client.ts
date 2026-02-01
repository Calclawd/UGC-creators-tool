/**
 * AgentMail API Client
 *
 * Handles:
 * - Inbox creation
 * - Webhook management
 * - Sending messages
 * - Replying to threads
 */

import { z } from "zod";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentMailClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export const AgentMailInbox = z.object({
  id: z.string(),
  email: z.string().email(),
  display_name: z.string().optional(),
  created_at: z.string().optional(),
});

export type AgentMailInbox = z.infer<typeof AgentMailInbox>;

export const AgentMailWebhook = z.object({
  id: z.string(),
  url: z.string().url(),
  secret: z.string(),
  event_types: z.array(z.string()),
  created_at: z.string().optional(),
});

export type AgentMailWebhook = z.infer<typeof AgentMailWebhook>;

export const AgentMailMessage = z.object({
  id: z.string(),
  inbox_id: z.string(),
  thread_id: z.string().optional(),
  from: z.string(),
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  created_at: z.string().optional(),
});

export type AgentMailMessage = z.infer<typeof AgentMailMessage>;

// =============================================================================
// CLIENT
// =============================================================================

export class AgentMailClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: AgentMailClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.agentmail.to";
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Create a new inbox
   */
  async createInbox(displayName?: string): Promise<AgentMailInbox> {
    const res = await fetch(`${this.baseUrl}/v0/inboxes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        display_name: displayName,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AgentMail createInbox failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return AgentMailInbox.parse(data);
  }

  /**
   * Get inbox by ID
   */
  async getInbox(inboxId: string): Promise<AgentMailInbox | null> {
    const res = await fetch(`${this.baseUrl}/v0/inboxes/${inboxId}`, {
      headers: this.headers(),
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AgentMail getInbox failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return AgentMailInbox.parse(data);
  }

  /**
   * List all inboxes
   */
  async listInboxes(): Promise<AgentMailInbox[]> {
    const res = await fetch(`${this.baseUrl}/v0/inboxes`, {
      headers: this.headers(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AgentMail listInboxes failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return (data.inboxes || data || []).map((i: unknown) =>
      AgentMailInbox.parse(i)
    );
  }

  /**
   * Create a webhook subscription
   */
  async createWebhook(
    url: string,
    eventTypes: string[] = ["message.received"]
  ): Promise<AgentMailWebhook> {
    const res = await fetch(`${this.baseUrl}/v0/webhooks`, {
      method: "POST",
      headers: this.headers(),
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
    return AgentMailWebhook.parse(data);
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v0/webhooks/${webhookId}`, {
      method: "DELETE",
      headers: this.headers(),
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      throw new Error(`AgentMail deleteWebhook failed: ${res.status} ${err}`);
    }
  }

  /**
   * Send a new email from an inbox
   */
  async sendMessage(
    inboxId: string,
    options: {
      to: string[];
      subject: string;
      text?: string;
      html?: string;
      cc?: string[];
      bcc?: string[];
    }
  ): Promise<AgentMailMessage> {
    const res = await fetch(
      `${this.baseUrl}/v0/inboxes/${inboxId}/messages/send`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
          cc: options.cc,
          bcc: options.bcc,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AgentMail sendMessage failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return AgentMailMessage.parse(data);
  }

  /**
   * Reply to an existing thread
   */
  async replyToThread(
    inboxId: string,
    threadId: string,
    options: {
      text?: string;
      html?: string;
    }
  ): Promise<AgentMailMessage> {
    const res = await fetch(
      `${this.baseUrl}/v0/inboxes/${inboxId}/threads/${threadId}/messages`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          text: options.text,
          html: options.html,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AgentMail replyToThread failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return AgentMailMessage.parse(data);
  }

  /**
   * Get thread messages
   */
  async getThread(
    inboxId: string,
    threadId: string
  ): Promise<AgentMailMessage[]> {
    const res = await fetch(
      `${this.baseUrl}/v0/inboxes/${inboxId}/threads/${threadId}/messages`,
      {
        headers: this.headers(),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AgentMail getThread failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return (data.messages || data || []).map((m: unknown) =>
      AgentMailMessage.parse(m)
    );
  }

  /**
   * List recent messages in an inbox
   */
  async listMessages(
    inboxId: string,
    options: { limit?: number } = {}
  ): Promise<AgentMailMessage[]> {
    const params = new URLSearchParams();
    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    const res = await fetch(
      `${this.baseUrl}/v0/inboxes/${inboxId}/messages?${params}`,
      {
        headers: this.headers(),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AgentMail listMessages failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    return (data.messages || data || []).map((m: unknown) =>
      AgentMailMessage.parse(m)
    );
  }
}

export default AgentMailClient;
