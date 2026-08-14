#!/usr/bin/env python3
"""Integration test suite for the Perpetual Futures Exchange REST API.

Covers auth, balances, markets, market data, order validation, cancellation,
matching, market-buy, post-only rejection, idempotency, listing, cancel-all,
insufficient funds, position close, fills, engine events (Redis pub/sub), and
funding payments.

Run:  python3 test/unit_test_1.py
Prereqs: API on :3000 (with DB writer), engine running, PostgreSQL, Redis, Kafka.
Requires an otherwise empty order book (see CLAUDE.md notes on cleaning the
engine snapshot / Redis stream before a fresh run).
"""

import json
import threading
import time
import unittest
from decimal import Decimal

import redis as redis_lib
import requests

BASE = "http://localhost:3000/api/v1"
MARKET = "BTC-USDT-PERP"
ETH_MARKET = "ETH-USDT-PERP"
REDIS_CHANNEL = "engine_events"
REDIS_HOST = "127.0.0.1"
REDIS_PORT = 6379

RUN = time.time_ns() % 10 ** 9
_SEQ = [0]


def _unique(label):
    _SEQ[0] += 1
    return f"{label}-{RUN}-{_SEQ[0]}@example.com"


def D(x):
    return Decimal(str(x))


class ExchangeTestCase(unittest.TestCase):
    api = requests.Session()

    @classmethod
    def setUpClass(cls):
        try:
            r = cls.api.get("http://localhost:3000/health", timeout=5)
        except requests.ConnectionError:
            raise RuntimeError("API is not reachable on http://localhost:3000")
        assert r.status_code == 200, r.text

    def setUp(self):
        self.tokens = []

    def tearDown(self):
        for token in self.tokens:
            try:
                self.api.delete(f"{BASE}/orders", headers=self.h(token), timeout=10)
            except Exception:
                pass

    # ------------------------------------------------------------- helpers
    def h(self, token):
        return {"Authorization": f"Bearer {token}"}

    def register(self, label, password="Password123", name=None):
        email = _unique(label)
        r = self.api.post(
            f"{BASE}/auth/register",
            json={"email": email, "password": password, "name": name or label},
            timeout=10,
        )
        self.assertEqual(r.status_code, 201, f"register {label}: {r.status_code} {r.text}")
        data = r.json()
        self.tokens.append(data["token"])
        return data

    def deposit(self, token, asset, amount):
        r = self.api.post(
            f"{BASE}/balances/deposit",
            headers=self.h(token),
            json={"asset": asset, "amount": str(amount)},
            timeout=10,
        )
        self.assertEqual(r.status_code, 200, f"deposit {asset}={amount}: {r.text}")
        return r.json()

    def balmap(self, token):
        r = self.api.get(f"{BASE}/balances", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        return {
            b["symbol"]: {"available": D(b["available"]), "locked": D(b["locked"])}
            for b in r.json()["balances"]
        }

    def bal(self, token, symbol):
        return self.balmap(token).get(symbol, {"available": D(0), "locked": D(0)})

    def place(self, token, **kw):
        body = {"market": MARKET, "side": "buy", "orderType": "limit", "quantity": "0.01"}
        body.update(kw)
        r = self.api.post(f"{BASE}/orders", headers=self.h(token), json=body, timeout=10)
        self.assertIn(r.status_code, (200, 201), f"place {kw}: {r.status_code} {r.text}")
        return r.json()

    def get_order(self, token, oid):
        r = self.api.get(f"{BASE}/orders/{oid}", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def orders(self, token, **params):
        r = self.api.get(f"{BASE}/orders", headers=self.h(token), params=params, timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["orders"]

    def cancel(self, token, oid):
        r = self.api.delete(f"{BASE}/orders/{oid}", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def positions(self, token, status="open"):
        r = self.api.get(
            f"{BASE}/positions", headers=self.h(token), params={"status": status}, timeout=10
        )
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["positions"]

    def wait_until(self, pred, timeout=20, interval=0.2, what="condition"):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if pred():
                    return True
            except Exception:
                pass
            time.sleep(interval)
        return False

    def wait_order_status(self, token, oid, status):
        self.assertTrue(
            self.wait_until(lambda: self.get_order(token, oid)["status"] == status),
            f"order {oid} did not reach status {status}",
        )

    # ------------------------------------------------------------- tests
    def test_00_auth_required(self):
        # Market data is public.
        for p in (f"/markets", f"/markets/{MARKET}"):
            r = self.api.get(f"{BASE}{p}", timeout=10)
            self.assertNotEqual(r.status_code, 401, f"{p} should be public")
        # Everything else requires a token.
        protected = [
            "/auth/me",
            "/balances",
            "/balances/deposit",
            "/balances/withdraw",
            "/orders",
            "/positions",
            "/fills",
            "/funding/payments",
        ]
        for p in protected:
            r = self.api.get(f"{BASE}{p}", timeout=10)
            self.assertEqual(r.status_code, 401, f"{p} should require auth")
        r = self.api.post(f"{BASE}/orders", json={}, timeout=10)
        self.assertEqual(r.status_code, 401)
        r = self.api.post(f"{BASE}/auth/logout", timeout=10)
        self.assertEqual(r.status_code, 401)

    def test_01_register_login_me(self):
        email = _unique("auth")
        r = self.api.post(
            f"{BASE}/auth/register",
            json={"email": email, "password": "Password123", "name": "Auth Tester"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 201, r.text)
        data = r.json()
        token, user = data["token"], data["user"]
        self.assertEqual(user["email"], email)
        self.tokens.append(token)

        r = self.api.post(
            f"{BASE}/auth/register",
            json={"email": email, "password": "Password123", "name": "Duplicate"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 409, r.text)
        self.assertEqual(r.json()["error"], "email_already_registered")

        r = self.api.post(
            f"{BASE}/auth/login",
            json={"email": email, "password": "WrongPass1"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 401, r.text)
        self.assertEqual(r.json()["error"], "invalid_credentials")

        r = self.api.post(
            f"{BASE}/auth/login",
            json={"email": email, "password": "Password123"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.tokens.append(r.json()["token"])

        r = self.api.get(f"{BASE}/auth/me", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["email"], email)

        r = self.api.post(f"{BASE}/auth/logout", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json().get("ok"), True)

    def test_02_register_validation(self):
        r = self.api.post(
            f"{BASE}/auth/register",
            json={"email": _unique("noname"), "password": "Password123"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "name_required")

        r = self.api.post(
            f"{BASE}/auth/register",
            json={"email": _unique("shortpw"), "password": "abc", "name": "Short"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "validation_error")

        r = self.api.post(
            f"{BASE}/auth/register",
            json={"email": "not-an-email", "password": "Password123", "name": "Bad"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "validation_error")

    def test_03_balances_flow(self):
        token = self.register("bal")["token"]

        r = self.api.post(
            f"{BASE}/balances/deposit",
            headers=self.h(token),
            json={"asset": "USDT", "amount": "10000"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(D(r.json()["available"]), D("10000"))

        self.deposit(token, "BTC", "1")

        b = self.bal(token, "USDT")
        self.assertEqual(b["available"], D("10000"))
        self.assertEqual(b["locked"], D("0"))
        b = self.bal(token, "BTC")
        self.assertEqual(b["available"], D("1"))
        self.assertEqual(b["locked"], D("0"))

        r = self.api.post(
            f"{BASE}/balances/withdraw",
            headers=self.h(token),
            json={"asset": "USDT", "amount": "1000"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(D(r.json()["available"]), D("9000"))
        self.assertEqual(self.bal(token, "USDT")["available"], D("9000"))

        r = self.api.post(
            f"{BASE}/balances/withdraw",
            headers=self.h(token),
            json={"asset": "USDT", "amount": "999999"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "insufficient_balance")

        r = self.api.post(
            f"{BASE}/balances/deposit",
            headers=self.h(token),
            json={"asset": "USDT", "amount": "0"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "amount_must_be_positive")

        r = self.api.post(
            f"{BASE}/balances/deposit",
            headers=self.h(token),
            json={"asset": "USDT", "amount": "abc"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "validation_error")

        r = self.api.post(
            f"{BASE}/balances/deposit",
            headers=self.h(token),
            json={"asset": "XYZ", "amount": "1"},
            timeout=10,
        )
        self.assertEqual(r.status_code, 404, r.text)
        self.assertEqual(r.json()["error"], "asset_not_found")

    def test_04_markets(self):
        r = self.api.get(f"{BASE}/markets", timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        symbols = {m["symbol"] for m in r.json()["markets"]}
        self.assertIn(MARKET, symbols)
        self.assertIn(ETH_MARKET, symbols)

        r = self.api.get(f"{BASE}/markets/{MARKET}", timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        m = r.json()
        self.assertEqual(m["symbol"], MARKET)
        self.assertEqual(D(m["tickSize"]), D("0.5"))
        self.assertEqual(int(m["makerFeeBps"]), 10)
        self.assertEqual(int(m["takerFeeBps"]), 20)
        self.assertEqual(int(m["maxLeverage"]), 50)

        r = self.api.get(f"{BASE}/markets/NOPE", timeout=10)
        self.assertEqual(r.status_code, 404, r.text)
        self.assertEqual(r.json()["error"], "market_not_found")

    def test_05_market_data_endpoints(self):
        r = self.api.get(f"{BASE}/markets/{MARKET}/orderbook", timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        ob = r.json()
        self.assertEqual(ob["symbol"], MARKET)
        self.assertIsInstance(ob["bids"], list)
        self.assertIsInstance(ob["asks"], list)
        for level in ob["bids"] + ob["asks"]:
            self.assertEqual(len(level), 2)
            D(level[0])
            D(level[1])

        r = self.api.get(f"{BASE}/markets/{MARKET}/trades", timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsInstance(r.json()["trades"], list)

        r = self.api.get(f"{BASE}/markets/{MARKET}/ticker", timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        t = r.json()
        self.assertEqual(t["symbol"], MARKET)
        for key in ("lastPrice", "volume24h", "tradeCount"):
            self.assertIn(key, t)

        r = self.api.get(f"{BASE}/markets/NOPE/ticker", timeout=10)
        self.assertEqual(r.status_code, 404, r.text)

    def test_06_order_validation(self):
        token = self.register("val")["token"]
        cases = [
            ({"market": "NOPE", "side": "buy", "orderType": "limit", "price": "50000", "quantity": "0.01"},
             404, "market_not_found"),
            ({"market": MARKET, "side": "buy", "orderType": "limit", "price": "abc", "quantity": "0.01"},
             400, "validation_error"),
            ({"market": MARKET, "side": "buy", "orderType": "limit", "price": "50000", "quantity": "0"},
             400, "quantity_must_be_positive"),
            ({"market": MARKET, "side": "buy", "orderType": "limit", "price": "50000", "quantity": "0.00001"},
             400, "quantity_below_min"),
            ({"market": MARKET, "side": "buy", "orderType": "limit", "price": "50000", "quantity": "0.01", "leverage": "100"},
             400, "leverage_exceeds_max"),
            ({"market": MARKET, "side": "buy", "orderType": "limit", "quantity": "0.01"},
             400, "limit_order_requires_price"),
            ({"market": MARKET, "side": "buy", "orderType": "market", "quantity": "0.01"},
             400, "market_buy_requires_price_for_margin_calc"),
        ]
        for body, code, err in cases:
            r = self.api.post(f"{BASE}/orders", headers=self.h(token), json=body, timeout=10)
            self.assertEqual(r.status_code, code, f"{body} -> {r.status_code} {r.text}")
            self.assertEqual(r.json()["error"], err, f"{body} -> {r.text}")

        self.assertEqual(self.orders(token), [])
        self.assertEqual(self.bal(token, "USDT")["available"], D("0"))

    def test_07_cancel_order_flow(self):
        token = self.register("cancel")["token"]
        self.deposit(token, "USDT", "10000")

        oid = self.place(token, side="buy", orderType="limit", price="21000",
                         quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(token, oid, "open")
        self.assertEqual(self.bal(token, "USDT")["locked"], D("21"))

        r = self.cancel(token, oid)
        self.assertEqual(r["status"], "canceled")
        self.assertTrue(self.wait_until(
            lambda: self.bal(token, "USDT")["locked"] == D("0"),
            what="margin unlocked after cancel"))
        self.assertEqual(self.bal(token, "USDT")["available"], D("10000"))
        self.assertEqual(self.get_order(token, oid)["status"], "canceled")

        r = self.api.delete(f"{BASE}/orders/{oid}", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "order_not_cancellable")

    def test_08_matching_basic(self):
        a = self.register("mk1")
        b = self.register("mk2")
        ta, tb = a["token"], b["token"]
        self.deposit(ta, "USDT", "10000")
        self.deposit(tb, "USDT", "10000")
        self.deposit(tb, "BTC", "1")

        buy_id = self.place(ta, side="buy", orderType="limit", price="51000",
                            quantity="0.01", leverage="10")["order"]["id"]
        sell_id = self.place(tb, side="sell", orderType="limit", price="51000",
                             quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(ta, buy_id, "filled")
        self.wait_order_status(tb, sell_id, "filled")

        # Maker (A): 10000 - 51 margin - 0.51 maker fee, + 0.01 BTC.
        b1 = self.bal(ta, "USDT")
        self.assertEqual(b1["available"], D("9948.49"))
        self.assertEqual(b1["locked"], D("0"))
        self.assertEqual(self.bal(ta, "BTC")["available"], D("0.01"))
        # Taker (B): 10000 + (510 - 1.02 taker fee), BTC down to 0.99.
        b2 = self.bal(tb, "USDT")
        self.assertEqual(b2["available"], D("10508.98"))
        self.assertEqual(b2["locked"], D("0"))
        self.assertEqual(self.bal(tb, "BTC")["available"], D("0.99"))

        pa = self.positions(ta)
        self.assertEqual(len(pa), 1)
        self.assertEqual(pa[0]["side"], "long")
        self.assertEqual(D(pa[0]["quantity"]), D("0.01"))
        pb = self.positions(tb)
        self.assertEqual(len(pb), 1)
        self.assertEqual(pb[0]["side"], "short")

    def test_09_market_buy(self):
        a = self.register("mkbuy")
        b = self.register("mkbuy2")
        ta, tb = a["token"], b["token"]
        self.deposit(ta, "USDT", "10000")
        self.deposit(tb, "BTC", "1")

        ask_id = self.place(tb, side="sell", orderType="limit", price="31000",
                            quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(tb, ask_id, "open")

        mkt_id = self.place(ta, side="buy", orderType="market", price="31000",
                            quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(ta, mkt_id, "filled")
        self.wait_order_status(tb, ask_id, "filled")

        # Taker (A): 10000 - 31 margin - 0.62 taker fee, + 0.01 BTC.
        b1 = self.bal(ta, "USDT")
        self.assertEqual(b1["available"], D("9968.38"))
        self.assertEqual(b1["locked"], D("0"))
        self.assertEqual(self.bal(ta, "BTC")["available"], D("0.01"))
        # Maker (B): 310 - 0.31 maker fee.
        b2 = self.bal(tb, "USDT")
        self.assertEqual(b2["available"], D("309.69"))
        self.assertEqual(b2["locked"], D("0"))
        self.assertEqual(self.bal(tb, "BTC")["available"], D("0.99"))

    def test_10_post_only_rejection(self):
        a = self.register("post")
        b = self.register("post2")
        ta, tb = a["token"], b["token"]
        self.deposit(ta, "USDT", "10000")
        self.deposit(tb, "BTC", "1")

        ask_id = self.place(tb, side="sell", orderType="limit", price="32000",
                            quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(tb, ask_id, "open")

        r = self.api.post(f"{BASE}/orders", headers=self.h(ta), timeout=10, json={
            "market": MARKET, "side": "buy", "orderType": "limit", "price": "33000",
            "quantity": "0.01", "leverage": "10", "postOnly": True,
        })
        self.assertEqual(r.status_code, 201, r.text)
        oid = r.json()["order"]["id"]

        self.wait_order_status(ta, oid, "rejected")
        self.assertTrue(self.wait_until(
            lambda: self.bal(ta, "USDT")["locked"] == D("0"),
            what="post-only margin unlocked after rejection"))
        self.assertEqual(self.bal(ta, "USDT")["available"], D("10000"))
        self.assertTrue(self.wait_until(
            lambda: any(D(l[0]) == D("32000")
                        for l in self.api.get(f"{BASE}/markets/{MARKET}/orderbook",
                                              timeout=10).json()["asks"]),
            what="resting ask still on the book"))
        self.assertFalse(self.positions(ta))

    def test_11_idempotent_place(self):
        token = self.register("idem")["token"]
        self.deposit(token, "USDT", "10000")
        co = "co-idem-" + str(RUN)

        r1 = self.place(token, side="buy", orderType="limit", price="23000",
                        quantity="0.01", leverage="10", clientOrderId=co)
        self.assertEqual(r1["idempotent"], False)
        oid = r1["order"]["id"]

        r2 = self.place(token, side="buy", orderType="limit", price="23000",
                        quantity="0.01", leverage="10", clientOrderId=co)
        self.assertEqual(r2["idempotent"], True)
        self.assertEqual(r2["order"]["id"], oid)

        rows = [o for o in self.orders(token) if o.get("clientOrderId") == co]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], oid)

    def test_12_order_listing(self):
        token = self.register("list")["token"]
        self.deposit(token, "USDT", "10000")
        o1 = self.place(token, side="buy", orderType="limit", price="23000",
                        quantity="0.01", leverage="10")["order"]["id"]
        o2 = self.place(token, side="buy", orderType="limit", price="24000",
                        quantity="0.01", leverage="10")["order"]["id"]

        ids = {o["id"] for o in self.orders(token)}
        self.assertIn(o1, ids)
        self.assertIn(o2, ids)

        open_rows = self.orders(token, status="open")
        self.assertEqual(len(open_rows), 2)

        o = self.get_order(token, o1)
        self.assertEqual(o["id"], o1)
        self.assertEqual(o["status"], "open")

        r = self.api.get(f"{BASE}/orders/00000000-0000-4000-8000-000000000000",
                         headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 404, r.text)

    def test_13_cancel_all(self):
        token = self.register("cancelall")["token"]
        self.deposit(token, "USDT", "10000")
        for price in ("23000", "24000", "25000"):
            self.place(token, side="buy", orderType="limit", price=price,
                       quantity="0.01", leverage="10")

        r = self.api.delete(f"{BASE}/orders", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["canceled"], 3)

        self.assertTrue(self.wait_until(
            lambda: all(o["status"] == "canceled" for o in self.orders(token)),
            what="all orders canceled"))
        self.assertTrue(self.wait_until(
            lambda: self.bal(token, "USDT")["locked"] == D("0"),
            what="margin unlocked after cancel-all"))

    def test_14_insufficient_balance(self):
        token = self.register("poor")["token"]
        self.deposit(token, "USDT", "10")

        r = self.api.post(f"{BASE}/orders", headers=self.h(token), timeout=10, json={
            "market": MARKET, "side": "buy", "orderType": "limit", "price": "50000",
            "quantity": "0.01", "leverage": "1",
        })
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(r.json()["error"], "insufficient_balance")
        self.assertEqual(self.bal(token, "USDT")["available"], D("10"))

        # No deposit at all: the balance row does not exist yet.
        d2 = self.register("poor2")
        r = self.api.post(f"{BASE}/orders", headers=self.h(d2["token"]), timeout=10, json={
            "market": MARKET, "side": "sell", "orderType": "limit", "price": "30000",
            "quantity": "0.01",
        })
        self.assertEqual(r.status_code, 400, r.text)
        self.assertIn(r.json()["error"], ("insufficient_balance", "balance_not_found"))

    def test_15_close_position(self):
        a = self.register("closeA")
        b = self.register("closeB")
        c = self.register("closeC")
        ta, tb, tc = a["token"], b["token"], c["token"]
        self.deposit(ta, "USDT", "10000")
        self.deposit(tb, "BTC", "1")
        self.deposit(tc, "USDT", "10000")

        # Create a long position for A by crossing with B.
        buy_id = self.place(ta, side="buy", orderType="limit", price="50000",
                            quantity="0.01", leverage="10")["order"]["id"]
        sell_id = self.place(tb, side="sell", orderType="limit", price="50000",
                             quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(ta, buy_id, "filled")
        self.wait_order_status(tb, sell_id, "filled")

        pa = self.positions(ta)
        self.assertEqual(len(pa), 1)
        pos = pa[0]
        self.assertEqual(pos["side"], "long")

        # C rests a bid for A to sell into.
        c_buy = self.place(tc, side="buy", orderType="limit", price="52000",
                           quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(tc, c_buy, "open")

        r = self.api.post(f"{BASE}/positions/{pos['id']}/close", headers=self.h(ta), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        close_order = r.json()["order"]
        self.assertEqual(close_order["side"], "sell")
        self.wait_order_status(ta, close_order["id"], "filled")

        self.assertTrue(self.wait_until(
            lambda: self.api.get(f"{BASE}/positions/{pos['id']}", headers=self.h(ta),
                                 timeout=10).json().get("status") == "closed",
            what="position closed"))

        open_pos = self.positions(ta)
        self.assertTrue(all(p["id"] != pos["id"] for p in open_pos), open_pos)
        closed = self.positions(ta, status="closed")
        self.assertTrue(any(p["id"] == pos["id"] for p in closed), closed)

        pc = self.positions(tc)
        self.assertEqual(len(pc), 1)
        self.assertEqual(pc[0]["side"], "long")
        self.assertEqual(D(pc[0]["quantity"]), D("0.01"))

    def test_16_fills_listing(self):
        a = self.register("fillsA")
        b = self.register("fillsB")
        ta, tb = a["token"], b["token"]
        self.deposit(ta, "USDT", "10000")
        self.deposit(tb, "BTC", "1")

        buy_id = self.place(ta, side="buy", orderType="limit", price="47000",
                            quantity="0.01", leverage="10")["order"]["id"]
        sell_id = self.place(tb, side="sell", orderType="limit", price="47000",
                             quantity="0.01", leverage="10")["order"]["id"]
        self.wait_order_status(ta, buy_id, "filled")
        self.wait_order_status(tb, sell_id, "filled")

        fa = self.api.get(f"{BASE}/fills", headers=self.h(ta), timeout=10).json()["fills"]
        self.assertTrue(any(
            D(f["price"]) == D("47000") and D(f["quantity"]) == D("0.01")
            and f["makerOrderId"] == buy_id
            for f in fa), fa)

        fb = self.api.get(f"{BASE}/fills", headers=self.h(tb), timeout=10).json()["fills"]
        self.assertTrue(any(
            D(f["price"]) == D("47000") and f["takerOrderId"] == sell_id
            for f in fb), fb)

    def test_17_engine_events_redis(self):
        rc = redis_lib.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        ps = rc.pubsub()
        ps.subscribe(REDIS_CHANNEL)
        ps.get_message(timeout=1)
        events = []
        stop = threading.Event()

        def collect():
            while not stop.is_set():
                msg = ps.get_message(timeout=0.2)
                if msg and msg.get("type") == "message":
                    try:
                        events.append(json.loads(msg["data"]))
                    except ValueError:
                        pass

        t = threading.Thread(target=collect, daemon=True)
        t.start()
        try:
            token = self.register("redis")["token"]
            self.deposit(token, "USDT", "10000")
            oid = self.place(token, side="buy", orderType="limit", price="22000",
                             quantity="0.01", leverage="10")["order"]["id"]

            self.assertTrue(self.wait_until(
                lambda: any(e.get("type") == "ORDER_ACCEPTED" and e.get("orderId") == oid
                            for e in events),
                timeout=10, what="ORDER_ACCEPTED event"))
            self.assertTrue(self.wait_until(
                lambda: any(e.get("type") == "ORDER_BOOK_UPDATED" and e.get("market") == MARKET
                            for e in events),
                timeout=10, what="ORDER_BOOK_UPDATED event"))
            self.assertTrue(self.wait_until(
                lambda: any(D(l[0]) == D("22000") and D(l[1]) == D("0.01")
                            for l in self.api.get(f"{BASE}/markets/{MARKET}/orderbook",
                                                  timeout=10).json()["bids"]),
                timeout=10, what="orderbook shows resting bid"))
        finally:
            stop.set()
            t.join(timeout=2)
            ps.close()

    def test_18_funding_payments(self):
        token = self.register("funding")["token"]
        r = self.api.get(f"{BASE}/funding/payments", headers=self.h(token), timeout=10)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIsInstance(r.json()["payments"], list)


if __name__ == "__main__":
    unittest.main(verbosity=2)
