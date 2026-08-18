import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./dataset.mjs";
import { FROZEN_PATHS } from "./frozen-paths.mjs";
import { buildJobs, readJson } from "./spec.mjs";
import { sha256, writeAtomicExclusive } from "./io.mjs";

const target = path.join(ROOT, "benchmark/pre-run-manifest.json");
const files = {};
for (const relative of FROZEN_PATHS) {
  const full = path.join(ROOT, relative);
  const stat = await fs.lstat(full);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Frozen path is not a regular file: ${relative}`);
  const bytes = await fs.readFile(full);
  files[relative] = { bytes: bytes.length, sha256: sha256(bytes) };
}
const manifest = {
  schema_version: "1.0.0",
  frozen_at_utc: new Date().toISOString(),
  canonical_jobs: buildJobs(await readJson("configs/request.json")),
  files,
};
const text = JSON.stringify(manifest, null, 2) + "\n";
await writeAtomicExclusive(target, text);
console.log(JSON.stringify({ target: "benchmark/pre-run-manifest.json", files: Object.keys(files).length, jobs: manifest.canonical_jobs.length, sha256: sha256(text) }));
