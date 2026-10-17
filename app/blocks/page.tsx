import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";
import { getRecentBlocks } from "@/lib/rpc";

export const metadata: Metadata = { title: "Blocks" };
export const instant = false;

function formatBlockTime(seconds: number): string {
  return `${new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;
}

export default async function BlocksPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const rawStart = params.start;
  const startHeight =
    rawStart === undefined
      ? undefined
      : typeof rawStart === "string" && /^\d+$/.test(rawStart)
        ? Number(rawStart)
        : NaN;
  const result = await getRecentBlocks(startHeight);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">LEDGER</p>
        <h1>Blocks</h1>
        <p>Recent blocks returned by the configured Ron Paul Coin node.</p>
      </div>

      {result.status === "online" ? (
        <>
          <section className="block-list-panel" aria-labelledby="blocks-table-heading">
            <div className="section-heading block-list-heading">
              <div>
                <p className="eyebrow">LIVE FROM NODE</p>
                <h2 id="blocks-table-heading">
                  Newest block in view:{" "}
                  {result.data.startHeight.toLocaleString("en-US")}
                </h2>
              </div>
              <span className="small-meta">
                Tip {result.data.latestHeight.toLocaleString("en-US")}
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Height</th>
                    <th scope="col">Time (UTC)</th>
                    <th className="numeric-cell" scope="col">
                      Transactions
                    </th>
                    <th className="numeric-cell" scope="col">
                      Size
                    </th>
                    <th className="numeric-cell" scope="col">
                      Confirmations
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.blocks.map((block) => (
                    <tr key={block.hash}>
                      <td>
                        <Link
                          className="table-primary-link"
                          href={`/block/${block.height}`}
                        >
                          {block.height.toLocaleString("en-US")}
                        </Link>
                      </td>
                      <td>
                        <time dateTime={new Date(block.time * 1000).toISOString()}>
                          {formatBlockTime(block.time)}
                        </time>
                      </td>
                      <td className="numeric-cell">
                        {block.transactionCount.toLocaleString("en-US")}
                      </td>
                      <td className="numeric-cell">
                        {block.size === null
                          ? "—"
                          : `${block.size.toLocaleString("en-US")} B`}
                      </td>
                      <td className="numeric-cell">
                        {block.confirmations < 0
                          ? "Not in active chain"
                          : block.confirmations.toLocaleString("en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="pagination" aria-label="Block pages">
              {result.data.newerStartHeight !== null ? (
                <Link
                  className="button-link button-link--secondary"
                  href={`/blocks?start=${result.data.newerStartHeight}`}
                >
                  Newer blocks
                </Link>
              ) : (
                <span />
              )}
              {result.data.olderStartHeight !== null ? (
                <Link
                  className="button-link button-link--secondary"
                  href={`/blocks?start=${result.data.olderStartHeight}`}
                >
                  Older blocks
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </section>
          <p className="table-note">
            Block data is read directly from the node. Confirmations may change
            as new blocks are added.
          </p>
        </>
      ) : (
        <UnavailableState title="Block listing is unavailable">
          {result.message} Configure a reachable Ron Paul Coin node that supports
          getinfo, getbestblockhash, getblockhash, and getblock to browse blocks.
        </UnavailableState>
      )}

      <Link className="text-link" href="/">
        ← Back to network overview
      </Link>
    </div>
  );
}
