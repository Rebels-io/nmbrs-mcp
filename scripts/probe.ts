import { nmbrsFetch } from "../src/nmbrs/client.js";
import { describeShape } from "../src/nmbrs/redact.js";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Gebruik: npm run probe -- /api/companies [/api/andere-pad ...]");
  process.exit(1);
}

for (const path of paths) {
  console.log(`\n=== GET ${path}`);
  try {
    const data = await nmbrsFetch<unknown>(path);
    console.log(JSON.stringify(describeShape(data), null, 2));
  } catch (err) {
    console.log("FOUT:", err instanceof Error ? err.message : err);
  }
}
