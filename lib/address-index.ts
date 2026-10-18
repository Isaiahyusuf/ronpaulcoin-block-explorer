import { Pool } from "pg";
import { getAddressSummary, type AddressSummary } from "@/indexer/queries.ts";
import { getBlockHashAt, getBlockchainInfo } from "@/lib/rpc";

export const PAGE_SIZE = 50;

export type IndexedAddressResult =
  | { status: "not-configured" }
  | { status: "unavailable"; message: string }
  | { status: "ok"; summary: AddressSummary };

let pool: Pool | null = null;

function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 3, statement_timeout: 15_000, connectionTimeoutMillis: 5_000 });
    // A dropped idle connection must not crash the server process.
    pool.on("error", () => undefined);
  }
  return pool;
}

export function formatSatoshis(value: bigint): string {
  const unit = BigInt(100_000_000);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = (abs / unit).toString();
  const fraction = (abs % unit).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export async function lookupIndexedAddress(address: string, page: number): Promise<IndexedAddressResult> {
  const db = getPool();
  if (!db) return { status: "not-configured" };

  const info = await getBlockchainInfo();
  if (info.status !== "online") {
    return { status: "unavailable", message: "The node could not be reached, so the index cannot be confirmed current." };
  }

  const client = await db.connect().catch(() => null);
  if (!client) return { status: "unavailable", message: "The address index database could not be reached." };
  try {
    // One read-only snapshot so balance and history come from the same height.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // Parallel aggregation over the busiest address is pathologically slow; serial is fast.
    await client.query("SET LOCAL max_parallel_workers_per_gather = 0");
    const summary = await getAddressSummary(
      {
        async query<T>(sql: string, params?: unknown[]) {
          const result = await client.query(sql, params);
          return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
        },
      },
      address,
      {
        nodeHeight: info.info.blocks,
        nodeBlockHash: async (height) => {
          const hash = await getBlockHashAt(height);
          if (!hash) throw new Error("Node hash unavailable.");
          return hash;
        },
        limit: PAGE_SIZE,
        offset: Math.max(0, page - 1) * PAGE_SIZE,
      },
    );
    await client.query("COMMIT");
    return { status: "ok", summary };
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return { status: "unavailable", message: "The address index could not be queried." };
  } finally {
    client.release();
  }
}
