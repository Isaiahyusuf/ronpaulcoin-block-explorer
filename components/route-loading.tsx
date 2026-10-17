interface RouteLoadingProps {
  label: string;
}

export function RouteLoading({ label }: RouteLoadingProps) {
  return (
    <div className="page-stack" aria-busy="true" aria-label={`Loading ${label}`}>
      <div className="loading-bar loading-bar--short" />
      <div className="loading-bar loading-bar--title" />
      <div className="skeleton-panel">
        <p className="loading-copy">Loading {label} from the node…</p>
        <div className="skeleton-grid">
          <div className="skeleton-metric" />
          <div className="skeleton-metric" />
          <div className="skeleton-metric" />
          <div className="skeleton-metric" />
        </div>
      </div>
    </div>
  );
}
