export { WEB_PROTOCOL_VERSION } from "./protocol/version.ts";
export * from "./protocol/index.ts";
export type { AssetProvider, AssetEntry } from "./assets/types.ts";
export { createDirectoryAssetProvider } from "./assets/directory-provider.ts";
export { createMemoryAssetProvider } from "./assets/memory-provider.ts";
export { createWebServer, type CreateWebServerOptions, type WebServerHandle } from "./server/create-server.ts";
export {
  generateAuthToken,
  resolveSecurityConfig,
  securityRequiresToken,
  type WebSecurityConfig,
} from "./server/security.ts";
export type { WebSessionHooks } from "./server/session-room.ts";
export { createWebI18n, webPackageCatalogs, WEB_SUPPORTED_LOCALES } from "./i18n/web-i18n.ts";
