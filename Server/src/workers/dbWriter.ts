import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { assets, fills, markets, orders, positions } from "../db/schema";
import { D, add, mul, sub, gt } from "../utils/decimal";
import { unlockBalance, debitLocked } from "../services/balanceService";
import {
  REDIS_ENGINE_EVENTS_CHANNEL,
  redis,
} from "../redis";
import { publishEngineEvent } from "../kafka";

interface EngineEvent {
  type: string;
  orderId?: string;
  market?: string;
  price?: string;
  quantity?: string;
  makerOrderId?: string;
  takerOrderId?: string;
  makerUserId?: string;
  takerUserId?: string;
  side?: "buy" | "sell";
  reason?: string;
  bids?: Array<[string, string]>;
  asks?: Array<[string, string]>;
}

// Credit available balance, creating the balance row if the user does not have one yet.
async function creditAvailable(tx: any, userId: string, assetId: string, amount: string) {
  await tx.execute(
    sql`INSERT INTO balances (id, user_id, asset_id, available_balance, locked_balance, updated_at)
        VALUES (gen_random_uuid(), ${userId}, ${assetId}, ${amount}::numeric, 0, NOW())
        ON CONFLICT (user_id, asset_id)
        DO UPDATE SET available_balance = balances.available_balance + ${amount}::numeric, updated_at = NOW()`
  );
}

async function debitAvailable(tx: any, userId: string, assetId: string, amount: string) {
  await tx.execute(
    sql`UPDATE balances SET available_balance = available_balance - ${amount}::numeric, updated_at = NOW() WHERE user_id = ${userId} AND asset_id = ${assetId}`
  );
}

async function applyTradeToOrder(orderId: string, fillQty: string, fillPrice: string) {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return;
    const newFilled = D(order.filledQuantity).plus(D(fillQty));
    const status =
      D(newFilled.toString()).gte(D(order.quantity))
        ? "filled"
        : D(newFilled.toString()).gt(0)
          ? "partially_filled"
          : order.status;
    await tx
      .update(orders)
      .set({
        filledQuantity: newFilled.toString(),
        status,
        updatedAt: new Date(),
        executedAt: status === "filled" ? new Date() : order.executedAt,
        price: order.price || fillPrice,
      })
      .where(eq(orders.id, orderId));
  });
}

async function handleOrderAccepted(ev: EngineEvent) {
  if (!ev.orderId) return;
  await db
    .update(orders)
    .set({ status: "open", updatedAt: new Date() })
    .where(eq(orders.id, ev.orderId));
}

async function unlockOrderMargin(order: any) {
  const [market] = await db.select().from(markets).where(eq(markets.id, order.marketId)).limit(1);
  if (!market) return;
  const remaining = D(order.quantity).minus(D(order.filledQuantity));
  if (order.side === "buy" && order.price) {
    const cost = mul(order.price, remaining.toString());
    const leverage = order.leverage || "1";
    const margin = D(cost).div(D(leverage)).toString();
    if (gt(margin, "0")) {
      await unlockBalance(order.userId, market.quoteAssetId, margin);
    }
  } else {
    if (gt(remaining.toString(), "0")) {
      await unlockBalance(order.userId, market.baseAssetId, remaining.toString());
    }
  }
}

async function handleOrderRejected(ev: EngineEvent) {
  if (!ev.orderId) return;
  const [order] = await db.select().from(orders).where(eq(orders.id, ev.orderId)).limit(1);
  if (order && !["filled", "canceled", "expired"].includes(order.status)) {
    // A post-only order that would cross is rejected by the engine; release its locked margin.
    await unlockOrderMargin(order);
  }
  await db
    .update(orders)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(orders.id, ev.orderId));
}

async function handleOrderFilled(ev: EngineEvent) {
  if (!ev.orderId) return;
  await db
    .update(orders)
    .set({ status: "filled", updatedAt: new Date(), executedAt: new Date() })
    .where(eq(orders.id, ev.orderId));
}

async function handleOrderCanceled(ev: EngineEvent) {
  if (!ev.orderId) return;
  const [order] = await db.select().from(orders).where(eq(orders.id, ev.orderId)).limit(1);
  if (!order) return;
  if (["filled", "rejected", "expired"].includes(order.status)) {
    return; // already terminal; nothing to unlock
  }
  // Unlock remaining balance
  await unlockOrderMargin(order);
  await db
    .update(orders)
    .set({ status: "canceled", updatedAt: new Date(), executedAt: new Date() })
    .where(eq(orders.id, ev.orderId));
}

async function handleTradeExecuted(ev: EngineEvent) {
  if (
    !ev.market ||
    !ev.makerOrderId ||
    !ev.takerOrderId ||
    !ev.makerUserId ||
    !ev.takerUserId ||
    !ev.price ||
    !ev.quantity ||
    !ev.side
  ) {
    return;
  }
  const [market] = await db.select().from(markets).where(eq(markets.symbol, ev.market)).limit(1);
  if (!market) return;
  const [baseAsset] = await db.select().from(assets).where(eq(assets.id, market.baseAssetId)).limit(1);
  const [quoteAsset] = await db
    .select()
    .from(assets)
    .where(eq(assets.id, market.quoteAssetId))
    .limit(1);
  if (!baseAsset || !quoteAsset) return;

  const takerFeeBps = market.takerFeeBps;
  const makerFeeBps = market.makerFeeBps;
  const feeRate = (bps: number) => D(bps).div(10000).toString();
  const takerFee = mul(ev.price, mul(ev.quantity, feeRate(takerFeeBps)));
  const makerFee = mul(ev.price, mul(ev.quantity, feeRate(makerFeeBps)));
  const notional = mul(ev.price, ev.quantity);

  await db.transaction(async (tx) => {
    const [fill] = await tx
      .insert(fills)
      .values({
        marketId: market.id,
        makerOrderId: ev.makerOrderId!,
        takerOrderId: ev.takerOrderId!,
        makerUserId: ev.makerUserId!,
        takerUserId: ev.takerUserId!,
        side: ev.side!,
        price: ev.price!,
        quantity: ev.quantity!,
        makerFee,
        takerFee,
      })
      .returning();
    if (!fill) return;

    // Settle balances:
    // Maker: provides liquidity.
    // Taker: takes liquidity.
    // For buy taker: taker pays quote (price*qty + takerFee), receives base (qty).
    // For sell taker: taker pays base (qty), receives quote (price*qty - takerFee).
    if (ev.side === "buy") {
      // Taker is buyer, maker is seller.
      // Taker: -quote(notional + takerFee), +base(qty)
      // Maker: -base(qty), +quote(notional - makerFee)
      // Quote: taker locked the margin; convert locked->spent on notional portion, then debit fees from available.
      // For simplicity in v1, we operate on locked balance:
      //   - Debit locked quote for taker up to notional; debit available for taker fee.
      //   - Credit available quote for maker (after fee); debit locked base for maker.
      const [takerOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, ev.takerOrderId!))
        .limit(1);
      if (takerOrder) {
        const leverage = takerOrder.leverage || "1";
        const margin = D(notional).div(D(leverage)).toString();
        await debitLocked(takerOrder.userId, market.quoteAssetId, margin);
        // Debit taker fee from available
        await debitAvailable(tx, takerOrder.userId, market.quoteAssetId, takerFee);
        // Credit base (qty) to available
        await creditAvailable(tx, takerOrder.userId, market.baseAssetId, ev.quantity!);
      }
      const [makerOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, ev.makerOrderId!))
        .limit(1);
      if (makerOrder) {
        await debitLocked(makerOrder.userId, market.baseAssetId, ev.quantity!);
        const makerProceeds = D(notional).minus(D(makerFee)).toString();
        await creditAvailable(tx, makerOrder.userId, market.quoteAssetId, makerProceeds);
      }
    } else {
      // Taker is seller, maker is buyer.
      // Taker: -base(qty), +quote(notional - takerFee)
      // Maker: -quote(notional), +base(qty) ; maker fee charged on quote
      const [takerOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, ev.takerOrderId!))
        .limit(1);
      if (takerOrder) {
        await debitLocked(takerOrder.userId, market.baseAssetId, ev.quantity!);
        const takerProceeds = D(notional).minus(D(takerFee)).toString();
        await creditAvailable(tx, takerOrder.userId, market.quoteAssetId, takerProceeds);
      }
      const [makerOrder] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, ev.makerOrderId!))
        .limit(1);
      if (makerOrder) {
        const leverage = makerOrder.leverage || "1";
        const margin = D(notional).div(D(leverage)).toString();
        await debitLocked(makerOrder.userId, market.quoteAssetId, margin);
        await debitAvailable(tx, makerOrder.userId, market.quoteAssetId, makerFee);
        await creditAvailable(tx, makerOrder.userId, market.baseAssetId, ev.quantity!);
      }
    }

    // Update order fill quantities
    await applyTradeToOrder(ev.makerOrderId!, ev.quantity!, ev.price!);
    await applyTradeToOrder(ev.takerOrderId!, ev.quantity!, ev.price!);

    // Update positions (simple version: one open position per (user, market, side))
    await upsertPosition(
      tx,
      market.id,
      market.baseAssetId,
      ev.takerUserId!,
      ev.takerOrderId!,
      ev.side!,
      ev.price!,
      ev.quantity!,
      takerOrderLeverage(tx, ev.takerOrderId!),
      takerOrderMarginMode(tx, ev.takerOrderId!)
    );
    await upsertPosition(
      tx,
      market.id,
      market.baseAssetId,
      ev.makerUserId!,
      ev.makerOrderId!,
      ev.side === "buy" ? "sell" : "buy",
      ev.price!,
      ev.quantity!,
      makerOrderLeverage(tx, ev.makerOrderId!),
      makerOrderMarginMode(tx, ev.makerOrderId!)
    );
  });
}

function takerOrderLeverage(tx: any, orderId: string): string {
  return "1"; // placeholder; will query below
}
function takerOrderMarginMode(tx: any, orderId: string): "isolated" | "cross" {
  return "isolated";
}
function makerOrderLeverage(tx: any, orderId: string): string {
  return "1";
}
function makerOrderMarginMode(tx: any, orderId: string): "isolated" | "cross" {
  return "isolated";
}

async function upsertPosition(
  tx: any,
  marketId: string,
  _baseAssetId: string,
  userId: string,
  orderId: string,
  aggressorSide: "buy" | "sell",
  price: string,
  quantity: string,
  leverage: string,
  marginMode: "isolated" | "cross"
) {
  const positionSide = aggressorSide === "buy" ? "long" : "short";
  const [existing] = await tx
    .select()
    .from(positions)
    .where(
      and(
        eq(positions.userId, userId),
        eq(positions.marketId, marketId),
        eq(positions.status, "open")
      )
    )
    .limit(1);

  if (!existing) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const lev = order ? order.leverage : leverage;
    const mm = order ? order.marginMode : marginMode;
    const margin = D(price).times(D(quantity)).div(D(lev)).toString();
    await tx.insert(positions).values({
      userId,
      marketId,
      side: positionSide,
      quantity,
      entryPrice: price,
      markPrice: price,
      liquidationPrice: price, // simplified
      margin,
      leverage: parseInt(lev, 10) || 1,
      marginMode: mm,
      status: "open",
    });
  } else {
    // Same side → add to position with weighted average entry.
    // Opposite side → reduce position.
    if (existing.side === positionSide) {
      const newQty = D(existing.quantity).plus(D(quantity));
      const newEntry = D(existing.entryPrice)
        .times(D(existing.quantity))
        .plus(D(price).times(D(quantity)))
        .div(newQty)
        .toString();
      await tx
        .update(positions)
        .set({
          quantity: newQty.toString(),
          entryPrice: newEntry,
          markPrice: price,
        })
        .where(eq(positions.id, existing.id));
    } else {
      const newQty = D(existing.quantity).minus(D(quantity));
      if (newQty.lte(0)) {
        // close
        const pnl = D(price).minus(D(existing.entryPrice))
          .times(D(existing.quantity))
          .times(existing.side === "long" ? 1 : -1)
          .toString();
        await tx
          .update(positions)
          .set({
            quantity: "0",
            status: "closed",
            closedAt: new Date(),
            realizedPnl: D(existing.realizedPnl).plus(D(pnl)).toString(),
            markPrice: price,
          })
          .where(eq(positions.id, existing.id));
      } else {
        await tx
          .update(positions)
          .set({ quantity: newQty.toString(), markPrice: price })
          .where(eq(positions.id, existing.id));
      }
    }
  }
}

async function handleOrderBookUpdated(ev: EngineEvent) {
  if (!ev.market) return;
  const key = `orderbook:${ev.market}`;
  const value = JSON.stringify({ bids: ev.bids || [], asks: ev.asks || [], ts: Date.now() });
  await redis.set(key, value, "EX", 300);
}

let started = false;

async function handleMessage(raw: string): Promise<void> {
  const ev: EngineEvent = JSON.parse(raw);
  // Mirror to Kafka for durable storage
  try {
    await publishEngineEvent(ev as unknown as Record<string, unknown>);
  } catch (e) {
    console.error("kafka publish error:", (e as Error).message);
  }
  switch (ev.type) {
    case "ORDER_ACCEPTED":
      await handleOrderAccepted(ev);
      break;
    case "ORDER_REJECTED":
      await handleOrderRejected(ev);
      break;
    case "ORDER_FILLED":
      await handleOrderFilled(ev);
      break;
    case "ORDER_CANCELED":
      await handleOrderCanceled(ev);
      break;
    case "TRADE_EXECUTED":
      await handleTradeExecuted(ev);
      break;
    case "ORDER_BOOK_UPDATED":
      await handleOrderBookUpdated(ev);
      break;
    default:
      break;
  }
}

export async function startDbWriter(): Promise<void> {
  if (started) return;
  started = true;
  const sub = redis.duplicate();
  await sub.subscribe(REDIS_ENGINE_EVENTS_CHANNEL);
  // Process messages serially so events are applied in publication order.
  let chain: Promise<void> = Promise.resolve();
  sub.on("message", (channel, raw) => {
    if (channel !== REDIS_ENGINE_EVENTS_CHANNEL) return;
    chain = chain
      .then(() => handleMessage(raw))
      .catch((e) => console.error("db writer error:", (e as Error).message));
  });
  console.log("DB Writer subscribed to", REDIS_ENGINE_EVENTS_CHANNEL);
}
