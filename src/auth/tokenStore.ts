import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getConfig } from "../config.js";
import { refreshTokens, type TokenResponse } from "./oauth.js";

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  obtainedAt: string;
  expiresAt: string;
}

const EXPIRY_MARGIN_MS = 60_000;

function toStoredTokens(response: TokenResponse, obtainedAt: Date): StoredTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    scope: response.scope,
    obtainedAt: obtainedAt.toISOString(),
    expiresAt: new Date(obtainedAt.getTime() + response.expires_in * 1000).toISOString(),
  };
}

export async function writeTokens(response: TokenResponse): Promise<StoredTokens> {
  const stored = toStoredTokens(response, new Date());
  const path = getConfig().tokenStorePath;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(stored, null, 2), { mode: 0o600 });
  return stored;
}

export async function readTokens(): Promise<StoredTokens | null> {
  const path = getConfig().tokenStorePath;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as StoredTokens;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function getValidAccessToken(): Promise<string> {
  const stored = await readTokens();
  if (!stored) {
    throw new Error("Nog niet ingelogd bij Nmbrs. Draai eerst 'npm run auth'.");
  }

  const expiresAt = new Date(stored.expiresAt).getTime();
  if (Date.now() < expiresAt - EXPIRY_MARGIN_MS) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) {
    throw new Error("Toegangstoken is verlopen en er is geen refresh token opgeslagen. Draai 'npm run auth' opnieuw.");
  }

  try {
    const refreshed = await refreshTokens(stored.refreshToken);
    const newStored = await writeTokens(refreshed);
    return newStored.accessToken;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Token vernieuwen is mislukt. Draai 'npm run auth' opnieuw om opnieuw in te loggen. (${reason})`);
  }
}
