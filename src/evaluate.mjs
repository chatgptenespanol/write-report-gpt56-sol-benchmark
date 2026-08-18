import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./dataset.mjs";
import { outputText } from "./spec.mjs";
import { evaluateOutput } from "./evaluator-core.mjs";
import { ensureExactFile } from "./io.mjs";
import { verifyEvidence } from "./verify-evidence.mjs";

const NOT_RUN_RULES = ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "R12", "R13", "R14", "R15", "R16", "R17"];

function notTestable(reason) {
  const rules = [
    { id: "G01", category: "gate", critical: true, status: "fail", pass: false, details: reason },
    ...NOT_RUN_RULES.map((id) => ({ id, category: "not_executed", critical: false, status: "not_run", pass: null, details: "No se ejecutó tras fallar la puerta de salida" })),
  ];
  return { accepted: false, semantic_review_required: true, critical_failures: 1, rules, passed: 0, failed: 1, not_run: 17, total: 18 };
}

export async function evaluateRepository({ write = true } = {}) {
  const verified = await verifyEvidence();
  const results = [];
  for (const outcome of verified.outcomes) {
    let evaluation;
    let parseStatus = "not_available";
    if (outcome.status !== "canonical") {
      evaluation = notTestable(`Resultado terminal: ${outcome.failure_code}`);
    } else {
      const text = outputText(outcome.canonical.response);
      try {
        const parsed = JSON.parse(text);
        parseStatus = "valid_json";
        evaluation = evaluateOutput(parsed, verified.spec.groundTruth);
      } catch {
        parseStatus = "invalid_json";
        evaluation = notTestable("El texto de salida no es JSON válido");
      }
    }
    const result = {
      schema_version: "1.0.0", run_id: outcome.job.run_id, repetition: outcome.job.repetition,
      outcome: outcome.status, parse_status: parseStatus,
      accepted: evaluation.accepted, semantic_review_required: true, critical_failures: evaluation.critical_failures,
      rules_passed: evaluation.passed, rules_failed: evaluation.failed,
      rules_not_run: evaluation.not_run || 0, rules_total: evaluation.total,
      model_returned: outcome.canonical?.metadata?.model_returned || null,
      response_status: outcome.canonical?.metadata?.response_status || null,
      latency_ms: outcome.canonical?.metadata?.latency_ms ?? null,
      input_tokens: outcome.canonical?.metadata?.input_tokens ?? null,
      output_tokens: outcome.canonical?.metadata?.output_tokens ?? null,
      estimated_cost_usd: outcome.canonical?.metadata?.estimated_cost_usd ?? null,
      rules: evaluation.rules,
    };
    results.push(result);
    if (write) await ensureExactFile(path.join(ROOT, `results/${outcome.job.run_id}.json`), JSON.stringify(result, null, 2) + "\n");
  }
  const summary = {
    schema_version: "1.0.0", dataset_id: verified.spec.groundTruth.dataset_id,
    model: verified.spec.config.model, repetitions: 3,
    accepted_outputs: results.filter((item) => item.accepted).length,
    semantic_review_required_outputs: results.length,
    testable_outputs: results.filter((item) => item.parse_status === "valid_json").length,
    total_rules_passed: results.reduce((sum, item) => sum + item.rules_passed, 0),
    total_rules_failed: results.reduce((sum, item) => sum + item.rules_failed, 0),
    total_rules_not_run: results.reduce((sum, item) => sum + item.rules_not_run, 0),
    total_rule_slots: results.reduce((sum, item) => sum + item.rules_total, 0),
    run_summary: {
      completed_at_utc: verified.runSummary.completed_at_utc,
      completed: verified.runSummary.completed,
      terminal_failures: verified.runSummary.terminal_failures,
      known_cost_usd: verified.runSummary.known_cost_usd,
      unknown_attempts: verified.runSummary.unknown_attempts,
      maximum_total_cost_usd: verified.runSummary.maximum_total_cost_usd,
    },
    runs: results.map((item) => ({ run_id: item.run_id, automatic_accepted: item.accepted, semantic_review_required: true, outcome: item.outcome, model_returned: item.model_returned, response_status: item.response_status, latency_ms: item.latency_ms, input_tokens: item.input_tokens, output_tokens: item.output_tokens, estimated_cost_usd: item.estimated_cost_usd, passed: item.rules_passed, failed: item.rules_failed, not_run: item.rules_not_run, total: item.rules_total })),
  };
  if (write) await ensureExactFile(path.join(ROOT, "results/summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return { results, summary };
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) console.log(JSON.stringify((await evaluateRepository()).summary, null, 2));
