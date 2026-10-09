import { getConfig } from "../config.js";
import { getValidAccessToken } from "../auth/tokenStore.js";

const API_BASE_URL = "https://api.nmbrsapp.com";
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

interface NmbrsErrorBody {
  title?: string;
  detail?: string;
  code?: number;
}

export class NmbrsApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return BASE_DELAY_MS * 2 ** (attempt - 1);
}

export async function nmbrsFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getConfig();
  const method = (init.method ?? "GET").toUpperCase();

  if (config.readOnly && method !== "GET") {
    throw new Error(`NMBRS_READ_ONLY staat aan: ${method}-aanvragen zijn geblokkeerd.`);
  }

  for (let attempt = 1; ; attempt++) {
    const accessToken = await getValidAccessToken();
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
        "X-Subscription-Key": config.subscriptionKey,
        Accept: "application/json",
      },
    });

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }

    if (!res.ok) {
      throw new NmbrsApiError(await describeError(res, path), res.status);
    }

    return (await res.json()) as T;
  }
}

async function describeError(res: Response, path: string): Promise<string> {
  let body: NmbrsErrorBody | null = null;
  try {
    body = (await res.json()) as NmbrsErrorBody;
  } catch {
    // Geen JSON-body, val terug op de HTTP-status.
  }

  const detail = (body?.detail ?? res.statusText).replace(/\.+$/, "");

  if (res.status === 401 || res.status === 403) {
    return `Nmbrs weigerde de aanvraag (${res.status}): ${detail}. Controleer client ID, client secret en subscription key, of draai 'npm run auth' opnieuw.`;
  }
  if (res.status === 404) {
    return `Niet gevonden bij Nmbrs (${path}): ${detail}. Controleer de id, bijvoorbeeld met nmbrs_search_employees.`;
  }
  if (res.status === 429) {
    return `Nmbrs geeft een rate limit (429) na ${MAX_ATTEMPTS} pogingen. Probeer het over een minuut opnieuw.`;
  }
  return `Nmbrs-aanvraag mislukt (${res.status}): ${detail}`;
}
