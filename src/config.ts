import "dotenv/config";
import { z } from "zod";

const boolFromString = z
  .string()
  .optional()
  .transform((value) => value?.toLowerCase() !== "false");

const envSchema = z.object({
  NMBRS_CLIENT_ID: z
    .string({ required_error: "NMBRS_CLIENT_ID ontbreekt. Zie .env.example." })
    .min(1, "NMBRS_CLIENT_ID ontbreekt. Zie .env.example."),
  NMBRS_CLIENT_SECRET: z
    .string({ required_error: "NMBRS_CLIENT_SECRET ontbreekt. Zie .env.example." })
    .min(1, "NMBRS_CLIENT_SECRET ontbreekt. Zie .env.example."),
  NMBRS_SUBSCRIPTION_KEY: z
    .string({ required_error: "NMBRS_SUBSCRIPTION_KEY ontbreekt. Zie .env.example." })
    .min(1, "NMBRS_SUBSCRIPTION_KEY ontbreekt. Zie .env.example."),
  NMBRS_REDIRECT_URI: z.string().url().default("http://localhost:8765/callback"),
  NMBRS_TOKEN_STORE: z.string().min(1).default("./.tokens.json"),
  NMBRS_READ_ONLY: boolFromString,
  NMBRS_REDACT_BSN: boolFromString,
});

export interface NmbrsConfig {
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  redirectUri: string;
  tokenStorePath: string;
  readOnly: boolean;
  redactBsn: boolean;
}

let cached: NmbrsConfig | null = null;

export function getConfig(): NmbrsConfig {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`Configuratie ontbreekt of is ongeldig:\n${messages}`);
  }

  cached = {
    clientId: parsed.data.NMBRS_CLIENT_ID,
    clientSecret: parsed.data.NMBRS_CLIENT_SECRET,
    subscriptionKey: parsed.data.NMBRS_SUBSCRIPTION_KEY,
    redirectUri: parsed.data.NMBRS_REDIRECT_URI,
    tokenStorePath: parsed.data.NMBRS_TOKEN_STORE,
    readOnly: parsed.data.NMBRS_READ_ONLY,
    redactBsn: parsed.data.NMBRS_REDACT_BSN,
  };
  return cached;
}
