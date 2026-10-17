import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page-stack">
      <div className="page-heading">
        <p className="eyebrow">404 · NOT FOUND</p>
        <h1>That record could not be found.</h1>
        <p>The requested route or identifier is not valid for this explorer.</p>
      </div>
      <Link className="button-link" href="/">
        Return to overview
      </Link>
    </div>
  );
}
