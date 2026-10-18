import type { Db } from "./db.ts";

export const SCHEMA_VERSION = 1;

// Amounts are integer satoshis (BIGINT). An output is keyed by its chain
// position (height, tx_index, vout), never by txid alone: a txid is not
// guaranteed unique across history (BIP30). The partial unique index on
// unspent outpoints enforces the invariant the daemon itself enforces: a
// transaction ID may only be reused once every earlier output of that ID has
// been spent. Spends therefore resolve unambiguously to the single unspent
// output with that outpoint.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS blocks (
  height    INTEGER PRIMARY KEY,
  hash      TEXT NOT NULL UNIQUE,
  prev_hash TEXT NOT NULL,
  time      BIGINT NOT NULL,
  tx_count  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  height   INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
  tx_index INTEGER NOT NULL,
  txid     TEXT NOT NULL,
  PRIMARY KEY (height, tx_index)
);
CREATE INDEX IF NOT EXISTS transactions_txid ON transactions (txid);

CREATE TABLE IF NOT EXISTS outputs (
  height          INTEGER NOT NULL REFERENCES blocks(height) ON DELETE CASCADE,
  tx_index        INTEGER NOT NULL,
  vout            INTEGER NOT NULL,
  txid            TEXT NOT NULL,
  address         TEXT,
  script_type     TEXT NOT NULL,
  value           BIGINT NOT NULL CHECK (value >= 0),
  is_coinbase     BOOLEAN NOT NULL,
  spendable       BOOLEAN NOT NULL,
  spent_height    INTEGER,
  spent_tx_index  INTEGER,
  spent_vin       INTEGER,
  spent_txid      TEXT,
  PRIMARY KEY (height, tx_index, vout),
  CHECK ((spent_height IS NULL) = (spent_txid IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS outputs_unspent_outpoint
  ON outputs (txid, vout) WHERE spent_height IS NULL;
CREATE INDEX IF NOT EXISTS outputs_address ON outputs (address, height) WHERE address IS NOT NULL;
CREATE INDEX IF NOT EXISTS outputs_spent_address
  ON outputs (address, spent_height) WHERE address IS NOT NULL AND spent_height IS NOT NULL;
CREATE INDEX IF NOT EXISTS outputs_spent_height ON outputs (spent_height) WHERE spent_height IS NOT NULL;

CREATE TABLE IF NOT EXISTS indexer_state (
  id            SMALLINT PRIMARY KEY CHECK (id = 1),
  status        TEXT NOT NULL CHECK (status IN ('ok', 'halted')),
  halted_reason TEXT,
  schema_version INTEGER NOT NULL
);
INSERT INTO indexer_state (id, status, schema_version) VALUES (1, 'ok', ${SCHEMA_VERSION})
  ON CONFLICT (id) DO NOTHING;
`;

export async function migrate(db: Db): Promise<void> {
  await db.exec(SCHEMA_SQL);
}
