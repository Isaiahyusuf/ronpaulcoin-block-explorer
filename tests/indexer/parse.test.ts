import { describe, expect, it } from "vitest";
import real from "../fixtures/real-chain.json";
import { computeMerkleRoot, parseBlock } from "../../indexer/parse.ts";
import { buildBlock, buildTx, payTo, ZERO } from "./helpers.ts";

const raw = (height: number) => Buffer.from(real.blocks[height], "base64");

describe("block parsing", () => {
  it("parses real blocks exactly and reproduces each header's merkle root", () => {
    let spends = 0;
    for (let h = 0; h < real.blocks.length; h += 1) {
      const block = parseBlock(raw(h));
      expect(computeMerkleRoot(block.transactions.map((t) => t.txid))).toBe(block.merkleRoot);
      spends += block.transactions.flatMap((t) => t.inputs).filter((i) => !i.coinbase).length;
    }
    expect(spends).toBeGreaterThan(0);
  });

  it("links real blocks by previous hash and identifies the genesis block", () => {
    expect(parseBlock(raw(0)).prevHash).toBe(ZERO);
    expect(parseBlock(raw(1)).prevHash).toBe(real.hashes[0]);
    expect(parseBlock(raw(3000)).prevHash).toBe(real.hashes[2999]);
    expect(real.hashes[0]).toBe("12e05e8d4a8258aed79e113ee429c5194ee1c8999f50df176ecea97380d474ab");
    expect(parseBlock(raw(0)).transactions[0].txid).toBe(
      "242fa5d7cc0bb344d707c4282ed8cbafa049153c1e2052258115e58a1a00dca1",
    );
  });

  it("flags only null-prevout inputs as coinbase", () => {
    const block = parseBlock(raw(3000));
    expect(block.transactions[0].inputs[0].coinbase).toBe(true);
    for (const t of block.transactions.slice(1)) expect(t.inputs.every((i) => !i.coinbase)).toBe(true);
  });

  it("keeps amounts as exact integers above 2^53", () => {
    const big = BigInt("9007199254740993");
    const built = buildBlock(ZERO, [buildTx(["coinbase"], [payTo(1, big)])], 1);
    expect(parseBlock(built.raw).transactions[0].outputs[0].value).toBe(big);
  });

  it("rejects trailing bytes and truncated data", () => {
    expect(() => parseBlock(Buffer.concat([raw(5), Buffer.from([0])]))).toThrow(/trailing/);
    expect(() => parseBlock(raw(5).subarray(0, raw(5).length - 3))).toThrow();
  });
});
