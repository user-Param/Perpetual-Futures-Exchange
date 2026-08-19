// bot/config.ts
export const CONFIG = {
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
  // Each bot will have these initial deposits (call once per bot)
  INITIAL_DEPOSITS: {
    USDT: 100000,
    BTC: 1,
    ETH: 10,
    // For other assets, we deposit a small amount when needed
  },
  // Number of bots to run
  BOT_COUNT: 4,
  // Password for all bot accounts (auto‑registered)
  BOT_PASSWORD: 'SimBot123!',
  // How often each bot runs its strategies (ms)
  LOOP_INTERVAL: 1000, // 1 second = constant new trades
  // Maximum open orders per bot per market (to avoid overcrowding)
  MAX_OPEN_ORDERS: 5,
};
