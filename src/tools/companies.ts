import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listCompanies } from "../nmbrs/endpoints.js";
import { redactSensitive } from "../nmbrs/redact.js";

export function registerCompanyTools(server: McpServer): void {
  server.registerTool(
    "nmbrs_list_companies",
    {
      description:
        "Geeft alle bedrijven onder de ingelogde Nmbrs debtor. Gebruik deze tool als eerste stap om een bedrijfs-id te vinden. Voor medewerkers gebruik je nmbrs_search_employees.",
    },
    async () => {
      try {
        // Mapper naar { id, name, employeeCount } volgt zodra de veldnamen uit de API bevestigd zijn.
        const companies = redactSensitive(await listCompanies());
        return { content: [{ type: "text", text: JSON.stringify(companies) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );
}
