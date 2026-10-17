interface UnavailableStateProps {
  title: string;
  children: React.ReactNode;
}

export function UnavailableState({
  title,
  children,
}: UnavailableStateProps) {
  return (
    <section className="unavailable-panel" aria-labelledby="unavailable-heading">
      <div className="unavailable-mark" aria-hidden="true">
        !
      </div>
      <div>
        <h2 id="unavailable-heading">{title}</h2>
        <p>{children}</p>
        <p className="muted-copy">
          The explorer does not substitute demo data for live blockchain records.
        </p>
      </div>
    </section>
  );
}
