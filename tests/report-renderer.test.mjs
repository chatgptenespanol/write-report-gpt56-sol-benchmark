import test from "node:test";
import assert from "node:assert/strict";
import { renderArtifacts } from "../src/report-renderer.mjs";

test("editorial pass cannot make an automatically failed output publication eligible", () => {
  const result = {
    run_id: "write-report__gpt-5.6-sol__r1", repetition: 1, accepted: false,
    outcome: "canonical", model_returned: "gpt-5.6-sol", response_status: "completed",
    latency_ms: 100, input_tokens: 100, output_tokens: 100, estimated_cost_usd: 0.01,
    rules_passed: 17, rules_failed: 1, rules_not_run: 0, rules_total: 18, critical_failures: 1,
    rules: [{ id: "G01", category: "gate", critical: true, status: "fail", details: "fixture" }],
  };
  const summary = {
    model: "gpt-5.6-sol", dataset_id: "fixture", repetitions: 1, testable_outputs: 1,
    accepted_outputs: 0, semantic_review_required_outputs: 1,
    total_rules_passed: 17, total_rules_failed: 1, total_rules_not_run: 0, total_rule_slots: 18,
    run_summary: { known_cost_usd: 0.01, unknown_attempts: 0 },
  };
  const editorialReview = { runs: [{ run_id: result.run_id, overall: "pass" }] };
  const artifacts = renderArtifacts({ results: [result], summary, editorialReview });
  const article = JSON.parse(artifacts.articleSummaryText);
  const execution = JSON.parse(artifacts.executionText);
  assert.equal(article.editorial_review_passes, 1);
  assert.equal(article.approved_for_citation_outputs, 0);
  assert.equal(article.rows[0].approved_for_citation, false);
  assert.equal(execution.approved_for_citation_outputs, 0);
  assert.match(artifacts.csv, /^run_id,repetition,automatic_accepted,editorial_review,/u);
  assert.match(artifacts.report, /pass editorial/u);
  assert.match(artifacts.report, /aptas para citar como aprobadas[^\n]*0\/1/u);
});
