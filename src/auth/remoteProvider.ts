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
      const ourCode = randomBytes(32).toString("base64url");
      this.codes.set(ourCode, { codeChallenge: entry.codeChallenge, tokens, createdAt: Date.now() });
      back.searchParams.set("code", ourCode);
    } catch {
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
      const res = await fetch(`${API_BASE_URL}/api/companies?pageSize=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Subscription-Key": getConfig().subscriptionKey,
          Accept: "application/json",
        },
      });
      if (res.status === 401 || res.status === 403) throw new InvalidTokenError("Nmbrs weigerde het token.");
      if (!res.ok) throw new Error(`Nmbrs kon het token niet controleren (${res.status}).`);
      this.verified.set(key, now + VERIFY_TTL_MS);
    }
    return { token, clientId: "nmbrs", scopes: [], expiresAt: Math.floor((now + VERIFY_TTL_MS) / 1000) };
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
