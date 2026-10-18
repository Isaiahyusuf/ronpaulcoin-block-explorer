import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { pgDb } from "../../indexer/db.ts";

class FakeClient extends EventEmitter {
  released: (boolean | undefined)[] = [];
  constructor(private readonly failUnlock = false) {
    super();
  }
  async query(sql: string) {
    if (this.failUnlock && sql.includes("pg_advisory_unlock")) throw new Error("connection lost");
    return { rows: [{ locked: true }], rowCount: 1 };
  }
  release(destroy?: boolean) {
    this.released.push(destroy);
  }
}

function poolOf(client: FakeClient) {
  return { query: client.query.bind(client), connect: async () => client, end: async () => undefined };
}

describe("pgDb exclusive lock listeners", () => {
  it("removes its own error listener and keeps listeners owned by others", async () => {
    const client = new FakeClient();
    const poolOwned = () => undefined;
    client.on("error", poolOwned);
    const db = pgDb(poolOf(client) as never);

    for (let i = 0; i < 12; i += 1) {
      await db.withExclusiveLock(1, async () => {
        expect(client.listenerCount("error")).toBe(2);
        return i;
      });
    }
    expect(client.listeners("error")).toEqual([poolOwned]);
    expect(client.released).toHaveLength(12);
  });

  it("removes the listener and destroys the connection when unlock fails or work throws", async () => {
    const client = new FakeClient(true);
    const db = pgDb(poolOf(client) as never);
    await expect(
      db.withExclusiveLock(1, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(client.listenerCount("error")).toBe(0);
    expect(client.released).toEqual([true]);
  });
});
