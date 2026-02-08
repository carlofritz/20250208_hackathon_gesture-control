import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const candidates = [
  path.join(projectRoot, "node_modules", "@playwright", "test", "cli.js"),
  path.resolve(projectRoot, "..", "harbor", "web-agents-api", "node_modules", "@playwright", "test", "cli.js"),
];

const cliEntry = candidates.find((candidate) => fs.existsSync(candidate));

if (!cliEntry) {
  console.error("@playwright/test is not available.");
  console.error("Install with: npm install -D @playwright/test");
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [cliEntry, ...args], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
