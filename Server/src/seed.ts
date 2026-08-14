// Seed initial assets and markets. Run with: npx tsx src/seed.ts
import { eq } from "drizzle-orm";
import { db, pool } from "./db/client";
import { assets, markets } from "./db/schema";

async function upsertAsset(symbol: string, name: string, type: "crypto" | "fiat" = "crypto", precision = 8) {
  const [existing] = await db.select().from(assets).where(eq(assets.symbol, symbol)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(assets)
    .values({ symbol, name, type, precision })
    .returning();
  if (!created) throw new Error(`Failed to insert asset ${symbol}`);
  return created;
}

async function upsertMarket(input: {
  symbol: string;
  baseSymbol: string;
  quoteSymbol: string;
  tickSize: string;
  stepSize: string;
  minOrderSize: string;
  maxOrderSize: string;
  maxLeverage: number;
  initialMarginRate: string;
  maintenanceMarginRate: string;
  makerFeeBps: number;
  takerFeeBps: number;
  fundingIntervalHours: number;
}) {
  const [existing] = await db.select().from(markets).where(eq(markets.symbol, input.symbol)).limit(1);
  if (existing) return existing;
  const [base] = await db.select().from(assets).where(eq(assets.symbol, input.baseSymbol)).limit(1);
  const [quote] = await db.select().from(assets).where(eq(assets.symbol, input.quoteSymbol)).limit(1);
  if (!base || !quote) throw new Error("base or quote asset missing");
  const [created] = await db
    .insert(markets)
    .values({
      symbol: input.symbol,
      baseAssetId: base.id,
      quoteAssetId: quote.id,
      tickSize: input.tickSize,
      stepSize: input.stepSize,
      minOrderSize: input.minOrderSize,
      maxOrderSize: input.maxOrderSize,
      maxLeverage: input.maxLeverage,
      initialMarginRate: input.initialMarginRate,
      maintenanceMarginRate: input.maintenanceMarginRate,
      makerFeeBps: input.makerFeeBps,
      takerFeeBps: input.takerFeeBps,
      fundingIntervalHours: input.fundingIntervalHours,
    })
    .returning();
  if (!created) throw new Error("market_create_failed");
  return created;
}

async function main() {
  await upsertAsset("USDT", "Tether USD", "crypto", 8);
  await upsertAsset("BTC", "Bitcoin", "crypto", 8);
  await upsertAsset("ETH", "Ethereum", "crypto", 8);
  await upsertAsset("USD", "US Dollar", "fiat", 2);

  await upsertMarket({
    symbol: "BTC-USDT-PERP",
    baseSymbol: "BTC",
    quoteSymbol: "USDT",
    tickSize: "0.5",
    stepSize: "0.0001",
    minOrderSize: "0.0001",
    maxOrderSize: "1000",
    maxLeverage: 50,
    initialMarginRate: "0.02",
    maintenanceMarginRate: "0.01",
    makerFeeBps: 10,
    takerFeeBps: 20,
    fundingIntervalHours: 8,
  });
  await upsertMarket({
    symbol: "ETH-USDT-PERP",
    baseSymbol: "ETH",
    quoteSymbol: "USDT",
    tickSize: "0.05",
    stepSize: "0.001",
    minOrderSize: "0.001",
    maxOrderSize: "10000",
    maxLeverage: 50,
    initialMarginRate: "0.02",
    maintenanceMarginRate: "0.01",
    makerFeeBps: 10,
    takerFeeBps: 20,
    fundingIntervalHours: 8,
  });
  console.log("Seed completed.");
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error("Seed failed:", e);
    pool.end().catch(() => {});
    process.exit(1);
  });
