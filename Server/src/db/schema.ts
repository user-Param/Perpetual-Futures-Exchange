import {
  pgTable,
  varchar,
  uuid,
  timestamp,
  numeric,
  boolean,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Enums
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const kycStatusEnum = pgEnum("kyc_status", [
  "none",
  "pending",
  "approved",
  "rejected",
]);
export const assetTypeEnum = pgEnum("asset_type", ["crypto", "fiat"]);
export const marketStatusEnum = pgEnum("market_status", ["active", "paused"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit"]);
export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "open",
  "partially_filled",
  "filled",
  "canceled",
  "rejected",
  "expired",
]);
export const timeInForceEnum = pgEnum("time_in_force", ["GTC", "IOC", "FOK"]);
export const marginModeEnum = pgEnum("margin_mode", ["isolated", "cross"]);
export const positionSideEnum = pgEnum("position_side", ["long", "short"]);
export const positionStatusEnum = pgEnum("position_status", [
  "open",
  "closed",
  "liquidated",
]);

// users
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: userRoleEnum("role").default("user").notNull(),
  kycStatus: kycStatusEnum("kyc_status").default("none").notNull(),
  tradingEnabled: boolean("trading_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// assets
export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: varchar("symbol", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  type: assetTypeEnum("type").default("crypto").notNull(),
  precision: integer("precision").default(8).notNull(),
  minWithdraw: numeric("min_withdraw", { precision: 30, scale: 8 }).default("0").notNull(),
  isCollateral: boolean("is_collateral").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// markets
export const markets = pgTable("markets", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: varchar("symbol", { length: 64 }).notNull().unique(),
  baseAssetId: uuid("base_asset_id").references(() => assets.id).notNull(),
  quoteAssetId: uuid("quote_asset_id").references(() => assets.id).notNull(),
  status: marketStatusEnum("status").default("active").notNull(),
  tickSize: numeric("tick_size", { precision: 30, scale: 8 }).notNull(),
  stepSize: numeric("step_size", { precision: 30, scale: 8 }).notNull(),
  minOrderSize: numeric("min_order_size", { precision: 30, scale: 8 }).notNull(),
  maxOrderSize: numeric("max_order_size", { precision: 30, scale: 8 }).notNull(),
  maxLeverage: integer("max_leverage").notNull(),
  initialMarginRate: numeric("initial_margin_rate", { precision: 30, scale: 8 }).notNull(),
  maintenanceMarginRate: numeric("maintenance_margin_rate", { precision: 30, scale: 8 }).notNull(),
  makerFeeBps: integer("maker_fee_bps").default(0).notNull(),
  takerFeeBps: integer("taker_fee_bps").default(0).notNull(),
  fundingIntervalHours: integer("funding_interval_hours").default(8).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// balances
export const balances = pgTable(
  "balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    assetId: uuid("asset_id").references(() => assets.id).notNull(),
    availableBalance: numeric("available_balance", { precision: 30, scale: 8 }).default("0").notNull(),
    lockedBalance: numeric("locked_balance", { precision: 30, scale: 8 }).default("0").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userAssetUnique: uniqueIndex("balances_user_asset_unique").on(t.userId, t.assetId),
  })
);

// orders
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id).notNull(),
    marketId: uuid("market_id").references(() => markets.id).notNull(),
    clientOrderId: varchar("client_order_id", { length: 128 }),
    orderType: orderTypeEnum("order_type").notNull(),
    side: orderSideEnum("side").notNull(),
    price: numeric("price", { precision: 30, scale: 8 }),
    quantity: numeric("quantity", { precision: 30, scale: 8 }).notNull(),
    filledQuantity: numeric("filled_quantity", { precision: 30, scale: 8 }).default("0").notNull(),
    status: orderStatusEnum("status").default("pending").notNull(),
    reduceOnly: boolean("reduce_only").default(false).notNull(),
    postOnly: boolean("post_only").default(false).notNull(),
    timeInForce: timeInForceEnum("time_in_force").default("GTC").notNull(),
    leverage: numeric("leverage", { precision: 30, scale: 8 }).default("1").notNull(),
    marginMode: marginModeEnum("margin_mode").default("isolated").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => ({
    userMarketStatusIdx: index("orders_user_market_status_idx").on(t.userId, t.marketId, t.status),
    marketStatusIdx: index("orders_market_status_idx").on(t.marketId, t.status),
    clientOrderUnique: uniqueIndex("orders_client_order_unique")
      .on(t.userId, t.clientOrderId)
      .where(sql`${t.clientOrderId} IS NOT NULL`),
  })
);

// fills
export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id").references(() => markets.id).notNull(),
    makerOrderId: uuid("maker_order_id").references(() => orders.id).notNull(),
    takerOrderId: uuid("taker_order_id").references(() => orders.id).notNull(),
    makerUserId: uuid("maker_user_id").references(() => users.id).notNull(),
    takerUserId: uuid("taker_user_id").references(() => users.id).notNull(),
    side: orderSideEnum("side").notNull(),
    price: numeric("price", { precision: 30, scale: 8 }).notNull(),
    quantity: numeric("quantity", { precision: 30, scale: 8 }).notNull(),
    makerFee: numeric("maker_fee", { precision: 30, scale: 8 }).default("0").notNull(),
    takerFee: numeric("taker_fee", { precision: 30, scale: 8 }).default("0").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    marketCreatedIdx: index("fills_market_created_idx").on(t.marketId, t.createdAt),
  })
);

// positions
export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  marketId: uuid("market_id").references(() => markets.id).notNull(),
  side: positionSideEnum("side").notNull(),
  quantity: numeric("quantity", { precision: 30, scale: 8 }).notNull(),
  entryPrice: numeric("entry_price", { precision: 30, scale: 8 }).notNull(),
  markPrice: numeric("mark_price", { precision: 30, scale: 8 }).notNull(),
  liquidationPrice: numeric("liquidation_price", { precision: 30, scale: 8 }).notNull(),
  margin: numeric("margin", { precision: 30, scale: 8 }).notNull(),
  leverage: integer("leverage").notNull(),
  marginMode: marginModeEnum("margin_mode").notNull(),
  realizedPnl: numeric("realized_pnl", { precision: 30, scale: 8 }).default("0").notNull(),
  status: positionStatusEnum("status").default("open").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

// funding_payments
export const fundingPayments = pgTable("funding_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: uuid("market_id").references(() => markets.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  positionId: uuid("position_id").references(() => positions.id).notNull(),
  amount: numeric("amount", { precision: 30, scale: 8 }).notNull(),
  fundingRate: numeric("funding_rate", { precision: 30, scale: 8 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// outbox
export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  aggregateId: uuid("aggregate_id"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type Balance = typeof balances.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Fill = typeof fills.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type FundingPayment = typeof fundingPayments.$inferSelect;
export type OutboxEvent = typeof outbox.$inferSelect;
