import test from "node:test";
import assert from "node:assert/strict";
import { sensitiveFindings } from "../src/sensitive-scan.mjs";
import { MAX_PUBLIC_FILE_BYTES, assertPublicFileSize } from "../src/build-checksums.mjs";

test("high-signal provider credentials, ids and user paths are detected", () => {
  const probes = [
    [["github", "_pat_", "A".repeat(40)].join(""), "github_token"],
    [["AK", "IA", "A".repeat(16)].join(""), "aws_access_key"],
    [["AI", "za", "A".repeat(35)].join(""), "google_api_key"],
    [["sk", "_live_", "A".repeat(24)].join(""), "stripe_secret"],
    [["acct", "_", "A".repeat(12)].join(""), "payment_account_id"],
    [["res", "p_", "A".repeat(16)].join(""), "provider_response_id"],
    [["C:", "\\", "Users", "\\", "PrivateName", "\\file.txt"].join(""), "windows_user_path"],
    [["/ho", "me/", "private-name", "/file.txt"].join(""), "unix_user_path"],
    [["203", ".", "0", ".", "113", ".", "42"].join(""), "ip_address"],
  ];
  for (const [probe, expected] of probes) assert.ok(sensitiveFindings(probe).includes(expected), expected);
});

test("percent, HTML and base64 encoded personal data are normalized", () => {
  const address = ["real.person", "gmail.com"].join("@");
  const variants = [encodeURIComponent(address), address.replace("@", "&#64;").replace(".", "&#x2e;"), Buffer.from(address).toString("base64")];
  for (const value of variants) assert.ok(sensitiveFindings(value).includes("unexpected_email"));
});

test("mixed and double encodings are decoded to a bounded fixed point", () => {
  const mixed = ["real%2eperson", "gmail%2ecom"].join("&#64;");
  const doublePercent = encodeURIComponent(encodeURIComponent(["real.person", "gmail.com"].join("@")));
  const encodedProviderKey = `${encodeURIComponent("sk&#x2d;")}${"A".repeat(40)}`;
  assert.ok(sensitiveFindings(mixed).includes("unexpected_email"));
  assert.ok(sensitiveFindings(doublePercent).includes("unexpected_email"));
  assert.ok(sensitiveFindings(encodedProviderKey).includes("openai_key"));
  assert.ok(sensitiveFindings(`${mixed} %ZZ`).includes("unexpected_email"));
  assert.ok(sensitiveFindings(`${encodeURIComponent("sk-")}${"A".repeat(40)} %GG`).includes("openai_key"));
});

test("JSON Unicode escapes cannot hide personal data", () => {
  const escaped = ["real", "person"].join("\\u002e") + "\\u0040" + ["gmail", "com"].join("\\u002e");
  assert.ok(sensitiveFindings(escaped).includes("unexpected_email"));
});

test("reserved synthetic addresses and runtime version text remain allowed", () => {
  assert.deepEqual(sensitiveFindings(["person", "example.invalid"].join("@")), []);
  assert.equal(sensitiveFindings("13.6.233.17-node.51").includes("ip_address"), false);
});

test("unlabelled high-entropy credential-like text is detected", () => {
  const token = Array.from({ length: 40 }, (_, index) => "aB3dE7fG9hJ2kL5mN8pQ"[(index * 7) % 20]).join("");
  assert.ok(sensitiveFindings(token).includes("high_entropy_token"));
});

test("large public files fail closed instead of skipping the sensitive scan", () => {
  assert.doesNotThrow(() => assertPublicFileSize("fixture.txt", MAX_PUBLIC_FILE_BYTES));
  assert.throws(() => assertPublicFileSize("oversized.txt", MAX_PUBLIC_FILE_BYTES + 1), /fail-closed size limit/u);
});
