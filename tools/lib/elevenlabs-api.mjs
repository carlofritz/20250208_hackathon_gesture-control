import path from "node:path";
import { loadEnv, requireEnv } from "./env.mjs";

const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function buildUrl(pathOrUrl, baseUrl, query) {
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? new URL(pathOrUrl)
    : new URL(pathOrUrl.replace(/^\/+/, ""), `${baseUrl}/`);

  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function createApiError(response, textBody) {
  const suffix = textBody ? `: ${textBody.slice(0, 500)}` : "";
  const error = new Error(
    `ElevenLabs request failed (${response.status} ${response.statusText})${suffix}`,
  );
  error.status = response.status;
  error.responseBody = textBody;
  return error;
}

function isFormData(body) {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function withAuthHeaders(config, headers) {
  return {
    "xi-api-key": config.apiKey,
    ...(headers || {}),
  };
}

export function getElevenLabsConfig() {
  loadEnv();
  requireEnv(["ELEVENLABS_API_KEY"]);

  return {
    apiKey: process.env.ELEVENLABS_API_KEY,
    baseUrl: normalizeBaseUrl(process.env.ELEVENLABS_BASE_URL),
    defaultAgentId: String(process.env.ELEVENLABS_AGENT_ID || "").trim(),
    defaultVoiceId: String(process.env.ELEVENLABS_VOICE_ID || "").trim(),
    defaultTtsModelId: String(process.env.ELEVENLABS_TTS_MODEL_ID || "eleven_multilingual_v2").trim(),
    defaultTtsOutputFormat: String(process.env.ELEVENLABS_TTS_OUTPUT_FORMAT || "mp3_44100_128").trim(),
    defaultSttModelId: String(process.env.ELEVENLABS_STT_MODEL_ID || "scribe_v1").trim(),
    defaultLanguageCode: String(process.env.ELEVENLABS_STT_LANGUAGE_CODE || "").trim(),
  };
}

export async function elevenLabsJson(pathOrUrl, options = {}, providedConfig = null) {
  const config = providedConfig || getElevenLabsConfig();
  const method = options.method || "GET";
  const url = buildUrl(pathOrUrl, config.baseUrl, options.query);

  let body = options.body;
  const headers = withAuthHeaders(config, options.headers);

  if (body !== undefined && body !== null && !isFormData(body) && typeof body === "object") {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw createApiError(response, text);
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

export async function elevenLabsAudio(pathOrUrl, options = {}, providedConfig = null) {
  const config = providedConfig || getElevenLabsConfig();
  const method = options.method || "POST";
  const url = buildUrl(pathOrUrl, config.baseUrl, options.query);

  let body = options.body;
  const headers = withAuthHeaders(config, options.headers);

  if (body !== undefined && body !== null && !isFormData(body) && typeof body === "object") {
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw createApiError(response, text);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

export function inferMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}
