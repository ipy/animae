import { expect, test, describe } from "bun:test";
import {
  checkOrigin,
  extractToken,
  generateAuthToken,
  resolveSecurityConfig,
  securityRequiresToken,
  tokenFromCookie,
} from "../src/server/security.ts";

describe("web security helpers", () => {
  test("securityRequiresToken for bind addresses", () => {
    expect(securityRequiresToken("127.0.0.1")).toBe(false);
    expect(securityRequiresToken("0.0.0.0")).toBe(true);
  });

  test("resolveSecurityConfig generates token on LAN bind", () => {
    const cfg = resolveSecurityConfig({ host: "0.0.0.0", port: 8080 });
    expect(cfg.authToken).toBeDefined();
    expect(cfg.allowedOrigins.some((o) => o.includes("127.0.0.1:8080"))).toBe(true);
    const loop = resolveSecurityConfig({ host: "127.0.0.1", port: 3000, token: "fixed" });
    expect(loop.authToken).toBe("fixed");
  });

  test("checkOrigin allows missing origin", () => {
    expect(checkOrigin(null, ["http://127.0.0.1:1"])).toBe(true);
    expect(checkOrigin("http://127.0.0.1:1", ["http://127.0.0.1:1"])).toBe(true);
    expect(checkOrigin("http://evil", ["http://127.0.0.1:1"])).toBe(false);
  });

  test("extractToken from header query and cookie", () => {
    const url = new URL("http://x/?token=q");
    const req = new Request("http://x/", { headers: { "x-animae-token": "hdr", authorization: "Bearer alt" } });
    expect(extractToken(req, url)).toBe("hdr");
    const bearer = new Request("http://x/", { headers: { authorization: "Bearer tok" } });
    expect(extractToken(bearer, new URL("http://x/"))).toBe("tok");
    expect(extractToken(new Request("http://x/"), url)).toBe("q");
    expect(tokenFromCookie("animae_token=abc%3D; other=1")).toBe("abc=");
    expect(generateAuthToken().length).toBeGreaterThan(10);
  });
});
