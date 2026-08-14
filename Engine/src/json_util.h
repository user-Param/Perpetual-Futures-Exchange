#pragma once
#include <string>
#include <nlohmann/json.hpp>

namespace exch {

// Parse a Redis stream entry's fields into a JSON object.
nlohmann::json fieldsToJson(const std::vector<std::pair<std::string, std::string>>& fields);

}  // namespace exch
