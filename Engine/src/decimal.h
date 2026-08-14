#pragma once
#include <string>
#include <cstdint>
#include <ostream>

namespace exch {

// String-based decimal to avoid floating point errors.
class Decimal {
public:
  Decimal();
  Decimal(int64_t v);
  Decimal(const std::string& s);
  Decimal(const char* s);

  static Decimal fromScaled(int64_t scaled, int scale);

  int scale() const { return scale_; }
  // Returns the integer representation: value = unscaled_ / 10^scale_ (with sign in unscaled_).
  int64_t unscaled() const { return unscaled_; }

  std::string toString() const;
  std::string toFixed(int decimals) const;

  bool isZero() const { return unscaled_ == 0; }
  bool isNegative() const { return unscaled_ < 0; }

  // Sign-correct comparison (treats different scales properly).
  static int compare(const Decimal& a, const Decimal& b);
  bool operator==(const Decimal& o) const { return compare(*this, o) == 0; }
  bool operator!=(const Decimal& o) const { return compare(*this, o) != 0; }
  bool operator<(const Decimal& o) const { return compare(*this, o) < 0; }
  bool operator<=(const Decimal& o) const { return compare(*this, o) <= 0; }
  bool operator>(const Decimal& o) const { return compare(*this, o) > 0; }
  bool operator>=(const Decimal& o) const { return compare(*this, o) >= 0; }

  Decimal operator+(const Decimal& o) const;
  Decimal operator-(const Decimal& o) const;
  Decimal operator*(const Decimal& o) const;
  Decimal operator/(const Decimal& o) const;

  Decimal& operator+=(const Decimal& o) { *this = *this + o; return *this; }
  Decimal& operator-=(const Decimal& o) { *this = *this - o; return *this; }
  Decimal& operator*=(const Decimal& o) { *this = *this * o; return *this; }
  Decimal& operator/=(const Decimal& o) { *this = *this / o; return *this; }

private:
  int64_t unscaled_;
  int scale_;
};

std::ostream& operator<<(std::ostream& os, const Decimal& d);

}  // namespace exch
