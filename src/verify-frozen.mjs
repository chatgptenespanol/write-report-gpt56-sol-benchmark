import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./dataset.mjs";
import { FROZEN_PATHS } from "./frozen-paths.mjs";
import { buildJobs, readJson } from "./spec.mjs";
import { sha256 } from "./io.mjs";

export async function verifyFrozen() {
  const file = path.join(ROOT, "benchmark/pre-run-manifest.json");
  const text = await fs.readFile(file, "utf8");
  const manifest = JSON.parse(text);
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(FROZEN_PATHS)) throw new Error("Frozen inventory mismatch");
  for (const relative of FROZEN_PATHS) {
    const full = path.join(ROOT, relative);
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe frozen path: ${relative}`);
    const bytes = await fs.readFile(full);
    if (bytes.length !== manifest.files[relative].bytes || sha256(bytes) !== manifest.files[relative].sha256) throw new Error(`Frozen file changed: ${relative}`);
  }
  const jobs = buildJobs(await readJson("configs/request.json"));
  if (JSON.stringify(manifest.canonical_jobs) !== JSON.stringify(jobs)) throw new Error("Frozen job inventory mismatch");
  return { manifest, manifest_sha256: sha256(text), files: FROZEN_PATHS.length };
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) console.log(JSON.stringify(await verifyFrozen()));
