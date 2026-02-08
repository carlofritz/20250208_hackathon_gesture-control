import fs from "node:fs";
import path from "node:path";
import {
  elevenLabsJson,
  getElevenLabsConfig,
  inferMimeTypeFromPath,
} from "./lib/elevenlabs-api.mjs";

const audioPathArg = process.argv[2] || "";
const outputJsonArg = process.argv[3] || "";

if (!audioPathArg) {
  console.error("Usage: npm run stt -- <audioFilePath> [outputJsonPath]");
  process.exit(1);
}

const audioPath = path.resolve(process.cwd(), audioPathArg);
if (!fs.existsSync(audioPath)) {
  throw new Error(`Audio file not found: ${audioPath}`);
}

const config = getElevenLabsConfig();
const audioBuffer = fs.readFileSync(audioPath);
const mimeType = inferMimeTypeFromPath(audioPath);

const form = new FormData();
form.append("model_id", config.defaultSttModelId);
if (config.defaultLanguageCode) {
  form.append("language_code", config.defaultLanguageCode);
}
form.append("file", new Blob([audioBuffer], { type: mimeType }), path.basename(audioPath));

const result = await elevenLabsJson(
  "/v1/speech-to-text",
  {
    method: "POST",
    body: form,
  },
  config,
);

if (outputJsonArg) {
  const outputPath = path.resolve(process.cwd(), outputJsonArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
}

console.log(JSON.stringify(result, null, 2));
