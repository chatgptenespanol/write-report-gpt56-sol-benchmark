import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { evaluateOutput, validateOutputStructure } from "../src/evaluator-core.mjs";
import { ROOT } from "../src/dataset.mjs";
import { validOutput } from "./fixture.mjs";

const groundTruth = JSON.parse(await fs.readFile(new URL("../data/ground-truth.json", import.meta.url), "utf8"));

test("valid fixture passes all deterministic rules", () => {
  const result = evaluateOutput(validOutput(groundTruth), groundTruth);
  assert.equal(result.accepted, true);
  assert.equal(result.passed, 18);
  assert.equal(result.failed, 0);
});

test("wrong numeric value is critical", () => {
  const fixture = validOutput(groundTruth);
  fixture.facts[0].value += 1;
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.accepted, false);
  assert.equal(result.rules.find((item) => item.id === "R02").pass, false);
});

test("half-cent rounding drift is rejected instead of accepted by tolerance", () => {
  const fixture = validOutput(groundTruth);
  const fact = fixture.facts.find((item) => item.metric_id === "total_conversion_pct");
  fact.value = Number(fact.value) + 0.005;
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.accepted, false);
  assert.equal(result.rules.find((item) => item.id === "R02").pass, false);
});

test("empty labels and checklist entries fail the structure gate", () => {
  const emptyLabel = validOutput(groundTruth);
  emptyLabel.facts[0].label = "";
  assert.equal(evaluateOutput(emptyLabel, groundTruth).rules.find((item) => item.id === "G01").pass, false);
  const emptyChecklist = validOutput(groundTruth);
  emptyChecklist.verification_checklist[0] = "   ";
  assert.equal(evaluateOutput(emptyChecklist, groundTruth).rules.find((item) => item.id === "G01").pass, false);
});

test("duplicate metric cannot hide an omission", () => {
  const fixture = validOutput(groundTruth);
  fixture.facts[1].metric_id = fixture.facts[0].metric_id;
  assert.equal(evaluateOutput(fixture, groundTruth).rules.find((item) => item.id === "R01").pass, false);
});

test("free formula text is rejected instead of being mistaken for verified math", () => {
  const fixture = validOutput(groundTruth);
  fixture.facts[0].formula = "xyz";
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.accepted, false);
  assert.equal(result.rules.find((item) => item.id === "G01").pass, false);
});

test("a syntactically valid but unrelated evidence id cannot satisfy traceability", () => {
  const fixture = validOutput(groundTruth);
  fixture.interpretations[0].evidence_ids = ["F001"];
  fixture.recommendations[0].evidence_ids = ["F001"];
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.accepted, false);
  assert.equal(result.rules.find((item) => item.id === "R07").pass, false);
});

test("the exact profit boundary is required", () => {
  const fixture = validOutput(groundTruth);
  fixture.limitations = fixture.limitations.filter((item) => !item.startsWith("No se puede determinar beneficio"));
  fixture.limitations.push("Límite económico omitido.");
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.rules.find((item) => item.id === "R10").pass, false);
});

test("the exact causality boundary is required", () => {
  const fixture = validOutput(groundTruth);
  fixture.limitations = fixture.limitations.filter((item) => !item.startsWith("No se puede atribuir causalidad"));
  fixture.limitations.push("Límite causal omitido.");
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.rules.find((item) => item.id === "R11").pass, false);
});

test("automatic acceptance is explicitly not a semantic editorial review", () => {
  const fixture = validOutput(groundTruth);
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.semantic_review_required, true);
});

test("missing-data cannot carry an unsupported profit or causal claim", () => {
  const fixture = validOutput(groundTruth);
  fixture.missing_data.push("El canal pagado causó la mejora y los ingresos netos son beneficio confirmado.");
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.accepted, false);
  assert.equal(result.rules.find((item) => item.id === "G01").pass, false);
});

test("source descriptions must identify the exact frozen row", () => {
  const fixture = validOutput(groundTruth);
  fixture.source_registry[0].description = "Descripción genérica";
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.accepted, false);
  assert.equal(result.rules.find((item) => item.id === "R06").pass, false);
});

test("unexpected personal data fails without embedding a live address in source", () => {
  const fixture = validOutput(groundTruth);
  fixture.title = ["Informe de", ["persona", "gmail.com"].join("@")].join(" ");
  assert.equal(evaluateOutput(fixture, groundTruth).rules.find((item) => item.id === "R16").pass, false);
});

test("missing root field fails structure gate", () => {
  const fixture = validOutput(groundTruth);
  delete fixture.limitations;
  assert.ok(validateOutputStructure(fixture).length > 0);
  const result = evaluateOutput(fixture, groundTruth);
  assert.equal(result.total, 18);
  assert.equal(result.failed, 1);
  assert.equal(result.not_run, 17);
  assert.equal(result.rules.filter((item) => item.status === "not_run").length, 17);
});

test("nested additional properties and more than three metric ids fail the structure gate", () => {
  const extraScope = validOutput(groundTruth);
  extraScope.scope.extra = "x";
  assert.equal(evaluateOutput(extraScope, groundTruth).rules.find((item) => item.id === "G01").pass, false);
  const tooManyMetrics = validOutput(groundTruth);
  tooManyMetrics.recommendations[0].metric_ids = ["total_conversion_pct", "conversion_change_apr_to_jun_pp", "paid_roas_net", "discount_rate_pct"];
  assert.equal(evaluateOutput(tooManyMetrics, groundTruth).rules.find((item) => item.id === "G01").pass, false);
});
