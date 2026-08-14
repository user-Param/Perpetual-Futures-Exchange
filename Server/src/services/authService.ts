import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { signToken } from "../middleware/auth";

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ token: string; user: { id: string; email: string; name: string; role: string } }> {
  const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (existing.length > 0) {
    throw Object.assign(new Error("email_already_registered"), { status: 409 });
  }
  const passwordHash = await bcrypt.hash(input.password, 10);
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash,
      name: input.name,
    })
    .returning();
  if (!row) throw new Error("registration_failed");
  const token = signToken({ userId: row.id, email: row.email, role: row.role });
  return {
    token,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
  };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ token: string; user: { id: string; email: string; name: string; role: string } }> {
  const [row] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!row) {
    throw Object.assign(new Error("invalid_credentials"), { status: 401 });
  }
  const ok = await bcrypt.compare(input.password, row.passwordHash);
  if (!ok) {
    throw Object.assign(new Error("invalid_credentials"), { status: 401 });
  }
  if (!row.tradingEnabled) {
    throw Object.assign(new Error("trading_disabled"), { status: 403 });
  }
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, row.id));
  const token = signToken({ userId: row.id, email: row.email, role: row.role });
  return {
    token,
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
  };
}

export async function getUserById(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    kycStatus: row.kycStatus,
    tradingEnabled: row.tradingEnabled,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}
