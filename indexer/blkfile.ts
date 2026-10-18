import fs from "node:fs";
import path from "node:path";
import { sha256d } from "../lib/rawblock.ts";
import type { BlockSource } from "./source.ts";

const MAGIC = Buffer.from("fbc0b6db", "hex");

// Read-only source over the daemon's blk*.dat files. Valid only for a chain whose
// file order equals height order (verified for this chain: no orphans or reordering).
export function createBlkFileSource(dir: string, tipHeight: number): BlockSource {
  const files = fs.readdirSync(dir).filter((f) => /^blk\d{5}\.dat$/.test(f)).sort();
  const hashes: string[] = [];
  const location = new Map<string, { file: string; offset: number; size: number }>();

  for (const name of files) {
    if (hashes.length > tipHeight) break;
    const file = path.join(dir, name);
    const data = fs.readFileSync(file);
    let pos = 0;
    while (pos + 8 <= data.length && hashes.length <= tipHeight) {
      if (!data.subarray(pos, pos + 4).equals(MAGIC)) break; // zero padding at the end of the file
      const size = data.readUInt32LE(pos + 4);
      if (pos + 8 + size > data.length) break;
      const hash = Buffer.from(sha256d(data.subarray(pos + 8, pos + 88))).reverse().toString("hex");
      location.set(hash, { file, offset: pos + 8, size });
      hashes.push(hash);
      pos += 8 + size;
    }
  }
  if (hashes.length <= tipHeight) throw new Error(`Block files contain only ${hashes.length} blocks.`);

  let openPath = "";
  let fd = -1;
  return {
    async getTip() {
      return { height: tipHeight, hash: hashes[tipHeight] };
    },
    async getBlockHash(height) {
      const hash = hashes[height];
      if (!hash) throw new Error(`No block at height ${height}.`);
      return hash;
    },
    async getBlockRaw(hash) {
      const at = location.get(hash);
      if (!at) throw new Error("Unknown block.");
      if (openPath !== at.file) {
        if (fd >= 0) fs.closeSync(fd);
        fd = fs.openSync(at.file, "r");
        openPath = at.file;
      }
      const out = Buffer.alloc(at.size);
      fs.readSync(fd, out, 0, at.size, at.offset);
      return out;
    },
  };
}
