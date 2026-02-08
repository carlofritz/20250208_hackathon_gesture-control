import { elevenLabsJson, getElevenLabsConfig } from "./lib/elevenlabs-api.mjs";

function getFlagValue(flagName) {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return "";
  }

  return process.argv[index + 1] || "";
}

const config = getElevenLabsConfig();
const argAgentId = process.argv[2] || "";
const branchId = getFlagValue("--branch-id");
const includeConversationId = process.argv.includes("--include-conversation-id");

const agentId = argAgentId || config.defaultAgentId;
if (!agentId) {
  throw new Error("Missing agent_id. Set ELEVENLABS_AGENT_ID in .env or pass it as the first argument.");
}

const query = {
  agent_id: agentId,
};

if (branchId) {
  query.branch_id = branchId;
}

if (includeConversationId) {
  query.include_conversation_id = "true";
}

const result = await elevenLabsJson(
  "/v1/convai/conversation/get-signed-url",
  {
    method: "GET",
    query,
  },
  config,
);

console.log(JSON.stringify(result, null, 2));
