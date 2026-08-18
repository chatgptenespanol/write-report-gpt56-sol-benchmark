import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const schema = JSON.parse(await fs.readFile(new URL("../benchmark/output.schema.json", import.meta.url), "utf8"));
const allowedKeywords = new Set(["$schema", "type", "additionalProperties", "required", "properties", "enum", "items", "minItems", "maxItems", "pattern"]);

test("strict output schema uses the documented supported subset and exact object keys", () => {
  const errors = [];
  const visit = (node, pointer = "$", root = false) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node)) if (!allowedKeywords.has(key)) errors.push(`${pointer}: unsupported ${key}`);
    if (!root && "$schema" in node) errors.push(`${pointer}: nested $schema`);
    if (node.type === "object") {
      if (node.additionalProperties !== false) errors.push(`${pointer}: additionalProperties`);
      const properties = Object.keys(node.properties || {}).sort();
      const required = [...(node.required || [])].sort();
      if (JSON.stringify(properties) !== JSON.stringify(required)) errors.push(`${pointer}: required keys`);
      for (const [key, value] of Object.entries(node.properties || {})) visit(value, `${pointer}.${key}`);
    }
    if (node.items) visit(node.items, `${pointer}[]`);
  };
  visit(schema, "$", true);
  assert.deepEqual(errors, []);
});
