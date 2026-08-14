import { Router, Request, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { assets, markets, orders, positions } from "../db/schema";
import { authRequired } from "../middleware/auth";
import { lockBalance } from "../services/balanceService";
import { D, mul } from "../utils/decimal";
import { REDIS_ORDER_COMMANDS_STREAM, redis } from "../redis";

export const positionsRouter = Router();
positionsRouter.use(authRequired);

positionsRouter.get("/", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const status = (req.query.status as string) || "open";
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.userId, req.user.userId), eq(positions.status, status as "open" | "closed" | "liquidated")))
    .orderBy(desc(positions.openedAt));
  res.json({ positions: rows });
});

positionsRouter.get("/:id", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [row] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, String(req.params.id)), eq(positions.userId, req.user.userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(row);
});

positionsRouter.post("/:id/close", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const [pos] = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, String(req.params.id)), eq(positions.userId, req.user.userId)))
    .limit(1);
  if (!pos) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (pos.status !== "open") {
    res.status(400).json({ error: "position_not_open" });
    return;
  }
  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, pos.marketId))
    .limit(1);
  if (!market) {
    res.status(404).json({ error: "market_not_found" });
    return;
  }
  const closeSide = pos.side === "long" ? "sell" : "buy";
  const orderId = uuidv4();
  const [order] = await db
    .insert(orders)
    .values({
      id: orderId,
      userId: req.user.userId,
      marketId: market.id,
      orderType: "market",
      side: closeSide,
      price: null,
      quantity: pos.quantity,
      filledQuantity: "0",
      status: "open",
      reduceOnly: true,
      postOnly: false,
      timeInForce: "GTC",
      leverage: "1",
      marginMode: pos.marginMode,
    })
    .returning();
  if (!order) {
    res.status(500).json({ error: "order_create_failed" });
    return;
  }
  await redis.xadd(
    REDIS_ORDER_COMMANDS_STREAM,
    "*",
    "type",
    "PLACE_ORDER",
    "orderId",
    orderId,
    "userId",
    req.user.userId,
    "market",
    market.symbol,
    "side",
    closeSide,
    "orderType",
    "market",
    "quantity",
    pos.quantity,
    "timeInForce",
    "GTC",
    "reduceOnly",
    "true",
    "postOnly",
    "false",
    "leverage",
    "1",
    "marginMode",
    pos.marginMode
  );
  res.json({ order });
});
