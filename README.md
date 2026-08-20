# Exchange – Perpetual Futures Trading Platform

A production-grade perpetual futures exchange with a high-performance C++ matching engine, TypeScript API, and real-time data pipelines.

---

## What is a Perpetual Futures Exchange?

Most people are familiar with buying and selling crypto on spot exchanges like Coinbase or Binance – you buy Bitcoin, you own Bitcoin, you can hold it or sell it later.

Perpetual futures are different.

When you trade perpetual futures, you are not buying the underlying asset. Instead, you are entering into a contract that tracks the price of that asset. You can take a position that profits when the price goes up (long) or when it goes down (short). And you can do this with leverage – meaning you can control a much larger position with a relatively small amount of capital.

The "perpetual" part means these contracts never expire. Unlike traditional futures that settle on a specific date, perpetuals keep running indefinitely. A funding rate mechanism ensures the contract price stays close to the actual spot price of the underlying asset.

This exchange is built to handle all of that – matching orders, managing margin, calculating funding payments, and maintaining a real-time order book – at high speed and with reliability.

---

## How It Works

When a user places an order, it goes through the REST API, gets validated, and is pushed into a Redis stream. The C++ matching engine consumes these commands, matches orders against the existing order book, and emits events for every trade, fill, and order update. These events flow through Kafka and Redis Pub/Sub, where various consumers update the PostgreSQL database, maintain caches, and push real-time data to connected clients.

The engine is the single source of truth for the order book. It maintains an in-memory map of price levels using red-black trees (via `std::map`), allowing fast insertion, deletion, and matching of orders.

All state changes are durable – even if the engine crashes, it can recover from the latest snapshot and replay events from Kafka.

---

## Key Features

- **High-performance matching engine** – written in C++17, handles thousands of orders per second.
- **REST API** – full order management, balance queries, position tracking, and market data endpoints.
- **Real-time order book** – updated instantly via Redis Pub/Sub.
- **Perpetual contracts** – no expiry, funding rate mechanism.
- **Leverage up to 50x** – on supported markets.
- **PostgreSQL persistence** – all orders, fills, positions, and balances are stored.
- **Event-driven architecture** – Kafka and Redis streams for reliable, replayable event processing.
- **Outbox pattern** – ensures no events are lost during order placement.
- **Simulation bots** – included scripts to generate realistic trading activity for testing and frontend development.

---

## Architecture Overview

```
Client (Web/Mobile)
        │
        ▼
┌───────────────────┐
│  REST API (TS)    │
│  Express + Drizzle│
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   Redis Streams   │
│  (order_commands) │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ C++ Matching      │
│ Engine            │
└─────────┬─────────┘
          │
          ▼
   Kafka / Redis PubSub
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 DB Writer   Frontend
 (Postgres)  (Next.js)
```

---

## Tech Stack

| Component      | Technology |
|----------------|------------|
| Matching Engine | C++17, std::map, hiredis, librdkafka |
| API Server     | Node.js, Express, TypeScript |
| Database       | PostgreSQL, Drizzle ORM |
| Caching/Messaging | Redis (Streams + Pub/Sub) |
| Event Bus      | Kafka |
| Frontend       | Next.js, React, Tailwind, Zustand, TanStack Query |

---

## Getting Started

### Prerequisites

- PostgreSQL (running locally or via Docker)
- Redis (with streams support)
- Kafka (or use the included docker-compose)
- CMake (for building the engine)
- Node.js v18+

### Clone and Install

```bash
git clone https://github.com/yourusername/exchange.git
cd exchange
```

### Start Dependencies

```bash
docker-compose up -d postgres redis zookeeper kafka
```

### Set Up the Database

```bash
cd Server
npx drizzle-kit push
npx tsx src/seed.ts   # optional: seed initial assets and markets
```

### Run the Matching Engine

```bash
cd Engine
mkdir build && cd build
cmake ..
make
./engine
```

### Run the API Server

```bash
cd Server
npm install
npm run dev
```

### Run the Frontend

```bash
cd terminal
npm install
npm run dev
```

The API will be available at `http://localhost:3000` and the frontend at `http://localhost:3001`.

---

## API Endpoints

All endpoints are prefixed with `/api/v1`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/auth/register` | Create a new user account |
| POST   | `/auth/login` | Log in and receive a JWT |
| GET    | `/auth/me` | Get current user profile |
| GET    | `/markets` | List all active markets |
| GET    | `/markets/:symbol/orderbook` | Get order book depth |
| GET    | `/markets/:symbol/ticker` | Get 24h ticker data |
| POST   | `/orders` | Place a new order |
| GET    | `/orders` | List user orders |
| DELETE | `/orders/:id` | Cancel an order |
| GET    | `/balances` | List user balances |
| POST   | `/balances/deposit` | Simulate a deposit (testing) |
| GET    | `/positions` | List open positions |
| POST   | `/positions/:id/close` | Close a position |
| GET    | `/fills` | List user trade history |
| GET    | `/funding/payments` | List funding payment history |

All authenticated endpoints require a `Bearer` token.

---

## Development

### Running the Simulation Bot

To generate real trading activity for testing:

```bash
npx tsx bot/botRunner.ts
```

This creates 4 bot users that continuously place limit and market orders across all configured markets.

### Logging

The exchange includes comprehensive logging across all components. Logs are written to `logs/` directory:

- `combined.log` – all API requests and service logs
- `error.log` – errors only
- `engine.log` – engine events
- `bot-combined.log` – bot activity
