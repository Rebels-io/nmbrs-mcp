import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { registerCompanyTools } from "./tools/companies.js";

async function main() {
  getConfig();

  const server = new McpServer({ name: "nmbrs-mcp", version: "0.1.0" });
  registerCompanyTools(server);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Server kon niet starten:", err instanceof Error ? err.message : err);
  process.exit(1);
});
