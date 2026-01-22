# wasm-features.cmake - Feature toggle configuration for chdb-wasm
# Defines which engines, formats, and functions to include in each build profile

# =============================================================================
# Build Profile Selection
# =============================================================================

# CHDB_WASM_PROFILE should be set to: minimal, standard, or full
if(NOT DEFINED CHDB_WASM_PROFILE)
    set(CHDB_WASM_PROFILE "standard" CACHE STRING "Build profile: minimal, standard, full")
endif()

set_property(CACHE CHDB_WASM_PROFILE PROPERTY STRINGS "minimal" "standard" "full")

# Create uppercase version for preprocessor defines
string(TOUPPER ${CHDB_WASM_PROFILE} CHDB_WASM_PROFILE_UPPER)

message(STATUS "Configuring features for profile: ${CHDB_WASM_PROFILE}")

# =============================================================================
# Feature Options
# =============================================================================

# Table Engines
option(CHDB_ENABLE_ENGINE_MEMORY "Enable Memory table engine" OFF)
option(CHDB_ENABLE_ENGINE_MERGETREE "Enable MergeTree table engine" OFF)
option(CHDB_ENABLE_ENGINE_URL "Enable URL table engine" OFF)
option(CHDB_ENABLE_ENGINE_S3 "Enable S3 table engine" OFF)
option(CHDB_ENABLE_ENGINE_FILE "Enable File table engine" OFF)
option(CHDB_ENABLE_ENGINE_BUFFER "Enable Buffer table engine" OFF)
option(CHDB_ENABLE_ENGINE_JOIN "Enable Join table engine" OFF)
option(CHDB_ENABLE_ENGINE_SET "Enable Set table engine" OFF)
option(CHDB_ENABLE_ENGINE_DICTIONARY "Enable Dictionary table engine" OFF)
option(CHDB_ENABLE_ENGINE_GENERATE "Enable Generate table engine" OFF)
option(CHDB_ENABLE_ENGINE_NUMBERS "Enable numbers() table function" OFF)
option(CHDB_ENABLE_ENGINE_NULL "Enable Null table engine" OFF)
option(CHDB_ENABLE_ENGINE_VIEW "Enable View engine" OFF)

# Output Formats
option(CHDB_ENABLE_FORMAT_JSON "Enable JSON output formats" OFF)
option(CHDB_ENABLE_FORMAT_PARQUET "Enable Parquet format" OFF)
option(CHDB_ENABLE_FORMAT_CSV "Enable CSV format" OFF)
option(CHDB_ENABLE_FORMAT_TSV "Enable TSV format" OFF)
option(CHDB_ENABLE_FORMAT_ARROW "Enable Arrow format" OFF)
option(CHDB_ENABLE_FORMAT_AVRO "Enable Avro format" OFF)
option(CHDB_ENABLE_FORMAT_ORC "Enable ORC format" OFF)
option(CHDB_ENABLE_FORMAT_PROTOBUF "Enable Protobuf format" OFF)
option(CHDB_ENABLE_FORMAT_MSGPACK "Enable MsgPack format" OFF)
option(CHDB_ENABLE_FORMAT_NATIVE "Enable Native format" OFF)
option(CHDB_ENABLE_FORMAT_ROWBINARY "Enable RowBinary format" OFF)
option(CHDB_ENABLE_FORMAT_VALUES "Enable Values format" OFF)
option(CHDB_ENABLE_FORMAT_PRETTY "Enable Pretty format" OFF)

# Function Categories
option(CHDB_ENABLE_FUNCTIONS_CORE "Enable core SQL functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_AGGREGATE "Enable aggregate functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_WINDOW "Enable window functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_STRING "Enable string functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_ARRAY "Enable array functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_DATE "Enable date/time functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_JSON "Enable JSON functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_MATH "Enable math functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_URL "Enable URL parsing functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_UUID "Enable UUID functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_HASH "Enable hash functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_GEO "Enable geo functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_ML "Enable machine learning functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_NLP "Enable NLP functions" OFF)
option(CHDB_ENABLE_FUNCTIONS_INTROSPECTION "Enable introspection functions" OFF)

# Misc Features
option(CHDB_ENABLE_COMPRESSION_LZ4 "Enable LZ4 compression" OFF)
option(CHDB_ENABLE_COMPRESSION_ZSTD "Enable ZSTD compression" OFF)
option(CHDB_ENABLE_COMPRESSION_SNAPPY "Enable Snappy compression" OFF)
option(CHDB_ENABLE_DICTIONARIES "Enable external dictionaries" OFF)
option(CHDB_ENABLE_SSL "Enable SSL support" OFF)

# =============================================================================
# Profile: Minimal (~3MB gzipped)
# Target: Smallest possible binary with essential features
# =============================================================================

if(CHDB_WASM_PROFILE STREQUAL "minimal")
    message(STATUS "Configuring MINIMAL profile (~3MB gzipped)")

    # Table Engines - bare minimum
    set(CHDB_ENABLE_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_VIEW ON CACHE BOOL "" FORCE)

    # Formats - JSON only for minimal (use parquet-wasm as external dependency)
    # Note: Native Parquet requires Arrow library (~8-10MB), use parquet-wasm instead
    set(CHDB_ENABLE_FORMAT_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_VALUES ON CACHE BOOL "" FORCE)

    # Functions - core SQL only
    set(CHDB_ENABLE_FUNCTIONS_CORE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_STRING ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_DATE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_MATH ON CACHE BOOL "" FORCE)

    # Compression - LZ4 only (fast, reasonable ratio)
    set(CHDB_ENABLE_COMPRESSION_LZ4 ON CACHE BOOL "" FORCE)

# =============================================================================
# Profile: Standard (~10MB gzipped)
# Target: Balanced size/features, good for most use cases
# =============================================================================

elseif(CHDB_WASM_PROFILE STREQUAL "standard")
    message(STATUS "Configuring STANDARD profile (~10MB gzipped)")

    # Table Engines - common engines
    set(CHDB_ENABLE_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_MERGETREE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_S3 ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_FILE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_BUFFER ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_GENERATE ON CACHE BOOL "" FORCE)

    # Formats - common formats
    set(CHDB_ENABLE_FORMAT_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_PARQUET ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_CSV ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_TSV ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_ARROW ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_NATIVE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_ROWBINARY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_PRETTY ON CACHE BOOL "" FORCE)

    # Functions - common functions
    set(CHDB_ENABLE_FUNCTIONS_CORE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_AGGREGATE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_STRING ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_DATE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_URL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_HASH ON CACHE BOOL "" FORCE)

    # Compression
    set(CHDB_ENABLE_COMPRESSION_LZ4 ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_COMPRESSION_ZSTD ON CACHE BOOL "" FORCE)

# =============================================================================
# Profile: Full (~20MB gzipped)
# Target: All supported features
# =============================================================================

elseif(CHDB_WASM_PROFILE STREQUAL "full")
    message(STATUS "Configuring FULL profile (~20MB gzipped)")

    # Table Engines - all supported
    set(CHDB_ENABLE_ENGINE_MEMORY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_MERGETREE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_URL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_S3 ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_FILE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_BUFFER ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_JOIN ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_SET ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_DICTIONARY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_NUMBERS ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_NULL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_VIEW ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_ENGINE_GENERATE ON CACHE BOOL "" FORCE)

    # Formats - all supported
    set(CHDB_ENABLE_FORMAT_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_PARQUET ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_CSV ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_TSV ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_ARROW ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_AVRO ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_ORC ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_PROTOBUF ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_MSGPACK ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_NATIVE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_ROWBINARY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_VALUES ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FORMAT_PRETTY ON CACHE BOOL "" FORCE)

    # Functions - all supported
    set(CHDB_ENABLE_FUNCTIONS_CORE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_AGGREGATE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_WINDOW ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_STRING ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_ARRAY ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_DATE ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_JSON ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_MATH ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_URL ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_UUID ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_HASH ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_GEO ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_FUNCTIONS_INTROSPECTION ON CACHE BOOL "" FORCE)

    # Compression - all supported
    set(CHDB_ENABLE_COMPRESSION_LZ4 ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_COMPRESSION_ZSTD ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_COMPRESSION_SNAPPY ON CACHE BOOL "" FORCE)

    # Additional features
    set(CHDB_ENABLE_DICTIONARIES ON CACHE BOOL "" FORCE)
    set(CHDB_ENABLE_SSL ON CACHE BOOL "" FORCE)

else()
    message(FATAL_ERROR "Unknown build profile: ${CHDB_WASM_PROFILE}. Use: minimal, standard, or full")
endif()

# =============================================================================
# Generate Preprocessor Defines
# =============================================================================

set(CHDB_FEATURE_DEFINES "")

# Engine defines
macro(add_feature_define OPTION_NAME DEFINE_NAME)
    if(${OPTION_NAME})
        list(APPEND CHDB_FEATURE_DEFINES "${DEFINE_NAME}=1")
    else()
        list(APPEND CHDB_FEATURE_DEFINES "${DEFINE_NAME}=0")
    endif()
endmacro()

# Table Engines
add_feature_define(CHDB_ENABLE_ENGINE_MEMORY CHDB_ENGINE_MEMORY)
add_feature_define(CHDB_ENABLE_ENGINE_MERGETREE CHDB_ENGINE_MERGETREE)
add_feature_define(CHDB_ENABLE_ENGINE_URL CHDB_ENGINE_URL)
add_feature_define(CHDB_ENABLE_ENGINE_S3 CHDB_ENGINE_S3)
add_feature_define(CHDB_ENABLE_ENGINE_FILE CHDB_ENGINE_FILE)
add_feature_define(CHDB_ENABLE_ENGINE_BUFFER CHDB_ENGINE_BUFFER)
add_feature_define(CHDB_ENABLE_ENGINE_JOIN CHDB_ENGINE_JOIN)
add_feature_define(CHDB_ENABLE_ENGINE_SET CHDB_ENGINE_SET)
add_feature_define(CHDB_ENABLE_ENGINE_DICTIONARY CHDB_ENGINE_DICTIONARY)
add_feature_define(CHDB_ENABLE_ENGINE_GENERATE CHDB_ENGINE_GENERATE)
add_feature_define(CHDB_ENABLE_ENGINE_NUMBERS CHDB_ENGINE_NUMBERS)
add_feature_define(CHDB_ENABLE_ENGINE_NULL CHDB_ENGINE_NULL)
add_feature_define(CHDB_ENABLE_ENGINE_VIEW CHDB_ENGINE_VIEW)

# Formats
add_feature_define(CHDB_ENABLE_FORMAT_JSON CHDB_FORMAT_JSON)
add_feature_define(CHDB_ENABLE_FORMAT_PARQUET CHDB_FORMAT_PARQUET)
add_feature_define(CHDB_ENABLE_FORMAT_CSV CHDB_FORMAT_CSV)
add_feature_define(CHDB_ENABLE_FORMAT_TSV CHDB_FORMAT_TSV)
add_feature_define(CHDB_ENABLE_FORMAT_ARROW CHDB_FORMAT_ARROW)
add_feature_define(CHDB_ENABLE_FORMAT_AVRO CHDB_FORMAT_AVRO)
add_feature_define(CHDB_ENABLE_FORMAT_ORC CHDB_FORMAT_ORC)
add_feature_define(CHDB_ENABLE_FORMAT_PROTOBUF CHDB_FORMAT_PROTOBUF)
add_feature_define(CHDB_ENABLE_FORMAT_MSGPACK CHDB_FORMAT_MSGPACK)
add_feature_define(CHDB_ENABLE_FORMAT_NATIVE CHDB_FORMAT_NATIVE)
add_feature_define(CHDB_ENABLE_FORMAT_ROWBINARY CHDB_FORMAT_ROWBINARY)
add_feature_define(CHDB_ENABLE_FORMAT_VALUES CHDB_FORMAT_VALUES)
add_feature_define(CHDB_ENABLE_FORMAT_PRETTY CHDB_FORMAT_PRETTY)

# Functions
add_feature_define(CHDB_ENABLE_FUNCTIONS_CORE CHDB_FUNCTIONS_CORE)
add_feature_define(CHDB_ENABLE_FUNCTIONS_AGGREGATE CHDB_FUNCTIONS_AGGREGATE)
add_feature_define(CHDB_ENABLE_FUNCTIONS_WINDOW CHDB_FUNCTIONS_WINDOW)
add_feature_define(CHDB_ENABLE_FUNCTIONS_STRING CHDB_FUNCTIONS_STRING)
add_feature_define(CHDB_ENABLE_FUNCTIONS_ARRAY CHDB_FUNCTIONS_ARRAY)
add_feature_define(CHDB_ENABLE_FUNCTIONS_DATE CHDB_FUNCTIONS_DATE)
add_feature_define(CHDB_ENABLE_FUNCTIONS_JSON CHDB_FUNCTIONS_JSON)
add_feature_define(CHDB_ENABLE_FUNCTIONS_MATH CHDB_FUNCTIONS_MATH)
add_feature_define(CHDB_ENABLE_FUNCTIONS_URL CHDB_FUNCTIONS_URL)
add_feature_define(CHDB_ENABLE_FUNCTIONS_UUID CHDB_FUNCTIONS_UUID)
add_feature_define(CHDB_ENABLE_FUNCTIONS_HASH CHDB_FUNCTIONS_HASH)
add_feature_define(CHDB_ENABLE_FUNCTIONS_GEO CHDB_FUNCTIONS_GEO)
add_feature_define(CHDB_ENABLE_FUNCTIONS_ML CHDB_FUNCTIONS_ML)
add_feature_define(CHDB_ENABLE_FUNCTIONS_NLP CHDB_FUNCTIONS_NLP)
add_feature_define(CHDB_ENABLE_FUNCTIONS_INTROSPECTION CHDB_FUNCTIONS_INTROSPECTION)

# Compression
add_feature_define(CHDB_ENABLE_COMPRESSION_LZ4 CHDB_COMPRESSION_LZ4)
add_feature_define(CHDB_ENABLE_COMPRESSION_ZSTD CHDB_COMPRESSION_ZSTD)
add_feature_define(CHDB_ENABLE_COMPRESSION_SNAPPY CHDB_COMPRESSION_SNAPPY)

# Misc
add_feature_define(CHDB_ENABLE_DICTIONARIES CHDB_DICTIONARIES)
add_feature_define(CHDB_ENABLE_SSL CHDB_SSL)

# =============================================================================
# Feature Summary
# =============================================================================

function(print_feature_status NAME VALUE)
    if(${VALUE})
        message(STATUS "  [x] ${NAME}")
    else()
        message(STATUS "  [ ] ${NAME}")
    endif()
endfunction()

message(STATUS "")
message(STATUS "Feature Summary for ${CHDB_WASM_PROFILE} profile:")
message(STATUS "")
message(STATUS "Table Engines:")
print_feature_status("Memory" CHDB_ENABLE_ENGINE_MEMORY)
print_feature_status("MergeTree" CHDB_ENABLE_ENGINE_MERGETREE)
print_feature_status("URL" CHDB_ENABLE_ENGINE_URL)
print_feature_status("S3" CHDB_ENABLE_ENGINE_S3)
print_feature_status("File" CHDB_ENABLE_ENGINE_FILE)
print_feature_status("Buffer" CHDB_ENABLE_ENGINE_BUFFER)
print_feature_status("Join" CHDB_ENABLE_ENGINE_JOIN)
print_feature_status("Set" CHDB_ENABLE_ENGINE_SET)
print_feature_status("Dictionary" CHDB_ENABLE_ENGINE_DICTIONARY)

message(STATUS "")
message(STATUS "Formats:")
print_feature_status("JSON" CHDB_ENABLE_FORMAT_JSON)
print_feature_status("Parquet" CHDB_ENABLE_FORMAT_PARQUET)
print_feature_status("CSV" CHDB_ENABLE_FORMAT_CSV)
print_feature_status("TSV" CHDB_ENABLE_FORMAT_TSV)
print_feature_status("Arrow" CHDB_ENABLE_FORMAT_ARROW)
print_feature_status("Avro" CHDB_ENABLE_FORMAT_AVRO)
print_feature_status("ORC" CHDB_ENABLE_FORMAT_ORC)
print_feature_status("Protobuf" CHDB_ENABLE_FORMAT_PROTOBUF)

message(STATUS "")
message(STATUS "Function Categories:")
print_feature_status("Core" CHDB_ENABLE_FUNCTIONS_CORE)
print_feature_status("Aggregate" CHDB_ENABLE_FUNCTIONS_AGGREGATE)
print_feature_status("Window" CHDB_ENABLE_FUNCTIONS_WINDOW)
print_feature_status("String" CHDB_ENABLE_FUNCTIONS_STRING)
print_feature_status("Array" CHDB_ENABLE_FUNCTIONS_ARRAY)
print_feature_status("Date/Time" CHDB_ENABLE_FUNCTIONS_DATE)
print_feature_status("JSON" CHDB_ENABLE_FUNCTIONS_JSON)
print_feature_status("Math" CHDB_ENABLE_FUNCTIONS_MATH)
print_feature_status("Geo" CHDB_ENABLE_FUNCTIONS_GEO)

message(STATUS "")
message(STATUS "Compression:")
print_feature_status("LZ4" CHDB_ENABLE_COMPRESSION_LZ4)
print_feature_status("ZSTD" CHDB_ENABLE_COMPRESSION_ZSTD)
print_feature_status("Snappy" CHDB_ENABLE_COMPRESSION_SNAPPY)

message(STATUS "")
