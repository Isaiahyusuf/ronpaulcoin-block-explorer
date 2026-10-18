import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";
import { getBlockDetails } from "@/lib/rpc";

export const metadata: Metadata = { title: "Block details" };
export const instant = false;

function formatBlockTime(seconds: number): string {
  return `${new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;
}

export default async function BlockPage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  await connection();
  const { identifier } = await params;
  const isHeight =
    /^\d{1,16}$/.test(identifier) && Number.isSafeInteger(Number(identifier));
  const isHash = /^[a-fA-F0-9]{64}$/.test(identifier);

  if (!isHeight && !isHash) notFound();

  const result = await getBlockDetails(identifier);
  if (result.status !== "online") {
    return (
      <div className="page-stack">
        <div className="page-heading">
          <p className="eyebrow">BLOCK DETAILS</p>
          <h1>
            {isHeight
              ? `Block ${Number(identifier).toLocaleString("en-US")}`
              : "Block details"}
          </h1>
          <p className="mono-subtitle">{identifier}</p>
        </div>
        <UnavailableState title="Block details are unavailable">
          {result.message} Confirm that the node is reachable and supports
          getblockhash and getblock.
        </UnavailableState>
        <Link className="text-link" href="/blocks">
          ← Browse blocks
        </Link>
      </div>
    );
  }

  const details = result.data;
  const title = `Block ${details.height.toLocaleString("en-US")}`;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">BLOCK DETAILS</p>
        <h1>{title}</h1>
        <p className="mono-subtitle">{details.hash}</p>
      </div>

      <section
        className="block-detail-panel"
        aria-labelledby="block-summary-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE FROM NODE</p>
            <h2 id="block-summary-heading">Block summary</h2>
          </div>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Height</dt>
            <dd>{details.height.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Timestamp</dt>
            <dd>
              <time dateTime={new Date(details.time * 1000).toISOString()}>
                {formatBlockTime(details.time)}
              </time>
            </dd>
          </div>
          <div>
            <dt>Confirmations</dt>
            <dd>
              {details.confirmations < 0
                ? "Not in active chain"
                : details.confirmations.toLocaleString("en-US")}
            </dd>
          </div>
          <div>
            <dt>Transactions</dt>
            <dd>{details.transactionCount.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>
              {details.size === null
                ? "Not provided"
                : `${details.size.toLocaleString("en-US")} bytes`}
            </dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{details.version}</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>
              {details.difficulty.toLocaleString("en-US", {
                maximumSignificantDigits: 17,
              })}
            </dd>
          </div>
          <div>
            <dt>Bits</dt>
            <dd>{details.bits}</dd>
          </div>
          <div className="detail-grid-wide">
            <dt>Merkle root</dt>
            <dd className="detail-hash">{details.merkleRoot}</dd>
          </div>
          {details.previousBlockHash && (
            <div className="detail-grid-wide">
              <dt>Previous block</dt>
              <dd className="detail-hash">
                <Link
                  className="mono-link"
                  href={`/block/${details.previousBlockHash}`}
                >
                  {details.previousBlockHash}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section
        className="block-detail-panel"
        aria-labelledby="transactions-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">BLOCK CONTENTS</p>
            <h2 id="transactions-heading">
              Transactions ({details.transactionCount.toLocaleString("en-US")})
            </h2>
          </div>
        </div>
        {details.transactions.length > 0 ? (
          <>
            <ol className="block-tx-list">
              {details.transactions.slice(0, 50).map((txid, index) => (
                <li key={`${txid}-${index}`}>
                  <span className="tx-index">{index + 1}</span>
                  <Link className="mono-link" href={`/tx/${txid}?block=${details.hash}`}>
                    {txid}
                  </Link>
                </li>
              ))}
            </ol>
            {details.transactions.length > 50 && (
              <p className="table-note">
                Showing the first 50 transaction IDs.{" "}
                {(details.transactions.length - 50).toLocaleString("en-US")} more
                are in this block.
              </p>
            )}
          </>
        ) : (
          <p className="empty-copy">This block has no transactions.</p>
        )}
        <p className="table-note">
          Transaction details require historical transaction indexing and may
          not be available from the current node.
        </p>
      </section>

      <Link className="text-link" href="/blocks">
        ← Browse blocks
      </Link>
    </div>
  );
}
