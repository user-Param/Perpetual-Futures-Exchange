import express, { Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { authRouter } from "./routes/auth";
import { balancesRouter } from "./routes/balances";
import { marketsRouter } from "./routes/markets";
import { ordersRouter } from "./routes/orders";
import { positionsRouter } from "./routes/positions";
import { fillsRouter } from "./routes/fills";
import { fundingRouter } from "./routes/funding";
import { startOutboxWorker } from "./workers/outboxWorker";
import { startDbWriter } from "./workers/dbWriter";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/balances", balancesRouter);
app.use("/api/v1/markets", marketsRouter);
app.use("/api/v1/orders", ordersRouter);
app.use("/api/v1/positions", positionsRouter);
app.use("/api/v1/fills", fillsRouter);
app.use("/api/v1/funding", fundingRouter);

app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error("unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

async function main() {
  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
  startOutboxWorker(150);
  try {
    await startDbWriter();
  } catch (e) {
    console.error("Failed to start DB writer:", (e as Error).message);
  }
}

main().catch((e) => {
  console.error("fatal startup error:", e);
  process.exit(1);
});
