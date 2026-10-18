import { Reader, sha256d } from "../lib/rawblock.ts";

export interface ParsedInput {
  prevTxid: string;
  prevVout: number;
  coinbase: boolean;
}

export interface ParsedOutput {
  index: number;
  value: bigint;
  script: Buffer;
}

export interface ParsedTransaction {
  txid: string;
  inputs: ParsedInput[];
  outputs: ParsedOutput[];
}

export interface ParsedBlock {
  version: number;
  prevHash: string;
  merkleRoot: string;
  time: number;
  bits: number;
  nonce: number;
  transactions: ParsedTransaction[];
}

const MAX_SATOSHIS = BigInt("9223372036854775807");

function hashHex(bytes: Buffer): string {
  return Buffer.from(bytes).reverse().toString("hex");
}

// Standard Bitcoin 0.8 serialization, as used by this daemon: an 80-byte header
// (no block signature), then transactions with no per-transaction timestamp.
// Throws unless the whole buffer is consumed exactly.
export function parseBlock(raw: Buffer): ParsedBlock {
  const reader = new Reader(raw);
  const version = reader.read(4).readInt32LE(0);
  const prevHash = hashHex(reader.read(32));
  const merkleRoot = hashHex(reader.read(32));
  const time = reader.read(4).readUInt32LE(0);
  const bits = reader.read(4).readUInt32LE(0);
  const nonce = reader.read(4).readUInt32LE(0);

  const count = reader.varInt();
  const transactions: ParsedTransaction[] = [];
  for (let t = 0; t < count; t += 1) {
    const start = reader.offset;
    reader.skip(4);
    const inputs: ParsedInput[] = [];
    const inputCount = reader.varInt();
    for (let i = 0; i < inputCount; i += 1) {
      const prev = reader.read(32);
      const vout = reader.read(4).readUInt32LE(0);
      reader.skip(reader.varInt());
      reader.skip(4);
      const isNull = prev.every((byte) => byte === 0) && vout === 0xffffffff;
      inputs.push({
        prevTxid: hashHex(prev),
        prevVout: vout,
        coinbase: isNull,
      });
    }
    const outputs: ParsedOutput[] = [];
    const outputCount = reader.varInt();
    for (let o = 0; o < outputCount; o += 1) {
      const value = reader.read(8).readBigUInt64LE(0);
      if (value > MAX_SATOSHIS) throw new Error("Output value out of range.");
      outputs.push({ index: o, value, script: Buffer.from(reader.read(reader.varInt())) });
    }
    reader.skip(4);
    transactions.push({
      txid: hashHex(sha256d(raw.subarray(start, reader.offset))),
      inputs,
      outputs,
    });
  }

  if (reader.offset !== raw.length) {
    throw new Error("Block has trailing bytes after the last transaction.");
  }
  return { version, prevHash, merkleRoot, time, bits, nonce, transactions };
}

export function computeMerkleRoot(txids: string[]): string {
  if (txids.length === 0) throw new Error("A block has no transactions.");
  let level: Buffer[] = txids.map((id) => Buffer.from(id, "hex").reverse());
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1] ?? level[i];
      next.push(sha256d(Buffer.concat([level[i], right])));
    }
    level = next;
  }
  return hashHex(level[0]);
}
