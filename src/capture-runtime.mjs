import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./dataset.mjs";

const target = path.join(ROOT, "environment/runtime.json");
await fs.mkdir(path.dirname(target), { recursive: true });
const runtime = {
  schema_version: "1.0.0",
  captured_at_utc: new Date().toISOString(),
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  architecture: process.arch,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  dependencies: "Node.js built-ins only"
};
await fs.writeFile(target, JSON.stringify(runtime, null, 2) + "\n", "utf8");
console.log(JSON.stringify(runtime));
