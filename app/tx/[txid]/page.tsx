import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";

export const metadata: Metadata = { title: "Transaction details" };
export const instant = false;

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ txid: string }>;
}) {
  await connection();
  const { txid } = await params;
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) notFound();

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">TRANSACTION DETAILS</p>
        <h1>Transaction</h1>
        <p className="mono-subtitle">{txid}</p>
      </div>
      <UnavailableState title="Transaction details are unavailable">
        Historical transaction lookup requires a configured Ron Paul Coin
        daemon with transaction indexing or a compatible indexer. This ID has
        not been presented as a verified transaction.
      </UnavailableState>
      <Link className="text-link" href="/transactions">
        ← Browse transactions
      </Link>
    </div>
  );
}
