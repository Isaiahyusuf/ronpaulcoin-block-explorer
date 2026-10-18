import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import real from "../fixtures/real-chain.json";
import type { Db } from "../../indexer/db.ts";
import { applyBlock, clearHalt, getIndexState, syncOnce as syncOnceRaw } from "../../indexer/indexer.ts";
import type { BlockSource } from "../../indexer/source.ts";
import { parseBlock } from "../../indexer/parse.ts";
import { classifyScript } from "../../indexer/script.ts";
import { COINBASE_MATURITY, getAddressSummary, getIndexStats } from "../../indexer/queries.ts";
import {
  addressOf, buildBlock, buildTx, createTestDb, dumpState, memorySource, p2pkh, keyHash, payTo,
  Builder, COIN, realChainSource, resetDb, ZERO,
} from "./helpers.ts";

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

// Remembers the node the index last synced from, so summaries can confirm its tip hash.
let lastNode: BlockSource | null = null;
const syncOnce = (target: Db, source: BlockSource, options = {}) => {
  lastNode = source;
  return syncOnceRaw(target, source, options);
};
const sync = (b: Builder, options = {}) => syncOnce(db, memorySource(() => b), options);
const summary = (address: string, nodeHeight: number) =>
  getAddressSummary(db, address, { nodeHeight, nodeBlockHash: (h) => lastNode!.getBlockHash(h) });

async function freshDump(b: Builder): Promise<string> {
  await resetDb(db);
  await sync(b);
  const dump = await dumpState(db);
  await resetDb(db);
  return dump;
}

describe("real RonPaulCoin blocks 0-3000", () => {
  it("matches an independent in-memory UTXO model for every address", async () => {
    const result = await syncOnce(db, realChainSource(real), { batchSize: 250 });
    expect(result).toMatchObject({ indexedHeight: 3000, blocksProcessed: 3001 });
    expect((await getIndexState(db)).status).toBe("ok");

    const model = new Map<string, { address: string | null; value: bigint; height: number; coinbase: boolean }>();
    const touched = new Map<string, Set<string>>();
    const touch = (address: string | null, txid: string) => {
      if (address) touched.set(address, (touched.get(address) ?? new Set()).add(txid));
    };
    let spends = 0;
    real.blocks.forEach((b64, height) => {
      for (const t of parseBlock(Buffer.from(b64, "base64")).transactions) {
        for (const input of t.inputs) {
          if (input.coinbase) continue;
          const key = `${input.prevTxid}:${input.prevVout}`;
          const prev = model.get(key);
          expect(prev, `unresolved ${key}`).toBeDefined();
          touch(prev!.address, t.txid);
          model.delete(key);
          spends += 1;
        }
        const cb = t.inputs.length === 1 && t.inputs[0].coinbase;
        for (const o of t.outputs) {
          const c = classifyScript(o.script);
          if (height !== 0) model.set(`${t.txid}:${o.index}`, { address: c.address, value: o.value, height, coinbase: cb });
          if (height !== 0) touch(c.address, t.txid);
        }
      }
    });
    expect(spends).toBeGreaterThan(300);

    const expected = new Map<string, { spendable: bigint; immature: bigint }>();
    for (const u of model.values()) {
      if (!u.address) continue;
      const e = expected.get(u.address) ?? { spendable: BigInt(0), immature: BigInt(0) };
      if (u.coinbase && 3000 - u.height + 1 < COINBASE_MATURITY) e.immature += u.value;
      else e.spendable += u.value;
      expected.set(u.address, e);
    }
    const rows = await db.query<{ address: string; spendable: string; immature: string }>(
      `SELECT address,
              COALESCE(SUM(value) FILTER (WHERE NOT is_coinbase OR 3000 - height + 1 >= 100), 0)::text AS spendable,
              COALESCE(SUM(value) FILTER (WHERE is_coinbase AND 3000 - height + 1 < 100), 0)::text AS immature
         FROM outputs WHERE address IS NOT NULL AND spent_height IS NULL AND spendable GROUP BY address`,
    );
    expect(rows.rows.length).toBe(expected.size);
    for (const row of rows.rows) {
      expect({ s: row.spendable, i: row.immature }).toEqual({
        s: expected.get(row.address)!.spendable.toString(),
        i: expected.get(row.address)!.immature.toString(),
      });
    }

    // Full summaries (balance + history) for a sample of addresses.
    for (const [address, txids] of [...touched.entries()].slice(0, 20)) {
      const s = await summary(address, 3000);
      expect(s.complete).toBe(true);
      expect(s.transactionCount).toBe(txids.size);
      expect(s.total).toBe((expected.get(address)?.spendable ?? BigInt(0)) + (expected.get(address)?.immature ?? BigInt(0)));
    }
  });

  it("marks the genesis output unspendable and excludes it from balances", async () => {
    await syncOnce(db, realChainSource(real, 3));
    const genesis = (await db.query<{ spendable: boolean; address: string | null }>(
      "SELECT spendable, address FROM outputs WHERE height = 0",
    )).rows;
    expect(genesis[0].spendable).toBe(false);
    if (genesis[0].address) expect((await summary(genesis[0].address, 3)).total).toBe(BigInt(0));
  });
});

describe("spend resolution and balances", () => {
  it("resolves cross-block and in-block spends, multiple outputs and change", async () => {
    const [A, B, C, D] = [1, 2, 3, 4];
    const b = new Builder();
    const cb0 = b.coinbase(9);
    const cb1 = b.add([buildTx(["coinbase"], [payTo(A, BigInt(50) * COIN)], 7001)]);
    // Block 2 spends A's coinbase: 30 to B, 19 change to A, 1 fee.
    const spend = buildTx([{ prevTxid: cb1.txids[0], vout: 0 }], [payTo(B, BigInt(30) * COIN), payTo(A, BigInt(19) * COIN)]);
    b.add([buildTx(["coinbase"], [payTo(9, COIN)], 7002), spend]);
    // Block 3: X spends B's output; Y spends X's output in the same block.
    const x = buildTx([{ prevTxid: txidOf(spend), vout: 0 }], [payTo(C, BigInt(29) * COIN)]);
    const y = buildTx([{ prevTxid: txidOf(x), vout: 0 }], [payTo(D, BigInt(28) * COIN), payTo(C, COIN)]);
    b.add([buildTx(["coinbase"], [payTo(9, COIN)], 7003), x, y]);
    await sync(b);
    void cb0;

    const a = await summary(addressOf(A), 3);
    expect(a).toMatchObject({ complete: true, spendable: BigInt(19) * COIN, immature: BigInt(0), totalReceived: BigInt(69) * COIN });
    expect(a.transactions.map((t) => [t.height, t.delta])).toEqual([
      [2, BigInt(-31) * COIN], // spent 50, received 19 change
      [1, BigInt(50) * COIN],
    ]);
    expect((await summary(addressOf(B), 3)).total).toBe(BigInt(0));
    expect((await summary(addressOf(C), 3)).total).toBe(COIN);
    expect((await summary(addressOf(D), 3)).total).toBe(BigInt(28) * COIN);
    // Every coin created is either unspent or recorded as spent exactly once.
    const open = await db.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM outputs WHERE spent_height IS NULL");
    expect(Number(open.rows[0].n)).toBe(6); // 9 outputs created, 3 spent
    const spent = await db.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM outputs WHERE spent_height IS NOT NULL");
    expect(Number(spent.rows[0].n)).toBe(3);
  });

  it("applies coinbase maturity exactly at 100 confirmations", async () => {
    const b = new Builder();
    b.coinbase(9);
    b.coinbase(5); // height 1
    for (let i = 2; i <= 100; i += 1) b.coinbase(9);
    const at = async (tip: number) => {
      await resetDb(db);
      await syncOnce(db, memorySource(() => ({ blocks: b.blocks.slice(0, tip + 1) })));
      return summary(addressOf(5), tip);
    };
    const fifty = BigInt(50) * COIN;
    // Height 1 has (tip - 1 + 1) confirmations: 99 at tip 99, 100 at tip 100.
    expect(await at(99)).toMatchObject({ immature: fifty, spendable: BigInt(0), total: fifty });
    expect(await at(100)).toMatchObject({ immature: BigInt(0), spendable: fifty, total: fifty });
  });

  it("halts on an input that spends an unknown output and never reports it complete", async () => {
    const b = new Builder();
    b.coinbase(1);
    b.add([buildTx(["coinbase"], [payTo(1, COIN)], 5), buildTx([{ prevTxid: "ab".repeat(32), vout: 0 }], [payTo(2, COIN)])]);
    await expect(sync(b, { batchSize: 1 })).rejects.toMatchObject({ name: "IndexerHaltError", reason: "unresolved-input" });
    const state = await getIndexState(db);
    expect(state).toMatchObject({ status: "halted", indexedHeight: 0 });
    const s = await summary(addressOf(1), 1);
    expect(s.complete).toBe(false);
    expect(s.incompleteReason).toMatch(/halted/);
    await expect(sync(b)).rejects.toMatchObject({ reason: "halted" });
    // With the default batch size a halt discards the whole uncommitted batch.
    await clearHalt(db);
    await resetDb(db);
    await expect(sync(b)).rejects.toMatchObject({ reason: "unresolved-input" });
    expect((await getIndexState(db)).indexedHeight).toBeNull();
    await clearHalt(db);
    expect((await getIndexState(db)).status).toBe("ok");
  });

  it("rejects double spends and spends of outputs created later in the same block", async () => {
    const b = new Builder();
    const cb = b.coinbase(1);
    const spend = (to: number) => buildTx([{ prevTxid: cb.txids[0], vout: 0 }], [payTo(to, COIN)]);
    b.add([buildTx(["coinbase"], [payTo(9, COIN)], 5), spend(2), spend(3)]);
    await expect(sync(b)).rejects.toMatchObject({ reason: "unresolved-input" });

    await resetDb(db);
    const c = new Builder();
    c.coinbase(1);
    const later = buildTx(["coinbase"], [payTo(1, COIN)], 77);
    const early = buildTx([{ prevTxid: txidOf(later), vout: 0 }], [payTo(2, COIN)]);
    c.add([buildTx(["coinbase"], [payTo(9, COIN)], 6), early, later]);
    await expect(sync(c)).rejects.toMatchObject({ reason: "unresolved-input" });
  });

  it("keeps satoshi amounts exact above 2^53", async () => {
    const big = BigInt("9007199254740993");
    const b = new Builder();
    b.coinbase(9); // the genesis block's output is unspendable and not counted
    b.coinbase(1, big);
    b.coinbase(1, big);
    await sync(b);
    const s = await summary(addressOf(1), 2);
    expect(s.totalReceived).toBe(big * BigInt(2));
    const stored = await db.query<{ value: string }>("SELECT value::text FROM outputs WHERE height = 1");
    expect(stored.rows[0].value).toBe("9007199254740993");
  });
});

describe("duplicate historical transaction IDs (BIP30)", () => {
  function duplicateChain(spendFirstCopy: boolean): { b: Builder; dup: Buffer } {
    const b = new Builder();
    b.coinbase(9);
    const dup = buildTx(["coinbase"], [payTo(1, BigInt(50) * COIN)], 4242);
    const first = b.add([dup]);
    if (spendFirstCopy) b.add([buildTx(["coinbase"], [payTo(9, COIN)], 11), buildTx([{ prevTxid: first.txids[0], vout: 0 }], [payTo(2, BigInt(49) * COIN)])]);
    else b.coinbase(9);
    b.add([dup]); // identical bytes, therefore identical txid
    return { b, dup };
  }

  it("stores both copies and resolves later spends to the newer, unspent copy", async () => {
    const { b, dup } = duplicateChain(true);
    const id = txidOf(dup);
    b.add([buildTx(["coinbase"], [payTo(9, COIN)], 12), buildTx([{ prevTxid: id, vout: 0 }], [payTo(3, BigInt(49) * COIN)])]);
    await sync(b);
    const rows = await db.query<{ height: number; spent_height: number | null }>(
      "SELECT height, spent_height FROM outputs WHERE txid = $1 ORDER BY height",
      [id],
    );
    expect(rows.rows).toEqual([{ height: 1, spent_height: 2 }, { height: 3, spent_height: 4 }]);
    const a = await summary(addressOf(1), 4);
    expect(a.totalReceived).toBe(BigInt(100) * COIN);
    expect(a.total).toBe(BigInt(0));
    expect(a.transactionCount).toBe(4); // two receipts, two spends, in different blocks
  });

  it("halts when a txid is reused while an earlier copy still has unspent outputs", async () => {
    const { b } = duplicateChain(false);
    await expect(sync(b, { batchSize: 1 })).rejects.toMatchObject({ reason: "duplicate-unspent-output" });
    expect((await getIndexState(db)).indexedHeight).toBe(2);
  });
});

describe("duplicate processing and interrupted scans", () => {
  function chainWithSpends(n: number): Builder {
    const b = new Builder();
    for (let h = 0; h < n; h += 1) {
      const txs = [buildTx(["coinbase"], [payTo((h % 4) + 1, BigInt(50) * COIN)], h)];
      if (h >= 2) txs.push(buildTx([{ prevTxid: b.blocks[h - 2].txids[0], vout: 0 }], [payTo(7, BigInt(49) * COIN)]));
      b.add(txs);
    }
    return b;
  }

  it("is idempotent when the same range is synced again", async () => {
    const b = chainWithSpends(12);
    await sync(b);
    const before = await dumpState(db);
    expect(await sync(b)).toMatchObject({ blocksProcessed: 0, indexedHeight: 11 });
    expect(await dumpState(db)).toBe(before);
  });

  it("refuses to apply an already-indexed block a second time and leaves state unchanged", async () => {
    const b = chainWithSpends(6);
    await sync(b);
    const before = await dumpState(db);
    await expect(
      db.transaction((tx) => applyBlock(tx, 3, b.blocks[3].hash, parseBlock(b.blocks[3].raw))),
    ).rejects.toThrow();
    expect(await dumpState(db)).toBe(before);
  });

  it("resumes from the last committed batch after a failure and ends identical to a clean run", async () => {
    const b = chainWithSpends(30);
    const clean = await freshDump(b);
    const flaky = memorySource(() => b, {
      beforeRaw: (_hash, calls) => {
        if (calls === 18) throw new Error("connection reset");
      },
    });
    await expect(syncOnce(db, flaky, { batchSize: 5 })).rejects.toThrow("connection reset");
    const mid = await getIndexState(db);
    expect(mid).toMatchObject({ status: "ok", indexedHeight: 14 }); // batches 0-14 committed, 15-19 rolled back
    expect(await syncOnce(db, memorySource(() => b), { batchSize: 5 })).toMatchObject({ indexedHeight: 29, blocksProcessed: 15 });
    expect(await dumpState(db)).toBe(clean);
  });

  it("supports bounded runs that resume exactly", async () => {
    const b = chainWithSpends(20);
    const clean = await freshDump(b);
    expect(await sync(b, { batchSize: 4, maxBlocks: 7 })).toMatchObject({ indexedHeight: 6, blocksProcessed: 7 });
    await sync(b, { batchSize: 4 });
    expect(await dumpState(db)).toBe(clean);
  });
});

describe("chain reorganisations", () => {
  // Block 2 creates an output for address 1; chain A spends it at height 7.
  function chainA(): Builder {
    const b = new Builder();
    b.coinbase(9);
    b.coinbase(9);
    const funding = b.add([buildTx(["coinbase"], [payTo(9, COIN)], 5), buildTx([{ prevTxid: b.blocks[1].txids[0], vout: 0 }], [payTo(1, BigInt(40) * COIN)])]);
    void funding;
    for (let h = 3; h <= 6; h += 1) b.coinbase(9);
    b.add([buildTx(["coinbase"], [payTo(9, COIN)], 77), buildTx([{ prevTxid: txidOfBlockTx(b, 2, 1), vout: 0 }], [payTo(5, BigInt(39) * COIN)])]);
    b.coinbase(9);
    b.coinbase(9);
    return b;
  }
  function txidOfBlockTx(b: Builder, height: number, index: number): string {
    return b.blocks[height].txids[index];
  }

  it("rolls back spends of outputs created before the fork and rebuilds the new branch", async () => {
    const a = chainA();
    await sync(a);
    expect((await summary(addressOf(1), 9)).total).toBe(BigInt(0));
    expect((await summary(addressOf(5), 9)).total).toBe(BigInt(39) * COIN);

    // Branch B forks after height 4, never spends the pre-fork output, and is longer.
    const bch = a.fork(4);
    for (let h = 5; h <= 10; h += 1) bch.coinbase(9, BigInt(50) * COIN, 900);
    const result = await sync(bch);
    expect(result).toMatchObject({ rolledBackBlocks: 5, indexedHeight: 10 });

    const restored = await summary(addressOf(1), 10);
    expect(restored.total).toBe(BigInt(40) * COIN); // unspent again
    expect(restored.transactionCount).toBe(1);
    expect((await summary(addressOf(5), 10)).totalReceived).toBe(BigInt(0));
    expect(await dumpState(db)).toBe(await freshDump(bch));
  });

  it("handles a new branch that spends the pre-fork output differently", async () => {
    const a = chainA();
    await sync(a);
    const bch = a.fork(4);
    bch.coinbase(9, BigInt(50) * COIN, 901);
    bch.add([buildTx(["coinbase"], [payTo(9, COIN)], 78), buildTx([{ prevTxid: txidOfBlockTx(a, 2, 1), vout: 0 }], [payTo(6, BigInt(38) * COIN)])]);
    expect(await sync(bch)).toMatchObject({ rolledBackBlocks: 5, indexedHeight: 6 });
    expect((await summary(addressOf(1), 6)).total).toBe(BigInt(0));
    expect((await summary(addressOf(6), 6)).total).toBe(BigInt(38) * COIN);
    expect((await summary(addressOf(5), 6)).total).toBe(BigInt(0));
    expect(await dumpState(db)).toBe(await freshDump(bch));
  });

  it("follows a shorter competing chain", async () => {
    const a = chainA();
    await sync(a);
    const shorter = a.fork(5);
    expect(await sync(shorter)).toMatchObject({ rolledBackBlocks: 4, indexedHeight: 5 });
    expect((await summary(addressOf(1), 5)).total).toBe(BigInt(40) * COIN);
    expect(await dumpState(db)).toBe(await freshDump(shorter));
  });

  it("recovers when the chain reorganises in the middle of a scan", async () => {
    const a = chainA();
    const bch = a.fork(3);
    for (let h = 4; h <= 9; h += 1) bch.coinbase(9, BigInt(50) * COIN, 902);
    let active = a;
    const source = memorySource(() => active, {
      beforeRaw: (_hash, calls) => {
        if (calls === 6) active = bch;
      },
    });
    await syncOnce(db, source, { batchSize: 4 });
    expect(await dumpState(db)).toBe(await freshDump(bch));
  });

  it("halts instead of silently rewriting history beyond the reorg depth limit", async () => {
    const a = chainA();
    await sync(a);
    const bch = a.fork(3);
    for (let h = 4; h <= 9; h += 1) bch.coinbase(9, BigInt(50) * COIN, 903);
    await expect(sync(bch, { maxReorgDepth: 2 })).rejects.toMatchObject({ reason: "reorg-too-deep" });
    expect((await getIndexState(db)).status).toBe("halted");
    expect((await getIndexState(db)).indexedHeight).toBe(9); // untouched
  });
});

describe("unrecognised scripts", () => {
  it("stores them explicitly without attributing them to any address", async () => {
    const key = Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 8)]);
    const p2pk = Buffer.concat([Buffer.from([33]), key, Buffer.from([0xac])]);
    const multisigKey = Buffer.concat([Buffer.from([33, 2]), Buffer.alloc(32, 4)]);
    const multisig = Buffer.concat([Buffer.from([0x51]), multisigKey, multisigKey, Buffer.from([0x52, 0xae])]);
    const opReturn = Buffer.from("6a28" + "11".repeat(40), "hex");
    const opTrue = Buffer.from([0x51]);
    const b = new Builder();
    b.coinbase(9); // height 0 is the unspendable genesis block
    const cb = b.add([
      buildTx(["coinbase"], [
        { value: COIN, script: p2pk },
        { value: COIN, script: multisig },
        { value: BigInt(0), script: opReturn },
        { value: COIN, script: opTrue },
      ], 1),
    ]);
    // Spending a nonstandard output must still resolve.
    b.add([buildTx(["coinbase"], [payTo(9, COIN)], 2), buildTx([{ prevTxid: cb.txids[0], vout: 3 }], [payTo(3, COIN)])]);
    await sync(b);

    const stats = await getIndexStats(db);
    expect(stats.outputsByType.pubkey).toEqual({ count: 1, value: COIN });
    expect(stats.outputsByType.multisig).toEqual({ count: 1, value: COIN });
    expect(stats.outputsByType.nonstandard.count).toBe(2);
    const unattributed = await db.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM outputs WHERE address IS NULL");
    expect(Number(unattributed.rows[0].n)).toBe(3);

    const pubkeyAddress = classifyScript(p2pk).address!;
    const s = await summary(pubkeyAddress, 2);
    expect(s.immature).toBe(COIN); // coinbase pay-to-pubkey counts toward the key's address
    expect(s.caveats[0]).toMatch(/Multisig/);
    expect((await summary(addressOf(3), 2)).total).toBe(COIN);
  });
});

describe("completeness reporting", () => {
  it("is incomplete when nothing is indexed or the index lags the node", async () => {
    expect(await summary(addressOf(1), 10)).toMatchObject({ complete: false, indexedHeight: null });
    const b = new Builder();
    for (let h = 0; h < 6; h += 1) b.coinbase(1);
    await sync(b);
    expect((await summary(addressOf(1), 5)).complete).toBe(true);
    expect((await summary(addressOf(1), 7)).complete).toBe(true); // within the default lag of 2
    const behind = await summary(addressOf(1), 9);
    expect(behind.complete).toBe(false);
    expect(behind.incompleteReason).toMatch(/index is at height 5 but the node is at 9/);
  });

  it("reports an unknown address with a complete, empty result only when the index is current", async () => {
    const b = new Builder();
    b.coinbase(1);
    await sync(b);
    const empty = await summary(addressOf(200), 0);
    expect(empty).toMatchObject({ complete: true, total: BigInt(0), transactionCount: 0, transactions: [] });
    expect((await summary(addressOf(200), 50)).complete).toBe(false);
  });
});

function txidOf(raw: Buffer): string {
  return buildBlock(ZERO, [raw], 0).txids[0];
}
void keyHash;
void p2pkh;
