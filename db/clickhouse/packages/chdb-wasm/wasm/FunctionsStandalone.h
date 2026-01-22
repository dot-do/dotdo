/**
 * FunctionsStandalone.h - Standalone Function Implementations for chdb-wasm
 *
 * This header provides standalone implementations of ClickHouse comparison and
 * arithmetic functions that can compile to WASM without the full ClickHouse
 * infrastructure.
 *
 * Based on the CHDB_MINIMAL_FUNCTIONS whitelist from:
 *   vendor/chdb/src/Functions/CMakeLists.txt (lines 6-42)
 *
 * Minimal function set includes:
 *   - Comparison: equals, notEquals, less, lessOrEquals, greater, greaterOrEquals
 *   - Logical: and, or, not, xor
 *   - Arithmetic: plus, minus, multiply, divide, modulo
 *   - Math: abs, floor, ceil, round, sqrt, pow, log, exp
 *   - String: length, upper, lower, concat, substring
 *
 * The goal is to use REAL ClickHouse comparison algorithms (accurate comparison)
 * without depending on the full infrastructure.
 *
 * Reference: vendor/chdb/src/Core/AccurateComparison.h
 */

#pragma once

#include <cstdint>
#include <cmath>
#include <limits>
#include <type_traits>
#include <cstring>
#include <string>

namespace chdb_wasm {

// =============================================================================
// Type Traits (minimal subset from extended_types.h)
// =============================================================================

template <typename T>
struct is_signed_ext {
    static constexpr bool value = std::is_signed_v<T>;
};

template <typename T>
inline constexpr bool is_signed_v = is_signed_ext<T>::value;

template <typename T>
struct is_unsigned_ext {
    static constexpr bool value = std::is_unsigned_v<T>;
};

template <typename T>
inline constexpr bool is_unsigned_v = is_unsigned_ext<T>::value;

// Concept for integer types
template <typename T>
concept is_integer = std::is_integral_v<T>;

// Concept for floating point types
template <typename T>
concept is_floating_point = std::is_floating_point_v<T>;

// =============================================================================
// DecomposedFloat (from base/DecomposedFloat.h)
// =============================================================================

template <typename T> struct FloatTraits;

template <>
struct FloatTraits<float> {
    using UInt = uint32_t;
    static constexpr size_t bits = 32;
    static constexpr size_t exponent_bits = 8;
    static constexpr size_t mantissa_bits = bits - exponent_bits - 1;
};

template <>
struct FloatTraits<double> {
    using UInt = uint64_t;
    static constexpr size_t bits = 64;
    static constexpr size_t exponent_bits = 11;
    static constexpr size_t mantissa_bits = bits - exponent_bits - 1;
};

template <typename T>
struct DecomposedFloat {
    using Traits = FloatTraits<T>;

    explicit DecomposedFloat(T x) {
        memcpy(&x_uint, &x, sizeof(x));
    }

    explicit DecomposedFloat(typename Traits::UInt x) : x_uint(x) {}

    typename Traits::UInt x_uint;

    bool isNegative() const {
        return x_uint >> (Traits::bits - 1);
    }

    int sign() const {
        if (exponent() == 0 && mantissa() == 0)
            return 0;
        return isNegative() ? -1 : 1;
    }

    uint16_t exponent() const {
        return (x_uint >> (Traits::mantissa_bits)) & ((1ull << Traits::exponent_bits) - 1);
    }

    int16_t normalizedExponent() const {
        return int16_t(exponent()) - ((1ull << (Traits::exponent_bits - 1)) - 1);
    }

    uint64_t mantissa() const {
        return x_uint & ((1ull << Traits::mantissa_bits) - 1);
    }

    bool isFinite() const {
        return exponent() != ((1ull << Traits::exponent_bits) - 1);
    }

    bool isNaN() const {
        return !isFinite() && (mantissa() != 0);
    }

    // Compare float with integer (from AccurateComparison.h logic)
    template <typename Int>
    int compare(Int rhs) const {
        if (rhs == 0)
            return sign();

        // Different signs
        if (isNegative() && rhs > 0)
            return -1;
        if (!isNegative() && rhs < 0)
            return 1;

        // Fractional number with magnitude less than one
        if (normalizedExponent() < 0) {
            if (!isNegative())
                return rhs > 0 ? -1 : 1;
            return rhs >= 0 ? -1 : 1;
        }

        // Handle most negative integer case
        if constexpr (std::is_signed_v<Int>) {
            if (rhs == std::numeric_limits<Int>::lowest()) {
                if (normalizedExponent() < static_cast<int16_t>(8 * sizeof(Int) - 1))
                    return 1;
                if (normalizedExponent() > static_cast<int16_t>(8 * sizeof(Int) - 1))
                    return -1;
                if (mantissa() == 0)
                    return 0;
                return -1;
            }
        }

        // Too large number
        if (normalizedExponent() >= static_cast<int16_t>(8 * sizeof(Int) - std::is_signed_v<Int>))
            return isNegative() ? -1 : 1;

        using UInt = std::conditional_t<(sizeof(Int) > sizeof(typename Traits::UInt)),
                                         std::make_unsigned_t<Int>, typename Traits::UInt>;
        UInt uint_rhs = rhs < 0 ? static_cast<UInt>(-rhs) : static_cast<UInt>(rhs);

        // Smaller octave
        if (uint_rhs < (static_cast<UInt>(1) << normalizedExponent()))
            return isNegative() ? -1 : 1;

        // Larger octave
        if (normalizedExponent() + 1 < static_cast<int16_t>(8 * sizeof(Int) - std::is_signed_v<Int>)
            && uint_rhs >= (static_cast<UInt>(1) << (normalizedExponent() + 1)))
            return isNegative() ? 1 : -1;

        // Same octave - compare mantissa
        bool large_and_always_integer = normalizedExponent() >= static_cast<int16_t>(Traits::mantissa_bits);

        UInt a = large_and_always_integer
            ? static_cast<UInt>(mantissa()) << (normalizedExponent() - Traits::mantissa_bits)
            : static_cast<UInt>(mantissa()) >> (Traits::mantissa_bits - normalizedExponent());

        UInt b = uint_rhs - (static_cast<UInt>(1) << normalizedExponent());

        if (a < b)
            return isNegative() ? 1 : -1;
        if (a > b)
            return isNegative() ? -1 : 1;

        // Check for fractional part
        if (large_and_always_integer)
            return 0;

        if ((mantissa() & ((1ULL << (Traits::mantissa_bits - normalizedExponent())) - 1)) != 0)
            return isNegative() ? 1 : -1;

        return 0;
    }

    template <typename Int>
    bool equals(Int rhs) const {
        return compare(rhs) == 0;
    }

    template <typename Int>
    bool less(Int rhs) const {
        return compare(rhs) < 0;
    }

    template <typename Int>
    bool greater(Int rhs) const {
        return compare(rhs) > 0;
    }
};

// =============================================================================
// NaN utilities (from Common/NaNUtils.h)
// =============================================================================

template <typename T>
inline bool isNaN(T x) {
    if constexpr (is_floating_point<T>)
        return DecomposedFloat<T>(x).isNaN();
    else
        return false;
}

template <typename T>
inline bool isFinite(T x) {
    if constexpr (is_floating_point<T>)
        return DecomposedFloat<T>(x).isFinite();
    else
        return true;
}

// =============================================================================
// Accurate Comparison Functions (from Core/AccurateComparison.h)
// =============================================================================

namespace accurate {

/**
 * Perceptually-correct number comparisons.
 * Example: Int8(-1) != UInt8(255)
 *
 * These functions handle:
 * - Mixed signed/unsigned integer comparisons
 * - Float-to-integer comparisons with proper precision
 * - NaN handling
 */

template <typename A, typename B>
bool lessOp(A a, B b) {
    if constexpr (std::is_same_v<A, B>)
        return a < b;

    // float vs float
    if constexpr (is_floating_point<A> && is_floating_point<B>)
        return a < b;

    // anything vs NaN
    if (isNaN(a) || isNaN(b))
        return false;

    // int vs int
    if constexpr (is_integer<A> && is_integer<B>) {
        // same signedness
        if constexpr (is_signed_v<A> == is_signed_v<B>)
            return a < b;

        // different signedness
        if constexpr (is_signed_v<A> && !is_signed_v<B>)
            return a < 0 || static_cast<std::make_unsigned_t<A>>(a) < b;

        if constexpr (!is_signed_v<A> && is_signed_v<B>)
            return b >= 0 && a < static_cast<std::make_unsigned_t<B>>(b);
    }

    // int vs float
    if constexpr (is_integer<A> && is_floating_point<B>) {
        if constexpr (sizeof(A) <= 4)
            return static_cast<double>(a) < static_cast<double>(b);

        return DecomposedFloat<B>(b).greater(a);
    }

    // float vs int
    if constexpr (is_floating_point<A> && is_integer<B>) {
        if constexpr (sizeof(B) <= 4)
            return static_cast<double>(a) < static_cast<double>(b);

        return DecomposedFloat<A>(a).less(b);
    }

    return false;  // Fallback for unsupported type combinations
}

template <typename A, typename B>
bool greaterOp(A a, B b) {
    return lessOp(b, a);
}

template <typename A, typename B>
bool greaterOrEqualsOp(A a, B b) {
    if (isNaN(a) || isNaN(b))
        return false;
    return !lessOp(a, b);
}

template <typename A, typename B>
bool lessOrEqualsOp(A a, B b) {
    if (isNaN(a) || isNaN(b))
        return false;
    return !lessOp(b, a);
}

template <typename A, typename B>
bool equalsOp(A a, B b) {
    if constexpr (std::is_same_v<A, B>)
        return a == b;

    // float vs float
    if constexpr (is_floating_point<A> && is_floating_point<B>)
        return a == b;

    // anything vs NaN
    if (isNaN(a) || isNaN(b))
        return false;

    // int vs int
    if constexpr (is_integer<A> && is_integer<B>) {
        // same signedness
        if constexpr (is_signed_v<A> == is_signed_v<B>)
            return a == b;

        // different signedness
        if constexpr (is_signed_v<A> && !is_signed_v<B>)
            return a >= 0 && static_cast<std::make_unsigned_t<A>>(a) == b;

        if constexpr (!is_signed_v<A> && is_signed_v<B>)
            return b >= 0 && a == static_cast<std::make_unsigned_t<B>>(b);
    }

    // int vs float
    if constexpr (is_integer<A> && is_floating_point<B>) {
        if constexpr (sizeof(A) <= 4)
            return static_cast<double>(a) == static_cast<double>(b);

        return DecomposedFloat<B>(b).equals(a);
    }

    // float vs int
    if constexpr (is_floating_point<A> && is_integer<B>) {
        if constexpr (sizeof(B) <= 4)
            return static_cast<double>(a) == static_cast<double>(b);

        return DecomposedFloat<A>(a).equals(b);
    }

    return false;
}

template <typename A, typename B>
bool notEqualsOp(A a, B b) {
    return !equalsOp(a, b);
}

} // namespace accurate

// =============================================================================
// Comparison Operator Structs (from Functions/FunctionsComparison.h style)
// =============================================================================

struct EqualsOp {
    static constexpr const char * name = "equals";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return accurate::equalsOp(a, b);
    }
};

struct NotEqualsOp {
    static constexpr const char * name = "notEquals";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return accurate::notEqualsOp(a, b);
    }
};

struct LessOp {
    static constexpr const char * name = "less";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return accurate::lessOp(a, b);
    }
};

struct LessOrEqualsOp {
    static constexpr const char * name = "lessOrEquals";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return accurate::lessOrEqualsOp(a, b);
    }
};

struct GreaterOp {
    static constexpr const char * name = "greater";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return accurate::greaterOp(a, b);
    }
};

struct GreaterOrEqualsOp {
    static constexpr const char * name = "greaterOrEquals";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return accurate::greaterOrEqualsOp(a, b);
    }
};

// =============================================================================
// Arithmetic Operators
// =============================================================================

struct PlusOp {
    static constexpr const char * name = "plus";

    template <typename A, typename B>
    static auto apply(A a, B b) {
        using ResultType = std::common_type_t<A, B>;
        return static_cast<ResultType>(a) + static_cast<ResultType>(b);
    }
};

struct MinusOp {
    static constexpr const char * name = "minus";

    template <typename A, typename B>
    static auto apply(A a, B b) {
        using ResultType = std::common_type_t<A, B>;
        return static_cast<ResultType>(a) - static_cast<ResultType>(b);
    }
};

struct MultiplyOp {
    static constexpr const char * name = "multiply";

    template <typename A, typename B>
    static auto apply(A a, B b) {
        using ResultType = std::common_type_t<A, B>;
        return static_cast<ResultType>(a) * static_cast<ResultType>(b);
    }
};

struct DivideOp {
    static constexpr const char * name = "divide";

    template <typename A, typename B>
    static auto apply(A a, B b) {
        if constexpr (is_floating_point<A> || is_floating_point<B>) {
            return static_cast<double>(a) / static_cast<double>(b);
        } else {
            if (b == 0) return decltype(a / b){};
            return a / b;
        }
    }
};

struct ModuloOp {
    static constexpr const char * name = "modulo";

    template <typename A, typename B>
    static auto apply(A a, B b) {
        if constexpr (is_floating_point<A> || is_floating_point<B>) {
            return std::fmod(static_cast<double>(a), static_cast<double>(b));
        } else {
            if (b == 0) return decltype(a % b){};
            return a % b;
        }
    }
};

// =============================================================================
// Logical Operators
// =============================================================================

struct AndOp {
    static constexpr const char * name = "and";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return static_cast<bool>(a) && static_cast<bool>(b);
    }
};

struct OrOp {
    static constexpr const char * name = "or";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return static_cast<bool>(a) || static_cast<bool>(b);
    }
};

struct XorOp {
    static constexpr const char * name = "xor";

    template <typename A, typename B>
    static bool apply(A a, B b) {
        return static_cast<bool>(a) != static_cast<bool>(b);
    }
};

struct NotOp {
    static constexpr const char * name = "not";

    template <typename A>
    static bool apply(A a) {
        return !static_cast<bool>(a);
    }
};

// =============================================================================
// Math Functions (standalone implementations)
// =============================================================================

namespace math {

inline double abs(double x) { return std::abs(x); }
inline int64_t abs(int64_t x) { return std::abs(x); }

inline double sqrt(double x) { return std::sqrt(x); }

inline double floor(double x) { return std::floor(x); }
inline double ceil(double x) { return std::ceil(x); }
inline double round(double x) { return std::round(x); }

inline double round(double x, int64_t precision) {
    double factor = std::pow(10.0, static_cast<double>(precision));
    return std::round(x * factor) / factor;
}

inline double pow(double base, double exp) { return std::pow(base, exp); }

inline double log(double x) { return std::log(x); }
inline double log(double base, double x) { return std::log(x) / std::log(base); }
inline double log2(double x) { return std::log2(x); }
inline double log10(double x) { return std::log10(x); }

inline double exp(double x) { return std::exp(x); }

inline double sin(double x) { return std::sin(x); }
inline double cos(double x) { return std::cos(x); }
inline double tan(double x) { return std::tan(x); }
inline double asin(double x) { return std::asin(x); }
inline double acos(double x) { return std::acos(x); }
inline double atan(double x) { return std::atan(x); }
inline double atan2(double y, double x) { return std::atan2(y, x); }

} // namespace math

// =============================================================================
// String Functions (standalone implementations)
// =============================================================================

namespace string {

inline size_t length(const std::string& s) { return s.length(); }

inline std::string upper(const std::string& s) {
    std::string result = s;
    for (char& c : result) c = std::toupper(static_cast<unsigned char>(c));
    return result;
}

inline std::string lower(const std::string& s) {
    std::string result = s;
    for (char& c : result) c = std::tolower(static_cast<unsigned char>(c));
    return result;
}

inline std::string concat(const std::string& a, const std::string& b) {
    return a + b;
}

inline std::string substring(const std::string& s, size_t offset, size_t length) {
    // ClickHouse uses 1-based indexing
    if (offset == 0) offset = 1;
    size_t startIdx = offset > 0 ? offset - 1 : 0;
    if (startIdx >= s.length()) return "";
    return s.substr(startIdx, length);
}

inline std::string reverse(const std::string& s) {
    std::string result = s;
    std::reverse(result.begin(), result.end());
    return result;
}

inline std::string trim(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\n\r\f\v");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\n\r\f\v");
    return s.substr(start, end - start + 1);
}

} // namespace string

} // namespace chdb_wasm

// =============================================================================
// C API for WASM exports
// =============================================================================

#ifdef __cplusplus
extern "C" {
#endif

// Version info
const char* chdb_functions_version();

// Comparison functions with accurate integer/float handling
int chdb_equals_int64(int64_t a, int64_t b);
int chdb_equals_double(double a, double b);
int chdb_equals_int_double(int64_t a, double b);
int chdb_equals_double_int(double a, int64_t b);

int chdb_less_int64(int64_t a, int64_t b);
int chdb_less_double(double a, double b);
int chdb_less_int_double(int64_t a, double b);
int chdb_less_double_int(double a, int64_t b);

int chdb_less_or_equals_int64(int64_t a, int64_t b);
int chdb_less_or_equals_double(double a, double b);

int chdb_greater_int64(int64_t a, int64_t b);
int chdb_greater_double(double a, double b);

int chdb_greater_or_equals_int64(int64_t a, int64_t b);
int chdb_greater_or_equals_double(double a, double b);

// Mixed signedness comparison (accurate)
int chdb_compare_int8_uint8(int8_t a, uint8_t b);  // Example: Int8(-1) != UInt8(255)

// Self-test
int chdb_functions_test();

#ifdef __cplusplus
}
#endif
