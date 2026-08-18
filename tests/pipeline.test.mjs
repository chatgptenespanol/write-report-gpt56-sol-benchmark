import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { ROOT } from "../src/dataset.mjs";
import { validOutput } from "./fixture.mjs";

const runNode = (root, script) => {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${script}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

test("mock execution completes the offline publication pipeline", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "write-report-pipeline-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(ROOT, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && !source.includes(`${path.sep}node_modules${path.sep}`) });
  for (const file of ["benchmark/pre-run-manifest.json", "checksums.sha256"]) await fs.rm(path.join(root, file), { force: true });
  for (const dir of ["evidence", "results", "reports", "charts"]) {
    await fs.rm(path.join(root, dir), { recursive: true, force: true });
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  runNode(root, "src/freeze.mjs");
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  const responseObject = {
    object: "response", created_at: 1787000000, status: "completed", incomplete_details: null,
    max_output_tokens: 6000, model: "gpt-5.6-sol",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(validOutput(groundTruth)) }] }],
    reasoning: { effort: "medium", context: "current_turn" }, service_tier: "default", store: false,
    text: { verbosity: "medium" }, tools: [],
    usage: { input_tokens: 4000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 1200, output_tokens_details: { reasoning_tokens: 200 }, total_tokens: 5200 }
  };
  const fetchImpl = async () => new Response(JSON.stringify(responseObject), { status: 200, headers: { "content-type": "application/json" } });
  const runner = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?pipeline=${Date.now()}`);
  const summary = await runner.runBenchmark({ apiKey: ["s", "k-test-", "z".repeat(80)].join(""), fetchImpl });
  assert.equal(summary.completed, 3);
  runNode(root, "src/evaluate.mjs");
  const runIds = Array.from({ length: 3 }, (_, index) => `write-report__gpt-5.6-sol__r${index + 1}`);
  const reviewRuns = [];
  for (const runId of runIds) {
    const canonical = JSON.parse(await fs.readFile(path.join(root, `evidence/canonical/${runId}.json`), "utf8"));
    const text = canonical.response.output.flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("");
    reviewRuns.push({
      run_id: runId,
      output_sha256: crypto.createHash("sha256").update(text).digest("hex"),
      decisions: Array.from({ length: 7 }, (_, index) => ({ id: `E0${index + 1}`, status: "pass", note: "Revisión sintética exclusiva de la prueba offline." })),
      overall: "pass",
      notes: "Fixture de prueba; no representa una revisión del resultado real."
    });
  }
  await fs.mkdir(path.join(root, "reviews"), { recursive: true });
  await fs.writeFile(path.join(root, "reviews/editorial-review.json"), JSON.stringify({ schema_version: "1.0.0", method: "editorial-review-protocol-v1", reviewed_at_utc: "2026-08-18T12:00:00Z", reviewer: { name: "Test Reviewer", type: "external_human", human_attestation: true }, runs: reviewRuns }, null, 2) + "\n");
  runNode(root, "src/build-report.mjs");
  runNode(root, "src/build-chart.mjs");
  runNode(root, "src/build-checksums.mjs");
  const output = runNode(root, "src/verify-package.mjs");
  assert.match(output, /"rules":54/u);
  const stage = `${root}-release-stage`;
  const zip = `${root}-release.zip`;
  t.after(() => fs.rm(stage, { recursive: true, force: true }));
  t.after(() => fs.rm(zip, { force: true }));
  const release = spawnSync(process.execPath, ["publication/build-release.mjs", "--stage", stage, "--zip", zip], { cwd: root, encoding: "utf8" });
  assert.equal(release.status, 0, `${release.stdout}\n${release.stderr}`);
  assert.equal(JSON.parse(release.stdout).zip_verified, true);
  await fs.access(zip);
  if (process.platform === "win32") {
    const caseStage = `${root}-CaseStage`;
    const insideZipDifferentCase = path.join(caseStage.toUpperCase(), "inside.zip");
    const unsafeRelease = spawnSync(process.execPath, ["publication/build-release.mjs", "--stage", caseStage, "--zip", insideZipDifferentCase], { cwd: root, encoding: "utf8" });
    assert.notEqual(unsafeRelease.status, 0);
    assert.match(`${unsafeRelease.stdout}\n${unsafeRelease.stderr}`, /separate paths/u);
  }
  const resultSummary = JSON.parse(await fs.readFile(path.join(root, "results/summary.json"), "utf8"));
  assert.equal(resultSummary.accepted_outputs, 3);
  assert.equal(resultSummary.total_rules_passed, 54);

  const metadataFile = path.join(root, "evidence/run-metadata/write-report__gpt-5.6-sol__r1.json");
  const metadataOriginal = await fs.readFile(metadataFile, "utf8");
  const canonicalFile = path.join(root, "evidence/canonical/write-report__gpt-5.6-sol__r1.json");
  const canonicalOriginal = await fs.readFile(canonicalFile, "utf8");
  const canonicalMetadataTamper = JSON.parse(canonicalOriginal);
  canonicalMetadataTamper.metadata.request_sha256 = "0".repeat(64);
  canonicalMetadataTamper.metadata.output_text_chars = 999999;
  await fs.writeFile(canonicalFile, JSON.stringify(canonicalMetadataTamper, null, 2) + "\n");
  await fs.writeFile(metadataFile, JSON.stringify(canonicalMetadataTamper.metadata, null, 2) + "\n");
  await fs.rm(path.join(root, "checksums.sha256"));
  runNode(root, "src/build-checksums.mjs");
  const tamperedCanonicalMetadata = spawnSync(process.execPath, ["src/verify-package.mjs"], { cwd: root, encoding: "utf8" });
  assert.notEqual(tamperedCanonicalMetadata.status, 0);
  assert.match(`${tamperedCanonicalMetadata.stdout}\n${tamperedCanonicalMetadata.stderr}`, /Canonical metadata mismatch/u);
  await fs.writeFile(canonicalFile, canonicalOriginal);
  await fs.writeFile(metadataFile, metadataOriginal);

  const metadata = JSON.parse(metadataOriginal);
  metadata.estimated_cost_usd += 0.01;
  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2) + "\n");
  await fs.rm(path.join(root, "checksums.sha256"));
  runNode(root, "src/build-checksums.mjs");
  const tamperedCost = spawnSync(process.execPath, ["src/verify-package.mjs"], { cwd: root, encoding: "utf8" });
  assert.notEqual(tamperedCost.status, 0);
  assert.match(`${tamperedCost.stdout}\n${tamperedCost.stderr}`, /Derived metadata mismatch|Canonical metadata mismatch/u);
  const refusedStage = `${root}-tampered-stage`;
  const refusedZip = `${root}-tampered.zip`;
  t.after(() => fs.rm(refusedStage, { recursive: true, force: true }));
  t.after(() => fs.rm(refusedZip, { force: true }));
  const refusedRelease = spawnSync(process.execPath, ["publication/build-release.mjs", "--stage", refusedStage, "--zip", refusedZip], { cwd: root, encoding: "utf8" });
  assert.notEqual(refusedRelease.status, 0);
  await assert.rejects(fs.access(refusedZip));

  await fs.writeFile(metadataFile, metadataOriginal);
  await fs.appendFile(path.join(root, "charts/rule-pass-summary.svg"), "<!-- tampered -->\n");
  await fs.rm(path.join(root, "checksums.sha256"));
  runNode(root, "src/build-checksums.mjs");
  const tamperedChart = spawnSync(process.execPath, ["src/verify-package.mjs"], { cwd: root, encoding: "utf8" });
  assert.notEqual(tamperedChart.status, 0);
  assert.match(`${tamperedChart.stdout}\n${tamperedChart.stderr}`, /Chart mismatch/u);
});
