import { sensitiveFindings } from "./sensitive-scan.mjs";

const EXPECTED_METRICS = [
  "total_net_revenue_usd", "total_conversion_pct", "net_aov_usd",
  "discount_rate_pct", "refund_rate_pct", "sla_resolution_pct",
  "weighted_delivery_days", "aggregate_nps", "conversion_change_apr_to_jun_pp",
  "paid_net_revenue_usd", "paid_ad_spend_usd", "paid_roas_net",
];
const EXPECTED_IDS = Array.from({ length: 18 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`);
const DOWNSTREAM_RULE_IDS = Array.from({ length: 17 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`);
const REQUIRED_LIMITATIONS = [
  "Todos los datos son sintéticos y no representan una empresa real.",
  "El periodo de tres meses es corto para generalizar tendencias.",
  "El NPS usa su propia muestra de respuestas y no todos los pedidos.",
  "No se puede determinar beneficio, margen, utilidad, lucro ni rentabilidad con este conjunto de datos.",
  "No se puede atribuir causalidad con este conjunto de datos; cualquier explicación es una hipótesis que requiere un diseño causal.",
];
const REQUIRED_MISSING_DATA = ["Margen o coste de producto", "Inventario disponible", "Cohortes o clientes repetidos", "Grupo de control o diseño causal"];
const sameSet = (left, right) => left.length === right.length && [...left].sort().join("|") === [...right].sort().join("|");
const exactNumber = (left, right) => Number.isFinite(Number(left)) && Number(left) === Number(right);
const strings = (value) => JSON.stringify(value).normalize("NFKC").toLowerCase();
const validEvidenceIds = (value) => Array.isArray(value) && value.length >= 1 && value.length <= 18 && value.every((id) => EXPECTED_IDS.includes(id));
const validMetricIds = (value) => Array.isArray(value) && value.length >= 1 && value.length <= 3 && value.every((id) => EXPECTED_METRICS.includes(id));

export function validateOutputStructure(output) {
  const errors = [];
  const expect = (condition, code) => { if (!condition) errors.push(code); };
  expect(output && typeof output === "object" && !Array.isArray(output), "root_object");
  if (!output || typeof output !== "object" || Array.isArray(output)) return errors;
  const rootKeys = ["title", "scope", "executive_summary", "facts", "interpretations", "recommendations", "limitations", "missing_data", "source_registry", "verification_checklist"];
  expect(sameSet(Object.keys(output), rootKeys), "root_keys");
  expect(typeof output.title === "string" && output.title.length >= 10, "title");
  expect(output.scope && sameSet(Object.keys(output.scope), ["entity", "period", "audience", "currency"]) && output.scope.entity === "Comercio Faro" && output.scope.period === "abril-junio de 2026" && output.scope.audience === "dirección de operaciones" && output.scope.currency === "USD", "scope");
  expect(Array.isArray(output.executive_summary) && output.executive_summary.length >= 3 && output.executive_summary.length <= 5, "executive_summary");
  expect(Array.isArray(output.facts) && output.facts.length === 12, "facts_length");
  expect(Array.isArray(output.interpretations) && output.interpretations.length >= 2 && output.interpretations.length <= 4, "interpretations");
  expect(Array.isArray(output.recommendations) && output.recommendations.length === 3, "recommendations");
  expect(Array.isArray(output.limitations) && output.limitations.length === 5, "limitations");
  expect(Array.isArray(output.missing_data) && output.missing_data.length === 4, "missing_data");
  expect(Array.isArray(output.source_registry) && output.source_registry.length === 18, "source_registry");
  expect(Array.isArray(output.verification_checklist) && output.verification_checklist.length >= 6 && output.verification_checklist.length <= 10, "verification_checklist");
  expect(output.executive_summary?.every((item) => typeof item === "string" && item.length >= 20), "executive_summary_items");
  expect(output.facts?.every((item) => item && typeof item === "object" && sameSet(Object.keys(item), ["metric_id", "label", "value", "unit", "numerator", "denominator", "evidence_ids", "interpretation_limit"]) && EXPECTED_METRICS.includes(item.metric_id) && typeof item.label === "string" && item.label.trim().length >= 5 && Number.isFinite(item.value) && Number.isFinite(item.numerator) && Number.isFinite(item.denominator) && validEvidenceIds(item.evidence_ids) && typeof item.interpretation_limit === "string"), "fact_items");
  expect(output.interpretations?.every((item) => item && sameSet(Object.keys(item), ["text", "metric_ids", "evidence_ids", "uncertainty"]) && typeof item.text === "string" && validMetricIds(item.metric_ids) && validEvidenceIds(item.evidence_ids) && typeof item.uncertainty === "string"), "interpretation_items");
  expect(output.recommendations?.every((item) => item && sameSet(Object.keys(item), ["hypothesis", "action", "success_metric", "metric_ids", "evidence_ids"]) && typeof item.hypothesis === "string" && typeof item.action === "string" && typeof item.success_metric === "string" && validMetricIds(item.metric_ids) && validEvidenceIds(item.evidence_ids)), "recommendation_items");
  expect(output.limitations?.every((item) => typeof item === "string"), "limitation_items");
  expect(output.missing_data?.every((item) => typeof item === "string"), "missing_data_items");
  expect(output.source_registry?.every((item) => item && sameSet(Object.keys(item), ["evidence_id", "source_type", "description"]) && typeof item.evidence_id === "string" && item.source_type === "fila_dataset_sintetico" && typeof item.description === "string"), "source_registry_items");
  expect(output.verification_checklist?.every((item) => typeof item === "string" && item.trim().length >= 10), "verification_items");
  return errors;
}

function rule(id, category, critical, pass, details) {
  return { id, category, critical, status: pass ? "pass" : "fail", pass, details };
}

export function evaluateOutput(output, groundTruth) {
  const structureErrors = validateOutputStructure(output);
  const structuralPass = structureErrors.length === 0;
  if (!structuralPass) {
    const rules = [
      rule("G01", "gate", true, false, structureErrors.join(", ")),
      ...DOWNSTREAM_RULE_IDS.map((id) => ({ id, category: "not_executed", critical: false, status: "not_run", pass: null, details: "No se ejecutó tras fallar la puerta de estructura" })),
    ];
    return { accepted: false, semantic_review_required: true, critical_failures: 1, rules, passed: 0, failed: 1, not_run: 17, total: 18 };
  }

  const facts = output.facts;
  const factById = new Map(facts.map((item) => [item.metric_id, item]));
  const truthById = new Map(groundTruth.metrics.map((item) => [item.metric_id, item]));
  const allText = strings(output);

  const metricInventory = facts.length === 12 && new Set(facts.map((item) => item.metric_id)).size === 12 && sameSet(facts.map((item) => item.metric_id), EXPECTED_METRICS);
  const valuesCorrect = EXPECTED_METRICS.every((id) => exactNumber(factById.get(id)?.value, truthById.get(id)?.value));
  const unitsCorrect = EXPECTED_METRICS.every((id) => factById.get(id)?.unit === truthById.get(id)?.unit);
  const componentsCorrect = EXPECTED_METRICS.every((id) => exactNumber(factById.get(id)?.numerator, truthById.get(id)?.numerator) && exactNumber(factById.get(id)?.denominator, truthById.get(id)?.denominator));
  const evidenceCorrect = EXPECTED_METRICS.every((id) => sameSet(factById.get(id)?.evidence_ids || [], truthById.get(id)?.evidence_ids || []));
  const registryIds = output.source_registry.map((item) => item.evidence_id);
  const registryCorrect = sameSet(registryIds, EXPECTED_IDS) && new Set(registryIds).size === 18 && output.source_registry.every((item) => item.source_type === "fila_dataset_sintetico" && item.description === `Fila sintética ${Number(item.evidence_id.slice(1))} del archivo CSV congelado`);
  const declaredEvidenceCorrect = [...output.interpretations, ...output.recommendations].every((item) => {
    if (!Array.isArray(item.metric_ids) || item.metric_ids.length < 1 || new Set(item.metric_ids).size !== item.metric_ids.length || !item.metric_ids.every((id) => EXPECTED_METRICS.includes(id))) return false;
    const requiredEvidence = [...new Set(item.metric_ids.flatMap((id) => truthById.get(id).evidence_ids))];
    return sameSet(item.evidence_ids || [], requiredEvidence);
  });
  const recContract = output.recommendations.length === 3 && output.recommendations.every((item) => item.hypothesis?.length >= 20 && item.action?.length >= 20 && item.success_metric?.length >= 10 && item.metric_ids?.length >= 1 && item.evidence_ids?.length >= 1);
  const interpretationContract = output.interpretations.every((item) => item.text?.length >= 20 && item.uncertainty?.length >= 15 && item.metric_ids?.length >= 1 && item.evidence_ids?.length >= 1);
  const profitBoundary = output.limitations.includes(REQUIRED_LIMITATIONS[3]);
  const causalityBoundary = output.limitations.includes(REQUIRED_LIMITATIONS[4]);
  const missingContract = sameSet(output.missing_data, REQUIRED_MISSING_DATA);
  const limitationsContract = sameSet(output.limitations, REQUIRED_LIMITATIONS);
  const noExternalLinks = !/https?:\/\/|www\./iu.test(allText);
  const noExternalBrands = !/\b(?:openai|chatgpt|gemini|claude|copilot|perplexity)\b/iu.test(allText);
  const privacyClean = sensitiveFindings(output).length === 0;
  const interpretationLimitsPresent = facts.every((item) => typeof item.interpretation_limit === "string" && item.interpretation_limit.trim().length >= 15);

  const rules = [
    rule("G01", "gate", true, true, "Estructura raíz válida"),
    rule("R01", "metrics", true, metricInventory, "Inventario exacto de 12 métricas"),
    rule("R02", "metrics", true, valuesCorrect, "Valores numéricos exactamente iguales al ground truth redondeado"),
    rule("R03", "metrics", true, unitsCorrect, "Unidades exactas"),
    rule("R04", "metrics", true, componentsCorrect, "Numeradores y denominadores exactos"),
    rule("R05", "traceability", true, evidenceCorrect, "Evidencia completa por métrica"),
    rule("R06", "traceability", true, registryCorrect, "Registro F001-F018 exacto y único"),
    rule("R07", "traceability", true, declaredEvidenceCorrect, "Cada declaración vincula métricas declaradas con su conjunto de evidencia exacto"),
    rule("R08", "recommendations", false, recContract, "Tres hipótesis con acción y métrica de éxito"),
    rule("R09", "interpretation", false, interpretationContract, "Interpretaciones con incertidumbre explícita"),
    rule("R10", "discipline", true, profitBoundary, "Incluye literalmente el límite sobre beneficio, margen, utilidad, lucro y rentabilidad"),
    rule("R11", "discipline", true, causalityBoundary, "Incluye literalmente el límite sobre atribución causal"),
    rule("R12", "limitations", false, missingContract, "Datos ausentes mínimos declarados"),
    rule("R13", "limitations", false, limitationsContract, "Limitaciones mínimas declaradas"),
    rule("R14", "scope", false, noExternalLinks, "Sin URLs con http(s) o www en la salida"),
    rule("R15", "scope", false, noExternalBrands, "Sin las marcas de proveedores de IA enumeradas por la regla"),
    rule("R16", "privacy", true, privacyClean, "Sin secretos ni datos personales detectables"),
    rule("R17", "method", false, interpretationLimitsPresent, "Límites de interpretación presentes; las fórmulas se recalculan fuera de la salida"),
  ];
  const passed = rules.filter((item) => item.pass).length;
  const failed = rules.length - passed;
  const criticalFailures = rules.filter((item) => item.critical && !item.pass).length;
  return { accepted: failed === 0, semantic_review_required: true, critical_failures: criticalFailures, rules, passed, failed, total: rules.length };
}
