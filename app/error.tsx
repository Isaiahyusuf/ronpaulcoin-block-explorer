"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="error-state" role="alert">
      <p className="eyebrow">TEMPORARY ERROR</p>
      <h1>This page could not be loaded.</h1>
      <p>Try again. If the issue continues, the node or data service may be unavailable.</p>
      <button className="button-link" onClick={reset} type="button">
        Try again
      </button>
    </section>
  );
}
