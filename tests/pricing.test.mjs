import test from "node:test";
import assert from "node:assert/strict";
import { validateUsage } from "../src/pricing.mjs";

const valid = () => ({
  usage: {
    input_tokens: 4000,
    input_tokens_details: { cached_tokens: 500, cache_write_tokens: 250 },
    output_tokens: 1200,
    output_tokens_details: { reasoning_tokens: 200 },
    total_tokens: 5200,
  },
});
const limits = { maxInputTokens: 12000, maxOutputTokens: 6000 };

test("valid nonnegative integer usage passes", () => {
  assert.equal(validateUsage(valid(), limits).total, 5200);
});

test("negative, fractional and inconsistent usage counters fail", () => {
  for (const mutate of [
    (value) => { value.usage.input_tokens = -1; },
    (value) => { value.usage.output_tokens = 1.5; },
    (value) => { value.usage.input_tokens_details.cached_tokens = 5000; },
    (value) => { value.usage.output_tokens = 6001; value.usage.total_tokens = 10001; },
    (value) => { value.usage.total_tokens = 9999; },
  ]) {
    const value = valid();
    mutate(value);
    assert.throws(() => validateUsage(value, limits));
  }
});
