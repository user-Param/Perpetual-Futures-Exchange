import { and, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { outbox } from "../db/schema";
import { REDIS_ORDER_COMMANDS_STREAM, redis } from "../redis";

let running = false;
let timer: NodeJS.Timeout | null = null;

export async function publishOutboxBatch(): Promise<number> {
  const pending = await db
    .select()
    .from(outbox)
    .where(isNull(outbox.publishedAt))
    .limit(100);
  let published = 0;
  for (const row of pending) {
    try {
      if (row.eventType === "order_created") {
        const payload = row.payload as Record<string, unknown>;
        await redis.xadd(
          REDIS_ORDER_COMMANDS_STREAM,
          "*",
          "type",
          "PLACE_ORDER",
          "payload",
          JSON.stringify(payload)
        );
      }
      await db
        .update(outbox)
        .set({ publishedAt: new Date() })
        .where(sql`${outbox.id} = ${row.id}`);
      published += 1;
    } catch (err) {
      console.error("outbox publish error:", (err as Error).message);
    }
  }
  return published;
}

export function startOutboxWorker(intervalMs = 200): void {
  if (running) return;
  running = true;
  const tick = async () => {
    if (!running) return;
    try {
      await publishOutboxBatch();
    } catch (e) {
      console.error("outbox worker error:", (e as Error).message);
    } finally {
      if (running) timer = setTimeout(tick, intervalMs);
    }
  };
  tick();
}

export function stopOutboxWorker(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
