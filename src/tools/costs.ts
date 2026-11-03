import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  companyHistory,
  getCompanySnapshot,
  getCurrentPeriod,
  listCostPerHour,
  type Contract,
  type Salary,
  type Schedule,
} from "../nmbrs/endpoints.js";
import { compact, currentByStartDate, daysBetween, day, employeeName, isActive, latestByPeriod, today } from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { optionalCompanyIdArg, respond, selectedCompanies } from "./shared.js";

const WEEKS_PER_MONTH = 52 / 12;
const euro = (value: number): number => Math.round(value);

function monthlyGross(salary: Salary | undefined, schedule: Schedule | undefined): number | undefined {
  if (!salary) return undefined;
  const hours = schedule?.hoursPerWeek;
  switch (salary.type) {
    case "grossFulltimeSalary":
      return salary.value * ((schedule?.parttimePercentage ?? 100) / 100);
    case "grossParttimeSalary":
      return salary.value;
    case "grossHourlyWage":
      return hours ? salary.value * hours * WEEKS_PER_MONTH : undefined;
    default:
      return undefined;
  }
}

export function registerCostTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_get_labour_costs",
    {
      description:
        "Geeft een indicatie van loonkosten per afdeling: geschat bruto maandloon en geschatte werkgeverskosten per maand, opgeteld over medewerkers in dienst. Gebruik deze tool voor vragen over loonkosten per afdeling of per bedrijf. De cijfers zijn een schatting uit huidig salaris, rooster en kosten per uur, geen boekhoudkundige waarde. Voor exacte bedragen per run gebruik je nmbrs_get_payroll_journals. Er worden geen bedragen per persoon getoond.",
      inputSchema: { companyId: optionalCompanyIdArg },
    },
    ({ companyId }) =>
      respond(async () => {
        const companies = await selectedCompanies(companyId);
        const perCompany = await mapLimit(companies, 2, async (company) => {
          const current = await getCurrentPeriod(company.companyId).catch(() => undefined);
          const [snapshot, salaries, schedules, costs] = await Promise.all([
            getCompanySnapshot(company.companyId),
            companyHistory<Salary>(company.companyId, "salaries", "salaries"),
            companyHistory<Schedule>(company.companyId, "schedules", "schedules"),
            listCostPerHour(company.companyId, { year: current?.period?.year, period: current?.period?.period }).catch(() => []),
          ]);
          const costPerHour = new Map(costs.map((row) => [row.employeeId, Number(String(row.costPerHour ?? "").replace(",", "."))]));

          const departments = new Map<string, { employees: number; gross: number; grossKnown: number; employer: number; employerKnown: number }>();
          for (const row of snapshot.employees.filter(isActive)) {
            const department = latestByPeriod(snapshot.departments.get(row.employeeId))?.description ?? "Onbekend";
            const entry = departments.get(department) ?? { employees: 0, gross: 0, grossKnown: 0, employer: 0, employerKnown: 0 };
            const schedule = currentByStartDate(schedules.get(row.employeeId));
            const gross = monthlyGross(currentByStartDate(salaries.get(row.employeeId)), schedule);
            const perHour = costPerHour.get(row.employeeId);
            const employer = perHour && Number.isFinite(perHour) && schedule?.hoursPerWeek ? perHour * schedule.hoursPerWeek * WEEKS_PER_MONTH : undefined;

            entry.employees += 1;
            if (gross !== undefined) {
              entry.gross += gross;
              entry.grossKnown += 1;
            }
            if (employer !== undefined) {
              entry.employer += employer;
              entry.employerKnown += 1;
            }
            departments.set(department, entry);
          }

          const rows = [...departments.entries()].map(([department, e]) => ({
            department,
            employees: e.employees,
            estimatedGrossPerMonth: e.grossKnown > 0 ? euro(e.gross) : undefined,
            grossBasedOnEmployees: e.grossKnown,
            estimatedEmployerCostPerMonth: e.employerKnown > 0 ? euro(e.employer) : undefined,
            employerCostBasedOnEmployees: e.employerKnown,
          }));
          const sum = (pick: (r: (typeof rows)[number]) => number | undefined) => rows.reduce((total, r) => total + (pick(r) ?? 0), 0);

          return {
            companyName: company.name,
            period: current?.displayPeriod,
            total: compact({
              employees: sum((r) => r.employees),
              estimatedGrossPerMonth: euro(sum((r) => r.estimatedGrossPerMonth)),
              estimatedEmployerCostPerMonth: euro(sum((r) => r.estimatedEmployerCostPerMonth)),
            }),
            perDepartment: rows.map((r) => compact(r)).sort((a, b) => (b.estimatedGrossPerMonth ?? 0) - (a.estimatedGrossPerMonth ?? 0)),
          };
        });
        return {
          indicative: true,
          method:
            "Bruto maandloon: fulltime salaris maal parttimepercentage, parttime salaris zoals vastgelegd, uurloon maal uren per week maal 52/12. Werkgeverskosten: kosten per uur maal uren per week maal 52/12. Medewerkers zonder bruikbaar salaris of rooster tellen niet mee in de bedragen; zie de kolommen basedOnEmployees.",
          companies: perCompany,
        };
      })
  );

  server.registerTool(
    "nmbrs_list_expiring_contracts",
    {
      description:
        "Geeft medewerkers in dienst met een contract dat binnen een aantal dagen afloopt of al is afgelopen, zonder opvolgend contract. Gebruik deze tool voor vragen over aflopende of te verlengen contracten. Standaard de komende 90 dagen. Contracten voor onbepaalde tijd komen er niet in voor.",
      inputSchema: {
        companyId: optionalCompanyIdArg,
        days: z.number().int().min(1).max(730).optional().describe("Aantal dagen vooruit. Standaard 90."),
      },
    },
    ({ companyId, days }) =>
      respond(async () => {
        const horizon = days ?? 90;
        const now = today();
        const companies = await selectedCompanies(companyId);
        const perCompany = await mapLimit(companies, 2, async (company) => {
          const [snapshot, contracts] = await Promise.all([
            getCompanySnapshot(company.companyId),
            companyHistory<Contract>(company.companyId, "contracts", "contracts"),
          ]);
          return snapshot.employees.filter(isActive).flatMap((row) => {
            const list = contracts.get(row.employeeId) ?? [];
            const contract = currentByStartDate(list);
            const end = day(contract?.endDate);
            if (!contract || contract.indefinite === true || !end) return [];
            if (list.some((c) => (day(c.startDate) ?? "") > end)) return [];
            const daysLeft = daysBetween(now, end);
            if (daysLeft > horizon) return [];
            return [
              compact({
                employee: employeeName(row.employeeBasicInfo),
                companyName: company.name,
                function: latestByPeriod(snapshot.functions.get(row.employeeId))?.description,
                department: latestByPeriod(snapshot.departments.get(row.employeeId))?.description,
                contractEnd: end,
                daysLeft,
                expired: daysLeft < 0 ? true : undefined,
                hoursPerWeek: contract.hoursPerWeek ?? undefined,
              }),
            ];
          });
        });
        const contracts = perCompany.flat().sort((a, b) => String(a.contractEnd).localeCompare(String(b.contractEnd)));
        return { count: contracts.length, horizonDays: horizon, contracts };
      })
  );
}
