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
   await upsertAsset("SOL", "Solana", "crypto", 8);
  await upsertAsset("XRP", "Ripple", "crypto", 8);
  await upsertAsset("ADA", "Cardano", "crypto", 8);
  await upsertAsset("DOGE", "Dogecoin", "crypto", 8);
  await upsertAsset("DOT", "Polkadot", "crypto", 8);
  await upsertAsset("LINK", "Chainlink", "crypto", 8);
  await upsertAsset("MATIC", "Polygon", "crypto", 8);
  await upsertAsset("AVAX", "Avalanche", "crypto", 8);
  await upsertAsset("UNI", "Uniswap", "crypto", 8);
  await upsertAsset("ATOM", "Cosmos", "crypto", 8);
  await upsertAsset("LTC", "Litecoin", "crypto", 8);
  await upsertAsset("BCH", "Bitcoin Cash", "crypto", 8);
  await upsertAsset("NEAR", "NEAR Protocol", "crypto", 8);

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

  // ADD NEW MARKETS
  const newMarkets = [
    {
      symbol: "SOL-USDT-PERP",
      baseSymbol: "SOL",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "XRP-USDT-PERP",
      baseSymbol: "XRP",
      tickSize: "0.0001",
      stepSize: "0.001",
      minOrderSize: "0.1",
      maxOrderSize: "100000",
      maxLeverage: 50,
    },
    {
      symbol: "ADA-USDT-PERP",
      baseSymbol: "ADA",
      tickSize: "0.0001",
      stepSize: "0.001",
      minOrderSize: "1",
      maxOrderSize: "100000",
      maxLeverage: 50,
    },
    {
      symbol: "DOGE-USDT-PERP",
      baseSymbol: "DOGE",
      tickSize: "0.00001",
      stepSize: "0.001",
      minOrderSize: "10",
      maxOrderSize: "1000000",
      maxLeverage: 50,
    },
    {
      symbol: "DOT-USDT-PERP",
      baseSymbol: "DOT",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "LINK-USDT-PERP",
      baseSymbol: "LINK",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "MATIC-USDT-PERP",
      baseSymbol: "MATIC",
      tickSize: "0.0001",
      stepSize: "0.001",
      minOrderSize: "0.1",
      maxOrderSize: "100000",
      maxLeverage: 50,
    },
    {
      symbol: "AVAX-USDT-PERP",
      baseSymbol: "AVAX",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "UNI-USDT-PERP",
      baseSymbol: "UNI",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "ATOM-USDT-PERP",
      baseSymbol: "ATOM",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "LTC-USDT-PERP",
      baseSymbol: "LTC",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "BCH-USDT-PERP",
      baseSymbol: "BCH",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
    {
      symbol: "NEAR-USDT-PERP",
      baseSymbol: "NEAR",
      tickSize: "0.01",
      stepSize: "0.001",
      minOrderSize: "0.01",
      maxOrderSize: "10000",
      maxLeverage: 50,
    },
  ];

  for (const m of newMarkets) {
    await upsertMarket({
      symbol: m.symbol,
      baseSymbol: m.baseSymbol,
      quoteSymbol: "USDT",
      tickSize: m.tickSize,
      stepSize: m.stepSize,
      minOrderSize: m.minOrderSize,
      maxOrderSize: m.maxOrderSize,
      maxLeverage: m.maxLeverage,
      initialMarginRate: "0.02",
      maintenanceMarginRate: "0.01",
      makerFeeBps: 10,
      takerFeeBps: 20,
      fundingIntervalHours: 8,
    });
  }

  console.log("Seed completed.");
}









main()
  .then(() => pool.end())
  .catch((e) => {
    console.error("Seed failed:", e);
    pool.end().catch(() => {});
    process.exit(1);
  });
