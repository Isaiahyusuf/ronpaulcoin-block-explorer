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
