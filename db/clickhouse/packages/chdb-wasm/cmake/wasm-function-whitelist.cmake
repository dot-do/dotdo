# wasm-function-whitelist.cmake
# Minimal SQL Function Whitelist for chdb-wasm (<15MB binary target)
#
# This file defines the EXACT set of SQL functions to include in minimal WASM builds.
# All other functions are excluded to achieve the smallest possible binary size.
#
# ============================================================================
# Size Impact
# ============================================================================
#
# Full ClickHouse Functions:  618 cpp files (~11 MB source)
# Full AggregateFunctions:    ~100 files (~1.9 MB source)
# This whitelist:             ~85 files (~600 KB source)
#
# Expected savings: ~80% reduction in function-related code
# Target: <15MB final WASM binary (gzipped ~3-4MB)
#
# ============================================================================
# EXCLUDED CATEGORIES (major size savings)
# ============================================================================
#
# - H3 Geo Functions:       38 files (~500 KB) - Disabled via ENABLE_H3=OFF
# - S2 Geo Functions:       10 files (~200 KB) - Disabled via ENABLE_S2_GEOMETRY=OFF
# - URL Functions:          40 files (~300 KB) - Not essential
# - JSON Functions:         Complex JSONPath library - Not essential
# - Encryption/AES:         Requires OpenSSL - Not essential
# - Machine Learning:       catboostEvaluate, evalMLMethod - Not essential
# - NLP Functions:          lemmatize, stem, synonyms - Not essential
# - Hyperscan/Regex:        Requires vectorscan library - Not essential
# - Hash Functions:         Most hashing functions - Not essential
# - Geo Functions:          pointInPolygon, etc. - Not essential
# - Bitmap Functions:       bitmapAnd, etc. - Not essential
#
# ============================================================================

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "=== WASM Function Whitelist Configuration ===")
message(STATUS "Target: <15MB WASM binary")
message(STATUS "")

# Enable minimal functions mode in ClickHouse build
set(CHDB_MINIMAL_FUNCTIONS ON CACHE BOOL "Build with minimal SQL functions" FORCE)

# ============================================================================
# WASM_MINIMAL_FUNCTIONS - The Complete Whitelist
# ============================================================================
# This is the definitive list of functions to include in WASM builds.
# Each category is documented with the SQL functionality it provides.

set(WASM_MINIMAL_FUNCTIONS "")

# ----------------------------------------------------------------------------
# CORE INFRASTRUCTURE (Required - cannot be disabled)
# ----------------------------------------------------------------------------
# These files provide the function registration and execution framework.

list(APPEND WASM_MINIMAL_FUNCTIONS
    # Function system core
    "IFunction.cpp"
    "IFunctionAdaptors.cpp"
    "FunctionDynamicAdaptor.cpp"
    "FunctionFactory.cpp"
    "FunctionHelpers.cpp"
    "registerFunctions.cpp"

    # Required by query processing pipeline
    "extractTimeZoneFromFunctionArguments.cpp"

    # chdb version info
    "chdbVersion.cpp"
    "serverConstants.cpp"
)

# ----------------------------------------------------------------------------
# ARITHMETIC: +, -, *, /, %
# ----------------------------------------------------------------------------
# SQL: SELECT a + b, a - b, a * b, a / b, a % b, -a, abs(a)

list(APPEND WASM_MINIMAL_FUNCTIONS
    "plus.cpp"
    "minus.cpp"
    "multiply.cpp"
    "intDiv.cpp"          # Integer division (a DIV b)
    "intDivOrZero.cpp"    # Safe integer division
    "modulo.cpp"          # a % b, a MOD b
    "negate.cpp"          # -a (unary minus)
    "abs.cpp"             # abs(a)
    "greatest.cpp"        # greatest(a, b, c, ...)
    "least.cpp"           # least(a, b, c, ...)
)

# Note: divide.cpp is in divide/ subdirectory, handled separately

# ----------------------------------------------------------------------------
# COMPARISON: =, !=, <, >, <=, >=
# ----------------------------------------------------------------------------
# SQL: WHERE a = b, a != b, a < b, a > b, a <= b, a >= b

list(APPEND WASM_MINIMAL_FUNCTIONS
    "equals.cpp"          # a = b
    "notEquals.cpp"       # a != b, a <> b
    "less.cpp"            # a < b
    "greater.cpp"         # a > b
    "lessOrEquals.cpp"    # a <= b
    "greaterOrEquals.cpp" # a >= b
)

# ----------------------------------------------------------------------------
# LOGICAL: AND, OR, NOT
# ----------------------------------------------------------------------------
# SQL: WHERE a AND b, a OR b, NOT a, a XOR b

list(APPEND WASM_MINIMAL_FUNCTIONS
    "FunctionsLogical.cpp"  # AND, OR, NOT, XOR
)

# ----------------------------------------------------------------------------
# CONDITIONALS: IF, multiIf, CASE
# ----------------------------------------------------------------------------
# SQL: IF(cond, then, else), CASE WHEN ... THEN ... END

list(APPEND WASM_MINIMAL_FUNCTIONS
    "if.cpp"                  # IF(condition, then_value, else_value)
    "multiIf.cpp"             # multiIf(c1, v1, c2, v2, ..., default)
    "caseWithExpression.cpp"  # CASE expr WHEN v1 THEN r1 ... END
)

# ----------------------------------------------------------------------------
# NULL HANDLING: isNull, isNotNull, coalesce, ifNull
# ----------------------------------------------------------------------------
# SQL: isNull(x), isNotNull(x), coalesce(a, b, c), ifNull(x, default)

list(APPEND WASM_MINIMAL_FUNCTIONS
    "isNull.cpp"          # isNull(x)
    "isNotNull.cpp"       # isNotNull(x)
    "coalesce.cpp"        # coalesce(a, b, c, ...)
    "ifNull.cpp"          # ifNull(x, default)
    "nullIf.cpp"          # nullIf(x, y) - returns NULL if x = y
    "assumeNotNull.cpp"   # assumeNotNull(x) - convert Nullable to non-Nullable
    "toNullable.cpp"      # toNullable(x) - convert to Nullable type
)

# ----------------------------------------------------------------------------
# STRING BASICS: length, substring, concat, lower, upper, trim
# ----------------------------------------------------------------------------
# SQL: length(s), substring(s, pos, len), concat(a, b), lower(s), upper(s)

list(APPEND WASM_MINIMAL_FUNCTIONS
    # Core string functions
    "concat.cpp"              # concat(a, b, c, ...)
    "substring.cpp"           # substring(s, pos, len), substr(), mid()
    "lower.cpp"               # lower(s), lcase(s)
    "upper.cpp"               # upper(s), ucase(s)
    "trim.cpp"                # trim(s), ltrim(s), rtrim(s)

    # Note: length() is in array/length.cpp (handles both strings and arrays)
    "lengthUTF8.cpp"          # lengthUTF8(s) - character length

    # Additional essential string functions
    "left.cpp"                # left(s, n)
    "right.cpp"               # right(s, n)
    "repeat.cpp"              # repeat(s, n)
    "reverse.cpp"             # reverse(s)
    "replaceOne.cpp"          # replaceOne(s, from, to)
    "replaceAll.cpp"          # replaceAll(s, from, to), replace()
    "position.cpp"            # position(haystack, needle), locate()
    "empty.cpp"               # empty(s), notEmpty(s)
    "concatWithSeparator.cpp" # concatWithSeparator(sep, a, b, ...)
)

# ----------------------------------------------------------------------------
# TYPE CONVERSION: toInt*, toFloat*, toString, toDate*
# ----------------------------------------------------------------------------
# SQL: CAST(x AS type), toString(x), toInt32(x), toDate(x)

list(APPEND WASM_MINIMAL_FUNCTIONS
    # Type conversion system
    "CastOverloadResolver.cpp"
    "FunctionsConversion.cpp"
    "FunctionsConversion_impl0.cpp"
    "FunctionsConversion_impl1.cpp"
    "FunctionsConversion_impl2.cpp"
    "FunctionsConversion_impl3.cpp"

    # Type introspection
    "toTypeName.cpp"          # toTypeName(x) - returns type as string
    "toFixedString.cpp"       # toFixedString(s, n)
)

# ----------------------------------------------------------------------------
# DATE/TIME BASICS
# ----------------------------------------------------------------------------
# SQL: now(), today(), toYear(d), toMonth(d), etc.

list(APPEND WASM_MINIMAL_FUNCTIONS
    "now.cpp"             # now()
    "now64.cpp"           # now64()
    "today.cpp"           # today()
    "yesterday.cpp"       # yesterday()
    "toYear.cpp"          # toYear(date)
    "toMonth.cpp"         # toMonth(date)
    "toDayOfMonth.cpp"    # toDayOfMonth(date)
    "toDayOfWeek.cpp"     # toDayOfWeek(date)
    "toHour.cpp"          # toHour(datetime)
    "toMinute.cpp"        # toMinute(datetime)
    "toSecond.cpp"        # toSecond(datetime)
)

# ----------------------------------------------------------------------------
# ARRAY BASICS: array, arrayJoin, length
# ----------------------------------------------------------------------------
# SQL: [1, 2, 3], array(1, 2, 3), arrayJoin(arr), length(arr)

# Array functions from array/ subdirectory
set(WASM_MINIMAL_ARRAY_FUNCTIONS
    "array/array.cpp"           # [1, 2, 3], array(1, 2, 3)
    "array/arrayJoin.cpp"       # arrayJoin(arr) - expand array to rows
    "array/length.cpp"          # length(arr), length(s) - works for arrays AND strings
    "array/arrayElement.cpp"    # arr[i], arrayElement(arr, i)
    "array/has.cpp"             # has(arr, elem), hasAll(), hasAny()
    "array/indexOf.cpp"         # indexOf(arr, elem)
    "array/emptyArray.cpp"      # emptyArray*() functions
    "array/range.cpp"           # range(n), range(start, end), range(start, end, step)
    "array/arrayConcat.cpp"     # arrayConcat(arr1, arr2, ...)
)

# ----------------------------------------------------------------------------
# UTILITY FUNCTIONS
# ----------------------------------------------------------------------------
# Common utility functions needed for basic operations

list(APPEND WASM_MINIMAL_FUNCTIONS
    "tuple.cpp"           # tuple(a, b, c), (a, b, c)
    "tupleElement.cpp"    # tupleElement(t, n)
    "identity.cpp"        # identity(x) - returns x unchanged
    "materialize.cpp"     # materialize(x) - force materialization
    "ignore.cpp"          # ignore(x) - used internally
    "currentDatabase.cpp" # currentDatabase()
    "throwIf.cpp"         # throwIf(cond, msg) - for assertions
    "sleep.cpp"           # sleep(seconds) - for testing
)

# ----------------------------------------------------------------------------
# RANDOM/GENERATE
# ----------------------------------------------------------------------------
# Basic random number generation

list(APPEND WASM_MINIMAL_FUNCTIONS
    "FunctionsRandom.cpp"      # rand(), rand32(), rand64(), randCanonical()
    "generateSnowflakeID.cpp"  # generateSnowflakeID()
)

# ============================================================================
# AGGREGATE FUNCTIONS WHITELIST
# ============================================================================
# Core aggregates: count, sum, avg, min, max, any, groupArray

set(WASM_MINIMAL_AGGREGATE_FUNCTIONS
    # Infrastructure (required)
    "AggregateFunctionFactory.cpp"
    "IAggregateFunction.cpp"
    "parseAggregateFunctionParameters.cpp"
    "registerAggregateFunctions.cpp"

    # Combinator infrastructure (for -If, -Array, etc.)
    "Combinators/AggregateFunctionCombinatorFactory.cpp"

    # Core aggregates
    "AggregateFunctionCount.cpp"       # count(), count(x), count(DISTINCT x)
    "AggregateFunctionSum.cpp"         # sum(x)
    "AggregateFunctionAvg.cpp"         # avg(x)
    "AggregateFunctionsMinMax.cpp"     # min(x), max(x)

    # Essential extensions
    "AggregateFunctionAny.cpp"         # any(x), anyLast(x)
    "AggregateFunctionGroupArray.cpp"  # groupArray(x), groupArray(n)(x)
    "AggregateFunctionNothing.cpp"     # nothing() - internal use
)

# ============================================================================
# EXPLICITLY EXCLUDED FUNCTIONS
# ============================================================================
# Document what is NOT included and why.

# H3 Geo Functions (~38 files) - EXCLUDED
# Reason: Requires external H3 library, adds ~500KB
# Files: h3*.cpp
# Disabled via: ENABLE_H3=OFF

# S2 Geo Functions (~10 files) - EXCLUDED
# Reason: Requires external S2 library, adds ~200KB
# Files: s2*.cpp
# Disabled via: ENABLE_S2_GEOMETRY=OFF

# URL Parsing Functions (~40 files) - EXCLUDED
# Reason: Rarely needed for analytics, adds ~300KB
# Files: URL/*.cpp (domain, protocol, path, query, etc.)

# JSON Functions - EXCLUDED
# Reason: Requires JSONPath library, complex parsing, adds ~200KB+
# Files: FunctionsJSON.cpp, FunctionSQLJSON.cpp, JSONPath/*, visitParam*.cpp

# Encryption Functions - EXCLUDED
# Reason: Requires OpenSSL, security implications in WASM
# Files: encrypt.cpp, decrypt.cpp, aes_*.cpp, FunctionsAES.cpp

# Machine Learning Functions - EXCLUDED
# Reason: Requires ML libraries, not suitable for WASM
# Files: catboostEvaluate.cpp, evalMLMethod.cpp

# NLP Functions - EXCLUDED
# Reason: Requires NLP libraries (CLD2, etc.)
# Files: lemmatize.cpp, stem.cpp, synonyms.cpp
# Disabled via: ENABLE_NLP=OFF

# Hash Functions (most) - EXCLUDED
# Reason: Many specialized hashes add size without essential utility
# Files: FunctionsHashing*.cpp (except basic ones)
# Keep: Implicit in type conversion

# Bitmap Functions - EXCLUDED
# Reason: Specialized bitmap operations
# Files: bitmap*.cpp

# Geo/GIS Functions - EXCLUDED
# Reason: Complex geometric operations
# Files: pointInPolygon.cpp, geo*.cpp, wkt.cpp, wkb.cpp, svg.cpp

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

# Function to get the full path for a function source file
function(wasm_get_function_path FUNC_FILE OUTPUT_VAR FUNC_DIR)
    set(${OUTPUT_VAR} "${FUNC_DIR}/${FUNC_FILE}" PARENT_SCOPE)
endfunction()

# Function to apply the whitelist to clickhouse_functions_sources
function(wasm_apply_function_whitelist FUNCTIONS_DIR)
    set(whitelist_sources "")

    # Add core functions
    foreach(func ${WASM_MINIMAL_FUNCTIONS})
        list(APPEND whitelist_sources "${FUNCTIONS_DIR}/${func}")
    endforeach()

    # Add array functions
    foreach(func ${WASM_MINIMAL_ARRAY_FUNCTIONS})
        list(APPEND whitelist_sources "${FUNCTIONS_DIR}/${func}")
    endforeach()

    # Export to parent scope
    set(clickhouse_functions_sources ${whitelist_sources} PARENT_SCOPE)

    list(LENGTH whitelist_sources total_count)
    message(STATUS "Applied WASM function whitelist: ${total_count} files (vs ~618 in full build)")
endfunction()

# Function to apply the aggregate whitelist
function(wasm_apply_aggregate_whitelist AGG_DIR)
    set(agg_sources "")

    foreach(func ${WASM_MINIMAL_AGGREGATE_FUNCTIONS})
        list(APPEND agg_sources "${AGG_DIR}/${func}")
    endforeach()

    set(clickhouse_aggregate_functions_sources ${agg_sources} PARENT_SCOPE)

    list(LENGTH agg_sources agg_count)
    message(STATUS "Applied WASM aggregate whitelist: ${agg_count} files (vs ~100 in full build)")
endfunction()

# ============================================================================
# VALIDATION
# ============================================================================

function(wasm_validate_function_whitelist FUNCTIONS_DIR)
    set(missing_files "")
    set(all_functions ${WASM_MINIMAL_FUNCTIONS} ${WASM_MINIMAL_ARRAY_FUNCTIONS})

    foreach(func ${all_functions})
        set(full_path "${FUNCTIONS_DIR}/${func}")
        if(NOT EXISTS "${full_path}")
            list(APPEND missing_files "${func}")
        endif()
    endforeach()

    if(missing_files)
        message(WARNING "WASM function whitelist contains missing files:")
        foreach(missing ${missing_files})
            message(WARNING "  - ${missing}")
        endforeach()
    else()
        message(STATUS "All WASM function whitelist files validated")
    endif()
endfunction()

function(wasm_validate_aggregate_whitelist AGG_DIR)
    set(missing_files "")

    foreach(func ${WASM_MINIMAL_AGGREGATE_FUNCTIONS})
        set(full_path "${AGG_DIR}/${func}")
        if(NOT EXISTS "${full_path}")
            list(APPEND missing_files "${func}")
        endif()
    endforeach()

    if(missing_files)
        message(WARNING "WASM aggregate whitelist contains missing files:")
        foreach(missing ${missing_files})
            message(WARNING "  - ${missing}")
        endforeach()
    else()
        message(STATUS "All WASM aggregate whitelist files validated")
    endif()
endfunction()

# ============================================================================
# SUMMARY REPORT
# ============================================================================

function(wasm_print_function_summary)
    list(LENGTH WASM_MINIMAL_FUNCTIONS scalar_count)
    list(LENGTH WASM_MINIMAL_ARRAY_FUNCTIONS array_count)
    list(LENGTH WASM_MINIMAL_AGGREGATE_FUNCTIONS agg_count)
    math(EXPR total_count "${scalar_count} + ${array_count}")

    message(STATUS "")
    message(STATUS "=== WASM Function Whitelist Summary ===")
    message(STATUS "")
    message(STATUS "Included Functions:")
    message(STATUS "  Scalar functions:    ${scalar_count} files")
    message(STATUS "  Array functions:     ${array_count} files")
    message(STATUS "  Aggregate functions: ${agg_count} files")
    message(STATUS "  TOTAL:               ~${total_count} files (vs ~618 full)")
    message(STATUS "")
    message(STATUS "SQL Functionality Provided:")
    message(STATUS "  Arithmetic:    +, -, *, /, %, abs, greatest, least")
    message(STATUS "  Comparison:    =, !=, <, >, <=, >=")
    message(STATUS "  Logical:       AND, OR, NOT, XOR")
    message(STATUS "  Conditionals:  IF, multiIf, CASE WHEN")
    message(STATUS "  Null:          isNull, isNotNull, coalesce, ifNull")
    message(STATUS "  Strings:       length, substring, concat, lower, upper, trim")
    message(STATUS "  Conversion:    CAST, toInt*, toFloat*, toString, toDate*")
    message(STATUS "  Date/Time:     now, today, toYear, toMonth, etc.")
    message(STATUS "  Arrays:        array, arrayJoin, length, has, indexOf")
    message(STATUS "  Aggregates:    COUNT, SUM, AVG, MIN, MAX, ANY, groupArray")
    message(STATUS "")
    message(STATUS "Excluded (major savings):")
    message(STATUS "  - H3 Geo:      38 files (~500 KB)")
    message(STATUS "  - S2 Geo:      10 files (~200 KB)")
    message(STATUS "  - URL:         40 files (~300 KB)")
    message(STATUS "  - JSON:        Complex JSONPath library")
    message(STATUS "  - Encryption:  OpenSSL dependency")
    message(STATUS "  - ML:          Heavy dependencies")
    message(STATUS "  - NLP:         Language libraries")
    message(STATUS "")
    message(STATUS "Target binary size: <15 MB WASM")
    message(STATUS "==========================================")
    message(STATUS "")
endfunction()

# ============================================================================
# AUTO-PRINT SUMMARY ON INCLUDE
# ============================================================================

if(WASM_FUNCTION_WHITELIST_VERBOSE)
    wasm_print_function_summary()
endif()

# ============================================================================
# SQL FUNCTIONALITY REFERENCE
# ============================================================================
#
# This whitelist provides the following SQL functionality:
#
# -- Arithmetic
# SELECT a + b, a - b, a * b, a / b, a % b
# SELECT -a, abs(a), greatest(a, b), least(a, b)
#
# -- Comparison
# SELECT * FROM t WHERE a = b AND c != d
# SELECT * FROM t WHERE x < 10 OR y >= 20
#
# -- Logical
# SELECT * FROM t WHERE a AND b OR NOT c
# SELECT IF(x > 0, 'positive', 'non-positive')
# SELECT CASE WHEN x = 1 THEN 'one' ELSE 'other' END
#
# -- Strings
# SELECT length(name), substring(name, 1, 5)
# SELECT concat(first, ' ', last), lower(email)
# SELECT trim(input), upper(code)
#
# -- Type conversion
# SELECT CAST(x AS Int32), toString(y)
# SELECT toInt32(str), toFloat64(num)
# SELECT toDate(timestamp), toDateTime(unix_ts)
#
# -- Null handling
# SELECT coalesce(nullable_col, 'default')
# SELECT * FROM t WHERE isNotNull(value)
# SELECT ifNull(maybe_null, 0)
#
# -- Arrays
# SELECT [1, 2, 3], array(4, 5, 6)
# SELECT arr[1], length(arr)
# SELECT has(arr, 5), indexOf(arr, 3)
# SELECT * FROM t ARRAY JOIN arr AS item
#
# -- Aggregates
# SELECT COUNT(*), SUM(value), AVG(price)
# SELECT MIN(created_at), MAX(updated_at)
# SELECT any(name), groupArray(value)
#
# -- Date/Time
# SELECT now(), today(), yesterday()
# SELECT toYear(date), toMonth(date), toDayOfMonth(date)
#
# ============================================================================
