import { runAuthorizationFlow } from "../src/auth/oauth.js";
import { writeTokens } from "../src/auth/tokenStore.js";
import { getConfig } from "../src/config.js";

async function main() {
  const tokens = await runAuthorizationFlow();
  await writeTokens(tokens);
  console.log(`Ingelogd bij Nmbrs. Tokens opgeslagen in ${getConfig().tokenStorePath}.`);
}

main().catch((err) => {
  console.error("Authenticatie mislukt:", err instanceof Error ? err.message : err);
  process.exit(1);
});
