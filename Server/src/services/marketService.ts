import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { assets, fills, markets } from "../db/schema";
import { redis } from "../redis";

export async function listMarkets() {
  const rows = await db
    .select({
      id: markets.id,
      symbol: markets.symbol,
      baseAsset: sql<string>`base.symbol`,
      quoteAsset: sql<string>`quote.symbol`,
      status: markets.status,
      tickSize: markets.tickSize,
      stepSize: markets.stepSize,
      minOrderSize: markets.minOrderSize,
      maxOrderSize: markets.maxOrderSize,
      maxLeverage: markets.maxLeverage,
      initialMarginRate: markets.initialMarginRate,
      maintenanceMarginRate: markets.maintenanceMarginRate,
      makerFeeBps: markets.makerFeeBps,
      takerFeeBps: markets.takerFeeBps,
      fundingIntervalHours: markets.fundingIntervalHours,
    })
    .from(markets)
    .innerJoin(sql`${assets} as base`, sql`base.id = ${markets.baseAssetId}`)
    .innerJoin(sql`${assets} as quote`, sql`quote.id = ${markets.quoteAssetId}`)
    .where(eq(markets.status, "active"));
  return rows;
}

export async function getMarketBySymbol(symbol: string) {
  const [row] = await db
    .select({
      id: markets.id,
      symbol: markets.symbol,
      baseAssetId: markets.baseAssetId,
      quoteAssetId: markets.quoteAssetId,
      status: markets.status,
      tickSize: markets.tickSize,
      stepSize: markets.stepSize,
      minOrderSize: markets.minOrderSize,
      maxOrderSize: markets.maxOrderSize,
      maxLeverage: markets.maxLeverage,
      initialMarginRate: markets.initialMarginRate,
      maintenanceMarginRate: markets.maintenanceMarginRate,
      makerFeeBps: markets.makerFeeBps,
      takerFeeBps: markets.takerFeeBps,
      fundingIntervalHours: markets.fundingIntervalHours,
    })
    .from(markets)
    .where(eq(markets.symbol, symbol))
    .limit(1);
  if (!row) return null;
  return row;
}

export async function getOrderbookFromRedis(symbol: string, depth = 20) {
  const key = `orderbook:${symbol}`;
  const raw = await redis.get(key);
  if (!raw) return { bids: [], asks: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      bids: (parsed.bids || []).slice(0, depth),
      asks: (parsed.asks || []).slice(0, depth),
    };
  } catch {
    return { bids: [], asks: [] };
  }
}

export async function getRecentTrades(symbol: string, limit = 50) {
  const [market] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.symbol, symbol))
    .limit(1);
  if (!market) return [];
  const rows = await db
    .select()
    .from(fills)
    .where(eq(fills.marketId, market.id))
    .orderBy(desc(fills.createdAt))
    .limit(limit);
  return rows;
}

export async function getTicker24h(symbol: string) {
  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.symbol, symbol))
    .limit(1);
  if (!market) return null;
  const [agg] = await db
    .select({
      lastPrice: sql<string>`(
        SELECT price FROM ${fills} WHERE market_id = ${market.id} ORDER BY created_at DESC LIMIT 1
      )`,
      volume24h: sql<string>`COALESCE(SUM(quantity), 0)`,
      tradeCount: sql<number>`COUNT(*)::int`,
    })
    .from(fills);
  return {
    symbol: market.symbol,
    lastPrice: agg?.lastPrice ?? null,
    volume24h: agg?.volume24h ?? "0",
    tradeCount: agg?.tradeCount ?? 0,
  };
}
