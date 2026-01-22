# wasm-ultra-minimal.cmake
# Ultra-Minimal WASM Build Profile for Cloudflare Workers (<40MB target)
#
# RESEARCH INSIGHTS (why this is needed):
#   - ClickHouse code section is 5.13x larger than DuckDB (117MB vs 22MB)
#   - ClickHouse has 142,075 functions vs DuckDB's 60,116
#   - Average function size is 868 bytes vs 399 bytes
#
# This configuration produces the SMALLEST possible WASM binary by
# aggressively disabling ALL optional features.
#
# TARGET: <40MB uncompressed, <10MB gzipped
#
# Supported SQL Functionality:
#   - SELECT, INSERT (into Memory tables only)
#   - Basic aggregates: COUNT, SUM, AVG, MIN, MAX
#   - WHERE, GROUP BY, ORDER BY, LIMIT, OFFSET
#   - Basic operators: +, -, *, /, %, =, !=, <, >, <=, >=, AND, OR, NOT
#   - Basic functions: length, substring, concat, lower, upper, CAST
#   - Null handling: isNull, coalesce, ifNull
#   - Type conversion: toString, toInt*, toFloat*
#
# NOT Supported (disabled for size):
#   - MergeTree and all persistent storage engines
#   - Distributed queries and clustering
#   - External integrations (S3, Kafka, databases, etc.)
#   - Complex formats (Parquet, Arrow, ORC, Avro, Protobuf)
#   - Complex aggregations (quantile, histogram, windowFunnel, etc.)
#   - Geospatial functions (H3, S2)
#   - Machine learning functions
#   - Complex string functions (regex, NLP)
#   - Complex date/time functions
#   - Dictionary sources (except flat/hashed in-memory)
#   - Compression codecs except LZ4
#   - JOINs (or minimal join support)
#
# Usage:
#   cmake -C cmake/wasm-ultra-minimal.cmake \
#         -DCMAKE_TOOLCHAIN_FILE=$EMSDK/.../Emscripten.cmake ..
#
# Reference: DuckDB WASM achieves ~10MB through similar aggressive stripping.
# Their approach: disable all extensions, use minimal allocator, strip RTTI.

cmake_minimum_required(VERSION 3.20)

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  ULTRA-MINIMAL WASM Build Profile")
message(STATUS "  Target: <40MB uncompressed, <10MB gzipped")
message(STATUS "  Use case: Cloudflare Workers, Edge Functions")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# MASTER SWITCH - Disable ALL Optional Libraries
# ============================================================================
# From vendor/chdb/CMakeLists.txt line 413:
#   option(ENABLE_LIBRARIES "Enable all external libraries by default" ON)
# Setting this OFF disables ALL optional features by default

set(ENABLE_LIBRARIES OFF CACHE BOOL "MASTER SWITCH: Disable ALL external libraries" FORCE)

message(STATUS "[MASTER] ENABLE_LIBRARIES=OFF - All optional features disabled by default")

# ============================================================================
# Build Profile Flag
# ============================================================================

set(BUILD_ULTRA_MINIMAL ON CACHE BOOL "Ultra-minimal WASM build profile" FORCE)
set(CHDB_WASM_PROFILE "ultra-minimal" CACHE STRING "WASM build profile" FORCE)

# ============================================================================
# Storage Engines - Memory ONLY
# ============================================================================
# Disable ALL storage engines except Memory. This is the most aggressive
# setting - no persistence, no disk I/O, no replication.
#
# Size savings: ~6-8MB (MergeTree alone is ~4MB compiled)

set(CHDB_WASM_ENGINE_LEVEL "minimal" CACHE STRING "Minimal engine level" FORCE)

# Explicitly disable all engines
set(CHDB_ENGINE_MEMORY ON CACHE BOOL "Memory engine - required" FORCE)
set(CHDB_ENGINE_VIEW OFF CACHE BOOL "View engine - disabled" FORCE)
set(CHDB_ENGINE_SYSTEM OFF CACHE BOOL "System tables - disabled" FORCE)
set(CHDB_ENGINE_NULL OFF CACHE BOOL "Null engine - disabled" FORCE)
set(CHDB_ENGINE_SET OFF CACHE BOOL "Set engine - disabled" FORCE)
set(CHDB_ENGINE_JOIN OFF CACHE BOOL "Join engine - disabled" FORCE)
set(CHDB_ENGINE_BUFFER OFF CACHE BOOL "Buffer engine - disabled" FORCE)
set(CHDB_ENGINE_GENERATE_RANDOM OFF CACHE BOOL "GenerateRandom - disabled" FORCE)
set(CHDB_ENGINE_VALUES OFF CACHE BOOL "Values engine - disabled" FORCE)

# Heavy engines - absolutely disabled
set(CHDB_ENGINE_MERGETREE OFF CACHE BOOL "MergeTree - disabled" FORCE)
set(CHDB_ENGINE_DISTRIBUTED OFF CACHE BOOL "Distributed - disabled" FORCE)
set(CHDB_ENGINE_KAFKA OFF CACHE BOOL "Kafka - disabled" FORCE)
set(CHDB_ENGINE_RABBITMQ OFF CACHE BOOL "RabbitMQ - disabled" FORCE)
set(CHDB_ENGINE_NATS OFF CACHE BOOL "NATS - disabled" FORCE)
set(CHDB_ENGINE_S3 OFF CACHE BOOL "S3 - disabled" FORCE)
set(CHDB_ENGINE_AZURE OFF CACHE BOOL "Azure - disabled" FORCE)
set(CHDB_ENGINE_HDFS OFF CACHE BOOL "HDFS - disabled" FORCE)
set(CHDB_ENGINE_POSTGRESQL OFF CACHE BOOL "PostgreSQL - disabled" FORCE)
set(CHDB_ENGINE_MYSQL OFF CACHE BOOL "MySQL - disabled" FORCE)
set(CHDB_ENGINE_MONGODB OFF CACHE BOOL "MongoDB - disabled" FORCE)
set(CHDB_ENGINE_REDIS OFF CACHE BOOL "Redis - disabled" FORCE)
set(CHDB_ENGINE_SQLITE OFF CACHE BOOL "SQLite - disabled" FORCE)
set(CHDB_ENGINE_FILE OFF CACHE BOOL "File - disabled" FORCE)
set(CHDB_ENGINE_URL OFF CACHE BOOL "URL - disabled" FORCE)
set(CHDB_ENGINE_LOG OFF CACHE BOOL "Log - disabled" FORCE)
set(CHDB_ENGINE_MATERIALIZED_VIEW OFF CACHE BOOL "MaterializedView - disabled" FORCE)
set(CHDB_ENGINE_LIVE_VIEW OFF CACHE BOOL "LiveView - disabled" FORCE)
set(CHDB_ENGINE_WINDOW_VIEW OFF CACHE BOOL "WindowView - disabled" FORCE)
set(CHDB_ENGINE_TIMESERIES OFF CACHE BOOL "TimeSeries - disabled" FORCE)
set(CHDB_ENGINE_DICTIONARY OFF CACHE BOOL "Dictionary - disabled" FORCE)
set(CHDB_ENGINE_ROCKSDB OFF CACHE BOOL "RocksDB - disabled" FORCE)
set(CHDB_ENGINE_HIVE OFF CACHE BOOL "Hive - disabled" FORCE)
set(CHDB_ENGINE_KEEPER_MAP OFF CACHE BOOL "KeeperMap - disabled" FORCE)

message(STATUS "[Engines] Memory ONLY (~6-8MB savings)")

# ============================================================================
# Distributed Query - COMPLETELY DISABLED
# ============================================================================
# No clustering, no sharding, no remote queries.
#
# Size savings: ~500KB-1MB

set(ENABLE_DISTRIBUTED_QUERIES OFF CACHE BOOL "Disable distributed queries" FORCE)
set(ENABLE_CLUSTER_DISCOVERY OFF CACHE BOOL "Disable cluster discovery" FORCE)
set(USE_INTERNAL_KEEPER OFF CACHE BOOL "Disable internal Keeper/ZooKeeper" FORCE)

message(STATUS "[Distributed] DISABLED (~500KB-1MB savings)")

# ============================================================================
# External Integrations - ALL DISABLED
# ============================================================================
# No cloud storage, no message queues, no external databases.
#
# CRITICAL SIZE SAVINGS: ~1.4+ GB (cloud storage backends are massive)
#   - AWS S3:           ~944 MB
#   - Google Cloud:     ~369 MB
#   - Azure Blob:       ~50-100 MB
#   - HDFS:             ~20-50 MB

# Cloud Storage - AWS S3 (~944 MB)
set(ENABLE_AWS_S3 OFF CACHE BOOL "Disable AWS S3" FORCE)
set(ENABLE_S3 OFF CACHE BOOL "Disable S3" FORCE)
set(ENABLE_AWS_S3 OFF CACHE INTERNAL "")
set(ENABLE_S3 OFF CACHE INTERNAL "")

# Cloud Storage - Google Cloud (~369 MB)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable GCS" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE BOOL "Disable GCS KMS" FORCE)
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE INTERNAL "")
set(ENABLE_GOOGLE_CLOUD_CPP_KMS OFF CACHE INTERNAL "")

# Cloud Storage - Azure (~50-100 MB)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE BOOL "Disable Azure" FORCE)
set(ENABLE_AZURE_BLOB_STORAGE OFF CACHE INTERNAL "")

# Cloud Storage - HDFS (~20-50 MB)
set(ENABLE_HDFS OFF CACHE BOOL "Disable HDFS" FORCE)
set(ENABLE_HDFS OFF CACHE INTERNAL "")

# Message Queues
set(ENABLE_KAFKA OFF CACHE BOOL "Disable Kafka" FORCE)
set(ENABLE_AMQPCPP OFF CACHE BOOL "Disable RabbitMQ" FORCE)
set(ENABLE_NATSIO OFF CACHE BOOL "Disable NATS" FORCE)

# External Databases
set(ENABLE_MYSQL OFF CACHE BOOL "Disable MySQL" FORCE)
set(ENABLE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL" FORCE)
set(USE_MONGODB OFF CACHE BOOL "Disable MongoDB" FORCE)
set(ENABLE_CASSANDRA OFF CACHE BOOL "Disable Cassandra" FORCE)
set(ENABLE_SQLITE OFF CACHE BOOL "Disable SQLite" FORCE)
set(ENABLE_ROCKSDB OFF CACHE BOOL "Disable RocksDB" FORCE)
set(ENABLE_REDIS OFF CACHE BOOL "Disable Redis" FORCE)
set(ENABLE_ODBC OFF CACHE BOOL "Disable ODBC" FORCE)

# Big Data (Hive depends on HDFS which is disabled above)
set(ENABLE_HIVE OFF CACHE BOOL "Disable Hive" FORCE)
set(ENABLE_HIVE OFF CACHE INTERNAL "")
set(ENABLE_DELTA_KERNEL_RS OFF CACHE BOOL "Disable Delta Lake" FORCE)
set(ENABLE_DELTA_KERNEL_RS OFF CACHE INTERNAL "")

# Networking
set(ENABLE_GRPC OFF CACHE BOOL "Disable gRPC" FORCE)
set(ENABLE_ARROW_FLIGHT OFF CACHE BOOL "Disable Arrow Flight" FORCE)
set(ENABLE_CURL OFF CACHE BOOL "Disable cURL" FORCE)
set(ENABLE_SSH OFF CACHE BOOL "Disable SSH" FORCE)
set(ENABLE_SSL OFF CACHE BOOL "Disable SSL" FORCE)
set(ENABLE_LDAP OFF CACHE BOOL "Disable LDAP" FORCE)
set(ENABLE_GSASL_LIBRARY OFF CACHE BOOL "Disable GSASL/Kerberos" FORCE)
set(ENABLE_KERBEROS OFF CACHE BOOL "Disable Kerberos" FORCE)

# Consensus/Coordination
set(ENABLE_NURAFT OFF CACHE BOOL "Disable NuRaft" FORCE)

# AI SDK
set(ENABLE_CLIENT_AI OFF CACHE BOOL "Disable AI SDK" FORCE)

message(STATUS "[Integrations] ALL DISABLED (~40-70MB savings)")

# ============================================================================
# Data Formats - JSON/CSV/TSV ONLY
# ============================================================================
# Disable all heavy binary formats. Keep only text-based formats essential
# for web APIs.
#
# Size savings: ~20-35MB

# Heavy formats - DISABLED
set(ENABLE_PARQUET OFF CACHE BOOL "Disable Parquet" FORCE)
set(ENABLE_ARROW OFF CACHE BOOL "Disable Arrow" FORCE)
set(ENABLE_ORC OFF CACHE BOOL "Disable ORC" FORCE)
set(ENABLE_AVRO OFF CACHE BOOL "Disable Avro" FORCE)
set(ENABLE_PROTOBUF OFF CACHE BOOL "Disable Protobuf" FORCE)
set(ENABLE_CAPNP OFF CACHE BOOL "Disable Cap'n Proto" FORCE)
set(ENABLE_MSGPACK OFF CACHE BOOL "Disable MessagePack" FORCE)
set(ENABLE_THRIFT OFF CACHE BOOL "Disable Thrift" FORCE)

# Ultra-minimal: even disable Native format (ClickHouse internal)
set(CHDB_ULTRA_MINIMAL_FORMATS ON CACHE BOOL "Use minimal format set" FORCE)

message(STATUS "[Formats] JSON/CSV/TSV only (~20-35MB savings)")

# ============================================================================
# Functions - CORE ONLY (Ultra-Minimal Whitelist)
# ============================================================================
# Only include functions absolutely necessary for basic SQL operations.
# This is MORE aggressive than minimal-functions.cmake.
#
# Size savings: ~4-6MB (from ~11MB Functions directory)

set(CHDB_ULTRA_MINIMAL_FUNCTIONS ON CACHE BOOL "Ultra-minimal function set" FORCE)

# Explicitly disable function categories
set(CHDB_DISABLE_GEO_FUNCTIONS ON CACHE BOOL "Disable geospatial" FORCE)
set(CHDB_DISABLE_ML_FUNCTIONS ON CACHE BOOL "Disable machine learning" FORCE)
set(CHDB_DISABLE_NLP_FUNCTIONS ON CACHE BOOL "Disable NLP" FORCE)
set(CHDB_DISABLE_HASH_FUNCTIONS OFF CACHE BOOL "Keep basic hash" FORCE)
set(CHDB_DISABLE_CRYPTO_FUNCTIONS ON CACHE BOOL "Disable crypto" FORCE)
set(CHDB_DISABLE_URL_FUNCTIONS ON CACHE BOOL "Disable URL parsing" FORCE)
set(CHDB_DISABLE_JSON_FUNCTIONS OFF CACHE BOOL "Keep basic JSON" FORCE)
set(CHDB_DISABLE_BITMAP_FUNCTIONS ON CACHE BOOL "Disable bitmaps" FORCE)
set(CHDB_DISABLE_TUPLE_FUNCTIONS ON CACHE BOOL "Disable complex tuples" FORCE)
set(CHDB_DISABLE_MAP_FUNCTIONS ON CACHE BOOL "Disable maps" FORCE)
set(CHDB_DISABLE_ARRAY_FUNCTIONS OFF CACHE BOOL "Keep basic arrays" FORCE)

message(STATUS "[Functions] Core arithmetic/comparison/aggregates only (~4-6MB savings)")

# ============================================================================
# Aggregate Functions - Basic ONLY
# ============================================================================
# Only COUNT, SUM, AVG, MIN, MAX. No complex aggregations.
#
# Size savings: ~1-2MB (from ~1.9MB AggregateFunctions)

set(CHDB_ULTRA_MINIMAL_AGGREGATES ON CACHE BOOL "Ultra-minimal aggregates" FORCE)

# Disabled aggregate categories
set(CHDB_DISABLE_QUANTILE_AGGREGATES ON CACHE BOOL "Disable quantile/percentile" FORCE)
set(CHDB_DISABLE_STATISTICAL_AGGREGATES ON CACHE BOOL "Disable stddev/variance/corr" FORCE)
set(CHDB_DISABLE_WINDOW_AGGREGATES ON CACHE BOOL "Disable window functions" FORCE)
set(CHDB_DISABLE_FUNNEL_AGGREGATES ON CACHE BOOL "Disable funnel analytics" FORCE)
set(CHDB_DISABLE_HISTOGRAM_AGGREGATES ON CACHE BOOL "Disable histograms" FORCE)
set(CHDB_DISABLE_UNIQ_AGGREGATES OFF CACHE BOOL "Keep uniq/count distinct" FORCE)
set(CHDB_DISABLE_GROUPARRAY_AGGREGATES ON CACHE BOOL "Disable groupArray" FORCE)

message(STATUS "[Aggregates] COUNT/SUM/AVG/MIN/MAX only (~1-2MB savings)")

# ============================================================================
# Table Functions - DISABLED
# ============================================================================
# No table functions (numbers, file, url, s3, etc.)
#
# Size savings: ~500KB-1MB

set(CHDB_DISABLE_TABLE_FUNCTIONS ON CACHE BOOL "Disable table functions" FORCE)
set(ENABLE_TABLE_FUNCTIONS OFF CACHE BOOL "Disable table functions" FORCE)

message(STATUS "[Table Functions] DISABLED (~500KB-1MB savings)")

# ============================================================================
# Dictionary Sources - Flat/Hashed ONLY
# ============================================================================
# Only in-memory dictionary types. No external sources.
#
# Size savings: ~200-500KB

set(CHDB_ULTRA_MINIMAL_DICTIONARIES ON CACHE BOOL "Minimal dictionary types" FORCE)
set(CHDB_DICT_FLAT ON CACHE BOOL "Keep flat dictionary" FORCE)
set(CHDB_DICT_HASHED ON CACHE BOOL "Keep hashed dictionary" FORCE)
set(CHDB_DICT_COMPLEX_KEY_HASHED OFF CACHE BOOL "Disable complex key" FORCE)
set(CHDB_DICT_RANGE_HASHED OFF CACHE BOOL "Disable range hashed" FORCE)
set(CHDB_DICT_CACHE OFF CACHE BOOL "Disable cache dict" FORCE)
set(CHDB_DICT_DIRECT OFF CACHE BOOL "Disable direct dict" FORCE)
set(CHDB_DICT_IP_TRIE OFF CACHE BOOL "Disable IP trie" FORCE)
set(CHDB_DICT_POLYGON OFF CACHE BOOL "Disable polygon dict" FORCE)
set(CHDB_DICT_REGEXP OFF CACHE BOOL "Disable regexp dict" FORCE)

# Dictionary sources - all disabled except embedded
set(CHDB_DICT_SOURCE_FILE OFF CACHE BOOL "Disable file source" FORCE)
set(CHDB_DICT_SOURCE_EXECUTABLE OFF CACHE BOOL "Disable exec source" FORCE)
set(CHDB_DICT_SOURCE_HTTP OFF CACHE BOOL "Disable HTTP source" FORCE)
set(CHDB_DICT_SOURCE_MYSQL OFF CACHE BOOL "Disable MySQL source" FORCE)
set(CHDB_DICT_SOURCE_CLICKHOUSE OFF CACHE BOOL "Disable ClickHouse source" FORCE)
set(CHDB_DICT_SOURCE_MONGODB OFF CACHE BOOL "Disable MongoDB source" FORCE)
set(CHDB_DICT_SOURCE_REDIS OFF CACHE BOOL "Disable Redis source" FORCE)
set(CHDB_DICT_SOURCE_CASSANDRA OFF CACHE BOOL "Disable Cassandra source" FORCE)
set(CHDB_DICT_SOURCE_POSTGRESQL OFF CACHE BOOL "Disable PostgreSQL source" FORCE)

message(STATUS "[Dictionaries] Flat/Hashed in-memory only (~200-500KB savings)")

# ============================================================================
# Compression Codecs - LZ4 ONLY
# ============================================================================
# LZ4 is the fastest and has minimal code. Disable all other codecs.
#
# Size savings: ~500KB-1MB

set(CHDB_ULTRA_MINIMAL_COMPRESSION ON CACHE BOOL "LZ4 compression only" FORCE)

# Keep LZ4 (fastest, smallest code)
set(ENABLE_LZ4 ON CACHE BOOL "Enable LZ4" FORCE)

# Disable all other compression
set(ENABLE_ZSTD OFF CACHE BOOL "Disable ZSTD" FORCE)
set(ENABLE_ZLIB OFF CACHE BOOL "Disable zlib" FORCE)
set(ENABLE_BROTLI OFF CACHE BOOL "Disable Brotli" FORCE)
set(ENABLE_SNAPPY OFF CACHE BOOL "Disable Snappy" FORCE)
set(ENABLE_BZIP2 OFF CACHE BOOL "Disable bzip2" FORCE)
set(ENABLE_LZMA OFF CACHE BOOL "Disable LZMA/XZ" FORCE)
set(ENABLE_DENSITY OFF CACHE BOOL "Disable Density" FORCE)
set(ENABLE_LZO OFF CACHE BOOL "Disable LZO" FORCE)
set(ENABLE_QATCODECS OFF CACHE BOOL "Disable QAT codecs" FORCE)

# Disable delta/double-delta/gorilla codecs
set(CHDB_DISABLE_SPECIAL_CODECS ON CACHE BOOL "Disable special codecs" FORCE)

message(STATUS "[Compression] LZ4 only (~500KB-1MB savings)")

# ============================================================================
# Heavy Compute Features - DISABLED
# ============================================================================
# No JIT, no DWARF parsing, no profiling.
#
# Size savings: ~3-5MB (LLVM JIT alone can be ~20MB+, but we already disable it)

set(ENABLE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM JIT" FORCE)
set(USE_EMBEDDED_COMPILER OFF CACHE BOOL "Disable LLVM JIT" FORCE)
set(ENABLE_DWARF_PARSER OFF CACHE BOOL "Disable DWARF" FORCE)

message(STATUS "[Heavy Compute] JIT/DWARF disabled (~3-5MB savings)")

# ============================================================================
# Specialized Libraries - ALL DISABLED
# ============================================================================
# No geospatial, no NLP, no full-text search.
#
# Size savings: ~5-10MB

# Geospatial
set(ENABLE_S2_GEOMETRY OFF CACHE BOOL "Disable S2" FORCE)
set(ENABLE_H3 OFF CACHE BOOL "Disable H3" FORCE)

# Text/NLP
set(ENABLE_ICU OFF CACHE BOOL "Disable ICU" FORCE)
set(ENABLE_VECTORSCAN OFF CACHE BOOL "Disable Vectorscan" FORCE)
set(ENABLE_HYPERSCAN OFF CACHE BOOL "Disable Hyperscan" FORCE)
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP" FORCE)
set(ENABLE_SIMDJSON ON CACHE BOOL "Keep simdjson (small, needed for JSON)" FORCE)
set(ENABLE_RAPIDJSON OFF CACHE BOOL "Disable RapidJSON" FORCE)

# Other libraries
set(ENABLE_RUST OFF CACHE BOOL "Disable Rust components" FORCE)
set(ENABLE_BASE64 OFF CACHE BOOL "Disable base64 lib" FORCE)
set(ENABLE_FASTOPS OFF CACHE BOOL "Disable FastOps" FORCE)
set(ENABLE_LIBURING OFF CACHE BOOL "Disable io_uring" FORCE)
set(ENABLE_USEARCH OFF CACHE BOOL "Disable USearch" FORCE)

# ANTLR (only used for Prometheus query parsing)
set(ENABLE_ANTLR4_CPP_RUNTIME OFF CACHE BOOL "Disable ANTLR4" FORCE)
set(ENABLE_ANTLR4_GRAMMARS OFF CACHE BOOL "Disable ANTLR4 grammars" FORCE)

message(STATUS "[Specialized Libs] ALL DISABLED (~5-10MB savings)")

# ============================================================================
# Memory Allocator - emmalloc (Single-threaded, Smallest)
# ============================================================================
# emmalloc is Emscripten's smallest allocator, designed for single-threaded
# WASM. Saves ~200-500KB over dlmalloc.

set(ENABLE_JEMALLOC OFF CACHE BOOL "Disable jemalloc" FORCE)
set(USE_JEMALLOC OFF CACHE BOOL "Disable jemalloc" FORCE)
set(ENABLE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc" FORCE)
set(USE_TCMALLOC OFF CACHE BOOL "Disable tcmalloc" FORCE)
set(ENABLE_MIMALLOC OFF CACHE BOOL "Disable mimalloc" FORCE)

# Use emmalloc in linker flags
set(CHDB_WASM_MALLOC "emmalloc" CACHE STRING "Use emmalloc" FORCE)

message(STATUS "[Allocator] emmalloc (smallest, single-threaded)")

# ============================================================================
# Threading - DISABLED
# ============================================================================
# Single-threaded only. No SharedArrayBuffer, no pthread overhead.

set(ENABLE_MULTITHREADING OFF CACHE BOOL "Disable threading" FORCE)
set(PARALLEL_COMPILE_JOBS 1 CACHE STRING "" FORCE)
set(PARALLEL_LINK_JOBS 1 CACHE STRING "" FORCE)
set(THREADS_PREFER_PTHREAD_FLAG OFF CACHE BOOL "" FORCE)
set(CMAKE_HAVE_THREADS_LIBRARY OFF CACHE BOOL "" FORCE)
set(CMAKE_USE_PTHREADS_INIT OFF CACHE BOOL "" FORCE)

message(STATUS "[Threading] DISABLED (single-threaded)")

# ============================================================================
# Testing/Development - DISABLED
# ============================================================================
# No tests, no benchmarks, no fuzzing.

set(ENABLE_TESTS OFF CACHE BOOL "Disable tests" FORCE)
set(ENABLE_EXAMPLES OFF CACHE BOOL "Disable examples" FORCE)
set(ENABLE_BENCHMARKS OFF CACHE BOOL "Disable benchmarks" FORCE)
set(ENABLE_UTILS OFF CACHE BOOL "Disable utilities" FORCE)
set(ENABLE_FUZZING OFF CACHE BOOL "Disable fuzzing" FORCE)

message(STATUS "[Testing] DISABLED")

# ============================================================================
# Compiler/Linker Optimizations for Minimal Size
# ============================================================================

# Aggressive size optimization
set(CHDB_WASM_OPT_LEVEL "-Oz" CACHE STRING "Size optimization level" FORCE)

# Compiler flags for minimal size
# Note: ThinLTO disabled due to Emscripten compatibility issues with late-added bitcode
set(CHDB_ULTRA_MINIMAL_COMPILE_FLAGS
    "-Oz"                            # Maximum size optimization
    "-fno-exceptions"                # No exceptions
    "-fno-rtti"                      # No RTTI
    "-fno-unwind-tables"             # No unwind tables
    "-fno-asynchronous-unwind-tables"
    "-fvisibility=hidden"            # Hidden by default
    "-fvisibility-inlines-hidden"
    "-ffunction-sections"            # Enable DCE
    "-fdata-sections"                # Enable DCE
    "-fmerge-all-constants"          # Merge constants
    "-fno-math-errno"                # No math errno
    "-fno-signed-zeros"              # Optimize signed zeros
    "-fno-trapping-math"             # No math traps
    "-fomit-frame-pointer"           # Omit frame pointer
    "-fno-stack-protector"           # No stack protector
    "-fno-ident"                     # No ident strings
    "-fno-threadsafe-statics"        # No thread-safe statics (single-threaded)
    "-DNDEBUG"                       # No debug
)

# WASM feature flags (all modern browsers)
set(CHDB_ULTRA_MINIMAL_WASM_FLAGS
    "-msimd128"                      # SIMD
    "-mbulk-memory"                  # Bulk memory
    "-mnontrapping-fptoint"          # Non-trapping conversions
    "-msign-ext"                     # Sign extension
    "-mmutable-globals"              # Mutable globals
    "-mreference-types"              # Reference types
)

# Linker flags for minimal size
# Note: ThinLTO removed due to Emscripten compatibility issues
# Note: --gc-sections is NOT supported by wasm-ld (emscripten linker)
# Dead code elimination is handled by -Oz and LTO instead
set(CHDB_ULTRA_MINIMAL_LINK_FLAGS
    "-Oz"
    "--closure=1"                    # Closure compiler
    "-sASSERTIONS=0"                 # No assertions
    "-sEVAL_CTORS=2"                 # Aggressive ctor evaluation
    "-sMALLOC=emmalloc"              # Smallest allocator
    "-sELIMINATE_DUPLICATE_FUNCTIONS=1"
    "-sSUPPORT_LONGJMP=0"            # No longjmp
    "-sDISABLE_EXCEPTION_CATCHING=1" # No exceptions
    "-sABORTING_MALLOC=0"            # Graceful malloc failure
    "-sNO_EXIT_RUNTIME=1"
    "-sINLINING_LIMIT=1"             # Minimal inlining
    "-sTEXTDECODER=2"                # Use TextDecoder (smaller than manual)
    "-sIGNORE_MISSING_MAIN=1"        # No main required
)

message(STATUS "[Optimization] -Oz, Thin LTO, Closure Compiler")

# ============================================================================
# Memory Configuration - Minimal for Cloudflare Workers
# ============================================================================
# Cloudflare Workers: 128MB memory limit
# Start small, grow as needed

set(CHDB_ULTRA_MINIMAL_INITIAL_MEMORY "16777216" CACHE STRING "16MB initial" FORCE)
set(CHDB_ULTRA_MINIMAL_MAXIMUM_MEMORY "134217728" CACHE STRING "128MB max" FORCE)
set(CHDB_ULTRA_MINIMAL_STACK_SIZE "524288" CACHE STRING "512KB stack" FORCE)

set(CHDB_ULTRA_MINIMAL_MEMORY_FLAGS
    "-sINITIAL_MEMORY=${CHDB_ULTRA_MINIMAL_INITIAL_MEMORY}"
    "-sMAXIMUM_MEMORY=${CHDB_ULTRA_MINIMAL_MAXIMUM_MEMORY}"
    "-sSTACK_SIZE=${CHDB_ULTRA_MINIMAL_STACK_SIZE}"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sMEMORY_GROWTH_GEOMETRIC_STEP=0.20"
    "-sMEMORY_GROWTH_GEOMETRIC_CAP=67108864"  # 64MB cap per growth
)

message(STATUS "[Memory] 16MB initial, 128MB max, 512KB stack")

# ============================================================================
# Output Configuration
# ============================================================================

set(CHDB_ULTRA_MINIMAL_OUTPUT_FLAGS
    "-sWASM=1"
    "-sWASM_BIGINT=1"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME='createChDBUltraMinimal'"
    "-sENVIRONMENT='web,worker'"
    "-sSINGLE_FILE=0"                # Separate .wasm for caching
    "-sNO_FILESYSTEM=1"              # No filesystem (pure memory)
    "-sFILESYSTEM=0"                 # No filesystem
)

# Minimal exports - must match all exported symbols in wasm/chdb_wasm.cpp
set(CHDB_ULTRA_MINIMAL_EXPORTS
    "_malloc"
    "_free"
    "_chdb_query"
    "_chdb_query_v2"
    "_chdb_create"
    "_chdb_destroy"
    "_chdb_get_version"
    "_chdb_get_memory_stats"
    "_chdb_clear_cache"
    "_chdb_embedded_server_initialized"
    "_chdb_wasm_init"
    "_chdb_wasm_shutdown"
    "_chdb_wasm_query"
    "_chdb_wasm_query_n"
    "_chdb_wasm_result_create"
    "_chdb_wasm_result_free"
    "_chdb_wasm_result_buffer"
    "_chdb_wasm_result_length"
    "_chdb_wasm_result_elapsed"
    "_chdb_wasm_result_rows_read"
    "_chdb_wasm_result_bytes_read"
    "_chdb_wasm_result_error"
    "_chdb_wasm_is_initialized"
    "_chdb_wasm_malloc"
    "_chdb_wasm_free"
    "_chdb_wasm_version"
)

message(STATUS "[Output] ES6 module, no filesystem, minimal exports")

# ============================================================================
# Apply Ultra-Minimal Profile Function
# ============================================================================

function(chdb_apply_ultra_minimal_settings TARGET)
    message(STATUS "Applying ULTRA-MINIMAL settings to target: ${TARGET}")

    # Compile options
    target_compile_options(${TARGET} PRIVATE
        ${CHDB_ULTRA_MINIMAL_COMPILE_FLAGS}
        ${CHDB_ULTRA_MINIMAL_WASM_FLAGS}
    )

    # Compile definitions
    target_compile_definitions(${TARGET} PRIVATE
        CHDB_WASM=1
        CHDB_ULTRA_MINIMAL=1
        CHDB_SINGLE_THREADED=1
        NDEBUG=1
        # Disable specific features at compile time
        CHDB_DISABLE_MERGETREE=1
        CHDB_DISABLE_DISTRIBUTED=1
        CHDB_DISABLE_PARQUET=1
        CHDB_DISABLE_ARROW=1
        CHDB_DISABLE_GEO=1
        CHDB_DISABLE_NLP=1
        CHDB_DISABLE_ML=1
    )

    # Link options
    target_link_options(${TARGET} PRIVATE
        ${CHDB_ULTRA_MINIMAL_LINK_FLAGS}
        ${CHDB_ULTRA_MINIMAL_MEMORY_FLAGS}
        ${CHDB_ULTRA_MINIMAL_OUTPUT_FLAGS}
    )

    # Export configuration
    list(JOIN CHDB_ULTRA_MINIMAL_EXPORTS "','" EXPORTS_STR)
    target_link_options(${TARGET} PRIVATE
        "-sEXPORTED_FUNCTIONS=['${EXPORTS_STR}']"
        "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8']"
    )

    # Output properties
    set_target_properties(${TARGET} PROPERTIES
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist/ultra-minimal"
    )
endfunction()

# ============================================================================
# Ultra-Minimal Function Whitelist
# ============================================================================
# The absolute minimum functions needed for basic SQL.

set(CHDB_ULTRA_MINIMAL_FUNCTION_LIST
    # Infrastructure
    "IFunction"
    "FunctionFactory"
    "FunctionHelpers"

    # Arithmetic: +, -, *, /, %
    "plus"
    "minus"
    "multiply"
    "divide"
    "modulo"
    "negate"
    "abs"

    # Comparison: =, !=, <, >, <=, >=
    "equals"
    "notEquals"
    "less"
    "lessOrEquals"
    "greater"
    "greaterOrEquals"

    # Logical: AND, OR, NOT, IF
    "and"
    "or"
    "not"
    "if"

    # Null handling
    "isNull"
    "isNotNull"
    "coalesce"
    "ifNull"

    # Type conversion
    "CAST"
    "toString"
    "toInt32"
    "toInt64"
    "toFloat64"

    # String basics
    "length"
    "substring"
    "concat"
    "lower"
    "upper"
    "trim"
)

set(CHDB_ULTRA_MINIMAL_AGGREGATE_LIST
    # Only these 5 aggregates
    "count"
    "sum"
    "avg"
    "min"
    "max"
)

# ============================================================================
# Size Budget Summary
# ============================================================================

message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  ULTRA-MINIMAL Size Budget Estimation")
message(STATUS "================================================================")
message(STATUS "")
message(STATUS "TARGET: <40MB uncompressed, <10MB gzipped")
message(STATUS "")
message(STATUS "RESEARCH INSIGHTS:")
message(STATUS "  - ClickHouse code section: 117MB (5.13x larger than DuckDB's 22MB)")
message(STATUS "  - ClickHouse functions:    142,075 (vs DuckDB's 60,116)")
message(STATUS "  - Average function size:   868 bytes (vs DuckDB's 399 bytes)")
message(STATUS "")
message(STATUS "Component                  | Enabled | Est. Size")
message(STATUS "---------------------------+---------+----------")
message(STATUS "Core SQL Engine/Parser     | YES     | ~15-20 MB")
message(STATUS "Memory Storage Engine      | YES     | ~50 KB")
message(STATUS "Log Storage Engine         | YES     | ~100 KB")
message(STATUS "Basic Functions            | YES     | ~2-3 MB")
message(STATUS "Basic Aggregates           | YES     | ~500 KB")
message(STATUS "JSON/CSV/TSV Formats       | YES     | ~1 MB")
message(STATUS "LZ4 Compression            | YES     | ~100 KB")
message(STATUS "simdjson                   | YES     | ~200 KB")
message(STATUS "emmalloc                   | YES     | ~50 KB")
message(STATUS "WASM Runtime/Glue          | YES     | ~500 KB")
message(STATUS "---------------------------+---------+----------")
message(STATUS "TOTAL ESTIMATED            |         | ~20-30 MB")
message(STATUS "With LTO/DCE optimization  |         | ~15-25 MB")
message(STATUS "Gzipped                    |         | ~5-8 MB")
message(STATUS "")
message(STATUS "DISABLED Components (total potential savings: ~80-150MB):")
message(STATUS "  Cloud Storage (S3/GCS/Azure/HDFS)    | ~40-60 MB")
message(STATUS "  External DBs (MySQL/PG/MongoDB/etc)  | ~10-20 MB")
message(STATUS "  Heavy formats (Parquet/Arrow/ORC)    | ~20-35 MB")
message(STATUS "  MergeTree family                     | ~4-6 MB")
message(STATUS "  LLVM JIT compiler                    | ~10-20 MB")
message(STATUS "  Complex functions (Geo/NLP/ML)       | ~5-10 MB")
message(STATUS "  Specialized libs (ICU/Vectorscan)    | ~5-10 MB")
message(STATUS "  Distributed/clustering               | ~2-3 MB")
message(STATUS "  Compression (ZSTD/Brotli/etc)        | ~1-2 MB")
message(STATUS "  Threading support                    | ~200 KB")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "")

# ============================================================================
# Validation
# ============================================================================

function(chdb_validate_ultra_minimal)
    # Verify critical settings
    if(ENABLE_PARQUET)
        message(WARNING "ULTRA-MINIMAL: Parquet should be disabled!")
    endif()
    if(ENABLE_AWS_S3)
        message(WARNING "ULTRA-MINIMAL: S3 should be disabled!")
    endif()
    if(ENABLE_JEMALLOC OR USE_JEMALLOC)
        message(WARNING "ULTRA-MINIMAL: jemalloc should be disabled!")
    endif()
    if(ENABLE_EMBEDDED_COMPILER)
        message(WARNING "ULTRA-MINIMAL: JIT compiler should be disabled!")
    endif()
    if(ENABLE_MULTITHREADING)
        message(WARNING "ULTRA-MINIMAL: Multithreading should be disabled!")
    endif()

    message(STATUS "Ultra-minimal profile validation complete")
endfunction()

# Run validation
chdb_validate_ultra_minimal()

# ============================================================================
# ADDITIONAL AGGRESSIVE DISABLES (from CMakeLists.txt analysis)
# ============================================================================
# These options were found in vendor/chdb/CMakeLists.txt and contrib/

# From vendor/chdb/CMakeLists.txt
set(ENABLE_MULTITARGET_CODE OFF CACHE BOOL "Disable multi-target SIMD code" FORCE)
set(ENABLE_FIU OFF CACHE BOOL "Disable Fault Injection Unit" FORCE)
set(WERROR OFF CACHE BOOL "Disable -Werror for WASM" FORCE)
set(ENABLE_CHECK_HEAVY_BUILDS OFF CACHE BOOL "Disable heavy build checks" FORCE)
set(ENABLE_BUILD_PROFILING OFF CACHE BOOL "Disable build profiling" FORCE)
set(ENABLE_COLORED_BUILD OFF CACHE BOOL "Disable colored output" FORCE)
set(GLIBC_COMPATIBILITY OFF CACHE BOOL "Disable glibc compatibility" FORCE)
set(BUILD_STANDALONE_KEEPER OFF CACHE BOOL "Disable standalone Keeper" FORCE)
set(SPLIT_DEBUG_SYMBOLS OFF CACHE BOOL "No debug symbol splitting" FORCE)
set(BUILD_STRIPPED_BINARY ON CACHE BOOL "Build stripped binary" FORCE)
set(OMIT_HEAVY_DEBUG_SYMBOLS ON CACHE BOOL "Omit heavy debug symbols" FORCE)
set(ENABLE_THINLTO OFF CACHE BOOL "Disable ThinLTO (use regular LTO)" FORCE)

# From vendor/chdb/contrib/CMakeLists.txt
set(ENABLE_FASTPFOR OFF CACHE BOOL "Disable FastPFOR integer compression" FORCE)
set(ENABLE_QATLIB OFF CACHE BOOL "Disable Intel QATLib" FORCE)
set(ENABLE_QPL OFF CACHE BOOL "Disable Intel QPL" FORCE)
set(ENABLE_QAT_USDM_DRIVER OFF CACHE BOOL "Disable QAT USDM driver" FORCE)

# From vendor/chdb/contrib/llvm-project-cmake/CMakeLists.txt
set(ENABLE_BLAKE3 OFF CACHE BOOL "Disable BLAKE3 (uses LLVM)" FORCE)

# From vendor/chdb/contrib/arrow-cmake/CMakeLists.txt
set(ENABLE_PARQUET OFF CACHE BOOL "Disable Apache Parquet" FORCE)

# From vendor/chdb/contrib/CMakeLists.txt line 156
set(ENABLE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL" FORCE)
set(USE_LIBPQXX OFF CACHE BOOL "Disable PostgreSQL" FORCE)

# From vendor/chdb/contrib/CMakeLists.txt line 170
set(USE_MONGODB OFF CACHE BOOL "Disable MongoDB" FORCE)

# From vendor/chdb/contrib/CMakeLists.txt line 176
set(ENABLE_NLP OFF CACHE BOOL "Disable NLP functions" FORCE)

# From vendor/chdb/contrib/CMakeLists.txt line 227
set(ENABLE_USEARCH OFF CACHE BOOL "Disable USearch vector search" FORCE)

# From vendor/chdb/contrib/CMakeLists.txt line 257
set(ENABLE_GOOGLE_CLOUD_CPP OFF CACHE BOOL "Disable Google Cloud" FORCE)

# From vendor/chdb/contrib/CMakeLists.txt line 274
set(ENABLE_FASTPFOR OFF CACHE BOOL "Disable FastPFOR" FORCE)

# Disable Thrift (used by Parquet/Hive)
set(ENABLE_THRIFT OFF CACHE BOOL "Disable Apache Thrift" FORCE)

# Disable Delta Lake
set(ENABLE_DELTA_LAKE OFF CACHE BOOL "Disable Delta Lake" FORCE)
set(ENABLE_DELTA_KERNEL_RS OFF CACHE BOOL "Disable Delta Kernel RS" FORCE)

# Disable data lake integrations
set(ENABLE_ICEBERG OFF CACHE BOOL "Disable Iceberg" FORCE)
set(ENABLE_HUDI OFF CACHE BOOL "Disable Hudi" FORCE)

# Disable XML support
set(ENABLE_LIBXML2 OFF CACHE BOOL "Disable libxml2" FORCE)

# Disable archive support
set(ENABLE_LIBARCHIVE OFF CACHE BOOL "Disable libarchive" FORCE)

# Additional WASM-specific optimizations
set(CMAKE_BUILD_TYPE "MinSizeRel" CACHE STRING "Use MinSizeRel for smallest binary" FORCE)

# Threads stub for WASM (no real threading)
set(CMAKE_THREAD_LIBS_INIT "" CACHE STRING "" FORCE)
set(CMAKE_HAVE_THREADS_LIBRARY 1 CACHE BOOL "" FORCE)
set(CMAKE_USE_WIN32_THREADS_INIT 0 CACHE BOOL "" FORCE)
set(CMAKE_USE_PTHREADS_INIT 0 CACHE BOOL "" FORCE)
set(Threads_FOUND TRUE CACHE BOOL "" FORCE)

# WASM-specific compile definitions
add_compile_definitions(POCO_NO_LINUX_IF_PACKET_H=1)
add_compile_definitions(POCO_NO_INOTIFY=1)
add_compile_definitions(CHDB_WASM=1)
add_compile_definitions(CHDB_ULTRA_MINIMAL=1)
add_compile_definitions(NDEBUG=1)

# Global compile flags for WASM
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wno-c++11-narrowing -Wno-error" CACHE STRING "" FORCE)
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wno-c++11-narrowing -Wno-error" CACHE STRING "" FORCE)

message(STATUS "[Additional] All discovered optional features DISABLED")
message(STATUS "")
message(STATUS "================================================================")
message(STATUS "  Ultra-Minimal Configuration Complete")
message(STATUS "  Run: cmake -C cmake/wasm-ultra-minimal.cmake ...")
message(STATUS "================================================================")
message(STATUS "")
