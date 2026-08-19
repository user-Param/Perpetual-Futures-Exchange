// bot/botWorker.ts
import { CONFIG } from './config.js';
import { apiRequest, sleep, randomBetween, randomInt } from './utils.js';

export interface BotState {
  email: string;
  token: string;
  userId: string;
  balances: Record<string, number>; // asset -> available
  activeOrders: Set<string>; // order IDs to track
}

export class BotWorker {
  private state: BotState | null = null;
  private running = true;
  private marketIndex = 0;

  constructor(private readonly botId: number) {}

  async initialize() {
    // Register or login existing
    const email = `bot${this.botId}@sim.local`;
    try {
      // Try login first
      const login = await apiRequest(null, 'POST', '/auth/login', {
        email,
        password: CONFIG.BOT_PASSWORD,
      });
      this.state = {
        email,
        token: login.token,
        userId: login.user.id,
        balances: {},
        activeOrders: new Set(),
      };
      console.log(`Bot ${this.botId} logged in as ${email}`);
    } catch {
      // Register new
      const reg = await apiRequest(null, 'POST', '/auth/register', {
        email,
        password: CONFIG.BOT_PASSWORD,
        name: `Bot ${this.botId}`,
      });
      this.state = {
        email,
        token: reg.token,
        userId: reg.user.id,
        balances: {},
        activeOrders: new Set(),
      };
      console.log(`Bot ${this.botId} registered as ${email}`);
      // Initial deposits
      for (const [asset, amount] of Object.entries(CONFIG.INITIAL_DEPOSITS)) {
        try {
          await apiRequest(this.state.token, 'POST', '/balances/deposit', {
            asset,
            amount: String(amount),
          });
        } catch (e) {
          // ignore if already deposited
        }
      }
    }
  }

  private async getLastPrice(market: string): Promise<number> {
    try {
      const ticker = await apiRequest(this.state!.token, 'GET', `/markets/${market}/ticker`);
      return parseFloat(ticker.lastPrice) || 50000;
    } catch {
      return 50000; // fallback
    }
  }

  private async placeOrder(
    market: string,
    side: 'buy' | 'sell',
    orderType: 'limit' | 'market',
    price?: number,
    quantity?: number
  ) {
    const body: any = {
      market,
      side,
      orderType,
      quantity: String(quantity || 0.001),
      leverage: '1',
      timeInForce: 'GTC',
    };
    if (orderType === 'limit' && price) body.price = String(price);
    try {
      const result = await apiRequest(this.state!.token, 'POST', '/orders', body);
      if (result.order) this.state!.activeOrders.add(result.order.id);
      return result.order;
    } catch {
      return null;
    }
  }

  private async cancelOrder(orderId: string) {
    try {
      await apiRequest(this.state!.token, 'DELETE', `/orders/${orderId}`);
      this.state!.activeOrders.delete(orderId);
    } catch {}
  }

  private async cancelAllForMarket(market: string) {
    try {
      await apiRequest(this.state!.token, 'DELETE', `/orders?market=${market}`);
      // Remove all from activeOrders that belong to this market (we don't track per market)
      // For simplicity, we'll clear the set and rely on re‑placement.
      this.state!.activeOrders.clear();
    } catch {}
  }

  // ─── Strategy: Market Maker ──────────────────────────────
  private async runMaker(market: string) {
    const price = await this.getLastPrice(market);
    const spread = price * 0.001; // 0.1% spread
    const bidPrice = price - spread;
    const askPrice = price + spread;
    const qty = 0.001 * (1 + randomBetween(0, 2)); // 0.001–0.003

    // Cancel old orders for this market to avoid piling up
    await this.cancelAllForMarket(market);

    // Place new orders
    await this.placeOrder(market, 'buy', 'limit', bidPrice, qty);
    await this.placeOrder(market, 'sell', 'limit', askPrice, qty);
  }

  // ─── Strategy: Market Taker ──────────────────────────────
  private async runTaker(market: string) {
    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const qty = 0.001 * (1 + randomBetween(0, 1.5));
    const price = await this.getLastPrice(market);
    // For market buy, price is needed for margin calculation
    await this.placeOrder(market, side, 'market', price, qty);
  }

  // ─── Strategy: Whale (large limit orders) ──────────────
  private async runWhale(market: string) {
    const price = await this.getLastPrice(market);
    // Place a large order far from the market to simulate a pending large trade
    const offset = price * 0.02; // 2% away
    const side = Math.random() > 0.5 ? 'buy' : 'sell';
    const priceOffset = side === 'buy' ? price - offset : price + offset;
    const qty = 0.01 * (1 + randomBetween(0, 4)); // 0.01–0.05 BTC
    await this.placeOrder(market, side, 'limit', priceOffset, qty);
  }

  // ─── Main Loop ────────────────────────────────────────────
  async start() {
    if (!this.state) await this.initialize();
    console.log(`Bot ${this.botId} starting loops...`);

    while (this.running) {
      const market = CONFIG.MARKETS[this.marketIndex % CONFIG.MARKETS.length];
      this.marketIndex++;

      // Randomly pick a strategy
      const strategy = randomInt(1, 3);
      try {
        if (strategy === 1) {
          await this.runMaker(market);
        } else if (strategy === 2) {
          await this.runTaker(market);
        } else {
          await this.runWhale(market);
        }
      } catch (err) {
        // log but continue
        console.error(`Bot ${this.botId} error on ${market}:`, err);
      }

      await sleep(CONFIG.LOOP_INTERVAL);
    }
  }

  stop() {
    this.running = false;
  }
}
