import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { companyHistory, countEmployees, getCompanySnapshot, listCompanies, type CostCenterEntry } from "../nmbrs/endpoints.js";
import { isActive, latestByPeriod } from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { companyIdArg, respond } from "./shared.js";

function countBy(entries: Array<string | undefined>) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, employees]) => ({ name, employees }));
}

export function registerCompanyTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_list_companies",
    {
      description:
        "Geeft alle bedrijven onder de ingelogde Nmbrs debtor, met het aantal actieve medewerkers. Gebruik deze tool eerst om een companyId te vinden. Voor medewerkers gebruik je nmbrs_search_employees.",
    },
    () =>
      respond(async () => {
        const companies = await listCompanies();
        return mapLimit(companies, 4, async (company) => ({
          id: company.companyId,
          name: company.name,
          number: company.number,
          employeeCount: await countEmployees(company.companyId, "payroll").catch(() => undefined),
        }));
      })
  );

  server.registerTool(
    "nmbrs_get_company_structure",
    {
      description:
        "Geeft per afdeling, functie en kostenplaats het aantal actieve medewerkers in één bedrijf. Gebruik deze tool voor vragen als hoeveel medewerkers er per afdeling werken of welke functie het vaakst voorkomt. Voor één medewerker gebruik je nmbrs_get_employee_overview.",
      inputSchema: { companyId: companyIdArg },
    },
    ({ companyId }) =>
      respond(async () => {
        const [snapshot, costCenterHistory] = await Promise.all([
          getCompanySnapshot(companyId),
          companyHistory<CostCenterEntry>(companyId, "costcenters", "employeeCostCenters"),
        ]);
        const active = snapshot.employees.filter(isActive);

        const departments = active.map((row) => latestByPeriod(snapshot.departments.get(row.employeeId))?.description);
        const functions = active.map((row) => latestByPeriod(snapshot.functions.get(row.employeeId))?.description);

        const costCenters = active.flatMap((row) => {
          const entries = costCenterHistory.get(row.employeeId) ?? [];
          const latest = latestByPeriod(entries);
          return entries
            .filter((e) => e.period?.year === latest?.period?.year && e.period?.period === latest?.period?.period)
            .map((e) => e.costCenters?.description ?? e.costCenters?.code);
        });

        return {
          activeEmployees: active.length,
          departments: countBy(departments),
          functions: countBy(functions),
          costCenters: countBy(costCenters),
        };
      })
  );
}
