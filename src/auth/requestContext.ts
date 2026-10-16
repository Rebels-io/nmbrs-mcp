import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

interface RequestContext {
  accessToken: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const currentAccessToken = (): string | undefined => requestContext.getStore()?.accessToken;

export function currentUserKey(): string {
  const token = currentAccessToken();
  return token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "local";
}
