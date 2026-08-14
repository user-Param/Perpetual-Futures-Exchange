import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on("error", (err) => {
  console.error("Redis error:", err.message);
});

export const REDIS_ORDER_COMMANDS_STREAM = "order_commands";
export const REDIS_ENGINE_EVENTS_CHANNEL = "engine_events";
export const REDIS_ORDERBOOK_UPDATES_CHANNEL = "orderbook_updates";
export const REDIS_TRADE_UPDATES_CHANNEL = "trade_updates";
