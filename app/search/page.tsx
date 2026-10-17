import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { classifySearch } from "@/lib/search";

export const metadata: Metadata = { title: "Search" };
export const instant = false;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const match = classifySearch(query);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">LOOKUP</p>
        <h1>Search the chain</h1>
        <p>Search by block height, block or transaction hash, or address.</p>
      </div>
      {!query.trim() ? (
        <div className="message-panel" role="status">
          Enter a block height, 64-character hash, or address in the search field
          above.
        </div>
      ) : match.kind === "height" ? (
        <section className="search-result" aria-labelledby="search-result-title">
          <p className="eyebrow">BLOCK HEIGHT</p>
          <h2 id="search-result-title">Block {match.value}</h2>
          <Link className="button-link" href={match.href}>
            View block details <span aria-hidden="true">→</span>
          </Link>
        </section>
      ) : match.kind === "hash" ? (
        <section className="search-result" aria-labelledby="search-result-title">
          <p className="eyebrow">HASH</p>
          <h2 id="search-result-title" className="result-hash">
            {match.value}
          </h2>
          <p className="result-copy">
            A 64-character hash can identify either a block or a transaction.
            Choose the record type you want to inspect.
          </p>
          <div className="result-actions">
            <Link
              className="button-link"
              href={`/block/${encodeURIComponent(match.value)}`}
            >
              Open as block
            </Link>
            <Link
              className="button-link button-link--secondary"
              href={`/tx/${encodeURIComponent(match.value)}`}
            >
              Open as transaction
            </Link>
          </div>
        </section>
      ) : match.kind === "address" ? (
        <section className="search-result" aria-labelledby="search-result-title">
          <p className="eyebrow">ADDRESS LOOKUP</p>
          <h2 id="search-result-title">Address-like identifier</h2>
          <p className="mono-subtitle">{match.value}</p>
          <p className="result-copy">
            Address history depends on an indexed data source and may not be
            available for this network.
          </p>
          <Link className="button-link" href={match.href}>
            Open address details
          </Link>
        </section>
      ) : (
        <div className="message-panel message-panel--error" role="alert">
          “{match.value}” is not a supported lookup format. Use a block height,
          a 64-character hexadecimal hash, or an alphanumeric address.
        </div>
      )}
    </div>
  );
}
