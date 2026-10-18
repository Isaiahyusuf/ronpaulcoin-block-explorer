import { createHash } from "node:crypto";

export interface RawBlockTransaction {
  txid: string;
  hex: string;
}

export function sha256d(data: Buffer): Buffer {
  return createHash("sha256")
    .update(createHash("sha256").update(data).digest())
    .digest();
}

export class Reader {
  offset = 0;
  readonly bytes: Buffer;
  constructor(bytes: Buffer) {
    this.bytes = bytes;
  }

  read(length: number): Buffer {
    const start = this.offset;
    this.skip(length);
    return this.bytes.subarray(start, start + length);
  }

  skip(length: number): void {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("Unexpected end of block data.");
    }
    this.offset += length;
  }

  varInt(): number {
    const start = this.offset;
    this.skip(1);
    const first = this.bytes[start];
    if (first < 0xfd) return first;
    const size = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
    this.skip(size);
    const padded = Buffer.alloc(8);
    this.bytes.copy(padded, 0, start + 1, start + 1 + size);
    const value = padded.readBigUInt64LE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Block data contains an oversized length.");
    }
    return Number(value);
  }
}

// Splits a serialized pre-segwit block (80-byte header, then transactions)
// into transactions and computes each transaction ID from its raw bytes.
export function parseBlockTransactions(blockHex: string): RawBlockTransaction[] {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(blockHex)) {
    throw new Error("Block data is not valid hexadecimal.");
  }
  const bytes = Buffer.from(blockHex, "hex");
  const reader = new Reader(bytes);
  reader.skip(80);
  const count = reader.varInt();
  const transactions: RawBlockTransaction[] = [];

  for (let index = 0; index < count; index += 1) {
    const start = reader.offset;
    reader.skip(4);
    const inputs = reader.varInt();
    for (let input = 0; input < inputs; input += 1) {
      reader.skip(36);
      reader.skip(reader.varInt());
      reader.skip(4);
    }
    const outputs = reader.varInt();
    for (let output = 0; output < outputs; output += 1) {
      reader.skip(8);
      reader.skip(reader.varInt());
    }
    reader.skip(4);
    const raw = bytes.subarray(start, reader.offset);
    transactions.push({
      txid: Buffer.from(sha256d(raw)).reverse().toString("hex"),
      hex: raw.toString("hex"),
    });
  }

  return transactions;
}
