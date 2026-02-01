#!/usr/bin/env node
/**
 * X Outreach Webhook — Test Script
 *
 * Tests the webhook adapter locally by simulating AgentMail webhook events.
 * Does NOT verify Svix signatures (use for development only).
 *
 * Usage:
 *   npx tsx test-webhook.ts
 *   npx tsx test-webhook.ts --url https://your-deployed-url.com
 */

const WEBHOOK_URL = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "http://localhost:3000/webhooks/agentmail";

// Simulated AgentMail event (message.received)
const mockEvent = {
  event_id: `test-${Date.now()}`,
  event_type: "message.received",
  timestamp: new Date().toISOString(),
  message: {
    id: `msg-${Date.now()}`,
    inbox_id: "inbox-test-123",
    thread_id: "thread-test-456",
    from: "creator@example.com",
    to: ["agent@yourdomain.agentmail.to"],
    subject: "Re: Collaboration opportunity",
    text: "Hey! Thanks for reaching out. My rate is $800 for a thread with follow-up posts. Let me know if that works!",
    preview: "Hey! Thanks for reaching out. My rate is $800...",
    created_at: new Date().toISOString(),
  },
};

async function testHealth() {
  console.log("Testing health endpoint...");
  const healthUrl = WEBHOOK_URL.replace("/webhooks/agentmail", "/health");
  
  try {
    const res = await fetch(healthUrl);
    const data = await res.json();
    console.log(`✓ Health check: ${res.status}`, data);
    return true;
  } catch (err) {
    console.error(`✗ Health check failed:`, err);
    return false;
  }
}

async function testWebhookNoSignature() {
  console.log("\nTesting webhook without signature (should fail 400/401)...");
  
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(mockEvent),
    });
    
    if (res.status === 400 || res.status === 401) {
      console.log(`✓ Correctly rejected unsigned request: ${res.status}`);
      return true;
    } else {
      console.warn(`⚠ Unexpected response: ${res.status}`);
      return false;
    }
  } catch (err) {
    console.error(`✗ Request failed:`, err);
    return false;
  }
}

async function testWebhookWithMockSignature() {
  console.log("\nTesting webhook with mock Svix headers (should fail 401)...");
  
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_test123",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,invalid_signature_for_testing",
      },
      body: JSON.stringify(mockEvent),
    });
    
    if (res.status === 401) {
      console.log(`✓ Correctly rejected invalid signature: ${res.status}`);
      return true;
    } else {
      console.warn(`⚠ Unexpected response: ${res.status}`);
      const text = await res.text();
      console.log(`   Response: ${text}`);
      return false;
    }
  } catch (err) {
    console.error(`✗ Request failed:`, err);
    return false;
  }
}

async function main() {
  console.log("=" .repeat(60));
  console.log("X Outreach Webhook — Test Script");
  console.log("=" .repeat(60));
  console.log(`Target: ${WEBHOOK_URL}\n`);
  
  const results = {
    health: await testHealth(),
    noSignature: await testWebhookNoSignature(),
    invalidSignature: await testWebhookWithMockSignature(),
  };
  
  console.log("\n" + "=".repeat(60));
  console.log("Results:");
  console.log("=".repeat(60));
  
  let passed = 0;
  let total = 0;
  
  for (const [test, result] of Object.entries(results)) {
    total++;
    if (result) passed++;
    console.log(`  ${result ? "✓" : "✗"} ${test}`);
  }
  
  console.log(`\n${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log("\n✓ Webhook adapter is working correctly!");
    console.log("  - Health endpoint responds");
    console.log("  - Unsigned requests rejected");
    console.log("  - Invalid signatures rejected");
    console.log("\nTo test with real webhooks:");
    console.log("  1. Set AGENTMAIL_WEBHOOK_SECRET in your environment");
    console.log("  2. Register this URL with AgentMail");
    console.log("  3. Send a test email to your AgentMail inbox");
  } else {
    console.log("\n⚠ Some tests failed. Check the webhook adapter logs.");
    process.exit(1);
  }
}

main().catch(console.error);
