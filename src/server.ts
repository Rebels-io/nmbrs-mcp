import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "./config.js";
import { baseInstructions } from "./instructions.js";
import { registerAbsenceTools } from "./tools/absence.js";
import { registerCostTools } from "./tools/costs.js";
import { registerCompanyTools } from "./tools/companies.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerLeaveTools } from "./tools/leave.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerSalaryTools } from "./tools/salary.js";
import { registerWageComponentTools } from "./tools/wagecomponents.js";

export function createServer(alias?: string, accountSummary?: string): McpServer {
  const config = getConfig();

  const instructions = [
    alias ? `Dit is de Nmbrs-koppeling "${alias}". Alle gegevens komen uit het Nmbrs-account waarmee voor deze koppeling is ingelogd. Met nmbrs_get_account zie je om welk account het gaat.` : undefined,
    accountSummary,
    baseInstructions(config.includeAbsenceCause),
  ]
    .filter(Boolean)
    .join("\n\n");

  const server = new McpServer({ name: alias ? `nmbrs-mcp-${alias}` : "nmbrs-mcp", version: "0.8.0" }, { instructions });
  registerCompanyTools(server);
  registerEmployeeTools(server);
  registerSalaryTools(server);
  registerLeaveTools(server);
  registerAbsenceTools(server);
  registerPayrollTools(server);
  registerCostTools(server);
  registerWageComponentTools(server);
  return server;
}
