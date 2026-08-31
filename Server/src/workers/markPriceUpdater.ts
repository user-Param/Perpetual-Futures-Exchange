import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { positions, markets } from "../db/schema";
import { D, gt } from "../utils/decimal";
import { redis, REDIS_MARK_PRICE_PREFIX } from "../redis";

interface MarkPriceData {
  price: string;
  timestamp: number;
  market: string;
}

async function getMarketIdBySymbol(symbol: string): Promise<string | null> {
  const [market] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.symbol, symbol))
    .limit(1);
  return market?.id ?? null;
}

async function updateMarkPrices(referencePrice: string, marketSymbol: string): Promise<void> {
  if (!gt(referencePrice, "0")) {
    console.warn("[markPriceUpdater] Invalid reference price, skipping update");
    return;
  }

  try {
    const marketId = await getMarketIdBySymbol(marketSymbol);
    if (!marketId) {
      console.warn(`[markPriceUpdater] Market not found: ${marketSymbol}`);
      return;
    }

    const marketRows = await db
      .select({ id: positions.marketId })
      .from(positions)
      .where(
        and(
          eq(positions.status, "open"),
          eq(positions.marketId, marketId)
        )
      );

    if (marketRows.length === 0) return;

    await db
      .update(positions)
      .set({ markPrice: referencePrice })
      .where(
        and(
          eq(positions.status, "open"),
          eq(positions.marketId, marketId)
        )
      );

    console.log(`[markPriceUpdater] Updated markPrice to ${referencePrice} for ${marketRows.length} open position(s) in ${marketSymbol}`);
  } catch (e) {
    console.error("[markPriceUpdater] Error updating mark prices:", (e as Error).message);
  }
}

function parseMarkPriceData(raw: string | null): MarkPriceData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.price !== "string" || typeof parsed.timestamp !== "number" || typeof parsed.market !== "string") {
      return null;
    }
    if (!gt(parsed.price, "0")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function startMarkPriceUpdater(): Promise<void> {
  console.log("[markPriceUpdater] Starting mark price updater");

  const POLL_INTERVAL_MS = 5000;
  const MAX_STALENESS_MS = 30000;

  setInterval(async () => {
    try {
      const activeMarkets = await db
        .select({ symbol: markets.symbol })
        .from(markets)
        .where(eq(markets.status, "active"));

      for (const m of activeMarkets) {
        const raw = await redis.get(`${REDIS_MARK_PRICE_PREFIX}${m.symbol}`);
        const data = parseMarkPriceData(raw);

        if (!data) continue;

        const age = Date.now() - data.timestamp;
        if (age > MAX_STALENESS_MS) {
          console.warn(`[markPriceUpdater] Reference price for ${m.symbol} is stale (age: ${age}ms), skipping`);
          continue;
        }

        await updateMarkPrices(data.price, data.market);
      }
    } catch (e) {
      console.error("[markPriceUpdater] Polling error:", (e as Error).message);
    }
  }, POLL_INTERVAL_MS);
}