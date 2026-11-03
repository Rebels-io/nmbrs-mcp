import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "./config.js";
import { registerAbsenceTools } from "./tools/absence.js";
import { registerCostTools } from "./tools/costs.js";
import { registerCompanyTools } from "./tools/companies.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerLeaveTools } from "./tools/leave.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerSalaryTools } from "./tools/salary.js";

export function createServer(): McpServer {
  getConfig();

  const server = new McpServer({ name: "nmbrs-mcp", version: "0.5.0" });
  registerCompanyTools(server);
  registerEmployeeTools(server);
  registerSalaryTools(server);
  registerLeaveTools(server);
  registerAbsenceTools(server);
  registerPayrollTools(server);
  registerCostTools(server);
  return server;
}
