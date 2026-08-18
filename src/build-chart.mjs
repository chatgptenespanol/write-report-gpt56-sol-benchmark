import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./dataset.mjs";
import { ensureExactFile } from "./io.mjs";

export function renderChart(summary) {
  const width = 1200;
  const height = 675;
  const bars = summary.runs.map((run, index) => {
    const ratio = run.total ? run.passed / run.total : 0;
    const x = 160 + index * 330;
    const barHeight = Math.round(ratio * 300);
    const y = 510 - barHeight;
    const color = run.automatic_accepted ? "#157347" : "#b54708";
    return `<g><rect x="${x}" y="${y}" width="190" height="${barHeight}" rx="12" fill="${color}"/><text x="${x + 95}" y="${y - 20}" text-anchor="middle" font-size="34" font-weight="700" fill="#102a43">${run.passed}/${run.total}</text><text x="${x + 95}" y="560" text-anchor="middle" font-size="28" fill="#334e68">r${index + 1}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc"><title id="chart-title">Reglas automáticas superadas por repetición</title><desc id="chart-desc">Conteo de reglas automáticas; no representa una puntuación general de calidad y exige revisión editorial humana.</desc><rect width="1200" height="675" fill="#f7fafc"/><text x="600" y="74" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="700" fill="#102a43">Informe verificable: reglas automáticas</text><text x="600" y="116" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#486581">GPT-5.6 Sol · dataset sintético · 18 reglas por repetición</text><line x1="110" y1="510" x2="1090" y2="510" stroke="#bcccdc" stroke-width="3"/>${bars}<text x="600" y="630" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" fill="#627d98">Requiere revisión editorial humana; no es un benchmark general de ChatGPT.</text></svg>\n`;
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const summary = JSON.parse(await fs.readFile(path.join(ROOT, "results/summary.json"), "utf8"));
  await ensureExactFile(path.join(ROOT, "charts/rule-pass-summary.svg"), renderChart(summary));
  console.log(JSON.stringify({ chart: "charts/rule-pass-summary.svg", runs: summary.runs.length }));
}
