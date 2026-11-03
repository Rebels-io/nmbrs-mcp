import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  countEmployeesInRun,
  fetchJournalXml,
  getCompanyName,
  getCurrentPeriod,
  getPayrollWorkflow,
  listPayrollRuns,
  type JournalKind,
} from "../nmbrs/endpoints.js";
import { NmbrsApiError } from "../nmbrs/client.js";
import { compact, day } from "../nmbrs/mappers.js";
import { mapLimit } from "../nmbrs/util.js";
import { companyIdArg, optionalCompanyIdArg, respond, selectedCompanies } from "./shared.js";

const DONE_STATUSES = new Set(["complete", "ignored", "none"]);
const MAX_JOURNAL_CHARS = 60_000;

export function registerPayrollTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_list_payroll_runs",
    {
      description:
        "Geeft de salarisruns van één bedrijf in één jaar, met status en aantal medewerkers. Gebruik deze tool voor de vraag welke runs zijn gedraaid. Voor wat er in de huidige periode nog openstaat gebruik je nmbrs_get_payroll_workflow. Voor het salaris van één medewerker gebruik je nmbrs_get_salary_history.",
      inputSchema: {
        companyId: companyIdArg,
        year: z.number().int().describe("Jaartal, bijvoorbeeld 2026."),
      },
    },
    ({ companyId, year }) =>
      respond(async () => {
        const [runs, companyName] = await Promise.all([listPayrollRuns(companyId, year), getCompanyName(companyId)]);
        return {
          companyName,
          runs: await mapLimit(runs, 4, async (run) =>
            compact({
              runId: run.payrollRunId,
              period: compact({ year: run.year, number: run.number, description: run.description }),
              type: run.type,
              status: run.locked ? "afgesloten" : "open",
              runDate: day(run.createdAt),
              employeeCount: await countEmployeesInRun(companyId, run.payrollRunId).catch(() => undefined),
            })
          ),
        };
      })
  );

  server.registerTool(
    "nmbrs_get_payroll_workflow",
    {
      description:
        "Geeft de voortgang van de salarisverwerking voor één periode: loonrun, loonaangifte, pensioenexport en periode, met per stap de status en de lijst van wat nog openstaat. Gebruik deze tool voor de vraag of de loonrun klaar is of wat er nog moet gebeuren. Standaard de huidige periode. Voor eerdere runs gebruik je nmbrs_list_payroll_runs.",
      inputSchema: {
        companyId: optionalCompanyIdArg,
        year: z.number().int().optional().describe("Alleen samen met period. Standaard de huidige periode."),
        period: z.number().int().optional().describe("Periodenummer binnen het jaar."),
      },
    },
    ({ companyId, year, period }) =>
      respond(async () => {
        const companies = await selectedCompanies(companyId);
        return mapLimit(companies, 2, async (company) => {
          const current = year !== undefined && period !== undefined ? undefined : await getCurrentPeriod(company.companyId);
          const wantedYear = year ?? current?.period?.year;
          const wantedPeriod = period ?? current?.period?.period;
          const rows = await getPayrollWorkflow(company.companyId, { year: wantedYear, period: wantedPeriod });
          const tracks = rows
            .flatMap((row) => row.periods.filter((p) => wantedPeriod === undefined || p.period === wantedPeriod))
            .flatMap((p) => p.tracks)
            .filter((track) => track.status.toLowerCase() !== "none" || track.actions.length > 0);

          const openActions = tracks.flatMap((track) =>
            track.actions
              .filter((a) => !DONE_STATUSES.has((a.status.label ?? "").toLowerCase()))
              .map((a) => `${track.name}: ${a.action.label} (${a.status.label})`)
          );

          return compact({
            companyName: company.name,
            period: current?.displayPeriod ?? (wantedYear && wantedPeriod ? `${wantedYear} periode ${wantedPeriod}` : undefined),
            openActions,
            tracks: tracks.map((track) => ({
              name: track.name,
              status: track.status,
              actions: track.actions.map((a) =>
                compact({ action: a.action.label, status: a.status.label, runAt: day(a.runAt) })
              ),
            })),
          });
        });
      })
  );

  server.registerTool(
    "nmbrs_get_payroll_journals",
    {
      description:
        "Geeft de journaalposten (boekingen naar de administratie) van een salarisrun, in totaal of gesplitst per afdeling, medewerker, kostenplaats of kostendrager. Gebruik deze tool voor boekingsvragen over een loonrun. Standaard de laatste afgesloten run van het jaar. Voor alleen de lijst met runs gebruik je nmbrs_list_payroll_runs. De uitvoer bevat de structuur zoals Nmbrs hem levert.",
      inputSchema: {
        companyId: companyIdArg,
        payrollRunId: z.string().uuid().optional().describe("Id van de run. Standaard de laatste afgesloten run van het jaar."),
        year: z.number().int().optional().describe("Jaar van de run. Standaard dit jaar."),
        groupBy: z
          .enum(["total", "department", "employee", "costcenter", "costunit"])
          .optional()
          .describe("Standaard total."),
      },
    },
    ({ companyId, payrollRunId, year, groupBy }) =>
      respond(async () => {
        const wantedYear = year ?? new Date().getFullYear();
        const runs = await listPayrollRuns(companyId, wantedYear);
        const run = payrollRunId
          ? runs.find((r) => r.payrollRunId === payrollRunId)
          : [...runs].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).filter((r) => r.locked).at(-1) ??
            runs.at(-1);
        if (!run) throw new Error(`Geen salarisrun gevonden voor ${wantedYear}. Kijk met nmbrs_list_payroll_runs welke runs er zijn.`);

        const kind: JournalKind = groupBy ?? "total";
        let xml: string;
        try {
          xml = await fetchJournalXml(companyId, run.payrollRunId, run.year ?? wantedYear, kind);
        } catch (err) {
          if (err instanceof NmbrsApiError && err.status === 403) {
            throw new Error(
              "Je Nmbrs-login heeft geen toestemming voor journaalposten. Log opnieuw in zodat de scopes company.document.read en document.read worden toegestaan."
            );
          }
          throw err;
        }

        const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false }).parse(xml);
        const json = JSON.stringify(parsed);
        return {
          companyName: await getCompanyName(companyId),
          run: compact({ runId: run.payrollRunId, year: run.year, number: run.number, description: run.description, status: run.locked ? "afgesloten" : "open" }),
          groupBy: kind,
          journal: json.length > MAX_JOURNAL_CHARS ? undefined : parsed,
          truncated: json.length > MAX_JOURNAL_CHARS ? true : undefined,
          partial: json.length > MAX_JOURNAL_CHARS ? json.slice(0, MAX_JOURNAL_CHARS) : undefined,
          hint: json.length > MAX_JOURNAL_CHARS ? "Het journaal is te groot voor één antwoord. Vraag het gesplitst op, bijvoorbeeld per afdeling." : undefined,
        };
      })
  );
}
