import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { getConfig } from "../config.js";
import { API_BASE_URL } from "../nmbrs/client.js";
import { discoverEndpoints, generateCodeChallenge, generateCodeVerifier, generateState, requestedScopes } from "./oauth.js";

const PENDING_TTL_MS = 10 * 60_000;
const VERIFY_TTL_MS = 5 * 60_000;

interface Pending {
  client: OAuthClientInformationFull;
  redirectUri: string;
  clientState?: string;
  codeChallenge: string;
  upstreamVerifier: string;
  createdAt: number;
}

interface IssuedCode {
  codeChallenge: string;
  tokens: OAuthTokens;
  createdAt: number;
}

interface NmbrsTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

function toOAuthTokens(res: NmbrsTokenResponse): OAuthTokens {
  return {
    access_token: res.access_token,
    token_type: res.token_type || "Bearer",
    expires_in: res.expires_in,
    refresh_token: res.refresh_token,
    scope: res.scope,
  };
}

function errorPage(title: string, text: string): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1b1b1b}h1{font-size:1.4rem}</style></head><body><h1>${title}</h1><p>${text}</p><p>Sluit dit venster en probeer het in Claude opnieuw.</p></body></html>`;
}

export class NmbrsRemoteProvider implements OAuthServerProvider {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly pending = new Map<string, Pending>();
  private readonly codes = new Map<string, IssuedCode>();
  private readonly verified = new Map<string, number>();

  constructor(private readonly baseUrl: string) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  get callbackUrl(): string {
    return `${this.baseUrl}/callback`;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.clients.get(clientId),
      registerClient: (client) => {
        const registered: OAuthClientInformationFull = {
          ...client,
          client_id: randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        this.clients.set(registered.client_id, registered);
        return registered;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const config = getConfig();
    const { authorization_endpoint } = await discoverEndpoints();

    const upstreamVerifier = generateCodeVerifier();
    const upstreamState = generateState();
    this.pending.set(upstreamState, {
      client,
      redirectUri: params.redirectUri,
      clientState: params.state,
      codeChallenge: params.codeChallenge,
      upstreamVerifier,
      createdAt: Date.now(),
    });

    const url = new URL(authorization_endpoint);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", this.callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", requestedScopes().join(" "));
    url.searchParams.set("state", upstreamState);
    url.searchParams.set("code_challenge", generateCodeChallenge(upstreamVerifier));
    url.searchParams.set("code_challenge_method", "S256");
    res.redirect(url.toString());
  }

  async handleCallback(req: Request, res: Response): Promise<void> {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const entry = this.pending.get(state);
    if (!entry) {
      res.status(400).send("Onbekende of verlopen inlogpoging. Start de verbinding opnieuw in Claude.");
      return;
    }
    this.pending.delete(state);

    const back = new URL(entry.redirectUri);
    if (entry.clientState) back.searchParams.set("state", entry.clientState);

    const error = typeof req.query.error === "string" ? req.query.error : undefined;
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    if (error || !code) {
      back.searchParams.set("error", error ?? "access_denied");
      res.redirect(back.toString());
      return;
    }

    try {
      const tokens = await this.nmbrsTokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.callbackUrl,
        code_verifier: entry.upstreamVerifier,
      });
      const status = await this.probeNmbrs(tokens.access_token);
      if (status === 401 || status === 403) {
        console.error(`Verbinden afgebroken: Nmbrs weigert dit account de API (status ${status}).`);
        res
          .status(403)
          .type("html")
          .send(
            errorPage(
              "Dit Nmbrs-account heeft geen toegang tot de API",
              `Nmbrs gaf status ${status} op de eerste aanvraag. Meestal ontbreekt voor dit account de API-toegang bij de accountant (API-token en filterinstellingen), of is bij het inloggen een ander account gekozen dan bedoeld. Vraag de Nmbrs-beheerder om de toegang te controleren.`
            )
          );
        return;
      }
      if (status !== 200) {
        console.error(`Verbinden afgebroken: Nmbrs gaf status ${status} bij de eerste aanvraag.`);
        res
          .status(502)
          .type("html")
          .send(errorPage("Nmbrs reageert niet goed", `Nmbrs gaf status ${status} terug. Dit is meestal tijdelijk.`));
        return;
      }
      this.verified.set(createHash("sha256").update(tokens.access_token).digest("hex"), Date.now() + VERIFY_TTL_MS);
      const ourCode = randomBytes(32).toString("base64url");
      this.codes.set(ourCode, { codeChallenge: entry.codeChallenge, tokens, createdAt: Date.now() });
      back.searchParams.set("code", ourCode);
    } catch (err) {
      console.error(`Verbinden mislukt: ${err instanceof Error ? err.message : String(err)}`);
      back.searchParams.set("error", "server_error");
    }
    res.redirect(back.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const issued = this.codes.get(authorizationCode);
    if (!issued) throw new Error("Onbekende of verlopen code.");
    return issued.codeChallenge;
  }

  async exchangeAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<OAuthTokens> {
    const issued = this.codes.get(authorizationCode);
    if (!issued) throw new Error("Onbekende of verlopen code.");
    this.codes.delete(authorizationCode);
    return issued.tokens;
  }

  async exchangeRefreshToken(_client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    return this.nmbrsTokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const key = createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    const knownUntil = this.verified.get(key);
    if (!knownUntil || knownUntil < now) {
      const status = await this.probeNmbrs(token);
      if (status === 401 || status === 403) {
        console.error(`Tokencontrole: Nmbrs weigerde het token (status ${status}).`);
        throw new InvalidTokenError("Nmbrs weigerde het token.");
      }
      if (status !== 200) {
        console.error(`Tokencontrole: Nmbrs gaf status ${status}.`);
        throw new Error(`Nmbrs kon het token niet controleren (${status}).`);
      }
      this.verified.set(key, now + VERIFY_TTL_MS);
    }
    return { token, clientId: "nmbrs", scopes: [], expiresAt: Math.floor((now + VERIFY_TTL_MS) / 1000) };
  }

  private async probeNmbrs(token: string): Promise<number> {
    const res = await fetch(`${API_BASE_URL}/api/companies?pageSize=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Subscription-Key": getConfig().subscriptionKey,
        Accept: "application/json",
      },
    });
    return res.status;
  }

  private async nmbrsTokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
    const config = getConfig();
    const { token_endpoint } = await discoverEndpoints();
    const res = await fetch(token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }),
    });
    if (!res.ok) throw new Error(`Nmbrs token-aanvraag mislukt (${res.status}).`);
    return toOAuthTokens((await res.json()) as NmbrsTokenResponse);
  }

  private sweep(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [key, value] of this.pending) if (value.createdAt < cutoff) this.pending.delete(key);
    for (const [key, value] of this.codes) if (value.createdAt < cutoff) this.codes.delete(key);
    for (const [key, until] of this.verified) if (until < Date.now()) this.verified.delete(key);
  }
}
