import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  companyHistory,
  findCompanyOfEmployee,
  getCompanySnapshot,
  listCompanies,
  listEmployees,
  type CodeEntry,
  type Contract,
  type Employment,
  type ManagerEntry,
  type Salary,
  type Schedule,
} from "../nmbrs/endpoints.js";
import {
  compact,
  currentByStartDate,
  employeeName,
  isActive,
  latestByPeriod,
  managerName,
  mapContract,
  mapEmployment,
  mapSalary,
  mapSchedule,
  normalize,
} from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { employeeIdArg, optionalCompanyIdArg, respond } from "./shared.js";

const MAX_RESULTS = 50;

export function registerEmployeeTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_search_employees",
    {
      description:
        "Zoekt medewerkers op naam of personeelsnummer. Gebruik deze tool om een employeeId te vinden. Geeft maximaal 50 resultaten. Voor de details van één medewerker gebruik je nmbrs_get_employee_overview.",
      inputSchema: {
        query: z.string().optional().describe("Naam of personeelsnummer. Laat leeg voor alle medewerkers."),
        companyId: optionalCompanyIdArg,
        activeOnly: z.boolean().optional().describe("Alleen medewerkers in dienst. Standaard true."),
      },
    },
    ({ query, companyId, activeOnly }) =>
      respond(async () => {
        const companies = (await listCompanies()).filter((c) => !companyId || c.companyId === companyId);
        const tokens = normalize(query ?? "").split(/\s+/).filter(Boolean);

        const perCompany = await mapLimit(companies, 2, async (company) => {
          const snapshot = await getCompanySnapshot(company.companyId);
          return snapshot.employees
            .filter((row) => (activeOnly ?? true ? isActive(row) : true))
            .map((row) => {
              const name = employeeName(row.employeeBasicInfo);
              const number = String(row.employeeBasicInfo.employeeNumber ?? "");
              const haystack = normalize(name);
              const hits = tokens.filter((t) => haystack.includes(t) || number === t).length;
              return {
                hits,
                result: compact({
                  id: row.employeeId,
                  name,
                  employeeNumber: row.employeeBasicInfo.employeeNumber,
                  companyName: company.name,
                  function: latestByPeriod(snapshot.functions.get(row.employeeId))?.description,
                  department: latestByPeriod(snapshot.departments.get(row.employeeId))?.description,
                }),
              };
            });
        });

        const matches = perCompany
          .flat()
          .filter((m) => tokens.length === 0 || m.hits === tokens.length)
          .sort((a, b) => String(a.result.name).localeCompare(String(b.result.name)));

        return compact({
          total: matches.length,
          employees: matches.slice(0, MAX_RESULTS).map((m) => m.result),
          hint:
            matches.length > MAX_RESULTS
              ? `Er zijn ${matches.length} resultaten, alleen de eerste ${MAX_RESULTS} staan hier. Verfijn de zoekterm of geef een companyId.`
              : undefined,
        });
      })
  );

  server.registerTool(
    "nmbrs_get_employee_overview",
    {
      description:
        "Geeft van één medewerker het dienstverband, contract, functie, afdeling, manager, huidig salaris en rooster. Gebruik deze tool voor het huidige salaris. Voor eerdere salarissen gebruik je nmbrs_get_salary_history.",
      inputSchema: { employeeId: employeeIdArg, companyId: optionalCompanyIdArg },
    },
    ({ employeeId, companyId: givenCompanyId }) =>
      respond(async () => {
        const companyId = await findCompanyOfEmployee(employeeId, givenCompanyId);
        const hist = <T>(resource: string, key: string) => companyHistory<T>(companyId, resource, key, employeeId);

        const [rows, companies, employments, contracts, functions, departments, managers, salaries, schedules] =
          await Promise.all([
            listEmployees(companyId, { employeeId }),
            listCompanies(),
            hist<Employment>("employments", "employments"),
            hist<Contract>("contracts", "contracts"),
            hist<CodeEntry>("functions", "functions"),
            hist<CodeEntry>("departments", "departments"),
            hist<ManagerEntry>("managers", "managers"),
            hist<Salary>("salaries", "salaries"),
            hist<Schedule>("schedules", "schedules"),
          ]);

        const row = rows[0];
        if (!row) {
          throw new Error(`Medewerker ${employeeId} is niet gevonden. Zoek de juiste id met nmbrs_search_employees.`);
        }
        const salary = currentByStartDate(salaries.get(employeeId));

        return compact({
          id: employeeId,
          name: employeeName(row.employeeBasicInfo),
          employeeNumber: row.employeeBasicInfo.employeeNumber,
          employeeType: row.employeeBasicInfo.employeeType,
          companyName: companies.find((c) => c.companyId === companyId)?.name,
          function: latestByPeriod(functions.get(employeeId))?.description,
          department: latestByPeriod(departments.get(employeeId))?.description,
          manager: managerName(latestByPeriod(managers.get(employeeId))),
          ...mapEmployment(currentByStartDate(employments.get(employeeId))),
          ...mapContract(currentByStartDate(contracts.get(employeeId))),
          salary: salary ? mapSalary(salary) : undefined,
          schedule: mapSchedule(currentByStartDate(schedules.get(employeeId))),
        });
      })
  );
}
