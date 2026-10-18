import { describe, expect, it } from "vitest";
import { createRpcSource, RpcError } from "../../indexer/source.ts";

const HASH = "a".repeat(64);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(handler: (method: string, params: unknown[]) => Response | Promise<Response>) {
  const seen = { active: 0, maxActive: 0, headers: [] as Headers[], methods: [] as string[] };
  const impl = (async (_url: unknown, init: RequestInit) => {
    seen.active++;
    seen.maxActive = Math.max(seen.maxActive, seen.active);
    seen.headers.push(new Headers(init.headers));
    const { method, params } = JSON.parse(String(init.body));
    seen.methods.push(method);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await handler(method, params);
    } finally {
      seen.active--;
    }
  }) as typeof fetch;
  return { impl, seen };
}

describe("createRpcSource", () => {
  it("sends Connection: close and basic auth on every request", async () => {
    const { impl, seen } = fakeFetch((method) =>
      jsonResponse({ result: method === "getblockcount" ? 7 : HASH, error: null }),
    );
    const source = createRpcSource({ url: "http://node", username: "u", password: "p", fetchImpl: impl });
    expect(await source.getTip()).toEqual({ height: 7, hash: HASH });
    expect(seen.methods).toEqual(["getblockcount", "getblockhash"]);
    for (const headers of seen.headers) {
      expect(headers.get("connection")).toBe("close");
      expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    }
  });

  it("never has more than one request in flight, even when callers overlap", async () => {
    const { impl, seen } = fakeFetch(() => jsonResponse({ result: HASH, error: null }));
    const source = createRpcSource({ url: "http://node", fetchImpl: impl });
    await Promise.all([1, 2, 3, 4, 5].map((h) => source.getBlockHash(h)));
    expect(seen.methods).toHaveLength(5);
    expect(seen.maxActive).toBe(1);
  });

  it("reads the JSON error body of an HTTP 500 response", async () => {
    const { impl } = fakeFetch(() =>
      jsonResponse({ result: null, error: { code: -5, message: "Block not found" } }, 500),
    );
    const source = createRpcSource({ url: "http://node", fetchImpl: impl });
    const error = await source.getBlockRaw(HASH).catch((e) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error.code).toBe(-5);
    expect(error.message).toContain("Block not found");
  });

  it("decodes raw block hex and rejects malformed data", async () => {
    const good = fakeFetch(() => jsonResponse({ result: "00ff10", error: null }));
    expect([...(await createRpcSource({ url: "http://node", fetchImpl: good.impl }).getBlockRaw(HASH))]).toEqual([0, 255, 16]);
    for (const bad of ["0", "zz", "", 5]) {
      const { impl } = fakeFetch(() => jsonResponse({ result: bad, error: null }));
      await expect(createRpcSource({ url: "http://node", fetchImpl: impl }).getBlockRaw(HASH)).rejects.toBeInstanceOf(RpcError);
    }
  });

  it("reports unreachable nodes and unreadable bodies without leaking credentials", async () => {
    const down = (async () => {
      throw new Error("connect ECONNREFUSED http://u:secret@node");
    }) as typeof fetch;
    const error = await createRpcSource({ url: "http://node", username: "u", password: "secret", fetchImpl: down })
      .getBlockHash(1)
      .catch((e) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error.message).not.toContain("secret");

    const html = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
    await expect(createRpcSource({ url: "http://node", fetchImpl: html }).getBlockHash(1)).rejects.toThrow(/HTTP 502/);
  });

  it("rejects an invalid block count or hash", async () => {
    const badCount = fakeFetch(() => jsonResponse({ result: -1, error: null }));
    await expect(createRpcSource({ url: "http://node", fetchImpl: badCount.impl }).getTip()).rejects.toBeInstanceOf(RpcError);
    const badHash = fakeFetch(() => jsonResponse({ result: "xyz", error: null }));
    await expect(createRpcSource({ url: "http://node", fetchImpl: badHash.impl }).getBlockHash(1)).rejects.toBeInstanceOf(RpcError);
  });
});
