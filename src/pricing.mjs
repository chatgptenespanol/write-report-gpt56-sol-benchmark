export function validatePricing(snapshot) {
  const prices = snapshot?.per_million_tokens;
  if (snapshot?.model !== "gpt-5.6-sol" || snapshot?.service_tier !== "default" || snapshot?.currency !== "USD") throw new Error("Unexpected pricing snapshot identity");
  for (const key of ["input", "cached_input", "cache_write_input", "output"]) {
    if (!Number.isFinite(Number(prices?.[key])) || Number(prices[key]) <= 0) throw new Error(`Invalid price: ${key}`);
  }
  return snapshot;
}

export function validateUsage(response, { maxInputTokens, maxOutputTokens }) {
  const usage = response?.usage;
  const values = {
    input: Number(usage?.input_tokens),
    output: Number(usage?.output_tokens),
    total: Number(usage?.total_tokens),
    cached: Number(usage?.input_tokens_details?.cached_tokens || 0),
    cacheWrite: Number(usage?.input_tokens_details?.cache_write_tokens || 0),
    reasoning: Number(usage?.output_tokens_details?.reasoning_tokens || 0),
  };
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid usage counter: ${name}`);
  }
  if (values.input > maxInputTokens) throw new Error("Reported input tokens exceed the conservative input bound");
  if (values.output > maxOutputTokens) throw new Error("Reported output tokens exceed max_output_tokens");
  if (values.cached + values.cacheWrite > values.input) throw new Error("Input token detail counters exceed input_tokens");
  if (values.reasoning > values.output) throw new Error("Reasoning tokens exceed output_tokens");
  if (values.total !== values.input + values.output) throw new Error("total_tokens does not equal input_tokens plus output_tokens");
  return values;
}

export function estimatedActualCost(response, snapshot) {
  validatePricing(snapshot);
  const usage = response?.usage || {};
  const input = Number(usage.input_tokens || 0);
  const cached = Number(usage.input_tokens_details?.cached_tokens || 0);
  const cacheWrite = Number(usage.input_tokens_details?.cache_write_tokens || 0);
  const uncached = Math.max(0, input - cached - cacheWrite);
  const output = Number(usage.output_tokens || 0);
  const price = snapshot.per_million_tokens;
  return ((uncached * price.input) + (cached * price.cached_input) + (cacheWrite * price.cache_write_input) + (output * price.output)) / 1_000_000;
}

export function maximumRequestCost(body, snapshot) {
  validatePricing(snapshot);
  const conservativeInputTokens = Buffer.byteLength(JSON.stringify(body), "utf8");
  const price = snapshot.per_million_tokens;
  return ((conservativeInputTokens * price.cache_write_input) + (body.max_output_tokens * price.output)) / 1_000_000;
}
