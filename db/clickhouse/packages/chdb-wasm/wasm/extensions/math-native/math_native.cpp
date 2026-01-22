/**
 * math_native.cpp - Native Math Functions SIDE_MODULE
 *
 * This module provides ClickHouse-compatible math functions implemented using
 * standard library math functions (<cmath>). This is Option B from Spike 2 -
 * simple scalar wrappers that can be loaded as a SIDE_MODULE.
 *
 * While these are not the actual ClickHouse implementations (which work on
 * columnar data), they provide equivalent mathematical results for scalar values.
 *
 * Functions are prefixed with `ch_` to indicate ClickHouse compatibility.
 *
 * Build with:
 *   emcmake cmake -B build/ext-math-native wasm/extensions/math-native
 *   emmake make -C build/ext-math-native
 *
 * Or use the build script:
 *   ./wasm/extensions/math-native/build.sh
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <cmath>
#include <stddef.h>
#include <limits>

// ============================================================================
// Forward declarations for core module functions (imported from MAIN_MODULE)
// ============================================================================

extern "C" {
    void core_log(const char* message);
    void core_set_error(const char* error);
    int core_get_version();
}

// ============================================================================
// Extension State and Metadata
// ============================================================================

static int g_initialized = 0;
static int g_call_count = 0;

static const char* EXT_NAME = "ext-math-native";
static const int EXT_VERSION = 1;

extern "C" {

// ============================================================================
// Initialization and Metadata
// ============================================================================

EMSCRIPTEN_KEEPALIVE
int ext_math_native_init() {
    if (g_initialized) {
        return 0;
    }

    int core_version = core_get_version();
    if (core_version < 1) {
        core_set_error("ext-math-native requires core version >= 1");
        return -1;
    }

    g_initialized = 1;
    g_call_count = 0;
    core_log("ext-math-native: Initialized with 33+ native math functions");
    return 0;
}

EMSCRIPTEN_KEEPALIVE
const char* ext_math_native_get_name() {
    return EXT_NAME;
}

EMSCRIPTEN_KEEPALIVE
int ext_math_native_get_version() {
    return EXT_VERSION;
}

EMSCRIPTEN_KEEPALIVE
int ext_math_native_is_initialized() {
    return g_initialized;
}

EMSCRIPTEN_KEEPALIVE
int ext_math_native_get_call_count() {
    return g_call_count;
}

// ============================================================================
// Trigonometric Functions
// ============================================================================

/** sin(x) - Sine of x (x in radians) */
EMSCRIPTEN_KEEPALIVE
double ch_sin(double x) {
    g_call_count++;
    return std::sin(x);
}

/** cos(x) - Cosine of x (x in radians) */
EMSCRIPTEN_KEEPALIVE
double ch_cos(double x) {
    g_call_count++;
    return std::cos(x);
}

/** tan(x) - Tangent of x (x in radians) */
EMSCRIPTEN_KEEPALIVE
double ch_tan(double x) {
    g_call_count++;
    return std::tan(x);
}

// ============================================================================
// Inverse Trigonometric Functions
// ============================================================================

/** asin(x) - Arc sine of x, returns radians in [-pi/2, pi/2] */
EMSCRIPTEN_KEEPALIVE
double ch_asin(double x) {
    g_call_count++;
    if (x < -1.0 || x > 1.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::asin(x);
}

/** acos(x) - Arc cosine of x, returns radians in [0, pi] */
EMSCRIPTEN_KEEPALIVE
double ch_acos(double x) {
    g_call_count++;
    if (x < -1.0 || x > 1.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::acos(x);
}

/** atan(x) - Arc tangent of x, returns radians in [-pi/2, pi/2] */
EMSCRIPTEN_KEEPALIVE
double ch_atan(double x) {
    g_call_count++;
    return std::atan(x);
}

/** atan2(y, x) - Arc tangent of y/x, returns radians in [-pi, pi] */
EMSCRIPTEN_KEEPALIVE
double ch_atan2(double y, double x) {
    g_call_count++;
    return std::atan2(y, x);
}

// ============================================================================
// Hyperbolic Functions
// ============================================================================

/** sinh(x) - Hyperbolic sine */
EMSCRIPTEN_KEEPALIVE
double ch_sinh(double x) {
    g_call_count++;
    return std::sinh(x);
}

/** cosh(x) - Hyperbolic cosine */
EMSCRIPTEN_KEEPALIVE
double ch_cosh(double x) {
    g_call_count++;
    return std::cosh(x);
}

/** tanh(x) - Hyperbolic tangent */
EMSCRIPTEN_KEEPALIVE
double ch_tanh(double x) {
    g_call_count++;
    return std::tanh(x);
}

/** asinh(x) - Inverse hyperbolic sine */
EMSCRIPTEN_KEEPALIVE
double ch_asinh(double x) {
    g_call_count++;
    return std::asinh(x);
}

/** acosh(x) - Inverse hyperbolic cosine (x >= 1) */
EMSCRIPTEN_KEEPALIVE
double ch_acosh(double x) {
    g_call_count++;
    if (x < 1.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::acosh(x);
}

/** atanh(x) - Inverse hyperbolic tangent (-1 < x < 1) */
EMSCRIPTEN_KEEPALIVE
double ch_atanh(double x) {
    g_call_count++;
    if (x <= -1.0 || x >= 1.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::atanh(x);
}

// ============================================================================
// Exponential and Logarithmic Functions
// ============================================================================

/** exp(x) - e raised to the power x */
EMSCRIPTEN_KEEPALIVE
double ch_exp(double x) {
    g_call_count++;
    return std::exp(x);
}

/** exp2(x) - 2 raised to the power x */
EMSCRIPTEN_KEEPALIVE
double ch_exp2(double x) {
    g_call_count++;
    return std::exp2(x);
}

/** exp10(x) - 10 raised to the power x */
EMSCRIPTEN_KEEPALIVE
double ch_exp10(double x) {
    g_call_count++;
    return std::pow(10.0, x);
}

/** log(x) / ln(x) - Natural logarithm (base e) */
EMSCRIPTEN_KEEPALIVE
double ch_log(double x) {
    g_call_count++;
    if (x <= 0.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::log(x);
}

/** log2(x) - Logarithm base 2 */
EMSCRIPTEN_KEEPALIVE
double ch_log2(double x) {
    g_call_count++;
    if (x <= 0.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::log2(x);
}

/** log10(x) - Logarithm base 10 */
EMSCRIPTEN_KEEPALIVE
double ch_log10(double x) {
    g_call_count++;
    if (x <= 0.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::log10(x);
}

/** log1p(x) - Natural log of (1 + x), accurate for small x */
EMSCRIPTEN_KEEPALIVE
double ch_log1p(double x) {
    g_call_count++;
    if (x <= -1.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::log1p(x);
}

// ============================================================================
// Power and Root Functions
// ============================================================================

/** sqrt(x) - Square root */
EMSCRIPTEN_KEEPALIVE
double ch_sqrt(double x) {
    g_call_count++;
    if (x < 0.0) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return std::sqrt(x);
}

/** cbrt(x) - Cube root */
EMSCRIPTEN_KEEPALIVE
double ch_cbrt(double x) {
    g_call_count++;
    return std::cbrt(x);
}

/** pow(base, exp) - Base raised to the power of exp */
EMSCRIPTEN_KEEPALIVE
double ch_pow(double base, double exp) {
    g_call_count++;
    return std::pow(base, exp);
}

/** hypot(x, y) - Hypotenuse: sqrt(x^2 + y^2) */
EMSCRIPTEN_KEEPALIVE
double ch_hypot(double x, double y) {
    g_call_count++;
    return std::hypot(x, y);
}

// ============================================================================
// Error and Gamma Functions
// ============================================================================

/** erf(x) - Error function */
EMSCRIPTEN_KEEPALIVE
double ch_erf(double x) {
    g_call_count++;
    return std::erf(x);
}

/** erfc(x) - Complementary error function (1 - erf(x)) */
EMSCRIPTEN_KEEPALIVE
double ch_erfc(double x) {
    g_call_count++;
    return std::erfc(x);
}

/** lgamma(x) - Natural log of the absolute value of gamma(x) */
EMSCRIPTEN_KEEPALIVE
double ch_lgamma(double x) {
    g_call_count++;
    return std::lgamma(x);
}

/** tgamma(x) - Gamma function */
EMSCRIPTEN_KEEPALIVE
double ch_tgamma(double x) {
    g_call_count++;
    return std::tgamma(x);
}

// ============================================================================
// Special Functions
// ============================================================================

/** sigmoid(x) - Sigmoid function: 1 / (1 + exp(-x)) */
EMSCRIPTEN_KEEPALIVE
double ch_sigmoid(double x) {
    g_call_count++;
    return 1.0 / (1.0 + std::exp(-x));
}

/** degrees(x) - Convert radians to degrees */
EMSCRIPTEN_KEEPALIVE
double ch_degrees(double x) {
    g_call_count++;
    return x * (180.0 / M_PI);
}

/** radians(x) - Convert degrees to radians */
EMSCRIPTEN_KEEPALIVE
double ch_radians(double x) {
    g_call_count++;
    return x * (M_PI / 180.0);
}

// ============================================================================
// Comparison and Utility Functions
// ============================================================================

/** abs(x) - Absolute value */
EMSCRIPTEN_KEEPALIVE
double ch_abs(double x) {
    g_call_count++;
    return std::fabs(x);
}

/** min2(a, b) - Minimum of two values */
EMSCRIPTEN_KEEPALIVE
double ch_min2(double a, double b) {
    g_call_count++;
    return std::fmin(a, b);
}

/** max2(a, b) - Maximum of two values */
EMSCRIPTEN_KEEPALIVE
double ch_max2(double a, double b) {
    g_call_count++;
    return std::fmax(a, b);
}

// ============================================================================
// Mathematical Constants
// ============================================================================

/** e() - Euler's number */
EMSCRIPTEN_KEEPALIVE
double ch_e() {
    g_call_count++;
    return M_E;
}

/** pi() - Pi */
EMSCRIPTEN_KEEPALIVE
double ch_pi() {
    g_call_count++;
    return M_PI;
}

// ============================================================================
// Integer Versions (for when working with 64-bit integers)
// ============================================================================

/** abs for 64-bit integers */
EMSCRIPTEN_KEEPALIVE
long long ch_abs_int(long long x) {
    g_call_count++;
    return x < 0 ? -x : x;
}

} // extern "C"
