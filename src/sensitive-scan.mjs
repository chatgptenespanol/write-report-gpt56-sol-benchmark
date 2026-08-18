const collectStrings = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => { out.push(key); collectStrings(item, out); });
  return out;
};

export function sensitiveFindings(value) {
  const normalize = (text) => text.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const initial = normalize(collectStrings(value).join("\n"));
  const variants = new Set([initial]);
  const queue = [{ text: initial, depth: 0 }];
  const add = (candidate, depth) => {
    const normalized = normalize(candidate);
    if (!variants.has(normalized) && variants.size < 64) {
      variants.add(normalized);
      queue.push({ text: normalized, depth });
    }
  };
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= 3) continue;
    if (/%[0-9a-f]{2}/iu.test(current.text)) {
      const decoded = current.text.replace(/(?:%[0-9a-f]{2})+/giu, (sequence) => {
        try { return decodeURIComponent(sequence); }
        catch { return sequence.replace(/%([0-9a-f]{2})/giu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))); }
      });
      if (decoded !== current.text) add(decoded, current.depth + 1);
    }
    const htmlDecoded = current.text
      .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#([0-9]+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
      .replace(/&commat;/giu, "@").replace(/&period;/giu, ".");
    if (htmlDecoded !== current.text) add(htmlDecoded, current.depth + 1);
    const unicodeDecoded = current.text.replace(/\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/giu, (_, braced, fixed) => {
      const code = Number.parseInt(braced || fixed, 16);
      if (code > 0x10ffff) return _;
      return code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
    });
    if (unicodeDecoded !== current.text) add(unicodeDecoded, current.depth + 1);
    for (const candidate of current.text.match(/[A-Za-z0-9+/]{20,}={0,2}/gu) || []) {
      try {
        const decoded = Buffer.from(candidate, "base64").toString("utf8");
        const printable = [...decoded].filter((character) => /[\p{L}\p{N}\p{P}\p{Zs}\r\n\t]/u.test(character)).length;
        if (decoded.length >= 8 && printable / decoded.length >= 0.9) add(decoded, current.depth + 1);
      } catch { /* ignore non-base64 candidates */ }
    }
  }
  const patterns = [
    ["openai_key", /\bsk-[A-Za-z0-9_-]{20,}\b/u],
    ["bearer", /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/iu],
    ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u],
    ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u],
    ["aws_access_key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
    ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/u],
    ["stripe_secret", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/u],
    ["slack_token", /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{16,}\b/u],
    ["provider_account_id", /\b(?:org-|proj[_-])[A-Za-z0-9_-]{8,}\b/iu],
    ["payment_account_id", /\bacct_[A-Za-z0-9]{8,}\b/u],
    ["provider_response_id", /\bresp_[A-Za-z0-9_-]{8,}\b/u],
    ["credential_url", /https?:\/\/[^\s/@:]+:[^\s/@]+@/iu],
    ["windows_user_path", /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/iu],
    ["unix_user_path", /(?:^|\s)\/(?:home|Users)\/[^/\s]+/u],
    ["generic_secret_assignment", /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9._~+\/-]{16,}["']/iu],
    ["unexpected_email", /\b[A-Z0-9._%+-]+@(?!example\.(?:invalid|test|example)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ["phone", /(?:\+\d{8,15}\b)|(?:\b\d{2,4}[\s().-]\d{2,4}[\s().-]\d{3,4}\b)/u],
    ["ip_address", /\b(?:\d{1,3}\.){3}\d{1,3}\b(?![-A-Za-z0-9])/u],
  ];
  const findings = new Set();
  for (const candidate of variants) {
    for (const [code, regex] of patterns) {
      if (regex.test(candidate)) findings.add(code);
    }
    for (const token of candidate.match(/[A-Za-z0-9_-]{32,}/gu) || []) {
      if (!/[a-z]/u.test(token) || !/[A-Z]/u.test(token) || !/[0-9]/u.test(token)) continue;
      const counts = new Map();
      for (const character of token) counts.set(character, (counts.get(character) || 0) + 1);
      const entropy = [...counts.values()].reduce((sum, count) => { const probability = count / token.length; return sum - probability * Math.log2(probability); }, 0);
      if (entropy >= 4.2) findings.add("high_entropy_token");
    }
  }
  return [...findings];
}
