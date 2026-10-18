import "server-only";

import { parseBlockTransactions } from "@/lib/rawblock";
import {
  type BlockDetails,
  type BlockSummary,
  type DataResult,
  isBlockchainInfo,
  isBlockDetails,
  isBlockSummary,
  isLegacyNodeInfo,
  parseTransaction,
  type AddressResult,
  type BlockchainInfoResult,
  type TransactionDetails,
  type TransactionResult,
} from "@/lib/blockchain";

interface RpcConfig {
  url: URL;
  authorization?: string;
}

interface RecentBlocks {
  blocks: BlockSummary[];
  latestHeight: number;
  startHeight: number;
  olderStartHeight: number | null;
  newerStartHeight: number | null;
}

type RpcCallResult =
  | { status: "success"; result: unknown }
  | {
      status: "not-configured" | "unavailable";
      message: string;
      errorCode?: number;
    };

function getRpcConfig():
  | { status: "configured"; config: RpcConfig }
  | { status: "not-configured"; message: string }
  | { status: "invalid"; message: string } {
  const urlValue = process.env.RPC_URL?.trim();
  const username = process.env.RPC_USERNAME?.trim();
  const password = process.env.RPC_PASSWORD;

  if (!urlValue) {
    if (username || password) {
      return {
        status: "invalid",
        message: "RPC credentials are set but RPC_URL is missing.",
      };
    }
    return {
      status: "not-configured",
      message: "Set RPC_URL and the optional RPC credentials in the server environment.",
    };
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return {
      status: "invalid",
      message: "RPC_URL must be a valid HTTP or HTTPS URL.",
    };
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    return {
      status: "invalid",
      message:
        "RPC_URL must use HTTP or HTTPS and must not contain embedded credentials.",
    };
  }

  if (Boolean(username) !== Boolean(password)) {
    return {
      status: "invalid",
      message: "Set both RPC_USERNAME and RPC_PASSWORD, or leave both empty.",
    };
  }

  return {
    status: "configured",
    config: {
      url,
      ...(username && password
        ? {
            authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
          }
        : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function callRpc(
  method: string,
  params: unknown[],
): Promise<RpcCallResult> {
  const configuration = getRpcConfig();
  if (configuration.status === "not-configured") {
    return { status: "not-configured", message: configuration.message };
  }
  if (configuration.status === "invalid") {
    return { status: "unavailable", message: configuration.message };
  }

  // The legacy daemon serves RPC on one thread and holds keep-alive sockets open,
  // which starves parallel requests; close each connection after its response.
  const headers = new Headers({
    "content-type": "application/json",
    connection: "close",
  });
  if (configuration.config.authorization) {
    headers.set("authorization", configuration.config.authorization);
  }

  let response: Response;
  try {
    response = await fetch(configuration.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "1.0",
        id: "rpc-explorer",
        method,
        params,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "The node did not respond before the 3-second timeout."
          : "The node could not be reached. Check RPC_URL and the daemon network access.",
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  // The legacy daemon reports RPC-level errors (e.g. -5, -32601) as HTTP
  // 400/404/500 with a JSON-RPC error body, so only treat the status as fatal
  // when no such body is present.
  const hasRpcError =
    isRecord(payload) && isRecord(payload.error) && "result" in payload;
  if (!response.ok && !hasRpcError) {
    return {
      status: "unavailable",
      message: `The node returned HTTP ${response.status} to the ${method} request.`,
    };
  }
  if (payload === undefined) {
    return {
      status: "unavailable",
      message: "The node returned an unreadable JSON-RPC response.",
    };
  }

  if (!isRecord(payload) || !("error" in payload) || !("result" in payload)) {
    return {
      status: "unavailable",
      message: `The node returned an invalid response to ${method}.`,
    };
  }

  if (payload.error !== null) {
    const errorCode =
      isRecord(payload.error) && typeof payload.error.code === "number"
        ? payload.error.code
        : null;
    if (method === "getblockhash" && errorCode === -8) {
      return {
        status: "unavailable",
        message: "The requested height is outside the node's active chain.",
      };
    }
    if (method === "getblock" && errorCode === -5) {
      return {
        status: "unavailable",
        message: "The node does not have the requested block.",
      };
    }
    return {
      status: "unavailable",
      message: `The node rejected the ${method} request. Confirm that this RPC method is supported.`,
      ...(errorCode !== null ? { errorCode } : {}),
    };
  }

  return { status: "success", result: payload.result };
}

function parseBlockSummary(value: unknown): BlockSummary | null {
  if (!isRecord(value) || !Array.isArray(value.tx)) return null;
  const summary = {
    hash: value.hash,
    height: value.height,
    time: value.time,
    confirmations: value.confirmations,
    transactionCount: value.tx.length,
    size: typeof value.size === "number" ? value.size : null,
  };
  return isBlockSummary(summary) ? summary : null;
}

function parseBlockDetails(value: unknown): BlockDetails | null {
  if (!isRecord(value) || !Array.isArray(value.tx)) return null;
  const summary = parseBlockSummary(value);
  if (!summary) return null;

  const details = {
    ...summary,
    version: value.version,
    bits: value.bits,
    difficulty: value.difficulty,
    merkleRoot: value.merkleroot,
    previousBlockHash: value.previousblockhash ?? null,
    transactions: value.tx,
  };
  return isBlockDetails(details) ? details : null;
}

async function getBlockAtHeight(
  height: number,
): Promise<DataResult<BlockSummary>> {
  const hashResponse = await callRpc("getblockhash", [height]);
  if (hashResponse.status !== "success") {
    return { status: hashResponse.status, message: hashResponse.message };
  }
  if (
    typeof hashResponse.result !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(hashResponse.result)
  ) {
    return {
      status: "unavailable",
      message: `The node did not return a valid hash for block ${height}.`,
    };
  }

  const response = await callRpc("getblock", [hashResponse.result, true]);
  if (response.status !== "success") {
    return { status: response.status, message: response.message };
  }
  const block = parseBlockSummary(response.result);
  if (!block || block.height !== height) {
    return {
      status: "unavailable",
      message: `The node returned invalid data for block ${height}.`,
    };
  }
  return { status: "online", data: block };
}

export async function getBlockHashAt(height: number): Promise<string | null> {
  const response = await callRpc("getblockhash", [height]);
  return response.status === "success" && typeof response.result === "string" && /^[a-fA-F0-9]{64}$/.test(response.result)
    ? response.result
    : null;
}

export async function getBlockchainInfo(): Promise<BlockchainInfoResult> {
  const [nodeResponse, hashResponse] = await Promise.all([
    callRpc("getinfo", []),
    callRpc("getbestblockhash", []),
  ]);
  if (nodeResponse.status !== "success") {
    return { status: nodeResponse.status, message: nodeResponse.message };
  }
  if (hashResponse.status !== "success") {
    return { status: hashResponse.status, message: hashResponse.message };
  }
  if (
    !isLegacyNodeInfo(nodeResponse.result) ||
    typeof hashResponse.result !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(hashResponse.result)
  ) {
    return {
      status: "unavailable",
      message: "The node response did not match the original Ron Paul Coin RPC format.",
    };
  }

  const info = {
    bestblockhash: hashResponse.result,
    blocks: nodeResponse.result.blocks,
    chain: nodeResponse.result.testnet ? "testnet" : "mainnet",
    connections: nodeResponse.result.connections,
    difficulty: nodeResponse.result.difficulty,
    headers: null,
  };
  if (!isBlockchainInfo(info)) {
    return {
      status: "unavailable",
      message: "The node response did not match the expected blockchain info format.",
    };
  }
  return { status: "online", info };
}

export async function getRecentBlocks(
  requestedStartHeight?: number,
): Promise<DataResult<RecentBlocks>> {
  const chainResponse = await getBlockchainInfo();
  if (chainResponse.status !== "online") {
    return { status: chainResponse.status, message: chainResponse.message };
  }

  const latestHeight = chainResponse.info.blocks;
  if (
    requestedStartHeight !== undefined &&
    (!Number.isSafeInteger(requestedStartHeight) ||
      requestedStartHeight < 0 ||
      requestedStartHeight > latestHeight)
  ) {
    return {
      status: "unavailable",
      message: `Choose a block height between 0 and ${latestHeight.toLocaleString("en-US")}.`,
    };
  }

  const startHeight = requestedStartHeight ?? latestHeight;
  const firstHeight = Math.max(0, startHeight - 9);
  const heights = Array.from(
    { length: startHeight - firstHeight + 1 },
    (_, index) => startHeight - index,
  );
  const results = await Promise.all(heights.map(getBlockAtHeight));
  const blocks: BlockSummary[] = [];
  for (const block of results) {
    if (block.status !== "online") {
      return block;
    }
    blocks.push(block.data);
  }

  return {
    status: "online",
    data: {
      blocks,
      latestHeight,
      startHeight,
      olderStartHeight: firstHeight > 0 ? firstHeight - 1 : null,
      newerStartHeight:
        startHeight < latestHeight ? Math.min(latestHeight, startHeight + 10) : null,
    },
  };
}

export async function getBlockDetails(
  identifier: string,
): Promise<DataResult<BlockDetails>> {
  let hash = identifier;
  let requestedHeight: number | undefined;
  if (/^\d+$/.test(identifier)) {
    const height = Number(identifier);
    if (!Number.isSafeInteger(height) || height < 0) {
      return { status: "unavailable", message: "The block height is invalid." };
    }
    requestedHeight = height;
    const hashResult = await callRpc("getblockhash", [height]);
    if (hashResult.status !== "success") {
      return { status: hashResult.status, message: hashResult.message };
    }
    if (
      typeof hashResult.result !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(hashResult.result)
    ) {
      return {
        status: "unavailable",
        message: "The node did not return a valid hash for this block height.",
      };
    }
    hash = hashResult.result;
  }

  const blockResult = await callRpc("getblock", [hash, true]);
  if (blockResult.status !== "success") {
    return { status: blockResult.status, message: blockResult.message };
  }
  const details = parseBlockDetails(blockResult.result);
  if (!details) {
    return {
      status: "unavailable",
      message: "The node response did not match the expected block format.",
    };
  }
  if (requestedHeight !== undefined) {
    if (details.height !== requestedHeight) {
      return {
        status: "unavailable",
        message: "The node returned a block that does not match the requested height.",
      };
    }
  } else if (details.hash.toLowerCase() !== identifier.toLowerCase()) {
    return {
      status: "unavailable",
      message: "The node returned a block that does not match the requested hash.",
    };
  }

  return { status: "online", data: details };
}

const METHOD_NOT_FOUND = -32601;

// Tries the node's own lookup first. Without -txindex the daemon only finds
// transactions that still have an unspent output (or are in the mempool), so a
// fully spent transaction is reported as "not-indexed" unless the containing
// block is known and can be scanned directly.
export async function getTransaction(
  txid: string,
  blockHint?: string,
): Promise<TransactionResult> {
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
    return { status: "invalid", message: "A transaction ID is 64 hexadecimal characters." };
  }

  const direct = await callRpc("getrawtransaction", [txid.toLowerCase(), 1]);
  if (direct.status === "success") {
    const transaction = parseTransaction(direct.result);
    if (!transaction || transaction.txid !== txid.toLowerCase()) {
      return {
        status: "unavailable",
        message: "The node returned transaction data in an unexpected format.",
      };
    }
    return { status: "found", source: "node", data: transaction };
  }
  if (direct.status !== "unavailable" || direct.errorCode !== -5) {
    return { status: direct.status, message: direct.message };
  }

  if (blockHint && /^[a-fA-F0-9]{64}$/.test(blockHint)) {
    const fromBlock = await getTransactionFromBlock(txid.toLowerCase(), blockHint);
    if (fromBlock) return fromBlock;
  }

  return {
    status: "not-indexed",
    message:
      "The node has no record of this transaction. Without a transaction index it can only look up transactions that still have unspent outputs, so this ID may be fully spent, or may not exist. Open the transaction from its block page to read it directly.",
  };
}

async function getTransactionFromBlock(
  txid: string,
  blockHash: string,
): Promise<TransactionResult | null> {
  const block = await callRpc("getblock", [blockHash.toLowerCase(), false]);
  if (block.status !== "success" || typeof block.result !== "string") return null;

  let match;
  try {
    match = parseBlockTransactions(block.result).find((tx) => tx.txid === txid);
  } catch {
    return null;
  }
  if (!match) return null;

  const decoded = await callRpc("decoderawtransaction", [match.hex]);
  if (decoded.status !== "success") return null;
  const transaction = parseTransaction(decoded.result);
  if (!transaction || transaction.txid !== txid) return null;

  const details = await getBlockDetails(blockHash);
  if (details.status === "online") {
    transaction.blockHash = details.data.hash;
    transaction.confirmations = details.data.confirmations;
    transaction.time = details.data.time;
  }
  return { status: "found", source: "block", data: transaction };
}

export async function lookupAddress(address: string): Promise<AddressResult> {
  if (!/^[a-zA-Z0-9]{26,128}$/.test(address)) {
    return { status: "invalid", message: "This is not a valid address format." };
  }
  const response = await callRpc("validateaddress", [address]);
  if (response.status !== "success") {
    if (response.status === "unavailable" && response.errorCode === METHOD_NOT_FOUND) {
      return { status: "unavailable", message: "The node does not support address validation." };
    }
    return { status: response.status, message: response.message };
  }
  if (!isRecord(response.result) || typeof response.result.isvalid !== "boolean") {
    return {
      status: "unavailable",
      message: "The node returned an unexpected response to address validation.",
    };
  }
  return response.result.isvalid
    ? { status: "valid-unindexed", address }
    : { status: "invalid", message: "This address is not valid on the Ron Paul Coin network." };
}

export type { TransactionDetails };
