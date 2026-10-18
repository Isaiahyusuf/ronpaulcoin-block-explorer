import { createHash } from "node:crypto";

export type ScriptType =
  | "pubkeyhash"
  | "scripthash"
  | "pubkey"
  | "multisig"
  | "nonstandard";

export interface ClassifiedScript {
  type: ScriptType;
  // Null when the script has no single owning address.
  address: string | null;
}

const PUBKEY_ADDRESS_VERSION = 60;
const SCRIPT_ADDRESS_VERSION = 3;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

export function hash160(data: Buffer): Buffer {
  return createHash("ripemd160").update(sha256(data)).digest();
}

export function base58Check(version: number, payload: Buffer): string {
  const body = Buffer.concat([Buffer.from([version]), payload]);
  const full = Buffer.concat([body, sha256(sha256(body)).subarray(0, 4)]);
  let value = BigInt(`0x${full.toString("hex")}`);
  const base = BigInt(58);
  const zero = BigInt(0);
  let encoded = "";
  while (value > zero) {
    encoded = ALPHABET[Number(value % base)] + encoded;
    value /= base;
  }
  for (const byte of full) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

type Token = { op: number; data: Buffer | null };

// Tokenises like the daemon's script parser, so that non-minimal pushes
// (OP_PUSHDATA1/2/4) match templates exactly as the node would match them.
function tokenize(script: Buffer): Token[] | null {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < script.length) {
    const op = script[pos];
    pos += 1;
    if (op > 0x4e) {
      tokens.push({ op, data: null });
      continue;
    }
    let length = op;
    if (op === 0x4c) {
      if (pos + 1 > script.length) return null;
      length = script[pos];
      pos += 1;
    } else if (op === 0x4d) {
      if (pos + 2 > script.length) return null;
      length = script.readUInt16LE(pos);
      pos += 2;
    } else if (op === 0x4e) {
      if (pos + 4 > script.length) return null;
      length = script.readUInt32LE(pos);
      pos += 4;
    }
    if (pos + length > script.length) return null;
    tokens.push({ op, data: script.subarray(pos, pos + length) });
    pos += length;
  }
  return tokens;
}

function pubkeyLength(header: number): number {
  if (header === 2 || header === 3) return 33;
  if (header === 4 || header === 6 || header === 7) return 65;
  return 0;
}

const OP_DUP = 0x76;
const OP_HASH160 = 0xa9;
const OP_EQUAL = 0x87;
const OP_EQUALVERIFY = 0x88;
const OP_CHECKSIG = 0xac;
const OP_CHECKMULTISIG = 0xae;

function isSmallInt(op: number): boolean {
  return op >= 0x51 && op <= 0x60;
}

export function classifyScript(script: Buffer): ClassifiedScript {
  const nonstandard: ClassifiedScript = { type: "nonstandard", address: null };

  if (script.length === 23 && script[0] === OP_HASH160 && script[1] === 0x14 && script[22] === OP_EQUAL) {
    return { type: "scripthash", address: base58Check(SCRIPT_ADDRESS_VERSION, script.subarray(2, 22)) };
  }

  const tokens = tokenize(script);
  if (!tokens) return nonstandard;

  if (
    tokens.length === 5 &&
    tokens[0].op === OP_DUP &&
    tokens[1].op === OP_HASH160 &&
    tokens[2].data?.length === 20 &&
    tokens[3].op === OP_EQUALVERIFY &&
    tokens[4].op === OP_CHECKSIG
  ) {
    return { type: "pubkeyhash", address: base58Check(PUBKEY_ADDRESS_VERSION, tokens[2].data) };
  }

  if (tokens.length === 2 && tokens[1].op === OP_CHECKSIG && tokens[0].data) {
    const key = tokens[0].data;
    if (key.length >= 33 && key.length <= 120) {
      // The daemon only derives an address from a structurally valid key.
      if (pubkeyLength(key[0]) === key.length) {
        return { type: "pubkey", address: base58Check(PUBKEY_ADDRESS_VERSION, hash160(key)) };
      }
      return nonstandard;
    }
    return nonstandard;
  }

  if (
    tokens.length >= 4 &&
    isSmallInt(tokens[0].op) &&
    isSmallInt(tokens[tokens.length - 2].op) &&
    tokens[tokens.length - 1].op === OP_CHECKMULTISIG
  ) {
    const m = tokens[0].op - 0x50;
    const n = tokens[tokens.length - 2].op - 0x50;
    const keys = tokens.slice(1, -2);
    if (
      m <= n &&
      keys.length === n &&
      keys.every((key) => key.data && key.data.length >= 33 && key.data.length <= 120)
    ) {
      return { type: "multisig", address: null };
    }
  }

  return nonstandard;
}
