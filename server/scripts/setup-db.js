const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client } = require('pg');

function parseAppUrl() {
  const appUrl = process.env.DATABASE_URL?.trim();
  if (!appUrl) {
    throw new Error('Set DATABASE_URL in server/.env');
  }
  let u;
  try {
    u = new URL(appUrl);
  } catch {
    throw new Error('Invalid DATABASE_URL');
  }
  const pg = process.env.PGPASSWORD;
  if (pg != null && String(pg).length > 0) {
    u.password = pg;
  }
  return u;
}

function adminConnectionUrl() {
  if (process.env.ADMIN_DATABASE_URL?.trim()) {
    let u;
    try {
      u = new URL(process.env.ADMIN_DATABASE_URL.trim());
    } catch {
      throw new Error('Invalid ADMIN_DATABASE_URL');
    }
    const pg = process.env.PGPASSWORD;
    if (pg != null && String(pg).length > 0) {
      u.password = pg;
    }
    return u.toString();
  }
  const u = parseAppUrl();
  u.pathname = '/postgres';
  return u.toString();
}

function targetDatabaseName() {
  const u = parseAppUrl();
  const name = (u.pathname || '').replace(/^\//, '');
  if (!name || name === 'postgres') {
    throw new Error('DATABASE_URL must include a database name (e.g. /triangle)');
  }
  return name;
}

function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function tryCreateDatabase(adminUrlString) {
  const targetDb = targetDatabaseName();
  const client = new Client({ connectionString: adminUrlString });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb]
    );
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`);
      console.log(`Database "${targetDb}" created.`);
    } else {
      console.log(`Database "${targetDb}" already exists.`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  let adminUrl = adminConnectionUrl();

  try {
    await tryCreateDatabase(adminUrl);
    return;
  } catch (err) {
    if (err.code !== '28P01') throw err;
  }

  const canPrompt = process.stdin.isTTY && process.stdout.isTTY && !process.env.CI;

  if (!canPrompt) {
    console.error(
      'PostgreSQL authentication failed (wrong password).\n' +
      'Options:\n' +
      '  • Fix the password in server/.env (DATABASE_URL or ADMIN_DATABASE_URL)\n' +
      "  • PowerShell: $env:PGPASSWORD='your_password'; npm run db:setup\n" +
      '  • Docker: docker compose up -d db and DATABASE_URL=postgresql://triangle:triangle@127.0.0.1:5432/triangle\n' +
      '  • Manual: run server/scripts/create-database.sql in pgAdmin'
    );
    process.exit(1);
  }

  const u = parseAppUrl();
  const user = decodeURIComponent(u.username || 'postgres');
  const host = u.hostname || '127.0.0.1';
  console.error('Wrong password in DATABASE_URL (or .env does not match your PostgreSQL install).');
  const pwd = await promptPassword(`Password for user "${user}" (${host}): `);
  if (!pwd) {
    console.error('Empty password — exiting.');
    process.exit(1);
  }
  u.password = pwd;
  const admin = new URL(u.toString());
  admin.pathname = '/postgres';
  adminUrl = admin.toString();

  await tryCreateDatabase(adminUrl);

  const appWithPwd = new URL(u.toString());
  const dbName = (appWithPwd.pathname || '').replace(/^\//, '');
  appWithPwd.pathname = `/${dbName}`;
  console.log('\nTo avoid typing the password again, update server/.env:');
  console.log(`DATABASE_URL=${appWithPwd.toString()}`);
}

main().catch((err) => {
  console.error(err.message || String(err));
  if (err.code) console.error('code:', err.code);
  process.exit(1);
});