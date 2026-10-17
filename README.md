# Ron Paul Coin Explorer

A responsive explorer shell for Ron Paul Coin. The overview can read genuine
chain metadata from a server-side JSON-RPC node. It does not include demo chain
data. Recent blocks and block details use the configured node. Transaction
history and address history remain unavailable until their indexing
integrations are completed.

## Local development

Requirements: Node.js 20.9 or newer and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The development server uses the port selected by Next.js (normally `3000`).
Set `PORT` if a different local port is needed. Without RPC settings, the
overview clearly reports that the node is not configured; the rest of the
explorer remains usable as a route and search shell.

## Environment

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | HTTP port. Railway supplies this at runtime; Next.js reads it directly. |
| `RPC_URL` | For chain data | HTTP(S) JSON-RPC endpoint reachable from the application server. |
| `RPC_USERNAME` | No | RPC username. Set together with `RPC_PASSWORD` when authentication is required. |
| `RPC_PASSWORD` | No | RPC password. Keep it in deployment secrets; never use a `NEXT_PUBLIC_` variable. |

Copy `.env.example` to `.env.local` for local development and replace the
placeholders with private daemon settings. The explorer validates the URL,
requires both authentication fields together, makes a server-side
`getblockchaininfo` request with a three-second timeout, and validates the
returned chain fields before displaying them. It does not send RPC credentials
to the browser or print them in application messages.

Use an endpoint available only to the application or a trusted private network.
Do not expose an authenticated coin daemon's RPC port to the public internet.
The selected daemon must implement the Bitcoin Core-compatible
`getblockchaininfo` JSON-RPC method and return `chain`, `blocks`, `headers`,
`difficulty`, and `bestblockhash`.

## Production and Railway

1. Push this repository to a Git provider and create a Railway project from it.
2. Use Railway's generated public domain; no domain-specific code or hostname
   setting is required. A custom domain can later be added in Railway project
   settings.
3. Configure `RPC_URL` and, if needed, `RPC_USERNAME` and `RPC_PASSWORD` as
   Railway service variables. The endpoint must be reachable from the Railway
   service (prefer private networking or a secured gateway).
4. Deploy with the standard Node build and start commands: `npm run build` and
   `npm start`. Next.js binds to the `PORT` value supplied by Railway.

If RPC is absent or unreachable, the site still renders and identifies the
problem rather than failing startup or serving demo values. A compatible node
and its RPC configuration are operator-managed deployment requirements; this
repository does not provision or sync the daemon.

## Current integration scope

- **Implemented:** server-only connectivity check and validated
  `getblockchaininfo` display on the overview; recent blocks and block detail
  lookups via `getblockhash` and `getblock`.
- **Not implemented:** transaction detail lookup and address balance/history.
  Those views intentionally show an unavailable state rather than guessed data.
- **Indexer requirement:** address activity and full historical transaction
  search generally require a Ron Paul Coin indexer or a daemon with the
  appropriate transaction/address indexes enabled. Confirm supported RPC
  methods, verbosity format, address encoding, and index behavior against the
  chosen Ron Paul Coin daemon before wiring those views. Block browsing uses
  the Bitcoin Core-compatible `getblockhash(height)` and
  `getblock(hash, 1)` methods; the returned block must include the standard
  hash, height, time, confirmations, version, bits, difficulty, merkle root,
  and transaction-ID fields.

## Branding asset

The local site logo and Apple touch icon use `public/logo.png`, copied from
[`src/qt/res/icons/ronpaulcoin.png`](https://github.com/ronpaulcoin/ronpaulcoin/blob/43b27637d2bd9f6c6fddf2da994f7821f8d42303/src/qt/res/icons/ronpaulcoin.png)
in the [official RonPaulCoin repository](https://github.com/ronpaulcoin/ronpaulcoin).
The browser favicon, `app/favicon.ico`, uses the matching
[`src/qt/res/icons/ronpaulcoin.ico`](https://github.com/ronpaulcoin/ronpaulcoin/blob/43b27637d2bd9f6c6fddf2da994f7821f8d42303/src/qt/res/icons/ronpaulcoin.ico).
That repository identifies the original coin as Scrypt proof-of-work and
states that it is released under the MIT license.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
