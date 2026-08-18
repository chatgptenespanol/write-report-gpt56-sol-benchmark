import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./dataset.mjs";

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
export async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }

export async function writeAtomicExclusive(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (await exists(file)) throw new Error(`Append-only target exists: ${path.relative(ROOT, file)}`);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  const handle = await fs.open(temp, "wx");
  try { await handle.writeFile(text, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await fs.link(temp, file); }
  catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
  await fs.unlink(temp);
}

export async function ensureExactFile(file, text) {
  if (await exists(file)) {
    if (await fs.readFile(file, "utf8") !== text) throw new Error(`Derived file mismatch: ${path.relative(ROOT, file)}`);
    return;
  }
  await writeAtomicExclusive(file, text);
}
