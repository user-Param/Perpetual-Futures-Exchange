import { Router, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { fundingPayments } from "../db/schema";
import { authRequired } from "../middleware/auth";

export const fundingRouter = Router();
fundingRouter.use(authRequired);

fundingRouter.get("/payments", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const rows = await db
    .select()
    .from(fundingPayments)
    .where(eq(fundingPayments.userId, req.user.userId))
    .orderBy(desc(fundingPayments.createdAt))
    .limit(parseInt((req.query.limit as string) || "100", 10));
  res.json({ payments: rows });
});
