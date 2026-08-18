import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, computeGroundTruth, loadRows } from "./dataset.mjs";

const output = path.join(ROOT, "data/ground-truth.json");
const text = JSON.stringify(computeGroundTruth(await loadRows()), null, 2) + "\n";
await fs.writeFile(output, text, "utf8");
console.log(JSON.stringify({ output: "data/ground-truth.json", bytes: Buffer.byteLength(text) }));
