#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { getIntegerEnv, loadEnv } from "./lib/env.mjs";

const ROOT_DIR = process.cwd();
const RUN_DIR = path.join(ROOT_DIR, ".run");
const STATE_FILE = path.join(RUN_DIR, "gesture-server.json");
const LOG_FILE = path.join(RUN_DIR, "gesture-server.log");
const DEFAULT_PORT = 4173;
const START_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 1400;
const DEFAULT_LOG_LINES = 80;

loadEnv({ cwd: ROOT_DIR });

function usage() {
  console.log(
    [
      "Usage: node tools/dev-launcher.mjs <up|down|status|logs> [options]",
      "",
      "Commands:",
      "  up      Start local server in background and run health check.",
      "  down    Stop background server.",
      "  status  Show running status and latest health.",
      "  logs    Show tail of server logs (optional: --lines <n>).",
    ].join("\n"),
  );
}

function ensureRunDir() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state) {
  ensureRunDir();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function removeState() {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}

function getPort() {
  return getIntegerEnv("PORT", DEFAULT_PORT);
}

function buildServerUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function formatHealthResult(result) {
  if (!result.reachable) {
    return `unreachable (${result.error || "unknown network error"})`;
  }

  if (!result.isExpectedHealth) {
    return `unexpected service on port (${result.status})`;
  }

  if (result.status === 200) {
    if (result.body?.hasApiKey === true) {
      return "ok (ElevenLabs key configured)";
    }

    if (result.body?.hasApiKey === false) {
      return "config warning (ELEVENLABS_API_KEY missing)";
    }

    return "ok";
  }

  const message = result.body?.error || result.bodyText || "";
  if (message.includes("Missing environment variables: ELEVENLABS_API_KEY")) {
    return "config warning (ELEVENLABS_API_KEY missing)";
  }

  return `error (${result.status})${message ? `: ${message}` : ""}`;
}

function isExpectedHealthShape(status, body) {
  if (!body || typeof body !== "object") {
    return false;
  }

  if (status === 200 && typeof body.hasApiKey === "boolean") {
    return true;
  }

  if (status === 500 && typeof body.error === "string") {
    return true;
  }

  return false;
}

async function fetchHealth(port) {
  const endpoint = `${buildServerUrl(port)}/api/elevenlabs/health`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const bodyText = await response.text();
    let body = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = null;
    }

    return {
      reachable: true,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body,
      bodyText,
      isExpectedHealth: isExpectedHealthShape(response.status, body),
    };
  } catch (error) {
    return {
      reachable: false,
      error: error?.message || "request failed",
      status: null,
      contentType: "",
      body: null,
      bodyText: "",
      isExpectedHealth: false,
    };
  }
}

async function waitForShutdown(pid, timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(120);
  }
  return !isPidRunning(pid);
}

async function commandUp() {
  const port = getPort();
  const existing = readState();

  if (existing && isPidRunning(existing.pid)) {
    const health = await fetchHealth(existing.port || port);
    console.log(`Server already running (pid ${existing.pid}) at ${buildServerUrl(existing.port || port)}`);
    console.log(`Health: ${formatHealthResult(health)}`);
    console.log(`Logs: ${path.relative(ROOT_DIR, LOG_FILE)}`);
    return;
  }

  if (existing) {
    removeState();
  }

  ensureRunDir();
  const logFd = fs.openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      PORT: String(port),
    },
  });
  fs.closeSync(logFd);
  child.unref();

  const state = {
    pid: child.pid,
    port,
    startedAt: nowIso(),
    command: `${process.execPath} server.mjs`,
    logPath: path.relative(ROOT_DIR, LOG_FILE),
  };
  writeState(state);

  let health = null;
  let serverReady = false;
  let lastError = "startup timed out";
  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!isPidRunning(child.pid)) {
      lastError = "server exited early";
      break;
    }

    health = await fetchHealth(port);
    if (health.reachable && health.isExpectedHealth) {
      serverReady = true;
      break;
    }

    if (health.reachable && !health.isExpectedHealth) {
      lastError = `port ${port} is already serving a different app`;
      break;
    }

    lastError = health.error || lastError;
    await delay(220);
  }

  if (!serverReady) {
    if (isPidRunning(child.pid)) {
      try {
        process.kill(child.pid, "SIGTERM");
      } catch {
        // Ignore.
      }
      await waitForShutdown(child.pid, 1200);
    }
    removeState();
    console.error(`Failed to start server: ${lastError}`);
    console.error(`Check logs: ${path.relative(ROOT_DIR, LOG_FILE)}`);
    process.exit(1);
  }

  console.log(`Server started (pid ${child.pid}) at ${buildServerUrl(port)}`);
  console.log(`Health: ${formatHealthResult(health)}`);
  console.log(`Logs: ${path.relative(ROOT_DIR, LOG_FILE)}`);
}

async function commandDown() {
  const state = readState();
  if (!state) {
    console.log("Server is not running (no state file).");
    return;
  }

  const pid = state.pid;
  if (!isPidRunning(pid)) {
    removeState();
    console.log("Server is not running (stale state removed).");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.error(`Failed to stop process ${pid}: ${error.message}`);
      process.exit(1);
    }
  }

  const stopped = await waitForShutdown(pid, 3500);
  if (!stopped) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore.
    }
    await waitForShutdown(pid, 900);
  }

  removeState();
  console.log(`Server stopped (pid ${pid}).`);
}

async function commandStatus() {
  const state = readState();
  if (!state) {
    console.log("Server status: not running.");
    return;
  }

  const port = state.port || getPort();
  if (!isPidRunning(state.pid)) {
    console.log("Server status: not running (stale state present).");
    console.log(`State file: ${path.relative(ROOT_DIR, STATE_FILE)}`);
    return;
  }

  const health = await fetchHealth(port);
  console.log(`Server status: running`);
  console.log(`PID: ${state.pid}`);
  console.log(`URL: ${buildServerUrl(port)}`);
  console.log(`Health: ${formatHealthResult(health)}`);
  console.log(`Logs: ${path.relative(ROOT_DIR, LOG_FILE)}`);
}

function parseLineCountArg() {
  const index = process.argv.indexOf("--lines");
  if (index === -1) {
    return DEFAULT_LOG_LINES;
  }

  const parsed = Number.parseInt(process.argv[index + 1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOG_LINES;
  }

  return parsed;
}

function commandLogs() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`No log file found at ${path.relative(ROOT_DIR, LOG_FILE)}.`);
    return;
  }

  const lineCount = parseLineCountArg();
  const content = fs.readFileSync(LOG_FILE, "utf8");
  const lines = content.split(/\r?\n/);
  const tail = lines.slice(Math.max(0, lines.length - lineCount)).join("\n");
  process.stdout.write(`${tail}\n`);
}

async function main() {
  const command = process.argv[2];

  if (command === "up") {
    await commandUp();
    return;
  }

  if (command === "down") {
    await commandDown();
    return;
  }

  if (command === "status") {
    await commandStatus();
    return;
  }

  if (command === "logs") {
    commandLogs();
    return;
  }

  usage();
  process.exit(1);
}

await main();
