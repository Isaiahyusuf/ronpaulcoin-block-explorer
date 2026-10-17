import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";

export const metadata: Metadata = { title: "Address details" };
export const instant = false;

export default async function AddressPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  await connection();
  const { address } = await params;
  if (!/^[a-zA-Z0-9]{26,128}$/.test(address)) notFound();

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">ADDRESS DETAILS</p>
        <h1>Address</h1>
        <p className="mono-subtitle">{address}</p>
      </div>
      <UnavailableState title="Address history is not indexed">
        Address balances and transaction history require a Ron Paul Coin
        address indexer. No balance or activity is inferred from incomplete
        node data.
      </UnavailableState>
      <Link className="text-link" href="/">
        ← Back to network overview
      </Link>
    </div>
  );
}
