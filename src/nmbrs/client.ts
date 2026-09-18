import { getConfig } from "../config.js";
import { getValidAccessToken } from "../auth/tokenStore.js";

const API_BASE_URL = "https://api.nmbrsapp.com";

interface NmbrsErrorBody {
  title?: string;
  detail?: string;
  code?: number;
}

export async function nmbrsFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getConfig();
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

  if (!res.ok) {
    throw new Error(await describeError(res));
  }

  return (await res.json()) as T;
}

async function describeError(res: Response): Promise<string> {
  let body: NmbrsErrorBody | null = null;
  try {
    body = (await res.json()) as NmbrsErrorBody;
  } catch {
    // Geen JSON-body, val terug op de HTTP-status.
  }

  if (res.status === 401 || res.status === 403) {
    const detail = (body?.detail ?? res.statusText).replace(/\.+$/, "");
    return `Nmbrs weigerde de aanvraag (${res.status}): ${detail}. Controleer client ID, client secret en subscription key, of draai 'npm run auth' opnieuw.`;
  }

  return `Nmbrs-aanvraag mislukt (${res.status}): ${body?.detail ?? res.statusText}`;
}
