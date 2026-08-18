export function validOutput(groundTruth) {
  return {
    title: "Informe ejecutivo verificable de Comercio Faro",
    scope: { entity: "Comercio Faro", period: "abril-junio de 2026", audience: "dirección de operaciones", currency: "USD" },
    executive_summary: [
      "El periodo reúne resultados sintéticos de tres mercados y dos canales que deben revisarse contra las filas citadas.",
      "Los indicadores agregados permiten describir volumen y eficiencia observada, pero no explican por sí solos los motivos de los cambios.",
      "Las propuestas siguientes son hipótesis de trabajo y requieren medición adicional antes de tomar una decisión operativa."
    ],
    facts: groundTruth.metrics.map((metric) => ({
      metric_id: metric.metric_id,
      label: `Métrica verificada: ${metric.metric_id}`,
      value: metric.value,
      unit: metric.unit,
      numerator: metric.numerator,
      denominator: metric.denominator,
      evidence_ids: metric.evidence_ids,
      interpretation_limit: "Este cálculo describe el conjunto sintético y no permite inferir una causa."
    })),
    interpretations: [
      { text: "La conversión agregada cambia entre abril y junio en el periodo observado.", metric_ids: ["conversion_change_apr_to_jun_pp"], evidence_ids: ["F001", "F002", "F003", "F004", "F005", "F006", "F013", "F014", "F015", "F016", "F017", "F018"], uncertainty: "No existe un grupo de control que permita explicar el cambio." },
      { text: "El canal de pago reúne ingresos netos y gasto publicitario medibles en el registro.", metric_ids: ["paid_net_revenue_usd", "paid_ad_spend_usd", "paid_roas_net"], evidence_ids: ["F002", "F004", "F006", "F008", "F010", "F012", "F014", "F016", "F018"], uncertainty: "Faltan costes de producto y operación para evaluar el resultado económico." }
    ],
    recommendations: [
      { hypothesis: "Una prueba acotada de asignación puede cambiar la conversión observada.", action: "Definir un experimento con grupo de control y un periodo previo documentado.", success_metric: "Cambio de conversión en puntos porcentuales", metric_ids: ["conversion_change_apr_to_jun_pp"], evidence_ids: ["F001", "F002", "F003", "F004", "F005", "F006", "F013", "F014", "F015", "F016", "F017", "F018"] },
      { hypothesis: "Revisar el proceso de soporte puede cambiar el cumplimiento del SLA.", action: "Auditar una muestra de casos y registrar causas operativas verificables.", success_metric: "Porcentaje resuelto dentro del SLA", metric_ids: ["sla_resolution_pct"], evidence_ids: Array.from({ length: 18 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`) },
      { hypothesis: "Una revisión de descuentos puede cambiar los ingresos netos observados.", action: "Probar una regla limitada y medir pedidos, descuentos y reembolsos.", success_metric: "Ingresos netos y tasa de descuento", metric_ids: ["discount_rate_pct"], evidence_ids: Array.from({ length: 18 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`) }
    ],
    limitations: [
      "Todos los datos son sintéticos y no representan una empresa real.",
      "El periodo de tres meses es corto para generalizar tendencias.",
      "El NPS usa su propia muestra de respuestas y no todos los pedidos.",
      "No se puede determinar beneficio, margen, utilidad, lucro ni rentabilidad con este conjunto de datos.",
      "No se puede atribuir causalidad con este conjunto de datos; cualquier explicación es una hipótesis que requiere un diseño causal."
    ],
    missing_data: ["Margen o coste de producto", "Inventario disponible", "Cohortes o clientes repetidos", "Grupo de control o diseño causal"],
    source_registry: Array.from({ length: 18 }, (_, index) => ({ evidence_id: `F${String(index + 1).padStart(3, "0")}`, source_type: "fila_dataset_sintetico", description: `Fila sintética ${index + 1} del archivo CSV congelado` })),
    verification_checklist: [
      "Recalcular cada indicador desde el CSV.", "Comprobar unidades y periodos.",
      "Confirmar cada identificador de evidencia.", "Separar hechos de interpretaciones.",
      "Revisar hipótesis antes de actuar.", "Registrar los datos que faltan."
    ]
  };
}
