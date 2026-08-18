import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ROOT } from "../src/dataset.mjs";
import { sha256 } from "../src/io.mjs";

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const comparable = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
const samePath = (left, right) => comparable(left) === comparable(right);
const inside = (parent, child) => {
  if (samePath(parent, child)) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const safeRelative = (value) => typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..");

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("Usage: --stage <new-directory> --zip <new-zip>");
    values.set(argv[index].slice(2), argv[index + 1]);
  }
  if (!values.has("stage") || !values.has("zip") || values.size !== 2) throw new Error("Usage: --stage <new-directory> --zip <new-zip>");
  return { stage: path.resolve(values.get("stage")), zip: path.resolve(values.get("zip")) };
}

function zipStored(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll("\\", "/"), "utf8");
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(entry.bytes.length, 18); local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(entry.bytes.length, 20); central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const centralBytes = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralBytes, end]);
}

function verifyStoredZip(zipBytes, expectedEntries) {
  if (zipBytes.length < 22 || zipBytes.readUInt32LE(zipBytes.length - 22) !== 0x06054b50) throw new Error("ZIP end record mismatch");
  const end = zipBytes.length - 22;
  const count = zipBytes.readUInt16LE(end + 10);
  let cursor = zipBytes.readUInt32LE(end + 16);
  const observed = new Map();
  for (let index = 0; index < count; index += 1) {
    if (zipBytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP central record mismatch");
    const crc = zipBytes.readUInt32LE(cursor + 16);
    const size = zipBytes.readUInt32LE(cursor + 24);
    const nameLength = zipBytes.readUInt16LE(cursor + 28);
    const extraLength = zipBytes.readUInt16LE(cursor + 30);
    const commentLength = zipBytes.readUInt16LE(cursor + 32);
    const localOffset = zipBytes.readUInt32LE(cursor + 42);
    const name = zipBytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (zipBytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP local record mismatch: ${name}`);
    const localNameLength = zipBytes.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const bytes = zipBytes.subarray(dataStart, dataStart + size);
    if (bytes.length !== size || crc32(bytes) !== crc) throw new Error(`ZIP content checksum mismatch: ${name}`);
    observed.set(name, sha256(bytes));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (observed.size !== expectedEntries.length || expectedEntries.some((entry) => observed.get(entry.name) !== sha256(entry.bytes))) throw new Error("ZIP inventory or SHA-256 mismatch");
}

export async function buildRelease({ stage, zip }) {
  const root = path.resolve(ROOT);
  if (samePath(stage, root) || samePath(zip, root) || inside(root, stage) || inside(root, zip) || samePath(stage, zip) || inside(stage, zip)) throw new Error("Stage and ZIP must be separate paths outside the source repository");
  const verified = spawnSync(process.execPath, ["src/verify-package.mjs"], { cwd: root, encoding: "utf8" });
  if (verified.status !== 0) throw new Error(`Package verification failed before staging: ${verified.stderr || verified.stdout}`);
  await fs.mkdir(stage, { recursive: false });
  const checksumBytes = await fs.readFile(path.join(root, "checksums.sha256"));
  const lines = checksumBytes.toString("utf8").trim().split(/\r?\n/u);
  const expected = lines.map((line) => {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match || !safeRelative(match[2])) throw new Error(`Malformed or unsafe checksum line: ${line}`);
    return { hash: match[1], relative: match[2].replaceAll("\\", "/") };
  });
  const stageEntries = [];
  for (const entry of expected) {
    const source = path.resolve(root, entry.relative);
    if (!inside(root, source)) throw new Error(`Path escaped source root: ${entry.relative}`);
    const bytes = await fs.readFile(source);
    if (sha256(bytes) !== entry.hash) throw new Error(`Source hash mismatch: ${entry.relative}`);
    const destination = path.resolve(stage, entry.relative);
    if (!inside(stage, destination)) throw new Error(`Path escaped stage root: ${entry.relative}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { flag: "wx" });
    if (sha256(await fs.readFile(destination)) !== entry.hash) throw new Error(`Staged hash mismatch: ${entry.relative}`);
    stageEntries.push({ name: entry.relative, bytes });
  }
  const stagedChecksum = path.join(stage, "checksums.sha256");
  await fs.writeFile(stagedChecksum, checksumBytes, { flag: "wx" });
  if (sha256(await fs.readFile(stagedChecksum)) !== sha256(checksumBytes)) throw new Error("Staged checksum snapshot mismatch");
  stageEntries.push({ name: "checksums.sha256", bytes: checksumBytes });
  stageEntries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const actualStageFiles = [];
  const walkStage = async (current, relative = "") => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walkStage(path.join(current, entry.name), name);
      else if (entry.isFile()) actualStageFiles.push(name);
      else throw new Error(`Unsupported stage entry: ${name}`);
    }
  };
  await walkStage(stage);
  actualStageFiles.sort((left, right) => left.localeCompare(right, "en"));
  if (actualStageFiles.join("|") !== stageEntries.map((entry) => entry.name).join("|")) throw new Error("Stage inventory differs from the checksum allowlist");
  const zipBytes = zipStored(stageEntries);
  await fs.writeFile(zip, zipBytes, { flag: "wx" });
  const persisted = await fs.readFile(zip);
  verifyStoredZip(persisted, stageEntries);
  return { stage, files: stageEntries.length, zip, zip_bytes: persisted.length, zip_sha256: sha256(persisted), zip_verified: true };
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) console.log(JSON.stringify(await buildRelease(parseArgs(process.argv.slice(2))), null, 2));
