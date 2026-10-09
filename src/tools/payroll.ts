import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { countEmployeesInRun, listPayrollRuns } from "../nmbrs/endpoints.js";
import { compact, day } from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { companyIdArg, respond } from "./shared.js";

export function registerPayrollTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_list_payroll_runs",
    {
      description:
        "Geeft de salarisruns van één bedrijf in één jaar, met status en aantal medewerkers. Gebruik deze tool voor de vraag welke runs zijn gedraaid. Voor het salaris van één medewerker gebruik je nmbrs_get_salary_history.",
      inputSchema: {
        companyId: companyIdArg,
        year: z.number().int().describe("Jaartal, bijvoorbeeld 2026."),
      },
    },
    ({ companyId, year }) =>
      respond(async () => {
        const runs = await listPayrollRuns(companyId, year);
        return mapLimit(runs, 4, async (run) =>
          compact({
            runId: run.payrollRunId,
            period: compact({ year: run.year, number: run.number, description: run.description }),
            type: run.type,
            status: run.locked ? "afgesloten" : "open",
            runDate: day(run.createdAt),
            employeeCount: await countEmployeesInRun(companyId, run.payrollRunId).catch(() => undefined),
          })
        );
      })
  );
}
