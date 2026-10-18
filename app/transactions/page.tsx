import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";
import { getRecentTransactions } from "@/lib/address-index";

export const metadata: Metadata = { title: "Transactions" };
export const instant = false;

function formatTime(seconds: number): string {
  return `${new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string | string[] }>;
}) {
  await connection();
  const raw = (await searchParams).before;
  const before = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
  const result = await getRecentTransactions(before);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">LEDGER</p>
        <h1>Transactions</h1>
        <p>Recent transactions from the address index. Search by transaction ID to look one up.</p>
      </div>
      {result.status === "ok" ? (
        <section className="block-list-panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Transaction</th>
                  <th scope="col">Block</th>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {result.transactions.map((tx) => (
                  <tr key={`${tx.height}:${tx.txid}`}>
                    <td>
                      <Link className="table-primary-link mono" href={`/tx/${tx.txid}`}>
                        {tx.txid.slice(0, 16)}…{tx.txid.slice(-8)}
                      </Link>
                    </td>
                    <td>
                      <Link className="table-primary-link" href={`/block/${tx.height}`}>
                        {tx.height.toLocaleString("en-US")}
                      </Link>
                    </td>
                    <td>{formatTime(tx.time)}</td>
                    <td>{tx.coinbase ? "Coinbase" : "Transfer"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.nextBefore !== null ? (
            <Link className="text-link" href={`/transactions?before=${result.nextBefore}`}>
              Older transactions →
            </Link>
          ) : null}
        </section>
      ) : (
        <UnavailableState title="Transaction history is unavailable">
          {result.status === "unavailable"
            ? result.message
            : "The transaction index is not configured for this deployment."}
        </UnavailableState>
      )}
      <Link className="text-link" href="/">
        ← Back to network overview
      </Link>
    </div>
  );
}
