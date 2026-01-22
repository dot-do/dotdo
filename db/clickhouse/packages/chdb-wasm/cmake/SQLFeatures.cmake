# SQLFeatures.cmake
# SQL Feature Selection for WASM builds
#
# This module provides granular control over which SQL features
# are compiled into the WASM binary, enabling size optimization
# by excluding unused functionality.

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Core SQL Features (always enabled by default)
# ============================================================================

option(CHDB_SQL_SELECT "Enable SELECT statements" ON)
option(CHDB_SQL_FROM "Enable FROM clause" ON)
option(CHDB_SQL_WHERE "Enable WHERE clause" ON)
option(CHDB_SQL_GROUP_BY "Enable GROUP BY" ON)
option(CHDB_SQL_ORDER_BY "Enable ORDER BY" ON)
option(CHDB_SQL_LIMIT "Enable LIMIT" ON)
option(CHDB_SQL_HAVING "Enable HAVING clause" ON)
option(CHDB_SQL_DISTINCT "Enable DISTINCT" ON)

# ============================================================================
# Optional SQL Features
# ============================================================================

option(CHDB_SQL_WINDOW "Enable window functions (OVER, PARTITION BY, ROW_NUMBER, etc.)" OFF)
option(CHDB_SQL_CTE "Enable WITH clause (Common Table Expressions)" OFF)
option(CHDB_SQL_SUBQUERIES "Enable subqueries in SELECT, FROM, WHERE" ON)
option(CHDB_SQL_UNION "Enable UNION/INTERSECT/EXCEPT set operations" OFF)
option(CHDB_SQL_JOIN "Enable JOIN operations" ON)
option(CHDB_SQL_JOIN_ADVANCED "Enable FULL OUTER, CROSS, ASOF joins" OFF)
option(CHDB_SQL_ARRAY_JOIN "Enable ARRAY JOIN" OFF)
option(CHDB_SQL_LATERAL "Enable LATERAL subqueries" OFF)
option(CHDB_SQL_PREWHERE "Enable PREWHERE clause (ClickHouse-specific)" OFF)
option(CHDB_SQL_SAMPLE "Enable SAMPLE clause" OFF)
option(CHDB_SQL_FINAL "Enable FINAL modifier" OFF)
option(CHDB_SQL_SETTINGS "Enable SETTINGS clause" ON)

# ============================================================================
# Aggregate Functions
# ============================================================================

option(CHDB_AGG_BASIC "Enable COUNT/SUM/AVG/MIN/MAX" ON)
option(CHDB_AGG_CONDITIONAL "Enable countIf/sumIf/avgIf etc." OFF)
option(CHDB_AGG_ADVANCED "Enable advanced aggregates (groupArray, groupUniqArray, etc.)" OFF)
option(CHDB_AGG_STATISTICAL "Enable STDDEV/VAR/CORR/COVAR etc." OFF)
option(CHDB_AGG_QUANTILE "Enable quantile/median functions" OFF)
option(CHDB_AGG_APPROXIMATE "Enable approximate aggregates (uniq, uniqHLL12, etc.)" OFF)
option(CHDB_AGG_HISTOGRAM "Enable histogram aggregates" OFF)
option(CHDB_AGG_COMBINATORS "Enable aggregate combinators (-If, -Array, -Map, etc.)" OFF)

# ============================================================================
# Table Functions
# ============================================================================

option(CHDB_TABLE_URL "Enable url() table function for HTTP data sources" ON)
option(CHDB_TABLE_FILE "Enable file() table function" ON)
option(CHDB_TABLE_NUMBERS "Enable numbers()/generateRandom() functions" ON)
option(CHDB_TABLE_S3 "Enable s3() table function for AWS S3" OFF)
option(CHDB_TABLE_REMOTE "Enable remote() table function" OFF)
option(CHDB_TABLE_MERGE "Enable merge() table function" OFF)
option(CHDB_TABLE_INPUT "Enable input() table function" ON)
option(CHDB_TABLE_VALUES "Enable VALUES table function" ON)
option(CHDB_TABLE_VIEW "Enable view() table function" OFF)
option(CHDB_TABLE_DICTIONARY "Enable dictionary() table function" OFF)
option(CHDB_TABLE_CLUSTER "Enable cluster() table function" OFF)
option(CHDB_TABLE_GENERATE "Enable generate table functions (zeros, one, etc.)" ON)

# ============================================================================
# Scalar Functions
# ============================================================================

option(CHDB_FUNC_STRING_BASIC "Enable basic string functions (concat, substring, etc.)" ON)
option(CHDB_FUNC_STRING_ADVANCED "Enable advanced string functions (regex, etc.)" OFF)
option(CHDB_FUNC_STRING_ENCODING "Enable encoding functions (base64, hex, etc.)" OFF)
option(CHDB_FUNC_DATETIME_BASIC "Enable basic date/time functions" ON)
option(CHDB_FUNC_DATETIME_ADVANCED "Enable advanced date/time functions" OFF)
option(CHDB_FUNC_MATH "Enable math functions" ON)
option(CHDB_FUNC_ARRAY "Enable array functions" OFF)
option(CHDB_FUNC_MAP "Enable map functions" OFF)
option(CHDB_FUNC_TUPLE "Enable tuple functions" OFF)
option(CHDB_FUNC_JSON "Enable JSON functions" ON)
option(CHDB_FUNC_HASH "Enable hash functions (cityHash, xxHash, etc.)" OFF)
option(CHDB_FUNC_CONDITIONAL "Enable conditional functions (if, multiIf, etc.)" ON)
option(CHDB_FUNC_TYPE_CONVERSION "Enable type conversion functions" ON)
option(CHDB_FUNC_NULLABLE "Enable nullable handling functions" ON)
option(CHDB_FUNC_UUID "Enable UUID functions" OFF)
option(CHDB_FUNC_IP "Enable IP address functions" OFF)
option(CHDB_FUNC_GEO "Enable geo functions" OFF)
option(CHDB_FUNC_INTROSPECTION "Enable introspection functions" OFF)
option(CHDB_FUNC_EXTERNAL_DICTS "Enable external dictionary functions" OFF)
option(CHDB_FUNC_MACHINE_LEARNING "Enable ML functions" OFF)

# ============================================================================
# Data Types
# ============================================================================

option(CHDB_TYPE_BASIC "Enable Int/UInt/Float/String/Date/DateTime" ON)
option(CHDB_TYPE_DECIMAL "Enable Decimal types" OFF)
option(CHDB_TYPE_UUID "Enable UUID type" OFF)
option(CHDB_TYPE_ARRAY "Enable Array type" ON)
option(CHDB_TYPE_TUPLE "Enable Tuple type" OFF)
option(CHDB_TYPE_MAP "Enable Map type" OFF)
option(CHDB_TYPE_NESTED "Enable Nested type" OFF)
option(CHDB_TYPE_NULLABLE "Enable Nullable wrapper" ON)
option(CHDB_TYPE_LOWCARDINALITY "Enable LowCardinality optimization" OFF)
option(CHDB_TYPE_ENUM "Enable Enum types" OFF)
option(CHDB_TYPE_IPV4_IPV6 "Enable IPv4/IPv6 types" OFF)
option(CHDB_TYPE_FIXEDSTRING "Enable FixedString type" OFF)
option(CHDB_TYPE_GEO "Enable Point/Ring/Polygon types" OFF)
option(CHDB_TYPE_JSON "Enable JSON/Object type" OFF)
option(CHDB_TYPE_VARIANT "Enable Variant type" OFF)
option(CHDB_TYPE_DYNAMIC "Enable Dynamic type" OFF)

# ============================================================================
# Validation
# ============================================================================

# Ensure core features are enabled when dependent features are used
function(chdb_validate_sql_features)
    # Window functions require GROUP BY support
    if(CHDB_SQL_WINDOW AND NOT CHDB_SQL_GROUP_BY)
        message(FATAL_ERROR "CHDB_SQL_WINDOW requires CHDB_SQL_GROUP_BY to be enabled")
    endif()

    # Advanced aggregates require basic aggregates
    if(CHDB_AGG_ADVANCED AND NOT CHDB_AGG_BASIC)
        message(FATAL_ERROR "CHDB_AGG_ADVANCED requires CHDB_AGG_BASIC to be enabled")
    endif()

    # Statistical aggregates require basic aggregates
    if(CHDB_AGG_STATISTICAL AND NOT CHDB_AGG_BASIC)
        message(FATAL_ERROR "CHDB_AGG_STATISTICAL requires CHDB_AGG_BASIC to be enabled")
    endif()

    # CTEs often need subqueries
    if(CHDB_SQL_CTE AND NOT CHDB_SQL_SUBQUERIES)
        message(WARNING "CHDB_SQL_CTE works best with CHDB_SQL_SUBQUERIES enabled")
    endif()

    # Array functions require Array type
    if(CHDB_FUNC_ARRAY AND NOT CHDB_TYPE_ARRAY)
        message(FATAL_ERROR "CHDB_FUNC_ARRAY requires CHDB_TYPE_ARRAY to be enabled")
    endif()

    # Map functions require Map type
    if(CHDB_FUNC_MAP AND NOT CHDB_TYPE_MAP)
        message(FATAL_ERROR "CHDB_FUNC_MAP requires CHDB_TYPE_MAP to be enabled")
    endif()

    # UUID functions require UUID type
    if(CHDB_FUNC_UUID AND NOT CHDB_TYPE_UUID)
        message(FATAL_ERROR "CHDB_FUNC_UUID requires CHDB_TYPE_UUID to be enabled")
    endif()

    # IP functions require IP types
    if(CHDB_FUNC_IP AND NOT CHDB_TYPE_IPV4_IPV6)
        message(FATAL_ERROR "CHDB_FUNC_IP requires CHDB_TYPE_IPV4_IPV6 to be enabled")
    endif()

    # Geo functions require Geo types
    if(CHDB_FUNC_GEO AND NOT CHDB_TYPE_GEO)
        message(FATAL_ERROR "CHDB_FUNC_GEO requires CHDB_TYPE_GEO to be enabled")
    endif()

    message(STATUS "SQL feature configuration validated successfully")
endfunction()

# ============================================================================
# Collect Enabled Features into Lists
# ============================================================================

function(chdb_collect_sql_features)
    set(ENABLED_SQL_FEATURES "")
    set(ENABLED_AGG_FEATURES "")
    set(ENABLED_TABLE_FEATURES "")
    set(ENABLED_FUNC_FEATURES "")
    set(ENABLED_TYPE_FEATURES "")

    # Core SQL
    foreach(feature SELECT FROM WHERE GROUP_BY ORDER_BY LIMIT HAVING DISTINCT)
        if(CHDB_SQL_${feature})
            list(APPEND ENABLED_SQL_FEATURES ${feature})
        endif()
    endforeach()

    # Optional SQL
    foreach(feature WINDOW CTE SUBQUERIES UNION JOIN JOIN_ADVANCED ARRAY_JOIN LATERAL PREWHERE SAMPLE FINAL SETTINGS)
        if(CHDB_SQL_${feature})
            list(APPEND ENABLED_SQL_FEATURES ${feature})
        endif()
    endforeach()

    # Aggregates
    foreach(feature BASIC CONDITIONAL ADVANCED STATISTICAL QUANTILE APPROXIMATE HISTOGRAM COMBINATORS)
        if(CHDB_AGG_${feature})
            list(APPEND ENABLED_AGG_FEATURES ${feature})
        endif()
    endforeach()

    # Table functions
    foreach(feature URL FILE NUMBERS S3 REMOTE MERGE INPUT VALUES VIEW DICTIONARY CLUSTER GENERATE)
        if(CHDB_TABLE_${feature})
            list(APPEND ENABLED_TABLE_FEATURES ${feature})
        endif()
    endforeach()

    # Export to parent scope
    set(CHDB_ENABLED_SQL_FEATURES ${ENABLED_SQL_FEATURES} PARENT_SCOPE)
    set(CHDB_ENABLED_AGG_FEATURES ${ENABLED_AGG_FEATURES} PARENT_SCOPE)
    set(CHDB_ENABLED_TABLE_FEATURES ${ENABLED_TABLE_FEATURES} PARENT_SCOPE)
endfunction()

# ============================================================================
# Generate Feature Header
# ============================================================================

# Ensure build directory exists
if(NOT EXISTS "${CMAKE_BINARY_DIR}/generated")
    file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/generated")
endif()

# Configure the feature header from template
configure_file(
    "${CMAKE_CURRENT_LIST_DIR}/chdb_features.h.in"
    "${CMAKE_BINARY_DIR}/generated/chdb_features.h"
    @ONLY
)

# ============================================================================
# Feature Summary
# ============================================================================

function(chdb_print_sql_feature_summary)
    message(STATUS "")
    message(STATUS "=== SQL Feature Configuration ===")

    # Core SQL
    message(STATUS "Core SQL Features:")
    message(STATUS "  SELECT:     ${CHDB_SQL_SELECT}")
    message(STATUS "  FROM:       ${CHDB_SQL_FROM}")
    message(STATUS "  WHERE:      ${CHDB_SQL_WHERE}")
    message(STATUS "  GROUP BY:   ${CHDB_SQL_GROUP_BY}")
    message(STATUS "  ORDER BY:   ${CHDB_SQL_ORDER_BY}")
    message(STATUS "  LIMIT:      ${CHDB_SQL_LIMIT}")

    # Optional SQL
    message(STATUS "Optional SQL Features:")
    message(STATUS "  WINDOW:     ${CHDB_SQL_WINDOW}")
    message(STATUS "  CTE:        ${CHDB_SQL_CTE}")
    message(STATUS "  SUBQUERIES: ${CHDB_SQL_SUBQUERIES}")
    message(STATUS "  UNION:      ${CHDB_SQL_UNION}")
    message(STATUS "  JOIN:       ${CHDB_SQL_JOIN}")

    # Aggregates
    message(STATUS "Aggregate Functions:")
    message(STATUS "  Basic:       ${CHDB_AGG_BASIC}")
    message(STATUS "  Advanced:    ${CHDB_AGG_ADVANCED}")
    message(STATUS "  Statistical: ${CHDB_AGG_STATISTICAL}")

    # Table Functions
    message(STATUS "Table Functions:")
    message(STATUS "  url():      ${CHDB_TABLE_URL}")
    message(STATUS "  file():     ${CHDB_TABLE_FILE}")
    message(STATUS "  numbers():  ${CHDB_TABLE_NUMBERS}")
    message(STATUS "  s3():       ${CHDB_TABLE_S3}")

    message(STATUS "=================================")
    message(STATUS "")
endfunction()

# Run validation on include
chdb_validate_sql_features()
