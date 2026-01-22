# FeatureProfiles.cmake
# Predefined feature profiles for different WASM build configurations
#
# This module provides preset configurations that balance size vs functionality.
# Profiles can be selected with: -DCHDB_FEATURE_PROFILE=<profile_name>

cmake_minimum_required(VERSION 3.20)

# ============================================================================
# Profile Selection
# ============================================================================

set(CHDB_FEATURE_PROFILE "standard" CACHE STRING "Feature profile to use")
set_property(CACHE CHDB_FEATURE_PROFILE PROPERTY STRINGS
    "minimal"
    "core"
    "standard"
    "analytics"
    "full"
    "custom"
)

# ============================================================================
# Profile: Minimal (~2-3MB gzipped)
# ============================================================================
# Ultra-compact build for basic queries only.
# Use case: Embedded widgets, simple data display, size-critical applications

macro(chdb_apply_profile_minimal)
    message(STATUS "Applying 'minimal' feature profile")

    # Core SQL (minimal set)
    set(CHDB_SQL_SELECT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FROM ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_WHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_GROUP_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ORDER_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LIMIT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_HAVING ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_DISTINCT ON CACHE BOOL "" FORCE)

    # Disable optional SQL
    set(CHDB_SQL_WINDOW OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_LATERAL OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_FINAL OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SETTINGS ON CACHE BOOL "" FORCE)

    # Minimal aggregates
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS OFF CACHE BOOL "" FORCE)

    # Minimal table functions
    set(CHDB_TABLE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_FILE OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_S3 OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_REMOTE OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_MERGE OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_INPUT ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VIEW OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_DICTIONARY OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_CLUSTER OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_GENERATE ON CACHE BOOL "" FORCE)

    # Minimal scalar functions
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ENCODING OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_EXTERNAL_DICTS OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "" FORCE)

    # Minimal types
    set(CHDB_TYPE_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DECIMAL OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_UUID OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ARRAY OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_TUPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NESTED OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_LOWCARDINALITY OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ENUM OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_IPV4_IPV6 OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_FIXEDSTRING OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_JSON OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_VARIANT OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DYNAMIC OFF CACHE BOOL "" FORCE)

    set(CHDB_PROFILE_SIZE_TARGET "2-3MB" CACHE STRING "" FORCE)
endmacro()

# ============================================================================
# Profile: Core (~4-5MB gzipped)
# ============================================================================
# Basic SQL with JOINs and subqueries.
# Use case: General-purpose embedded SQL, data exploration

macro(chdb_apply_profile_core)
    message(STATUS "Applying 'core' feature profile")

    # Core SQL
    set(CHDB_SQL_SELECT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FROM ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_WHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_GROUP_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ORDER_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LIMIT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_HAVING ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_DISTINCT ON CACHE BOOL "" FORCE)

    # Enable JOINs and subqueries
    set(CHDB_SQL_WINDOW OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_LATERAL OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_FINAL OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SETTINGS ON CACHE BOOL "" FORCE)

    # Basic aggregates
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS OFF CACHE BOOL "" FORCE)

    # Common table functions
    set(CHDB_TABLE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_FILE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_S3 OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_REMOTE OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_MERGE OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_INPUT ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VIEW OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_DICTIONARY OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_CLUSTER OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_GENERATE ON CACHE BOOL "" FORCE)

    # Core scalar functions
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ENCODING OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_EXTERNAL_DICTS OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "" FORCE)

    # Core types
    set(CHDB_TYPE_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DECIMAL OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_UUID OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_TUPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NESTED OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_LOWCARDINALITY OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ENUM OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_IPV4_IPV6 OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_FIXEDSTRING OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_JSON OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_VARIANT OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DYNAMIC OFF CACHE BOOL "" FORCE)

    set(CHDB_PROFILE_SIZE_TARGET "4-5MB" CACHE STRING "" FORCE)
endmacro()

# ============================================================================
# Profile: Standard (~6-8MB gzipped)
# ============================================================================
# Balanced build with common features for most use cases.
# Use case: Web applications, dashboards, interactive data exploration

macro(chdb_apply_profile_standard)
    message(STATUS "Applying 'standard' feature profile")

    # Core SQL
    set(CHDB_SQL_SELECT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FROM ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_WHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_GROUP_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ORDER_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LIMIT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_HAVING ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_DISTINCT ON CACHE BOOL "" FORCE)

    # Enable useful SQL features
    set(CHDB_SQL_WINDOW OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_LATERAL OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_FINAL OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SETTINGS ON CACHE BOOL "" FORCE)

    # Common aggregates
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM OFF CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS ON CACHE BOOL "" FORCE)

    # Standard table functions
    set(CHDB_TABLE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_FILE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_S3 OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_REMOTE OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_MERGE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_INPUT ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_DICTIONARY OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_CLUSTER OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_GENERATE ON CACHE BOOL "" FORCE)

    # Standard scalar functions
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ENCODING ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_EXTERNAL_DICTS OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "" FORCE)

    # Standard types
    set(CHDB_TYPE_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DECIMAL ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_MAP OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NESTED OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_LOWCARDINALITY OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ENUM ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_IPV4_IPV6 OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_FIXEDSTRING OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_VARIANT OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DYNAMIC OFF CACHE BOOL "" FORCE)

    set(CHDB_PROFILE_SIZE_TARGET "6-8MB" CACHE STRING "" FORCE)
endmacro()

# ============================================================================
# Profile: Analytics (~10-12MB gzipped)
# ============================================================================
# Extended build with window functions and advanced analytics.
# Use case: BI tools, data science workloads, advanced reporting

macro(chdb_apply_profile_analytics)
    message(STATUS "Applying 'analytics' feature profile")

    # Core SQL
    set(CHDB_SQL_SELECT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FROM ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_WHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_GROUP_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ORDER_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LIMIT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_HAVING ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_DISTINCT ON CACHE BOOL "" FORCE)

    # Enable analytics SQL features
    set(CHDB_SQL_WINDOW ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LATERAL ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FINAL OFF CACHE BOOL "" FORCE)
    set(CHDB_SQL_SETTINGS ON CACHE BOOL "" FORCE)

    # Analytics aggregates
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS ON CACHE BOOL "" FORCE)

    # Analytics table functions
    set(CHDB_TABLE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_FILE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_S3 ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_REMOTE OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_MERGE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_INPUT ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_DICTIONARY OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_CLUSTER OFF CACHE BOOL "" FORCE)
    set(CHDB_TABLE_GENERATE ON CACHE BOOL "" FORCE)

    # Analytics scalar functions
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ENCODING ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_EXTERNAL_DICTS OFF CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING OFF CACHE BOOL "" FORCE)

    # Analytics types
    set(CHDB_TYPE_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DECIMAL ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_MAP ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NESTED ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_LOWCARDINALITY ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ENUM ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_IPV4_IPV6 ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_FIXEDSTRING ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_GEO OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_VARIANT OFF CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DYNAMIC OFF CACHE BOOL "" FORCE)

    set(CHDB_PROFILE_SIZE_TARGET "10-12MB" CACHE STRING "" FORCE)
endmacro()

# ============================================================================
# Profile: Full (~15-20MB gzipped)
# ============================================================================
# Complete feature set including ML and geo functions.
# Use case: Full ClickHouse compatibility, advanced use cases

macro(chdb_apply_profile_full)
    message(STATUS "Applying 'full' feature profile")

    # All Core SQL
    set(CHDB_SQL_SELECT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FROM ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_WHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_GROUP_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ORDER_BY ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LIMIT ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_HAVING ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_DISTINCT ON CACHE BOOL "" FORCE)

    # All optional SQL features
    set(CHDB_SQL_WINDOW ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_CTE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SUBQUERIES ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_UNION ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_JOIN_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_ARRAY_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_LATERAL ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_PREWHERE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SAMPLE ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_FINAL ON CACHE BOOL "" FORCE)
    set(CHDB_SQL_SETTINGS ON CACHE BOOL "" FORCE)

    # All aggregates
    set(CHDB_AGG_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_STATISTICAL ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_QUANTILE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_APPROXIMATE ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_HISTOGRAM ON CACHE BOOL "" FORCE)
    set(CHDB_AGG_COMBINATORS ON CACHE BOOL "" FORCE)

    # All table functions
    set(CHDB_TABLE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_FILE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_S3 ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_REMOTE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_MERGE ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_INPUT ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_DICTIONARY ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_CLUSTER ON CACHE BOOL "" FORCE)
    set(CHDB_TABLE_GENERATE ON CACHE BOOL "" FORCE)

    # All scalar functions
    set(CHDB_FUNC_STRING_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_STRING_ENCODING ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_DATETIME_ADVANCED ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MAP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_HASH ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_CONDITIONAL ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_TYPE_CONVERSION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_IP ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_GEO ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_INTROSPECTION ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_EXTERNAL_DICTS ON CACHE BOOL "" FORCE)
    set(CHDB_FUNC_MACHINE_LEARNING ON CACHE BOOL "" FORCE)

    # All types
    set(CHDB_TYPE_BASIC ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DECIMAL ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_TUPLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_MAP ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NESTED ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_NULLABLE ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_LOWCARDINALITY ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_ENUM ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_IPV4_IPV6 ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_FIXEDSTRING ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_GEO ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_VARIANT ON CACHE BOOL "" FORCE)
    set(CHDB_TYPE_DYNAMIC ON CACHE BOOL "" FORCE)

    set(CHDB_PROFILE_SIZE_TARGET "15-20MB" CACHE STRING "" FORCE)
endmacro()

# ============================================================================
# Profile: Custom
# ============================================================================
# Uses manual feature settings. No automatic configuration applied.
# Use case: Specialized builds with specific feature requirements

macro(chdb_apply_profile_custom)
    message(STATUS "Using 'custom' feature profile - manual configuration")
    set(CHDB_PROFILE_SIZE_TARGET "Custom" CACHE STRING "" FORCE)
endmacro()

# ============================================================================
# Profile Application
# ============================================================================

# Apply the selected profile
function(chdb_apply_feature_profile)
    if(CHDB_FEATURE_PROFILE STREQUAL "minimal")
        chdb_apply_profile_minimal()
    elseif(CHDB_FEATURE_PROFILE STREQUAL "core")
        chdb_apply_profile_core()
    elseif(CHDB_FEATURE_PROFILE STREQUAL "standard")
        chdb_apply_profile_standard()
    elseif(CHDB_FEATURE_PROFILE STREQUAL "analytics")
        chdb_apply_profile_analytics()
    elseif(CHDB_FEATURE_PROFILE STREQUAL "full")
        chdb_apply_profile_full()
    elseif(CHDB_FEATURE_PROFILE STREQUAL "custom")
        chdb_apply_profile_custom()
    else()
        message(WARNING "Unknown feature profile '${CHDB_FEATURE_PROFILE}', using 'standard'")
        chdb_apply_profile_standard()
    endif()
endfunction()

# ============================================================================
# Profile Comparison Helper
# ============================================================================

function(chdb_print_profile_comparison)
    message(STATUS "")
    message(STATUS "=== Available Feature Profiles ===")
    message(STATUS "")
    message(STATUS "Profile    | Size Target | SQL Features        | Use Case")
    message(STATUS "-----------+-------------+---------------------+---------------------------")
    message(STATUS "minimal    | 2-3MB       | Core only           | Embedded widgets, simple display")
    message(STATUS "core       | 4-5MB       | + JOINs, subqueries | General SQL, data exploration")
    message(STATUS "standard   | 6-8MB       | + CTEs, UNION       | Web apps, dashboards")
    message(STATUS "analytics  | 10-12MB     | + Window, stats     | BI tools, data science")
    message(STATUS "full       | 15-20MB     | All features        | Full compatibility")
    message(STATUS "custom     | Variable    | User-defined        | Specialized builds")
    message(STATUS "")
    message(STATUS "Current profile: ${CHDB_FEATURE_PROFILE}")
    message(STATUS "Target size: ${CHDB_PROFILE_SIZE_TARGET}")
    message(STATUS "")
endfunction()

# ============================================================================
# Auto-Apply Profile on Include
# ============================================================================

# Apply the selected profile when this file is included
chdb_apply_feature_profile()

# Print summary
message(STATUS "")
message(STATUS "=== Feature Profile: ${CHDB_FEATURE_PROFILE} ===")
message(STATUS "Target size: ${CHDB_PROFILE_SIZE_TARGET}")
message(STATUS "")
