#pragma once
#include "decimal.h"
#include <string>
#include <queue>
#include <map>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>
#include <nlohmann/json.hpp>

namespace exch {

enum class OrderType { Market, Limit };
enum class Side { Buy, Sell };
enum class TimeInForce { GTC, IOC, FOK };
enum class OrderStatus { Pending, Open, PartiallyFilled, Filled, Canceled, Rejected, Expired };

const char* orderTypeStr(OrderType t);
const char* sideStr(Side s);
const char* tifStr(TimeInForce t);
const char* statusStr(OrderStatus s);
OrderType parseOrderType(const std::string& s);
Side parseSide(const std::string& s);
TimeInForce parseTif(const std::string& s);

struct Order {
  std::string id;
  std::string userId;
  std::string market;
  Side side;
  OrderType type;
  Decimal price;        // valid if type == Limit
  Decimal quantity;
  Decimal filled;       // currently filled quantity
  TimeInForce tif;
  bool reduceOnly;
  bool postOnly;
  std::string clientOrderId;
  Decimal leverage;
  std::string marginMode;
  int64_t timestamp;
  OrderStatus status;
};

struct Trade {
  std::string market;
  std::string makerOrderId;
  std::string takerOrderId;
  std::string makerUserId;
  std::string takerUserId;
  Side takerSide;
  Decimal price;
  Decimal quantity;
  int64_t timestamp;
};

class OrderBook {
public:
  explicit OrderBook(std::string market);

  const std::string& market() const { return market_; }

  // Match an incoming order. Returns a vector of trades executed.
  // The order's `filled` and `status` are updated.
  std::vector<Trade> match(Order& order);

  // Cancel an order. Returns true if found and removed.
  bool cancel(const std::string& orderId);

  // Snapshot top N levels as JSON.
  nlohmann::json depthJson(int depth) const;

  // Serialize full book state (open orders) for snapshot.
  nlohmann::json serializeState() const;

  // Restore from snapshot state.
  void restoreState(const nlohmann::json& state);

  size_t openOrderCount() const;
  size_t bidLevels() const { return bids_.size(); }
  size_t askLevels() const { return asks_.size(); }

private:
  using OrderPtr = std::shared_ptr<Order>;
  using Queue = std::deque<OrderPtr>;

  // Return best bid (highest) iterator or end.
  std::map<Decimal, Queue, std::greater<Decimal>>::iterator bestBid();
  // Return best ask (lowest) iterator or end.
  std::map<Decimal, Queue>::iterator bestAsk();

  // Remove the front order from a queue; if the queue becomes empty, erase the price level.
  void popFrontOrder(std::map<Decimal, Queue, std::greater<Decimal>>& book,
                     std::map<Decimal, Queue, std::greater<Decimal>>::iterator& it);

  // Cancel a single resting order (no trade).
  bool cancelResting(const std::string& orderId);

  std::string market_;
  // price -> FIFO queue
  std::map<Decimal, Queue, std::greater<Decimal>> bids_;
  std::map<Decimal, Queue> asks_;
  std::unordered_map<std::string, std::pair<bool, std::string /*price key*/>> orderIndex_;
  // For faster cancel, track order -> (side bool true=bid, price string).
};

}  // namespace exch
