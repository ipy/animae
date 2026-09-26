export type {
  HostAction,
  HostActionContext,
  HostArgField,
  HostArgFieldType,
  HostChoiceState,
  HostCommand,
  HostCommandApi,
  HostEntityAction,
  HostFooterState,
  HostHeaderState,
  HostPanelSection,
  HostSessionUiState,
  StreamCallbacks,
  StreamSegmentKind,
  TranscriptEntry,
} from "./types.ts";
export { SessionHost, type SessionHostOptions, type ActionDescriptor } from "./session-host.ts";
export { createHostCommandApi, setHostSceneId, type CommandApiState } from "./command-api.ts";
export { COMMAND_API_METHODS, guardCommandApi, type CommandApiMethodName } from "./command-api-contract.ts";
export { consumeTurnStream } from "./turn-consumer.ts";
export { hostBuiltinCommands, runHostCommandLine } from "./builtin-commands.ts";
export { createHostI18n, hostCatalogs, hostPackageCatalogs } from "./i18n/host-i18n.ts";
export { bindLocalizeTranslator, localizeSnapshot } from "./localize-snapshot.ts";
export { createGalleryCommand, galleryHostCommand } from "./gallery-command.ts";
export {
  collectKnownGalleryErrorCodes,
  formatGalleryError,
  formatGalleryErrorCode,
  galleryErrorMessageKey,
  galleryErrorTextShowsBareCode,
  galleryJobFailureReason,
} from "./gallery-errors.ts";
export { galleryNoticeToast, type GalleryNoticeToastContext } from "./gallery-notice-toast.ts";
