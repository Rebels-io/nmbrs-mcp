import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { registerCompanyTools } from "./tools/companies.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerLeaveTools } from "./tools/leave.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerSalaryTools } from "./tools/salary.js";

export function createServer(): McpServer {
  getConfig();

  const server = new McpServer({ name: "nmbrs-mcp", version: "0.2.0" });
  registerCompanyTools(server);
  registerEmployeeTools(server);
  registerSalaryTools(server);
  registerLeaveTools(server);
  registerPayrollTools(server);
  return server;
}

async function main() {
  await createServer().connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Server kon niet starten:", err instanceof Error ? err.message : err);
  process.exit(1);
});
