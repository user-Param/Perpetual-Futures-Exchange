import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { assets, balances } from "../db/schema";
import { add, D, gte, gt, sub } from "../utils/decimal";

export async function getOrCreateBalance(userId: string, assetSymbol: string) {
  const [asset] = await db.select().from(assets).where(eq(assets.symbol, assetSymbol)).limit(1);
  if (!asset) {
    throw Object.assign(new Error("asset_not_found"), { status: 404 });
  }
  const [existing] = await db
    .select()
    .from(balances)
    .where(and(eq(balances.userId, userId), eq(balances.assetId, asset.id)))
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      userId: existing.userId,
      assetId: existing.assetId,
      symbol: asset.symbol,
      available: existing.availableBalance,
      locked: existing.lockedBalance,
    };
  }
  const [created] = await db
    .insert(balances)
    .values({ userId, assetId: asset.id })
    .returning();
  if (!created) throw new Error("balance_create_failed");
  return {
    id: created.id,
    userId: created.userId,
    assetId: created.assetId,
    symbol: asset.symbol,
    available: created.availableBalance,
    locked: created.lockedBalance,
  };
}

export async function listUserBalances(userId: string) {
  const rows = await db
    .select({
      id: balances.id,
      userId: balances.userId,
      assetId: balances.assetId,
      symbol: assets.symbol,
      available: balances.availableBalance,
      locked: balances.lockedBalance,
      updatedAt: balances.updatedAt,
    })
    .from(balances)
    .innerJoin(assets, eq(balances.assetId, assets.id))
    .where(eq(balances.userId, userId));
  return rows;
}

export async function deposit(userId: string, assetSymbol: string, amount: string) {
  if (!gt(amount, "0")) {
    throw Object.assign(new Error("amount_must_be_positive"), { status: 400 });
  }
  const bal = await getOrCreateBalance(userId, assetSymbol);
  const [updated] = await db
    .update(balances)
    .set({
      availableBalance: sql`${balances.availableBalance} + ${amount}::numeric`,
      updatedAt: new Date(),
    })
    .where(eq(balances.id, bal.id))
    .returning();
  if (!updated) throw new Error("deposit_failed");
  return {
    asset: assetSymbol,
    available: updated.availableBalance,
    locked: updated.lockedBalance,
  };
}

export async function withdraw(userId: string, assetSymbol: string, amount: string) {
  if (!gt(amount, "0")) {
    throw Object.assign(new Error("amount_must_be_positive"), { status: 400 });
  }
  const bal = await getOrCreateBalance(userId, assetSymbol);
  if (!gte(bal.available, amount)) {
    throw Object.assign(new Error("insufficient_balance"), { status: 400 });
  }
  const [updated] = await db
    .update(balances)
    .set({
      availableBalance: sub(bal.available, amount),
      updatedAt: new Date(),
    })
    .where(eq(balances.id, bal.id))
    .returning();
  if (!updated) throw new Error("withdraw_failed");
  return {
    asset: assetSymbol,
    available: updated.availableBalance,
    locked: updated.lockedBalance,
  };
}

export async function lockBalance(userId: string, assetId: string, amount: string) {
  if (!gt(amount, "0")) return;
  await db.transaction(async (tx) => {
    const [bal] = await tx
      .select()
      .from(balances)
      .where(and(eq(balances.userId, userId), eq(balances.assetId, assetId)))
      .for("update")
      .limit(1);
    if (!bal) {
      throw Object.assign(new Error("balance_not_found"), { status: 400 });
    }
    if (!gte(bal.availableBalance, amount)) {
      throw Object.assign(new Error("insufficient_balance"), { status: 400 });
    }
    await tx
      .update(balances)
      .set({
        availableBalance: sub(bal.availableBalance, amount),
        lockedBalance: add(bal.lockedBalance, amount),
        updatedAt: new Date(),
      })
      .where(eq(balances.id, bal.id));
  });
}

export async function unlockBalance(userId: string, assetId: string, amount: string) {
  if (!gt(amount, "0")) return;
  await db.transaction(async (tx) => {
    const [bal] = await tx
      .select()
      .from(balances)
      .where(and(eq(balances.userId, userId), eq(balances.assetId, assetId)))
      .for("update")
      .limit(1);
    if (!bal) return;
    const currentlyLocked = D(bal.lockedBalance);
    const unlockQty = currentlyLocked.gte(D(amount)) ? D(amount) : currentlyLocked;
    const lockedAfter = currentlyLocked.minus(unlockQty);
    const availableAfter = D(bal.availableBalance).plus(unlockQty);
    await tx
      .update(balances)
      .set({
        availableBalance: availableAfter.toString(),
        lockedBalance: lockedAfter.toString(),
        updatedAt: new Date(),
      })
      .where(eq(balances.id, bal.id));
  });
}

export async function debitLocked(userId: string, assetId: string, amount: string) {
  if (!gt(amount, "0")) return;
  await db.transaction(async (tx) => {
    const [bal] = await tx
      .select()
      .from(balances)
      .where(and(eq(balances.userId, userId), eq(balances.assetId, assetId)))
      .for("update")
      .limit(1);
    if (!bal) return;
    const currentlyLocked = D(bal.lockedBalance);
    const debitQty = currentlyLocked.gte(D(amount)) ? D(amount) : currentlyLocked;
    const lockedAfter = currentlyLocked.minus(debitQty);
    await tx
      .update(balances)
      .set({
        lockedBalance: lockedAfter.toString(),
        updatedAt: new Date(),
      })
      .where(eq(balances.id, bal.id));
  });
}
