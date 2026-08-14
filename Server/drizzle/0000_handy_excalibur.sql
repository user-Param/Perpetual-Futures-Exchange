CREATE TYPE "public"."asset_type" AS ENUM('crypto', 'fiat');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."margin_mode" AS ENUM('isolated', 'cross');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'open', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit');--> statement-breakpoint
CREATE TYPE "public"."position_side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('open', 'closed', 'liquidated');--> statement-breakpoint
CREATE TYPE "public"."time_in_force" AS ENUM('GTC', 'IOC', 'FOK');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(32) NOT NULL,
	"name" varchar(128) NOT NULL,
	"type" "asset_type" DEFAULT 'crypto' NOT NULL,
	"precision" integer DEFAULT 8 NOT NULL,
	"min_withdraw" numeric(30, 8) DEFAULT '0' NOT NULL,
	"is_collateral" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"available_balance" numeric(30, 8) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(30, 8) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"maker_order_id" uuid NOT NULL,
	"taker_order_id" uuid NOT NULL,
	"maker_user_id" uuid NOT NULL,
	"taker_user_id" uuid NOT NULL,
	"side" "order_side" NOT NULL,
	"price" numeric(30, 8) NOT NULL,
	"quantity" numeric(30, 8) NOT NULL,
	"maker_fee" numeric(30, 8) DEFAULT '0' NOT NULL,
	"taker_fee" numeric(30, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"amount" numeric(30, 8) NOT NULL,
	"funding_rate" numeric(30, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(64) NOT NULL,
	"base_asset_id" uuid NOT NULL,
	"quote_asset_id" uuid NOT NULL,
	"status" "market_status" DEFAULT 'active' NOT NULL,
	"tick_size" numeric(30, 8) NOT NULL,
	"step_size" numeric(30, 8) NOT NULL,
	"min_order_size" numeric(30, 8) NOT NULL,
	"max_order_size" numeric(30, 8) NOT NULL,
	"max_leverage" integer NOT NULL,
	"initial_margin_rate" numeric(30, 8) NOT NULL,
	"maintenance_margin_rate" numeric(30, 8) NOT NULL,
	"maker_fee_bps" integer DEFAULT 0 NOT NULL,
	"taker_fee_bps" integer DEFAULT 0 NOT NULL,
	"funding_interval_hours" integer DEFAULT 8 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"client_order_id" varchar(128),
	"order_type" "order_type" NOT NULL,
	"side" "order_side" NOT NULL,
	"price" numeric(30, 8),
	"quantity" numeric(30, 8) NOT NULL,
	"filled_quantity" numeric(30, 8) DEFAULT '0' NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"reduce_only" boolean DEFAULT false NOT NULL,
	"post_only" boolean DEFAULT false NOT NULL,
	"time_in_force" time_in_force DEFAULT 'GTC' NOT NULL,
	"leverage" numeric(30, 8) DEFAULT '1' NOT NULL,
	"margin_mode" "margin_mode" DEFAULT 'isolated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"aggregate_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"side" "position_side" NOT NULL,
	"quantity" numeric(30, 8) NOT NULL,
	"entry_price" numeric(30, 8) NOT NULL,
	"mark_price" numeric(30, 8) NOT NULL,
	"liquidation_price" numeric(30, 8) NOT NULL,
	"margin" numeric(30, 8) NOT NULL,
	"leverage" integer NOT NULL,
	"margin_mode" "margin_mode" NOT NULL,
	"realized_pnl" numeric(30, 8) DEFAULT '0' NOT NULL,
	"status" "position_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"kyc_status" "kyc_status" DEFAULT 'none' NOT NULL,
	"trading_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_maker_order_id_orders_id_fk" FOREIGN KEY ("maker_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_taker_order_id_orders_id_fk" FOREIGN KEY ("taker_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_maker_user_id_users_id_fk" FOREIGN KEY ("maker_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_taker_user_id_users_id_fk" FOREIGN KEY ("taker_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_payments" ADD CONSTRAINT "funding_payments_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_payments" ADD CONSTRAINT "funding_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_payments" ADD CONSTRAINT "funding_payments_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_base_asset_id_assets_id_fk" FOREIGN KEY ("base_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_quote_asset_id_assets_id_fk" FOREIGN KEY ("quote_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "balances_user_asset_unique" ON "balances" USING btree ("user_id","asset_id");--> statement-breakpoint
CREATE INDEX "fills_market_created_idx" ON "fills" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_user_market_status_idx" ON "orders" USING btree ("user_id","market_id","status");--> statement-breakpoint
CREATE INDEX "orders_market_status_idx" ON "orders" USING btree ("market_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_client_order_unique" ON "orders" USING btree ("user_id","client_order_id") WHERE "orders"."client_order_id" IS NOT NULL;