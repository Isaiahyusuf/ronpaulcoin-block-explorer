import type { Db, Queryable } from "./db.ts";
import { computeMerkleRoot, parseBlock, type ParsedBlock } from "./parse.ts";
import { classifyScript } from "./script.ts";
import type { BlockSource } from "./source.ts";

const ZERO_HASH = "0".repeat(64);
const UNIQUE_VIOLATION = "23505";

// Data-integrity failures. They stop the scan and are recorded in
// indexer_state so no balance is reported as complete until an operator
// investigates. Transient problems (RPC errors) are never halts.
export class IndexerHaltError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "IndexerHaltError";
    this.reason = reason;
  }
}

// The chain moved while a batch was being fetched; reconcile and continue.
class ChainChangedError extends Error {}

export interface SyncOptions {
  batchSize?: number;
  maxReorgDepth?: number;
  // Stops after this many blocks (for benchmarks and bounded runs).
  maxBlocks?: number;
  onProgress?: (indexedHeight: number) => void;
}

export interface SyncResult {
  indexedHeight: number;
  tipHeight: number;
  blocksProcessed: number;
  rolledBackBlocks: number;
}

export interface IndexState {
  status: "ok" | "halted";
  haltedReason: string | null;
  indexedHeight: number | null;
  indexedHash: string | null;
}

export async function getIndexState(db: Queryable): Promise<IndexState> {
  const state = await db.query<{ status: "ok" | "halted"; halted_reason: string | null }>(
    "SELECT status, halted_reason FROM indexer_state WHERE id = 1",
  );
  const top = await db.query<{ height: number; hash: string }>(
    "SELECT height, hash FROM blocks ORDER BY height DESC LIMIT 1",
  );
  return {
    status: state.rows[0]?.status ?? "ok",
    haltedReason: state.rows[0]?.halted_reason ?? null,
    indexedHeight: top.rows[0]?.height ?? null,
    indexedHash: top.rows[0]?.hash ?? null,
  };
}

export async function clearHalt(db: Queryable): Promise<void> {
  await db.query("UPDATE indexer_state SET status = 'ok', halted_reason = NULL WHERE id = 1");
}

async function storedHash(db: Queryable, height: number): Promise<string | null> {
  const result = await db.query<{ hash: string }>("SELECT hash FROM blocks WHERE height = $1", [height]);
  return result.rows[0]?.hash ?? null;
}

// Removes every block above forkHeight and re-opens the outputs they spent.
// Blocks go first so a spend recorded above the fork can only point at an
// output that survives it.
export async function rollbackTo(db: Queryable, forkHeight: number): Promise<number> {
  const removed = await db.query("DELETE FROM blocks WHERE height > $1", [forkHeight]);
  await db.query(
    `UPDATE outputs
        SET spent_height = NULL, spent_tx_index = NULL, spent_vin = NULL, spent_txid = NULL
      WHERE spent_height > $1`,
    [forkHeight],
  );
  return removed.rowCount;
}

interface SpendRecord {
  prevTxid: string;
  prevVout: number;
  height: number;
  txIndex: number;
  vin: number;
  txid: string;
}

export async function applyBlock(
  tx: Queryable,
  height: number,
  hash: string,
  block: ParsedBlock,
): Promise<void> {
  await tx.query(
    "INSERT INTO blocks (height, hash, prev_hash, time, tx_count) VALUES ($1, $2, $3, $4, $5)",
    [height, hash, block.prevHash, String(block.time), block.transactions.length],
  );

  const txIndexes: number[] = [];
  const txids: string[] = [];
  const o = {
    txIndex: [] as number[],
    vout: [] as number[],
    txid: [] as string[],
    address: [] as (string | null)[],
    type: [] as string[],
    value: [] as string[],
    coinbase: [] as boolean[],
    spendable: [] as boolean[],
  };
  const spends: SpendRecord[] = [];

  block.transactions.forEach((transaction, txIndex) => {
    txIndexes.push(txIndex);
    txids.push(transaction.txid);
    const isCoinbase = transaction.inputs.length === 1 && transaction.inputs[0].coinbase;
    transaction.outputs.forEach((output) => {
      const classified = classifyScript(output.script);
      o.txIndex.push(txIndex);
      o.vout.push(output.index);
      o.txid.push(transaction.txid);
      o.address.push(classified.address);
      o.type.push(classified.type);
      o.value.push(output.value.toString());
      o.coinbase.push(isCoinbase);
      // The genesis coinbase is not in the daemon's coin set and cannot be spent.
      o.spendable.push(height !== 0);
    });
    transaction.inputs.forEach((input, vin) => {
      if (input.coinbase) return;
      spends.push({
        prevTxid: input.prevTxid,
        prevVout: input.prevVout,
        height,
        txIndex,
        vin,
        txid: transaction.txid,
      });
    });
  });

  await tx.query(
    `INSERT INTO transactions (height, tx_index, txid)
     SELECT $1, t.tx_index, t.txid FROM unnest($2::int[], $3::text[]) AS t(tx_index, txid)`,
    [height, txIndexes, txids],
  );

  if (o.vout.length > 0) {
    await tx.query(
      `INSERT INTO outputs (height, tx_index, vout, txid, address, script_type, value, is_coinbase, spendable)
       SELECT $1, v.tx_index, v.vout, v.txid, v.address, v.script_type, v.value, v.is_coinbase, v.spendable
         FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::boolean[], $9::boolean[])
           AS v(tx_index, vout, txid, address, script_type, value, is_coinbase, spendable)`,
      [height, o.txIndex, o.vout, o.txid, o.address, o.type, o.value, o.coinbase, o.spendable],
    );
  }

  if (spends.length === 0) return;

  // An input may only spend an output created at an earlier position in the
  // chain. Every input must match exactly one unspent output.
  const updated = await tx.query(
    `UPDATE outputs AS out
        SET spent_height = s.height, spent_tx_index = s.tx_index, spent_vin = s.vin, spent_txid = s.txid
       FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::int[], $6::text[])
         AS s(prev_txid, prev_vout, height, tx_index, vin, txid)
      WHERE out.txid = s.prev_txid AND out.vout = s.prev_vout
        AND out.spent_height IS NULL
        AND (out.height < s.height OR (out.height = s.height AND out.tx_index < s.tx_index))`,
    [
      spends.map((s) => s.prevTxid),
      spends.map((s) => s.prevVout),
      spends.map((s) => s.height),
      spends.map((s) => s.txIndex),
      spends.map((s) => s.vin),
      spends.map((s) => s.txid),
    ],
  );
  if (updated.rowCount === spends.length) return;

  const applied = await tx.query<{ spent_tx_index: number; spent_vin: number }>(
    "SELECT spent_tx_index, spent_vin FROM outputs WHERE spent_height = $1",
    [height],
  );
  const done = new Set(applied.rows.map((row) => `${row.spent_tx_index}:${row.spent_vin}`));
  const missing = spends.find((s) => !done.has(`${s.txIndex}:${s.vin}`)) ?? spends[0];
  throw new IndexerHaltError(
    "unresolved-input",
    `Block ${height}: input ${missing.vin} of ${missing.txid} spends ${missing.prevTxid}:${missing.prevVout}, which is unknown or already spent in the index.`,
  );
}

async function indexBatch(
  db: Db,
  source: BlockSource,
  from: number,
  to: number,
  expectedPrev: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    let prev = expectedPrev;
    for (let height = from; height <= to; height += 1) {
      const hash = await source.getBlockHash(height);
      const raw = await source.getBlockRaw(hash);
      const block = parseBlock(raw);
      if (computeMerkleRoot(block.transactions.map((t) => t.txid)) !== block.merkleRoot) {
        throw new IndexerHaltError("bad-merkle-root", `Block ${height} (${hash}) failed its merkle root check.`);
      }
      if (block.prevHash !== prev) throw new ChainChangedError(`Block ${height} does not follow the indexed chain.`);
      try {
        await applyBlock(tx, height, hash, block);
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new IndexerHaltError(
            "duplicate-unspent-output",
            `Block ${height} (${hash}) creates a transaction ID that still has unspent outputs.`,
          );
        }
        throw error;
      }
      prev = hash;
    }
    return prev;
  });
}

async function findForkPoint(
  db: Queryable,
  source: BlockSource,
  indexedHeight: number,
  tipHeight: number,
  maxDepth: number,
): Promise<number> {
  let height = indexedHeight;
  while (height >= 0) {
    if (indexedHeight - height > maxDepth) {
      throw new IndexerHaltError(
        "reorg-too-deep",
        `The indexed chain differs from the node by more than ${maxDepth} blocks.`,
      );
    }
    if (height <= tipHeight && (await storedHash(db, height)) === (await source.getBlockHash(height))) {
      return height;
    }
    height -= 1;
  }
  return -1;
}

async function recordHalt(db: Db, error: IndexerHaltError): Promise<void> {
  await db.query("UPDATE indexer_state SET status = 'halted', halted_reason = $1 WHERE id = 1", [
    `${error.reason}: ${error.message}`,
  ]);
}

export async function syncOnce(
  db: Db,
  source: BlockSource,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const batchSize = options.batchSize ?? 100;
  const maxDepth = options.maxReorgDepth ?? 1000;
  let processed = 0;
  let rolledBack = 0;
  let retries = 0;

  const initial = await getIndexState(db);
  if (initial.status === "halted") {
    throw new IndexerHaltError("halted", `Indexer is halted (${initial.haltedReason}). Investigate, then clear the halt.`);
  }

  for (;;) {
    try {
      const tip = await source.getTip();
      const state = await getIndexState(db);
      let indexed = state.indexedHeight ?? -1;

      if (indexed >= 0) {
        const fork = await findForkPoint(db, source, indexed, tip.height, maxDepth);
        if (fork < indexed) {
          rolledBack += await db.transaction((tx) => rollbackTo(tx, fork));
          indexed = fork;
        }
      }

      let prev = indexed >= 0 ? ((await storedHash(db, indexed)) as string) : ZERO_HASH;
      while (indexed < tip.height) {
        if (options.maxBlocks !== undefined && processed >= options.maxBlocks) break;
        let to = Math.min(indexed + batchSize, tip.height);
        if (options.maxBlocks !== undefined) to = Math.min(to, indexed + (options.maxBlocks - processed));
        prev = await indexBatch(db, source, indexed + 1, to, prev);
        processed += to - indexed;
        indexed = to;
        options.onProgress?.(indexed);
      }
      return { indexedHeight: indexed, tipHeight: tip.height, blocksProcessed: processed, rolledBackBlocks: rolledBack };
    } catch (error) {
      if (error instanceof ChainChangedError && retries < 5) {
        retries += 1;
        continue;
      }
      if (error instanceof IndexerHaltError) await recordHalt(db, error);
      throw error;
    }
  }
}
