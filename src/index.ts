import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

createServer()
  .connect(new StdioServerTransport())
  .catch((err) => {
    console.error("Server kon niet starten:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
