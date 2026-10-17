# Ron Paul Coin Explorer

A responsive explorer for the original Ron Paul Coin Scrypt proof-of-work
chain. The overview reads chain metadata from a server-side JSON-RPC node and
recent blocks and block details use that node. The original 2014 daemon does
not expose a header count or address index. Transaction details require its
optional transaction index; address balances and history need a separate
indexer. No demo chain data is included.

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
requires both authentication fields together, makes server-side `getinfo` and
`getbestblockhash` requests with a three-second timeout, and validates the
returned fields before displaying them. It does not send RPC credentials to
the browser or print them in application messages.

Use an endpoint available only to the application or a trusted private network.
Do not expose an authenticated coin daemon's RPC port to the public internet.
The original daemon uses the legacy `getinfo`, `getbestblockhash`,
`getblockhash`, and `getblock` JSON-RPC methods. The explorer uses `getinfo`
for height, difficulty, network, and peer count, and explicitly reports that
the daemon does not provide a separate header count.

## Original daemon parameters

These values are verified against the official source tree at commit
[`43b2763`](https://github.com/ronpaulcoin/ronpaulcoin/tree/43b27637d2bd9f6c6fddf2da994f7821f8d42303):

| Setting | Mainnet | Testnet |
| --- | --- | --- |
| Peer-to-peer port | `9027` | `19027` |
| JSON-RPC port | `9026` | `19026` |
| Network message magic | `fb c0 b6 db` | `fc c1 b7 dc` |

On Linux, the daemon's default data directory is `~/.ronpaulcoin/`, and its
default config file is `~/.ronpaulcoin/ronpaulcoin.conf`. Testnet data is stored
under the `testnet3` subdirectory. The source tree is from 2014; its Unix build
notes list Berkeley DB 4.8, Boost, and OpenSSL. A successful build on a current
distribution has not yet been verified.

The daemon supports `-txindex` (off by default). The source requires a full
reindex to change the setting after the database has been created. The
transaction RPC can sometimes find transactions by scanning the block holding
an unspent output, but that is not a dependable historical lookup strategy;
enable and verify `-txindex` for arbitrary transaction detail pages. The
daemon does not provide a general address index or address-history RPC.

For RPC security, this source binds to loopback by default. Enabling
`rpcallowip` changes the listener to a wildcard bind; this revision does not
provide a per-interface RPC bind option. Do not expose the RPC port publicly.
Use a private tunnel/network and a host firewall that only allows the explorer
over that private path.

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

- **Implemented:** server-only connectivity check and validation of the
  original daemon's `getinfo` and `getbestblockhash` responses; recent blocks
  and block detail lookups via `getblockhash` and `getblock`.
- **Not implemented:** transaction detail lookup and address balance/history.
  Those views intentionally show an unavailable state rather than guessed data.
- **Indexer requirement:** address activity and full historical transaction
  search require a separate address indexer; the daemon's wallet address
  methods only cover wallet-owned addresses. Confirm supported RPC methods,
  verbosity format, address encoding, and index behavior against the chosen
  Ron Paul Coin daemon before wiring those views. Block browsing uses
  `getblockhash(height)` and `getblock(hash, true)`; the returned block must
  include the hash, height, time, confirmations, version, bits, difficulty,
  merkle root, and transaction-ID fields.

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
npm test
npm run lint
npx tsc --noEmit
npm run build
```
