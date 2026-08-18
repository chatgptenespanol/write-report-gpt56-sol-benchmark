import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./dataset.mjs";
import { sha256 } from "./io.mjs";
import { outputText } from "./spec.mjs";
import { verifyEvidence } from "./verify-evidence.mjs";

export const EDITORIAL_CRITERIA = ["E01", "E02", "E03", "E04", "E05", "E06", "E07"];
const REVIEWER_TYPES = new Set(["site_owner", "external_human"]);

export function validateEditorialReview(review, verified) {
  if (review.schema_version !== "1.0.0" || review.method !== "editorial-review-protocol-v1" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(review.reviewed_at_utc)) throw new Error("Editorial review header mismatch");
  if (!review.reviewer || typeof review.reviewer.name !== "string" || review.reviewer.name.trim().length < 2 || !REVIEWER_TYPES.has(review.reviewer.type) || review.reviewer.human_attestation !== true) throw new Error("Editorial reviewer identity or human attestation mismatch");
  if (!Array.isArray(review.runs) || review.runs.length !== 3) throw new Error("Editorial review must contain three runs");
  for (let index = 0; index < verified.outcomes.length; index += 1) {
    const outcome = verified.outcomes[index];
    const entry = review.runs[index];
    const text = outcome.status === "canonical" ? outputText(outcome.canonical.response) : "";
    if (entry.run_id !== outcome.job.run_id || entry.output_sha256 !== sha256(text)) throw new Error(`Editorial review output mismatch: ${outcome.job.run_id}`);
    if (!Array.isArray(entry.decisions) || entry.decisions.length !== EDITORIAL_CRITERIA.length || entry.decisions.map((item) => item.id).join("|") !== EDITORIAL_CRITERIA.join("|")) throw new Error(`Editorial review criteria mismatch: ${outcome.job.run_id}`);
    for (const decision of entry.decisions) {
      if (!new Set(["pass", "fail", "not_testable"]).has(decision.status) || typeof decision.note !== "string") throw new Error(`Editorial review decision mismatch: ${outcome.job.run_id}`);
    }
    if (outcome.status !== "canonical" && entry.decisions.some((item) => item.status !== "not_testable")) throw new Error(`Terminal outcome must be editorially not_testable: ${outcome.job.run_id}`);
    const derived = entry.decisions.some((item) => item.status === "fail") ? "fail" : entry.decisions.some((item) => item.status === "not_testable") ? "not_testable" : "pass";
    if (entry.overall !== derived || typeof entry.notes !== "string") throw new Error(`Editorial review aggregate mismatch: ${outcome.job.run_id}`);
  }
  return review;
}

export async function verifyEditorialReview(verifiedInput) {
  const verified = verifiedInput || await verifyEvidence();
  const file = path.join(ROOT, "reviews/editorial-review.json");
  const review = JSON.parse(await fs.readFile(file, "utf8"));
  return validateEditorialReview(review, verified);
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const review = await verifyEditorialReview();
  console.log(JSON.stringify({ reviewed_runs: review.runs.length, reviewer_type: review.reviewer.type, outcomes: review.runs.map((item) => item.overall) }));
}
