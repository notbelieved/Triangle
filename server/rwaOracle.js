

function pow10i(n) {
  if (n < 0 || n > 28) return null;
  return 10n ** BigInt(n);
}


function pythToUsdE6(price, exponent) {
  const p = BigInt(price);
  if (p <= 0n) return null;
  const shift = BigInt(exponent) + 6n;
  let out;
  if (shift >= 0n) {
    const pow = pow10i(Number(shift));
    if (pow == null) return null;
    out = p * pow;
  } else {
    const pow = pow10i(Number(-shift));
    if (pow == null || pow === 0n) return null;
    out = p / pow;
  }
  if (out <= 0n || out > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(out);
}

function dropBpsFromInitial(initialUsdE6, currentUsdE6) {
  const i = BigInt(initialUsdE6);
  const c = BigInt(currentUsdE6);
  if (i <= 0n || c <= 0n) return 0;
  if (c >= i) return 0;
  return Number((i - c) * 10000n / i);
}

function healthTier(warningBps, liquidationBps, dropBps) {
  if (dropBps >= liquidationBps) return 'liquidatable';
  if (dropBps >= warningBps) return 'warning';
  return 'ok';
}

function normalizeFeedHex(hex) {
  const s = String(hex || '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(s)) return null;
  return s.toLowerCase();
}

async function fetchPythHermesUsdE6(feedHex) {
  const id = normalizeFeedHex(feedHex);
  if (!id) throw new Error('Invalid Pyth feed id (expect 64 hex chars)');
  const url = `https://hermes.pyth.network/api/latest_price_feeds?ids%5B%5D=0x${id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes HTTP ${res.status}`);
  const data = await res.json();
  const first = Array.isArray(data) ? data[0] : null;
  const priceData = first?.price;
  if (!priceData || priceData.price == null) throw new Error('No price in Hermes response');
  const price =
  typeof priceData.price === 'string' ? priceData.price : String(priceData.price);
  const expo = Number(priceData.expo ?? 0);
  const usdE6 = pythToUsdE6(price, expo);
  if (usdE6 == null) throw new Error('Could not convert Pyth price to usd_e6');
  return {
    priceUsdE6: usdE6,
    publishTime: priceData.publish_time ?? priceData.publishTime ?? null,
    raw: { price, expo }
  };
}

function mockPriceUsdE6() {
  const raw = process.env.MOCK_RWA_PRICE_USD_E6;
  if (raw == null || !String(raw).trim()) return 2_000_000_000;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return 2_000_000_000;
  return Math.floor(n);
}

module.exports = {
  pythToUsdE6,
  dropBpsFromInitial,
  healthTier,
  normalizeFeedHex,
  fetchPythHermesUsdE6,
  mockPriceUsdE6
};