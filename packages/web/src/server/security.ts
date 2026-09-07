import { randomBytes } from "node:crypto";

export interface WebSecurityConfig {
  /** Bind address; 127.0.0.1 default — LAN requires token. */
  host: string;
  /** Required when host is not loopback. */
  authToken?: string;
  allowedOrigins: string[];
  maxMessageBytes: number;
  maxMessagesPerMinute: number;
}

export function generateAuthToken(): string {
  return randomBytes(24).toString("base64url");
}

export function securityRequiresToken(host: string): boolean {
  return host !== "127.0.0.1" && host !== "::1" && host !== "localhost";
}

export function resolveSecurityConfig(input: {
  host: string;
  token?: string;
  port: number;
  extraOrigins?: string[];
}): WebSecurityConfig {
  const host = input.host;
  const needsToken = securityRequiresToken(host);
  const authToken = input.token ?? (needsToken ? generateAuthToken() : undefined);
  if (needsToken && !authToken) {
    throw new Error("LAN bind requires an auth token");
  }
  const originBase = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${input.port}`;
  const allowedOrigins = [
    originBase,
    `http://127.0.0.1:${input.port}`,
    `http://localhost:${input.port}`,
    ...(input.extraOrigins ?? []),
  ];
  return {
    host,
    authToken,
    allowedOrigins,
    maxMessageBytes: 256 * 1024,
    maxMessagesPerMinute: 120,
  };
}

export function checkOrigin(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

export function extractToken(req: Request, url: URL): string | undefined {
  const header = req.headers.get("x-animae-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (header) return header;
  const q = url.searchParams.get("token");
  return q ?? undefined;
}

export function tokenFromCookie(cookieHeader: string | null, name = "animae_token"): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
