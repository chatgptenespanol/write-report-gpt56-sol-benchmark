import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, parseCsv } from "./dataset.mjs";

export async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relative), "utf8"));
}

export async function readText(relative) {
  return fs.readFile(path.join(ROOT, relative), "utf8");
}

export async function loadSpec() {
  const [config, prompt, schema, priceSnapshot, csvText, dictionary, groundTruth] = await Promise.all([
    readJson("configs/request.json"), readText("benchmark/prompt.md"),
    readJson("benchmark/output.schema.json"), readJson("benchmark/price-snapshot.json"),
    readText("data/cg-report-synthetic-v2.csv"), readJson("data/data-dictionary.json"),
    readJson("data/ground-truth.json"),
  ]);
  return { config, prompt, schema, priceSnapshot, csvText, rows: parseCsv(csvText), dictionary, groundTruth };
}

export function validateBenchmarkConfig(config) {
  const exact = {
    endpoint: "https://api.openai.com/v1/responses",
    model: "gpt-5.6-sol",
    repetitions: 3,
    reasoning: { effort: "medium", context: "current_turn" },
    max_output_tokens: 6000,
    verbosity: "medium",
    service_tier: "default",
    store: false,
    stream: false,
    tools: [],
    request_timeout_ms: 600000,
    hard_cost_limit_usd: 0.75,
  };
  if (JSON.stringify(config) !== JSON.stringify(exact)) throw new Error("Benchmark config differs from the approved exact configuration");
  return config;
}

export function safeRunId(value) {
  if (!/^write-report__gpt-5\.6-sol__r[1-3]$/u.test(value)) throw new Error(`Unsafe run id: ${value}`);
  return value;
}

export function buildJobs(config) {
  validateBenchmarkConfig(config);
  return Array.from({ length: 3 }, (_, index) => ({
    run_id: safeRunId(`write-report__${config.model}__r${index + 1}`),
    sequence: index + 1,
    repetition: index + 1,
    model: config.model,
  }));
}

function responseSchemaForApi(schema) {
  const copy = structuredClone(schema);
  delete copy.$schema;
  return copy;
}

export function requestBodyFor(spec) {
  const inputText = `${spec.prompt}\n\n## CSV literal\n\n\`\`\`csv\n${spec.csvText.trim()}\n\`\`\`\n\n## Diccionario literal\n\n\`\`\`json\n${JSON.stringify(spec.dictionary, null, 2)}\n\`\`\``;
  return {
    model: spec.config.model,
    input: [
      {
        role: "system",
        content: "Genera un borrador de informe verificable usando únicamente los datos sintéticos proporcionados. Respeta el esquema, no inventes hechos y separa hechos, interpretaciones e hipótesis.",
      },
      { role: "user", content: inputText },
    ],
    reasoning: spec.config.reasoning,
    max_output_tokens: spec.config.max_output_tokens,
    service_tier: spec.config.service_tier,
    store: spec.config.store,
    stream: spec.config.stream,
    tools: spec.config.tools,
    text: { verbosity: spec.config.verbosity, format: { type: "json_schema", name: "verified_business_report", strict: true, schema: responseSchemaForApi(spec.schema) } },
  };
}

export function outputText(response) {
  const chunks = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("");
}
