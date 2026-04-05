const { Pool } = require('pg')

const connectionString =
  process.env.DATABASE_URL?.trim() ||
  'postgresql://postgres:postgres@127.0.0.1:5432/triangle'

if (!process.env.DATABASE_URL?.trim()) {
  console.warn(
    '[db] DATABASE_URL missing, using postgres:postgres@127.0.0.1:5432/triangle',
  )
}

const pool = new Pool({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 10_000,
})

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      privy_user_id TEXT NOT NULL UNIQUE,
      email TEXT,
      solana_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS solana_address TEXT`)

  const { rows: dealCols } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals'
  `)
  const colSet = new Set(dealCols.map((r) => r.column_name))

  if (dealCols.length === 0) {
    await pool.query(`
      CREATE TABLE deals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        acceptor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        amount NUMERIC(24, 8),
        currency TEXT NOT NULL DEFAULT 'USD',
        network TEXT NOT NULL DEFAULT 'solana-devnet',
        asset TEXT NOT NULL DEFAULT 'SOL',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS deals_creator_user_id_idx ON deals(creator_user_id);
      CREATE INDEX IF NOT EXISTS deals_acceptor_user_id_idx ON deals(acceptor_user_id);
    `)
  } else {
    if (colSet.has('user_id') && !colSet.has('creator_user_id')) {
      await pool.query(`ALTER TABLE deals RENAME COLUMN user_id TO creator_user_id`)
    }
    await pool.query(`
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS acceptor_user_id UUID REFERENCES users(id);
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT 'solana-devnet';
      ALTER TABLE deals ADD COLUMN IF NOT EXISTS asset TEXT NOT NULL DEFAULT 'SOL';
    `)
    await pool.query(`
      ALTER TABLE deals DROP COLUMN IF EXISTS title;
      ALTER TABLE deals DROP COLUMN IF EXISTS description;
    `)
    await pool.query(`
      UPDATE deals SET status = 'open' WHERE status IN ('draft', 'active') AND acceptor_user_id IS NULL;
      UPDATE deals SET status = 'accepted' WHERE status = 'active' AND acceptor_user_id IS NOT NULL;
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS deals_creator_user_id_idx ON deals(creator_user_id);
      CREATE INDEX IF NOT EXISTS deals_acceptor_user_id_idx ON deals(acceptor_user_id);
    `)
  }

  await pool.query(`
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS escrow_pda TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS escrow_status TEXT;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS escrow_frozen BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS escrow_expected_lamports TEXT;
  `)

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_support BOOLEAN NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS support_requested BOOLEAN NOT NULL DEFAULT false`)

  await pool.query(`
    UPDATE users SET is_support = true
    WHERE solana_address IN (
      'ENEjvWTjFnATyGsfh21AgbLvwrRukh6A7LsowoPEucF7',
      '5VGAtw57Y7N9ovaPqA1vjhjSKRT5EyzSgyivgg3jc4HM'
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS deal_messages_deal_id_idx ON deal_messages(deal_id);
  `)
}

module.exports = { pool, initDb }
