import { listCompanies } from "../src/nmbrs/endpoints.js";

async function main() {
  const companies = await listCompanies();
  console.log(JSON.stringify(companies, null, 2));
}

main().catch((err) => {
  console.error("Kon bedrijvenlijst niet ophalen:", err instanceof Error ? err.message : err);
  process.exit(1);
});
