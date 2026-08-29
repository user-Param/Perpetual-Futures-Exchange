import { config } from "../config";
import { logger } from "../logger";

export interface Market {
  id: string;
  symbol: string;
  baseAssetId: string;
  quoteAssetId: string;
  status: string;
  tickSize: string;
  stepSize: string;
  minOrderSize: string;
  maxOrderSize: string;
  maxLeverage: number;
  initialMarginRate: string;
  maintenanceMarginRate: string;
  makerFeeBps: number;
  takerFeeBps: number;
  fundingIntervalHours: number;
}

export interface Balance {
  asset: string;
  available: string;
  locked: string;
}

export interface Order {
  id: string;
  userId: string;
  marketId: string;
  clientOrderId: string | null;
  orderType: "market" | "limit";
  side: "buy" | "sell";
  price: string | null;
  quantity: string;
  filledQuantity: string;
  status: "pending" | "open" | "partially_filled" | "filled" | "canceled" | "rejected" | "expired";
  reduceOnly: boolean;
  postOnly: boolean;
  timeInForce: "GTC" | "IOC" | "FOK";
  leverage: string;
  marginMode: "isolated" | "cross";
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
}

export interface Position {
  id: string;
  userId: string;
  marketId: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  markPrice: string;
  liquidationPrice: string;
  margin: string;
  leverage: number;
  marginMode: "isolated" | "cross";
  realizedPnl: string;
  status: "open" | "closed" | "liquidated";
  openedAt: string;
  closedAt: string | null;
}

export interface PlaceOrderParams {
  market: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  price?: string;
  quantity: string;
  timeInForce?: "GTC" | "IOC" | "FOK";
  leverage?: string;
  marginMode?: "isolated" | "cross";
  reduceOnly?: boolean;
  postOnly?: boolean;
  clientOrderId?: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export class ExchangeClient {
  private baseUrl: string;
  private email: string;
  private password: string;
  private token: string | null = null;
  private requestTimeout = 10000;

  constructor() {
    this.baseUrl = config.exchange.apiUrl;
    this.email = config.exchange.email;
    this.password = config.exchange.password;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requireAuth = true
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (requireAuth && this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(`${method} ${path} failed: ${errorMessage}`);
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error(`Request timeout: ${method} ${path}`);
      }
      throw e;
    }
  }

  async authenticate(): Promise<void> {
    logger.info("Authenticating with exchange");
    const response = await this.request<AuthResponse>("POST", "/api/v1/auth/login", {
      email: this.email,
      password: this.password,
    }, false);

    this.token = response.token;
    logger.info("Exchange authentication successful", { userId: response.user.id });
  }

  getToken(): string | null {
    return this.token;
  }

  async getMarket(symbol: string): Promise<Market> {
    const response = await this.request<Market>("GET", `/api/v1/markets/${symbol}`);
    return response;
  }

  async getBalances(): Promise<Balance[]> {
    const response = await this.request<{ balances: Balance[] }>("GET", "/api/v1/balances");
    return response.balances;
  }

  async getOpenOrders(symbol: string): Promise<Order[]> {
    const response = await this.request<{ orders: Order[] }>("GET", `/api/v1/orders`, undefined, true);
    return response.orders.filter((o) => o.status === "open" || o.status === "partially_filled");
  }

  async placeLimitOrder(params: PlaceOrderParams): Promise<Order> {
    const response = await this.request<{ order: Order; idempotent: boolean }>("POST", "/api/v1/orders", params);
    return response.order;
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/orders/${orderId}`);
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    await this.request("DELETE", `/api/v1/orders`, undefined, true);
  }

  async getPosition(symbol: string): Promise<Position | null> {
    const response = await this.request<{ positions: Position[] }>("GET", "/api/v1/positions");
    const pos = response.positions.find((p) => {
      return p.marketId === symbol || p.side === symbol;
    });
    return pos || null;
  }

  async getUserId(): Promise<string> {
    const response = await this.request<{ user: { id: string } }>("GET", "/api/v1/auth/me");
    return response.user.id;
  }
}

export function createExchangeClient(): ExchangeClient {
  return new ExchangeClient();
}