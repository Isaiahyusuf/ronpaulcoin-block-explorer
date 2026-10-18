import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";
import { lookupAddress } from "@/lib/rpc";

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

  const result = await lookupAddress(address);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">ADDRESS DETAILS</p>
        <h1>Address</h1>
        <p className="mono-subtitle">{address}</p>
      </div>
      <UnavailableState
        title={
          result.status === "valid-unindexed"
            ? "Balance and history are not available"
            : result.status === "invalid"
              ? "Invalid address"
              : "Address details are unavailable"
        }
      >
        {result.status === "valid-unindexed"
          ? "This is a valid Ron Paul Coin address, but the node has no address index, so its balance and transaction history cannot be calculated. This does not mean the address has no activity. An address indexer is required."
          : result.message}
      </UnavailableState>
      <Link className="text-link" href="/transactions">
        ← Browse transactions
      </Link>
    </div>
  );
}
