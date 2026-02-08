import fs from "node:fs";
import path from "node:path";

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  let value = trimmed.slice(separator + 1).trim();
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));

  if (quoted && value.length >= 2) {
    value = value.slice(1, -1);
  } else {
    const commentAt = value.search(/\s#/);
    if (commentAt >= 0) {
      value = value.slice(0, commentAt).trim();
    }
  }

  value = value.replace(/\\n/g, "\n");
  return { key, value };
}

export function loadEnv(options = {}) {
  const cwd = options.cwd || process.cwd();
  const fileName = options.fileName || ".env";
  const envPath = path.resolve(cwd, fileName);

  if (!fs.existsSync(envPath)) {
    return envPath;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      continue;
    }

    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }

  return envPath;
}

export function requireEnv(keys) {
  const missing = keys.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length) {
    const error = new Error(`Missing environment variables: ${missing.join(", ")}`);
    error.status = 500;
    throw error;
  }
}

export function getIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
