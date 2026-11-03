import { z } from "zod";
import { getCompanyName, listCompanies, listEmployees } from "../nmbrs/endpoints.js";
import { employeeName } from "../nmbrs/mappers.js";
import { redactSensitive } from "../nmbrs/redact.js";

export const employeeIdArg = z
  .string()
  .uuid()
  .describe("Id van de medewerker, te vinden met nmbrs_search_employees.");

export const companyIdArg = z.string().uuid().describe("Id van het bedrijf, te vinden met nmbrs_list_companies.");

export const optionalCompanyIdArg = z
  .string()
  .uuid()
  .optional()
  .describe("Id van het bedrijf. Laat leeg om alle bedrijven te doorzoeken, dat is trager.");

export async function respond(load: () => Promise<unknown>) {
  try {
    const value = redactSensitive(await load());
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
    };
  }
}

export async function selectedCompanies(companyId?: string) {
  const companies = await listCompanies();
  return companies.filter((company) => !companyId || company.companyId === companyId);
}

export async function describeEmployee(companyId: string, employeeId: string) {
  const [rows, companyName] = await Promise.all([listEmployees(companyId, { employeeId }), getCompanyName(companyId)]);
  const info = rows.find((row) => row.employeeId === employeeId)?.employeeBasicInfo;
  return { employee: info ? employeeName(info) : undefined, companyName };
}
