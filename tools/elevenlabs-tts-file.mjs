import fs from "node:fs";
import path from "node:path";
import { elevenLabsAudio, getElevenLabsConfig } from "./lib/elevenlabs-api.mjs";

const text = process.argv[2] || "";
const outputPathArg = process.argv[3] || `outputs/tts-${Date.now()}.mp3`;
const voiceIdArg = process.argv[4] || "";

if (!text.trim()) {
  console.error("Usage: npm run tts -- \"Hello world\" [outputPath] [voiceId]");
  process.exit(1);
}

const config = getElevenLabsConfig();
const voiceId = voiceIdArg || config.defaultVoiceId;

if (!voiceId) {
  throw new Error("Missing voice ID. Set ELEVENLABS_VOICE_ID in .env or pass it as the 3rd argument.");
}

const outputPath = path.resolve(process.cwd(), outputPathArg);

const response = await elevenLabsAudio(
  `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
  {
    method: "POST",
    query: {
      output_format: config.defaultTtsOutputFormat,
    },
    body: {
      text,
      model_id: config.defaultTtsModelId,
    },
  },
  config,
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, response.buffer);

console.log(
  JSON.stringify(
    {
      outputPath,
      bytes: response.buffer.length,
      voiceId,
      modelId: config.defaultTtsModelId,
      outputFormat: config.defaultTtsOutputFormat,
      contentType: response.contentType,
    },
    null,
    2,
  ),
);
