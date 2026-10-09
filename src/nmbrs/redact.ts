import { getConfig } from "../config.js";

const BSN_KEY = /^(bsn|burgerservicenummer|socialsecuritynumber|nationalidnumber|citizenservicenumber)$/i;
const BANK_KEY = /^(iban|bic|bankaccount(number)?|accountnumber)$/i;

export function redactSensitive<T>(value: T): T {
  const { redactBsn } = getConfig();
  return walk(value, redactBsn) as T;
}

function walk(value: unknown, redactBsn: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => walk(item, redactBsn));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (BANK_KEY.test(key) || (redactBsn && BSN_KEY.test(key))) continue;
      out[key] = walk(inner, redactBsn);
    }
    return out;
  }
  return value;
}

export function describeShape(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? "array(leeg)" : [describeShape(value[0], depth + 1), `... ${value.length} items`];
  }
  if (value && typeof value === "object") {
    if (depth >= 4) return "object";
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = describeShape(inner, depth + 1);
    return out;
  }
  return value === null ? "null" : typeof value;
}
