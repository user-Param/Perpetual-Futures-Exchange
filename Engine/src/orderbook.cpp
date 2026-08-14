#include "orderbook.h"
#include <sstream>
#include <stdexcept>
#include <algorithm>
#include <deque>

namespace exch {

const char* orderTypeStr(OrderType t) {
  return t == OrderType::Limit ? "limit" : "market";
}
const char* sideStr(Side s) {
  return s == Side::Buy ? "buy" : "sell";
}
const char* tifStr(TimeInForce t) {
  switch (t) {
    case TimeInForce::GTC: return "GTC";
    case TimeInForce::IOC: return "IOC";
    case TimeInForce::FOK: return "FOK";
  }
  return "GTC";
}
const char* statusStr(OrderStatus s) {
  switch (s) {
    case OrderStatus::Pending: return "pending";
    case OrderStatus::Open: return "open";
    case OrderStatus::PartiallyFilled: return "partially_filled";
    case OrderStatus::Filled: return "filled";
    case OrderStatus::Canceled: return "canceled";
    case OrderStatus::Rejected: return "rejected";
    case OrderStatus::Expired: return "expired";
  }
  return "pending";
}

OrderType parseOrderType(const std::string& s) {
  if (s == "limit") return OrderType::Limit;
  return OrderType::Market;
}
Side parseSide(const std::string& s) {
  if (s == "sell") return Side::Sell;
  return Side::Buy;
}
TimeInForce parseTif(const std::string& s) {
  if (s == "IOC") return TimeInForce::IOC;
  if (s == "FOK") return TimeInForce::FOK;
  return TimeInForce::GTC;
}

OrderBook::OrderBook(std::string market) : market_(std::move(market)) {}

std::map<Decimal, std::deque<std::shared_ptr<Order>>, std::greater<Decimal>>::iterator OrderBook::bestBid() {
  return bids_.begin();
}
std::map<Decimal, std::deque<std::shared_ptr<Order>>>::iterator OrderBook::bestAsk() {
  return asks_.begin();
}

void OrderBook::popFrontOrder(
    std::map<Decimal, std::deque<std::shared_ptr<Order>>, std::greater<Decimal>>& book,
    std::map<Decimal, std::deque<std::shared_ptr<Order>>, std::greater<Decimal>>::iterator& it) {
  // Shared with asks_ via implicit cast
}

std::vector<Trade> OrderBook::match(Order& order) {
  std::vector<Trade> trades;
  if (order.type == OrderType::Limit && order.postOnly) {
    // Reject if would cross.
    if (order.side == Side::Buy) {
      auto it = bestAsk();
      if (it != asks_.end() && it->first <= order.price) {
        order.status = OrderStatus::Rejected;
        return trades;
      }
    } else {
      auto it = bestBid();
      if (it != bids_.end() && it->first >= order.price) {
        order.status = OrderStatus::Rejected;
        return trades;
      }
    }
  }

  // FOK pre-check: must be fully fillable.
  if (order.type == OrderType::Limit && order.tif == TimeInForce::FOK) {
    Decimal remaining = order.quantity;
    if (order.side == Side::Buy) {
      Decimal cumulative;
      for (auto it = asks_.begin(); it != asks_.end() && remaining > Decimal(int64_t(0)); ++it) {
        if (it->first > order.price) break;
        Decimal lvlQty;
        for (auto& o : it->second) {
          lvlQty += o->quantity - o->filled;
        }
        cumulative += lvlQty;
      }
      if (cumulative < order.quantity) {
        order.status = OrderStatus::Rejected;
        return trades;
      }
    } else {
      Decimal cumulative;
      for (auto it = bids_.begin(); it != bids_.end() && remaining > Decimal(int64_t(0)); ++it) {
        if (it->first < order.price) break;
        Decimal lvlQty;
        for (auto& o : it->second) {
          lvlQty += o->quantity - o->filled;
        }
        cumulative += lvlQty;
      }
      if (cumulative < order.quantity) {
        order.status = OrderStatus::Rejected;
        return trades;
      }
    }
  }

  // Matching loop.
  auto tryMatch = [&](Side incomingSide, const Decimal& limitPrice) {
    while (true) {
      Decimal remaining = order.quantity - order.filled;
      if (remaining <= Decimal(int64_t(0))) break;
      if (incomingSide == Side::Buy) {
        auto it = bestAsk();
        if (it == asks_.end()) break;
        if (order.type == OrderType::Limit && it->first > limitPrice) break;
        // Match against this level
        Decimal execPrice = it->first;
        while (remaining > Decimal(int64_t(0)) && !it->second.empty()) {
          auto& front = it->second.front();
          Decimal available = front->quantity - front->filled;
          if (available <= Decimal(int64_t(0))) {
            // Should not happen
            it->second.pop_front();
            orderIndex_.erase(front->id);
            continue;
          }
          Decimal execQty = std::min(remaining, available);
          // Update maker.
          front->filled += execQty;
          if (front->filled >= front->quantity) {
            front->status = OrderStatus::Filled;
          } else {
            front->status = OrderStatus::PartiallyFilled;
          }
          // Update taker.
          order.filled += execQty;
          remaining = order.quantity - order.filled;
          // Emit trade
          Trade tr;
          tr.market = market_;
          tr.makerOrderId = front->id;
          tr.takerOrderId = order.id;
          tr.makerUserId = front->userId;
          tr.takerUserId = order.userId;
          tr.takerSide = Side::Buy;
          tr.price = execPrice;
          tr.quantity = execQty;
          tr.timestamp = order.timestamp;
          trades.push_back(tr);
          if (front->filled >= front->quantity) {
            orderIndex_.erase(front->id);
            it->second.pop_front();
          }
        }
        if (it->second.empty()) asks_.erase(it);
      } else {
        auto it = bestBid();
        if (it == bids_.end()) break;
        if (order.type == OrderType::Limit && it->first < limitPrice) break;
        Decimal execPrice = it->first;
        while (remaining > Decimal(int64_t(0)) && !it->second.empty()) {
          auto& front = it->second.front();
          Decimal available = front->quantity - front->filled;
          if (available <= Decimal(int64_t(0))) {
            it->second.pop_front();
            orderIndex_.erase(front->id);
            continue;
          }
          Decimal execQty = std::min(remaining, available);
          front->filled += execQty;
          if (front->filled >= front->quantity) {
            front->status = OrderStatus::Filled;
          } else {
            front->status = OrderStatus::PartiallyFilled;
          }
          order.filled += execQty;
          remaining = order.quantity - order.filled;
          Trade tr;
          tr.market = market_;
          tr.makerOrderId = front->id;
          tr.takerOrderId = order.id;
          tr.makerUserId = front->userId;
          tr.takerUserId = order.userId;
          tr.takerSide = Side::Sell;
          tr.price = execPrice;
          tr.quantity = execQty;
          tr.timestamp = order.timestamp;
          trades.push_back(tr);
          if (front->filled >= front->quantity) {
            orderIndex_.erase(front->id);
            it->second.pop_front();
          }
        }
        if (it->second.empty()) bids_.erase(it);
      }
    }
  };

  if (order.side == Side::Buy) {
    Decimal limit = (order.type == OrderType::Limit) ? order.price : Decimal(int64_t(1e18));
    tryMatch(Side::Buy, limit);
  } else {
    Decimal limit = (order.type == OrderType::Limit) ? order.price : Decimal(int64_t(0));
    tryMatch(Side::Sell, limit);
  }

  Decimal remaining = order.quantity - order.filled;
  if (remaining > Decimal(int64_t(0))) {
    if (order.type == OrderType::Limit && order.tif == TimeInForce::GTC) {
      // Rest on book
      auto o = std::make_shared<Order>(order);
      o->status = (order.filled > Decimal(int64_t(0))) ? OrderStatus::PartiallyFilled : OrderStatus::Open;
      if (order.side == Side::Buy) {
        bids_[order.price].push_back(o);
      } else {
        asks_[order.price].push_back(o);
      }
      orderIndex_[o->id] = {order.side == Side::Buy, order.price.toString()};
      // Mark order in caller's copy: it now rests with filled amount.
      order.status = o->status;
    } else if (order.tif == TimeInForce::IOC) {
      order.status = (order.filled > Decimal(int64_t(0))) ? OrderStatus::PartiallyFilled : OrderStatus::Canceled;
    } else {
      // FOK was pre-checked; should not reach here.
      order.status = (order.filled > Decimal(int64_t(0))) ? OrderStatus::PartiallyFilled : OrderStatus::Canceled;
    }
  } else {
    order.status = OrderStatus::Filled;
  }
  return trades;
}

bool OrderBook::cancelResting(const std::string& orderId) {
  auto idx = orderIndex_.find(orderId);
  if (idx == orderIndex_.end()) return false;
  bool isBid = idx->second.first;
  const std::string& priceKey = idx->second.second;
  if (isBid) {
    for (auto it = bids_.begin(); it != bids_.end(); ++it) {
      if (it->first.toString() != priceKey) continue;
      auto& q = it->second;
      for (auto oit = q.begin(); oit != q.end(); ++oit) {
        if ((*oit)->id == orderId) {
          (*oit)->status = OrderStatus::Canceled;
          q.erase(oit);
          orderIndex_.erase(idx);
          if (q.empty()) bids_.erase(it);
          return true;
        }
      }
    }
  } else {
    for (auto it = asks_.begin(); it != asks_.end(); ++it) {
      if (it->first.toString() != priceKey) continue;
      auto& q = it->second;
      for (auto oit = q.begin(); oit != q.end(); ++oit) {
        if ((*oit)->id == orderId) {
          (*oit)->status = OrderStatus::Canceled;
          q.erase(oit);
          orderIndex_.erase(idx);
          if (q.empty()) asks_.erase(it);
          return true;
        }
      }
    }
  }
  return false;
}

bool OrderBook::cancel(const std::string& orderId) {
  return cancelResting(orderId);
}

nlohmann::json OrderBook::depthJson(int depth) const {
  nlohmann::json out;
  out["bids"] = nlohmann::json::array();
  out["asks"] = nlohmann::json::array();
  int b = 0;
  for (auto it = bids_.begin(); it != bids_.end() && b < depth; ++it, ++b) {
    Decimal qty;
    for (auto& o : it->second) qty += o->quantity - o->filled;
    out["bids"].push_back({it->first.toString(), qty.toString()});
  }
  int a = 0;
  for (auto it = asks_.begin(); it != asks_.end() && a < depth; ++it, ++a) {
    Decimal qty;
    for (auto& o : it->second) qty += o->quantity - o->filled;
    out["asks"].push_back({it->first.toString(), qty.toString()});
  }
  return out;
}

nlohmann::json OrderBook::serializeState() const {
  nlohmann::json state;
  state["market"] = market_;
  state["bids"] = nlohmann::json::array();
  for (auto& [price, q] : bids_) {
    for (auto& o : q) {
      nlohmann::json oj;
      oj["id"] = o->id;
      oj["userId"] = o->userId;
      oj["side"] = sideStr(o->side);
      oj["type"] = orderTypeStr(o->type);
      oj["price"] = o->price.toString();
      oj["quantity"] = o->quantity.toString();
      oj["filled"] = o->filled.toString();
      oj["tif"] = tifStr(o->tif);
      oj["reduceOnly"] = o->reduceOnly;
      oj["postOnly"] = o->postOnly;
      oj["clientOrderId"] = o->clientOrderId;
      oj["leverage"] = o->leverage.toString();
      oj["marginMode"] = o->marginMode;
      oj["timestamp"] = o->timestamp;
      state["bids"].push_back(oj);
    }
  }
  state["asks"] = nlohmann::json::array();
  for (auto& [price, q] : asks_) {
    for (auto& o : q) {
      nlohmann::json oj;
      oj["id"] = o->id;
      oj["userId"] = o->userId;
      oj["side"] = sideStr(o->side);
      oj["type"] = orderTypeStr(o->type);
      oj["price"] = o->price.toString();
      oj["quantity"] = o->quantity.toString();
      oj["filled"] = o->filled.toString();
      oj["tif"] = tifStr(o->tif);
      oj["reduceOnly"] = o->reduceOnly;
      oj["postOnly"] = o->postOnly;
      oj["clientOrderId"] = o->clientOrderId;
      oj["leverage"] = o->leverage.toString();
      oj["marginMode"] = o->marginMode;
      oj["timestamp"] = o->timestamp;
      state["asks"].push_back(oj);
    }
  }
  return state;
}

void OrderBook::restoreState(const nlohmann::json& state) {
  bids_.clear();
  asks_.clear();
  orderIndex_.clear();
  for (auto& oj : state.value("bids", nlohmann::json::array())) {
    Order o;
    o.id = oj.value("id", "");
    o.userId = oj.value("userId", "");
    o.market = market_;
    o.side = parseSide(oj.value("side", "buy"));
    o.type = parseOrderType(oj.value("type", "limit"));
    o.price = Decimal(oj.value("price", "0"));
    o.quantity = Decimal(oj.value("quantity", "0"));
    o.filled = Decimal(oj.value("filled", "0"));
    o.tif = parseTif(oj.value("tif", "GTC"));
    o.reduceOnly = oj.value("reduceOnly", false);
    o.postOnly = oj.value("postOnly", false);
    o.clientOrderId = oj.value("clientOrderId", "");
    o.leverage = Decimal(oj.value("leverage", "1"));
    o.marginMode = oj.value("marginMode", "isolated");
    o.timestamp = oj.value("timestamp", (int64_t)0);
    o.status = (o.filled >= o.quantity) ? OrderStatus::Filled : OrderStatus::Open;
    auto ptr = std::make_shared<Order>(o);
    bids_[o.price].push_back(ptr);
    orderIndex_[o.id] = {true, o.price.toString()};
  }
  for (auto& oj : state.value("asks", nlohmann::json::array())) {
    Order o;
    o.id = oj.value("id", "");
    o.userId = oj.value("userId", "");
    o.market = market_;
    o.side = parseSide(oj.value("side", "sell"));
    o.type = parseOrderType(oj.value("type", "limit"));
    o.price = Decimal(oj.value("price", "0"));
    o.quantity = Decimal(oj.value("quantity", "0"));
    o.filled = Decimal(oj.value("filled", "0"));
    o.tif = parseTif(oj.value("tif", "GTC"));
    o.reduceOnly = oj.value("reduceOnly", false);
    o.postOnly = oj.value("postOnly", false);
    o.clientOrderId = oj.value("clientOrderId", "");
    o.leverage = Decimal(oj.value("leverage", "1"));
    o.marginMode = oj.value("marginMode", "isolated");
    o.timestamp = oj.value("timestamp", (int64_t)0);
    o.status = (o.filled >= o.quantity) ? OrderStatus::Filled : OrderStatus::Open;
    auto ptr = std::make_shared<Order>(o);
    asks_[o.price].push_back(ptr);
    orderIndex_[o.id] = {false, o.price.toString()};
  }
}

size_t OrderBook::openOrderCount() const {
  size_t c = 0;
  for (auto& [_, q] : bids_) c += q.size();
  for (auto& [_, q] : asks_) c += q.size();
  return c;
}

}  // namespace exch
