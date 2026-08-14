import { Router, Request, Response } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import {
  cancelAllOpenOrders,
  cancelOrder,
  getOrderById,
  listUserOrders,
  placeOrder,
} from "../services/orderService";

export const ordersRouter = Router();
ordersRouter.use(authRequired);

const placeOrderSchema = z.object({
  market: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  orderType: z.enum(["market", "limit"]),
  price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  timeInForce: z.enum(["GTC", "IOC", "FOK"]).optional(),
  leverage: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  marginMode: z.enum(["isolated", "cross"]).optional(),
  reduceOnly: z.boolean().optional(),
  postOnly: z.boolean().optional(),
  clientOrderId: z.string().min(1).max(128).optional(),
});

ordersRouter.post("/", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await placeOrder({ ...parsed.data, userId: req.user.userId });
    res.status(result.idempotent ? 200 : 201).json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? "internal_error" });
  }
});

ordersRouter.get("/", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const status = req.query.status as string | undefined;
  const market = req.query.market as string | undefined;
  const limit = parseInt((req.query.limit as string) || "100", 10);
  const rows = await listUserOrders(req.user.userId, { status, market, limit });
  res.json({ orders: rows });
});

ordersRouter.get("/:id", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const order = await getOrderById(String(req.params.id), req.user.userId);
  if (!order) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(order);
});

ordersRouter.delete("/:id", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const result = await cancelOrder(String(req.params.id), req.user.userId);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? "internal_error" });
  }
});

ordersRouter.delete("/", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const market = req.query.market as string | undefined;
  const result = await cancelAllOpenOrders(req.user.userId, market);
  res.json(result);
});
