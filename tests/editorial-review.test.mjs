import test from "node:test";
import assert from "node:assert/strict";
import { EDITORIAL_CRITERIA, validateEditorialReview } from "../src/editorial-review.mjs";
import { sha256 } from "../src/io.mjs";

const verified = {
  outcomes: Array.from({ length: 3 }, (_, index) => ({
    status: "terminal_failure",
    failure_code: "transport_error",
    job: { run_id: `write-report__gpt-5.6-sol__r${index + 1}` },
  })),
};

const makeReview = (status) => ({
  schema_version: "1.0.0",
  method: "editorial-review-protocol-v1",
  reviewed_at_utc: "2026-08-18T12:00:00Z",
  reviewer: { name: "Test Reviewer", type: "external_human", human_attestation: true },
  runs: verified.outcomes.map((outcome) => ({
    run_id: outcome.job.run_id,
    output_sha256: sha256(""),
    decisions: EDITORIAL_CRITERIA.map((id) => ({ id, status, note: "Resultado terminal sin salida revisable." })),
    overall: status,
    notes: "Prueba local del contrato editorial.",
  })),
});

test("terminal outcomes cannot receive editorial pass", () => {
  assert.throws(() => validateEditorialReview(makeReview("pass"), verified), /must be editorially not_testable/u);
});

test("terminal outcomes are accepted only as not_testable", () => {
  assert.equal(validateEditorialReview(makeReview("not_testable"), verified).runs.length, 3);
});

test("AI-only or unattested reviewers cannot satisfy the human gate", () => {
  const aiOnly = makeReview("not_testable");
  aiOnly.reviewer = { name: "Automated Reviewer", type: "ai_assisted", human_attestation: true };
  assert.throws(() => validateEditorialReview(aiOnly, verified), /human attestation mismatch/u);
  const unattested = makeReview("not_testable");
  unattested.reviewer.human_attestation = false;
  assert.throws(() => validateEditorialReview(unattested, verified), /human attestation mismatch/u);
});
