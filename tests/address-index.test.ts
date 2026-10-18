import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { formatSatoshis, lookupIndexedAddress } from "@/lib/address-index";

describe("formatSatoshis", () => {
  it("keeps exact integer precision", () => {
    expect(formatSatoshis(BigInt(0))).toBe("0.00000000");
    expect(formatSatoshis(BigInt(1))).toBe("0.00000001");
    expect(formatSatoshis(BigInt("160657292169891"))).toBe("1606572.92169891");
    expect(formatSatoshis(BigInt("9007199254740993"))).toBe("90071992.54740993");
    expect(formatSatoshis(BigInt(-150000000))).toBe("-1.50000000");
  });
});

describe("lookupIndexedAddress", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reports not-configured without a database, never an empty result", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await lookupIndexedAddress("R".padEnd(34, "x"), 1)).toEqual({ status: "not-configured" });
  });
});
