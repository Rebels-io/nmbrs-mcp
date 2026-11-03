import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "./config.js";
import { registerAbsenceTools } from "./tools/absence.js";
import { registerCostTools } from "./tools/costs.js";
import { registerCompanyTools } from "./tools/companies.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerLeaveTools } from "./tools/leave.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerSalaryTools } from "./tools/salary.js";

export function createServer(alias?: string): McpServer {
  getConfig();

  const server = new McpServer(
    { name: alias ? `nmbrs-mcp-${alias}` : "nmbrs-mcp", version: "0.6.0" },
    alias
      ? {
          instructions: `Dit is de Nmbrs-koppeling "${alias}". Alle gegevens komen uit het Nmbrs-account waarmee voor deze koppeling is ingelogd. Gebruik nmbrs_get_account om te zien welk account en welke debtors dat zijn.`,
        }
      : undefined
  );
  registerCompanyTools(server);
  registerEmployeeTools(server);
  registerSalaryTools(server);
  registerLeaveTools(server);
  registerAbsenceTools(server);
  registerPayrollTools(server);
  registerCostTools(server);
  return server;
}
