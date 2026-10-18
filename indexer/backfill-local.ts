// Local-only backfill from the daemon's block files into a Postgres database.
// Usage: DATABASE_URL=... BLOCKS_DIR=.../blocks TIP_HEIGHT=2221495 node --experimental-strip-types indexer/backfill-local.ts
import { createBlkFileSource } from "./blkfile.ts";
import { pgDb } from "./db.ts";
import { getIndexState, syncOnce } from "./indexer.ts";
import { migrate } from "./schema.ts";

const url = process.env.DATABASE_URL;
const dir = process.env.BLOCKS_DIR;
const tip = Number(process.env.TIP_HEIGHT);
if (!url || !dir || !Number.isSafeInteger(tip)) {
  console.error("Set DATABASE_URL, BLOCKS_DIR and TIP_HEIGHT.");
  process.exit(2);
}

const { Pool } = await import("pg");
const db = pgDb(new Pool({ connectionString: url, max: 2 }) as never);
await migrate(db);
const started = Date.now();
console.log("indexing block files…");
const source = createBlkFileSource(dir, tip);
console.log(`block files catalogued in ${((Date.now() - started) / 1000).toFixed(0)}s`);
const result = await syncOnce(db, source, {
  batchSize: 500,
  onProgress: (h) => {
    if (h % 50_000 < 500) console.log(`height ${h} (${((Date.now() - started) / 60000).toFixed(1)} min)`);
  },
});
console.log(JSON.stringify({ ...result, state: await getIndexState(db), minutes: +((Date.now() - started) / 60000).toFixed(1) }));
await db.close();
