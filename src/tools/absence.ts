import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig } from "../config.js";
import { getCompanySnapshot, listAbsenceDossiers, listLeaveGroups, listLeaveRequests } from "../nmbrs/endpoints.js";
import {
  addDays,
  compact,
  daysBetween,
  day,
  employeeName,
  isActive,
  latestByPeriod,
  maxDay,
  minDay,
  today,
} from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { optionalCompanyIdArg, respond, selectedCompanies } from "./shared.js";

const percent = (value: number): number => Math.round(value * 100) / 100;

export function registerAbsenceTools(server: McpServer): void {
  const withCause = getConfig().includeAbsenceCause;

  server.registerTool(
    "nmbrs_list_leave_requests",
    {
      description:
        "Geeft verlofaanvragen per medewerker, standaard alleen de openstaande (status pending). Gebruik deze tool voor de vraag welke verlofaanvragen er nog open staan of zijn goedgekeurd. Voor het resterende saldo gebruik je nmbrs_get_leave_balance. Voor verwerkte declaraties gebruik je nmbrs_list_variable_wage_components.",
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
      description: `Geeft welke medewerkers nu ziek gemeld zijn, met begindatum en percentage${withCause ? " en de oorzaak zoals Nmbrs die registreert" : ""}. Gebruik deze tool voor de vraag wie er nu ziek is. Geeft met from ook ziekmeldingen die sinds die datum zijn afgelopen. Voor percentages en trends over een periode gebruik je nmbrs_get_absence_overview.${withCause ? " De oorzaak is een gezondheidsgegeven: noem hem alleen als er expliciet om gevraagd wordt." : " De oorzaak van het verzuim wordt niet getoond, speculeer daar niet over."}`,
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
                    cause: withCause ? dossier.absenceCause : undefined,
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

  server.registerTool(
    "nmbrs_get_absence_overview",
    {
      description: `Geeft verzuimcijfers over een periode: verzuimpercentage, aantal nieuwe meldingen, gemiddelde duur van afgesloten meldingen en verzuim per afdeling${withCause ? ", plus het aantal meldingen per oorzaak" : ""}. Gebruik deze tool voor vragen over verzuimpercentage, frequentie of trends. Voor de vraag wie er nu ziek is gebruik je nmbrs_list_absences. Het percentage is een benadering op kalenderdagen met het huidige aantal medewerkers in dienst als noemer.`,
      inputSchema: {
        companyId: optionalCompanyIdArg,
        from: z.string().optional().describe("Begin van de periode als YYYY-MM-DD. Standaard 365 dagen geleden."),
        to: z.string().optional().describe("Einde van de periode als YYYY-MM-DD. Standaard vandaag."),
      },
    },
    ({ companyId, from, to }) =>
      respond(async () => {
        const end = to ?? today();
        const start = from ?? addDays(end, -364);
        const periodDays = daysBetween(start, end) + 1;
        const companies = await selectedCompanies(companyId);

        const perCompany = await mapLimit(companies, 2, async (company) => {
          const [dossiers, snapshot] = await Promise.all([listAbsenceDossiers(company.companyId), getCompanySnapshot(company.companyId)]);
          const activeEmployees = snapshot.employees.filter(isActive);
          const departmentOf = (employeeId: string) =>
            latestByPeriod(snapshot.departments.get(employeeId))?.description ?? "Onbekend";

          let absentDays = 0;
          let newCases = 0;
          const completedDurations: number[] = [];
          const byDepartment = new Map<string, number>();
          const byCause = new Map<string, number>();

          for (const [employeeId, list] of dossiers) {
            for (const dossier of list) {
              const registrations = (dossier.employeeAbsences ?? [])
                .map((r) => ({
                  s: day(r.startDate ?? r.registrationStartDate),
                  e: day(r.endDate ?? r.registrationEndDate),
                  weight: (r.percentage ?? 100) / 100,
                }))
                .filter((r): r is { s: string; e: string | undefined; weight: number } => r.s !== undefined);

              let weightedDays = 0;
              let overlaps = false;
              for (const r of registrations) {
                const from2 = maxDay(r.s, start);
                const to2 = minDay(r.e ?? end, end);
                if (from2 > to2) continue;
                overlaps = true;
                weightedDays += (daysBetween(from2, to2) + 1) * r.weight;
              }
              if (!overlaps) continue;

              absentDays += weightedDays;
              byDepartment.set(departmentOf(employeeId), (byDepartment.get(departmentOf(employeeId)) ?? 0) + weightedDays);

              const firstStart = registrations.map((r) => r.s).sort()[0] as string;
              if (firstStart >= start) {
                newCases += 1;
                if (withCause) {
                  const cause = dossier.absenceCause || "Onbekend";
                  byCause.set(cause, (byCause.get(cause) ?? 0) + 1);
                }
              }
              const open = registrations.some((r) => !r.e || r.e > end);
              if (!open) {
                const lastEnd = registrations.map((r) => r.e as string).sort().at(-1) as string;
                completedDurations.push(daysBetween(firstStart, lastEnd) + 1);
              }
            }
          }

          const denominator = activeEmployees.length * periodDays;
          const departmentHeadcount = new Map<string, number>();
          for (const row of activeEmployees) {
            const name = departmentOf(row.employeeId);
            departmentHeadcount.set(name, (departmentHeadcount.get(name) ?? 0) + 1);
          }

          return compact({
            companyName: company.name,
            activeEmployees: activeEmployees.length,
            absentDays: Math.round(absentDays),
            absencePercentage: denominator > 0 ? percent((absentDays / denominator) * 100) : undefined,
            newCases,
            casesPerEmployee: activeEmployees.length > 0 ? percent(newCases / activeEmployees.length) : undefined,
            averageCaseDays:
              completedDurations.length > 0
                ? percent(completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length)
                : undefined,
            perDepartment: [...byDepartment.entries()]
              .map(([department, days]) => {
                const headcount = departmentHeadcount.get(department) ?? 0;
                return compact({
                  department,
                  absentDays: Math.round(days),
                  employees: headcount,
                  absencePercentage: headcount > 0 ? percent((days / (headcount * periodDays)) * 100) : undefined,
                });
              })
              .sort((a, b) => (b.absentDays ?? 0) - (a.absentDays ?? 0)),
            perCause: withCause
              ? [...byCause.entries()].map(([cause, cases]) => ({ cause, cases })).sort((a, b) => b.cases - a.cases)
              : undefined,
          });
        });

        return { period: { from: start, to: end, days: periodDays }, companies: perCompany };
      })
  );
}
