import { describe, expect, it } from "vitest";
import fixture from "../fixtures/daemon-scripts.json";
import { base58Check, classifyScript, hash160 } from "../../indexer/script.ts";

describe("address derivation against the daemon", () => {
  // Each entry is a real output script with the type and addresses reported
  // by the daemon's own decoderawtransaction.
  it("matches the daemon type and address for every sampled real output", () => {
    const seen = new Set<string>();
    for (const entry of fixture as { script: string; type: string; addresses: string[] }[]) {
      const result = classifyScript(Buffer.from(entry.script, "hex"));
      expect(result.type).toBe(entry.type);
      if (entry.addresses.length === 1) expect(result.address).toBe(entry.addresses[0]);
      else expect(result.address).toBeNull();
      seen.add(entry.type);
    }
    expect([...seen].sort()).toEqual(["nonstandard", "pubkey", "pubkeyhash", "scripthash"]);
    expect((fixture as unknown[]).length).toBeGreaterThan(300);
  });

  it("derives R-prefixed pay-to-pubkey-hash and 3-version script-hash addresses", () => {
    const h = Buffer.alloc(20, 7);
    const p2pkh = Buffer.concat([Buffer.from("76a914", "hex"), h, Buffer.from("88ac", "hex")]);
    expect(classifyScript(p2pkh).address).toBe(base58Check(60, h));
    expect(classifyScript(p2pkh).address?.startsWith("R")).toBe(true);
    const p2sh = Buffer.concat([Buffer.from("a914", "hex"), h, Buffer.from("87", "hex")]);
    expect(classifyScript(p2sh)).toEqual({ type: "scripthash", address: base58Check(3, h) });
  });

  it("maps pay-to-pubkey to the key's pubkey-hash address", () => {
    const key = Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 9)]);
    const script = Buffer.concat([Buffer.from([33]), key, Buffer.from([0xac])]);
    expect(classifyScript(script)).toEqual({ type: "pubkey", address: base58Check(60, hash160(key)) });
  });

  it("matches non-minimal pushes the way the daemon template matcher does", () => {
    const h = Buffer.alloc(20, 5);
    const pushdata1 = Buffer.concat([Buffer.from("76a94c14", "hex"), h, Buffer.from("88ac", "hex")]);
    expect(classifyScript(pushdata1).type).toBe("pubkeyhash");
  });

  it("never invents an address for unrecognised scripts", () => {
    const cases = [
      Buffer.from("6a28" + "00".repeat(40), "hex"), // OP_RETURN data
      Buffer.from("51", "hex"), // bare OP_TRUE
      Buffer.alloc(0),
      Buffer.from("76a914", "hex"), // truncated
      Buffer.concat([Buffer.from([33, 5]), Buffer.alloc(32, 1), Buffer.from([0xac])]), // invalid pubkey header
    ];
    for (const script of cases) expect(classifyScript(script)).toEqual({ type: "nonstandard", address: null });
  });

  it("recognises multisig but attributes it to no single address", () => {
    const key = Buffer.concat([Buffer.from([33, 2]), Buffer.alloc(32, 3)]);
    const script = Buffer.concat([Buffer.from([0x51]), key, key, Buffer.from([0x52, 0xae])]);
    expect(classifyScript(script)).toEqual({ type: "multisig", address: null });
  });
});
