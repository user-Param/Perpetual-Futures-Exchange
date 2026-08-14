import { Router, Request, Response } from "express";
import {
  getMarketBySymbol,
  getOrderbookFromRedis,
  getRecentTrades,
  getTicker24h,
  listMarkets,
} from "../services/marketService";

export const marketsRouter = Router();

marketsRouter.get("/", async (_req: Request, res: Response) => {
  const rows = await listMarkets();
  res.json({ markets: rows });
});

marketsRouter.get("/:symbol", async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol);
  const m = await getMarketBySymbol(symbol);
  if (!m) {
    res.status(404).json({ error: "market_not_found" });
    return;
  }
  res.json(m);
});

marketsRouter.get("/:symbol/orderbook", async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol);
  const depth = parseInt((req.query.depth as string) || "20", 10);
  const ob = await getOrderbookFromRedis(symbol, depth);
  res.json({ symbol, ...ob });
});

marketsRouter.get("/:symbol/trades", async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol);
  const limit = parseInt((req.query.limit as string) || "50", 10);
  const trades = await getRecentTrades(symbol, limit);
  res.json({ symbol, trades });
});

marketsRouter.get("/:symbol/ticker", async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol);
  const t = await getTicker24h(symbol);
  if (!t) {
    res.status(404).json({ error: "market_not_found" });
    return;
  }
  res.json(t);
});
