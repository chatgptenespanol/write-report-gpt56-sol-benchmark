const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function renderArtifacts({ results, summary, editorialReview }) {
  const reviewByRun = new Map(editorialReview.runs.map((item) => [item.run_id, item]));
  const rows = ["run_id,repetition,automatic_accepted,editorial_review,rule_id,category,critical,status,details"];
  for (const result of results) {
    for (const rule of result.rules) {
      rows.push([result.run_id, result.repetition, result.accepted, reviewByRun.get(result.run_id).overall, rule.id, rule.category, rule.critical, rule.status, rule.details].map(csvCell).join(","));
    }
  }
  const csv = rows.join("\n") + "\n";
  const reviewPasses = editorialReview.runs.filter((item) => item.overall === "pass").length;
  const publicationEligible = results.filter((item) => item.accepted && reviewByRun.get(item.run_id).overall === "pass").length;
  const report = `# Resultado de la evaluación\n\n` +
    `- Modelo solicitado: \`${summary.model}\`\n` +
    `- Dataset: \`${summary.dataset_id}\`\n` +
    `- Repeticiones: ${summary.repetitions}\n` +
    `- Salidas evaluables: ${summary.testable_outputs}/${summary.repetitions}\n` +
    `- Salidas que superaron las reglas automáticas: ${summary.accepted_outputs}/${summary.repetitions}\n` +
    `- Revisiones editoriales completadas: ${editorialReview.runs.length}/${summary.repetitions}; pass editorial: ${reviewPasses}/${summary.repetitions}\n` +
    `- Salidas aptas para citar como aprobadas (reglas automáticas + revisión editorial): ${publicationEligible}/${summary.repetitions}\n` +
    `- Reglas automáticas: ${summary.total_rules_passed} pass, ${summary.total_rules_failed} fail, ${summary.total_rules_not_run} not_run de ${summary.total_rule_slots}\n` +
    `- Coste conocido: USD ${Number(summary.run_summary.known_cost_usd || 0).toFixed(6)}\n` +
    `- Intentos con coste desconocido: ${summary.run_summary.unknown_attempts}\n\n` +
    `## Resultados por repetición\n\n` +
    `| Repetición | Auto | Revisión editorial | Pass | Fail | Not run | Total |\n|---|---:|---:|---:|---:|---:|---:|\n` +
    results.map((item) => `| ${item.run_id} | ${item.accepted ? "sí" : "no"} | ${reviewByRun.get(item.run_id).overall} | ${item.rules_passed} | ${item.rules_failed} | ${item.rules_not_run} | ${item.rules_total} |`).join("\n") +
    `\n\nLa aceptación automática no es una aprobación editorial. Los resultados describen únicamente este dataset, prompt, modelo, configuración y fecha. Consulte \`LIMITATIONS.md\` y \`editorial-review-protocol.md\`.\n`;
  const articleSummary = {
    schema_version: "1.0.0",
    model_requested: summary.model,
    dataset_id: summary.dataset_id,
    repetitions: summary.repetitions,
    automatic_accepted_outputs: summary.accepted_outputs,
    editorial_review_passes: reviewPasses,
    approved_for_citation_outputs: publicationEligible,
    known_cost_usd: summary.run_summary.known_cost_usd,
    unknown_attempts: summary.run_summary.unknown_attempts,
    rows: results.map((item) => ({
      run_id: item.run_id,
      outcome: item.outcome,
      model_returned: item.model_returned,
      response_status: item.response_status,
      latency_ms: item.latency_ms,
      input_tokens: item.input_tokens,
      output_tokens: item.output_tokens,
      estimated_cost_usd: item.estimated_cost_usd,
      automatic_accepted: item.accepted,
      editorial_review: reviewByRun.get(item.run_id).overall,
      approved_for_citation: item.accepted && reviewByRun.get(item.run_id).overall === "pass",
      rules_passed: item.rules_passed,
      rules_failed: item.rules_failed,
      rules_not_run: item.rules_not_run,
      rules_total: item.rules_total,
    })),
  };
  const execution = {
    schema_version: "1.0.0",
    model: summary.model,
    dataset_id: summary.dataset_id,
    repetitions: summary.repetitions,
    testable_outputs: summary.testable_outputs,
    automatic_accepted_outputs: summary.accepted_outputs,
    semantic_review_required_outputs: summary.semantic_review_required_outputs,
    editorial_review_completed: editorialReview.runs.length,
    editorial_review_passes: reviewPasses,
    approved_for_citation_outputs: publicationEligible,
    rules_passed: summary.total_rules_passed,
    rules_failed: summary.total_rules_failed,
    rules_not_run: summary.total_rules_not_run,
    rules_total: summary.total_rule_slots,
    cost: summary.run_summary,
    rows: results.map((item) => ({ run_id: item.run_id, automatic_accepted: item.accepted, editorial_review: reviewByRun.get(item.run_id).overall, approved_for_citation: item.accepted && reviewByRun.get(item.run_id).overall === "pass", passed: item.rules_passed, failed: item.rules_failed, not_run: item.rules_not_run, total: item.rules_total, critical_failures: item.critical_failures })),
  };
  return {
    csv,
    report,
    executionText: JSON.stringify(execution, null, 2) + "\n",
    articleSummaryText: JSON.stringify(articleSummary, null, 2) + "\n",
  };
}
