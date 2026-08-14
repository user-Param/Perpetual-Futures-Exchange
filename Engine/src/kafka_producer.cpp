#include "kafka_producer.h"
#include <iostream>
#include <cstring>

namespace exch {

KafkaProducer::KafkaProducer() = default;

KafkaProducer::~KafkaProducer() {
  if (producer_) {
    rd_kafka_flush(producer_, 1000);
    rd_kafka_destroy(producer_);
    producer_ = nullptr;
  }
}

bool KafkaProducer::init(const std::string& brokers) {
  char errstr[512];
  rd_kafka_conf_t* conf = rd_kafka_conf_new();
  if (rd_kafka_conf_set(conf, "bootstrap.servers", brokers.c_str(), errstr, sizeof(errstr)) != RD_KAFKA_CONF_OK) {
    std::cerr << "kafka conf set error: " << errstr << std::endl;
    rd_kafka_conf_destroy(conf);
    return false;
  }
  rd_kafka_conf_set(conf, "client.id", "exchange-engine", errstr, sizeof(errstr));
  producer_ = rd_kafka_new(RD_KAFKA_PRODUCER, conf, errstr, sizeof(errstr));
  if (!producer_) {
    std::cerr << "kafka producer create error: " << errstr << std::endl;
    return false;
  }
  return true;
}

bool KafkaProducer::produce(const std::string& topic, const std::string& key, const std::string& payload) {
  if (!producer_) return false;
  rd_kafka_resp_err_t err = rd_kafka_producev(
      producer_,
      RD_KAFKA_V_TOPIC(topic.c_str()),
      RD_KAFKA_V_KEY(key.data(), key.size()),
      RD_KAFKA_V_VALUE((void*)payload.data(), payload.size()),
      RD_KAFKA_V_MSGFLAGS(RD_KAFKA_MSG_F_COPY),
      RD_KAFKA_V_END);
  if (err != RD_KAFKA_RESP_ERR_NO_ERROR) {
    std::cerr << "kafka produce error: " << rd_kafka_err2str(err) << std::endl;
    return false;
  }
  rd_kafka_poll(producer_, 0);
  return true;
}

void KafkaProducer::flush(int timeoutMs) {
  if (producer_) rd_kafka_flush(producer_, timeoutMs);
}

}  // namespace exch
