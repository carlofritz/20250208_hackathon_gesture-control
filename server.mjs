import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loadEnv, getIntegerEnv } from "./tools/lib/env.mjs";
import {
  elevenLabsAudio,
  elevenLabsJson,
  getElevenLabsConfig,
} from "./tools/lib/elevenlabs-api.mjs";

loadEnv();

const ROOT_DIR = process.cwd();
const PORT = getIntegerEnv("PORT", 4173);
const MAX_JSON_BODY_BYTES = getIntegerEnv("MAX_JSON_BODY_BYTES", 25 * 1024 * 1024);
const BRIDGE_COMMAND_TIMEOUT_MS = getIntegerEnv("BRIDGE_COMMAND_TIMEOUT_MS", 15_000);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response, statusCode, body) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body) {
  setCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

function resolveStaticPath(pathname) {
  let relativePath = pathname;

  if (relativePath === "/") {
    relativePath = "/index.html";
  }

  const decoded = decodeURIComponent(relativePath);
  const normalized = path.normalize(decoded).replace(/^[/\\]+/, "");
  const absolutePath = path.resolve(ROOT_DIR, normalized);

  if (!absolutePath.startsWith(ROOT_DIR)) {
    return "";
  }

  return absolutePath;
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        const error = new Error("Request body too large.");
        error.status = 413;
        reject(error);
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed);
      } catch (_error) {
        const error = new Error("Invalid JSON body.");
        error.status = 400;
        reject(error);
      }
    });

    request.on("error", (error) => reject(error));
  });
}

function decodeBase64(input) {
  const value = String(input || "").trim();
  const cleaned = value.includes(",") ? value.split(",").pop() : value;
  return Buffer.from(cleaned || "", "base64");
}

function normalizeBridgeSessionId(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "default";
  }
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
  return cleaned || "default";
}

const bridgeSessions = new Map();

function getBridgeSession(sessionId) {
  const normalized = normalizeBridgeSessionId(sessionId);
  if (!bridgeSessions.has(normalized)) {
    bridgeSessions.set(normalized, {
      helperClients: new Set(),
      pendingCommands: new Map(),
      updatedAt: Date.now(),
    });
  }
  return bridgeSessions.get(normalized);
}

function cleanupBridgeSessionIfIdle(sessionId) {
  const normalized = normalizeBridgeSessionId(sessionId);
  const session = bridgeSessions.get(normalized);
  if (!session) {
    return;
  }
  if (session.helperClients.size > 0 || session.pendingCommands.size > 0) {
    return;
  }
  bridgeSessions.delete(normalized);
}

function getBridgeSessionSnapshot(sessionId) {
  const session = getBridgeSession(sessionId);
  return {
    sessionId: normalizeBridgeSessionId(sessionId),
    helpersConnected: session.helperClients.size,
    pendingCommands: session.pendingCommands.size,
    updatedAt: session.updatedAt,
  };
}

function sendSseEvent(response, eventType, payload) {
  response.write(`event: ${eventType}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function registerPendingBridgeCommand(sessionId, commandId) {
  const session = getBridgeSession(sessionId);
  const normalizedCommandId = String(commandId || "").trim();
  if (!normalizedCommandId) {
    const error = new Error("Missing command id.");
    error.status = 400;
    throw error;
  }
  if (session.pendingCommands.has(normalizedCommandId)) {
    const error = new Error(`Duplicate command id: ${normalizedCommandId}`);
    error.status = 409;
    throw error;
  }

  session.updatedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.pendingCommands.delete(normalizedCommandId);
      session.updatedAt = Date.now();
      const error = new Error("Remote helper timed out waiting for result.");
      error.status = 504;
      reject(error);
      cleanupBridgeSessionIfIdle(sessionId);
    }, BRIDGE_COMMAND_TIMEOUT_MS);

    session.pendingCommands.set(normalizedCommandId, {
      resolve,
      reject,
      timeout,
      createdAt: Date.now(),
    });
  });
}

function resolvePendingBridgeCommand(sessionId, commandId, resultPayload) {
  const session = getBridgeSession(sessionId);
  const pending = session.pendingCommands.get(commandId);
  if (!pending) {
    return false;
  }

  clearTimeout(pending.timeout);
  session.pendingCommands.delete(commandId);
  session.updatedAt = Date.now();
  pending.resolve(resultPayload);
  cleanupBridgeSessionIfIdle(sessionId);
  return true;
}

function broadcastBridgeCommand(sessionId, commandEnvelope) {
  const session = getBridgeSession(sessionId);
  session.updatedAt = Date.now();
  for (const helperResponse of session.helperClients) {
    try {
      sendSseEvent(helperResponse, "command", commandEnvelope);
    } catch {
      // Ignore broken stream; close handler cleans up.
    }
  }
}

async function handleBridgeRequest(request, response, url) {
  const method = request.method || "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/bridge/status") {
    const sessionId = normalizeBridgeSessionId(url.searchParams.get("session"));
    sendJson(response, 200, {
      ok: true,
      ...getBridgeSessionSnapshot(sessionId),
    });
    return true;
  }

  if (method === "GET" && pathname === "/api/bridge/stream") {
    const sessionId = normalizeBridgeSessionId(url.searchParams.get("session"));
    const session = getBridgeSession(sessionId);

    setCorsHeaders(response);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    if (typeof response.flushHeaders === "function") {
      response.flushHeaders();
    }

    session.helperClients.add(response);
    session.updatedAt = Date.now();
    sendSseEvent(response, "ready", {
      ok: true,
      ...getBridgeSessionSnapshot(sessionId),
    });

    const pingInterval = setInterval(() => {
      try {
        sendSseEvent(response, "ping", { timestamp: new Date().toISOString() });
      } catch {
        // Close handler will clean up.
      }
    }, 10_000);

    const cleanup = () => {
      clearInterval(pingInterval);
      session.helperClients.delete(response);
      session.updatedAt = Date.now();
      cleanupBridgeSessionIfIdle(sessionId);
    };

    request.on("close", cleanup);
    response.on("close", cleanup);
    response.on("error", cleanup);
    return true;
  }

  if (method === "POST" && pathname === "/api/bridge/command") {
    const body = await readJsonBody(request);
    const sessionId = normalizeBridgeSessionId(body.sessionId || body.targetSessionId);
    const session = getBridgeSession(sessionId);
    if (session.helperClients.size < 1) {
      sendJson(response, 409, {
        error: `No target helper connected for session "${sessionId}".`,
      });
      return true;
    }

    const command = body.command && typeof body.command === "object"
      ? { ...body.command }
      : {};
    if (!command.action) {
      sendJson(response, 400, { error: "Missing command.action." });
      return true;
    }

    command.id = String(command.id || `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    command.timestamp = command.timestamp || new Date().toISOString();
    command.sessionId = sessionId;

    try {
      const pendingResultPromise = registerPendingBridgeCommand(sessionId, command.id);
      broadcastBridgeCommand(sessionId, {
        sessionId,
        command,
      });
      const result = await pendingResultPromise;
      sendJson(response, 200, {
        ok: true,
        sessionId,
        commandId: command.id,
        result,
      });
      return true;
    } catch (error) {
      sendJson(response, error.status || 500, {
        error: error.message || "Remote command failed.",
      });
      return true;
    }
  }

  if (method === "POST" && pathname === "/api/bridge/result") {
    const body = await readJsonBody(request);
    const sessionId = normalizeBridgeSessionId(body.sessionId || body.targetSessionId);
    const commandId = String(body.commandId || body.id || "").trim();
    if (!commandId) {
      sendJson(response, 400, { error: "Missing commandId." });
      return true;
    }

    const accepted = resolvePendingBridgeCommand(
      sessionId,
      commandId,
      body.result ?? body,
    );
    if (!accepted) {
      sendJson(response, 404, {
        error: `No pending command found for id "${commandId}" in session "${sessionId}".`,
      });
      return true;
    }

    sendJson(response, 200, {
      ok: true,
      sessionId,
      commandId,
    });
    return true;
  }

  return false;
}

async function handleApiRequest(request, response, url) {
  const method = request.method || "GET";
  const pathname = url.pathname;

  if (pathname.startsWith("/api/bridge/")) {
    return handleBridgeRequest(request, response, url);
  }

  let config;
  try {
    config = getElevenLabsConfig();
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message,
    });
    return true;
  }

  try {
    if (method === "GET" && pathname === "/api/elevenlabs/health") {
      sendJson(response, 200, {
        ok: true,
        hasApiKey: Boolean(config.apiKey),
        hasAgentId: Boolean(config.defaultAgentId),
        hasVoiceId: Boolean(config.defaultVoiceId),
        ttsModelId: config.defaultTtsModelId,
        sttModelId: config.defaultSttModelId,
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/elevenlabs/agent/create") {
      const body = await readJsonBody(request);
      if (!body.conversation_config || typeof body.conversation_config !== "object") {
        body.conversation_config = {};
      }

      const result = await elevenLabsJson(
        "/v1/convai/agents/create",
        {
          method: "POST",
          body,
        },
        config,
      );

      sendJson(response, 200, result);
      return true;
    }

    if (method === "GET" && pathname === "/api/elevenlabs/agent/signed-url") {
      const agentId = url.searchParams.get("agent_id") || config.defaultAgentId;
      if (!agentId) {
        sendJson(response, 400, {
          error: "Missing agent_id query parameter or ELEVENLABS_AGENT_ID.",
        });
        return true;
      }

      const result = await elevenLabsJson(
        "/v1/convai/conversation/get-signed-url",
        {
          method: "GET",
          query: {
            agent_id: agentId,
            branch_id: url.searchParams.get("branch_id") || "",
            include_conversation_id: url.searchParams.get("include_conversation_id") || "",
          },
        },
        config,
      );

      sendJson(response, 200, result);
      return true;
    }

    if (method === "POST" && pathname === "/api/elevenlabs/tts") {
      const body = await readJsonBody(request);
      const text = String(body.text || "").trim();
      const voiceId = String(body.voice_id || config.defaultVoiceId || "").trim();

      if (!text) {
        sendJson(response, 400, { error: "Missing text." });
        return true;
      }

      if (!voiceId) {
        sendJson(response, 400, {
          error: "Missing voice_id. Pass voice_id in body or set ELEVENLABS_VOICE_ID.",
        });
        return true;
      }

      const modelId = String(body.model_id || config.defaultTtsModelId || "").trim();
      const outputFormat = String(body.output_format || config.defaultTtsOutputFormat || "").trim();

      const payload = {
        text,
        model_id: modelId,
      };

      if (body.voice_settings && typeof body.voice_settings === "object") {
        payload.voice_settings = body.voice_settings;
      }

      const audio = await elevenLabsAudio(
        `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        {
          method: "POST",
          query: {
            output_format: outputFormat,
          },
          body: payload,
        },
        config,
      );

      setCorsHeaders(response);
      response.writeHead(200, {
        "Content-Type": audio.contentType,
        "Content-Length": audio.buffer.length,
        "Cache-Control": "no-store",
      });
      response.end(audio.buffer);
      return true;
    }

    if (method === "POST" && pathname === "/api/elevenlabs/stt") {
      const body = await readJsonBody(request);
      const audioBase64 = body.audio_base64;
      const audioBuffer = decodeBase64(audioBase64);

      if (!audioBase64 || !audioBuffer.length) {
        sendJson(response, 400, {
          error: "Missing or invalid audio_base64.",
        });
        return true;
      }

      const mimeType = String(body.mime_type || "audio/webm").trim();
      const fileName = String(body.filename || `audio-${Date.now()}.webm`).trim();
      const modelId = String(body.model_id || config.defaultSttModelId || "").trim();
      const languageCode = String(body.language_code || config.defaultLanguageCode || "").trim();

      const form = new FormData();
      form.append("model_id", modelId);
      if (languageCode) {
        form.append("language_code", languageCode);
      }
      if (typeof body.tag_audio_events === "boolean") {
        form.append("tag_audio_events", String(body.tag_audio_events));
      }
      if (typeof body.diarize === "boolean") {
        form.append("diarize", String(body.diarize));
      }
      form.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);

      const result = await elevenLabsJson(
        "/v1/speech-to-text",
        {
          method: "POST",
          body: form,
        },
        config,
      );

      sendJson(response, 200, result);
      return true;
    }

    return false;
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "Unexpected error.",
    });
    return true;
  }
}

const server = http.createServer(async (request, response) => {
  const method = request.method || "GET";
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (method === "OPTIONS") {
    setCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApiRequest(request, response, url);
    if (!handled) {
      sendJson(response, 404, { error: "Not found." });
    }
    return;
  }

  const staticPath = resolveStaticPath(url.pathname);
  if (!staticPath || !fs.existsSync(staticPath) || fs.statSync(staticPath).isDirectory()) {
    sendText(response, 404, "Not found.");
    return;
  }

  const ext = path.extname(staticPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });

  fs.createReadStream(staticPath).pipe(response);
});

server.listen(PORT, () => {
  console.log(`Gesture Control + ElevenLabs bridge listening on http://localhost:${PORT}`);
});
