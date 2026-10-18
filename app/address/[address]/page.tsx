import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { UnavailableState } from "@/components/unavailable-state";
import { formatSatoshis, lookupIndexedAddress, PAGE_SIZE } from "@/lib/address-index";
import { lookupAddress } from "@/lib/rpc";

export const metadata: Metadata = { title: "Address details" };
export const instant = false;

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await connection();
  const { address } = await params;
  if (!/^[a-zA-Z0-9]{26,128}$/.test(address)) notFound();
  const requested = Number((await searchParams).page ?? "1");
  const page = Number.isSafeInteger(requested) && requested >= 1 ? requested : 1;

  const result = await lookupAddress(address);
  const indexed = result.status === "valid-unindexed" ? await lookupIndexedAddress(address, page) : null;

  const heading = (
    <div className="page-heading">
      <p className="eyebrow">ADDRESS DETAILS</p>
      <h1>Address</h1>
      <p className="mono-subtitle">{address}</p>
    </div>
  );
  const back = (
    <Link className="text-link" href="/transactions">
      ← Browse transactions
    </Link>
  );

  if (indexed?.status === "ok" && indexed.summary.complete) {
    const s = indexed.summary;
    const lastPage = Math.max(1, Math.ceil(s.transactionCount / PAGE_SIZE));
    return (
      <div className="page-stack">
        {heading}
        <section className="panel">
          <dl className="detail-list">
            <div><dt>Balance</dt><dd>{formatSatoshis(s.total)} RPC</dd></div>
            <div><dt>Spendable</dt><dd>{formatSatoshis(s.spendable)} RPC</dd></div>
            <div><dt>Immature mining rewards</dt><dd>{formatSatoshis(s.immature)} RPC</dd></div>
            <div><dt>Total received</dt><dd>{formatSatoshis(s.totalReceived)} RPC</dd></div>
            <div><dt>Transactions</dt><dd>{s.transactionCount.toLocaleString("en-US")}</dd></div>
            <div><dt>Indexed to block</dt><dd>{s.indexedHeight?.toLocaleString("en-US")}</dd></div>
          </dl>
          {s.caveats.map((c) => (
            <p key={c} className="muted-copy">{c}</p>
          ))}
        </section>
        {s.transactions.length === 0 ? (
          <p className="muted-copy">This address has no recorded transactions.</p>
        ) : (
          <section className="panel">
            <h2>Transactions</h2>
            <ul>
              {s.transactions.map((t) => (
                <li key={`${t.txid}:${t.height}`} className="mono-link">
                  <Link href={`/tx/${t.txid}`}>{t.txid}</Link> · block {t.height.toLocaleString("en-US")} ·{" "}
                  {new Date(t.time * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC ·{" "}
                  {t.delta >= BigInt(0) ? "+" : ""}
                  {formatSatoshis(t.delta)} RPC
                </li>
              ))}
            </ul>
            <p className="muted-copy">
              Page {page} of {lastPage}.{" "}
              {page > 1 && <Link className="text-link" href={`?page=${page - 1}`}>Newer</Link>}{" "}
              {page < lastPage && <Link className="text-link" href={`?page=${page + 1}`}>Older</Link>}
            </p>
          </section>
        )}
        {back}
      </div>
    );
  }

  let title = "Address details are unavailable";
  let message: string = result.status === "valid-unindexed" ? "" : result.message;
  if (result.status === "invalid") title = "Invalid address";
  else if (indexed?.status === "ok") {
    title = "Balance and history are not shown";
    message = `The address index is not confirmed current, so no balance is shown. ${indexed.summary.incompleteReason ?? ""}`;
  } else if (indexed?.status === "unavailable") {
    title = "Balance and history are unavailable";
    message = indexed.message;
  } else if (result.status === "valid-unindexed") {
    title = "Balance and history are not available";
    message =
      "This is a valid Ron Paul Coin address, but no address index is connected, so its balance and transaction history cannot be calculated. This does not mean the address has no activity.";
  }

  return (
    <div className="page-stack">
      {heading}
      <UnavailableState title={title}>{message}</UnavailableState>
      {back}
    </div>
  );
}
