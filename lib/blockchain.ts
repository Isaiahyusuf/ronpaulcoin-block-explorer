export interface BlockchainInfo {
  bestblockhash: string;
  blocks: number;
  chain: string;
  connections: number;
  difficulty: number;
  headers: number | null;
}

export type BlockchainInfoResult =
  | { status: "online"; info: BlockchainInfo }
  | {
      status: "not-configured" | "unavailable";
      message: string;
    };

export interface BlockSummary {
  hash: string;
  height: number;
  time: number;
  confirmations: number;
  transactionCount: number;
  size: number | null;
}

export interface BlockDetails extends BlockSummary {
  version: number;
  bits: string;
  difficulty: number;
  merkleRoot: string;
  previousBlockHash: string | null;
  transactions: string[];
}

export interface LegacyNodeInfo {
  blocks: number;
  connections: number;
  difficulty: number;
  testnet: boolean;
}

export type DataResult<T> =
  | { status: "online"; data: T }
  | {
      status: "not-configured" | "unavailable";
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function isBlockchainInfo(value: unknown): value is BlockchainInfo {
  if (!isRecord(value)) return false;

  const { bestblockhash, blocks, chain, difficulty, headers } = value;
  return (
    typeof bestblockhash === "string" &&
    /^[a-fA-F0-9]{64}$/.test(bestblockhash) &&
    isNonNegativeSafeInteger(blocks) &&
    (headers === null || isNonNegativeSafeInteger(headers)) &&
    typeof chain === "string" &&
    chain.length > 0 &&
    isNonNegativeSafeInteger(value.connections) &&
    typeof difficulty === "number" &&
    Number.isFinite(difficulty) &&
    difficulty >= 0
  );
}

export function isLegacyNodeInfo(value: unknown): value is LegacyNodeInfo {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeSafeInteger(value.blocks) &&
    isNonNegativeSafeInteger(value.connections) &&
    typeof value.difficulty === "number" &&
    Number.isFinite(value.difficulty) &&
    value.difficulty >= 0 &&
    typeof value.testnet === "boolean"
  );
}

export function isBlockSummary(value: unknown): value is BlockSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.hash === "string" &&
    /^[a-fA-F0-9]{64}$/.test(value.hash) &&
    isNonNegativeSafeInteger(value.height) &&
    isNonNegativeSafeInteger(value.time) &&
    value.time <= 8_640_000_000_000 &&
    (typeof value.confirmations === "number" &&
      Number.isSafeInteger(value.confirmations)) &&
    isNonNegativeSafeInteger(value.transactionCount) &&
    (value.size === null || isNonNegativeSafeInteger(value.size))
  );
}

export function isBlockDetails(value: unknown): value is BlockDetails {
  if (!isRecord(value) || !isBlockSummary(value)) return false;
  return (
    Number.isSafeInteger(value.version) &&
    typeof value.bits === "string" &&
    typeof value.difficulty === "number" &&
    Number.isFinite(value.difficulty) &&
    value.difficulty >= 0 &&
    typeof value.merkleRoot === "string" &&
    /^[a-fA-F0-9]{64}$/.test(value.merkleRoot) &&
    (value.previousBlockHash === null ||
      (typeof value.previousBlockHash === "string" &&
        /^[a-fA-F0-9]{64}$/.test(value.previousBlockHash))) &&
    Array.isArray(value.transactions) &&
    value.transactionCount === value.transactions.length &&
    value.transactions.every(
      (transaction) =>
        typeof transaction === "string" &&
        /^[a-fA-F0-9]{64}$/.test(transaction),
    )
  );
}

export function isBlockchainInfoResult(
  value: unknown,
): value is BlockchainInfoResult {
  if (!isRecord(value)) return false;

  if (value.status === "online") {
    return isBlockchainInfo(value.info);
  }

  return (
    (value.status === "not-configured" || value.status === "unavailable") &&
    typeof value.message === "string"
  );
}

export interface TransactionInput {
  coinbase: string | null;
  txid: string | null;
  vout: number | null;
}

export interface TransactionOutput {
  index: number;
  value: number;
  type: string | null;
  addresses: string[];
}

export interface TransactionDetails {
  txid: string;
  version: number;
  lockTime: number;
  blockHash: string | null;
  confirmations: number | null;
  time: number | null;
  inputs: TransactionInput[];
  outputs: TransactionOutput[];
}

export type TransactionResult =
  | { status: "found"; source: "node" | "block"; data: TransactionDetails }
  | { status: "not-indexed" | "invalid"; message: string }
  | { status: "not-configured" | "unavailable"; message: string };

export type AddressResult =
  | { status: "valid-unindexed"; address: string }
  | { status: "invalid"; message: string }
  | { status: "not-configured" | "unavailable"; message: string };

export function parseTransaction(value: unknown): TransactionDetails | null {
  if (!isRecord(value)) return null;
  if (typeof value.txid !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.txid)) return null;
  if (!Array.isArray(value.vin) || !Array.isArray(value.vout)) return null;
  if (!Number.isSafeInteger(value.version) || !Number.isSafeInteger(value.locktime)) return null;

  const inputs: TransactionInput[] = [];
  for (const input of value.vin) {
    if (!isRecord(input)) return null;
    if (typeof input.coinbase === "string") {
      inputs.push({ coinbase: input.coinbase, txid: null, vout: null });
    } else if (
      typeof input.txid === "string" &&
      /^[a-fA-F0-9]{64}$/.test(input.txid) &&
      isNonNegativeSafeInteger(input.vout)
    ) {
      inputs.push({ coinbase: null, txid: input.txid, vout: input.vout });
    } else {
      return null;
    }
  }

  const outputs: TransactionOutput[] = [];
  for (const output of value.vout) {
    if (!isRecord(output) || typeof output.value !== "number" || !Number.isFinite(output.value)) {
      return null;
    }
    if (!isNonNegativeSafeInteger(output.n)) return null;
    const script = isRecord(output.scriptPubKey) ? output.scriptPubKey : {};
    outputs.push({
      index: output.n,
      value: output.value,
      type: typeof script.type === "string" ? script.type : null,
      addresses: Array.isArray(script.addresses)
        ? script.addresses.filter((entry): entry is string => typeof entry === "string")
        : [],
    });
  }

  return {
    txid: value.txid.toLowerCase(),
    version: value.version as number,
    lockTime: value.locktime as number,
    blockHash:
      typeof value.blockhash === "string" && /^[a-fA-F0-9]{64}$/.test(value.blockhash)
        ? value.blockhash
        : null,
    confirmations: Number.isSafeInteger(value.confirmations) ? (value.confirmations as number) : null,
    time: isNonNegativeSafeInteger(value.time) ? value.time : null,
    inputs,
    outputs,
  };
}
