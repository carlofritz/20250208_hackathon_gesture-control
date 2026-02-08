import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const candidates = [
  path.join(projectRoot, "node_modules", "vitest", "vitest.mjs"),
  path.resolve(projectRoot, "..", "harbor", "web-agents-api", "node_modules", "vitest", "vitest.mjs"),
];

const vitestEntry = candidates.find((candidate) => fs.existsSync(candidate));

if (!vitestEntry) {
  console.error("Vitest is not available.");
  console.error("Install with: npm install -D vitest");
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [vitestEntry, ...args], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
