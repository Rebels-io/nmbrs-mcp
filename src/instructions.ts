import { getUserInfo, listCompaniesCached } from "./nmbrs/endpoints.js";

export function baseInstructions(includesAbsenceCause: boolean): string {
  const rules = [
    "Noem bij elk cijfer en elk antwoord het bedrijf waar het bij hoort, en bij meerdere Nmbrs-koppelingen ook de koppeling.",
    "Tel gegevens van verschillende bedrijven of koppelingen niet bij elkaar op en vergelijk ze niet, tenzij de gebruiker dat vraagt. Geef anders een overzicht per bedrijf.",
    "Noemt de gebruiker geen bedrijf en zijn er meerdere, vraag dan om welk bedrijf het gaat, of geef de uitkomst per bedrijf.",
    "Gebruik alleen id's uit de resultaten van deze tools. Een bedrijfs-id en een medewerkers-id horen bij precies één bedrijf. Verzin of raad geen id's.",
    "Ontbreken er gegevens, of lijkt een cijfer niet te kloppen, zeg dat dan en vul niets aan.",
    "Declaraties zelf (openstaand, in behandeling, afgekeurd, status en categorie) zijn niet beschikbaar via deze koppeling. Goedgekeurde declaraties die klaarstaan voor de verloning staan als variabel looncomponent in nmbrs_list_variable_wage_components. Zeg erbij dat dit alleen verwerkte bedragen zijn.",
  ];
  if (includesAbsenceCause) {
    rules.push("De oorzaak van verzuim is een gezondheidsgegeven. Noem die alleen als de gebruiker er expliciet om vraagt.");
  }
  return `Je werkt met salaris- en HR-gegevens uit Nmbrs. Houd je aan deze regels:\n${rules.map((rule, i) => `${i + 1}. ${rule}`).join("\n")}`;
}

export async function describeAccount(): Promise<string | undefined> {
  const work = Promise.all([getUserInfo().catch(() => []), listCompaniesCached()]);
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000).unref());
  const result = await Promise.race([work, timeout]);
  if (!result) return undefined;
  const [users, companies] = result;
  const name = users[0]?.name;
  const names = companies.map((company) => company.name).join(", ");
  return `${name ? `Ingelogd als ${name}. ` : ""}${companies.length === 1 ? "Het bedrijf in dit account is" : "De bedrijven in dit account zijn"}: ${names || "geen"}.`;
}
