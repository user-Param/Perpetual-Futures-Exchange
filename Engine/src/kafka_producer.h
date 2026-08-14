#pragma once
#include <librdkafka/rdkafka.h>
#include <string>

namespace exch {

class KafkaProducer {
public:
  KafkaProducer();
  ~KafkaProducer();
  bool init(const std::string& brokers);
  bool produce(const std::string& topic, const std::string& key, const std::string& payload);
  void flush(int timeoutMs = 2000);
private:
  rd_kafka_t* producer_ = nullptr;
};

}  // namespace exch
