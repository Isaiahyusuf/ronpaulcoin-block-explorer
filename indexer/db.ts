export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export type LockResult<T> = { acquired: true; value: T } | { acquired: false };

export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  // Runs `work` while holding a database-wide exclusive lock identified by `key`,
  // or returns { acquired: false } immediately if another holder has it. Every
  // statement `work` issues goes through the Db it is given, which is bound to
  // the connection that owns the lock. The lock is released when `work` ends or
  // the connection is lost.
  withExclusiveLock<T>(key: number, work: (db: Db) => Promise<T>): Promise<LockResult<T>>;
  close(): Promise<void>;
}

interface PgliteLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(work: (tx: PgliteLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrapPglite(client: PgliteLike): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  };
}

// PGlite is a single in-process connection, so a database advisory lock cannot
// distinguish two workers sharing it. The lock is a process-local flag instead:
// enough to exercise the contract in tests, not a substitute for the Postgres lock.
const pgliteLocks = new WeakMap<object, Set<number>>();

export function pgliteDb(client: PgliteLike): Db {
  const db: Db = {
    ...wrapPglite(client),
    exec: async (sql) => {
      await client.exec(sql);
    },
    transaction: (work) => client.transaction((tx) => work(wrapPglite(tx))),
    async withExclusiveLock(key, work) {
      let held = pgliteLocks.get(client);
      if (!held) pgliteLocks.set(client, (held = new Set()));
      if (held.has(key)) return { acquired: false };
      held.add(key);
      try {
        return { acquired: true, value: await work(db) };
      } finally {
        held.delete(key);
      }
    },
    close: () => client.close(),
  };
  return db;
}

interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  // Passing a truthy value destroys the connection instead of returning it to the pool.
  release(destroy?: boolean): void;
  on?(event: "error", listener: (error: Error) => void): unknown;
  removeListener?(event: "error", listener: (error: Error) => void): unknown;
}

interface PgPoolLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
  on?(event: "error", listener: (error: Error) => void): unknown;
}

function wrapPg(client: Pick<PgClientLike, "query">): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
  };
}

// A Db bound to one connection: the one holding the advisory lock.
function pgClientDb(client: PgClientLike): Db {
  return {
    ...wrapPg(client),
    exec: async (sql) => {
      await client.query(sql);
    },
    async transaction(work) {
      await client.query("BEGIN");
      try {
        const result = await work(wrapPg(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    },
    withExclusiveLock: () => {
      throw new Error("The exclusive lock is already held on this connection.");
    },
    close: async () => undefined,
  };
}

export function pgDb(pool: PgPoolLike): Db {
  return {
    ...wrapPg(pool),
    exec: async (sql) => {
      await pool.query(sql);
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(wrapPg(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    // A session-level advisory lock belongs to one connection, so all work runs
    // on that same connection. If the connection drops, Postgres frees the lock
    // and the work fails with it.
    async withExclusiveLock(key, work) {
      const client = await pool.connect();
      // A dropped connection must fail the running query, not crash the process
      // through an unhandled 'error' event on a checked-out client.
      const onError = (): void => undefined;
      client.on?.("error", onError);
      let locked = false;
      let unlockFailed = false;
      try {
        const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [key]);
        locked = (result.rows[0] as { locked: boolean }).locked === true;
        if (!locked) return { acquired: false };
        return { acquired: true, value: await work(pgClientDb(client)) };
      } finally {
        if (locked) {
          await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {
            unlockFailed = true;
          });
        }
        // Removes only our own listener; pg-pool's idle listener is untouched.
        client.removeListener?.("error", onError);
        // Closing the connection is what guarantees the lock is gone.
        client.release(unlockFailed);
      }
    },
    close: () => pool.end(),
  };
}
