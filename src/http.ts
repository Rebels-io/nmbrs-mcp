import express from "express";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requestContext } from "./auth/requestContext.js";
import { NmbrsRemoteProvider } from "./auth/remoteProvider.js";
import { getConfig } from "./config.js";
import { createServer } from "./server.js";

export function createApp(baseUrlInput: string): express.Express {
  const baseUrl = baseUrlInput.replace(/\/+$/, "");
  const provider = new NmbrsRemoteProvider(baseUrl);
  const mcpUrl = new URL(`${baseUrl}/mcp`);

  const app = express();
  app.set("trust proxy", 1);

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

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  app.post("/mcp", express.json({ limit: "1mb" }), bearer, async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await requestContext.run({ accessToken: req.auth!.token }, async () => {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
  });

  app.all("/mcp", (_req, res) => {
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
