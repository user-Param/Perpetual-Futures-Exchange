import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { assets, markets, orders, outbox } from "../db/schema";
import { D, gte, gt, lte, mul, lt } from "../utils/decimal";
import { REDIS_ORDER_COMMANDS_STREAM, redis } from "../redis";
import { getOrCreateBalance, lockBalance } from "./balanceService";

interface PlaceOrderInput {
  userId: string;
  market: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  price?: string;
  quantity: string;
  timeInForce?: "GTC" | "IOC" | "FOK";
  leverage?: string;
  marginMode?: "isolated" | "cross";
  reduceOnly?: boolean;
  postOnly?: boolean;
  clientOrderId?: string;
}

export async function placeOrder(input: PlaceOrderInput) {
  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.symbol, input.market))
    .limit(1);
  if (!market) {
    throw Object.assign(new Error("market_not_found"), { status: 404 });
  }
  if (market.status !== "active") {
    throw Object.assign(new Error("market_not_active"), { status: 400 });
  }
  if (!gt(input.quantity, "0")) {
    throw Object.assign(new Error("quantity_must_be_positive"), { status: 400 });
  }
  if (lt(input.quantity, market.minOrderSize)) {
    throw Object.assign(new Error("quantity_below_min"), { status: 400 });
  }
  if (gt(input.quantity, market.maxOrderSize)) {
    throw Object.assign(new Error("quantity_above_max"), { status: 400 });
  }
  if (input.orderType === "limit" && !input.price) {
    throw Object.assign(new Error("limit_order_requires_price"), { status: 400 });
  }
  if (input.price && lte(input.price, "0")) {
    throw Object.assign(new Error("price_must_be_positive"), { status: 400 });
  }
  const leverage = input.leverage || "1";
  if (D(leverage).gt(D(market.maxLeverage))) {
    throw Object.assign(new Error("leverage_exceeds_max"), { status: 400 });
  }

  // Idempotency: if clientOrderId is provided and order already exists, return it.
  if (input.clientOrderId) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.userId, input.userId),
          eq(orders.clientOrderId, input.clientOrderId)
        )
      )
      .limit(1);
    if (existing) {
      return { order: existing, idempotent: true };
    }
  }

  // For buy orders, lock quote (USDT) using price * quantity / leverage. For sells, lock base.
  if (input.side === "buy") {
    if (!input.price) {
      throw Object.assign(new Error("market_buy_requires_price_for_margin_calc"), {
        status: 400,
      });
    }
    const cost = mul(input.price, input.quantity);
    const margin = D(cost).div(D(leverage)).toString();
    await lockBalance(input.userId, market.quoteAssetId, margin);
  } else {
    await lockBalance(input.userId, market.baseAssetId, input.quantity);
  }

  const orderId = uuidv4();
  const [inserted] = await db
    .insert(orders)
    .values({
      id: orderId,
      userId: input.userId,
      marketId: market.id,
      clientOrderId: input.clientOrderId || null,
      orderType: input.orderType,
      side: input.side,
      price: input.price || null,
      quantity: input.quantity,
      filledQuantity: "0",
      status: "open",
      reduceOnly: input.reduceOnly ?? false,
      postOnly: input.postOnly ?? false,
      timeInForce: input.timeInForce ?? "GTC",
      leverage,
      marginMode: input.marginMode ?? "isolated",
    })
    .returning();
  if (!inserted) throw new Error("order_create_failed");

  // Outbox event (durable record; may be republished by the outbox worker on crash).
  const commandPayload = {
    orderId,
    userId: input.userId,
    market: input.market,
    side: input.side,
    orderType: input.orderType,
    price: input.price || null,
    quantity: input.quantity,
    timeInForce: input.timeInForce ?? "GTC",
    reduceOnly: input.reduceOnly ?? false,
    postOnly: input.postOnly ?? false,
    clientOrderId: input.clientOrderId || null,
    leverage,
    marginMode: input.marginMode ?? "isolated",
    sequence: Date.now(),
    timestamp: Date.now(),
  };
  const [outboxRow] = await db
    .insert(outbox)
    .values({
      eventType: "order_created",
      aggregateId: orderId,
      payload: commandPayload,
    })
    .returning();

  // Publish the command synchronously so it always precedes any subsequent
  // CANCEL_ORDER in the stream (the outbox worker only republishes after a crash).
  await redis.xadd(
    REDIS_ORDER_COMMANDS_STREAM,
    "*",
    "type",
    "PLACE_ORDER",
    "payload",
    JSON.stringify(commandPayload)
  );
  if (outboxRow) {
    await db.update(outbox).set({ publishedAt: new Date() }).where(eq(outbox.id, outboxRow.id));
  }

  return { order: inserted, idempotent: false };
}

export async function listUserOrders(
  userId: string,
  filters: { status?: string; market?: string; limit?: number }
) {
  const conditions = [eq(orders.userId, userId)];
  if (filters.status) {
    conditions.push(eq(orders.status, filters.status as "open" | "filled" | "canceled"));
  }
  let marketId: string | undefined;
  if (filters.market) {
    const [m] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.symbol, filters.market))
      .limit(1);
    if (!m) return [];
    marketId = m.id;
    conditions.push(eq(orders.marketId, marketId));
  }
  const rows = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(filters.limit || 100);
  return rows;
}

export async function getOrderById(orderId: string, userId?: string) {
  const conditions = [eq(orders.id, orderId)];
  if (userId) conditions.push(eq(orders.userId, userId));
  const [row] = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .limit(1);
  return row || null;
}

export async function cancelOrder(orderId: string, userId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);
  if (!order) {
    throw Object.assign(new Error("order_not_found"), { status: 404 });
  }
  if (["filled", "canceled", "rejected", "expired"].includes(order.status)) {
    throw Object.assign(new Error("order_not_cancellable"), { status: 400 });
  }
  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, order.marketId))
    .limit(1);
  if (!market) throw new Error("market_not_found");

  // Send cancel command via Redis Stream (engine handles state).
  await redis.xadd(
    REDIS_ORDER_COMMANDS_STREAM,
    "*",
    "type",
    "CANCEL_ORDER",
    "orderId",
    orderId,
    "market",
    market.symbol,
    "userId",
    userId
  );

  // Mark canceled optimistically; engine will publish ORDER_CANCELED which we treat idempotently.
  await db
    .update(orders)
    .set({ status: "canceled", updatedAt: new Date(), executedAt: new Date() })
    .where(eq(orders.id, orderId));

  return { orderId, status: "canceled" };
}

export async function cancelAllOpenOrders(userId: string, marketSymbol?: string) {
  const conditions = [
    eq(orders.userId, userId),
    inArray(orders.status, ["open", "partially_filled", "pending"]),
  ];
  if (marketSymbol) {
    const [m] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.symbol, marketSymbol))
      .limit(1);
    if (!m) return { canceled: 0 };
    conditions.push(eq(orders.marketId, m.id));
  }
  const open = await db
    .select({ id: orders.id, marketId: orders.marketId })
    .from(orders)
    .where(and(...conditions));
  let count = 0;
  for (const o of open) {
    try {
      await cancelOrder(o.id, userId);
      count += 1;
    } catch {
      // ignore individual failures
    }
  }
  return { canceled: count };
}
