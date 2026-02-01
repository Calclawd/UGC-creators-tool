/**
 * X Outreach Agent — Webhook Adapter
 *
 * Standalone Express server that:
 * 1. Receives AgentMail webhook events
 * 2. Verifies Svix signatures (CRITICAL: must use raw body)
 * 3. Dedupes by event_id (AgentMail retries are common)
 * 4. Wakes OpenClaw /hooks/agent with structured payload
 *
 * Deploy separately from the agent — needs public URL for AgentMail.
 *
 * Environment variables:
 * - AGENTMAIL_WEBHOOK_SECRET: Svix signing secret (whsec_...)
 * - OPENCLAW_BASE_URL: OpenClaw instance URL
 * - OPENCLAW_HOOK_TOKEN: Auth token for /hooks/agent
 * - REDIS_URL: Redis connection string (for dedupe)
 * - PORT: Server port (default 3000)
 * - LOG_LEVEL: debug | info | warn | error (default: info)
 */

import express, { Request, Response, NextFunction } from "express";
import { Webhook } from "svix";
import Redis from "ioredis";

// =============================================================================
// CONFIG
// =============================================================================

const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  signingSecret: process.env.AGENTMAIL_WEBHOOK_SECRET || "",
  openclawBaseUrl: process.env.OPENCLAW_BASE_URL || "",
  openclawToken: process.env.OPENCLAW_HOOK_TOKEN || "",
  redisUrl: process.env.REDIS_URL || "",
  logLevel: process.env.LOG_LEVEL || "info",
  // Dedupe TTL: 30 days (in seconds)
  dedupeTtl: 60 * 60 * 24 * 30,
};

function validateConfig(): void {
  const missing: string[] = [];

  if (!config.signingSecret) missing.push("AGENTMAIL_WEBHOOK_SECRET");
  if (!config.openclawBaseUrl) missing.push("OPENCLAW_BASE_URL");
  if (!config.openclawToken) missing.push("OPENCLAW_HOOK_TOKEN");

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("✓ Configuration validated");
}

// =============================================================================
// LOGGING
// =============================================================================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[config.logLevel as keyof typeof LOG_LEVELS] ?? 1;

const log = {
  debug: (...args: unknown[]) => currentLevel <= 0 && console.log("[DEBUG]", ...args),
  info: (...args: unknown[]) => currentLevel <= 1 && console.log("[INFO]", ...args),
  warn: (...args: unknown[]) => currentLevel <= 2 && console.warn("[WARN]", ...args),
  error: (...args: unknown[]) => currentLevel <= 3 && console.error("[ERROR]", ...args),
};

// =============================================================================
// METRICS
// =============================================================================

const metrics = {
  webhooksReceived: 0,
  webhooksVerified: 0,
  webhooksFailed: 0,
  webhooksDeduplicated: 0,
  openclawWakeSuccess: 0,
  openclawWakeFailed: 0,
  startTime: Date.now(),
};

// =============================================================================
// REDIS (optional, for dedupe)
// =============================================================================

let redis: Redis | null = null;

function initRedis(): void {
  if (config.redisUrl) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });
    
    redis.on("error", (err) => {
      log.error("Redis error:", err.message);
    });
    
    redis.on("connect", () => {
      log.info("✓ Redis connected");
    });
    
    redis.on("close", () => {
      log.warn("Redis connection closed");
    });
    
    redis.connect().catch((err) => {
      log.error("Redis connection failed:", err.message);
    });
  } else {
    log.warn("⚠ REDIS_URL not set — dedupe disabled (webhook retries may cause duplicates)");
  }
}

async function isDuplicate(eventId: string): Promise<boolean> {
  if (!redis) return false;

  try {
    const key = `agentmail:event:${eventId}`;
    const exists = await redis.get(key);

    if (exists) {
      metrics.webhooksDeduplicated++;
      return true;
    }

    // Mark as seen
    await redis.set(key, "1", "EX", config.dedupeTtl);
    return false;
  } catch (err) {
    log.error("Redis dedupe error:", err);
    return false; // Continue processing if Redis fails
  }
}

// =============================================================================
// SVIX VERIFICATION
// =============================================================================

interface SvixHeaders {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
}

function extractSvixHeaders(req: Request): SvixHeaders {
  return {
    "svix-id": req.header("svix-id") || "",
    "svix-timestamp": req.header("svix-timestamp") || "",
    "svix-signature": req.header("svix-signature") || "",
  };
}

function verifyWebhook(rawBody: string, headers: SvixHeaders): unknown {
  const wh = new Webhook(config.signingSecret);
  // This throws if verification fails
  return wh.verify(rawBody, headers);
}

// =============================================================================
// OPENCLAW INTEGRATION
// =============================================================================

interface AgentMailEvent {
  event_id: string;
  event_type: string;
  message?: {
    id: string;
    inbox_id: string;
    thread_id: string;
    from: string;
    subject?: string;
    text?: string;
    preview?: string;
  };
}

async function wakeOpenClaw(event: AgentMailEvent): Promise<void> {
  const inboxId = event.message?.inbox_id || "unknown";
  const threadId = event.message?.thread_id || "unknown";

  // Session key ensures thread-level isolation
  const sessionKey = `hook:agentmail:${inboxId}:${threadId}`;

  // Build preview (truncate to 240 chars)
  const preview =
    event.message?.preview ||
    (event.message?.text ? event.message.text.slice(0, 240) : "(no content)");

  const payload = {
    name: "AgentMail",
    sessionKey,
    wakeMode: "now",
    deliver: false,
    message: [
      "AgentMail: new inbound email reply.",
      "",
      `From: ${event.message?.from || "unknown"}`,
      `Subject: ${event.message?.subject || "(no subject)"}`,
      `Thread: ${threadId}`,
      "",
      `Preview:`,
      preview,
      "",
      "Task:",
      "1. Call agentmail_ingest_event with the event data",
      "2. Extract rate/terms + intent from the reply",
      "3. Call decide_next to determine action (accept/counter/clarify/escalate/pass)",
      "4. If action requires reply, call agentmail_send_reply",
    ].join("\n"),
    // Include raw event for the agent to process
    context: {
      event,
    },
  };

  const url = `${config.openclawBaseUrl}/hooks/agent`;

  log.info(`Waking OpenClaw: ${url}`);
  log.debug(`Session: ${sessionKey}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openclawToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    metrics.openclawWakeFailed++;
    throw new Error(`OpenClaw wake failed: ${res.status} ${err}`);
  }

  metrics.openclawWakeSuccess++;
  log.info(`✓ OpenClaw woke successfully`);
}

// =============================================================================
// EXPRESS APP
// =============================================================================

const app = express();

// Health check (before raw body parser)
app.get("/health", (_req, res) => {
  const healthy = !redis || redis.status === "ready" || redis.status === "connecting";
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - metrics.startTime) / 1000),
    redis: redis ? redis.status : "disabled",
  });
});

// Metrics endpoint
app.get("/metrics", (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - metrics.startTime) / 1000);
  
  // Prometheus-style metrics
  const lines = [
    "# HELP webhook_received_total Total webhooks received",
    "# TYPE webhook_received_total counter",
    `webhook_received_total ${metrics.webhooksReceived}`,
    "",
    "# HELP webhook_verified_total Webhooks with valid signatures",
    "# TYPE webhook_verified_total counter",
    `webhook_verified_total ${metrics.webhooksVerified}`,
    "",
    "# HELP webhook_failed_total Webhooks that failed processing",
    "# TYPE webhook_failed_total counter",
    `webhook_failed_total ${metrics.webhooksFailed}`,
    "",
    "# HELP webhook_deduplicated_total Duplicate webhooks skipped",
    "# TYPE webhook_deduplicated_total counter",
    `webhook_deduplicated_total ${metrics.webhooksDeduplicated}`,
    "",
    "# HELP openclaw_wake_success_total Successful OpenClaw wakes",
    "# TYPE openclaw_wake_success_total counter",
    `openclaw_wake_success_total ${metrics.openclawWakeSuccess}`,
    "",
    "# HELP openclaw_wake_failed_total Failed OpenClaw wakes",
    "# TYPE openclaw_wake_failed_total counter",
    `openclaw_wake_failed_total ${metrics.openclawWakeFailed}`,
    "",
    "# HELP uptime_seconds Server uptime in seconds",
    "# TYPE uptime_seconds gauge",
    `uptime_seconds ${uptimeSeconds}`,
  ];
  
  res.set("Content-Type", "text/plain");
  res.send(lines.join("\n"));
});

// JSON stats endpoint (for dashboards)
app.get("/stats", (_req, res) => {
  res.json({
    ...metrics,
    uptimeSeconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    redis: redis ? redis.status : "disabled",
  });
});

// Webhook endpoint — MUST use raw body for Svix verification
app.post(
  "/webhooks/agentmail",
  express.raw({ type: "*/*" }),
  async (req: Request, res: Response, _next: NextFunction) => {
    metrics.webhooksReceived++;
    
    try {
      // 1. Get raw body as string
      const rawBody = req.body.toString("utf8");

      if (!rawBody) {
        log.warn("Empty webhook body received");
        metrics.webhooksFailed++;
        return res.status(400).json({ error: "Empty body" });
      }

      // 2. Extract Svix headers
      const headers = extractSvixHeaders(req);

      if (!headers["svix-id"] || !headers["svix-timestamp"] || !headers["svix-signature"]) {
        log.warn("Missing Svix headers");
        metrics.webhooksFailed++;
        return res.status(400).json({ error: "Missing Svix headers" });
      }

      // 3. Verify signature (throws if invalid)
      let event: AgentMailEvent;
      try {
        event = verifyWebhook(rawBody, headers) as AgentMailEvent;
        metrics.webhooksVerified++;
      } catch (err) {
        log.error("Svix verification failed:", err);
        metrics.webhooksFailed++;
        return res.status(401).json({ error: "Invalid signature" });
      }

      log.info(`Received event: ${event.event_type} (${event.event_id})`);

      // 4. Dedupe check
      const eventId = event.event_id || `fallback-${Date.now()}`;
      if (await isDuplicate(eventId)) {
        log.info(`Duplicate event ${eventId} — skipping`);
        return res.status(204).end();
      }

      // 5. Only process message.received events
      if (event.event_type !== "message.received") {
        log.debug(`Ignoring event type: ${event.event_type}`);
        return res.status(204).end();
      }

      // 6. Wake OpenClaw
      await wakeOpenClaw(event);

      // 7. Success — return 204 (no content)
      return res.status(204).end();
    } catch (err) {
      log.error("Webhook processing error:", err);
      metrics.webhooksFailed++;
      // Return 500 so AgentMail retries
      return res.status(500).json({ error: "Internal error" });
    }
  }
);

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  log.info(`\n${signal} received — shutting down gracefully...`);
  
  // Close Redis
  if (redis) {
    log.info("Closing Redis connection...");
    await redis.quit().catch(() => {});
  }
  
  log.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// =============================================================================
// START SERVER
// =============================================================================

function start(): void {
  console.log("=".repeat(60));
  console.log("X Outreach Agent — Webhook Adapter");
  console.log("=".repeat(60));

  validateConfig();
  initRedis();

  const server = app.listen(config.port, () => {
    log.info(`✓ Server listening on port ${config.port}`);
    console.log("");
    console.log("Endpoints:");
    console.log(`  POST /webhooks/agentmail — AgentMail webhook receiver`);
    console.log(`  GET  /health             — Health check`);
    console.log(`  GET  /metrics            — Prometheus metrics`);
    console.log(`  GET  /stats              — JSON stats`);
    console.log("");
    console.log("Ready to receive webhooks!");
  });
  
  // Handle server errors
  server.on("error", (err) => {
    log.error("Server error:", err);
    process.exit(1);
  });
}

start();
