"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExchangeClient = void 0;
exports.createExchangeClient = createExchangeClient;
const config_1 = require("../config");
const logger_1 = require("../logger");
class ExchangeClient {
    baseUrl;
    email;
    password;
    token = null;
    requestTimeout = 10000;
    constructor() {
        this.baseUrl = config_1.config.exchange.apiUrl;
        this.email = config_1.config.exchange.email;
        this.password = config_1.config.exchange.password;
    }
    async request(method, path, body, requireAuth = true) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
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
                }
                catch {
                    errorMessage = errorText || errorMessage;
                }
                throw new Error(`${method} ${path} failed: ${errorMessage}`);
            }
            if (response.status === 204) {
                return {};
            }
            return (await response.json());
        }
        catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof Error && e.name === "AbortError") {
                throw new Error(`Request timeout: ${method} ${path}`);
            }
            throw e;
        }
    }
    async authenticate() {
        logger_1.logger.info("Authenticating with exchange");
        const response = await this.request("POST", "/api/v1/auth/login", {
            email: this.email,
            password: this.password,
        }, false);
        this.token = response.token;
        logger_1.logger.info("Exchange authentication successful", { userId: response.user.id });
    }
    getToken() {
        return this.token;
    }
    async getMarket(symbol) {
        const response = await this.request("GET", `/api/v1/markets/${symbol}`);
        return response;
    }
    async getBalances() {
        const response = await this.request("GET", "/api/v1/balances");
        return response.balances;
    }
    async getOpenOrders(symbol) {
        const response = await this.request("GET", `/api/v1/orders`, undefined, true);
        return response.orders.filter((o) => o.status === "open" || o.status === "partially_filled");
    }
    async placeLimitOrder(params) {
        const response = await this.request("POST", "/api/v1/orders", params);
        return response.order;
    }
    async cancelOrder(orderId) {
        await this.request("DELETE", `/api/v1/orders/${orderId}`);
    }
    async cancelAllOrders(symbol) {
        await this.request("DELETE", `/api/v1/orders`, undefined, true);
    }
    async getPosition(symbol) {
        const response = await this.request("GET", "/api/v1/positions");
        const pos = response.positions.find((p) => {
            return p.marketId === symbol || p.side === symbol;
        });
        return pos || null;
    }
    async getUserId() {
        const response = await this.request("GET", "/api/v1/auth/me");
        return response.user.id;
    }
}
exports.ExchangeClient = ExchangeClient;
function createExchangeClient() {
    return new ExchangeClient();
}
//# sourceMappingURL=exchangeClient.js.map