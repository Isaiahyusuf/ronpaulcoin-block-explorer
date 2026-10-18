import type { Queryable } from "./db.ts";
import { getIndexState } from "./indexer.ts";

// Matches the daemon: a coinbase output may be spent once the next block's
// height minus its own height is at least 100, i.e. 100 confirmations.
export const COINBASE_MATURITY = 100;

export interface AddressTransaction {
  txid: string;
  height: number;
  time: number;
  // Net change to this address's balance in satoshis (negative when it spent more than it received).
  delta: bigint;
}

export interface AddressSummary {
  address: string;
  // True only when the index is healthy, within `maxLag` blocks of the node, and
  // its newest block is still on the node's chain. When false, the balance and
  // history fields must not be presented as current.
  complete: boolean;
  incompleteReason: string | null;
  indexedHeight: number | null;
  nodeHeight: number;
  spendable: bigint;
  immature: bigint;
  total: bigint;
  totalReceived: bigint;
  transactionCount: number;
  transactions: AddressTransaction[];
  caveats: string[];
}

export interface AddressQueryOptions {
  nodeHeight: number;
  // The node's current hash at a height. Required so completeness is never judged
  // from heights alone: a same-height reorg leaves the stored hash stale.
  nodeBlockHash: (height: number) => Promise<string>;
  maxLag?: number;
  limit?: number;
  offset?: number;
}

export async function getAddressSummary(
  db: Queryable,
  address: string,
  options: AddressQueryOptions,
): Promise<AddressSummary> {
  const maxLag = options.maxLag ?? 2;
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const state = await getIndexState(db);
  const indexedHeight = state.indexedHeight;

  let incompleteReason: string | null = null;
  if (state.status === "halted") incompleteReason = `The indexer is halted: ${state.haltedReason}`;
  else if (indexedHeight === null) incompleteReason = "Nothing has been indexed yet.";
  else if (indexedHeight > options.nodeHeight) {
    incompleteReason = `The index is at height ${indexedHeight}, ahead of the node at ${options.nodeHeight}.`;
  } else if (indexedHeight < options.nodeHeight - maxLag) {
    incompleteReason = `The index is at height ${indexedHeight} but the node is at ${options.nodeHeight}.`;
  } else {
    try {
      const nodeHash = await options.nodeBlockHash(indexedHeight);
      if (nodeHash !== state.indexedHash) {
        incompleteReason = `The index's block at height ${indexedHeight} is no longer on the node's chain (stale after a reorganisation).`;
      }
    } catch {
      incompleteReason = "The node's block hash could not be checked, so the index cannot be confirmed current.";
    }
  }

  const tip = indexedHeight ?? -1;
  const balance = await db.query<{ spendable: string; immature: string; received: string }>(
    `SELECT
       COALESCE(SUM(value) FILTER (WHERE spent_height IS NULL AND spendable
                                    AND (NOT is_coinbase OR $2 - height + 1 >= $3)), 0)::text AS spendable,
       COALESCE(SUM(value) FILTER (WHERE spent_height IS NULL AND spendable
                                    AND is_coinbase AND $2 - height + 1 < $3), 0)::text AS immature,
       COALESCE(SUM(value) FILTER (WHERE spendable), 0)::text AS received
     FROM outputs WHERE address = $1`,
    [address, tip, COINBASE_MATURITY],
  );

  // Events carry no txid so the scan stays index-only; the txid is looked up for
  // the returned page only. (height, tx_index) identifies a transaction uniquely.
  const events = `
    SELECT height, tx_index, value AS delta FROM outputs WHERE address = $1 AND spendable
    UNION ALL
    SELECT spent_height, spent_tx_index, -value FROM outputs
     WHERE address = $1 AND spent_height IS NOT NULL`;
  const count = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM (SELECT DISTINCT height, tx_index FROM (${events}) e) d`,
    [address],
  );
  const history = await db.query<{ txid: string; height: number; time: string; delta: string }>(
    `SELECT t.txid, g.height, b.time::text AS time, g.delta::text AS delta
       FROM (SELECT height, tx_index, SUM(delta) AS delta FROM (${events}) e
              GROUP BY height, tx_index
              ORDER BY height DESC, tx_index DESC
              LIMIT $2 OFFSET $3) g
       JOIN transactions t ON t.height = g.height AND t.tx_index = g.tx_index
       JOIN blocks b ON b.height = g.height
      ORDER BY g.height DESC, g.tx_index DESC`,
    [address, limit, offset],
  );

  const caveats: string[] = [];
  const multisig = await db.query("SELECT 1 FROM outputs WHERE script_type = 'multisig' LIMIT 1");
  if (multisig.rows.length > 0) {
    caveats.push("Multisig outputs exist in the index and are not attributed to individual addresses.");
  }

  const row = balance.rows[0];
  const spendable = BigInt(row.spendable);
  const immature = BigInt(row.immature);
  return {
    address,
    complete: incompleteReason === null,
    incompleteReason,
    indexedHeight,
    nodeHeight: options.nodeHeight,
    spendable,
    immature,
    total: spendable + immature,
    totalReceived: BigInt(row.received),
    transactionCount: Number(count.rows[0].count),
    transactions: history.rows.map((r) => ({
      txid: r.txid,
      height: r.height,
      time: Number(r.time),
      delta: BigInt(r.delta),
    })),
    caveats,
  };
}

export interface IndexStats {
  outputsByType: Record<string, { count: number; value: bigint }>;
}

// Makes unattributable value visible: outputs without an address are stored
// but belong to no address balance.
export async function getIndexStats(db: Queryable): Promise<IndexStats> {
  const result = await db.query<{ script_type: string; count: string; value: string }>(
    `SELECT script_type, COUNT(*)::text AS count, COALESCE(SUM(value), 0)::text AS value
       FROM outputs GROUP BY script_type`,
  );
  const outputsByType: IndexStats["outputsByType"] = {};
  for (const row of result.rows) {
    outputsByType[row.script_type] = { count: Number(row.count), value: BigInt(row.value) };
  }
  return { outputsByType };
}
