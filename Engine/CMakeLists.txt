cmake_minimum_required(VERSION 3.16)
project(exchange_engine CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_compile_options(-Wall -Wextra -Wno-unused-parameter -O2 -pthread)

# hiredis (Redis client)
find_path(HIREDIS_INCLUDE_DIR hiredis/hiredis.h)
find_library(HIREDIS_LIB hiredis)
if(NOT HIREDIS_LIB OR NOT HIREDIS_INCLUDE_DIR)
  message(FATAL_ERROR "hiredis not found. Install via: brew install hiredis")
endif()

# nlohmann/json (header-only)
find_path(NLOHMANN_JSON_INCLUDE_DIR nlohmann/json.hpp)
if(NOT NLOHMANN_JSON_INCLUDE_DIR)
  message(FATAL_ERROR "nlohmann/json not found. Install via: brew install nlohmann-json")
endif()

# librdkafka (Kafka producer)
find_path(RDKAFKA_INCLUDE_DIR librdkafka/rdkafka.h)
find_library(RDKAFKA_LIB rdkafka)
if(NOT RDKAFKA_LIB OR NOT RDKAFKA_INCLUDE_DIR)
  message(FATAL_ERROR "librdkafka not found. Install via: brew install librdkafka")
endif()

add_executable(engine
  src/main.cpp
  src/orderbook.cpp
  src/engine.cpp
  src/redis_client.cpp
  src/kafka_producer.cpp
  src/snapshot.cpp
  src/json_util.cpp
  src/decimal.cpp
)

target_include_directories(engine PRIVATE
  ${HIREDIS_INCLUDE_DIR}
  ${NLOHMANN_JSON_INCLUDE_DIR}
  ${RDKAFKA_INCLUDE_DIR}
  src
)

target_link_libraries(engine PRIVATE
  ${HIREDIS_LIB}
  ${RDKAFKA_LIB}
  pthread
)
