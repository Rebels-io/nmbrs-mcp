import express from "express";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requestContext } from "./auth/requestContext.js";
import { NmbrsRemoteProvider } from "./auth/remoteProvider.js";
import { getConfig } from "./config.js";
import { describeAccount } from "./instructions.js";
import { createServer } from "./server.js";

export function createApp(baseUrlInput: string): express.Express {
  const baseUrl = baseUrlInput.replace(/\/+$/, "");
  const provider = new NmbrsRemoteProvider(baseUrl);
  const mcpUrl = new URL(`${baseUrl}/mcp`);

  const app = express();
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      console.error(`${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(baseUrl),
      baseUrl: new URL(baseUrl),
      resourceServerUrl: mcpUrl,
      resourceName: "Nmbrs MCP",
    })
  );

  app.get("/callback", (req, res, next) => {
    provider.handleCallback(req, res).catch(next);
  });

  const defaultMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpUrl);
  const aliasPattern = /^[a-z0-9-]{1,32}$/i;
  const mcpPaths = ["/mcp", "/mcp/:alias"];

  // Claude weigert twee connectors met dezelfde URL. Met een alias in het pad
  // heeft elk Nmbrs-account een eigen URL, terwijl het dezelfde server blijft.
  app.get("/.well-known/oauth-protected-resource/mcp/:alias", (req, res) => {
    const alias = String(req.params.alias);
    if (!aliasPattern.test(alias)) {
      res.status(404).end();
      return;
    }
    res.json({
      resource: `${baseUrl}/mcp/${alias}`,
      authorization_servers: [new URL(baseUrl).href],
      resource_name: "Nmbrs MCP",
    });
  });

  const validAlias: express.RequestHandler = (req, res, next) => {
    const alias = req.params.alias;
    if (alias !== undefined && !aliasPattern.test(String(alias))) {
      res.status(404).end();
      return;
    }
    next();
  };

  const bearer: express.RequestHandler = (req, res, next) => {
    const alias = req.params.alias;
    requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: alias ? `${baseUrl}/.well-known/oauth-protected-resource/mcp/${alias}` : defaultMetadataUrl,
    })(req, res, next);
  };

  app.post(mcpPaths, validAlias, express.json({ limit: "1mb" }), bearer, async (req, res) => {
    const alias = req.params.alias ? String(req.params.alias) : undefined;
    await requestContext.run({ accessToken: req.auth!.token }, async () => {
      const summary = req.body?.method === "initialize" ? await describeAccount().catch(() => undefined) : undefined;
      const server = createServer(alias, summary);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
  });

  app.all(mcpPaths, (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });

  return app;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = getConfig();
  if (!config.baseUrl) {
    console.error("MCP_BASE_URL ontbreekt. Zet de exacte publieke https-URL, zonder slash aan het eind.");
    process.exit(1);
  }
  createApp(config.baseUrl).listen(config.port, () => {
    console.error(`nmbrs-mcp luistert op poort ${config.port}`);
  });
}
