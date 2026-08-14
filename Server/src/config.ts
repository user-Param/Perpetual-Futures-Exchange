import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me-in-production-please",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  databaseUrl:
    process.env.DATABASE_URL || "postgres://param@localhost:5432/exchange",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  feeMode: process.env.FEE_MODE || "taker_only", // taker_only | both
  defaultMakerFeeBps: parseInt(process.env.MAKER_FEE_BPS || "10", 10),
  defaultTakerFeeBps: parseInt(process.env.TAKER_FEE_BPS || "20", 10),
};
