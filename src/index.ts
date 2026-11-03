import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { describeAccount } from "./instructions.js";
import { createServer } from "./server.js";

describeAccount()
  .catch(() => undefined)
  .then((summary) => createServer(undefined, summary).connect(new StdioServerTransport()))
  .catch((err) => {
    console.error("Server kon niet starten:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
