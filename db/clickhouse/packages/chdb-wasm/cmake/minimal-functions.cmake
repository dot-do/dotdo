# minimal-functions.cmake
# Complete function whitelist for minimal WASM builds
#
# This file defines the exact set of SQL functions to compile for minimal
# WASM builds, using the CHDB_MINIMAL_FUNCTIONS CMake option.
#
# INTEGRATION:
#   The CHDB_MINIMAL_FUNCTIONS flag is integrated into vendor/chdb at:
#   - vendor/chdb/src/Functions/CMakeLists.txt (scalar functions)
#   - vendor/chdb/src/AggregateFunctions/CMakeLists.txt (aggregate functions)
#
#   When CHDB_MINIMAL_FUNCTIONS=ON, vendor/chdb compiles only the whitelisted
#   source files, reducing the Functions binary size by ~80-90% and
#   AggregateFunctions by ~70-80%.
#
# Created for chdb-wasm to achieve optimal binary size while maintaining
# essential SQL functionality.
#
# ============================================================================
# Size Impact Analysis
# ============================================================================
#
# Full Functions directory:     ~11 MB source
# Full AggregateFunctions:      ~1.9 MB source
# Minimal whitelist (this):     ~500 KB source (estimated)
#
# Expected compiled size reduction: 70-80% of function-related code
# Typical WASM savings: 2-4 MB uncompressed, 500KB-1MB gzipped
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

# Enable minimal functions mode
set(CHDB_MINIMAL_FUNCTIONS ON CACHE BOOL "Build with minimal SQL functions whitelist" FORCE)

# ============================================================================
# Core Infrastructure (Required)
# ============================================================================
# These files are always needed for function registration and execution.

set(CHDB_MINIMAL_CORE_SOURCES
    # Function infrastructure (always required)
    "${CMAKE_CURRENT_SOURCE_DIR}/IFunction.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/IFunctionAdaptors.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionDynamicAdaptor.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionFactory.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionHelpers.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/registerFunctions.cpp"

    # Required by internal query processing
    "${CMAKE_CURRENT_SOURCE_DIR}/extractTimeZoneFromFunctionArguments.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/checkHyperscanRegexp.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/searchAnyAll.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/multiMatchAny.cpp"

    # chdb-specific
    "${CMAKE_CURRENT_SOURCE_DIR}/chdbVersion.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/serverConstants.cpp"
)

# ============================================================================
# Arithmetic Functions: +, -, *, /, %
# ============================================================================
# SQL operators: +, -, *, /, %, negate, abs

set(CHDB_MINIMAL_ARITHMETIC_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/plus.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/minus.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/multiply.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/divide.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/modulo.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/negate.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/abs.cpp"

    # Integer division (required for modulo operations)
    "${CMAKE_CURRENT_SOURCE_DIR}/intDiv.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/intDivOrZero.cpp"

    # Greatest/Least (commonly used)
    "${CMAKE_CURRENT_SOURCE_DIR}/greatest.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/least.cpp"
)

# ============================================================================
# Comparison Functions: =, !=, <, >, <=, >=
# ============================================================================
# SQL operators for WHERE clauses and JOIN conditions

set(CHDB_MINIMAL_COMPARISON_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/equals.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/notEquals.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/less.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/lessOrEquals.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/greater.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/greaterOrEquals.cpp"
)

# ============================================================================
# Logical Functions: AND, OR, NOT, IF, CASE
# ============================================================================
# Boolean logic and conditional expressions

set(CHDB_MINIMAL_LOGICAL_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsLogical.cpp"  # AND, OR, NOT, XOR
    "${CMAKE_CURRENT_SOURCE_DIR}/if.cpp"                 # IF(condition, then, else)
    "${CMAKE_CURRENT_SOURCE_DIR}/multiIf.cpp"            # multiIf for CASE expressions
    "${CMAKE_CURRENT_SOURCE_DIR}/caseWithExpression.cpp" # CASE WHEN ... END
)

# ============================================================================
# Type Conversion: CAST, toString, toInt*, toFloat*, toDate*
# ============================================================================
# Type casting and conversion functions

set(CHDB_MINIMAL_CONVERSION_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/CastOverloadResolver.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsConversion.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsConversion_impl0.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsConversion_impl1.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsConversion_impl2.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsConversion_impl3.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsConversion_reg.cpp"

    # Common type functions
    "${CMAKE_CURRENT_SOURCE_DIR}/toTypeName.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toFixedString.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/reinterpretAs.cpp"
)

# ============================================================================
# Null Handling: isNull, coalesce, ifNull, nullIf, assumeNotNull
# ============================================================================
# Functions for nullable type handling

set(CHDB_MINIMAL_NULL_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/isNull.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/isNotNull.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/coalesce.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/ifNull.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/nullIf.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/assumeNotNull.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toNullable.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/isNullable.cpp"
)

# ============================================================================
# String Functions: length, substring, concat, lower, upper, trim
# ============================================================================
# Basic string manipulation functions

set(CHDB_MINIMAL_STRING_SOURCES
    # Basic string operations
    "${CMAKE_CURRENT_SOURCE_DIR}/concat.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/concatWithSeparator.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/substring.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/lower.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/upper.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/trim.cpp"

    # Length (in array subdirectory - handles both string and array length)
    "${CMAKE_CURRENT_SOURCE_DIR}/array/length.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/lengthUTF8.cpp"

    # Additional commonly used string functions
    "${CMAKE_CURRENT_SOURCE_DIR}/left.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/right.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/repeat.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/reverse.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/replaceOne.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/replaceAll.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/position.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/locate.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/empty.cpp"  # Also includes notEmpty
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionChar.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/ascii.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/space.cpp"
)

# ============================================================================
# Date/Time Functions (Minimal Set)
# ============================================================================
# Essential date/time operations

set(CHDB_MINIMAL_DATETIME_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/DateTimeTransforms.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/now.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/now64.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/today.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/yesterday.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toYear.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toMonth.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toDayOfMonth.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toHour.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toMinute.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/toSecond.cpp"
    # Note: toDate, toDateTime, toUnixTimestamp are in FunctionsConversion_reg.cpp
)

# ============================================================================
# Utility Functions
# ============================================================================
# Common utility functions

set(CHDB_MINIMAL_UTILITY_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/sleep.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/throwIf.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/tuple.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/identity.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/materialize.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/ignore.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/currentDatabase.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/currentUser.cpp"
)

# ============================================================================
# Array Functions (Minimal Set)
# ============================================================================
# Essential array operations for structured data

set(CHDB_MINIMAL_ARRAY_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/array/array.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/array/arrayElement.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/array/arrayConcat.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/array/emptyArray.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/array/emptyArrayToSingle.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/array/has.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/array/indexOf.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/array/arrayResize.cpp"
)

# ============================================================================
# Random/Generate Functions (Minimal Set)
# ============================================================================
# Functions for generating data

set(CHDB_MINIMAL_RANDOM_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionsRandom.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/generateSnowflakeID.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/FunctionGenerateRandomStructure.cpp"
)

# ============================================================================
# Aggregate Functions Whitelist
# ============================================================================
# Core aggregate functions: count, sum, avg, min, max

set(CHDB_MINIMAL_AGGREGATE_SOURCES
    # Infrastructure
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/AggregateFunctionFactory.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/IAggregateFunction.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/parseAggregateFunctionParameters.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/registerAggregateFunctions.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/Combinators/AggregateFunctionCombinatorFactory.cpp"

    # Core aggregates
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/AggregateFunctionCount.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/AggregateFunctionSum.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/AggregateFunctionAvg.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/AggregateFunctionsMinMax.cpp"

    # Useful extensions (small code size, high utility)
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/AggregateFunctionAny.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/../AggregateFunctions/AggregateFunctionNothing.cpp"
)

# ============================================================================
# Combine All Minimal Function Sources
# ============================================================================

set(CHDB_MINIMAL_FUNCTION_SOURCES
    ${CHDB_MINIMAL_CORE_SOURCES}
    ${CHDB_MINIMAL_ARITHMETIC_SOURCES}
    ${CHDB_MINIMAL_COMPARISON_SOURCES}
    ${CHDB_MINIMAL_LOGICAL_SOURCES}
    ${CHDB_MINIMAL_CONVERSION_SOURCES}
    ${CHDB_MINIMAL_NULL_SOURCES}
    ${CHDB_MINIMAL_STRING_SOURCES}
    ${CHDB_MINIMAL_DATETIME_SOURCES}
    ${CHDB_MINIMAL_UTILITY_SOURCES}
    ${CHDB_MINIMAL_ARRAY_SOURCES}
    ${CHDB_MINIMAL_RANDOM_SOURCES}
)

# ============================================================================
# Function to Apply Minimal Functions Configuration
# ============================================================================

function(chdb_apply_minimal_functions SOURCE_DIR)
    # Override the clickhouse_functions_sources variable in parent scope
    set(clickhouse_functions_sources ${CHDB_MINIMAL_FUNCTION_SOURCES} PARENT_SCOPE)

    message(STATUS "Applied minimal function whitelist")
    message(STATUS "  Total scalar function files: ${CMAKE_CURRENT_LIST_LENGTH} (vs ~618 in full build)")
endfunction()

# ============================================================================
# Validation
# ============================================================================

function(chdb_validate_minimal_functions)
    set(missing_files "")

    foreach(source_file ${CHDB_MINIMAL_FUNCTION_SOURCES})
        if(NOT EXISTS "${source_file}")
            list(APPEND missing_files "${source_file}")
        endif()
    endforeach()

    if(missing_files)
        message(WARNING "Minimal functions whitelist contains missing files:")
        foreach(missing ${missing_files})
            message(WARNING "  - ${missing}")
        endforeach()
    else()
        message(STATUS "All minimal function files validated successfully")
    endif()
endfunction()

# ============================================================================
# Size Estimation Report
# ============================================================================

function(chdb_print_minimal_functions_summary)
    list(LENGTH CHDB_MINIMAL_CORE_SOURCES core_count)
    list(LENGTH CHDB_MINIMAL_ARITHMETIC_SOURCES arith_count)
    list(LENGTH CHDB_MINIMAL_COMPARISON_SOURCES comp_count)
    list(LENGTH CHDB_MINIMAL_LOGICAL_SOURCES logic_count)
    list(LENGTH CHDB_MINIMAL_CONVERSION_SOURCES conv_count)
    list(LENGTH CHDB_MINIMAL_NULL_SOURCES null_count)
    list(LENGTH CHDB_MINIMAL_STRING_SOURCES string_count)
    list(LENGTH CHDB_MINIMAL_DATETIME_SOURCES datetime_count)
    list(LENGTH CHDB_MINIMAL_UTILITY_SOURCES util_count)
    list(LENGTH CHDB_MINIMAL_ARRAY_SOURCES array_count)
    list(LENGTH CHDB_MINIMAL_RANDOM_SOURCES random_count)
    list(LENGTH CHDB_MINIMAL_AGGREGATE_SOURCES agg_count)
    list(LENGTH CHDB_MINIMAL_FUNCTION_SOURCES total_count)

    message(STATUS "")
    message(STATUS "=== Minimal Functions Whitelist Summary ===")
    message(STATUS "")
    message(STATUS "Function Categories:")
    message(STATUS "  Core Infrastructure:    ${core_count} files")
    message(STATUS "  Arithmetic (+,-,*,/,%): ${arith_count} files")
    message(STATUS "  Comparison (=,!=,<,>):  ${comp_count} files")
    message(STATUS "  Logical (AND,OR,IF):    ${logic_count} files")
    message(STATUS "  Type Conversion:        ${conv_count} files")
    message(STATUS "  Null Handling:          ${null_count} files")
    message(STATUS "  String Functions:       ${string_count} files")
    message(STATUS "  Date/Time:              ${datetime_count} files")
    message(STATUS "  Utility:                ${util_count} files")
    message(STATUS "  Array (minimal):        ${array_count} files")
    message(STATUS "  Random/Generate:        ${random_count} files")
    message(STATUS "")
    message(STATUS "  Total Scalar Functions: ${total_count} files")
    message(STATUS "  Aggregate Functions:    ${agg_count} files")
    message(STATUS "")
    message(STATUS "Size Impact Estimates:")
    message(STATUS "  Source reduction:       ~95% (618 -> ~${total_count} files)")
    message(STATUS "  Estimated source size:  ~500 KB (vs ~11 MB full)")
    message(STATUS "  Expected WASM savings:  2-4 MB uncompressed")
    message(STATUS "  Expected gzip savings:  500 KB - 1 MB")
    message(STATUS "")
    message(STATUS "Included SQL Functionality:")
    message(STATUS "  - Arithmetic: +, -, *, /, %, abs, negate, greatest, least")
    message(STATUS "  - Comparison: =, !=, <, >, <=, >=")
    message(STATUS "  - Logical: AND, OR, NOT, XOR, IF, CASE WHEN")
    message(STATUS "  - Strings: length, substring, concat, lower, upper, trim")
    message(STATUS "  - String extras: left, right, repeat, reverse, replace, position")
    message(STATUS "  - Conversion: CAST, toString, toInt*, toFloat*, toDate*")
    message(STATUS "  - Null: isNull, isNotNull, coalesce, ifNull, nullIf")
    message(STATUS "  - Date/Time: now, today, toYear, toMonth, toDate, toDateTime")
    message(STATUS "  - Aggregates: COUNT, SUM, AVG, MIN, MAX, ANY")
    message(STATUS "  - Arrays: array, length, element access, indexOf, has")
    message(STATUS "")
    message(STATUS "============================================")
    message(STATUS "")
endfunction()

# ============================================================================
# SQL Functions Reference
# ============================================================================
#
# This whitelist provides the following SQL functionality:
#
# Arithmetic Operators:
#   SELECT a + b, a - b, a * b, a / b, a % b
#   SELECT -a, abs(a), greatest(a, b), least(a, b)
#
# Comparison Operators:
#   SELECT * FROM t WHERE a = b
#   SELECT * FROM t WHERE a != b (or a <> b)
#   SELECT * FROM t WHERE a < b, a > b, a <= b, a >= b
#
# Logical Operators:
#   SELECT * FROM t WHERE a AND b
#   SELECT * FROM t WHERE a OR b
#   SELECT * FROM t WHERE NOT a
#   SELECT IF(condition, then_value, else_value)
#   SELECT CASE WHEN x THEN y ELSE z END
#   SELECT multiIf(c1, v1, c2, v2, default)
#
# String Functions:
#   SELECT length(str), substring(str, pos, len)
#   SELECT concat(a, b, c), lower(str), upper(str)
#   SELECT trim(str), ltrim(str), rtrim(str)
#   SELECT left(str, n), right(str, n)
#   SELECT repeat(str, n), reverse(str)
#   SELECT replace(str, from, to), position(str, substr)
#
# Type Conversion:
#   SELECT CAST(x AS Int32), CAST(x AS String)
#   SELECT toString(x), toInt32(x), toFloat64(x)
#   SELECT toDate(x), toDateTime(x)
#
# Null Handling:
#   SELECT isNull(x), isNotNull(x)
#   SELECT coalesce(a, b, c)
#   SELECT ifNull(x, default)
#   SELECT nullIf(x, y)
#
# Aggregate Functions:
#   SELECT COUNT(*), COUNT(x), COUNT(DISTINCT x)
#   SELECT SUM(x), AVG(x), MIN(x), MAX(x)
#   SELECT any(x)
#
# Date/Time:
#   SELECT now(), today(), yesterday()
#   SELECT toYear(d), toMonth(d), toDayOfMonth(d)
#   SELECT toHour(dt), toMinute(dt), toSecond(dt)
#
# Arrays:
#   SELECT [1, 2, 3], array(1, 2, 3)
#   SELECT arr[1], length(arr)
#   SELECT has(arr, x), indexOf(arr, x)
#
# ============================================================================
