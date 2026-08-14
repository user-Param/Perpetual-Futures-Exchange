import { Router, Request, Response } from "express";
import { desc, eq, or } from "drizzle-orm";
import { db } from "../db/client";
import { fills } from "../db/schema";
import { authRequired } from "../middleware/auth";

export const fillsRouter = Router();
fillsRouter.use(authRequired);

fillsRouter.get("/", async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const userId = req.user.userId;
  const rows = await db
    .select()
    .from(fills)
    .where(or(eq(fills.makerUserId, userId), eq(fills.takerUserId, userId)))
    .orderBy(desc(fills.createdAt))
    .limit(parseInt((req.query.limit as string) || "100", 10));
  res.json({ fills: rows });
});
