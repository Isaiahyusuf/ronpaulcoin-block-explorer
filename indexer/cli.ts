// Usage: node --experimental-strip-types indexer/cli.ts
// Env: RPC_URL, RPC_USERNAME, RPC_PASSWORD, DATABASE_URL, optional POLL_SECONDS, THROTTLE_MS, MAX_BLOCKS.
import { pgDb } from "./db.ts";
import { IndexerHaltError, getIndexState, syncOnce } from "./indexer.ts";
import { migrate } from "./schema.ts";
import { createRpcSource } from "./source.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}.`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: required("DATABASE_URL"), max: 2 });
  // Idle connections can be dropped by the server; that must not crash the worker.
  pool.on("error", (error) => console.error(`database connection error: ${error.message}`));
  const db = pgDb(pool as never);
  const source = createRpcSource({
    url: required("RPC_URL"),
    username: process.env.RPC_USERNAME,
    password: process.env.RPC_PASSWORD,
    throttleMs: Number(process.env.THROTTLE_MS ?? 0),
  });
  const pollMs = Number(process.env.POLL_SECONDS ?? 30) * 1000;
  const maxBlocks = process.env.MAX_BLOCKS ? Number(process.env.MAX_BLOCKS) : undefined;

  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      // A killed mid-batch run is safe: uncommitted batches roll back and resume.
      console.log(`${signal} received; stopping after the current sync pass.`);
      stopping = true;
    });
  }

  await migrate(db);
  while (!stopping) {
    try {
      const result = await syncOnce(db, source, {
        maxBlocks,
        onProgress: (height) => {
          if (height % 1000 === 0) console.log(`indexed height ${height}`);
        },
      });
      if (result.status === "indexer-already-running") {
        // Another worker owns the write lock; stay on standby and retry.
        console.log("indexer-already-running: another worker holds the lock.");
      } else {
        console.log(
          `synced to ${result.indexedHeight}/${result.tipHeight} (+${result.blocksProcessed}, rolled back ${result.rolledBackBlocks})`,
        );
      }
    } catch (error) {
      if (error instanceof IndexerHaltError) {
        const state = await getIndexState(db);
        console.error(`HALTED: ${error.reason} - ${error.message} (state=${state.status}). Manual action required.`);
        break;
      }
      console.error(`sync failed, will retry: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    if (maxBlocks !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
