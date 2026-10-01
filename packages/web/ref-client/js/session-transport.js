/**
 * @typedef {Record<string, unknown>} JsonMsg
 */

/**
 * @typedef {{
 *   url: string,
 *   role: string,
 *   locale: string,
 *   token?: string,
 *   resumeSeq?: number,
 *   clientId: string,
 * }} ConnectOpts
 */

export class SessionTransport {
  /** @type {WebSocket | null} */
  #ws = null;
  /** @type {JsonMsg[]} */
  #inbox = [];
  /** @type {((m: JsonMsg) => void)[]} */
  #listeners = [];
  /** @type {JsonMsg | null} */
  #helloOk = null;
  /** @type {JsonMsg | null} */
  #snapshot = null;
  #lastSeq = 0;
  #req = 0;
  /** @type {string} */
  clientId;

  /**
   * @param {string} clientId
   * @param {(dir: 'in'|'out', msg: JsonMsg) => void} [onFrame]
   */
  constructor(clientId, onFrame) {
    this.clientId = clientId;
    this.onFrame = onFrame ?? (() => {});
  }

  nextId() {
    this.#req += 1;
    return `r${this.#req}`;
  }

  get lastSeq() {
    return this.#lastSeq;
  }

  get helloOk() {
    return this.#helloOk;
  }

  get snapshot() {
    return this.#snapshot;
  }

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  get role() {
    return this.#helloOk?.role ?? null;
  }

  /**
   * @param {ConnectOpts} opts
   */
  connect(opts) {
    return new Promise((resolve, reject) => {
      if (this.#ws) this.disconnect();
      this.#inbox = [];
      this.#helloOk = null;
      this.#snapshot = null;
      this.#lastSeq = 0;
      const ws = new WebSocket(opts.url);
      this.#ws = ws;
      const timer = setTimeout(() => {
        reject(new Error("connect timeout"));
        ws.close();
      }, 5000);
      ws.onopen = () => {
        clearTimeout(timer);
        /** @type {JsonMsg} */
        const hello = {
          v: 1,
          type: "hello",
          role: opts.role === "spectator" ? "spectator" : "controller",
          clientId: opts.clientId,
          locale: opts.locale,
        };
        if (opts.token) hello.token = opts.token;
        if (typeof opts.resumeSeq === "number") hello.resumeSeq = opts.resumeSeq;
        this.send(hello);
        resolve(undefined);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("websocket error"));
      };
      ws.onclose = () => {
        if (this.#ws === ws) this.#ws = null;
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        this.#ingest(m);
      };
    });
  }

  /**
   * @param {JsonMsg} m
   */
  #ingest(m) {
    this.#inbox.push(m);
    if (typeof m.seq === "number" && m.seq > this.#lastSeq) this.#lastSeq = m.seq;
    if (m.type === "hello_ok") this.#helloOk = m;
    if (m.type === "snapshot") this.#snapshot = m;
    this.onFrame("in", m);
    for (const fn of this.#listeners) fn(m);
  }

  disconnect() {
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  /**
   * @param {JsonMsg} msg
   */
  send(msg) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(msg));
    this.onFrame("out", msg);
  }

  /**
   * @param {(m: JsonMsg) => boolean} pred
   * @param {number} timeoutMs
   */
  waitFor(pred, timeoutMs) {
    for (const m of this.#inbox) {
      if (pred(m)) return Promise.resolve(m);
    }
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const listener = (m) => {
        if (pred(m)) {
          this.#listeners = this.#listeners.filter((f) => f !== listener);
          clearInterval(iv);
          resolve(m);
        } else if (Date.now() - t0 > timeoutMs) {
          this.#listeners = this.#listeners.filter((f) => f !== listener);
          clearInterval(iv);
          reject(new Error("timeout"));
        }
      };
      this.#listeners.push(listener);
      const iv = setInterval(() => {
        if (Date.now() - t0 > timeoutMs) {
          this.#listeners = this.#listeners.filter((f) => f !== listener);
          clearInterval(iv);
          reject(new Error("timeout"));
        }
      }, 50);
    });
  }

  /**
   * @param {number} ms
   */
  collectFor(ms) {
    const start = this.#inbox.length;
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.#inbox.slice(start)), ms);
    });
  }

  /**
   * Adapter for smoke-tests transport shape.
   */
  asSmokeTransport() {
    const self = this;
    return {
      connect: async (opts) => {
        if (opts.clientId) self.clientId = opts.clientId;
        await self.connect({
          url: opts.url,
          role: opts.role,
          locale: opts.locale,
          token: opts.token,
          resumeSeq: opts.resumeSeq,
          clientId: opts.clientId ?? self.clientId,
        });
      },
      disconnect: () => self.disconnect(),
      send: (msg) => self.send(msg),
      waitFor: (pred, timeoutMs) => self.waitFor(pred, timeoutMs),
      collectFor: (ms) => self.collectFor(ms),
      getLastSeq: () => self.lastSeq,
      getHelloOk: () => self.helloOk,
      getSnapshot: () => self.snapshot,
    };
  }
}
