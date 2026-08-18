import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./dataset.mjs";
import { buildJobs, loadSpec, outputText, requestBodyFor } from "./spec.mjs";
import { exists, sha256 } from "./io.mjs";
import { estimatedActualCost, maximumRequestCost, validateUsage } from "./pricing.mjs";
import { sensitiveFindings } from "./sensitive-scan.mjs";
import { verifyFrozen } from "./verify-frozen.mjs";

const read = async (file) => fs.readFile(file, "utf8");

export async function verifyEvidence() {
  const spec = await loadSpec();
  const frozen = await verifyFrozen();
  const jobs = buildJobs(spec.config);
  const requestBody = requestBodyFor(spec);
  const expectedReserved = maximumRequestCost(requestBody, spec.priceSnapshot);
  const maxInputTokens = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
  const summaryFile = path.join(ROOT, "evidence/run-summary.json");
  if (!(await exists(summaryFile))) throw new Error("Missing evidence/run-summary.json");
  const runSummary = JSON.parse(await read(summaryFile));
  if (runSummary.frozen_manifest_sha256 !== frozen.manifest_sha256 || runSummary.requested !== 3 || !Array.isArray(runSummary.results) || runSummary.results.length !== 3) throw new Error("Invalid run summary identity");
  if (runSummary.results.map((item) => item.run_id).join("|") !== jobs.map((item) => item.run_id).join("|")) throw new Error("Run summary job order mismatch");

  const outcomes = [];
  for (const job of jobs) {
    const expectedRequest = JSON.stringify({ schema_version: "1.0.0", run_id: job.run_id, sequence: job.sequence, repetition: job.repetition, request: requestBody }, null, 2) + "\n";
    const requestFile = path.join(ROOT, `evidence/requests/${job.run_id}.json`);
    const intentFile = path.join(ROOT, `evidence/attempt-intents/${job.run_id}__a1.json`);
    const attemptFile = path.join(ROOT, `evidence/attempts/${job.run_id}__a1.json`);
    if (!(await exists(requestFile)) || !(await exists(intentFile)) || !(await exists(attemptFile))) throw new Error(`Incomplete evidence chain: ${job.run_id}`);
    const requestText = await read(requestFile);
    if (requestText !== expectedRequest) throw new Error(`Request bytes mismatch: ${job.run_id}`);
    const requestHash = sha256(requestText);
    const intentText = await read(intentFile);
    const intent = JSON.parse(intentText);
    if (intent.run_id !== job.run_id || intent.attempt !== 1 || intent.request_sha256 !== requestHash || intent.frozen_manifest_sha256 !== frozen.manifest_sha256 || intent.model !== job.model || Math.abs(Number(intent.reserved_max_cost_usd) - expectedReserved) > 1e-12) throw new Error(`Intent mismatch: ${job.run_id}`);
    const attemptText = await read(attemptFile);
    const attempt = JSON.parse(attemptText);
    if (attempt.run_id !== job.run_id || attempt.attempt !== 1 || attempt.request_sha256 !== requestHash || attempt.intent_sha256 !== sha256(intentText) || attempt.frozen_manifest_sha256 !== frozen.manifest_sha256) throw new Error(`Attempt mismatch: ${job.run_id}`);
    if (Math.abs(Number(attempt.billing?.reserved_upper_bound_usd) - expectedReserved) > 1e-12) throw new Error(`Attempt reservation mismatch: ${job.run_id}`);
    if (attempt.billing?.status === "known") {
      if (!Number.isFinite(Number(attempt.billing.known_cost_usd)) || Number(attempt.billing.known_cost_usd) < 0 || Number(attempt.billing.known_cost_usd) > expectedReserved + 1e-12) throw new Error(`Invalid known attempt cost: ${job.run_id}`);
    } else if (attempt.billing?.status !== "unknown" || attempt.billing.known_cost_usd !== null) throw new Error(`Invalid attempt billing state: ${job.run_id}`);
    if (sensitiveFindings(attempt).length) throw new Error(`Sensitive public attempt: ${job.run_id}`);
    const canonicalFile = path.join(ROOT, `evidence/canonical/${job.run_id}.json`);
    if (!(await exists(canonicalFile))) {
      if (!attempt.failure_code) throw new Error(`Missing canonical without terminal failure: ${job.run_id}`);
      outcomes.push({ job, status: "terminal_failure", failure_code: attempt.failure_code, attempt });
      continue;
    }
    const canonicalText = await read(canonicalFile);
    const canonical = JSON.parse(canonicalText);
    if (canonical.request_sha256 !== requestHash || canonical.intent_sha256 !== sha256(intentText) || canonical.attempt_sha256 !== sha256(attemptText) || canonical.frozen_manifest_sha256 !== frozen.manifest_sha256 || canonical.metadata?.run_id !== job.run_id || canonical.metadata?.model_requested !== job.model || canonical.metadata?.model_returned !== canonical.response?.model) throw new Error(`Canonical mismatch: ${job.run_id}`);
    if (attempt.failure_code !== null && attempt.failure_code !== undefined) throw new Error(`Canonical attempt has a failure code: ${job.run_id}`);
    if (!Number.isSafeInteger(attempt.http_status) || attempt.http_status < 200 || attempt.http_status >= 300) throw new Error(`Canonical attempt HTTP status mismatch: ${job.run_id}`);
    if (JSON.stringify(attempt.response) !== JSON.stringify(canonical.response)) throw new Error(`Canonical response differs from attempt: ${job.run_id}`);
    if (canonical.response?.model !== job.model || canonical.response?.service_tier !== "default" || canonical.response?.status !== "completed" || (canonical.response.incomplete_details !== null && canonical.response.incomplete_details !== undefined) || canonical.response?.output?.some((item) => item?.content?.some((content) => content?.type === "refusal"))) throw new Error(`Canonical provider state mismatch: ${job.run_id}`);
    validateUsage(canonical.response, { maxInputTokens, maxOutputTokens: requestBody.max_output_tokens });
    const expectedCost = estimatedActualCost(canonical.response, spec.priceSnapshot);
    if (expectedCost > expectedReserved + 1e-12 || attempt.billing?.status !== "known" || Math.abs(Number(attempt.billing.known_cost_usd) - expectedCost) > 1e-12) throw new Error(`Canonical cost mismatch: ${job.run_id}`);
    const metadata = canonical.metadata;
    const expectedMetadata = {
      schema_version: "1.0.0", run_id: job.run_id, sequence: job.sequence, repetition: job.repetition,
      model_requested: job.model, model_returned: canonical.response.model, started_at_utc: attempt.started_at_utc, ended_at_utc: attempt.ended_at_utc,
      service_tier: canonical.response.service_tier, latency_ms: attempt.latency_ms, http_status: attempt.http_status, response_status: canonical.response.status,
      input_tokens: canonical.response.usage.input_tokens, output_tokens: canonical.response.usage.output_tokens,
      reasoning_tokens: canonical.response.usage.output_tokens_details?.reasoning_tokens || 0,
      cached_input_tokens: canonical.response.usage.input_tokens_details?.cached_tokens || 0,
      cache_write_tokens: canonical.response.usage.input_tokens_details?.cache_write_tokens || 0,
      output_text_chars: outputText(canonical.response).length, estimated_cost_usd: expectedCost,
      reserved_max_cost_usd: expectedReserved, request_sha256: requestHash, intent_sha256: sha256(intentText),
      attempt_sha256: sha256(attemptText), frozen_manifest_sha256: frozen.manifest_sha256,
    };
    if (JSON.stringify(metadata) !== JSON.stringify(expectedMetadata)) throw new Error(`Canonical metadata mismatch: ${job.run_id}`);
    if (sensitiveFindings(canonical).length) throw new Error(`Sensitive public canonical: ${job.run_id}`);
    const responseText = JSON.stringify(canonical.response, null, 2) + "\n";
    const metadataText = JSON.stringify(canonical.metadata, null, 2) + "\n";
    if (await read(path.join(ROOT, `evidence/responses/${job.run_id}.json`)) !== responseText) throw new Error(`Derived response mismatch: ${job.run_id}`);
    if (await read(path.join(ROOT, `evidence/run-metadata/${job.run_id}.json`)) !== metadataText) throw new Error(`Derived metadata mismatch: ${job.run_id}`);
    outcomes.push({ job, status: "canonical", canonical, attempt });
  }
  const completed = outcomes.filter((item) => item.status === "canonical").length;
  const terminalFailures = outcomes.length - completed;
  const knownCost = outcomes.reduce((sum, item) => sum + Number(item.attempt.billing?.known_cost_usd || 0), 0);
  const unknownAttempts = outcomes.filter((item) => item.attempt.billing?.status === "unknown");
  const unknownReserved = unknownAttempts.reduce((sum, item) => sum + Number(item.attempt.billing.reserved_upper_bound_usd), 0);
  if (runSummary.completed !== completed || runSummary.terminal_failures !== terminalFailures || Math.abs(Number(runSummary.known_cost_usd) - knownCost) > 1e-12 || runSummary.unknown_attempts !== unknownAttempts.length || Math.abs(Number(runSummary.unknown_reserved_upper_bound_usd) - unknownReserved) > 1e-12 || Math.abs(Number(runSummary.maximum_total_cost_usd) - (knownCost + unknownReserved)) > 1e-12 || Math.abs(Number(runSummary.reserved_upper_bound_three_requests_usd) - expectedReserved * 3) > 1e-12 || Number(runSummary.maximum_total_cost_usd) > spec.config.hard_cost_limit_usd + 1e-12) throw new Error("Run summary accounting mismatch");
  for (let index = 0; index < outcomes.length; index += 1) {
    const stored = runSummary.results[index];
    const outcome = outcomes[index];
    if (stored.run_id !== outcome.job.run_id || Boolean(stored.terminal_failure) !== (outcome.status !== "canonical") || JSON.stringify(stored.billing) !== JSON.stringify(outcome.attempt.billing)) throw new Error(`Run summary result mismatch: ${outcome.job.run_id}`);
  }
  return { frozen, spec, runSummary, outcomes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verified = await verifyEvidence();
  console.log(JSON.stringify({ jobs: verified.outcomes.length, canonical: verified.outcomes.filter((item) => item.status === "canonical").length, terminal_failures: verified.outcomes.filter((item) => item.status !== "canonical").length }));
}
