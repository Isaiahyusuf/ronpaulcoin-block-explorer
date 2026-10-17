import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getBlockDetails, getBlockchainInfo } from "../lib/rpc";

const blockHash = "a".repeat(64);
const transactionId = "b".repeat(64);

interface RpcRequest {
  method: string;
  params: unknown[];
}

function mockRpc(
  respond: (request: RpcRequest) => unknown,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RpcRequest;
      return new Response(
        JSON.stringify({
          result: respond(request),
          error: null,
          id: "rpc-explorer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("RPC_URL", "http://127.0.0.1:9026/");
  vi.stubEnv("RPC_USERNAME", "explorer");
  vi.stubEnv("RPC_PASSWORD", "test-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("original Ron Paul Coin RPC adapter", () => {
  it("maps legacy getinfo fields without inventing a header count", async () => {
    const fetchMock = mockRpc(({ method }) => {
      if (method === "getinfo") {
        return {
          blocks: 123,
          connections: 4,
          difficulty: 1.25,
          testnet: false,
          balance: 500,
        };
      }
      if (method === "getbestblockhash") return blockHash;
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    const result = await getBlockchainInfo();

    expect(result).toEqual({
      status: "online",
      info: {
        bestblockhash: blockHash,
        blocks: 123,
        chain: "mainnet",
        connections: 4,
        difficulty: 1.25,
        headers: null,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    ) as RpcRequest;
    expect(firstRequest.method).toBe("getinfo");
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization"),
    ).toBe(`Basic ${Buffer.from("explorer:test-secret").toString("base64")}`);
  });

  it("uses the daemon's boolean verbosity argument for block details", async () => {
    const fetchMock = mockRpc(({ method }) => {
      if (method === "getblockhash") return blockHash;
      if (method === "getblock") {
        return {
          hash: blockHash,
          height: 123,
          time: 1_700_000_000,
          confirmations: 2,
          size: 180,
          version: 2,
          bits: "1d00ffff",
          difficulty: 1.25,
          merkleroot: transactionId,
          tx: [transactionId],
        };
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });

    const result = await getBlockDetails("123");

    expect(result.status).toBe("online");
    if (result.status === "online") {
      expect(result.data.transactions).toEqual([transactionId]);
      expect(result.data.previousBlockHash).toBeNull();
    }
    const blockRequest = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    ) as RpcRequest;
    expect(blockRequest).toEqual({
      jsonrpc: "1.0",
      id: "rpc-explorer",
      method: "getblock",
      params: [blockHash, true],
    });
  });

  it("rejects malformed legacy node metadata instead of rendering it", async () => {
    mockRpc(({ method }) => {
      if (method === "getinfo") {
        return {
          blocks: 123,
          connections: "four",
          difficulty: 1.25,
          testnet: false,
        };
      }
      return blockHash;
    });

    const result = await getBlockchainInfo();

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.message).toContain("original Ron Paul Coin RPC format");
    }
  });
});
