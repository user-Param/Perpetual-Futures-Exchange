#include "redis_client.h"
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace exch {

RedisClient::RedisClient() = default;
RedisClient::~RedisClient() {
  if (ctx_) {
    redisFree(ctx_);
    ctx_ = nullptr;
  }
}

bool RedisClient::connect(const std::string& host, int port) {
  host_ = host;
  port_ = port;
  if (ctx_) {
    redisFree(ctx_);
    ctx_ = nullptr;
  }
  struct timeval timeout = {2, 0};
  ctx_ = redisConnectWithTimeout(host.c_str(), port, timeout);
  if (!ctx_ || ctx_->err) {
    std::cerr << "Redis connect error: " << (ctx_ ? ctx_->errstr : "unknown") << std::endl;
    if (ctx_) { redisFree(ctx_); ctx_ = nullptr; }
    return false;
  }
  return true;
}

bool RedisClient::isConnected() const { return ctx_ != nullptr && ctx_->err == 0; }

static std::string toStr(redisReply* r) {
  if (!r) return "";
  return std::string(r->str, r->len);
}

// Helper: execute command with reconnection retry using argv
static redisReply* executeWithRetry(RedisClient& client, int argc, const char** argv, const size_t* argvlen) {
  redisReply* r = (redisReply*)redisCommandArgv(client.context(), argc, argv, argvlen);

  if (!r && client.context()->err) {
    // Connection lost, try reconnect once
    if (client.connect(client.host(), client.port())) {
      r = (redisReply*)redisCommandArgv(client.context(), argc, argv, argvlen);
    }
  }
  return r;
}

std::vector<StreamEntry> RedisConsumer::readGroup(
    const std::string& stream,
    const std::string& group,
    const std::string& consumer,
    int count,
    int blockMs) {
  std::vector<StreamEntry> out;
  if (!client.isConnected()) return out;

  std::string countStr = std::to_string(count);
  std::string blockStr = std::to_string(blockMs);

  const char* argv[] = {
    "XREADGROUP", "GROUP", group.c_str(), consumer.c_str(),
    "COUNT", countStr.c_str(),
    "BLOCK", blockStr.c_str(),
    "STREAMS", stream.c_str(), ">"
  };
  const int argc = 11;
  std::vector<size_t> argvlen(argc);
  for (int i = 0; i < argc; ++i) argvlen[i] = strlen(argv[i]);

  redisReply* r = executeWithRetry(client, argc, argv, argvlen.data());

  if (!r) return out;
  if (r->type == REDIS_REPLY_NIL) {
    freeReplyObject(r);
    return out;
  }
  if (r->type != REDIS_REPLY_ARRAY) {
    freeReplyObject(r);
    return out;
  }
  for (size_t i = 0; i < r->elements; ++i) {
    redisReply* streamReply = r->element[i];
    if (streamReply->type != REDIS_REPLY_ARRAY || streamReply->elements < 2) continue;
    redisReply* entries = streamReply->element[1];
    if (entries->type != REDIS_REPLY_ARRAY) continue;
    for (size_t j = 0; j < entries->elements; ++j) {
      redisReply* entry = entries->element[j];
      if (entry->type != REDIS_REPLY_ARRAY || entry->elements < 2) continue;
      StreamEntry se;
      se.id = toStr(entry->element[0]);
      redisReply* kv = entry->element[1];
      if (kv->type == REDIS_REPLY_ARRAY) {
        for (size_t k = 0; k + 1 < kv->elements; k += 2) {
          se.fields.emplace_back(toStr(kv->element[k]), toStr(kv->element[k + 1]));
        }
      }
      out.push_back(std::move(se));
    }
  }
  freeReplyObject(r);
  return out;
}

bool RedisConsumer::ensureGroup(const std::string& stream, const std::string& group) {
  if (!client.isConnected()) return false;
  const char* argv[] = {"XGROUP", "CREATE", stream.c_str(), group.c_str(), "$", "MKSTREAM"};
  const int argc = 6;
  std::vector<size_t> argvlen(argc);
  for (int i = 0; i < argc; ++i) argvlen[i] = strlen(argv[i]);
  redisReply* r = executeWithRetry(client, argc, argv, argvlen.data());
  if (!r) return false;
  bool ok = (r->type == REDIS_REPLY_STATUS || r->type == REDIS_REPLY_INTEGER);
  if (r->type == REDIS_REPLY_ERROR && std::strstr(r->str, "BUSYGROUP") != nullptr) ok = true;
  freeReplyObject(r);
  return ok;
}

bool RedisConsumer::ack(const std::string& stream, const std::string& group, const std::string& id) {
  if (!client.isConnected()) return false;
  const char* argv[] = {"XACK", stream.c_str(), group.c_str(), id.c_str()};
  const int argc = 4;
  std::vector<size_t> argvlen(argc);
  for (int i = 0; i < argc; ++i) argvlen[i] = strlen(argv[i]);
  redisReply* r = executeWithRetry(client, argc, argv, argvlen.data());
  if (!r) return false;
  bool ok = (r->type == REDIS_REPLY_INTEGER);
  freeReplyObject(r);
  return ok;
}

bool RedisConsumer::publish(const std::string& channel, const std::string& message) {
  if (!client.isConnected()) return false;
  const char* argv[] = {"PUBLISH", channel.c_str(), message.c_str()};
  const int argc = 3;
  std::vector<size_t> argvlen(argc);
  for (int i = 0; i < argc; ++i) argvlen[i] = strlen(argv[i]);
  redisReply* r = executeWithRetry(client, argc, argv, argvlen.data());
  if (!r) return false;
  bool ok = (r->type == REDIS_REPLY_INTEGER);
  freeReplyObject(r);
  return ok;
}

}  // namespace exch