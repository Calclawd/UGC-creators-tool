/**
 * X Outreach Agent — Main Index
 *
 * Exports all entrypoints for Lucid/Daydreams integration.
 */

// Schemas
export * from "./schemas.js";

// Clients
export { XClient, XUser, XTweet } from "./x-client.js";
export { AgentMailClient, AgentMailInbox, AgentMailMessage } from "./agentmail-client.js";

// Entrypoints
export { x_outreach_bootstrap, entrypoint as bootstrapEntrypoint } from "./bootstrap.js";
export { discover_leads, entrypoint as discoveryEntrypoint } from "./discovery.js";
export { plan_outreach, send_outreach, ingest_replies_x, planEntrypoint, sendEntrypoint, ingestXEntrypoint } from "./outreach.js";
export {
  decide_next,
  agentmail_ingest_event,
  agentmail_send_reply,
  parseReplyText,
  decide_next_logic,
  decideEntrypoint,
  ingestEntrypoint,
  sendReplyEntrypoint,
} from "./negotiation.js";

// All entrypoints array for registration
export const entrypoints = [
  // From bootstrap
  { name: "x_outreach_bootstrap", module: "./bootstrap.js" },
  // From discovery
  { name: "discover_leads", module: "./discovery.js" },
  // From outreach
  { name: "plan_outreach", module: "./outreach.js" },
  { name: "send_outreach", module: "./outreach.js" },
  { name: "ingest_replies_x", module: "./outreach.js" },
  // From negotiation
  { name: "decide_next", module: "./negotiation.js" },
  { name: "agentmail_ingest_event", module: "./negotiation.js" },
  { name: "agentmail_send_reply", module: "./negotiation.js" },
];

export default entrypoints;
