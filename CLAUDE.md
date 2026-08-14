```markdown
# CLAUDE.md — Perpetual Futures Exchange v1

## 1. Project Overview

Build a **Perpetual Futures Crypto Exchange** with a modular microservices architecture.  
The system consists of:

- **REST API** (TypeScript, Node.js, Express) for client interaction.
- **Order Matching Engine** (C++, standalone service) for matching orders.
- **PostgreSQL** via **Drizzle ORM** for persistent state.
- **Redis** for low-latency pub/sub, caching, and command queues.
- **Kafka** as durable event log and message bus.
- **Next.js** app (already present) for frontend (may be minimal for v1; focus on API).

The goal is a **fully working v1** with the ability to register/login, place orders, see balances, view order book, and have orders matched by the engine. All components must be tested via terminal/shell commands.

---

## 2. Existing Boilerplate (DO NOT DELETE OR MOVE)

The repository is a **Turbo repo** named `Exchange`.  
It already contains:

- `server` — Express + TypeScript + Drizzle ORM setup.
- `terminal` — Next.js app (may remain as-is or minimal).
- `packages/` — shared packages if any (do not delete).
- `engine/` — C++ engine with `main.cpp` and `CMakeLists.txt`.
- Redis and Kafka are installed and available locally.

**IMPORTANT**: Do not delete, rename, or move any existing file or folder.  
You may add new files within the appropriate directories, but keep the existing structure intact.

---

## 3. High-Level Architecture

```
Client (web/mobile)
      │
      ▼
REST API (Express + Drizzle ORM)
      │
      ├── Direct DB access for auth, balances, positions, history
      │
      ├── Redis Streams / Kafka → order commands
      │
      ▼
Matching Engine (C++ standalone)
      │
      ├── In-memory order book using binary trees
      ├── Matches orders
      ├── Emits events to Kafka + Redis
      │
      ▼
Kafka (event log)
      │
      ├── DB Writer Consumer → updates PostgreSQL
      ├── WebSocket Notifier (optional) → real-time updates
      ├── Snapshot service (every 15 min → S3)
      └── Risk/Account service (for v1, integrated with API or separate consumer)
```

- **REST API** is responsible for user authentication, account management, and reading data.
- **Engine** is the single source of truth for order book and matching.
- All state changes are communicated asynchronously via Kafka events.
- Redis is used for low-latency order command queues (Redis Streams) and real-time pub/sub for market data.

---

## 4. Tech Stack & Libraries

- **API**: TypeScript, Node.js, Express, Drizzle ORM, PostgreSQL, NextAuth (JWT strategy), Redis, KafkaJS or node-rdkafka.
- **Engine**: C++17/20, CMake. Use standard library `std::map` (red-black tree) for order book. Drogon optional for health endpoints (not mandatory). Engine consumes Redis Streams or Kafka and publishes events to Kafka and Redis.
- **Database**: PostgreSQL (running locally or in Docker). Use `numeric(30,8)` for all monetary values.
- **Messaging**: Redis Streams for order commands (durable with AOF) and Redis Pub/Sub for real-time broadcasts. Kafka for all durable events (orders, trades, balance changes).
- **Testing**: Shell scripts, `curl`, `psql`, `redis-cli`, `kafka-console-consumer`, custom scripts.

---

## 5. Database Schema

All tables are in PostgreSQL. Use Drizzle ORM to define schemas in `apps/api/src/db/schema.ts` (or similar).  
Do not delete existing schema files; extend them.

### 5.1 `users`
| Column          | Type                          | Description                       |
|-----------------|-------------------------------|-----------------------------------|
| id              | uuid pk default gen_random_uuid() | Unique user ID                  |
| email           | varchar unique not null       | Email                             |
| password_hash   | varchar                       | Hashed password (bcrypt)         |
| name            | varchar                       | Display name                      |
| role            | enum('user','admin') default 'user' | Access level               |
| kyc_status      | enum('none','pending','approved','rejected') default 'none' | KYC status |
| trading_enabled | boolean default true          | Admin can disable                 |
| created_at      | timestamptz default now()     |                                   |
| updated_at      | timestamptz default now()     |                                   |
| last_login_at   | timestamptz nullable          |                                   |

### 5.2 `assets`
| Column        | Type                          | Description                |
|---------------|-------------------------------|----------------------------|
| id            | uuid pk default gen_random_uuid() | Asset ID                |
| symbol        | varchar unique not null       | e.g., USDT, BTC           |
| name          | varchar                       | Full name                  |
| type          | enum('crypto','fiat') default 'crypto' | Asset type      |
| precision     | integer default 8             | Decimal precision          |
| min_withdraw  | numeric(30,8) default 0       | Minimum withdrawal amount  |
| is_collateral | boolean default true          | Can be used as margin      |
| created_at    | timestamptz default now()     |                            |

### 5.3 `markets`
| Column                  | Type                                      | Description                        |
|-------------------------|-------------------------------------------|------------------------------------|
| id                      | uuid pk default gen_random_uuid()         | Market ID                          |
| symbol                  | varchar unique not null                   | e.g., BTC-USDT-PERP                |
| base_asset_id           | uuid FK assets.id                         | Base asset                         |
| quote_asset_id          | uuid FK assets.id                         | Quote asset                        |
| status                  | enum('active','paused') default 'active'  | Trading status                     |
| tick_size               | numeric(30,8) not null                    | Minimum price increment            |
| step_size               | numeric(30,8) not null                    | Minimum quantity increment         |
| min_order_size          | numeric(30,8) not null                    |                                    |
| max_order_size          | numeric(30,8) not null                    |                                    |
| max_leverage            | integer not null                          | e.g., 50                           |
| initial_margin_rate     | numeric(30,8) not null                    | e.g., 0.02                         |
| maintenance_margin_rate | numeric(30,8) not null                    | e.g., 0.01                         |
| maker_fee_bps           | integer default 0                         | Maker fee in basis points          |
| taker_fee_bps           | integer default 0                         | Taker fee in basis points          |
| funding_interval_hours  | integer default 8                         | Funding interval                   |
| created_at              | timestamptz default now()                 |                                    |

### 5.4 `balances`
| Column            | Type                          | Description                        |
|-------------------|-------------------------------|------------------------------------|
| id                | uuid pk default gen_random_uuid() | Balance ID                     |
| user_id           | uuid FK users.id             | User                               |
| asset_id          | uuid FK assets.id            | Asset                              |
| available_balance | numeric(30,8) default 0      | Free balance                       |
| locked_balance    | numeric(30,8) default 0      | Locked by open orders/margin       |
| updated_at        | timestamptz default now()     |                                    |
| **Unique**        | (user_id, asset_id)           |                                    |

### 5.5 `orders`
| Column           | Type                                                              | Description                          |
|------------------|-------------------------------------------------------------------|--------------------------------------|
| id               | uuid pk default gen_random_uuid()                                 | Internal order ID                    |
| user_id          | uuid FK users.id                                                  | Owner                                |
| market_id        | uuid FK markets.id                                                | Market                               |
| client_order_id  | varchar unique nullable                                           | Idempotency key from client          |
| order_type       | enum('market','limit')                                            | v1 only these                        |
| side             | enum('buy','sell')                                                |                                      |
| price            | numeric(30,8) nullable                                            | Null for market                      |
| quantity         | numeric(30,8) not null                                            | Base asset or contract quantity      |
| filled_quantity  | numeric(30,8) default 0                                           |                                      |
| status           | enum('pending','open','partially_filled','filled','canceled','rejected','expired') |      |
| reduce_only      | boolean default false                                             |                                      |
| post_only        | boolean default false                                             |                                      |
| time_in_force    | enum('GTC','IOC','FOK') default 'GTC'                             |                                      |
| leverage         | numeric(30,8) default 1                                           |                                      |
| margin_mode      | enum('isolated','cross') default 'isolated'                       |                                      |
| created_at       | timestamptz default now()                                         |                                      |
| updated_at       | timestamptz default now()                                         |                                      |
| executed_at      | timestamptz nullable                                              |                                      |

Indexes: `(user_id, market_id, status)`, `(market_id, status)`.

### 5.6 `fills`
| Column          | Type                          | Description                        |
|-----------------|-------------------------------|------------------------------------|
| id              | uuid pk default gen_random_uuid() | Fill ID                        |
| market_id       | uuid FK markets.id            | Market                             |
| maker_order_id  | uuid FK orders.id             | Maker order                        |
| taker_order_id  | uuid FK orders.id             | Taker order                        |
| maker_user_id   | uuid FK users.id              | Maker user                         |
| taker_user_id   | uuid FK users.id              | Taker user                         |
| side            | enum('buy','sell')            | Aggressor side                     |
| price           | numeric(30,8)                 | Execution price                    |
| quantity        | numeric(30,8)                 |                                    |
| maker_fee       | numeric(30,8) default 0       |                                    |
| taker_fee       | numeric(30,8) default 0       |                                    |
| created_at      | timestamptz default now()     |                                    |

Index on `(market_id, created_at)`.

### 5.7 `positions`
| Column              | Type                            | Description                     |
|---------------------|---------------------------------|---------------------------------|
| id                  | uuid pk default gen_random_uuid() | Position ID                  |
| user_id             | uuid FK users.id               |                                 |
| market_id           | uuid FK markets.id             |                                 |
| side                | enum('long','short')           |                                 |
| quantity            | numeric(30,8)                  | Position size                   |
| entry_price         | numeric(30,8)                  | Average entry price             |
| mark_price          | numeric(30,8)                  | Updated by market data          |
| liquidation_price   | numeric(30,8)                  |                                 |
| margin              | numeric(30,8)                  | Isolated margin                 |
| leverage            | integer                        |                                 |
| margin_mode         | enum('isolated','cross')       |                                 |
| realized_pnl        | numeric(30,8) default 0        |                                 |
| status              | enum('open','closed','liquidated') default 'open' |              |
| opened_at           | timestamptz default now()      |                                 |
| closed_at           | timestamptz nullable           |                                 |

### 5.8 `funding_payments`
| Column       | Type                          | Description                          |
|--------------|-------------------------------|--------------------------------------|
| id           | uuid pk default gen_random_uuid() | Payment ID                      |
| market_id    | uuid FK markets.id            |                                      |
| user_id      | uuid FK users.id              |                                      |
| position_id  | uuid FK positions.id          |                                      |
| amount       | numeric(30,8)                 | Positive if received, negative if paid |
| funding_rate | numeric(30,8)                 | Rate applied                         |
| created_at   | timestamptz default now()     |                                      |

### 5.9 `outbox`
| Column        | Type                           | Description                            |
|---------------|--------------------------------|----------------------------------------|
| id            | uuid pk default gen_random_uuid() | Outbox event ID                     |
| event_type    | varchar                        | e.g., order_created, order_matched    |
| aggregate_id  | uuid                           | Related entity id                      |
| payload       | jsonb                          | Event data                             |
| created_at    | timestamptz default now()      |                                        |
| published_at  | timestamptz nullable           |                                        |

Used for reliable event publishing from API to Kafka.

---

## 6. REST API Endpoints

Base path: `/api/v1`

### 6.1 Auth (using NextAuth JWT or custom JWT)
- `POST /auth/register` — create user (email, password, name). Hash password with bcrypt.
- `POST /auth/login` — validate credentials, return JWT (or NextAuth session token). For simplicity, implement custom JWT endpoint using `jsonwebtoken` and attach user info.
- `GET /auth/me` — return current user profile (protected).
- `POST /auth/logout` — invalidate token (if using server-side sessions, else just client clears token).

> For NextAuth integration, if using existing NextAuth setup in `apps/api`, adapt accordingly. But for v1, a simple JWT middleware is acceptable.

### 6.2 Markets & Market Data
- `GET /markets` — list active markets with details.
- `GET /markets/:symbol` — market detail.
- `GET /markets/:symbol/orderbook` — order book depth (from Redis or engine).
- `GET /markets/:symbol/trades` — recent public trades (from DB or Redis).
- `GET /markets/:symbol/ticker` — 24h ticker (can compute from DB).

### 6.3 Balances
- `GET /balances` — list user balances (protected).
- `POST /balances/deposit` — simulate deposit (for testing, maybe admin only). Increase available balance.
- `POST /balances/withdraw` — simulate withdrawal (protected, decrease available if sufficient).

### 6.4 Orders
- `POST /orders` — place order (protected). Validate and push to Redis Streams/Kafka for engine.
- `GET /orders` — list user orders with filters (status, market, limit). Use DB.
- `GET /orders/:id` — order details.
- `DELETE /orders/:id` — cancel order (protected). Send cancel command to engine.
- `DELETE /orders` — cancel all open orders.

### 6.5 Positions
- `GET /positions` — list open positions.
- `GET /positions/:id` — position details.
- `POST /positions/:id/close` — close position at market.
- `POST /positions/:id/margin` — add/remove margin (v1 optional).
- `POST /positions/:id/leverage` — adjust leverage (v1 optional).

### 6.6 Fills & Funding
- `GET /fills` — user's trade fills.
- `GET /funding/payments` — user's funding payment history.

All protected endpoints require `Authorization: Bearer <token>` header.

---

## 7. Order Matching Engine Internal Design

The engine is a **C++ standalone service** (located in `engine/`). It must:

- Consume order commands from **Redis Streams** (key `order_commands`). Each command is a JSON message.
- Maintain an **in-memory order book** per market using `std::map<double, PriceLevel>` (red-black tree).
- Match orders with O(log n) operations.
- Emit events to **Kafka** (durable) and **Redis Pub/Sub** (real-time).

### 7.1 Command Format

```json
{
  "type": "PLACE_ORDER",
  "order": {
    "id": "uuid",
    "userId": "uuid",
    "market": "BTC-USDT-PERP",
    "side": "buy",
    "orderType": "limit",
    "price": "50000.5",
    "quantity": "0.01",
    "timeInForce": "GTC",
    "reduceOnly": false,
    "postOnly": false,
    "clientOrderId": "optional",
    "leverage": 10,
    "marginMode": "isolated"
  },
  "sequence": 12345,
  "timestamp": 1700000000000
}
```

Cancel command:
```json
{
  "type": "CANCEL_ORDER",
  "orderId": "uuid",
  "market": "BTC-USDT-PERP",
  "userId": "uuid"
}
```

### 7.2 Order Book Structure

For each market:
- `bids`: `std::map<double, PriceLevel, std::greater<double>>` — descending price (best bid first).
- `asks`: `std::map<double, PriceLevel>` — ascending price (best ask first).

`PriceLevel` contains:
- `price`: double (or string for exactness, but double acceptable for v1).
- `orders`: `std::queue<Order>` — FIFO list of orders at this price.

### 7.3 Matching Algorithm

On receiving a new limit order:

1. **Validate** price/quantity precision, market status, order size.
2. **If postOnly and would cross** → reject/cancel.
3. **For buy order**:  
   While `asks` not empty and `bestAsk.price <= order.price` and remaining > 0:
   - Take the front order at best ask.
   - Trade quantity = min(remaining, front.quantity).
   - Generate fill event, update quantities.
   - Remove front order if fully filled.
   - If our order filled, stop.
4. **For sell order**: symmetric, using `bids` where `bestBid.price >= order.price`.
5. **If remaining > 0** and order is GTC: add remaining to appropriate tree as new price level or append to existing level.
6. If IOC or FOK and not fully filled: cancel remaining (or entire order if FOK).
7. **Emit events**:
   - `ORDER_ACCEPTED` if placed open.
   - `ORDER_FILLED` when fully filled.
   - `TRADE_EXECUTED` for each trade.
   - `ORDER_CANCELED` if canceled.

### 7.4 Engine Events

Engine publishes to:
- Kafka topic `engine_events` with partitions keyed by market symbol for ordering.
- Redis channel `engine_events` (Pub/Sub) for real-time consumers.

Event types: `ORDER_ACCEPTED`, `ORDER_REJECTED`, `ORDER_FILLED`, `ORDER_CANCELED`, `TRADE_EXECUTED`, `ORDER_BOOK_UPDATED`.

---

## 8. Event Flow & Asynchronous Processing

### 8.1 Order Placement Flow

1. API receives `POST /orders`.
2. Validates user, market, and balance (using DB available balance).
3. Inserts order into `orders` table with status `pending`.
4. Writes an outbox row with event `order_created`.
5. Returns `client_order_id` or internal order id to client.
6. A background worker (in API or separate process) publishes the outbox event to Redis Streams (`order_commands`).
7. Engine consumes command, matches, updates order book, emits events to Kafka.
8. A **DB Writer Consumer** (could be part of API or separate service) consumes Kafka events and updates:
   - `orders` status and filled quantity.
   - `fills` records.
   - `balances` (available, locked) after fills.
   - `positions` (open/update/close).
9. API's polling or WebSocket can then show updated state.

### 8.2 Kafka Topics

- `order_commands` — maybe Redis Streams; but also possible to use Kafka for order commands. For v1, use Redis Streams for lower latency and simplicity; outbox worker pushes to both Redis Streams and optionally Kafka. Engine consumes Redis Streams.
- `engine_events` — engine publishes all events to Kafka and Redis.
- `balance_updates` — optional, if separate consumer updates balances.

### 8.3 Redis Usage

- **Stream `order_commands`**: engine consumer group processes commands.
- **Pub/Sub channels**: `orderbook_updates`, `trade_updates` for real-time.
- **Cache**: order book depth snapshots for API.
- **Rate limiting** and **session store** (optional).

### 8.4 Snapshot & Recovery

- Engine snapshots full order book state every 15 minutes to local file or S3 (for v1, local file is acceptable). Also stores last processed Kafka offset.
- On restart, engine loads latest snapshot and replays any Kafka events after offset to rebuild state.
- API also can snapshot DB or use DB itself as persistent state; no need for separate snapshot.

---

## 9. Implementation Guidelines

- Use **TypeScript strict mode** for API.
- Use **Drizzle ORM** for all DB operations.
- Use **bcrypt** for password hashing.
- Use **jsonwebtoken** for JWT creation/verification.
- Use **ioredis** for Redis client.
- Use **kafkajs** for Kafka producer/consumer in API.
- Engine in C++ uses **hiredis** for Redis and **librdkafka** for Kafka (if needed). For simplicity, engine can use Redis Streams via hiredis and produce to Kafka via librdkafka; if Kafka integration is complex, engine can produce events to Redis Streams and a separate service forwards to Kafka. But v1 should include Kafka.
- All monetary values must be strings in JSON, parsed carefully in engine (use decimal string to avoid floating errors). In DB, use `numeric(30,8)`.

- **Do not delete existing files**. Add new files under appropriate directories:
  - API: add routes, controllers, services, consumers, workers, migrations if needed.
  - Engine: modify `main.cpp` to implement engine logic; add headers if necessary.
  - Root: add scripts, docker-compose if needed, test scripts.

---

## 10. Testing Plan (Terminal/Shell)

After implementation, you must test the entire flow using shell commands. Provide a `test.sh` script or series of commands that validate:

1. **Database connectivity**: `psql -c "SELECT 1"` or Drizzle migration.
2. **Redis connectivity**: `redis-cli ping`.
3. **Kafka connectivity**: produce/consume test message.
4. **Start API**: `npm run dev` in `apps/api`.
5. **Start Engine**: `./engine/build/engine` (compiled binary).
6. **Register user**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/register -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"password123","name":"Test User"}'
   ```
7. **Login**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"password123"}'
   ```
   Capture JWT token.
8. **Deposit** (simulate):
   ```bash
   curl -X POST http://localhost:3000/api/v1/balances/deposit -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"asset":"USDT","amount":"10000"}'
   ```
9. **Place a limit order** (buy 0.01 BTC @ 50000):
   ```bash
   curl -X POST http://localhost:3000/api/v1/orders -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"market":"BTC-USDT-PERP","side":"buy","orderType":"limit","price":"50000","quantity":"0.01","timeInForce":"GTC","leverage":"10"}'
   ```
   Expected response: order accepted with id.
10. **Place a matching sell order** (or use second user):
    ```bash
    curl -X POST http://localhost:3000/api/v1/orders -H "Authorization: Bearer <token2>" -H "Content-Type: application/json" -d '{"market":"BTC-USDT-PERP","side":"sell","orderType":"limit","price":"50000","quantity":"0.01","timeInForce":"GTC","leverage":"10"}'
    ```
11. **Wait for engine to process** (poll or sleep 2 sec).
12. **Check orders status**:
    ```bash
    curl -X GET http://localhost:3000/api/v1/orders -H "Authorization: Bearer <token>"
    ```
    Should show both orders `filled`.
13. **Check fills**:
    ```bash
    curl -X GET http://localhost:3000/api/v1/fills -H "Authorization: Bearer <token>"
    ```
    Should show a fill.
14. **Check balances** updated:
    ```bash
    curl -X GET http://localhost:3000/api/v1/balances -H "Authorization: Bearer <token>"
    ```
    Available should reflect fees and trade.
15. **Check order book**:
    ```bash
    curl -X GET http://localhost:3000/api/v1/markets/BTC-USDT-PERP/orderbook
    ```
    Should return depth (likely empty now after match).
16. **Cancel order**: place a non-matching order and cancel it, verify status becomes canceled.
17. **Test order rejection**: place order with insufficient balance, expect rejection.
18. **Test idempotency**: resend same `client_order_id`, expect same order not duplicated.

All tests must pass successfully. Provide a summary of test results.

---

## 11. Acceptance Criteria for v1

- User can register, login, deposit, place orders, cancel orders.
- Engine matches buy/sell orders correctly and updates DB via Kafka consumers.
- Balances update after fills (fees included if configured).
- Order book depth can be queried.
- The system can recover engine state from snapshot after restart (implement and test).
- All REST endpoints are functional and return correct JSON.
- No critical bugs or race conditions (single-threaded engine ensures order).
- Code is clean, minimal, and follows the structure described.

---

## 12. Final Notes

- Focus on **correctness** over features. Perpetual futures specifics like funding, liquidation, margin management are minimal in v1 but should be stubbed.
- Use environment variables for configuration (DB URL, Redis URL, Kafka brokers, JWT secret). Provide `.env.example`.
- Add a `docker-compose.yml` at root for PostgreSQL, Redis, Kafka (optional if already running locally).
- Ensure all services can run locally with simple commands (`npm run dev`, `./engine`).
- The engine binary must be built with CMake. Provide instructions in `engine/README.md` if needed.
- The API must start on port 3000 (or configurable). Engine should read env var for Redis/Kafka addresses.

**Goal**: After you complete this task, the exchange should be fully operational and tested with the provided shell commands, demonstrating a working order lifecycle from placement to fill to balance update.
```