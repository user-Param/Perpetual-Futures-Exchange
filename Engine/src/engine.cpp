#include "engine.h"
#include <iostream>

namespace exch {

namespace {
std::string jstr(const nlohmann::json& j, const char* key, const std::string& def) {
  auto it = j.find(key);
  if (it != j.end() && it->is_string()) return it->get<std::string>();
  return def;
}

bool jbool(const nlohmann::json& j, const char* key, bool def) {
  auto it = j.find(key);
  if (it != j.end() && it->is_boolean()) return it->get<bool>();
  if (it != j.end() && it->is_string()) {
    std::string s = it->get<std::string>();
    return s == "true" || s == "1";
  }
  return def;
}

int64_t jint(const nlohmann::json& j, const char* key, int64_t def) {
  auto it = j.find(key);
  if (it != j.end() && it->is_number()) return it->get<int64_t>();
  if (it != j.end() && it->is_string()) {
    try {
      return std::stoll(it->get<std::string>());
    } catch (...) {
      return def;
    }
  }
  return def;
}
}  // namespace

Engine::Engine() = default;

std::shared_ptr<OrderBook> Engine::getBook(const std::string& market) {
  std::lock_guard<std::mutex> lk(mu_);
  auto it = books_.find(market);
  if (it != books_.end()) return it->second;
  auto b = std::make_shared<OrderBook>(market);
  books_[market] = b;
  return b;
}

void Engine::publish(const nlohmann::json& ev) {
  if (cb_) cb_(ev);
}

void Engine::placeOrder(const nlohmann::json& oj) {
  Order o;
  o.id = jstr(oj, "id", jstr(oj, "orderId", ""));
  o.userId = jstr(oj, "userId", "");
  o.market = jstr(oj, "market", "");
  o.side = parseSide(jstr(oj, "side", "buy"));
  o.type = parseOrderType(jstr(oj, "orderType", "limit"));
  std::string priceStr = jstr(oj, "price", "0");
  if (!priceStr.empty()) o.price = Decimal(priceStr);
  o.quantity = Decimal(jstr(oj, "quantity", "0"));
  o.filled = Decimal(int64_t(0));
  o.tif = parseTif(jstr(oj, "timeInForce", "GTC"));
  o.reduceOnly = jbool(oj, "reduceOnly", false);
  o.postOnly = jbool(oj, "postOnly", false);
  o.clientOrderId = jstr(oj, "clientOrderId", "");
  o.leverage = Decimal(jstr(oj, "leverage", "1"));
  o.marginMode = jstr(oj, "marginMode", "isolated");
  o.timestamp = jint(oj, "timestamp", 0);
  o.status = OrderStatus::Open;

  if (o.id.empty() || o.market.empty() || o.userId.empty() || o.quantity <= Decimal(int64_t(0))) {
    nlohmann::json ev;
    ev["type"] = "ORDER_REJECTED";
    ev["orderId"] = o.id;
    ev["market"] = o.market;
    ev["reason"] = "invalid_order";
    publish(ev);
    return;
  }

  std::shared_ptr<OrderBook> book;
  {
    std::lock_guard<std::mutex> lk(mu_);
    auto it = books_.find(o.market);
    if (it == books_.end()) {
      auto b = std::make_shared<OrderBook>(o.market);
      books_[o.market] = b;
      book = b;
    } else {
      book = it->second;
    }
  }

  auto trades = book->match(o);
  {
    nlohmann::json ev;
    ev["type"] = "ORDER_ACCEPTED";
    ev["orderId"] = o.id;
    ev["market"] = o.market;
    ev["userId"] = o.userId;
    ev["side"] = sideStr(o.side);
    ev["orderType"] = orderTypeStr(o.type);
    ev["price"] = o.type == OrderType::Limit ? o.price.toString() : "";
    ev["quantity"] = o.quantity.toString();
    ev["filledQuantity"] = o.filled.toString();
    ev["status"] = statusStr(o.status);
    publish(ev);
  }

  for (auto& tr : trades) {
    nlohmann::json ev;
    ev["type"] = "TRADE_EXECUTED";
    ev["market"] = tr.market;
    ev["makerOrderId"] = tr.makerOrderId;
    ev["takerOrderId"] = tr.takerOrderId;
    ev["makerUserId"] = tr.makerUserId;
    ev["takerUserId"] = tr.takerUserId;
    ev["side"] = sideStr(tr.takerSide);
    ev["price"] = tr.price.toString();
    ev["quantity"] = tr.quantity.toString();
    ev["timestamp"] = tr.timestamp;
    publish(ev);
  }

  if (o.filled >= o.quantity) {
    nlohmann::json ev;
    ev["type"] = "ORDER_FILLED";
    ev["orderId"] = o.id;
    ev["market"] = o.market;
    ev["userId"] = o.userId;
    ev["filledQuantity"] = o.filled.toString();
    ev["price"] = o.type == OrderType::Limit ? o.price.toString() : (trades.empty() ? "" : trades.front().price.toString());
    publish(ev);
  } else if (o.status == OrderStatus::Rejected) {
    nlohmann::json ev;
    ev["type"] = "ORDER_REJECTED";
    ev["orderId"] = o.id;
    ev["market"] = o.market;
    ev["reason"] = "post_only_would_cross";
    publish(ev);
  } else if (o.filled < o.quantity) {
    // Remaining quantity that will not rest on the book (market or IOC/FOK orders)
    // is implicitly canceled. Emit ORDER_CANCELED so the DB writer unlocks margin.
    bool rests = o.type == OrderType::Limit && o.tif == TimeInForce::GTC;
    if (!rests) {
      nlohmann::json ev;
      ev["type"] = "ORDER_CANCELED";
      ev["orderId"] = o.id;
      ev["market"] = o.market;
      ev["userId"] = o.userId;
      ev["reason"] = "unfilled_remainder_canceled";
      ev["filledQuantity"] = o.filled.toString();
      publish(ev);
    }
  }

  // Emit order book update for this market.
  {
    nlohmann::json ev;
    ev["type"] = "ORDER_BOOK_UPDATED";
    ev["market"] = o.market;
    ev["bids"] = nlohmann::json::array();
    ev["asks"] = nlohmann::json::array();
    auto depth = book->depthJson(20);
    for (auto& b : depth["bids"]) ev["bids"].push_back(b);
    for (auto& a : depth["asks"]) ev["asks"].push_back(a);
    publish(ev);
  }
}

void Engine::cancelOrder(const std::string& market, const std::string& orderId, const std::string& userId) {
  std::shared_ptr<OrderBook> book;
  {
    std::lock_guard<std::mutex> lk(mu_);
    auto it = books_.find(market);
    if (it == books_.end()) return;
    book = it->second;
  }
  bool removed = book->cancel(orderId);
  if (removed) {
    nlohmann::json ev;
    ev["type"] = "ORDER_CANCELED";
    ev["orderId"] = orderId;
    ev["market"] = market;
    ev["userId"] = userId;
    publish(ev);
    nlohmann::json ev2;
    ev2["type"] = "ORDER_BOOK_UPDATED";
    ev2["market"] = market;
    auto depth = book->depthJson(20);
    ev2["bids"] = nlohmann::json::array();
    ev2["asks"] = nlohmann::json::array();
    for (auto& b : depth["bids"]) ev2["bids"].push_back(b);
    for (auto& a : depth["asks"]) ev2["asks"].push_back(a);
    publish(ev2);
  }
}

void Engine::processCommand(const nlohmann::json& cmd) {
  std::string type = cmd.value("type", "");
  if (type == "PLACE_ORDER") {
    if (cmd.contains("payload")) {
      auto p = cmd["payload"];
      if (p.is_string()) {
        // Payload arrives as a serialized JSON string (from the API outbox worker).
        std::string payloadStr = p.get_ref<const std::string&>();
        nlohmann::json parsed;
        try {
          parsed = nlohmann::json::parse(payloadStr);
        } catch (const std::exception& e) {
          std::cerr << "[engine] payload PARSE error: " << e.what()
                    << " | payload=" << payloadStr.substr(0, 160) << std::endl;
          return;
        }
        try {
          placeOrder(parsed);
        } catch (const std::exception& e) {
          std::cerr << "[engine] placeOrder error: " << e.what()
                    << " | orderId=" << jstr(parsed, "orderId", "") << std::endl;
        }
      } else {
        std::cerr << "[engine] PLACE_ORDER payload is not a string (type=" << p.type_name() << ")" << std::endl;
        placeOrder(p);
      }
    } else {
      placeOrder(cmd);
    }
  } else if (type == "CANCEL_ORDER") {
    std::string market = cmd.value("market", "");
    std::string orderId = cmd.value("orderId", "");
    std::string userId = cmd.value("userId", "");
    cancelOrder(market, orderId, userId);
  }
}

nlohmann::json Engine::snapshotState() const {
  std::lock_guard<std::mutex> lk(mu_);
  nlohmann::json state;
  state["books"] = nlohmann::json::array();
  for (auto& [m, b] : books_) {
    state["books"].push_back(b->serializeState());
  }
  return state;
}

void Engine::restoreState(const nlohmann::json& state) {
  std::lock_guard<std::mutex> lk(mu_);
  books_.clear();
  for (auto& bj : state.value("books", nlohmann::json::array())) {
    std::string m = bj.value("market", "");
    if (m.empty()) continue;
    auto b = std::make_shared<OrderBook>(m);
    b->restoreState(bj);
    books_[m] = b;
  }
}

std::vector<std::string> Engine::markets() const {
  std::lock_guard<std::mutex> lk(mu_);
  std::vector<std::string> r;
  for (auto& [m, _] : books_) r.push_back(m);
  return r;
}

void Engine::publishAllBookUpdates() {
  std::lock_guard<std::mutex> lk(mu_);
  for (auto& [m, b] : books_) {
    nlohmann::json ev;
    ev["type"] = "ORDER_BOOK_UPDATED";
    ev["market"] = m;
    auto depth = b->depthJson(20);
    ev["bids"] = depth["bids"];
    ev["asks"] = depth["asks"];
    publish(ev);
  }
}

}  // namespace exch
