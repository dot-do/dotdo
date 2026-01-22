# Spike 2: Extract ClickHouse Math Functions as SIDE_MODULE

**Status:** Research Complete
**Date:** 2026-01-21
**Goal:** Compile ClickHouse's ACTUAL math functions (abs, sqrt, sin, cos, etc.) as a dynamically-loadable SIDE_MODULE.

## Executive Summary

This spike investigates extracting real ClickHouse math functions from `vendor/chdb` as a WebAssembly SIDE_MODULE. The key finding is that while the functions themselves are straightforward, they have deep dependencies on ClickHouse's type system, column infrastructure, and function registration mechanism. A viable approach exists but requires significant integration work.

## Math Functions Found

### Location
All math functions are in: `vendor/chdb/src/Functions/`

### Unary Math Functions (using FunctionMathUnary)

These functions take a single numeric argument and return Float64:

| Function | File | Implementation |
|----------|------|----------------|
| `sin` | sin.cpp | `std::sin` |
| `cos` | cos.cpp | `std::cos` |
| `tan` | tan.cpp | `std::tan` |
| `sqrt` | sqrt.cpp | `std::sqrt` |
| `cbrt` | cbrt.cpp | `std::cbrt` |
| `asin` | asin.cpp | `std::asin` |
| `acos` | acos.cpp | `std::acos` |
| `atan` | atan.cpp | `std::atan` |
| `sinh` | sinh.cpp | `std::sinh` |
| `cosh` | cosh.cpp | `std::cosh` |
| `tanh` | tanh.cpp | `std::tanh` |
| `asinh` | asinh.cpp | `std::asinh` |
| `acosh` | acosh.cpp | `std::acosh` |
| `atanh` | atanh.cpp | `std::atanh` |
| `exp` | exp.cpp | `std::exp` or FastOps |
| `exp2` | exp2.cpp | `std::exp2` |
| `exp10` | exp10.cpp | `std::pow(10, x)` |
| `log` / `ln` | log.cpp | `std::log` or FastOps |
| `log2` | log2.cpp | `std::log2` |
| `log10` | log10.cpp | `std::log10` |
| `log1p` | log1p.cpp | `std::log1p` |
| `erf` | erf.cpp | `std::erf` |
| `erfc` | erfc.cpp | `std::erfc` |
| `lgamma` | lgamma.cpp | `std::lgamma` |
| `tgamma` | tgamma.cpp | `std::tgamma` |
| `sigmoid` | sigmoid.cpp | `1 / (1 + exp(-x))` |
| `degrees` | degrees.cpp | `x * 180 / pi` |
| `radians` | radians.cpp | `x * pi / 180` |

### Binary Math Functions (using FunctionMathBinaryFloat64)

| Function | File | Implementation |
|----------|------|----------------|
| `pow` / `power` | pow.cpp | `std::pow(a, b)` |
| `atan2` | atan2.cpp | `std::atan2(a, b)` |
| `hypot` | hypot.cpp | `std::hypot(a, b)` |
| `min2` | min2.cpp | `std::min(a, b)` |
| `max2` | max2.cpp | `std::max(a, b)` |

### Arithmetic/Other Math Functions

| Function | File | Notes |
|----------|------|-------|
| `abs` | abs.cpp | Uses `FunctionUnaryArithmetic` - handles integers differently |
| `e()` | mathConstants.cpp | Returns Euler's constant |
| `pi()` | mathConstants.cpp | Returns pi |

**Total: 33 math functions found**

## Dependencies Identified

### Critical Dependencies

The ClickHouse math functions have a deep dependency chain:

```
sin.cpp
  |-- FunctionMathUnary.h
  |     |-- Core/callOnTypeIndex.h
  |     |-- Core/DecimalFunctions.h
  |     |-- DataTypes/DataTypesNumber.h
  |     |-- Columns/ColumnsNumber.h
  |     |-- Functions/IFunction.h
  |     |     |-- Core/ColumnNumbers.h
  |     |     |-- Core/ColumnsWithTypeAndName.h
  |     |     |-- ... (deep dependency tree)
  |     |-- Functions/FunctionHelpers.h
  |-- FunctionFactory.h
        |-- Interpreters/Context_fwd.h
        |-- Common/IFactoryWithAliases.h
        |-- Common/FunctionDocumentation.h
```

### Why This Is Hard

1. **Type System**: Math functions don't operate on raw `double` - they work on ClickHouse's `ColumnVector<Float64>`, `DataTypeFloat64`, etc.

2. **Column-Oriented Design**: Functions process entire columns at once (vectorized), not scalar values.

3. **Function Registration**: The `REGISTER_FUNCTION` macro and `FunctionFactory` require the full ClickHouse infrastructure.

4. **Context Dependency**: Functions are created via `FunctionPtr create(ContextPtr)` - they need a ClickHouse Context.

5. **FastOps Integration**: Some functions (`exp`, `log`) optionally use the FastOps library for SIMD optimization.

### Minimal Headers Required

To compile even the simplest math function, you need approximately:
- ~50+ header files from ClickHouse
- Core type definitions (Column, DataType, Field)
- Memory allocation infrastructure
- The full IFunction interface

## Build Approach Proposed

### Option A: Full Integration (Recommended Long-Term)

Compile the math functions **within** the main ClickHouse WASM build, then extract them as a loadable extension that shares the infrastructure.

```
chdb-core.wasm (MAIN_MODULE)
  |-- Full ClickHouse infrastructure
  |-- Function registration system
  |-- Type system, columns, etc.

chdb-math.wasm (SIDE_MODULE)
  |-- sin.cpp, cos.cpp, etc.
  |-- Links to core's IFunction, Column types, etc.
  |-- Registers via shared FunctionFactory
```

**Pros:**
- Uses REAL ClickHouse implementations
- Full type system support
- Performance optimizations (FastOps)

**Cons:**
- Requires core module to export many symbols
- Complex build configuration
- Large binary size

### Option B: Simplified Scalar Wrappers (Quick Win)

Create thin wrappers that expose ClickHouse math functions as simple C functions, bypassing the columnar interface.

```cpp
// math_scalar.cpp (SIDE_MODULE)
#include <cmath>

extern "C" {
    double chdb_sin(double x) { return std::sin(x); }
    double chdb_cos(double x) { return std::cos(x); }
    double chdb_sqrt(double x) { return std::sqrt(x); }
    // ... etc
}
```

**Pros:**
- Trivial to build
- No ClickHouse dependencies
- Very small binary (~2-5KB)

**Cons:**
- Not the REAL ClickHouse functions
- No columnar/vectorized processing
- Just wrappers around `<cmath>`

### Option C: Hybrid Approach (Balanced)

1. Build a minimal ClickHouse "function runtime" as MAIN_MODULE that includes:
   - Column types (ColumnVector, ColumnDecimal)
   - DataTypes (DataTypeFloat64, etc.)
   - IFunction interface
   - FunctionFactory (stripped down)

2. Build math functions as SIDE_MODULE that:
   - Imports the runtime types
   - Implements the actual math
   - Registers itself with the factory

**Pros:**
- Real ClickHouse interfaces
- Modular
- Reasonable size

**Cons:**
- Significant engineering effort
- May duplicate code from main chdb build

## Blockers

### 1. Symbol Export Challenge

The MAIN_MODULE would need to export potentially hundreds of symbols for ClickHouse's type system. This includes:
- Template instantiations for `ColumnVector<Float64>`, `ColumnVector<Int32>`, etc.
- Virtual function tables for IFunction, IDataType, etc.
- Factory singleton (`FunctionFactory::instance()`)

### 2. RTTI and Exceptions

ClickHouse uses RTTI and exceptions. Our current SIDE_MODULE builds use `-fno-exceptions -fno-rtti`. Math functions in ClickHouse may throw exceptions on invalid input.

### 3. Configuration System

Functions check `USE_FASTOPS`, `USE_EMBEDDED_COMPILER`, etc. at compile time. These need to be coordinated between MAIN and SIDE modules.

### 4. Thread Safety

ClickHouse's FunctionFactory is a singleton with thread-safe registration. In WASM (single-threaded), this is simpler but still requires coordination.

## Recommended Next Steps

### Immediate (This Sprint)

1. **Option B implementation**: Create `wasm/extensions/math-native/` with simple scalar wrappers
2. Verify SIDE_MODULE dynamic loading works with real math computations
3. Measure performance baseline

### Short-Term (Next Sprint)

1. Investigate ClickHouse's `CHDB_MINIMAL_FUNCTIONS` CMake option (already exists!)
2. Build a minimal ClickHouse core that exports function infrastructure
3. Prototype a single function (e.g., `sin`) as true SIDE_MODULE

### Long-Term

1. Define stable ABI boundary between core and math modules
2. Implement full math function SIDE_MODULE
3. Consider code generation for the wrapper layer

## Code Examples

### Example: sin.cpp from ClickHouse

```cpp
#include <Functions/FunctionMathUnary.h>
#include <Functions/FunctionFactory.h>

namespace DB
{
namespace
{

struct SinName { static constexpr auto name = "sin"; };
using FunctionSin = FunctionMathUnary<UnaryFunctionVectorized<SinName, sin>>;

}

REGISTER_FUNCTION(Sin)
{
    factory.registerFunction<FunctionSin>(
        FunctionDocumentation{
            .description = "Returns the sine of the argument.",
            // ...
        },
        FunctionFactory::Case::Insensitive);
}

}
```

### Example: Simplified Scalar Wrapper (Option B)

```cpp
// wasm/extensions/math-native/math_native.cpp
#include <cmath>
#include <emscripten.h>

extern "C" {

EMSCRIPTEN_KEEPALIVE
double ch_sin(double x) { return std::sin(x); }

EMSCRIPTEN_KEEPALIVE
double ch_cos(double x) { return std::cos(x); }

EMSCRIPTEN_KEEPALIVE
double ch_tan(double x) { return std::tan(x); }

EMSCRIPTEN_KEEPALIVE
double ch_sqrt(double x) { return x >= 0 ? std::sqrt(x) : NAN; }

EMSCRIPTEN_KEEPALIVE
double ch_exp(double x) { return std::exp(x); }

EMSCRIPTEN_KEEPALIVE
double ch_log(double x) { return x > 0 ? std::log(x) : NAN; }

EMSCRIPTEN_KEEPALIVE
double ch_pow(double base, double exp) { return std::pow(base, exp); }

EMSCRIPTEN_KEEPALIVE
double ch_abs(double x) { return std::fabs(x); }

// ... all 33+ functions

}
```

## Existing Infrastructure to Leverage

### wasm/extensions/math/math.cpp (Current)
Contains CUSTOM implementations (factorial, fibonacci, is_prime) that demonstrate the SIDE_MODULE pattern works. This spike confirms we should add NATIVE math alongside or replace with Option B.

### wasm/dynamic/README.md
Documents proven patterns for MAIN_MODULE/SIDE_MODULE interaction:
- Memory sharing
- Symbol import/export
- `dlopen`/`dlsym` usage

### CMakeLists.txt CHDB_MINIMAL_FUNCTIONS
The ClickHouse build already has a minimal mode! This could be a starting point for Option C.

## Conclusion

**Verdict: FEASIBLE but requires strategic approach**

The simplest path forward is Option B (scalar wrappers) for immediate value, while investigating Option C (hybrid) for production-grade integration. The existing SIDE_MODULE infrastructure is proven to work - the challenge is bridging the gap to ClickHouse's columnar function interface.

## References

- `vendor/chdb/src/Functions/FunctionMathUnary.h` - Unary math function template
- `vendor/chdb/src/Functions/FunctionMathBinaryFloat64.h` - Binary math function template
- `vendor/chdb/src/Functions/CMakeLists.txt` - Shows CHDB_MINIMAL_FUNCTIONS option
- `wasm/dynamic/README.md` - Emscripten dynamic linking documentation
- `wasm/extensions/math/` - Existing SIDE_MODULE example (custom math)
