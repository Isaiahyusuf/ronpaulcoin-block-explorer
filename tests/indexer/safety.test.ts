import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../indexer/db.ts";
import {
  applyBlock, getIndexState, IndexerHaltError, isOutpointViolation, OUTPOINT_CONSTRAINT, syncOnce,
} from "../../indexer/indexer.ts";
import { parseBlock } from "../../indexer/parse.ts";
import { getAddressSummary } from "../../indexer/queries.ts";
import { addressOf, Builder, COIN, buildTx, createTestDb, dumpState, memorySource, payTo, resetDb } from "./helpers.ts";
import { countingSource, gatedSource } from "./helpers-gate.ts";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetDb(db);
});

function chain(length: number, salt = 0): Builder {
  const b = new Builder();
  for (let h = 0; h < length; h += 1) b.coinbase((h % 3) + 1, BigInt(50) * COIN, salt);
  return b;
}

async function freshDump(b: Builder): Promise<string> {
  await resetDb(db);
  await syncOnce(db, memorySource(() => b));
  const dump = await dumpState(db);
  await resetDb(db);
  return dump;
}

describe("single writer", () => {
  it("lets a second worker run only after the first finishes, with no interleaved writes", async () => {
    const b = chain(12);
    const clean = await freshDump(b);

    const first = gatedSource(memorySource(() => b), "getBlockRaw", 4);
    const running = syncOnce(db, first.source, { batchSize: 5 });
    await first.hasEntered; // worker A is now mid-batch, holding the lock

    const second = countingSource(memorySource(() => b));
    expect(await syncOnce(db, second.source)).toEqual({ status: "indexer-already-running" });
    expect(second.counts).toEqual({ getTip: 0, getBlockHash: 0, getBlockRaw: 0 }); // never read the node
    // PGlite is one connection, so querying while A's transaction is open would
    // queue behind it; state is inspected after A finishes instead.

    first.release();
    expect(await running).toMatchObject({ status: "synced", indexedHeight: 11 });
    expect(await dumpState(db)).toBe(clean); // exactly the clean result: no lost or doubled writes
    expect((await getIndexState(db)).status).toBe("ok"); // no false halt recorded

    // The lock was released, so a later worker proceeds normally.
    expect(await syncOnce(db, memorySource(() => b))).toMatchObject({ status: "synced", blocksProcessed: 0 });
  });

  it("releases the lock when a worker fails", async () => {
    const b = chain(8);
    const broken = memorySource(() => b, {
      beforeRaw: (_hash, calls) => {
        if (calls === 3) throw new Error("connection reset");
      },
    });
    await expect(syncOnce(db, broken, { batchSize: 4 })).rejects.toThrow("connection reset");
    expect(await syncOnce(db, memorySource(() => b))).toMatchObject({ status: "synced", indexedHeight: 7 });
  });

  it("releases the lock after a recorded halt too", async () => {
    const orphan = new Builder();
    orphan.coinbase(1);
    orphan.add([buildTx([{ prevTxid: "ab".repeat(32), vout: 0 }], [payTo(2, COIN)])]);
    await expect(syncOnce(db, memorySource(() => orphan))).rejects.toMatchObject({ reason: "unresolved-input" });
    // Halted, not locked: the refusal is the halt, not "already running".
    await expect(syncOnce(db, memorySource(() => orphan))).rejects.toMatchObject({ reason: "halted" });
  });

  it("holds the lock through reorg detection and rollback", async () => {
    const a = chain(10);
    await syncOnce(db, memorySource(() => a));
    const forked = a.fork(4);
    for (let h = 5; h <= 11; h += 1) forked.coinbase(9, BigInt(50) * COIN, 700);

    const before = await dumpState(db);
    // Call 1 is the genesis check; pause during fork detection, before any rollback.
    const first = gatedSource(memorySource(() => forked), "getBlockHash", 2);
    const running = syncOnce(db, first.source);
    await first.hasEntered;

    expect(await syncOnce(db, memorySource(() => forked))).toEqual({ status: "indexer-already-running" });
    expect(await dumpState(db)).toBe(before); // nothing was rolled back or written by anyone

    first.release();
    expect(await running).toMatchObject({ status: "synced", rolledBackBlocks: 5, indexedHeight: 11 });
    expect(await dumpState(db)).toBe(await freshDump(forked));
  });
});

describe("outpoint violation detection", () => {
  it("recognises only the unspent-outpoint constraint", () => {
    expect(isOutpointViolation({ code: "23505", constraint: OUTPOINT_CONSTRAINT })).toBe(true);
    expect(isOutpointViolation({ code: "23505", constraint: "blocks_pkey" })).toBe(false);
    expect(isOutpointViolation({ code: "23505", constraint: "blocks_hash_key" })).toBe(false);
    expect(isOutpointViolation({ code: "23505" })).toBe(false);
    expect(isOutpointViolation({ code: "23503", constraint: OUTPOINT_CONSTRAINT })).toBe(false);
    expect(isOutpointViolation(new Error("x"))).toBe(false);
    expect(isOutpointViolation(null)).toBe(false);
  });
});

describe("wrong chain protection", () => {
  async function expectUntouchedHalt(node: Builder) {
    const before = await dumpState(db);
    const error = await syncOnce(db, memorySource(() => node)).catch((e) => e);
    expect(error).toBeInstanceOf(IndexerHaltError);
    expect(error.reason).toBe("genesis-mismatch");
    expect(await dumpState(db)).toBe(before); // not a single row removed
    const state = await getIndexState(db);
    expect(state.status).toBe("halted");
    expect(state.haltedReason).toMatch(/^genesis-mismatch/);
    // It stays halted rather than retrying against the wrong chain.
    await expect(syncOnce(db, memorySource(() => node))).rejects.toMatchObject({ reason: "halted" });
    expect(await dumpState(db)).toBe(before);
  }

  it("does not let an unrelated longer chain erase a shallow index", async () => {
    await syncOnce(db, memorySource(() => chain(6)));
    await expectUntouchedHalt(chain(12, 4242));
  });

  it("does not let an unrelated shorter chain erase a shallow index", async () => {
    await syncOnce(db, memorySource(() => chain(10)));
    await expectUntouchedHalt(chain(3, 4242));
  });

  it("treats a failing genesis lookup as a transient error, not a halt or a wipe", async () => {
    const a = chain(6);
    await syncOnce(db, memorySource(() => a));
    const before = await dumpState(db);
    const flaky = memorySource(() => a);
    flaky.getBlockHash = async () => {
      throw new Error("node unavailable");
    };
    await expect(syncOnce(db, flaky)).rejects.toThrow("node unavailable");
    expect((await getIndexState(db)).status).toBe("ok");
    expect(await dumpState(db)).toBe(before);
  });

  it("still follows a legitimate reorg that shares the genesis block", async () => {
    const a = chain(8);
    await syncOnce(db, memorySource(() => a));
    const forked = a.fork(2);
    for (let h = 3; h <= 9; h += 1) forked.coinbase(9, BigInt(50) * COIN, 800);
    expect(await syncOnce(db, memorySource(() => forked))).toMatchObject({ status: "synced", rolledBackBlocks: 5 });
    expect(await dumpState(db)).toBe(await freshDump(forked));
  });

  it("keeps the deep-reorg limit for chains that share genesis", async () => {
    const a = chain(10);
    await syncOnce(db, memorySource(() => a));
    const forked = a.fork(3);
    for (let h = 4; h <= 9; h += 1) forked.coinbase(9, BigInt(50) * COIN, 801);
    const before = await dumpState(db);
    await expect(syncOnce(db, memorySource(() => forked), { maxReorgDepth: 2 })).rejects.toMatchObject({
      reason: "reorg-too-deep",
    });
    expect(await dumpState(db)).toBe(before);
  });
});

describe("stale tip detection in address summaries", () => {
  const address = addressOf(1);
  async function indexed(): Promise<Builder> {
    const a = chain(6);
    await syncOnce(db, memorySource(() => a));
    return a;
  }
  const summarise = (nodeHeight: number, nodeBlockHash: (h: number) => Promise<string>) =>
    getAddressSummary(db, address, { nodeHeight, nodeBlockHash });

  it("is complete when the node's hash at the indexed height matches", async () => {
    const a = await indexed();
    const s = await summarise(5, async (h) => a.blocks[h].hash);
    expect(s).toMatchObject({ complete: true, incompleteReason: null, indexedHeight: 5 });
  });

  it("is incomplete when the node has a different block at the indexed height", async () => {
    await indexed();
    const other = chain(6, 31337);
    const s = await summarise(5, async (h) => other.blocks[h].hash);
    expect(s.complete).toBe(false);
    expect(s.incompleteReason).toMatch(/no longer on the node's chain/);
    expect((await getIndexState(db)).status).toBe("ok"); // a read never changes index state
  });

  it("is incomplete when the index is ahead of the node", async () => {
    const a = await indexed();
    const s = await summarise(3, async (h) => a.blocks[h].hash);
    expect(s.complete).toBe(false);
    expect(s.incompleteReason).toMatch(/ahead of the node/);
  });

  it("is incomplete when the node cannot be asked", async () => {
    await indexed();
    const s = await summarise(5, async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(s.complete).toBe(false);
    expect(s.incompleteReason).toMatch(/could not be checked/);
    expect(s.incompleteReason).not.toMatch(/ECONNREFUSED/);
  });

  it("does not call the node when the index is already known to be incomplete", async () => {
    await indexed();
    let asked = 0;
    const s = await summarise(500, async () => (asked++, "x"));
    expect(s.complete).toBe(false);
    expect(asked).toBe(0);
  });
});

describe("block contiguity", () => {
  const apply = (b: Builder, height: number, parentOverride?: string) => {
    const built = b.blocks[height];
    const parsed = parseBlock(built.raw);
    return db.transaction((tx) =>
      applyBlock(tx, height, built.hash, parentOverride ? { ...parsed, prevHash: parentOverride } : parsed),
    );
  };

  it("accepts genesis and then its direct child", async () => {
    const b = chain(3);
    await apply(b, 0);
    await apply(b, 1);
    expect((await getIndexState(db)).indexedHeight).toBe(1);
  });

  it("rejects a genesis block with a non-zero parent", async () => {
    await expect(apply(chain(2), 0, "ab".repeat(32))).rejects.toMatchObject({ reason: "non-contiguous-block" });
    expect(await dumpState(db)).toBe(await freshEmpty());
  });

  it("rejects a skipped height and leaves nothing behind", async () => {
    const b = chain(4);
    await apply(b, 0);
    const before = await dumpState(db);
    await expect(apply(b, 2)).rejects.toMatchObject({ reason: "non-contiguous-block" });
    expect(await dumpState(db)).toBe(before);
  });

  it("rejects a block whose parent hash is wrong and leaves nothing behind", async () => {
    const b = chain(3);
    await apply(b, 0);
    await apply(b, 1);
    const before = await dumpState(db);
    await expect(apply(b, 2, "cd".repeat(32))).rejects.toMatchObject({ reason: "non-contiguous-block" });
    expect(await dumpState(db)).toBe(before);
  });

  it("rejects a non-genesis block into an empty index", async () => {
    await expect(apply(chain(2), 1)).rejects.toMatchObject({ reason: "non-contiguous-block" });
    expect((await getIndexState(db)).indexedHeight).toBeNull();
  });

  it("refuses to fill a gap below the current tip", async () => {
    const b = chain(8);
    await syncOnce(db, memorySource(() => b));
    await db.exec("DELETE FROM blocks WHERE height = 4");
    const before = await dumpState(db);
    await expect(apply(b, 4)).rejects.toMatchObject({ reason: "non-contiguous-block" });
    expect(await dumpState(db)).toBe(before);
  });

  it("refuses to insert below an existing tip, including genesis", async () => {
    const b = chain(6);
    await syncOnce(db, memorySource(() => b));
    const before = await dumpState(db);
    await db.exec("DELETE FROM blocks WHERE height = 3");
    const gapped = await dumpState(db);
    await expect(apply(b, 3)).rejects.toMatchObject({ reason: "non-contiguous-block" });
    await resetDb(db);
    await syncOnce(db, memorySource(() => b));
    await expect(apply(b, 0)).rejects.toThrow();
    expect(await dumpState(db)).toBe(before);
    expect(gapped).not.toBe(before);
  });

  it("rolls back the whole batch, records the halt and blocks later syncs on non-contiguous-block", async () => {
    const b = chain(12);
    await syncOnce(db, memorySource(() => b), { maxBlocks: 3 });
    const before = await dumpState(db);

    // Simulates out-of-band tampering inside the batch: the parent of block 6
    // disappears just before block 6 is inserted.
    const tampering = (inner: Db): Db => ({
      ...inner,
      transaction: (work) =>
        inner.transaction((tx) => {
          let inserts = 0;
          return work({
            query: async (sql, params) => {
              if (sql.includes("INSERT INTO blocks") && (inserts += 1) === 4) {
                await tx.query("DELETE FROM blocks WHERE height = 5");
              }
              return tx.query(sql, params);
            },
          });
        }),
    });
    const tampered: Db = {
      ...db,
      withExclusiveLock: (key, work) => db.withExclusiveLock(key, (locked) => work(tampering(locked))),
    };

    await expect(syncOnce(tampered, memorySource(() => b), { batchSize: 10 })).rejects.toMatchObject({
      reason: "non-contiguous-block",
    });
    expect(await dumpState(db)).toBe(before); // blocks 3-5 of the batch and the tampering are all rolled back
    const state = await getIndexState(db);
    expect(state.status).toBe("halted");
    expect(state.haltedReason).toMatch(/^non-contiguous-block/);
    expect(state.indexedHeight).toBe(2);

    const next = syncOnce(db, memorySource(() => b));
    await expect(next).rejects.toMatchObject({ reason: "halted" });
    expect(await dumpState(db)).toBe(before);
  });

  it("does not change halt behaviour: a normal sync and a reorg still work", async () => {
    const b = chain(8);
    await syncOnce(db, memorySource(() => b));
    const forked = b.fork(4);
    for (let h = 5; h < 10; h += 1) forked.coinbase(2, BigInt(50) * COIN, 99);
    expect(await syncOnce(db, memorySource(() => forked))).toMatchObject({ status: "synced", indexedHeight: 9, rolledBackBlocks: 3 });
    expect((await getIndexState(db)).status).toBe("ok");
  });
});

async function freshEmpty(): Promise<string> {
  await resetDb(db);
  return dumpState(db);
}
