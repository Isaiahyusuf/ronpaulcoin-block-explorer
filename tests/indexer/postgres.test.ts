import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { pgDb, type Db } from "../../indexer/db.ts";
import { getIndexState, INDEXER_LOCK_KEY, syncOnce } from "../../indexer/indexer.ts";
import { migrate } from "../../indexer/schema.ts";
import { Builder, COIN, dumpState, memorySource } from "./helpers.ts";
import { gatedSource } from "./helpers-gate.ts";

// Real two-connection tests for the advisory lock. They run only against a
// disposable database named by TEST_DATABASE_URL and TRUNCATE its tables.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("postgres advisory lock (real connections)", () => {
  const pools: Pool[] = [];
  const open = (): Db => {
    const pool = new Pool({ connectionString: url, max: 3 });
    pool.on("error", () => undefined); // terminated backends are expected here
    pools.push(pool);
    return pgDb(pool as never);
  };
  let a: Db;
  let b: Db;

  beforeAll(async () => {
    a = open();
    b = open();
    await migrate(a);
  });
  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
  });
  beforeEach(async () => {
    await a.exec("TRUNCATE blocks CASCADE; UPDATE indexer_state SET status = 'ok', halted_reason = NULL;");
  });

  function chain(length: number): Builder {
    const c = new Builder();
    for (let h = 0; h < length; h += 1) c.coinbase((h % 3) + 1, BigInt(50) * COIN);
    return c;
  }

  it("keeps a second connection out while the first is mid-batch", async () => {
    const c = chain(12);
    const first = gatedSource(memorySource(() => c), "getBlockRaw", 4);
    const running = syncOnce(a, first.source, { batchSize: 5 });
    await first.hasEntered;

    expect(await syncOnce(b, memorySource(() => c))).toEqual({ status: "indexer-already-running" });
    expect((await getIndexState(b)).status).toBe("ok"); // no false halt, queried while A is paused
    const rows = await b.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM blocks");
    expect(Number(rows.rows[0].n)).toBeLessThanOrEqual(5); // only A's committed batch(es), nothing from B

    first.release();
    expect(await running).toMatchObject({ status: "synced", indexedHeight: 11 });
    expect(await syncOnce(b, memorySource(() => c))).toMatchObject({ status: "synced", blocksProcessed: 0 });
  });

  it("frees the lock when the lock holder's connection is killed", async () => {
    const c = chain(12);
    const first = gatedSource(memorySource(() => c), "getBlockRaw", 4);
    const running = syncOnce(a, first.source, { batchSize: 5 });
    running.catch(() => undefined);
    await first.hasEntered;

    const holder = await b.query<{ pid: number }>(
      "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted AND objid = $1::bigint::oid",
      [INDEXER_LOCK_KEY],
    );
    expect(holder.rows).toHaveLength(1);
    await b.query("SELECT pg_terminate_backend($1)", [holder.rows[0].pid]);
    first.release();
    await expect(running).rejects.toThrow();

    // The killed worker's lock is gone and its open batch rolled back.
    expect(await syncOnce(b, memorySource(() => c))).toMatchObject({ status: "synced", indexedHeight: 11 });
    expect((await getIndexState(b)).status).toBe("ok");
  });

  it("halts as non-contiguous-block, not a duplicate-output halt, when a rogue writer adds a block mid-batch", async () => {
    const c = chain(8);
    const first = gatedSource(memorySource(() => c), "getBlockRaw", 1);
    const running = syncOnce(a, first.source, { batchSize: 8 });
    running.catch(() => undefined);
    await first.hasEntered;

    // A rogue writer that bypasses the lock commits block 3 while A's batch is open.
    await b.query("INSERT INTO blocks (height, hash, prev_hash, time, tx_count) VALUES (3, $1, $2, 0, 0)", ["f".repeat(64), "e".repeat(64)]);
    first.release();
    await expect(running).rejects.toMatchObject({ reason: "non-contiguous-block" });
    const state = await getIndexState(b);
    expect(state.status).toBe("halted");
    expect(state.haltedReason).toMatch(/^non-contiguous-block/);
    const rows = await b.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM blocks WHERE height <> 3");
    expect(rows.rows[0].n).toBe("0"); // A's whole batch rolled back; only the rogue row remains
  });

  it("produces the same index as a single worker when many workers race", async () => {
    const c = chain(20);
    const results = await Promise.all([a, b, a, b].map((db) => syncOnce(db, memorySource(() => c), { batchSize: 3 })));
    expect(results.filter((r) => r.status === "synced")).toHaveLength(1);
    expect(results.filter((r) => r.status === "indexer-already-running")).toHaveLength(3);
    const raced = await dumpState(a);
    await a.exec("TRUNCATE blocks CASCADE");
    await syncOnce(a, memorySource(() => c), { batchSize: 3 });
    expect(await dumpState(a)).toBe(raced);
  });
});
