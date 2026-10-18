import type { BlockSource } from "../../indexer/source.ts";

// Wraps a source so the nth call of one method pauses until released. Lets a test
// freeze a worker at a known point (mid-batch, mid fork detection) deterministically.
export function gatedSource(
  source: BlockSource,
  method: "getBlockRaw" | "getBlockHash",
  pauseOnCall: number,
) {
  let release!: () => void;
  let entered!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  const hasEntered = new Promise<void>((resolve) => (entered = resolve));
  let calls = 0;
  const wrapped: BlockSource = {
    getTip: () => source.getTip(),
    async getBlockHash(height) {
      if (method === "getBlockHash" && ++calls === pauseOnCall) {
        entered();
        await open;
      }
      return source.getBlockHash(height);
    },
    async getBlockRaw(hash) {
      if (method === "getBlockRaw" && ++calls === pauseOnCall) {
        entered();
        await open;
      }
      return source.getBlockRaw(hash);
    },
  };
  return { source: wrapped, hasEntered, release };
}

// Counts every call so a test can prove a worker never touched the node.
export function countingSource(source: BlockSource) {
  const counts = { getTip: 0, getBlockHash: 0, getBlockRaw: 0 };
  const wrapped: BlockSource = {
    getTip: () => (counts.getTip++, source.getTip()),
    getBlockHash: (h) => (counts.getBlockHash++, source.getBlockHash(h)),
    getBlockRaw: (h) => (counts.getBlockRaw++, source.getBlockRaw(h)),
  };
  return { source: wrapped, counts };
}
