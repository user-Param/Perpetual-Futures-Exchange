import { Router, Request, Response } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import {
  deposit,
  listUserBalances,
  withdraw,
} from "../services/balanceService";

export const balancesRouter = Router();

balancesRouter.use(authRequired);

balancesRouter.get("/", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const rows = await listUserBalances(req.user.userId);
  res.json({ balances: rows });
});

const amountSchema = z.object({
  asset: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

balancesRouter.post("/deposit", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = amountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await deposit(req.user.userId, parsed.data.asset, parsed.data.amount);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? "internal_error" });
  }
});

balancesRouter.post("/withdraw", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const parsed = amountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await withdraw(req.user.userId, parsed.data.asset, parsed.data.amount);
    res.json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? "internal_error" });
  }
});
