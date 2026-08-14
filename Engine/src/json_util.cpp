#include "json_util.h"

namespace exch {

nlohmann::json fieldsToJson(const std::vector<std::pair<std::string, std::string>>& fields) {
  nlohmann::json j = nlohmann::json::object();
  for (auto& [k, v] : fields) {
    // Try to coerce numeric fields where reasonable.
    if (k == "sequence" || k == "timestamp" || k == "leverage" || k == "filled") {
      // keep as string
      j[k] = v;
    } else if (k == "type" || k == "market" || k == "side" || k == "orderType" ||
               k == "timeInForce" || k == "clientOrderId" || k == "marginMode" ||
               k == "payload" || k == "orderId" || k == "userId" || k == "price" ||
               k == "quantity" || k == "reduceOnly" || k == "postOnly") {
      j[k] = v;
    } else {
      j[k] = v;
    }
  }
  return j;
}

}  // namespace exch
