import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";
import { getTransaction } from "@/lib/rpc";

export const metadata: Metadata = { title: "Transaction details" };
export const instant = false;

export default async function TransactionPage({
  params,
  searchParams,
}: {
  params: Promise<{ txid: string }>;
  searchParams: Promise<{ block?: string | string[] }>;
}) {
  await connection();
  const { txid } = await params;
  const { block } = await searchParams;
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) notFound();

  const result = await getTransaction(
    txid,
    typeof block === "string" ? block : undefined,
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">TRANSACTION DETAILS</p>
        <h1>Transaction</h1>
        <p className="mono-subtitle">{txid}</p>
      </div>
      {result.status === "found" ? (
        <section className="panel">
          <dl className="detail-list">
            <div>
              <dt>Block</dt>
              <dd>
                {result.data.blockHash ? (
                  <Link className="mono-link" href={`/block/${result.data.blockHash}`}>
                    {result.data.blockHash}
                  </Link>
                ) : (
                  "Unconfirmed"
                )}
              </dd>
            </div>
            <div>
              <dt>Confirmations</dt>
              <dd>{result.data.confirmations ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>
                {result.data.time
                  ? new Date(result.data.time * 1000).toUTCString()
                  : "Unknown"}
              </dd>
            </div>
          </dl>
          <h2>Inputs ({result.data.inputs.length})</h2>
          <ul>
            {result.data.inputs.map((input, i) => (
              <li key={i} className="mono-link">
                {input.coinbase !== null
                  ? "Coinbase (newly generated coins)"
                  : `${input.txid}:${input.vout}`}
              </li>
            ))}
          </ul>
          <p className="muted-copy">
            Input amounts and addresses are not provided by the node without a
            transaction index; only the spent outpoints are shown.
          </p>
          <h2>Outputs ({result.data.outputs.length})</h2>
          <ul>
            {result.data.outputs.map((output) => (
              <li key={output.index}>
                #{output.index}: {output.value.toFixed(8)} RPC →{" "}
                {output.addresses.length > 0
                  ? output.addresses.join(", ")
                  : `no address (${output.type ?? "unknown"})`}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <UnavailableState
          title={
            result.status === "not-indexed"
              ? "Transaction not retrievable from the node"
              : "Transaction details are unavailable"
          }
        >
          {result.message}
        </UnavailableState>
      )}
      <Link className="text-link" href="/transactions">
        ← Browse transactions
      </Link>
    </div>
  );
}
