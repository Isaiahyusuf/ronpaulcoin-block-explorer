export interface ChainTip {
  height: number;
  hash: string;
}

export interface BlockSource {
  getTip(): Promise<ChainTip>;
  getBlockHash(height: number): Promise<string>;
  getBlockRaw(hash: string): Promise<Buffer>;
}

export interface RpcSourceOptions {
  url: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  // Pause after each request so the single-threaded daemon stays responsive.
  throttleMs?: number;
  fetchImpl?: typeof fetch;
}

export class RpcError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export function createRpcSource(options: RpcSourceOptions): BlockSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const throttleMs = options.throttleMs ?? 0;
  let queue: Promise<unknown> = Promise.resolve();

  async function send(method: string, params: unknown[]): Promise<unknown> {
    const headers = new Headers({
      "content-type": "application/json",
      // The legacy daemon is single-threaded and stalls on keep-alive sockets.
      connection: "close",
    });
    if (options.username && options.password) {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`,
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "1.0", id: "rpc-indexer", method, params }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new RpcError(`The node could not be reached for ${method}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RpcError(`The node returned an unreadable response to ${method} (HTTP ${response.status}).`);
    }
    // RPC-level errors arrive with HTTP 4xx/5xx and a JSON error body.
    if (typeof payload !== "object" || payload === null || !("result" in payload)) {
      throw new RpcError(`The node returned an invalid response to ${method} (HTTP ${response.status}).`);
    }
    const body = payload as { result: unknown; error?: { code?: number; message?: string } | null };
    if (body.error) {
      throw new RpcError(`${method} failed: ${body.error.message ?? "unknown error"}`, body.error.code ?? null);
    }
    if (throttleMs > 0) await new Promise((resolve) => setTimeout(resolve, throttleMs));
    return body.result;
  }

  // Strictly one request in flight at a time, even if callers overlap.
  function call(method: string, params: unknown[]): Promise<unknown> {
    const run = queue.then(() => send(method, params));
    queue = run.catch(() => undefined);
    return run;
  }

  const isHash = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

  async function getBlockHash(height: number): Promise<string> {
    const hash = await call("getblockhash", [height]);
    if (!isHash(hash)) throw new RpcError(`The node returned an invalid hash for height ${height}.`);
    return hash;
  }

  return {
    async getTip() {
      const count = await call("getblockcount", []);
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        throw new RpcError("The node returned an invalid block count.");
      }
      return { height: count, hash: await getBlockHash(count) };
    },
    getBlockHash,
    async getBlockRaw(hash) {
      const hex = await call("getblock", [hash, false]);
      if (typeof hex !== "string" || !/^(?:[a-fA-F0-9]{2})+$/.test(hex)) {
        throw new RpcError("The node returned invalid raw block data.");
      }
      return Buffer.from(hex, "hex");
    },
  };
}
