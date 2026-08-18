import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./dataset.mjs";
import { renderArtifacts } from "./report-renderer.mjs";
import { ensureExactFile } from "./io.mjs";
import { verifyEditorialReview } from "./editorial-review.mjs";

const summary = JSON.parse(await fs.readFile(path.join(ROOT, "results/summary.json"), "utf8"));
const results = await Promise.all(summary.runs.map((item) => fs.readFile(path.join(ROOT, `results/${item.run_id}.json`), "utf8").then(JSON.parse)));
const editorialReview = await verifyEditorialReview();
const artifacts = renderArtifacts({ results, summary, editorialReview });
await ensureExactFile(path.join(ROOT, "reports/rule-results.csv"), artifacts.csv);
await ensureExactFile(path.join(ROOT, "reports/report.md"), artifacts.report);
await ensureExactFile(path.join(ROOT, "reports/execution-summary.json"), artifacts.executionText);
await ensureExactFile(path.join(ROOT, "reports/article-summary.json"), artifacts.articleSummaryText);
console.log(JSON.stringify({ results: results.length, report: "reports/report.md" }));
