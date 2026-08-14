#pragma once
#include <hiredis/hiredis.h>
#include <string>
#include <vector>
#include <utility>
#include <optional>

namespace exch {

struct StreamEntry {
  std::string id;
  std::vector<std::pair<std::string, std::string>> fields;
};

class RedisClient {
public:
  RedisClient();
  ~RedisClient();
  bool connect(const std::string& host, int port);
  bool isConnected() const;
  redisContext* context() { return ctx_; }
private:
  redisContext* ctx_ = nullptr;
  std::string host_;
  int port_ = 6379;
};

class RedisConsumer {
public:
  RedisClient client;
  // XREADGROUP loop helper. Reads up to `count` entries from `stream` for `group` and `consumer`.
  std::vector<StreamEntry> readGroup(
      const std::string& stream,
      const std::string& group,
      const std::string& consumer,
      int count,
      int blockMs);
  // Ensure consumer group exists.
  bool ensureGroup(const std::string& stream, const std::string& group);
  // Acknowledge a stream entry.
  bool ack(const std::string& stream, const std::string& group, const std::string& id);
  // Publish to a channel.
  bool publish(const std::string& channel, const std::string& message);
};

}  // namespace exch
