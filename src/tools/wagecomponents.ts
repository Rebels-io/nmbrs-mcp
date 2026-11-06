import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findCompanyOfEmployee, getCompanySnapshot, getCurrentPeriod, listVariableWageComponents } from "../nmbrs/endpoints.js";
import { compact, employeeName } from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { employeeIdArg, optionalCompanyIdArg, respond, selectedCompanies } from "./shared.js";

const NOTE =
  "Dit zijn alleen variabele looncomponenten die Nmbrs al heeft weggeschreven voor de verloning. Declaraties die nog open staan, in behandeling zijn of zijn afgekeurd ontbreken, net als status en categorie. De code heeft geen omschrijving: vraag bij Nmbrs of de salarisadministratie welke code voor declaraties wordt gebruikt.";

const round = (value: number): number => Math.round(value * 100) / 100;

export function registerWageComponentTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_list_variable_wage_components",
    {
      description:
        "Geeft de variabele looncomponenten (code, bedrag en opmerking) per medewerker voor één periode, standaard de huidige. Goedgekeurde declaraties die klaarstaan voor de verloning staan hier als variabel looncomponent, naast andere variabele uitbetalingen. Gebruik deze tool voor de vraag welke declaraties of bonussen in een periode zijn verwerkt. Openstaande of afgekeurde declaraties staan er niet in. Voor het salaris zelf gebruik je nmbrs_get_salary_history.",
      inputSchema: {
        companyId: optionalCompanyIdArg,
        employeeId: employeeIdArg.optional().describe("Beperk tot één medewerker. Id te vinden met nmbrs_search_employees."),
        year: z.number().int().optional().describe("Alleen samen met period. Standaard de huidige periode."),
        period: z.number().int().optional().describe("Periodenummer binnen het jaar."),
        code: z.number().int().optional().describe("Alleen componenten met deze looncomponentcode."),
      },
    },
    ({ companyId, employeeId, year, period, code }) =>
      respond(async () => {
        if ((year === undefined) !== (period === undefined)) {
          throw new Error("Geef jaar en periode samen op, of laat beide leeg voor de huidige periode.");
        }
        const companies = employeeId
          ? await selectedCompanies(await findCompanyOfEmployee(employeeId, companyId))
          : await selectedCompanies(companyId);

        return mapLimit(companies, 2, async (company) => {
          const [components, snapshot, current] = await Promise.all([
            listVariableWageComponents(company.companyId, { employeeId, year, period }),
            getCompanySnapshot(company.companyId),
            year === undefined ? getCurrentPeriod(company.companyId).catch(() => undefined) : undefined,
          ]);
          const names = new Map(snapshot.employees.map((row) => [row.employeeId, employeeName(row.employeeBasicInfo)]));

          const rows = [...components.entries()]
            .flatMap(([id, list]) =>
              list
                .filter((item) => code === undefined || item.code === code)
                .map((item) => ({
                  employee: names.get(id) ?? id,
                  code: item.code,
                  amount: item.value,
                  comment: item.comment ?? undefined,
                }))
            )
            .sort((a, b) => a.employee.localeCompare(b.employee) || (a.code ?? 0) - (b.code ?? 0));

          const totals = new Map<number, { total: number; count: number }>();
          for (const row of rows) {
            if (row.code === undefined || row.amount === undefined) continue;
            const entry = totals.get(row.code) ?? { total: 0, count: 0 };
            totals.set(row.code, { total: entry.total + row.amount, count: entry.count + 1 });
          }

          return {
            companyName: company.name,
            period: year !== undefined ? `${year} periode ${period}` : current?.displayPeriod ?? "huidige periode",
            componentCount: rows.length,
            totalsByCode: [...totals.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([componentCode, value]) => ({ code: componentCode, count: value.count, total: round(value.total) })),
            components: rows.map((row) => compact(row)),
            note: NOTE,
          };
        });
      })
  );
}
