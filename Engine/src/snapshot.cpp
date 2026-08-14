#include "snapshot.h"
#include <fstream>
#include <iostream>
#include <thread>
#include <chrono>
#include <iomanip>
#include <sstream>

namespace exch {

SnapshotService::SnapshotService(Engine* engine, const std::string& filePath, int intervalSeconds)
  : engine_(engine), filePath_(filePath), intervalSeconds_(intervalSeconds) {}

void SnapshotService::start() {
  if (running_.exchange(true)) return;
  std::thread([this]() { run(); }).detach();
}

void SnapshotService::stop() {
  running_.store(false);
}

bool SnapshotService::saveNow() {
  if (!engine_) return false;
  auto state = engine_->snapshotState();
  std::ofstream out(filePath_, std::ios::trunc);
  if (!out.is_open()) {
    std::cerr << "snapshot open failed: " << filePath_ << std::endl;
    return false;
  }
  out << state.dump();
  out.close();
  return true;
}

bool SnapshotService::loadLatest() {
  std::ifstream in(filePath_);
  if (!in.is_open()) return false;
  std::stringstream ss;
  ss << in.rdbuf();
  std::string content = ss.str();
  if (content.empty()) return false;
  try {
    auto state = nlohmann::json::parse(content);
    engine_->restoreState(state);
    return true;
  } catch (std::exception& e) {
    std::cerr << "snapshot parse error: " << e.what() << std::endl;
    return false;
  }
}

void SnapshotService::run() {
  while (running_.load()) {
    std::this_thread::sleep_for(std::chrono::seconds(intervalSeconds_));
    if (!running_.load()) break;
    if (saveNow()) {
      std::cerr << "[snapshot] saved to " << filePath_ << std::endl;
    }
  }
}

}  // namespace exch
