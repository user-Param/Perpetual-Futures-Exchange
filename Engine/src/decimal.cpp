#include "decimal.h"
#include <cctype>
#include <sstream>
#include <iomanip>
#include <stdexcept>

namespace exch {

Decimal::Decimal() : unscaled_(0), scale_(0) {}
Decimal::Decimal(int64_t v) : unscaled_(v), scale_(0) {}

static int64_t ipow10(int n) {
  int64_t r = 1;
  for (int i = 0; i < n; ++i) r *= 10;
  return r;
}

Decimal::Decimal(const std::string& s) : unscaled_(0), scale_(0) {
  std::string str = s;
  bool neg = false;
  if (!str.empty() && str[0] == '-') { neg = true; str = str.substr(1); }
  else if (!str.empty() && str[0] == '+') { str = str.substr(1); }
  size_t dot = str.find('.');
  std::string intPart = (dot == std::string::npos) ? str : str.substr(0, dot);
  std::string decPart = (dot == std::string::npos) ? "" : str.substr(dot + 1);
  if (intPart.empty()) intPart = "0";
  // Trim trailing zeros in decPart.
  while (!decPart.empty() && decPart.back() == '0') decPart.pop_back();
  scale_ = static_cast<int>(decPart.size());
  std::string combined = intPart + decPart;
  unscaled_ = 0;
  for (char c : combined) {
    if (c < '0' || c > '9') continue;
    unscaled_ = unscaled_ * 10 + (c - '0');
  }
  if (neg) unscaled_ = -unscaled_;
}

Decimal::Decimal(const char* s) : Decimal(std::string(s)) {}

Decimal Decimal::fromScaled(int64_t scaled, int scale) {
  Decimal d;
  d.unscaled_ = scaled;
  d.scale_ = scale;
  return d;
}

int Decimal::compare(const Decimal& a, const Decimal& b) {
  if (a.scale_ == b.scale_) {
    if (a.unscaled_ < b.unscaled_) return -1;
    if (a.unscaled_ > b.unscaled_) return 1;
    return 0;
  }
  int64_t av = a.unscaled_;
  int64_t bv = b.unscaled_;
  if (a.scale_ > b.scale_) {
    bv *= ipow10(a.scale_ - b.scale_);
  } else {
    av *= ipow10(b.scale_ - a.scale_);
  }
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

Decimal Decimal::operator+(const Decimal& o) const {
  if (scale_ == o.scale_) {
    return fromScaled(unscaled_ + o.unscaled_, scale_);
  }
  if (scale_ > o.scale_) {
    return fromScaled(unscaled_ + o.unscaled_ * ipow10(scale_ - o.scale_), scale_);
  }
  return fromScaled(unscaled_ * ipow10(o.scale_ - scale_) + o.unscaled_, o.scale_);
}

Decimal Decimal::operator-(const Decimal& o) const {
  if (scale_ == o.scale_) {
    return fromScaled(unscaled_ - o.unscaled_, scale_);
  }
  if (scale_ > o.scale_) {
    return fromScaled(unscaled_ - o.unscaled_ * ipow10(scale_ - o.scale_), scale_);
  }
  return fromScaled(unscaled_ * ipow10(o.scale_ - scale_) - o.unscaled_, o.scale_);
}

Decimal Decimal::operator*(const Decimal& o) const {
  return fromScaled(unscaled_ * o.unscaled_, scale_ + o.scale_);
}

Decimal Decimal::operator/(const Decimal& o) const {
  if (o.unscaled_ == 0) throw std::runtime_error("Decimal divide by zero");
  // Increase precision of dividend to keep some fractional digits.
  int targetScale = scale_ + o.scale_ + 8;
  int64_t numerator = unscaled_ * ipow10(targetScale - scale_);
  int64_t result = numerator / o.unscaled_;
  return fromScaled(result, targetScale - o.scale_ - 8);
}

std::string Decimal::toString() const {
  std::ostringstream os;
  if (scale_ == 0) {
    os << unscaled_;
    return os.str();
  }
  bool neg = unscaled_ < 0;
  int64_t absval = neg ? -unscaled_ : unscaled_;
  std::string s = std::to_string(absval);
  // Pad left if needed.
  if (static_cast<int>(s.size()) <= scale_) {
    s = std::string(scale_ - s.size() + 1, '0') + s;
  }
  std::string intPart = s.substr(0, s.size() - scale_);
  std::string decPart = s.substr(s.size() - scale_);
  // Trim trailing zeros in decPart.
  while (!decPart.empty() && decPart.back() == '0') decPart.pop_back();
  os << (neg ? "-" : "") << intPart;
  if (!decPart.empty()) os << "." << decPart;
  return os.str();
}

std::string Decimal::toFixed(int decimals) const {
  std::string s = toString();
  bool neg = !s.empty() && s[0] == '-';
  std::string body = neg ? s.substr(1) : s;
  size_t dot = body.find('.');
  std::string intPart = (dot == std::string::npos) ? body : body.substr(0, dot);
  std::string decPart = (dot == std::string::npos) ? "" : body.substr(dot + 1);
  if (static_cast<int>(decPart.size()) < decimals) {
    decPart.append(decimals - decPart.size(), '0');
  } else if (static_cast<int>(decPart.size()) > decimals) {
    decPart = decPart.substr(0, decimals);
  }
  std::string out = intPart + (decimals > 0 ? "." + decPart : "");
  return neg ? "-" + out : out;
}

std::ostream& operator<<(std::ostream& os, const Decimal& d) {
  return os << d.toString();
}

}  // namespace exch
