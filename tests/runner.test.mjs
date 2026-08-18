import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ROOT } from "../src/dataset.mjs";
import { validOutput } from "./fixture.mjs";

async function preparedCopy({ promptSuffix = "" } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "write-report-runner-test-"));
  await fs.cp(ROOT, root, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && !source.includes(`${path.sep}node_modules${path.sep}`) });
  if (promptSuffix) await fs.appendFile(path.join(root, "benchmark/prompt.md"), promptSuffix, "utf8");
  await fs.rm(path.join(root, "benchmark/pre-run-manifest.json"), { force: true });
  await fs.rm(path.join(root, "checksums.sha256"), { force: true });
  for (const dir of ["evidence", "results", "reports", "charts"]) {
    await fs.rm(path.join(root, dir), { recursive: true, force: true });
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
  const result = spawnSync(process.execPath, ["src/freeze.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return root;
}

function mockEnvelope(output) {
  return {
    id: ["res", "p_fixture_only"].join(""),
    object: "response",
    created_at: 1787000000,
    status: "completed",
    incomplete_details: null,
    max_output_tokens: 6000,
    model: "gpt-5.6-sol",
    output: [{ id: "msg_fixture_only", type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
    reasoning: { effort: "medium", context: "current_turn" },
    service_tier: "default",
    store: false,
    text: { verbosity: "medium" },
    tools: [],
    usage: { input_tokens: 4000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 1200, output_tokens_details: { reasoning_tokens: 200 }, total_tokens: 5200 }
  };
}

test("runner makes exactly three calls, strips provider ids and reuses summary", async (t) => {
  const root = await preparedCopy();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify(mockEnvelope(validOutput(groundTruth))), { status: 200, headers: { "content-type": "application/json" } });
  };
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  const key = ["s", "k-test-", "x".repeat(80)].join("");
  const first = await module.runBenchmark({ apiKey: key, fetchImpl });
  assert.equal(first.completed, 3);
  assert.equal(calls, 3);
  const second = await module.runBenchmark({ apiKey: key, fetchImpl });
  assert.equal(second.reused_summary, true);
  assert.equal(calls, 3);
  const canonical = await fs.readFile(path.join(root, "evidence/canonical/write-report__gpt-5.6-sol__r1.json"), "utf8");
  assert.equal(canonical.includes(["res", "p_fixture_only"].join("")), false);
  assert.equal(canonical.includes("msg_fixture_only"), false);
});

test("sensitive request content is blocked before the first network call", async (t) => {
  const syntheticToken = ["github", "_pat_", "A".repeat(40)].join("");
  const root = await preparedCopy({ promptSuffix: `\n${syntheticToken}\n` });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  await assert.rejects(
    module.runBenchmark({ apiKey: ["s", "k-test-", "i".repeat(80)].join(""), fetchImpl: async () => { calls += 1; throw new Error("network should not be reached"); } }),
    /Sensitive benchmark input blocked/u,
  );
  assert.equal(calls, 0);
});

test("one HTTP failure is terminal and does not prevent the other frozen repetitions", async (t) => {
  const root = await preparedCopy();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 2) return new Response(JSON.stringify({ error: { message: "fixture failure", type: "server_error" } }), { status: 500, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(mockEnvelope(validOutput(groundTruth))), { status: 200, headers: { "content-type": "application/json" } });
  };
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  const summary = await module.runBenchmark({ apiKey: ["s", "k-test-", "y".repeat(80)].join(""), fetchImpl });
  assert.equal(calls, 3);
  assert.equal(summary.completed, 2);
  assert.equal(summary.terminal_failures, 1);
});

test("sensitive transport errors are quarantined and later runs continue", async (t) => {
  const root = await preparedCopy();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  let calls = 0;
  const privateText = [["C:", "\\", "Users", "\\", "PrivateName"].join(""), ["real.person", "gmail.com"].join("@")].join(" ");
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error(privateText);
    return new Response(JSON.stringify(mockEnvelope(validOutput(groundTruth))), { status: 200, headers: { "content-type": "application/json" } });
  };
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  const summary = await module.runBenchmark({ apiKey: ["s", "k-test-", "t".repeat(80)].join(""), fetchImpl });
  assert.equal(calls, 3);
  assert.equal(summary.completed, 2);
  const attempt = await fs.readFile(path.join(root, "evidence/attempts/write-report__gpt-5.6-sol__r1__a1.json"), "utf8");
  assert.equal(attempt.includes(privateText), false);
  assert.match(attempt, /"quarantined": true/u);
});

test("incomplete and refusal envelopes are terminal and never become canonical", async (t) => {
  const root = await preparedCopy();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const envelope = mockEnvelope(validOutput(groundTruth));
    if (calls === 1) {
      envelope.status = "incomplete";
      envelope.incomplete_details = { reason: "max_output_tokens" };
    }
    if (calls === 2) {
      envelope.output[0].content = [{ type: "refusal", refusal: "No puedo completar esta solicitud." }];
    }
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  };
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  const summary = await module.runBenchmark({ apiKey: ["s", "k-test-", "q".repeat(80)].join(""), fetchImpl });
  assert.equal(calls, 3);
  assert.equal(summary.completed, 1);
  assert.equal(summary.terminal_failures, 2);
  await assert.rejects(fs.access(path.join(root, "evidence/canonical/write-report__gpt-5.6-sol__r1.json")));
  await assert.rejects(fs.access(path.join(root, "evidence/canonical/write-report__gpt-5.6-sol__r2.json")));
  await fs.access(path.join(root, "evidence/canonical/write-report__gpt-5.6-sol__r3.json"));
});

test("a non-default returned service tier is terminal and never becomes canonical", async (t) => {
  const root = await preparedCopy();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const envelope = mockEnvelope(validOutput(groundTruth));
    if (calls === 1) envelope.service_tier = "priority";
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  };
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  await assert.rejects(module.runBenchmark({ apiKey: ["s", "k-test-", "v".repeat(80)].join(""), fetchImpl }), /cost_contract_breach/u);
  assert.equal(calls, 1);
  await assert.rejects(fs.access(path.join(root, "evidence/canonical/write-report__gpt-5.6-sol__r1.json")));
  await assert.rejects(fs.access(path.join(root, "evidence/run-summary.json")));
});

test("a saved successful attempt is materialized after interruption without another paid call", async (t) => {
  const root = await preparedCopy();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify(mockEnvelope(validOutput(groundTruth))), { status: 200, headers: { "content-type": "application/json" } });
  };
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  const key = ["s", "k-test-", "m".repeat(80)].join("");
  await module.runBenchmark({ apiKey: key, fetchImpl });
  assert.equal(calls, 3);
  const runId = "write-report__gpt-5.6-sol__r1";
  for (const relative of [`evidence/canonical/${runId}.json`, `evidence/responses/${runId}.json`, `evidence/run-metadata/${runId}.json`, "evidence/run-summary.json"]) await fs.rm(path.join(root, relative));
  const restored = await module.runBenchmark({ apiKey: key, fetchImpl });
  assert.equal(calls, 3);
  assert.equal(restored.completed, 3);
  await fs.access(path.join(root, `evidence/canonical/${runId}.json`));
});

test("a stale crashed-process lock is recovered without weakening an active lock", async (t) => {
  const root = await preparedCopy();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const groundTruth = JSON.parse(await fs.readFile(path.join(root, "data/ground-truth.json"), "utf8"));
  const lockFile = path.join(root, "evidence/locks/__run__.lock");
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  await fs.writeFile(lockFile, JSON.stringify({ pid: 2147483646, token: "stale-fixture", created_at_utc: "2020-01-01T00:00:00Z" }) + "\n");
  await fs.utimes(lockFile, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(JSON.stringify(mockEnvelope(validOutput(groundTruth))), { status: 200, headers: { "content-type": "application/json" } }); };
  const module = await import(`${pathToFileURL(path.join(root, "src/run-benchmark.mjs")).href}?test=${Date.now()}`);
  await module.runBenchmark({ apiKey: ["s", "k-test-", "u".repeat(80)].join(""), fetchImpl });
  assert.equal(calls, 3);

  await fs.rm(path.join(root, "evidence/run-summary.json"));
  await fs.writeFile(lockFile, JSON.stringify({ pid: process.pid, token: "active-fixture", created_at_utc: new Date().toISOString() }) + "\n");
  await assert.rejects(module.runBenchmark({ apiKey: ["s", "k-test-", "v".repeat(80)].join(""), fetchImpl }), /Process lock unavailable/u);
  assert.equal(calls, 3);
});
