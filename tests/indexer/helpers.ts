import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgliteDb, type Db } from "../../indexer/db.ts";
import { migrate } from "../../indexer/schema.ts";
import { base58Check, hash160 } from "../../indexer/script.ts";
import type { BlockSource } from "../../indexer/source.ts";
import { sha256d } from "../../lib/rawblock.ts";

export async function createTestDb(): Promise<Db> {
  const db = pgliteDb(new PGlite() as never);
  await migrate(db);
  return db;
}

export async function resetDb(db: Db): Promise<void> {
  await db.exec("TRUNCATE blocks CASCADE; UPDATE indexer_state SET status = 'ok', halted_reason = NULL;");
}

// Order-stable snapshot of everything the index stores, for equality checks.
export async function dumpState(db: Db): Promise<string> {
  const blocks = await db.query("SELECT height, hash, prev_hash, time::text, tx_count FROM blocks ORDER BY height");
  const txs = await db.query("SELECT height, tx_index, txid FROM transactions ORDER BY height, tx_index");
  const outs = await db.query(
    `SELECT height, tx_index, vout, txid, address, script_type, value::text, is_coinbase, spendable,
            spent_height, spent_tx_index, spent_vin, spent_txid
       FROM outputs ORDER BY height, tx_index, vout`,
  );
  return JSON.stringify([blocks.rows, txs.rows, outs.rows]);
}

// ---- Raw block construction using the daemon's serialization ----

export interface TxOutSpec {
  value: bigint;
  script: Buffer;
}

export type TxInSpec = { prevTxid: string; vout: number } | "coinbase";

function varInt(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  const b = Buffer.alloc(3);
  b[0] = 0xfd;
  b.writeUInt16LE(n, 1);
  return b;
}

export function buildTx(inputs: TxInSpec[], outputs: TxOutSpec[], marker = 0): Buffer {
  const parts: Buffer[] = [Buffer.from("01000000", "hex"), varInt(inputs.length)];
  for (const input of inputs) {
    if (input === "coinbase") {
      const sig = Buffer.from([0x04, marker & 0xff, (marker >> 8) & 0xff, (marker >> 16) & 0xff, 0x01]);
      parts.push(Buffer.alloc(32), Buffer.from("ffffffff", "hex"), varInt(sig.length), sig);
    } else {
      const vout = Buffer.alloc(4);
      vout.writeUInt32LE(input.vout);
      parts.push(Buffer.from(input.prevTxid, "hex").reverse(), vout, varInt(1), Buffer.from([0x51]));
    }
    parts.push(Buffer.from("ffffffff", "hex"));
  }
  parts.push(varInt(outputs.length));
  for (const output of outputs) {
    const value = Buffer.alloc(8);
    value.writeBigUInt64LE(output.value);
    parts.push(value, varInt(output.script.length), output.script);
  }
  parts.push(Buffer.alloc(4));
  return Buffer.concat(parts);
}

export function txidOf(raw: Buffer): string {
  return Buffer.from(sha256d(raw)).reverse().toString("hex");
}

export interface BuiltBlock {
  raw: Buffer;
  hash: string;
  txids: string[];
}

export function buildBlock(prevHash: string, txs: Buffer[], time: number, salt = 0): BuiltBlock {
  const txids = txs.map(txidOf);
  let level: Buffer[] = txids.map((id) => Buffer.from(id, "hex").reverse());
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256d(Buffer.concat([level[i], level[i + 1] ?? level[i]])));
    level = next;
  }
  const header = Buffer.alloc(80);
  header.writeInt32LE(2, 0);
  Buffer.from(prevHash, "hex").reverse().copy(header, 4);
  level[0].copy(header, 36);
  header.writeUInt32LE(time, 68);
  header.writeUInt32LE(0x1e0fffff, 72);
  header.writeUInt32LE(salt, 76);
  const hash = Buffer.from(sha256d(header)).reverse().toString("hex");
  return { raw: Buffer.concat([header, varInt(txs.length), ...txs]), hash, txids };
}

export const ZERO = "0".repeat(64);

export function keyHash(seed: number): Buffer {
  return hash160(Buffer.from([seed, seed >> 8, 7]));
}
export function p2pkh(h: Buffer): Buffer {
  return Buffer.concat([Buffer.from("76a914", "hex"), h, Buffer.from("88ac", "hex")]);
}
export function addressOf(seed: number): string {
  return base58Check(60, keyHash(seed));
}
export function payTo(seed: number, value: bigint): TxOutSpec {
  return { value, script: p2pkh(keyHash(seed)) };
}

export interface MemChain {
  blocks: BuiltBlock[];
}

export function memorySource(chain: () => MemChain, hooks: { beforeRaw?: (hash: string, calls: number) => void } = {}): BlockSource & { calls: number } {
  // Like a real node, keep serving blocks that were once on an earlier branch.
  const known = new Map<string, BuiltBlock>();
  const remember = () => {
    for (const block of chain().blocks) known.set(block.hash, block);
  };
  const source = {
    calls: 0,
    async getTip() {
      remember();
      const blocks = chain().blocks;
      return { height: blocks.length - 1, hash: blocks[blocks.length - 1].hash };
    },
    async getBlockHash(height: number) {
      remember();
      const block = chain().blocks[height];
      if (!block) throw new Error(`no block at ${height}`);
      return block.hash;
    },
    async getBlockRaw(hash: string) {
      source.calls += 1;
      hooks.beforeRaw?.(hash, source.calls);
      const found = known.get(hash);
      if (!found) throw new Error("unknown block");
      return found.raw;
    },
  };
  return source;
}

export function realChainSource(fixture: { hashes: string[]; blocks: string[] }, upTo = fixture.hashes.length - 1): BlockSource {
  return {
    async getTip() {
      return { height: upTo, hash: fixture.hashes[upTo] };
    },
    async getBlockHash(height) {
      return fixture.hashes[height];
    },
    async getBlockRaw(hash) {
      return Buffer.from(fixture.blocks[fixture.hashes.indexOf(hash)], "base64");
    },
  };
}

export const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
