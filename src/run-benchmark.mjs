import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { ROOT } from "./dataset.mjs";
import { buildJobs, loadSpec, outputText, requestBodyFor, safeRunId, validateBenchmarkConfig } from "./spec.mjs";
import { estimatedActualCost, maximumRequestCost, validatePricing, validateUsage } from "./pricing.mjs";
import { sensitiveFindings } from "./sensitive-scan.mjs";
import { ensureExactFile, exists, sha256, writeAtomicExclusive } from "./io.mjs";
import { verifyFrozen } from "./verify-frozen.mjs";

const EVIDENCE_DIRS = ["requests", "attempt-intents", "attempts", "canonical", "responses", "run-metadata", "locks"];
const MAX_PROVIDER_BYTES = 768 * 1024;

async function ensureDirs() {
  for (const name of EVIDENCE_DIRS) await fs.mkdir(path.join(ROOT, "evidence", name), { recursive: true });
}

async function acquireProcessLock(name) {
  if (!new Set(["run"]).has(name)) throw new Error("Unsupported process lock name");
  const lockFile = path.join(ROOT, `evidence/locks/__${name}__.lock`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = crypto.randomUUID();
    try {
      const handle = await fs.open(lockFile, "wx");
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, created_at_utc: new Date().toISOString() }) + "\n", "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      return async () => {
        const owner = JSON.parse(await fs.readFile(lockFile, "utf8"));
        if (owner.token !== token || owner.pid !== process.pid) throw new Error("Process lock ownership changed");
        await fs.unlink(lockFile);
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await fs.stat(lockFile);
      let owner;
      try { owner = JSON.parse(await fs.readFile(lockFile, "utf8")); } catch { owner = null; }
      let alive = false;
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); alive = true; }
        catch (probeError) { if (probeError.code === "EPERM") alive = true; }
      }
      if (alive || (!owner && Date.now() - stat.mtimeMs < 30_000)) throw new Error(`Process lock unavailable: ${name}`);
      const stale = `${lockFile}.stale.${crypto.randomUUID()}`;
      try { await fs.rename(lockFile, stale); }
      catch (renameError) { if (renameError.code === "ENOENT") continue; throw renameError; }
      await fs.unlink(stale);
    }
  }
  throw new Error(`Unable to acquire process lock: ${name}`);
}

function selectedHeaders(headers) {
  const allow = ["content-type", "openai-version", "openai-processing-ms", "retry-after"];
  return Object.fromEntries(allow.map((name) => [name, headers.get(name)]).filter(([, value]) => value !== null));
}

function stripProviderIdentifiers(value) {
  if (Array.isArray(value)) return value.map(stripProviderIdentifiers);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["id", "request_id"].includes(key)).map(([key, item]) => [key, stripProviderIdentifiers(item)]));
}

function publicProjection(response) {
  const allow = ["object", "created_at", "status", "incomplete_details", "max_output_tokens", "model", "reasoning", "service_tier", "store", "text", "tools", "usage"];
  const projected = stripProviderIdentifiers(Object.fromEntries(allow.filter((key) => key in (response || {})).map((key) => [key, response[key]])));
  projected.output = (response?.output || []).filter((item) => item?.type === "message").map((item) => ({
    type: "message",
    role: item.role,
    status: item.status,
    content: (item.content || []).filter((content) => ["output_text", "refusal"].includes(content?.type)).map((content) => content.type === "output_text" ? { type: "output_text", text: content.text } : { type: "refusal", refusal: content.refusal }),
  }));
  return projected;
}

function cleanError(value) {
  const error = value?.error && typeof value.error === "object" ? value.error : value;
  const clean = (input) => String(input ?? "Provider error").replace(/\b(?:sk-|org-|proj[_-])[A-Za-z0-9_-]+\b/gu, "[REDACTED]").slice(0, 500);
  return { error: { message: clean(error?.message ?? error), type: clean(error?.type), param: clean(error?.param), code: clean(error?.code) } };
}

async function readResponseBytes(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BYTES) throw new Error("Provider response exceeds byte limit");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_BYTES) { await reader.cancel().catch(() => {}); throw new Error("Provider response exceeds byte limit"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function validateCostEnvelope(response, requestedModel, { maxInputTokens, maxOutputTokens, reservedMax, snapshot }) {
  if (!response || typeof response !== "object") throw new Error("Provider response is not an object");
  if (response.model !== requestedModel) throw new Error(`Returned model mismatch: ${response.model}`);
  if (response.service_tier !== "default") throw new Error(`Returned service tier mismatch: ${response.service_tier}`);
  validateUsage(response, { maxInputTokens, maxOutputTokens });
  const actualCost = estimatedActualCost(response, snapshot);
  if (!Number.isFinite(actualCost) || actualCost < 0 || actualCost > reservedMax + 1e-12) throw new Error("Reported usage cost exceeds the reserved upper bound");
  return actualCost;
}

function validateOutputEnvelope(response) {
  if (!Array.isArray(response.output)) throw new Error("Provider response lacks output array");
  if (response.status !== "completed") throw new Error(`Provider response is not completed: ${response.status}`);
  if (response.incomplete_details !== null && response.incomplete_details !== undefined) throw new Error("Completed response has incomplete_details");
  if (response.output.some((item) => item?.content?.some((content) => content?.type === "refusal"))) throw new Error("Provider response contains a refusal");
}

function validateProviderEnvelope(response, requestedModel, limits) {
  const actualCost = validateCostEnvelope(response, requestedModel, limits);
  validateOutputEnvelope(response);
  return actualCost;
}

async function reservedExposure(spec, frozen) {
  const dir = path.join(ROOT, "evidence/attempt-intents");
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json"));
  const allowed = new Set(buildJobs(spec.config).map((job) => `${job.run_id}__a1.json`));
  const expected = maximumRequestCost(requestBodyFor(spec), spec.priceSnapshot);
  let total = 0;
  for (const name of names) {
    if (!allowed.has(name)) throw new Error(`Unexpected attempt intent: ${name}`);
    const intent = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
    if (`${intent.run_id}__a1.json` !== name || intent.attempt !== 1 || intent.frozen_manifest_sha256 !== frozen.manifest_sha256 || !Number.isFinite(intent.reserved_max_cost_usd) || Math.abs(intent.reserved_max_cost_usd - expected) > 1e-12) throw new Error(`Invalid attempt intent: ${name}`);
    total += intent.reserved_max_cost_usd;
  }
  return total;
}

async function reserveBudget(spec, frozen, intentFile, intentText, intent) {
  const current = await reservedExposure(spec, frozen);
  if (current + intent.reserved_max_cost_usd > spec.config.hard_cost_limit_usd) throw new Error(`Hard cost limit would be exceeded: ${(current + intent.reserved_max_cost_usd).toFixed(6)} > ${spec.config.hard_cost_limit_usd}`);
  await writeAtomicExclusive(intentFile, intentText);
}

class TerminalAttemptError extends Error {
  constructor(code, billing) { super(code); this.code = code; this.billing = billing; }
}

class CostContractError extends Error {
  constructor(code, billing) { super(code); this.code = code; this.billing = billing; }
}

async function runOne({ apiKey, job, spec, frozen, fetchImpl }) {
  safeRunId(job.run_id);
  const body = requestBodyFor(spec);
  const requestEnvelope = { schema_version: "1.0.0", run_id: job.run_id, sequence: job.sequence, repetition: job.repetition, request: body };
  const requestText = JSON.stringify(requestEnvelope, null, 2) + "\n";
  const requestHash = sha256(requestText);
  const reservedMax = maximumRequestCost(body, spec.priceSnapshot);
  const requestFile = path.join(ROOT, `evidence/requests/${job.run_id}.json`);
  const intentFile = path.join(ROOT, `evidence/attempt-intents/${job.run_id}__a1.json`);
  const attemptFile = path.join(ROOT, `evidence/attempts/${job.run_id}__a1.json`);
  const canonicalFile = path.join(ROOT, `evidence/canonical/${job.run_id}.json`);

  const materializeCanonical = async (projected, attempt, attemptText) => {
    const actualCost = validateProviderEnvelope(projected, job.model, {
      maxInputTokens: Buffer.byteLength(JSON.stringify(body), "utf8"),
      maxOutputTokens: body.max_output_tokens,
      reservedMax,
      snapshot: spec.priceSnapshot,
    });
    if (attempt.failure_code !== null && attempt.failure_code !== undefined) throw new Error(`Successful attempt has failure code: ${job.run_id}`);
    if (attempt.http_status < 200 || attempt.http_status >= 300 || JSON.stringify(attempt.response) !== JSON.stringify(projected)) throw new Error(`Successful attempt payload mismatch: ${job.run_id}`);
    if (attempt.billing?.status !== "known" || Math.abs(Number(attempt.billing.known_cost_usd) - actualCost) > 1e-12 || Math.abs(Number(attempt.billing.reserved_upper_bound_usd) - reservedMax) > 1e-12) throw new Error(`Successful attempt billing mismatch: ${job.run_id}`);
    const metadata = {
      schema_version: "1.0.0", run_id: job.run_id, sequence: job.sequence, repetition: job.repetition,
      model_requested: job.model, model_returned: projected.model, started_at_utc: attempt.started_at_utc, ended_at_utc: attempt.ended_at_utc,
      service_tier: projected.service_tier,
      latency_ms: attempt.latency_ms, http_status: attempt.http_status, response_status: projected.status,
      input_tokens: projected.usage.input_tokens, output_tokens: projected.usage.output_tokens,
      reasoning_tokens: projected.usage.output_tokens_details?.reasoning_tokens || 0,
      cached_input_tokens: projected.usage.input_tokens_details?.cached_tokens || 0,
      cache_write_tokens: projected.usage.input_tokens_details?.cache_write_tokens || 0,
      output_text_chars: outputText(projected).length, estimated_cost_usd: actualCost,
      reserved_max_cost_usd: reservedMax, request_sha256: requestHash, intent_sha256: attempt.intent_sha256,
      attempt_sha256: sha256(attemptText), frozen_manifest_sha256: frozen.manifest_sha256,
    };
    const canonical = { schema_version: "1.0.0", request_sha256: requestHash, intent_sha256: attempt.intent_sha256, attempt_sha256: sha256(attemptText), frozen_manifest_sha256: frozen.manifest_sha256, metadata, response: projected };
    await writeAtomicExclusive(canonicalFile, JSON.stringify(canonical, null, 2) + "\n");
    await ensureExactFile(path.join(ROOT, `evidence/responses/${job.run_id}.json`), JSON.stringify(projected, null, 2) + "\n");
    await ensureExactFile(path.join(ROOT, `evidence/run-metadata/${job.run_id}.json`), JSON.stringify(metadata, null, 2) + "\n");
    return { canonical, metadata, billing: attempt.billing };
  };

  if (await exists(canonicalFile)) {
    if (!(await exists(requestFile)) || !(await exists(intentFile)) || !(await exists(attemptFile))) throw new Error(`Incomplete existing evidence chain: ${job.run_id}`);
    if (await fs.readFile(requestFile, "utf8") !== requestText) throw new Error(`Existing request mismatch: ${job.run_id}`);
    const intentText = await fs.readFile(intentFile, "utf8");
    const attemptText = await fs.readFile(attemptFile, "utf8");
    const intent = JSON.parse(intentText);
    const attempt = JSON.parse(attemptText);
    const canonical = JSON.parse(await fs.readFile(canonicalFile, "utf8"));
    if (intent.run_id !== job.run_id || intent.attempt !== 1 || intent.request_sha256 !== requestHash || intent.frozen_manifest_sha256 !== frozen.manifest_sha256 || attempt.run_id !== job.run_id || attempt.intent_sha256 !== sha256(intentText) || attempt.request_sha256 !== requestHash || canonical.request_sha256 !== requestHash || canonical.intent_sha256 !== sha256(intentText) || canonical.attempt_sha256 !== sha256(attemptText) || canonical.frozen_manifest_sha256 !== frozen.manifest_sha256 || canonical.metadata?.run_id !== job.run_id || JSON.stringify(attempt.response) !== JSON.stringify(canonical.response)) throw new Error(`Existing canonical mismatch: ${job.run_id}`);
    const revalidatedCost = validateProviderEnvelope(canonical.response, job.model, { maxInputTokens: Buffer.byteLength(JSON.stringify(body), "utf8"), maxOutputTokens: body.max_output_tokens, reservedMax, snapshot: spec.priceSnapshot });
    if (canonical.metadata.service_tier !== "default" || Math.abs(Number(canonical.metadata.estimated_cost_usd) - revalidatedCost) > 1e-12) throw new Error(`Existing canonical cost contract mismatch: ${job.run_id}`);
    await ensureExactFile(path.join(ROOT, `evidence/responses/${job.run_id}.json`), JSON.stringify(canonical.response, null, 2) + "\n");
    await ensureExactFile(path.join(ROOT, `evidence/run-metadata/${job.run_id}.json`), JSON.stringify(canonical.metadata, null, 2) + "\n");
    return { run_id: job.run_id, skipped: true, terminal_failure: false, billing: { status: "known", known_cost_usd: canonical.metadata.estimated_cost_usd, reserved_upper_bound_usd: canonical.metadata.reserved_max_cost_usd } };
  }
  if (await exists(intentFile)) {
    if (!(await exists(requestFile)) || await fs.readFile(requestFile, "utf8") !== requestText) throw new Error(`Existing terminal request mismatch: ${job.run_id}`);
    const intentText = await fs.readFile(intentFile, "utf8");
    const intent = JSON.parse(intentText);
    if (intent.run_id !== job.run_id || intent.attempt !== 1 || intent.request_sha256 !== requestHash || intent.frozen_manifest_sha256 !== frozen.manifest_sha256 || intent.model !== job.model || Math.abs(Number(intent.reserved_max_cost_usd) - reservedMax) > 1e-12) throw new Error(`Existing terminal intent mismatch: ${job.run_id}`);
    if (!(await exists(attemptFile))) return { run_id: job.run_id, skipped: true, terminal_failure: true, failure_code: "unresolved_attempt_intent", billing: { status: "unknown", known_cost_usd: null, reserved_upper_bound_usd: reservedMax } };
    const existingAttemptText = await fs.readFile(attemptFile, "utf8");
    const attempt = JSON.parse(existingAttemptText);
    if (attempt.run_id !== job.run_id || attempt.attempt !== 1 || attempt.request_sha256 !== requestHash || attempt.intent_sha256 !== sha256(intentText) || attempt.frozen_manifest_sha256 !== frozen.manifest_sha256) throw new Error(`Existing terminal attempt mismatch: ${job.run_id}`);
    if (!attempt.failure_code) {
      const restored = await materializeCanonical(attempt.response, attempt, existingAttemptText);
      return { run_id: job.run_id, skipped: true, terminal_failure: false, billing: restored.billing, latency_ms: attempt.latency_ms };
    }
    if (attempt.failure_code === "cost_contract_breach") throw new CostContractError("cost_contract_breach", attempt.billing);
    return { run_id: job.run_id, skipped: true, terminal_failure: true, failure_code: attempt.failure_code || "terminal_attempt", billing: attempt.billing || { status: "unknown", known_cost_usd: null, reserved_upper_bound_usd: reservedMax } };
  }

  if (await exists(requestFile)) {
    if (await fs.readFile(requestFile, "utf8") !== requestText) throw new Error(`Existing request mismatch: ${job.run_id}`);
  } else {
    await writeAtomicExclusive(requestFile, requestText);
  }
  const startedAt = new Date().toISOString();
  const intent = { schema_version: "1.0.0", run_id: job.run_id, attempt: 1, started_at_utc: startedAt, request_sha256: requestHash, frozen_manifest_sha256: frozen.manifest_sha256, model: job.model, reserved_max_cost_usd: reservedMax };
  const intentText = JSON.stringify(intent, null, 2) + "\n";
  await reserveBudget(spec, frozen, intentFile, intentText, intent);
  const intentHash = sha256(intentText);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), spec.config.request_timeout_ms);
  const started = performance.now();
  let response;
  let bytes;
  let transportError;
  try {
    response = await fetchImpl(spec.config.endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal, redirect: "error" });
    bytes = await readResponseBytes(response);
  } catch (error) { transportError = error; }
  finally { clearTimeout(timeout); }
  const endedAt = new Date().toISOString();
  const latencyMs = Math.round(performance.now() - started);

  if (transportError) {
    const billing = { status: "unknown", known_cost_usd: null, reserved_upper_bound_usd: reservedMax };
    const transportProjection = cleanError(transportError);
    const transportFindings = sensitiveFindings(transportProjection);
    const record = { schema_version: "1.0.0", run_id: job.run_id, attempt: 1, started_at_utc: startedAt, ended_at_utc: endedAt, latency_ms: latencyMs, request_sha256: requestHash, intent_sha256: intentHash, frozen_manifest_sha256: frozen.manifest_sha256, http_status: null, billing, failure_code: "transport_failure", response: transportFindings.length ? { quarantined: true, categories: transportFindings, message_sha256: sha256(JSON.stringify(transportProjection)) } : transportProjection };
    await writeAtomicExclusive(attemptFile, JSON.stringify(record, null, 2) + "\n");
    throw new TerminalAttemptError("transport_failure", billing);
  }

  let bodyText = "";
  let parsed;
  try { bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bytes); parsed = JSON.parse(bodyText); }
  catch { parsed = null; }
  const projected = response.ok && parsed ? publicProjection(parsed) : cleanError(parsed || bodyText);
  const findings = sensitiveFindings(projected);
  let envelopeFailure = null;
  let costContractFailure = null;
  let validatedCost = null;
  if (response.ok && parsed) {
    try {
      validatedCost = validateCostEnvelope(projected, job.model, {
        maxInputTokens: Buffer.byteLength(JSON.stringify(body), "utf8"),
        maxOutputTokens: body.max_output_tokens,
        reservedMax,
        snapshot: spec.priceSnapshot,
      });
    }
    catch { costContractFailure = "cost_contract_breach"; }
    if (!costContractFailure && findings.length === 0) {
      try { validateOutputEnvelope(projected); }
      catch { envelopeFailure = "invalid_output_envelope"; }
    }
  }
  const billing = costContractFailure ? { status: "unknown", known_cost_usd: null, reserved_upper_bound_usd: spec.config.hard_cost_limit_usd } : (validatedCost !== null ? { status: "known", known_cost_usd: validatedCost, reserved_upper_bound_usd: reservedMax } : { status: "unknown", known_cost_usd: null, reserved_upper_bound_usd: reservedMax });
  const attemptRecord = {
    schema_version: "1.0.0", run_id: job.run_id, attempt: 1, started_at_utc: startedAt, ended_at_utc: endedAt,
    latency_ms: latencyMs, http_status: response.status, response_headers: selectedHeaders(response.headers),
    request_sha256: requestHash, intent_sha256: intentHash, frozen_manifest_sha256: frozen.manifest_sha256,
    provider_body_sha256: sha256(bytes), provider_body_bytes: bytes.length, billing,
    response: findings.length ? { quarantined: true, categories: findings, body_sha256: sha256(bytes), body_bytes: bytes.length } : projected,
    failure_code: costContractFailure || (findings.length ? "sensitive_output_quarantined" : (!response.ok || !parsed ? `http_or_parse_failure_${response.status}` : envelopeFailure)),
  };
  const attemptText = JSON.stringify(attemptRecord, null, 2) + "\n";
  await writeAtomicExclusive(attemptFile, attemptText);
  if (costContractFailure) throw new CostContractError(costContractFailure, billing);
  if (findings.length) throw new TerminalAttemptError("sensitive_output_quarantined", billing);
  if (!response.ok || !parsed) throw new TerminalAttemptError(`http_or_parse_failure_${response.status}`, billing);
  if (envelopeFailure) throw new TerminalAttemptError(envelopeFailure, billing);

  await materializeCanonical(projected, attemptRecord, attemptText);
  return { run_id: job.run_id, skipped: false, terminal_failure: false, billing, latency_ms: latencyMs };
}

export async function runBenchmark({ apiKey, fetchImpl = globalThis.fetch }) {
  if (typeof apiKey !== "string" || apiKey.length < 60) throw new Error("A valid in-memory API key is required");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");
  const spec = await loadSpec();
  validateBenchmarkConfig(spec.config);
  validatePricing(spec.priceSnapshot);
  const requestBody = requestBodyFor(spec);
  const requestFindings = sensitiveFindings(requestBody);
  if (requestFindings.length) throw new Error(`Sensitive benchmark input blocked: ${requestFindings.join(",")}`);
  const maximumPerRequest = maximumRequestCost(requestBody, spec.priceSnapshot);
  const guard = spec.priceSnapshot.cost_guard;
  if (!guard || guard.serialized_request_bytes !== Buffer.byteLength(JSON.stringify(requestBody), "utf8") || guard.conservative_input_units_per_request !== guard.serialized_request_bytes || guard.max_output_tokens_per_request !== spec.config.max_output_tokens || Math.abs(guard.reserved_upper_bound_per_request_usd - maximumPerRequest) > 1e-12 || Math.abs(guard.reserved_upper_bound_three_requests_usd - maximumPerRequest * 3) > 1e-12 || guard.hard_limit_usd !== spec.config.hard_cost_limit_usd) throw new Error("Frozen pricing cost guard mismatch");
  if (maximumPerRequest * 3 > spec.config.hard_cost_limit_usd) throw new Error("Frozen hard cost limit is below the three-request reservation");
  const frozen = await verifyFrozen();
  await ensureDirs();
  const summaryFile = path.join(ROOT, "evidence/run-summary.json");
  if (await exists(summaryFile)) {
    const summary = JSON.parse(await fs.readFile(summaryFile, "utf8"));
    const expectedIds = buildJobs(spec.config).map((item) => item.run_id);
    if (summary.frozen_manifest_sha256 !== frozen.manifest_sha256 || summary.requested !== 3 || !Array.isArray(summary.results) || summary.results.map((item) => item.run_id).join("|") !== expectedIds.join("|")) throw new Error("Existing run summary mismatch");
    await (await import("./verify-evidence.mjs")).verifyEvidence();
    return { ...summary, reused_summary: true };
  }
  const releaseRunLock = await acquireProcessLock("run");
  try {
    const results = [];
    for (const job of buildJobs(spec.config)) {
      try { results.push(await runOne({ apiKey, job, spec, frozen, fetchImpl })); }
      catch (error) {
        if (error instanceof CostContractError) throw error;
        if (!(error instanceof TerminalAttemptError)) throw error;
        results.push({ run_id: job.run_id, skipped: false, terminal_failure: true, failure_code: error.code, billing: error.billing });
      }
    }
    const knownCost = results.reduce((sum, item) => sum + Number(item.billing?.known_cost_usd || 0), 0);
    const unknown = results.filter((item) => item.billing?.status === "unknown");
    const summary = {
      schema_version: "1.0.0", completed_at_utc: new Date().toISOString(), frozen_manifest_sha256: frozen.manifest_sha256,
      requested: 3, completed: results.filter((item) => !item.terminal_failure).length,
      terminal_failures: results.filter((item) => item.terminal_failure).length,
      known_cost_usd: knownCost, unknown_attempts: unknown.length,
      unknown_reserved_upper_bound_usd: unknown.reduce((sum, item) => sum + Number(item.billing?.reserved_upper_bound_usd || 0), 0),
      maximum_total_cost_usd: knownCost + unknown.reduce((sum, item) => sum + Number(item.billing?.reserved_upper_bound_usd || 0), 0),
      reserved_upper_bound_three_requests_usd: maximumPerRequest * 3, results,
    };
    await writeAtomicExclusive(summaryFile, JSON.stringify(summary, null, 2) + "\n");
    return summary;
  } finally { await releaseRunLock(); }
}
