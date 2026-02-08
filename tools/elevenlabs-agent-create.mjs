import fs from "node:fs";
import path from "node:path";
import { elevenLabsJson, getElevenLabsConfig } from "./lib/elevenlabs-api.mjs";

const config = getElevenLabsConfig();
const configPath = process.argv[2] || "tools/agent.create.template.json";
const absoluteConfigPath = path.resolve(process.cwd(), configPath);

if (!fs.existsSync(absoluteConfigPath)) {
  throw new Error(`Config file not found: ${absoluteConfigPath}`);
}

const payload = JSON.parse(fs.readFileSync(absoluteConfigPath, "utf8"));
if (!payload.conversation_config || typeof payload.conversation_config !== "object") {
  payload.conversation_config = {};
}

const created = await elevenLabsJson(
  "/v1/convai/agents/create",
  {
    method: "POST",
    body: payload,
  },
  config,
);

console.log(JSON.stringify(created, null, 2));
