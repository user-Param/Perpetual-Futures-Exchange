import "dotenv/config";

export const config = {
  exchange: {
    apiUrl: process.env.EXCHANGE_API_URL || "http://localhost:3000",
    email: process.env.EXCHANGE_EMAIL || "marketmaker@example.com",
    password: process.env.EXCHANGE_PASSWORD || "marketmaker123",
  },
  binance: {
    symbol: process.env.BINANCE_SYMBOL || "BTCUSDT",
    wsUrl:
      process.env.BINANCE_WS_URL ||
      "wss://fstream.binance.com/ws/btcusdt@markPrice",
  },
  market: process.env.MARKET || "BTC-USDT-PERP",
  spreadBps: parseInt(process.env.SPREAD_BPS || "10", 10),
  orderSize: process.env.ORDER_SIZE || "0.001",
  quoteRefreshMs: parseInt(process.env.QUOTE_REFRESH_MS || "1000", 10),
  priceStaleMs: parseInt(process.env.PRICE_STALE_MS || "5000", 10),
  maxPosition: process.env.MAX_POSITION || "0.1",
  healthPort: parseInt(process.env.HEALTH_PORT || "8080", 10),
  logLevel: process.env.LOG_LEVEL || "info",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
};

export function validateConfig(): void {
  if (config.spreadBps <= 0) {
    throw new Error("SPREAD_BPS must be positive");
  }
  if (parseFloat(config.orderSize) <= 0) {
    throw new Error("ORDER_SIZE must be positive");
  }
  if (config.quoteRefreshMs <= 0) {
    throw new Error("QUOTE_REFRESH_MS must be positive");
  }
  if (config.priceStaleMs <= 0) {
    throw new Error("PRICE_STALE_MS must be positive");
  }
  if (parseFloat(config.maxPosition) <= 0) {
    throw new Error("MAX_POSITION must be positive");
  }
}