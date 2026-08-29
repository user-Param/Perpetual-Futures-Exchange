# Market Maker Service

A minimal, reliable market-making service that uses Binance as an external price reference and provides bid/ask liquidity on the perpetual futures exchange.

## Architecture

```
┌─────────────────┐     Price      ┌─────────────────┐     Orders      ┌─────────────────┐
│   Binance WS    │ ─────────────▶ │  Market Maker   │ ──────────────▶ │  Exchange API   │
│   (BTCUSDT)     │                │     Bot         │                 │  (REST)         │
└─────────────────┘                └─────────────────┘                 └─────────────────┘
```

### Components

1. **BinanceFeed** - WebSocket connection to Binance for real-time mark prices
2. **ExchangeClient** - HTTP client for exchange REST API (auth, orders, positions, balances)
3. **MarketMakerStrategy** - Calculates bid/ask from reference price with configurable spread
4. **OrderManager** - Maintains one bid and one ask, handles quote replacement
5. **RiskManager** - Enforces maximum position limits
6. **HealthServer** - Express server exposing `/health` endpoint

## Directory Structure

```
market_maker/
├── src/
│   ├── binance/
│   │   └── binanceFeed.ts      # Binance WebSocket feed
│   ├── exchange/
│   │   └── exchangeClient.ts   # Exchange REST API client
│   ├── strategy/
│   │   └── marketMaker.ts      # Quote calculation strategy
│   ├── orders/
│   │   └── orderManager.ts     # Order lifecycle management
│   ├── risk/
│   │   └── riskManager.ts      # Position risk limits
│   ├── health/
│   │   └── healthServer.ts     # Health check endpoint
│   ├── utils/
│   │   └── decimal.ts          # Decimal arithmetic utilities
│   ├── config.ts               # Configuration
│   ├── logger.ts               # Structured logging
│   └── index.ts                # Main entry point
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
└── README.md
```

## Required Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EXCHANGE_API_URL` | Exchange REST API base URL | `http://localhost:3000` |
| `EXCHANGE_EMAIL` | Market maker account email | `marketmaker@example.com` |
| `EXCHANGE_PASSWORD` | Market maker account password | `marketmaker123` |
| `BINANCE_SYMBOL` | Binance symbol for price feed | `BTCUSDT` |
| `BINANCE_WS_URL` | Binance WebSocket URL | `wss://fstream.binance.com/ws/btcusdt@markPrice` |
| `MARKET` | Exchange market symbol | `BTC-USDT-PERP` |
| `SPREAD_BPS` | Spread in basis points (10 = 0.10%) | `10` |
| `ORDER_SIZE` | Order quantity per side | `0.001` |
| `QUOTE_REFRESH_MS` | Quote refresh interval | `1000` |
| `PRICE_STALE_MS` | Max age of price before pausing | `5000` |
| `MAX_POSITION` | Maximum position size | `0.1` |
| `HEALTH_PORT` | Health server port | `8080` |
| `LOG_LEVEL` | Log level (debug/info/warn/error) | `info` |

## Installation

```bash
cd market_maker
npm install
```

## Running Locally

1. Copy `.env.example` to `.env` and adjust values:
```bash
cp .env.example .env
```

2. Ensure the exchange API is running (on port 3000 by default)

3. Create a market maker user on the exchange:
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"marketmaker@example.com","password":"marketmaker123","name":"Market Maker"}'
```

4. Deposit funds for the market maker:
```bash
curl -X POST http://localhost:3000/api/v1/balances/deposit \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"asset":"USDT","amount":"100000"}'

curl -X POST http://localhost:3000/api/v1/balances/deposit \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"asset":"BTC","amount":"10"}'
```

5. Start the market maker:
```bash
npm run dev
```

## Building

```bash
npm run build
npm start
```

## Docker

```bash
docker build -t market-maker .
docker run -d \
  -e EXCHANGE_API_URL=http://host.docker.internal:3000 \
  -e EXCHANGE_EMAIL=marketmaker@example.com \
  -e EXCHANGE_PASSWORD=marketmaker123 \
  -e BINANCE_SYMBOL=BTCUSDT \
  -e MARKET=BTC-USDT-PERP \
  -e SPREAD_BPS=10 \
  -e ORDER_SIZE=0.001 \
  -p 8080:8080 \
  market-maker
```

## Configuration

### Market Configuration
The market must exist on the exchange with appropriate `tick_size`, `step_size`, `min_order_size`, and `max_order_size`. The bot validates all quotes against these constraints.

### Spread Configuration
`SPREAD_BPS` is in basis points (1/100 of a percent). For example:
- `10` = 0.10% spread (bid = price * 0.9995, ask = price * 1.0005)
- `50` = 0.50% spread

### Quantity Configuration
`ORDER_SIZE` is the quantity per order in base asset units (e.g., BTC). Must respect `step_size`, `min_order_size`, and `max_order_size`.

## Stale Price Protection

The bot maintains `lastPriceUpdateTimestamp` from Binance WebSocket messages. If:
```
currentTime - lastPriceUpdateTimestamp > PRICE_STALE_MS
```
the bot enters `QUOTING PAUSED` state:
- Cancels active market-making orders
- Stops placing new orders
- Attempts to reconnect to Binance
- Resumes only after a fresh valid price is received

## Order Reconciliation

On startup, the bot:
1. Authenticates with exchange
2. Queries open orders for the market
3. Identifies its own orders (via client order ID prefix `MM-`)
4. Cancels/reconciles stale orders
5. Waits for fresh Binance price
6. Calculates new quotes
7. Starts market making

The bot only manages its own orders (identified by `MM-<MARKET>-<BID|ASK>-<timestamp>` client order IDs).

## Graceful Shutdown

Handles `SIGINT` and `SIGTERM`:
1. Stops new quote operations
2. Cancels active bot orders
3. Closes Binance WebSocket
4. Stops HTTP health server
5. Exits cleanly

## Health Endpoint

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "service": "market-maker",
  "binanceConnected": true,
  "exchangeConnected": true,
  "priceFresh": true,
  "quoting": true,
  "market": "BTC-USDT-PERP",
  "activeBid": true,
  "activeAsk": true,
  "lastPriceUpdate": 1700000000000,
  "timestamp": 1700000001000
}
```

## Troubleshooting

### Binance Connectivity
- Check `BINANCE_WS_URL` is accessible
- Verify `BINANCE_SYMBOL` matches Binance format (e.g., `BTCUSDT` for perpetual)
- Check logs for "Binance WebSocket connected" and "Binance connection lost" messages

### Exchange Connectivity
- Verify `EXCHANGE_API_URL` is correct
- Ensure market maker user exists and credentials are valid
- Check exchange health at `http://localhost:3000/health`
- Verify market exists: `GET /api/v1/markets/BTC-USDT-PERP`

### Verifying Liquidity
Check order book on exchange:
```bash
curl http://localhost:3000/api/v1/markets/BTC-USDT-PERP/orderbook
```

Should show bid/ask around the Binance reference price with the configured spread.

## Testing

Run the complete service against the existing exchange and verify:
1. Binance WebSocket connects and receives prices
2. Exchange authentication succeeds
3. Market info loaded
4. Initial quotes placed
5. Quotes update when Binance price moves
6. Stale price detection works (disconnect Binance)
7. Reconnection works
8. Graceful shutdown cancels orders
9. Health endpoint reflects correct state
10. Position limits enforced

## Safety Features

- No orders placed with stale prices
- All prices/quantities rounded to exchange tick/step size
- Maximum position limits enforced
- No self-trading (bot provides liquidity, doesn't cross its own orders)
- No secrets in source code (uses environment variables)
- HTTP request timeouts on all exchange calls
- Bounded exponential backoff for Binance reconnection
- Startup order reconciliation prevents duplicate orders
- Idempotent order placement via client order IDs