import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import open from "open";
import { getConfig } from "../config.js";

const DISCOVERY_URL = "https://identityservice.nmbrs.com/.well-known/openid-configuration";
const CALLBACK_PORT = 8765;
const CALLBACK_PATH = "/callback";

// offline_access is vereist om een refresh_token te krijgen. De scope-namen
// in het oorspronkelijke plan (company.read, employee.salary.read, ...)
// bestaan niet op identityservice.nmbrs.com; onderstaande namen zijn
// geverifieerd tegen de echte /.well-known/openid-configuration van Nmbrs.
const SCOPES = [
  "company.info.read",
  "company.payrollsettings.read",
  "company.leave.read",
  "employee.info.read",
  "employee.orgstructure.read",
  "employee.payment.read",
  "employee.employment.read",
  "offline_access",
];

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface OidcConfig {
  authorization_endpoint: string;
  token_endpoint: string;
}

let discoveryCache: OidcConfig | null = null;

async function discoverEndpoints(): Promise<OidcConfig> {
  if (discoveryCache) return discoveryCache;

  const res = await fetch(DISCOVERY_URL);
  if (!res.ok) {
    throw new Error(`Kon OAuth-configuratie niet ophalen bij Nmbrs (${res.status}).`);
  }

  discoveryCache = (await res.json()) as OidcConfig;
  return discoveryCache;
}

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

function generateState(): string {
  return base64UrlEncode(randomBytes(16));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface CallbackResult {
  code: string;
}

function waitForCallback(expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        res
          .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end(`<html><body><h1>Inloggen mislukt</h1><p>${escapeHtml(description)}</p></body></html>`);
        server.close();
        reject(new Error(`Nmbrs gaf een foutmelding tijdens het inloggen: ${description}`));
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      if (!code || !returnedState) {
        res
          .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          .end("<html><body><h1>Ongeldige callback</h1><p>Code of state parameter ontbreekt.</p></body></html>");
        return;
      }

      if (returnedState !== expectedState) {
        res
          .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          .end("<html><body><h1>Ongeldige callback</h1><p>State komt niet overeen.</p></body></html>");
        server.close();
        reject(new Error("State parameter in de callback komt niet overeen met de aanvraag."));
        return;
      }

      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end("<html><body><h1>Ingelogd bij Nmbrs</h1><p>Je kan dit tabblad sluiten en terug naar de terminal gaan.</p></body></html>");
      server.close();
      resolve({ code });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Poort ${CALLBACK_PORT} is al in gebruik. Sluit het proces dat deze poort gebruikt en probeer opnieuw.`
          )
        );
        return;
      }
      reject(err);
    });

    server.listen(CALLBACK_PORT);
  });
}

async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const config = getConfig();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code_verifier: codeVerifier,
  });

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Code inwisselen voor tokens is mislukt (${res.status}): ${await res.text()}`);
  }

  return (await res.json()) as TokenResponse;
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const config = getConfig();
  const { token_endpoint } = await discoverEndpoints();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token vernieuwen is mislukt (${res.status}): ${await res.text()}`);
  }

  return (await res.json()) as TokenResponse;
}

export async function runAuthorizationFlow(): Promise<TokenResponse> {
  const config = getConfig();
  const { authorization_endpoint, token_endpoint } = await discoverEndpoints();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const authorizeUrl = new URL(authorization_endpoint);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", SCOPES.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const callbackPromise = waitForCallback(state);

  console.log("Open deze URL om in te loggen bij Nmbrs (of je browser opent vanzelf):");
  console.log(authorizeUrl.toString());

  try {
    await open(authorizeUrl.toString());
  } catch {
    // Browser kon niet automatisch openen. De URL hierboven werkt ook handmatig.
  }

  const { code } = await callbackPromise;

  return exchangeCodeForTokens(token_endpoint, code, codeVerifier);
}
