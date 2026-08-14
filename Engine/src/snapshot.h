#pragma once
#include "engine.h"
#include <string>
#include <atomic>

namespace exch {

class SnapshotService {
public:
  SnapshotService(Engine* engine, const std::string& filePath, int intervalSeconds);

  void start();
  void stop();

  // Save snapshot now.
  bool saveNow();

  // Load latest snapshot if present.
  bool loadLatest();

private:
  void run();

  Engine* engine_;
  std::string filePath_;
  int intervalSeconds_;
  std::atomic<bool> running_{false};
};

}  // namespace exch
