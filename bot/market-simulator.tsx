// Server/src/scripts/bot1.ts
import fs from 'fs';
import path from 'path';

// ─── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  API_BASE: 'http://localhost:3000/api/v1',
  MARKETS: [
    'BTC-USDT-PERP',
    'ETH-USDT-PERP',
    'SOL-USDT-PERP',
    'XRP-USDT-PERP',
    'ADA-USDT-PERP',
    'DOGE-USDT-PERP',
    'DOT-USDT-PERP',
    'LINK-USDT-PERP',
    'MATIC-USDT-PERP',
    'AVAX-USDT-PERP',
    'UNI-USDT-PERP',
    'ATOM-USDT-PERP',
    'LTC-USDT-PERP',
    'BCH-USDT-PERP',
    'NEAR-USDT-PERP',
  ],
  // Each bot user will be created with this password
  PASSWORD: 'SimBot123!',
  // Initial deposit per user (USDT) – adjust as needed
  INITIAL_USDT: 100000,
  INITIAL_BTC: 1,
  // How often each bot loop runs (ms)
  MAKER_INTERVAL: 2000,
  TAKER_INTERVAL: 1000,
  // Number of bot users (3 is good for diversity)
  BOT_COUNT: 3,
};

// ─── Utility: fetch wrapper ─────────────────────────────────────────────────
async function apiRequest(
  token: string | null,
  method: string,
  path: string,
  body?: any
) {
  const url = `${CONFIG.API_BASE}${path}`;
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

// ─── Bot User ────────────────────────────────────────────────────────────────
interface BotUser {
  email: string;
  token: string;
  userId: string;
  balances: Record<string, number>; // symbol -> available amount
}

async function createUser(email: string, password: string): Promise<BotUser> {
  const reg = await apiRequest(null, 'POST', '/auth/register', {
    email,
    password,
    name: `Bot ${email.split('@')[0]}`,
  });
  const token = reg.token;
  // Deposit USDT and some base assets for sell orders
  await apiRequest(token, 'POST', '/balances/deposit', { asset: 'USDT', amount: String(CONFIG.INITIAL_USDT) });
  // Also deposit BTC for selling (if market has BTC base)
  await apiRequest(token, 'POST', '/balances/deposit', { asset: 'BTC', amount: String(CONFIG.INITIAL_BTC) });
  // For other coins, we may not have them initially; we can deposit as needed per market.
  return {
    email,
    token,
    userId: reg.user.id,
    balances: {},
  };
}

// ─── Core Loop ───────────────────────────────────────────────────────────────

let running = true;
process.on('SIGINT', () => { running = false; });

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Get current price from ticker (simplified – we could use orderbook)
async function getLastPrice(market: string, token: string): Promise<number> {
  try {
    const ticker = await apiRequest(token, 'GET', `/markets/${market}/ticker`);
    return parseFloat(ticker.lastPrice) || 50000; // fallback
  } catch {
    return 50000; // fallback
  }
}

// Place a limit order
async function placeLimitOrder(
  token: string,
  market: string,
  side: 'buy' | 'sell',
  price: number,
  quantity: number
) {
  try {
    const result = await apiRequest(token, 'POST', '/orders', {
      market,
      side,
      orderType: 'limit',
      price: String(price),
      quantity: String(quantity),
      timeInForce: 'GTC',
      leverage: '1', // low leverage for simulation
    });
    return result.order;
  } catch (err) {
    // ignore errors (e.g., insufficient balance, order too small)
    return null;
  }
}

// Place a market order
async function placeMarketOrder(
  token: string,
  market: string,
  side: 'buy' | 'sell',
  quantity: number,
  price: number // for margin calc
) {
  try {
    const result = await apiRequest(token, 'POST', '/orders', {
      market,
      side,
      orderType: 'market',
      quantity: String(quantity),
      price: String(price),
      leverage: '1',
    });
    return result.order;
  } catch {
    return null;
  }
}

// Cancel all open orders for a user (optional)
async function cancelAll(token: string, market?: string) {
  try {
    const qs = market ? `?market=${market}` : '';
    await apiRequest(token, 'DELETE', `/orders${qs}`);
  } catch {}
}

// ─── Strategy: Market Maker (places two‑sided limit orders) ──────────────
async function runMaker(user: BotUser, market: string) {
  const baseAsset = market.split('-')[0];
  // Ensure we have balance for this base (if not, deposit small amount)
  // For simplicity, we assume we already deposited BTC and USDT.
  // We'll just try to place orders; if balance insufficient, errors are ignored.

  const price = await getLastPrice(market, user.token);
  const spread = price * 0.001; // 0.1% spread
  const bidPrice = price - spread;
  const askPrice = price + spread;
  const qty = 0.001; // small quantity

  // Cancel existing orders for this market to avoid stacking
  await cancelAll(user.token, market);

  // Place buy and sell limit orders
  await placeLimitOrder(user.token, market, 'buy', bidPrice, qty);
  await placeLimitOrder(user.token, market, 'sell', askPrice, qty);
}

// ─── Strategy: Market Taker (randomly hits best bid/ask) ──────────────────
async function runTaker(user: BotUser, market: string) {
  const side = Math.random() > 0.5 ? 'buy' : 'sell';
  const qty = (Math.random() * 0.002 + 0.0005); // 0.0005–0.0025 BTC
  const price = await getLastPrice(market, user.token);
  await placeMarketOrder(user.token, market, side, qty, price);
}

// ─── Main Bot Loop ──────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Starting simulation bot...');

  // 1. Create bot users
  const users: BotUser[] = [];
  for (let i = 0; i < CONFIG.BOT_COUNT; i++) {
    const email = `bot${i+1}@sim.local`;
    console.log(`Creating user ${email}...`);
    try {
      const user = await createUser(email, CONFIG.PASSWORD);
      users.push(user);
    } catch (err) {
      console.error(`Failed to create ${email}:`, err);
    }
  }
  if (users.length === 0) {
    console.error('No bot users available. Exiting.');
    process.exit(1);
  }
  console.log(`✅ Created ${users.length} bot users.`);

  // 2. Distribute tasks: each user handles a subset of markets
  //    We'll cycle through users for each strategy.
  const markets = CONFIG.MARKETS;
  let makerIndex = 0;
  let takerIndex = 0;

  // 3. Infinite loop
  while (running) {
    // Run maker on one user/market
    const makerUser = users[makerIndex % users.length];
    const makerMarket = markets[Math.floor(Math.random() * markets.length)];
    try {
      await runMaker(makerUser, makerMarket);
    } catch (err) {
      // ignore
    }
    makerIndex++;

    // Run taker on another user/market
    const takerUser = users[takerIndex % users.length];
    const takerMarket = markets[Math.floor(Math.random() * markets.length)];
    try {
      await runTaker(takerUser, takerMarket);
    } catch (err) {
      // ignore
    }
    takerIndex++;

    // Sleep to control rate: ~1000 orders/min per user
    await sleep(100);
  }

  console.log('🛑 Bot stopped.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});