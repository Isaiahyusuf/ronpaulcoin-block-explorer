import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ron Paul Coin Explorer",
    template: "%s | Ron Paul Coin Explorer",
  },
  description:
    "A clear, independent explorer for Ron Paul Coin blocks and transactions.",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="site-frame">
          <header className="site-header">
            <div className="header-inner">
              <Link className="brand" href="/" aria-label="Ron Paul Coin Explorer home">
                <Image
                  className="brand-mark"
                  src="/logo.png"
                  alt=""
                  width={38}
                  height={38}
                />
                <span className="brand-name">
                  <strong>RON PAUL COIN</strong>
                  <span>BLOCK EXPLORER</span>
                </span>
              </Link>
              <nav className="primary-nav" aria-label="Main navigation">
                <Link href="/blocks">Blocks</Link>
                <Link href="/transactions">Transactions</Link>
              </nav>
              <form className="header-search" action="/search" method="get">
                <label className="visually-hidden" htmlFor="site-search">
                  Search a block height, hash, transaction ID, or address
                </label>
                <input
                  id="site-search"
                  name="q"
                  type="search"
                  placeholder="Block, transaction, address"
                  autoComplete="off"
                  required
                />
                <button type="submit" aria-label="Search">
                  <span aria-hidden="true">↵</span>
                </button>
              </form>
            </div>
          </header>
          <main id="main-content" className="main-content">
            {children}
          </main>
          <footer className="site-footer">
            <div className="footer-inner">
              <span>RON PAUL COIN EXPLORER</span>
              <span>Independent community infrastructure</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
