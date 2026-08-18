import { runBenchmark } from "./run-benchmark.mjs";

const apiKey = process.env.OPENAI_API_KEY;
try {
  const summary = await runBenchmark({ apiKey });
  console.log(JSON.stringify(summary, null, 2));
} finally {
  delete process.env.OPENAI_API_KEY;
}
