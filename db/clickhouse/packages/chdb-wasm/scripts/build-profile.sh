#!/bin/bash
# build-profile.sh
# Multi-profile build script for chdb-wasm
#
# This script builds chdb-wasm with a specified profile configuration.
# Each profile targets different use cases with varying feature sets and sizes.
#
# Usage:
#   ./scripts/build-profile.sh <profile> [OPTIONS]
#
# Profiles:
#   core       Parser/Lexer only (~50KB) - SQL validation, AST generation
#   minimal    Memory engine + basics (~5-10MB) - Simple in-memory analytics
#   standard   + MergeTree + Parquet (~15-25MB) - Typical OLAP workloads
#   analytics  + Window funcs + full aggs (~30-40MB) - Complex analytics
#   full       All WASM-compatible features (~50MB+) - Maximum compatibility
#
# Options:
#   --clean         Clean build directory before building
#   --release       Build in Release mode (default)
#   --debug         Build in Debug mode
#   --verbose       Enable verbose build output
#   --dry-run       Print commands without executing
#   --jobs N        Number of parallel build jobs (default: auto)
#   --no-opt        Skip wasm-opt post-processing
#   --list          List all available profiles
#   --compare       Show feature comparison between profiles
#   --help, -h      Show this help message
#
# Examples:
#   ./scripts/build-profile.sh minimal              # Build minimal profile
#   ./scripts/build-profile.sh standard --clean     # Clean build of standard
#   ./scripts/build-profile.sh analytics --verbose  # Verbose analytics build
#   ./scripts/build-profile.sh --list               # List all profiles
#   ./scripts/build-profile.sh --compare            # Compare profile features
#
# Environment Variables:
#   EMSDK           Path to Emscripten SDK
#   BUILD_TYPE      CMake build type (Release, Debug)
#   JOBS            Number of parallel build jobs

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CMAKE_DIR="${PROJECT_ROOT}/cmake"
DIST_DIR="${PROJECT_ROOT}/dist"

# Default options
BUILD_TYPE="${BUILD_TYPE:-Release}"
CLEAN_BUILD=false
VERBOSE=false
DRY_RUN=false
SKIP_WASM_OPT=false
LIST_PROFILES=false
COMPARE_PROFILES=false
JOBS="${JOBS:-}"
PROFILE=""

# Valid profiles
VALID_PROFILES=("core" "minimal" "standard" "analytics" "full")

# ============================================================================
# Color Output
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_section() {
    echo ""
    echo -e "${CYAN}${BOLD}=== $1 ===${NC}"
    echo ""
}

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
    head -42 "$0" | tail -37
    exit 0
}

show_profiles() {
    echo ""
    echo -e "${BOLD}Available Build Profiles${NC}"
    echo ""
    echo -e "  ${CYAN}core${NC}       Parser/Lexer only"
    echo -e "             Target: ~50KB uncompressed, ~15KB gzipped"
    echo -e "             Use case: SQL validation, AST generation, syntax checking"
    echo ""
    echo -e "  ${CYAN}minimal${NC}    Memory engine + basic functions"
    echo -e "             Target: ~5-10MB uncompressed, ~2-3MB gzipped"
    echo -e "             Use case: Simple in-memory analytics, data exploration"
    echo ""
    echo -e "  ${CYAN}standard${NC}   + MergeTree + Parquet + Date/Time"
    echo -e "             Target: ~15-25MB uncompressed, ~5-8MB gzipped"
    echo -e "             Use case: Typical OLAP workloads with persistence"
    echo ""
    echo -e "  ${CYAN}analytics${NC}  + Window functions + full aggregates + arrays"
    echo -e "             Target: ~30-40MB uncompressed, ~10-15MB gzipped"
    echo -e "             Use case: Complex analytics, BI tools, data science"
    echo ""
    echo -e "  ${CYAN}full${NC}       All WASM-compatible features"
    echo -e "             Target: ~50MB+ uncompressed, ~15-20MB gzipped"
    echo -e "             Use case: Maximum ClickHouse compatibility"
    echo ""
    exit 0
}

show_comparison() {
    echo ""
    echo -e "${BOLD}Profile Feature Comparison${NC}"
    echo ""
    echo "Feature                  | core | minimal | standard | analytics | full"
    echo "-------------------------+------+---------+----------+-----------+------"
    echo "Parser/Lexer             |  Y   |    Y    |    Y     |     Y     |  Y"
    echo "Query Execution          |  -   |    Y    |    Y     |     Y     |  Y"
    echo "Memory Engine            |  -   |    Y    |    Y     |     Y     |  Y"
    echo "MergeTree Engine         |  -   |    -    |    Y     |     Y     |  Y"
    echo "System Tables            |  -   |    -    |    Y     |     Y     |  Y"
    echo "JSON/CSV Formats         |  -   |    Y    |    Y     |     Y     |  Y"
    echo "Parquet Format           |  -   |    -    |    Y     |     Y     |  Y"
    echo "Avro/Protobuf Formats    |  -   |    -    |    -     |     -     |  Y"
    echo "Basic Functions          |  -   |    Y    |    Y     |     Y     |  Y"
    echo "Date/Time Functions      |  -   |    -    |    Y     |     Y     |  Y"
    echo "Array/Map Functions      |  -   |    -    |    -     |     Y     |  Y"
    echo "Window Functions         |  -   |    -    |    -     |     Y     |  Y"
    echo "Statistical Aggregates   |  -   |    -    |    -     |     Y     |  Y"
    echo "Geo Functions            |  -   |    -    |    -     |     -     |  Y"
    echo "ML Functions             |  -   |    -    |    -     |     -     |  Y"
    echo "CTEs (WITH clause)       |  -   |    -    |    Y     |     Y     |  Y"
    echo "UNION                    |  -   |    -    |    Y     |     Y     |  Y"
    echo "Advanced JOINs           |  -   |    -    |    -     |     Y     |  Y"
    echo ""
    echo "Y = Included, - = Not included"
    echo ""
    echo -e "${BOLD}Size Targets${NC}"
    echo ""
    echo "Profile    | Uncompressed | Gzipped"
    echo "-----------+--------------+---------"
    echo "core       | ~50KB        | ~15KB"
    echo "minimal    | ~5-10MB      | ~2-3MB"
    echo "standard   | ~15-25MB     | ~5-8MB"
    echo "analytics  | ~30-40MB     | ~10-15MB"
    echo "full       | ~50MB+       | ~15-20MB"
    echo ""
    exit 0
}

run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo -e "${YELLOW}[DRY-RUN]${NC} $*"
        return 0
    else
        if [ "$VERBOSE" = true ]; then
            echo -e "${CYAN}[RUN]${NC} $*"
        fi
        "$@"
    fi
}

get_cpu_count() {
    if [ -n "$JOBS" ]; then
        echo "$JOBS"
    elif command -v nproc &> /dev/null; then
        nproc
    elif command -v sysctl &> /dev/null; then
        sysctl -n hw.ncpu 2>/dev/null || echo 4
    else
        echo 4
    fi
}

get_file_size() {
    local file="$1"
    if [ -f "$file" ]; then
        if stat --version &>/dev/null 2>&1; then
            stat -c%s "$file" 2>/dev/null || echo 0
        else
            stat -f%z "$file" 2>/dev/null || echo 0
        fi
    else
        echo 0
    fi
}

format_size() {
    local size="$1"
    if [ "$size" -lt 1024 ]; then
        echo "${size}B"
    elif [ "$size" -lt 1048576 ]; then
        echo "$(( size / 1024 ))KB"
    else
        echo "$(( size / 1048576 ))MB"
    fi
}

is_valid_profile() {
    local profile="$1"
    for valid in "${VALID_PROFILES[@]}"; do
        if [ "$profile" = "$valid" ]; then
            return 0
        fi
    done
    return 1
}

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --release)
            BUILD_TYPE="Release"
            shift
            ;;
        --debug)
            BUILD_TYPE="Debug"
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --jobs)
            JOBS="$2"
            shift 2
            ;;
        --no-opt)
            SKIP_WASM_OPT=true
            shift
            ;;
        --list)
            LIST_PROFILES=true
            shift
            ;;
        --compare)
            COMPARE_PROFILES=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        -*)
            log_error "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
        *)
            if [ -z "$PROFILE" ]; then
                PROFILE="$1"
            else
                log_error "Multiple profiles specified: $PROFILE and $1"
                exit 1
            fi
            shift
            ;;
    esac
done

# Handle list/compare options
if [ "$LIST_PROFILES" = true ]; then
    show_profiles
fi

if [ "$COMPARE_PROFILES" = true ]; then
    show_comparison
fi

# Validate profile
if [ -z "$PROFILE" ]; then
    log_error "No profile specified"
    echo ""
    echo "Usage: $0 <profile> [options]"
    echo ""
    echo "Available profiles: ${VALID_PROFILES[*]}"
    echo ""
    echo "Use --help for more information"
    exit 1
fi

if ! is_valid_profile "$PROFILE"; then
    log_error "Invalid profile: $PROFILE"
    echo ""
    echo "Available profiles: ${VALID_PROFILES[*]}"
    echo ""
    echo "Use --list for profile descriptions"
    exit 1
fi

# Set build directory based on profile
BUILD_DIR="${PROJECT_ROOT}/build-${PROFILE}"

# ============================================================================
# Header
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  chdb-wasm Profile Builder${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
echo -e "  Profile:        ${MAGENTA}${BOLD}${PROFILE}${NC}"
echo -e "  Build Type:     ${BUILD_TYPE}"
echo -e "  Build Dir:      ${BUILD_DIR}"
echo -e "  CPU Jobs:       $(get_cpu_count)"
echo ""

# Show profile description
case $PROFILE in
    core)
        echo -e "  ${CYAN}Description:${NC}    Parser/Lexer only"
        echo -e "  ${CYAN}Target Size:${NC}    ~50KB uncompressed, ~15KB gzipped"
        echo -e "  ${CYAN}Use Case:${NC}       SQL validation, AST generation"
        ;;
    minimal)
        echo -e "  ${CYAN}Description:${NC}    Memory engine + basic functions"
        echo -e "  ${CYAN}Target Size:${NC}    ~5-10MB uncompressed, ~2-3MB gzipped"
        echo -e "  ${CYAN}Use Case:${NC}       Simple in-memory analytics"
        ;;
    standard)
        echo -e "  ${CYAN}Description:${NC}    + MergeTree + Parquet + Date/Time"
        echo -e "  ${CYAN}Target Size:${NC}    ~15-25MB uncompressed, ~5-8MB gzipped"
        echo -e "  ${CYAN}Use Case:${NC}       Typical OLAP workloads"
        ;;
    analytics)
        echo -e "  ${CYAN}Description:${NC}    + Window functions + full aggregates"
        echo -e "  ${CYAN}Target Size:${NC}    ~30-40MB uncompressed, ~10-15MB gzipped"
        echo -e "  ${CYAN}Use Case:${NC}       Complex analytics, BI tools"
        ;;
    full)
        echo -e "  ${CYAN}Description:${NC}    All WASM-compatible features"
        echo -e "  ${CYAN}Target Size:${NC}    ~50MB+ uncompressed, ~15-20MB gzipped"
        echo -e "  ${CYAN}Use Case:${NC}       Maximum compatibility"
        ;;
esac
echo ""

# ============================================================================
# Emscripten SDK Setup
# ============================================================================

log_section "Emscripten SDK Setup"

find_emsdk() {
    if [ -n "${EMSDK}" ] && [ -d "${EMSDK}" ]; then
        echo "${EMSDK}"
        return 0
    fi

    local EMSDK_PATHS=(
        "${HOME}/emsdk"
        "/opt/emsdk"
        "/usr/local/emsdk"
        "${HOME}/.emsdk"
        "/emsdk"
    )

    for path in "${EMSDK_PATHS[@]}"; do
        if [ -f "${path}/emsdk_env.sh" ]; then
            echo "${path}"
            return 0
        fi
    done

    return 1
}

setup_emsdk() {
    local emsdk_path

    log_info "Searching for Emscripten SDK..."

    if ! emsdk_path=$(find_emsdk); then
        log_error "Emscripten SDK not found!"
        echo ""
        echo "Please install Emscripten SDK:"
        echo "  git clone https://github.com/emscripten-core/emsdk.git"
        echo "  cd emsdk"
        echo "  ./emsdk install latest"
        echo "  ./emsdk activate latest"
        echo "  source ./emsdk_env.sh"
        exit 1
    fi

    log_info "Found Emscripten SDK at: ${emsdk_path}"

    # Source the environment
    log_info "Sourcing emsdk_env.sh..."
    # shellcheck source=/dev/null
    source "${emsdk_path}/emsdk_env.sh" 2>/dev/null || {
        log_error "Failed to source emsdk_env.sh"
        exit 1
    }

    if ! command -v emcc &> /dev/null; then
        log_error "emcc not found after sourcing emsdk_env.sh"
        exit 1
    fi

    local emcc_version
    emcc_version=$(emcc --version | head -n1)
    log_success "Emscripten ready: ${emcc_version}"

    export EMSDK="${emsdk_path}"
    export EMSCRIPTEN="${EMSDK}/upstream/emscripten"
}

setup_emsdk

# ============================================================================
# Clean Build Directory
# ============================================================================

if [ "$CLEAN_BUILD" = true ]; then
    log_section "Cleaning Build Directory"

    if [ -d "${BUILD_DIR}" ]; then
        log_info "Removing ${BUILD_DIR}..."
        run_cmd rm -rf "${BUILD_DIR}"
    fi

    log_success "Clean complete"
fi

# ============================================================================
# Create Build Directory
# ============================================================================

log_section "Preparing Build Directory"

run_cmd mkdir -p "${BUILD_DIR}"
log_info "Build directory ready: ${BUILD_DIR}"

# ============================================================================
# Configure CMake
# ============================================================================

log_section "CMake Configuration"

TOOLCHAIN_FILE="${EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"

if [ ! -f "${TOOLCHAIN_FILE}" ]; then
    log_error "Emscripten CMake toolchain not found at: ${TOOLCHAIN_FILE}"
    exit 1
fi

log_info "Using toolchain: ${TOOLCHAIN_FILE}"

# Build CMake arguments
CMAKE_ARGS=(
    # Include the build profiles configuration
    "-C" "${CMAKE_DIR}/build-profiles.cmake"

    # Set the profile
    "-DCHDB_PROFILE=${PROFILE}"

    # Toolchain
    "-DCMAKE_TOOLCHAIN_FILE=${TOOLCHAIN_FILE}"

    # Build configuration
    "-DCMAKE_BUILD_TYPE=${BUILD_TYPE}"

    # Source and build directories
    "-S" "${PROJECT_ROOT}"
    "-B" "${BUILD_DIR}"
)

# Add verbose flag if requested
if [ "$VERBOSE" = true ]; then
    CMAKE_ARGS+=("-DCMAKE_VERBOSE_MAKEFILE=ON")
fi

# Profile-specific CMake options
case $PROFILE in
    core)
        CMAKE_ARGS+=(
            "-DCHDB_WASM_BUILD_FULL=OFF"
            "-DCHDB_WASM_BUILD_LEXER=ON"
            "-DCHDB_WASM_BUILD_PARSER=ON"
        )
        ;;
    minimal)
        CMAKE_ARGS+=(
            "-DCHDB_WASM_BUILD_FULL=ON"
            "-DBUILD_MINIMAL=ON"
            "-DBUILD_ULTRA_MINIMAL=OFF"
        )
        ;;
    standard)
        CMAKE_ARGS+=(
            "-DCHDB_WASM_BUILD_FULL=ON"
            "-DBUILD_MINIMAL=OFF"
            "-DENABLE_PARQUET=ON"
        )
        ;;
    analytics)
        CMAKE_ARGS+=(
            "-DCHDB_WASM_BUILD_FULL=ON"
            "-DBUILD_MINIMAL=OFF"
            "-DENABLE_PARQUET=ON"
        )
        ;;
    full)
        CMAKE_ARGS+=(
            "-DCHDB_WASM_BUILD_FULL=ON"
            "-DBUILD_MINIMAL=OFF"
            "-DENABLE_PARQUET=ON"
            "-DENABLE_AVRO=ON"
            "-DENABLE_PROTOBUF=ON"
        )
        ;;
esac

# Display configuration
log_info "CMake configuration:"
for arg in "${CMAKE_ARGS[@]}"; do
    echo "    ${arg}"
done
echo ""

# Run CMake configure
log_info "Running CMake configure..."
run_cmd cmake "${CMAKE_ARGS[@]}"

if [ "$DRY_RUN" = false ]; then
    log_success "CMake configuration complete"
fi

# ============================================================================
# Build
# ============================================================================

log_section "Building chdb-wasm (${PROFILE} profile)"

CPU_COUNT=$(get_cpu_count)
log_info "Building with ${CPU_COUNT} parallel jobs..."

BUILD_ARGS=(
    "--build" "${BUILD_DIR}"
    "--parallel" "${CPU_COUNT}"
)

if [ "$VERBOSE" = true ]; then
    BUILD_ARGS+=("--verbose")
fi

# Build appropriate targets based on profile
if [ "$PROFILE" = "core" ]; then
    BUILD_ARGS+=("--target" "lexer-module" "--target" "parser-module")
fi

run_cmd cmake "${BUILD_ARGS[@]}"

if [ "$DRY_RUN" = false ]; then
    log_success "Build complete"
fi

# ============================================================================
# Post-Build Optimization (wasm-opt)
# ============================================================================

if [ "$SKIP_WASM_OPT" = false ] && [ "$DRY_RUN" = false ]; then
    log_section "WASM Optimization"

    WASM_OPT=""
    if command -v wasm-opt &> /dev/null; then
        WASM_OPT="wasm-opt"
    elif [ -f "${EMSDK}/upstream/bin/wasm-opt" ]; then
        WASM_OPT="${EMSDK}/upstream/bin/wasm-opt"
    fi

    if [ -n "$WASM_OPT" ]; then
        log_info "Using wasm-opt: ${WASM_OPT}"

        WASM_FILES=$(find "${BUILD_DIR}" -name "*.wasm" -type f 2>/dev/null || true)

        for wasm_file in $WASM_FILES; do
            if [ -f "$wasm_file" ]; then
                log_info "Optimizing: $(basename "$wasm_file")"

                ORIG_SIZE=$(get_file_size "$wasm_file")

                # Optimization flags based on profile
                OPT_FLAGS="-Oz"
                if [ "$PROFILE" = "core" ]; then
                    # Most aggressive for core profile
                    OPT_FLAGS="-Oz --converge"
                fi

                "$WASM_OPT" \
                    $OPT_FLAGS \
                    --enable-bulk-memory \
                    --enable-sign-ext \
                    --enable-nontrapping-float-to-int \
                    --strip-debug \
                    --strip-dwarf \
                    --strip-producers \
                    --vacuum \
                    --duplicate-function-elimination \
                    --duplicate-import-elimination \
                    --remove-unused-module-elements \
                    --remove-unused-names \
                    "$wasm_file" \
                    -o "${wasm_file}.opt" 2>/dev/null || {
                        log_warn "wasm-opt optimization failed for $(basename "$wasm_file")"
                        continue
                    }

                mv "${wasm_file}.opt" "$wasm_file"

                NEW_SIZE=$(get_file_size "$wasm_file")

                if [ "$ORIG_SIZE" -gt 0 ]; then
                    SAVED=$((ORIG_SIZE - NEW_SIZE))
                    PERCENT=$((SAVED * 100 / ORIG_SIZE))
                    log_success "  Size reduced by $(format_size $SAVED) (${PERCENT}%)"
                fi
            fi
        done
    else
        log_warn "wasm-opt not found, skipping additional optimization"
    fi
fi

# ============================================================================
# Copy to Distribution Directory
# ============================================================================

if [ "$DRY_RUN" = false ]; then
    log_section "Distribution Files"

    DIST_PROFILE_DIR="${DIST_DIR}/${PROFILE}"
    run_cmd mkdir -p "${DIST_PROFILE_DIR}"

    # Find and copy output files
    JS_FILES=$(find "${BUILD_DIR}" -maxdepth 3 -name "*.js" -type f 2>/dev/null || true)
    WASM_FILES=$(find "${BUILD_DIR}" -maxdepth 3 -name "*.wasm" -type f 2>/dev/null || true)

    for file in $JS_FILES $WASM_FILES; do
        if [ -f "$file" ]; then
            cp "$file" "${DIST_PROFILE_DIR}/"
            log_info "Copied: $(basename "$file")"
        fi
    done

    # Create package.json for the profile
    cat > "${DIST_PROFILE_DIR}/package.json" << EOF
{
  "name": "@chdb/wasm-${PROFILE}",
  "version": "1.0.0",
  "description": "chdb WebAssembly build (${PROFILE} profile)",
  "main": "chdb.js",
  "types": "chdb.d.ts",
  "exports": {
    ".": {
      "import": "./chdb.js",
      "types": "./chdb.d.ts"
    }
  },
  "files": [
    "*.js",
    "*.wasm",
    "*.d.ts"
  ],
  "keywords": ["clickhouse", "wasm", "sql", "database", "olap", "${PROFILE}"],
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/chdb-io/chdb-wasm"
  },
  "chdb": {
    "profile": "${PROFILE}",
    "features": $(
        case $PROFILE in
            core)
                echo '["parser", "lexer", "ast"]'
                ;;
            minimal)
                echo '["parser", "lexer", "memory-engine", "json", "csv", "basic-functions"]'
                ;;
            standard)
                echo '["parser", "lexer", "memory-engine", "mergetree", "json", "csv", "parquet", "datetime", "cte", "union"]'
                ;;
            analytics)
                echo '["parser", "lexer", "memory-engine", "mergetree", "json", "csv", "parquet", "datetime", "window-functions", "full-aggregates", "arrays", "maps"]'
                ;;
            full)
                echo '["parser", "lexer", "memory-engine", "mergetree", "all-formats", "all-functions", "geo", "ml"]'
                ;;
        esac
    )
  }
}
EOF

    log_info "Created package.json"

    # Create TypeScript declarations stub
    cat > "${DIST_PROFILE_DIR}/chdb.d.ts" << EOF
// Type declarations for @chdb/wasm-${PROFILE}

export interface ChDBModule {
  query(sql: string, format?: string): string;
  createSession(): Session;
  getVersion(): string;
}

export interface Session {
  query(sql: string, format?: string): string;
  close(): void;
}

export default function createChDB(): Promise<ChDBModule>;
EOF

    log_info "Created chdb.d.ts"
fi

# ============================================================================
# Report Results
# ============================================================================

if [ "$DRY_RUN" = false ]; then
    log_section "Build Results"

    log_info "Profile: ${PROFILE}"
    log_info "Output directory: ${DIST_PROFILE_DIR}"
    echo ""

    if [ -d "${DIST_PROFILE_DIR}" ]; then
        echo "Files:"
        for file in "${DIST_PROFILE_DIR}"/*.wasm "${DIST_PROFILE_DIR}"/*.js; do
            if [ -f "$file" ]; then
                SIZE=$(get_file_size "$file")
                GZIP_SIZE=$(gzip -c "$file" 2>/dev/null | wc -c)
                echo "  $(basename "$file"):"
                echo "    Raw:     $(format_size $SIZE)"
                echo "    Gzipped: $(format_size $GZIP_SIZE)"
            fi
        done
    fi
fi

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
if [ "$DRY_RUN" = true ]; then
    log_warn "DRY RUN COMPLETE (no commands were executed)"
else
    log_success "BUILD COMPLETE"
fi
echo -e "${BOLD}================================================================${NC}"
echo ""
echo -e "  Profile:     ${MAGENTA}${BOLD}${PROFILE}${NC}"
echo -e "  Build Type:  ${BUILD_TYPE}"
echo -e "  Output:      ${DIST_PROFILE_DIR}"
echo ""

if [ "$DRY_RUN" = false ]; then
    # Show next steps based on profile
    case $PROFILE in
        core)
            log_info "Core profile built successfully!"
            echo "  The core profile includes only parser/lexer functionality."
            echo "  Use it for SQL validation and AST generation."
            ;;
        minimal)
            log_info "Minimal profile built successfully!"
            echo "  The minimal profile is ideal for simple in-memory analytics."
            echo "  Supports: Memory engine, JSON/CSV, basic SQL"
            ;;
        standard)
            log_info "Standard profile built successfully!"
            echo "  The standard profile is suitable for typical OLAP workloads."
            echo "  Supports: MergeTree, Parquet, Date/Time functions, CTEs"
            ;;
        analytics)
            log_info "Analytics profile built successfully!"
            echo "  The analytics profile is designed for complex analytics."
            echo "  Supports: Window functions, full aggregates, arrays, maps"
            ;;
        full)
            log_info "Full profile built successfully!"
            echo "  The full profile provides maximum ClickHouse compatibility."
            echo "  Includes all WASM-compatible features."
            ;;
    esac
    echo ""
    log_info "To build a different profile:"
    echo "  ./scripts/build-profile.sh <profile>"
    echo ""
    log_info "To see all available profiles:"
    echo "  ./scripts/build-profile.sh --list"
    echo ""
fi
