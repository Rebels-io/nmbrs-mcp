import { z } from "zod";
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
