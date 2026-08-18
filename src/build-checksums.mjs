import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./dataset.mjs";
import { sensitiveFindings } from "./sensitive-scan.mjs";
import { sha256 } from "./io.mjs";
import { FROZEN_PATHS } from "./frozen-paths.mjs";

const EXCLUDED_ROOTS = new Set([".git", "node_modules", "publication-artifacts"]);
const FORBIDDEN_NAMES = /(?:^|\/)(?:private|quarantine)(?:\/|$)|(?:^|\/)(?:\.env(?:\.[^/]+)?|\.npmrc|\.pypirc|\.netrc|credentials|[^/]+\.(?:tmp|bak|key|pem|pfx|zip))$/iu;
const FROZEN_SET = new Set(FROZEN_PATHS);
const GENERATED_PATHS = /^(?:benchmark\/pre-run-manifest\.json|evidence\/run-summary\.json|evidence\/(?:requests|canonical|responses|run-metadata)\/write-report__gpt-5\.6-sol__r[1-3]\.json|evidence\/(?:attempt-intents|attempts)\/write-report__gpt-5\.6-sol__r[1-3]__a1\.json|results\/(?:write-report__gpt-5\.6-sol__r[1-3]|summary)\.json|reports\/(?:rule-results\.csv|report\.md|execution-summary\.json|article-summary\.json)|charts\/rule-pass-summary\.svg|reviews\/editorial-review\.json)$/u;
export const MAX_PUBLIC_FILE_BYTES = 2 * 1024 * 1024;

export function assertPublicFileSize(relative, byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_PUBLIC_FILE_BYTES) throw new Error(`Public file exceeds fail-closed size limit: ${relative}`);
}

export async function collectPublicFiles() {
  const files = [];
  async function walk(current, relative = "") {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (!relative && EXCLUDED_ROOTS.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (rel === "checksums.sha256") continue;
      if (FORBIDDEN_NAMES.test(rel)) throw new Error(`Forbidden public path: ${rel}`);
      const full = path.join(current, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new Error(`Symlink is forbidden: ${rel}`);
      if (entry.isDirectory()) await walk(full, rel);
      else if (entry.isFile()) {
        if (!FROZEN_SET.has(rel) && !GENERATED_PATHS.test(rel)) throw new Error(`Unexpected public path: ${rel}`);
        files.push(rel);
      }
      else throw new Error(`Unsupported filesystem entry: ${rel}`);
    }
  }
  await walk(ROOT);
  return files.sort();
}

export async function buildChecksumText() {
  const lines = [];
  for (const relative of await collectPublicFiles()) {
    const bytes = await fs.readFile(path.join(ROOT, relative));
    assertPublicFileSize(relative, bytes.length);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const findings = sensitiveFindings(text);
    if (findings.length) throw new Error(`Sensitive public file ${relative}: ${findings.join(",")}`);
    lines.push(`${sha256(bytes)}  ${relative}`);
  }
  return lines.join("\n") + "\n";
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const checksumText = await buildChecksumText();
  await fs.writeFile(path.join(ROOT, "checksums.sha256"), checksumText, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ files: checksumText.trim().split("\n").length, sha256: sha256(checksumText) }));
}
