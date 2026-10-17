import Link from "next/link";
import { NetworkOverview } from "@/components/network-overview";

export default function Home() {
  return (
    <div className="page-stack">
      <section className="intro">
        <p className="eyebrow">RON PAUL COIN · NETWORK EXPLORER</p>
        <div className="intro-row">
          <div>
            <h1>Follow the chain.</h1>
            <p className="intro-copy">
              Independent access to Ron Paul Coin block and transaction data.
            </p>
          </div>
        </div>
      </section>

      <NetworkOverview />

      <section className="browse-section" aria-labelledby="browse-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BROWSE</p>
            <h2 id="browse-heading">Explore the ledger</h2>
          </div>
        </div>
        <div className="browse-grid">
          <Link className="browse-card" href="/blocks">
            <span className="browse-index">01</span>
            <span className="browse-card-copy">
              <strong>Blocks</strong>
              <span>Inspect block height, contents, and confirmations.</span>
            </span>
            <span className="browse-arrow" aria-hidden="true">
              →
            </span>
          </Link>
          <Link className="browse-card" href="/transactions">
            <span className="browse-index">02</span>
            <span className="browse-card-copy">
              <strong>Transactions</strong>
              <span>Look up transaction IDs and their on-chain details.</span>
            </span>
            <span className="browse-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </section>

      <p className="footnote">
        Explorer data depends on a Ron Paul Coin daemon. Transaction and address
        history also require an indexed data source.
      </p>
    </div>
  );
}
