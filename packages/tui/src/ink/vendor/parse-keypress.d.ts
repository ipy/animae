declare function parseKeypress(data?: string | Uint8Array): {
  name: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  sequence: string;
  isKittyProtocol?: boolean;
  isPrintable?: boolean;
  text?: string;
  eventType?: "press" | "repeat" | "release";
  super?: boolean;
  hyper?: boolean;
  capsLock?: boolean;
  numLock?: boolean;
};

export default parseKeypress;
