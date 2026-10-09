import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findCompanyOfEmployee, listLeaveBalances, listLeaveGroups } from "../nmbrs/endpoints.js";
import { compact } from "../nmbrs/mappers.js";
import { employeeIdArg, optionalCompanyIdArg, respond } from "./shared.js";

export function registerLeaveTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_get_leave_balance",
    {
      description:
        "Geeft het resterende verlofsaldo van één medewerker per verlofsoort. Gebruik deze tool voor de vraag hoeveel verlof nog open staat. Nmbrs geeft alleen het resterende saldo, geen opgebouwd of opgenomen verlof.",
      inputSchema: { employeeId: employeeIdArg, companyId: optionalCompanyIdArg },
    },
    ({ employeeId, companyId: givenCompanyId }) =>
      respond(async () => {
        const companyId = await findCompanyOfEmployee(employeeId, givenCompanyId);
        const [balances, groups] = await Promise.all([listLeaveBalances(companyId, employeeId), listLeaveGroups(companyId)]);
        return (balances.get(employeeId) ?? []).map((balance) => {
          const group = groups.find((g) => g.leaveGroupId === balance.leaveGroupId);
          return compact({
            leaveType: group?.description || group?.group || balance.leaveGroupId,
            remaining: balance.leaveBalance,
          });
        });
      })
  );
}
