"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  isBlockchainInfoResult,
  type BlockchainInfoResult,
} from "@/lib/blockchain";

type NetworkState = { status: "loading" } | BlockchainInfoResult;

function LoadingState() {
  return (
    <section
      className="network-panel"
      aria-busy="true"
      aria-label="Checking blockchain node"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">NETWORK</p>
          <h2>Chain overview</h2>
        </div>
      </div>
      <p className="loading-copy">Checking the configured node…</p>
      <div className="skeleton-grid">
        <div className="skeleton-metric" />
        <div className="skeleton-metric" />
        <div className="skeleton-metric" />
        <div className="skeleton-metric" />
      </div>
    </section>
  );
}

function NetworkData({
  result,
  onRetry,
}: {
  result: BlockchainInfoResult;
  onRetry: () => void;
}) {
  return (
    <section className="network-panel" aria-labelledby="network-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">NETWORK</p>
          <h2 id="network-heading">Chain overview</h2>
        </div>
        {result.status === "online" && (
          <span className="live-label">LIVE FROM NODE</span>
        )}
      </div>

      {result.status === "online" ? (
        <>
          <dl className="metric-grid">
            <div className="metric">
              <dt>Block height</dt>
              <dd>{result.info.blocks.toLocaleString("en-US")}</dd>
            </div>
            <div className="metric">
              <dt>Headers</dt>
              <dd>{result.info.headers.toLocaleString("en-US")}</dd>
            </div>
            <div className="metric">
              <dt>Chain</dt>
              <dd className="metric-chain">{result.info.chain}</dd>
            </div>
            <div className="metric">
              <dt>Difficulty</dt>
              <dd>
                {result.info.difficulty.toLocaleString("en-US", {
                  maximumSignificantDigits: 17,
                })}
              </dd>
            </div>
          </dl>
          <div className="best-block">
            <span className="best-block-label">Best block</span>
            <Link
              className="mono-link hash-value"
              href={`/block/${result.info.bestblockhash}`}
            >
              {result.info.bestblockhash}
            </Link>
          </div>
        </>
      ) : (
        <div className="unavailable-state">
          <div className="unavailable-mark" aria-hidden="true">
            !
          </div>
          <div>
            <h3>
              {result.status === "not-configured"
                ? "Blockchain data is not configured"
                : "The blockchain node could not be reached"}
            </h3>
            <p>{result.message}</p>
            <p className="muted-copy">
              No sample or cached chain data is shown. Configure a reachable
              Ron Paul Coin JSON-RPC node to display verified network data.
            </p>
            <button
              className="retry-button"
              onClick={onRetry}
              type="button"
            >
              Check again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function NetworkOverview() {
  const [state, setState] = useState<NetworkState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStatus() {
      try {
        const response = await fetch("/api/network", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          setState({
            status: "unavailable",
            message: `The explorer status endpoint returned HTTP ${response.status}.`,
          });
          return;
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          setState({
            status: "unavailable",
            message: "The explorer returned an unreadable network status response.",
          });
          return;
        }

        if (!isBlockchainInfoResult(payload)) {
          setState({
            status: "unavailable",
            message: "The explorer returned an unsupported network status response.",
          });
          return;
        }

        setState(payload);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "unavailable",
          message: "The explorer could not retrieve network status.",
        });
      }
    }

    void loadStatus();
    return () => controller.abort();
  }, [attempt]);

  if (state.status === "loading") return <LoadingState />;

  return (
    <NetworkData
      result={state}
      onRetry={() => {
        setState({ status: "loading" });
        setAttempt((value) => value + 1);
      }}
    />
  );
}
