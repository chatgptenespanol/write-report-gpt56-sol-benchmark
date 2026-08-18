import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NUMERIC_COLUMNS = new Set([
  "sessions", "orders", "gross_revenue_usd", "discounts_usd", "refunds_usd",
  "ad_spend_usd", "support_cases", "resolved_within_sla", "delivery_days_total",
  "nps_responses", "promoters", "detractors",
]);

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/u);
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const values = line.split(",");
    if (values.length !== headers.length) throw new Error("Malformed synthetic CSV row");
    return Object.fromEntries(headers.map((header, index) => [header, NUMERIC_COLUMNS.has(header) ? Number(values[index]) : values[index]]));
  });
}

export const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function sum(rows, key) { return rows.reduce((total, row) => total + Number(row[key]), 0); }

function evidenceIds(rows) { return rows.map((row) => row.evidence_id); }

export function computeGroundTruth(rows) {
  if (rows.length !== 18 || new Set(rows.map((row) => row.evidence_id)).size !== 18) throw new Error("Expected 18 unique synthetic rows");
  const all = rows;
  const paid = rows.filter((row) => row.channel === "paid");
  const april = rows.filter((row) => row.month === "2026-04");
  const june = rows.filter((row) => row.month === "2026-06");
  const gross = sum(all, "gross_revenue_usd");
  const discounts = sum(all, "discounts_usd");
  const refunds = sum(all, "refunds_usd");
  const orders = sum(all, "orders");
  const sessions = sum(all, "sessions");
  const net = gross - discounts - refunds;
  const paidGross = sum(paid, "gross_revenue_usd");
  const paidDiscounts = sum(paid, "discounts_usd");
  const paidRefunds = sum(paid, "refunds_usd");
  const paidNet = paidGross - paidDiscounts - paidRefunds;
  const paidSpend = sum(paid, "ad_spend_usd");
  const aprilConversion = sum(april, "orders") / sum(april, "sessions") * 100;
  const juneConversion = sum(june, "orders") / sum(june, "sessions") * 100;
  const allIds = evidenceIds(all);
  const paidIds = evidenceIds(paid);
  const aprJunIds = evidenceIds([...april, ...june]);

  const metric = (metricId, value, unit, numerator, denominator, formula, ids) => ({
    metric_id: metricId,
    value: round2(value),
    unit,
    numerator: round2(numerator),
    denominator: round2(denominator),
    formula,
    evidence_ids: ids,
  });

  return {
    schema_version: "1.0.0",
    dataset_id: "cg-report-synthetic-v2",
    generated_deterministically: true,
    row_count: rows.length,
    metrics: [
      metric("total_net_revenue_usd", net, "USD", net, 1, "sum(gross_revenue_usd) - sum(discounts_usd) - sum(refunds_usd)", allIds),
      metric("total_conversion_pct", orders / sessions * 100, "%", orders, sessions, "sum(orders) / sum(sessions) * 100", allIds),
      metric("net_aov_usd", net / orders, "USD", net, orders, "total_net_revenue_usd / sum(orders)", allIds),
      metric("discount_rate_pct", discounts / gross * 100, "%", discounts, gross, "sum(discounts_usd) / sum(gross_revenue_usd) * 100", allIds),
      metric("refund_rate_pct", refunds / gross * 100, "%", refunds, gross, "sum(refunds_usd) / sum(gross_revenue_usd) * 100", allIds),
      metric("sla_resolution_pct", sum(all, "resolved_within_sla") / sum(all, "support_cases") * 100, "%", sum(all, "resolved_within_sla"), sum(all, "support_cases"), "sum(resolved_within_sla) / sum(support_cases) * 100", allIds),
      metric("weighted_delivery_days", sum(all, "delivery_days_total") / orders, "días", sum(all, "delivery_days_total"), orders, "sum(delivery_days_total) / sum(orders)", allIds),
      metric("aggregate_nps", (sum(all, "promoters") - sum(all, "detractors")) / sum(all, "nps_responses") * 100, "puntos", sum(all, "promoters") - sum(all, "detractors"), sum(all, "nps_responses"), "(sum(promoters) - sum(detractors)) / sum(nps_responses) * 100", allIds),
      metric("conversion_change_apr_to_jun_pp", juneConversion - aprilConversion, "puntos porcentuales", juneConversion, aprilConversion, "conversion_pct_junio - conversion_pct_abril", aprJunIds),
      metric("paid_net_revenue_usd", paidNet, "USD", paidNet, 1, "sum_paid(gross_revenue_usd) - sum_paid(discounts_usd) - sum_paid(refunds_usd)", paidIds),
      metric("paid_ad_spend_usd", paidSpend, "USD", paidSpend, 1, "sum_paid(ad_spend_usd)", paidIds),
      metric("paid_roas_net", paidNet / paidSpend, "ratio", paidNet, paidSpend, "paid_net_revenue_usd / paid_ad_spend_usd", paidIds),
    ],
    audit_totals: {
      sessions, orders, gross_revenue_usd: gross, discounts_usd: discounts,
      refunds_usd: refunds, net_revenue_usd: net,
      support_cases: sum(all, "support_cases"), resolved_within_sla: sum(all, "resolved_within_sla"),
      delivery_days_total: sum(all, "delivery_days_total"), nps_responses: sum(all, "nps_responses"),
      promoters: sum(all, "promoters"), detractors: sum(all, "detractors"),
      april_conversion_pct: round2(aprilConversion), june_conversion_pct: round2(juneConversion),
      paid_net_revenue_usd: paidNet, paid_ad_spend_usd: paidSpend,
    },
  };
}

export async function loadRows() {
  return parseCsv(await fs.readFile(path.join(ROOT, "data/cg-report-synthetic-v2.csv"), "utf8"));
}
