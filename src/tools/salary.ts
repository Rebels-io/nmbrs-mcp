import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { companyHistory, findCompanyOfEmployee, type Salary } from "../nmbrs/endpoints.js";
import { day, mapSalary } from "../nmbrs/mappers.js";
import { employeeIdArg, optionalCompanyIdArg, respond } from "./shared.js";

export function registerSalaryTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_get_salary_history",
    {
      description:
        "Geeft alle salarissen van één medewerker over de tijd, oudste eerst. Gebruik deze tool voor de salarisontwikkeling. Voor het huidige salaris gebruik je nmbrs_get_employee_overview.",
      inputSchema: {
        employeeId: employeeIdArg,
        companyId: optionalCompanyIdArg,
        from: z.string().optional().describe("Begindatum als YYYY-MM-DD."),
        to: z.string().optional().describe("Einddatum als YYYY-MM-DD."),
      },
    },
    ({ employeeId, companyId: givenCompanyId, from, to }) =>
      respond(async () => {
        const companyId = await findCompanyOfEmployee(employeeId, givenCompanyId);
        const salaries = (await companyHistory<Salary>(companyId, "salaries", "salaries", employeeId)).get(employeeId);
        if (!salaries) {
          throw new Error(`Geen salarissen gevonden voor ${employeeId}. Controleer de id met nmbrs_search_employees.`);
        }
        return salaries
          .filter((s) => (!from || (day(s.startDate) ?? "") >= from) && (!to || (day(s.startDate) ?? "") <= to))
          .sort((a, b) => a.startDate.localeCompare(b.startDate))
          .map(mapSalary);
      })
  );
}
