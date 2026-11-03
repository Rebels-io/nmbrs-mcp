import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getCompanySnapshot,
  listAbsenceDossiers,
  listCompanies,
  listLeaveGroups,
  listLeaveRequests,
} from "../nmbrs/endpoints.js";
import { compact, day, employeeName, today } from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { optionalCompanyIdArg, respond } from "./shared.js";

async function selectedCompanies(companyId?: string) {
  const companies = await listCompanies();
  return companies.filter((company) => !companyId || company.companyId === companyId);
}

export function registerAbsenceTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_list_leave_requests",
    {
      description:
        "Geeft verlofaanvragen per medewerker, standaard alleen de openstaande (status pending). Gebruik deze tool voor de vraag welke verlofaanvragen er nog open staan of zijn goedgekeurd. Voor het resterende saldo gebruik je nmbrs_get_leave_balance. Declaraties en onkostenvergoedingen kan Nmbrs via deze koppeling niet leveren.",
      inputSchema: {
        companyId: optionalCompanyIdArg,
        status: z.enum(["pending", "approved", "rejected"]).optional().describe("Standaard pending."),
        year: z.number().int().optional().describe("Alleen aanvragen in dit jaar."),
      },
    },
    ({ companyId, status, year }) =>
      respond(async () => {
        const companies = await selectedCompanies(companyId);
        const perCompany = await mapLimit(companies, 2, async (company) => {
          const [requests, groups, snapshot] = await Promise.all([
            listLeaveRequests(company.companyId, { status: status ?? "pending", year }),
            listLeaveGroups(company.companyId),
            getCompanySnapshot(company.companyId),
          ]);
          const names = new Map(snapshot.employees.map((row) => [row.employeeId, employeeName(row.employeeBasicInfo)]));
          return [...requests.entries()].flatMap(([employeeId, list]) =>
            list.map((request) => {
              const group = groups.find((g) => g.leaveGroupId === request.leaveGroupId);
              return compact({
                employee: names.get(employeeId) ?? employeeId,
                companyName: company.name,
                leaveType: group?.description || group?.group,
                status: request.status,
                startDate: day(request.startDate),
                endDate: day(request.endDate),
                hours: request.hours,
              });
            })
          );
        });
        const requests = perCompany.flat().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
        return { count: requests.length, requests };
      })
  );

  server.registerTool(
    "nmbrs_list_absences",
    {
      description:
        "Geeft welke medewerkers nu ziek gemeld zijn, met begindatum en percentage. Gebruik deze tool voor de vraag wie er nu ziek is. Geeft met from ook ziekmeldingen die sinds die datum zijn afgelopen. De oorzaak van het verzuim wordt bewust niet getoond, speculeer daar niet over.",
      inputSchema: {
        companyId: optionalCompanyIdArg,
        from: z.string().optional().describe("Datum als YYYY-MM-DD. Toont ook afgelopen ziekmeldingen vanaf deze datum."),
      },
    },
    ({ companyId, from }) =>
      respond(async () => {
        const now = today();
        const companies = await selectedCompanies(companyId);
        const perCompany = await mapLimit(companies, 2, async (company) => {
          const [dossiers, snapshot] = await Promise.all([listAbsenceDossiers(company.companyId), getCompanySnapshot(company.companyId)]);
          const names = new Map(snapshot.employees.map((row) => [row.employeeId, employeeName(row.employeeBasicInfo)]));
          return [...dossiers.entries()].flatMap(([employeeId, list]) =>
            list.flatMap((dossier) =>
              (dossier.employeeAbsences ?? [])
                .map((registration) => ({
                  start: day(registration.startDate ?? registration.registrationStartDate),
                  end: day(registration.endDate ?? registration.registrationEndDate),
                  percentage: registration.percentage,
                }))
                .filter(({ start, end }) => {
                  const current = (start ?? "") <= now && (!end || end >= now);
                  return current || (from !== undefined && (!end || end >= from));
                })
                .map(({ start, end, percentage }) =>
                  compact({
                    employee: names.get(employeeId) ?? employeeId,
                    companyName: company.name,
                    type: dossier.absenceDossierType,
                    startDate: start,
                    endDate: end,
                    percentage,
                    ongoing: !end || end >= now ? true : undefined,
                  })
                )
            )
          );
        });
        const absences = perCompany.flat().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
        return { count: absences.length, absences };
      })
  );
}
