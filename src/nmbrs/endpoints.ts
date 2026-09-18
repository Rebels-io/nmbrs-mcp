import { nmbrsFetch } from "./client.js";

// Responsvorm nog niet bevestigd met een echte subscription: bewust unknown
// in plaats van een geraden interface. Vaste velden (mapping naar
// { id, name, employeeCount }) volgen in fase 2, zodra dit tegen een echte
// omgeving getest kan worden.
export async function listCompanies(): Promise<unknown> {
  return nmbrsFetch("/api/companies");
}
