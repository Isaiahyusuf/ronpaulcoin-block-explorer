import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseBlockTransactions } from "../lib/rawblock";
import { getBlockDetails, getTransaction, lookupAddress } from "../lib/rpc";

type Reply = { result?: unknown; error?: { code: number; message: string } };

function mockRpc(respond: (method: string, params: unknown[]) => Reply) {
  const fetchMock = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body));
    const reply = respond(method, params);
    return new Response(
      JSON.stringify({ result: reply.result ?? null, error: reply.error ?? null, id: "x" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sha256d = (b: Buffer) =>
  createHash("sha256").update(createHash("sha256").update(b).digest()).digest();

// One-input, one-output transaction.
const txBytes = Buffer.concat([
  Buffer.from("01000000", "hex"),
  Buffer.from("01", "hex"),
  Buffer.alloc(32, 1),
  Buffer.from("00000000", "hex"),
  Buffer.from("00", "hex"),
  Buffer.from("ffffffff", "hex"),
  Buffer.from("01", "hex"),
  Buffer.from("0010000000000000", "hex"),
  Buffer.from("00", "hex"),
  Buffer.from("00000000", "hex"),
]);
const expectedTxid = Buffer.from(sha256d(txBytes)).reverse().toString("hex");
const blockHex = Buffer.concat([Buffer.alloc(80), Buffer.from([1]), txBytes]).toString("hex");
const blockHash = "a".repeat(64);

const decoded = (txid: string) => ({
  txid,
  version: 1,
  locktime: 0,
  vin: [{ txid: "1".repeat(64), vout: 0, scriptSig: {}, sequence: 1 }],
  vout: [{ value: 1.5, n: 0, scriptPubKey: { type: "pubkeyhash", addresses: ["RAddr"] } }],
});

beforeEach(() => {
  vi.stubEnv("RPC_URL", "http://127.0.0.1:9026/");
  vi.stubEnv("RPC_USERNAME", "explorer");
  vi.stubEnv("RPC_PASSWORD", "test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseBlockTransactions", () => {
  it("splits a block and computes txids", () => {
    const txs = parseBlockTransactions(blockHex);
    expect(txs).toHaveLength(1);
    expect(txs[0].txid).toBe(expectedTxid);
  });
  it("rejects truncated data", () => {
    expect(() => parseBlockTransactions(blockHex.slice(0, -20))).toThrow();
  });
});

describe("block transaction list", () => {
  it("returns the transaction ids from getblock", async () => {
    mockRpc((method) =>
      method === "getblock"
        ? {
            result: {
              hash: blockHash, height: 5, time: 1, confirmations: 2, size: 10,
              version: 2, bits: "1e0fffff", difficulty: 1, merkleroot: "c".repeat(64),
              tx: ["d".repeat(64), "e".repeat(64)],
            },
          }
        : {},
    );
    const r = await getBlockDetails(blockHash);
    expect(r.status).toBe("online");
    if (r.status === "online") expect(r.data.transactions).toEqual(["d".repeat(64), "e".repeat(64)]);
  });
});

describe("getTransaction", () => {
  it("rejects invalid ids without calling the node", async () => {
    const fetchMock = mockRpc(() => ({}));
    const r = await getTransaction("xyz");
    expect(r.status).toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a transaction found by the node", async () => {
    const id = "f".repeat(64);
    mockRpc(() => ({ result: { ...decoded(id), blockhash: blockHash, confirmations: 3, time: 9 } }));
    const r = await getTransaction(id);
    expect(r.status).toBe("found");
    if (r.status === "found") {
      expect(r.source).toBe("node");
      expect(r.data.outputs[0].addresses).toEqual(["RAddr"]);
    }
  });

  it("reports unavailable index data clearly when the node has no record", async () => {
    mockRpc(() => ({ error: { code: -5, message: "No information available about transaction" } }));
    const r = await getTransaction("f".repeat(64));
    expect(r.status).toBe("not-indexed");
  });

  it("falls back to scanning the hinted block for spent transactions", async () => {
    mockRpc((method) => {
      if (method === "getrawtransaction") return { error: { code: -5, message: "none" } };
      if (method === "getblock")
        return { result: blockHex };
      if (method === "decoderawtransaction") return { result: decoded(expectedTxid) };
      return {};
    });
    const r = await getTransaction(expectedTxid, blockHash);
    expect(r.status).toBe("found");
    if (r.status === "found") expect(r.source).toBe("block");
  });

  it("stays not-indexed when the hinted block lacks the transaction", async () => {
    mockRpc((method) =>
      method === "getrawtransaction"
        ? { error: { code: -5, message: "none" } }
        : method === "getblock"
          ? { result: blockHex }
          : {},
    );
    const r = await getTransaction("9".repeat(64), blockHash);
    expect(r.status).toBe("not-indexed");
  });
});

describe("lookupAddress", () => {
  it("never reports an empty history for a valid address", async () => {
    mockRpc(() => ({ result: { isvalid: true } }));
    const r = await lookupAddress("R".repeat(34));
    expect(r.status).toBe("valid-unindexed");
  });
  it("flags invalid addresses", async () => {
    mockRpc(() => ({ result: { isvalid: false } }));
    expect((await lookupAddress("R".repeat(34))).status).toBe("invalid");
  });
  it("rejects malformed input locally", async () => {
    expect((await lookupAddress("bad!")).status).toBe("invalid");
  });
  it("handles unsupported methods", async () => {
    mockRpc(() => ({ error: { code: -32601, message: "Method not found" } }));
    expect((await lookupAddress("R".repeat(34))).status).toBe("unavailable");
  });
});
