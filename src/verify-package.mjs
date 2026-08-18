import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, computeGroundTruth, loadRows } from "./dataset.mjs";
import { assertPublicFileSize, collectPublicFiles } from "./build-checksums.mjs";
import { renderChart } from "./build-chart.mjs";
import { evaluateRepository } from "./evaluate.mjs";
import { verifyEditorialReview } from "./editorial-review.mjs";
import { renderArtifacts } from "./report-renderer.mjs";
import { sensitiveFindings } from "./sensitive-scan.mjs";
import { sha256 } from "./io.mjs";
import { verifyEvidence } from "./verify-evidence.mjs";
import { verifyFrozen } from "./verify-frozen.mjs";

const checksumFile = path.join(ROOT, "checksums.sha256");
const checksumText = await fs.readFile(checksumFile, "utf8");
const entries = checksumText.trim().split(/\r?\n/u).map((line) => {
  const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
  if (!match) throw new Error(`Malformed checksum line: ${line}`);
  return { hash: match[1], relative: match[2] };
});
const publicFiles = await collectPublicFiles();
if (entries.map((item) => item.relative).join("|") !== publicFiles.join("|")) throw new Error("Checksum inventory mismatch");
for (const entry of entries) {
  const bytes = await fs.readFile(path.join(ROOT, entry.relative));
  if (sha256(bytes) !== entry.hash) throw new Error(`Checksum mismatch: ${entry.relative}`);
  assertPublicFileSize(entry.relative, bytes.length);
  const findings = sensitiveFindings(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  if (findings.length) throw new Error(`Sensitive content: ${entry.relative}`);
}
if (sensitiveFindings(checksumText).length) throw new Error("Sensitive checksum file");

await verifyFrozen();
const verifiedEvidence = await verifyEvidence();
const editorialReview = await verifyEditorialReview(verifiedEvidence);
const storedTruth = JSON.parse(await fs.readFile(path.join(ROOT, "data/ground-truth.json"), "utf8"));
if (JSON.stringify(storedTruth) !== JSON.stringify(computeGroundTruth(await loadRows()))) throw new Error("Ground truth does not recompute exactly");

const recomputed = await evaluateRepository({ write: false });
for (const result of recomputed.results) {
  const stored = JSON.parse(await fs.readFile(path.join(ROOT, `results/${result.run_id}.json`), "utf8"));
  if (JSON.stringify(stored) !== JSON.stringify(result)) throw new Error(`Stored evaluation mismatch: ${result.run_id}`);
  if (stored.accepted !== (stored.rules_failed === 0 && stored.rules_not_run === 0 && stored.rules_passed === stored.rules_total)) throw new Error(`Accepted invariant mismatch: ${result.run_id}`);
  if (stored.rules.length !== 18 || new Set(stored.rules.map((item) => item.id)).size !== 18) throw new Error(`Rule inventory mismatch: ${result.run_id}`);
}
const storedSummary = JSON.parse(await fs.readFile(path.join(ROOT, "results/summary.json"), "utf8"));
if (JSON.stringify(storedSummary) !== JSON.stringify(recomputed.summary)) throw new Error("Result summary mismatch");
const rendered = renderArtifacts({ ...recomputed, editorialReview });
if (await fs.readFile(path.join(ROOT, "reports/rule-results.csv"), "utf8") !== rendered.csv) throw new Error("CSV report mismatch");
if (await fs.readFile(path.join(ROOT, "reports/report.md"), "utf8") !== rendered.report) throw new Error("Human report mismatch");
if (await fs.readFile(path.join(ROOT, "reports/execution-summary.json"), "utf8") !== rendered.executionText) throw new Error("Execution summary mismatch");
if (await fs.readFile(path.join(ROOT, "reports/article-summary.json"), "utf8") !== rendered.articleSummaryText) throw new Error("Article summary mismatch");
if (await fs.readFile(path.join(ROOT, "charts/rule-pass-summary.svg"), "utf8") !== renderChart(recomputed.summary)) throw new Error("Chart mismatch");

console.log(JSON.stringify({ files: entries.length, checksum_sha256: sha256(checksumText), frozen: true, evidence: true, results: recomputed.results.length, rules: recomputed.summary.total_rule_slots }));
