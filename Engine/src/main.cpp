#include "engine.h"
#include "redis_client.h"
#include "kafka_producer.h"
#include "snapshot.h"
#include "json_util.h"

#include <nlohmann/json.hpp>
#include <iostream>
#include <csignal>
#include <atomic>
#include <thread>
#include <cstdlib>
#include <chrono>
#include <string>

using nlohmann::json;
using namespace exch;

static std::atomic<bool> running{true};
static Engine* g_engine = nullptr;
static KafkaProducer* g_kafka = nullptr;
static RedisConsumer* g_redis = nullptr;

static void handleSignal(int) {
  running.store(false);
}

static std::string envOr(const char* key, const std::string& def) {
  const char* v = std::getenv(key);
  if (v && *v) return v;
  return def;
}

static int envIntOr(const char* key, int def) {
  const char* v = std::getenv(key);
  if (v && *v) return std::atoi(v);
  return def;
}

int main() {
  std::signal(SIGINT, handleSignal);
  std::signal(SIGTERM, handleSignal);

  std::string redisHost = envOr("REDIS_HOST", "127.0.0.1");
  int redisPort = envIntOr("REDIS_PORT", 6379);
  std::string stream = envOr("REDIS_STREAM_ORDER_COMMANDS", "order_commands");
  std::string group = envOr("REDIS_CONSUMER_GROUP", "engine-group");
  std::string consumer = envOr("REDIS_CONSUMER_NAME", "engine-1");
  std::string eventsChannel = envOr("REDIS_EVENTS_CHANNEL", "engine_events");
  std::string kafkaBrokers = envOr("KAFKA_BROKERS", "localhost:9092");
  std::string kafkaTopic = envOr("KAFKA_ENGINE_EVENTS_TOPIC", "engine_events");
  std::string snapshotPath = envOr("SNAPSHOT_PATH", "engine_state.json");
  int snapshotInterval = envIntOr("SNAPSHOT_INTERVAL_SECONDS", 900);

  RedisConsumer consumerClient;
  if (!consumerClient.client.connect(redisHost, redisPort)) {
    std::cerr << "Cannot connect to Redis at " << redisHost << ":" << redisPort << std::endl;
    return 1;
  }
  if (!consumerClient.ensureGroup(stream, group)) {
    std::cerr << "Cannot ensure consumer group " << group << std::endl;
    return 1;
  }
  g_redis = &consumerClient;

  KafkaProducer producer;
  if (!producer.init(kafkaBrokers)) {
    std::cerr << "Failed to init Kafka producer" << std::endl;
  }
  g_kafka = &producer;

  Engine engine;
  g_engine = &engine;

  engine.setEventCallback([&](const json& ev) {
    std::string s = ev.dump();
    // 1) Publish to Redis Pub/Sub
    consumerClient.publish(eventsChannel, s);
    // 2) Publish to Kafka
    if (ev.contains("market") && ev["market"].is_string()) {
      producer.produce(kafkaTopic, ev["market"].get<std::string>(), s);
    } else {
      producer.produce(kafkaTopic, "global", s);
    }
  });

  SnapshotService snapshots(&engine, snapshotPath, snapshotInterval);
  if (!snapshots.loadLatest()) {
    std::cerr << "[snapshot] no existing snapshot loaded" << std::endl;
  } else {
    std::cerr << "[snapshot] loaded " << snapshotPath << std::endl;
    engine.publishAllBookUpdates();
  }
  snapshots.start();

  std::cerr << "[engine] started; consuming " << stream
            << " group=" << group << " consumer=" << consumer
            << " events_channel=" << eventsChannel << std::endl;

  while (running.load()) {
    auto entries = consumerClient.readGroup(stream, group, consumer, 32, 1000);
    for (auto& e : entries) {
      auto j = fieldsToJson(e.fields);
      try {
        engine.processCommand(j);
      } catch (std::exception& ex) {
        std::cerr << "[engine] processCommand error: " << ex.what() << std::endl;
      }
      consumerClient.ack(stream, group, e.id);
    }
  }

  std::cerr << "[engine] shutting down..." << std::endl;
  snapshots.saveNow();
  producer.flush(2000);
  return 0;
}
