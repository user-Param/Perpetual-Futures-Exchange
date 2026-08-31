#pragma once
#include "orderbook.h"
#include "redis_client.h"
#include <mutex>
#include <map>
#include <memory>
#include <string>
#include <functional>
#include <nlohmann/json.hpp>

namespace exch {

class Engine {
public:
  using EventCallback = std::function<void(const nlohmann::json&)>;

  Engine();

  void setEventCallback(EventCallback cb) { cb_ = std::move(cb); }

  // Process a single command. The command JSON should include "type":
  //   PLACE_ORDER or CANCEL_ORDER. See CLAUDE.md for the shape.
  void processCommand(const nlohmann::json& cmd);

  // Cancel a resting order in a given market.
  void cancelOrder(const std::string& market, const std::string& orderId, const std::string& userId);

  // Return the order book for a market. Lazily created.
  std::shared_ptr<OrderBook> getBook(const std::string& market);

  // Snapshot all order books into a single JSON object.
  nlohmann::json snapshotState() const;

  // Restore from snapshot.
  void restoreState(const nlohmann::json& state);

  // Re-publish ORDER_BOOK_UPDATED for every market (e.g. after snapshot restore).
  void publishAllBookUpdates();

  // List known markets.
  std::vector<std::string> markets() const;

  // Provide Redis consumer for external liquidity (mark price fallback). If null, no external liquidity.
  void setRedisForExternal(RedisConsumer* rc) { redisForExternal_ = rc; }

private:
  mutable std::mutex mu_;
  std::map<std::string, std::shared_ptr<OrderBook>> books_;
  EventCallback cb_;
  RedisConsumer* redisForExternal_ = nullptr;

  void publish(const nlohmann::json& ev);
  void placeOrder(const nlohmann::json& orderJson);
  std::optional<Decimal> fetchMarkPrice(const std::string& market);
};

}  // namespace exch
