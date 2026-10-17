import type { Metadata } from "next";
import Link from "next/link";
import { UnavailableState } from "@/components/unavailable-state";

export const metadata: Metadata = { title: "Transactions" };

export default function TransactionsPage() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">LEDGER</p>
        <h1>Transactions</h1>
        <p>Find a transaction by its identifier.</p>
      </div>
      <UnavailableState title="Transaction history is not indexed">
        Transaction lookup requires a reachable Ron Paul Coin node and an
        indexer or a daemon configured to serve historical transaction data.
        No transaction feed is available yet.
      </UnavailableState>
      <Link className="text-link" href="/">
        ← Back to network overview
      </Link>
    </div>
  );
}
