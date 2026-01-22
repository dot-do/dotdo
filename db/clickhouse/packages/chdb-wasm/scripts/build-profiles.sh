#!/bin/bash
# build-profiles.sh
# Build all 6 core WASM profiles for chdb-wasm
#
# This script builds all or selected WASM profiles in sequence.
# Each profile targets a specific use case and binary size.
#
# Usage:
#   ./scripts/build-profiles.sh              # Build all profiles
#   ./scripts/build-profiles.sh parser       # Build single profile
#   ./scripts/build-profiles.sh --list       # List available profiles
#   ./scripts/build-profiles.sh --help       # Show help
#
# Profiles:
#   parser      ~300KB     SQL validation, IDE integration
#   dashboard   ~3MB       Simple dashboards, small data
#   analytics   ~8MB       ClickBench-style analytics
#   etl         ~12-15MB   Data transformation pipelines
#   lakehouse   ~18-20MB   Query data lakes (S3/R2)
#   full        ~25MB+     Maximum ClickHouse compatibility
#
# Options:
#   --all           Build all profiles (default)
#   --clean         Clean build directories before building
#   --parallel N    Build N profiles in parallel (default: 1)
#   --release       Build in Release mode (default)
#   --debug         Build in Debug mode
#   --verbose       Enable verbose build output
#   --dry-run       Print commands without executing
#   --no-opt        Skip wasm-opt post-processing
#   --list          List all available profiles
#   --compare       Show feature comparison between profiles
#   --help, -h      Show this help message
#
# Examples:
#   ./scripts/build-profiles.sh                    # Build all profiles
#   ./scripts/build-profiles.sh parser dashboard   # Build specific profiles
#   ./scripts/build-profiles.sh --clean --all      # Clean build all
#   ./scripts/build-profiles.sh --list             # List profiles
#
# Environment Variables:
#   EMSDK           Path to Emscripten SDK
#   BUILD_TYPE      CMake build type (Release, Debug)
#   JOBS            Number of parallel build jobs per profile

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CMAKE_DIR="${PROJECT_ROOT}/cmake"
DIST_DIR="${PROJECT_ROOT}/dist"
PROFILES_DIR="${CMAKE_DIR}/profiles"

# All available profiles in build order (smallest to largest)
ALL_PROFILES=("parser" "dashboard" "analytics" "etl" "lakehouse" "full")

# Profile size targets for display
declare -A PROFILE_SIZES
PROFILE_SIZES[parser]="~300KB"
PROFILE_SIZES[dashboard]="~3MB"
PROFILE_SIZES[analytics]="~8MB"
PROFILE_SIZES[etl]="~12-15MB"
PROFILE_SIZES[lakehouse]="~18-20MB"
PROFILE_SIZES[full]="~25MB+"

# Profile descriptions
declare -A PROFILE_DESCRIPTIONS
PROFILE_DESCRIPTIONS[parser]="SQL validation, IDE integration"
PROFILE_DESCRIPTIONS[dashboard]="Simple dashboards, small data"
PROFILE_DESCRIPTIONS[analytics]="ClickBench-style analytics"
PROFILE_DESCRIPTIONS[etl]="Data transformation pipelines"
PROFILE_DESCRIPTIONS[lakehouse]="Query data lakes (S3/R2)"
PROFILE_DESCRIPTIONS[full]="Maximum ClickHouse compatibility"

# Default options
BUILD_TYPE="${BUILD_TYPE:-Release}"
CLEAN_BUILD=false
VERBOSE=false
DRY_RUN=false
SKIP_WASM_OPT=false
PARALLEL_COUNT=1
SELECTED_PROFILES=()
BUILD_ALL=false

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

log_profile() {
    local profile="$1"
    local status="$2"
    echo -e "${MAGENTA}[${profile}]${NC} ${status}"
}

# ============================================================================
# Helper Functions
# ============================================================================

show_help() {
    head -45 "$0" | tail -40
    exit 0
}

show_profiles() {
    echo ""
    echo -e "${BOLD}chdb-wasm Build Profiles${NC}"
    echo ""
    echo "The 6 core WASM build profiles for different use cases:"
    echo ""
    printf "%-12s %-12s %-40s\n" "Profile" "Target Size" "Use Case"
    printf "%-12s %-12s %-40s\n" "-------" "-----------" "--------"
    for profile in "${ALL_PROFILES[@]}"; do
        printf "%-12s %-12s %-40s\n" \
            "$profile" \
            "${PROFILE_SIZES[$profile]}" \
            "${PROFILE_DESCRIPTIONS[$profile]}"
    done
    echo ""
    echo "Output files: chdb-<profile>.wasm (e.g., chdb-dashboard.wasm)"
    echo ""
    exit 0
}

show_comparison() {
    echo ""
    echo -e "${BOLD}Profile Feature Comparison${NC}"
    echo ""
    echo "Feature                 | parser | dashboard | analytics | etl | lakehouse | full"
    echo "------------------------+--------+-----------+-----------+-----+-----------+------"
    echo "SQL Parser/Lexer        |   Y    |     Y     |     Y     |  Y  |     Y     |   Y"
    echo "Query Execution         |   -    |     Y     |     Y     |  Y  |     Y     |   Y"
    echo "Memory Engine           |   -    |     Y     |     Y     |  Y  |     Y     |   Y"
    echo "MergeTree Engine        |   -    |     -     |     Y     |  Y  |     Y     |   Y"
    echo "JSON/CSV/TSV            |   -    |     Y     |     Y     |  Y  |     Y     |   Y"
    echo "Parquet/Arrow           |   -    |     -     |     -     |  Y  |     Y     |   Y"
    echo "All Aggregates          |   -    |     -     |     Y     |  Y  |     Y     |   Y"
    echo "Window Functions        |   -    |     -     |     -     |  Y  |     Y     |   Y"
    echo "S3/URL Functions        |   -    |     -     |     -     |  -  |     Y     |   Y"
    echo "Geo Functions           |   -    |     -     |     -     |  -  |     -     |   Y"
    echo ""
    echo "Y = Included, - = Not included"
    echo ""
    echo -e "${BOLD}Size Targets${NC}"
    echo ""
    printf "%-12s %-15s %-15s\n" "Profile" "Uncompressed" "Gzipped (est.)"
    printf "%-12s %-15s %-15s\n" "-------" "------------" "--------------"
    printf "%-12s %-15s %-15s\n" "parser" "~300KB" "~100KB"
    printf "%-12s %-15s %-15s\n" "dashboard" "~3MB" "~1MB"
    printf "%-12s %-15s %-15s\n" "analytics" "~8MB" "~2.5MB"
    printf "%-12s %-15s %-15s\n" "etl" "~12-15MB" "~4-5MB"
    printf "%-12s %-15s %-15s\n" "lakehouse" "~18-20MB" "~6-7MB"
    printf "%-12s %-15s %-15s\n" "full" "~25MB+" "~8MB+"
    echo ""
    exit 0
}

is_valid_profile() {
    local profile="$1"
    for valid in "${ALL_PROFILES[@]}"; do
        if [ "$profile" = "$valid" ]; then
            return 0
        fi
    done
    return 1
}

get_cpu_count() {
    if command -v nproc &> /dev/null; then
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
        echo "$((size / 1024))KB"
    else
        echo "$((size / 1048576))MB"
    fi
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

# ============================================================================
# Parse Arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --all)
            BUILD_ALL=true
            shift
            ;;
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --parallel)
            PARALLEL_COUNT="$2"
            shift 2
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
        --no-opt)
            SKIP_WASM_OPT=true
            shift
            ;;
        --list)
            show_profiles
            ;;
        --compare)
            show_comparison
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
            if is_valid_profile "$1"; then
                SELECTED_PROFILES+=("$1")
            else
                log_error "Invalid profile: $1"
                echo ""
                echo "Available profiles: ${ALL_PROFILES[*]}"
                echo ""
                echo "Use --list for profile descriptions"
                exit 1
            fi
            shift
            ;;
    esac
done

# If no profiles specified and not --all, default to all
if [ ${#SELECTED_PROFILES[@]} -eq 0 ] || [ "$BUILD_ALL" = true ]; then
    SELECTED_PROFILES=("${ALL_PROFILES[@]}")
fi

# ============================================================================
# Header
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  chdb-wasm Multi-Profile Builder${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
echo -e "  Profiles to build: ${MAGENTA}${SELECTED_PROFILES[*]}${NC}"
echo -e "  Build Type:        ${BUILD_TYPE}"
echo -e "  Clean Build:       ${CLEAN_BUILD}"
echo -e "  Parallel:          ${PARALLEL_COUNT}"
echo ""

# ============================================================================
# Find Emscripten SDK
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

TOOLCHAIN_FILE="${EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"

if [ ! -f "${TOOLCHAIN_FILE}" ]; then
    log_error "Emscripten CMake toolchain not found at: ${TOOLCHAIN_FILE}"
    exit 1
fi

# ============================================================================
# Build Function
# ============================================================================

build_profile() {
    local profile="$1"
    local build_dir="${PROJECT_ROOT}/build-${profile}"
    local dist_profile_dir="${DIST_DIR}/${profile}"
    local start_time
    local end_time
    local duration

    start_time=$(date +%s)

    log_section "Building Profile: ${profile}"
    log_profile "$profile" "Target size: ${PROFILE_SIZES[$profile]}"
    log_profile "$profile" "Description: ${PROFILE_DESCRIPTIONS[$profile]}"

    # Clean if requested
    if [ "$CLEAN_BUILD" = true ]; then
        if [ -d "${build_dir}" ]; then
            log_profile "$profile" "Cleaning build directory..."
            run_cmd rm -rf "${build_dir}"
        fi
    fi

    # Create build directory
    run_cmd mkdir -p "${build_dir}"

    # Configure CMake
    log_profile "$profile" "Configuring CMake..."

    local cmake_args=(
        "-C" "${CMAKE_DIR}/build-profile.cmake"
        "-DCHDB_PROFILE=${profile}"
        "-DCMAKE_TOOLCHAIN_FILE=${TOOLCHAIN_FILE}"
        "-DCMAKE_BUILD_TYPE=${BUILD_TYPE}"
        "-S" "${PROJECT_ROOT}"
        "-B" "${build_dir}"
    )

    if [ "$VERBOSE" = true ]; then
        cmake_args+=("-DCMAKE_VERBOSE_MAKEFILE=ON")
    fi

    run_cmd cmake "${cmake_args[@]}"

    # Build
    log_profile "$profile" "Building..."

    local cpu_count
    cpu_count=$(get_cpu_count)

    local build_args=(
        "--build" "${build_dir}"
        "--parallel" "${cpu_count}"
    )

    if [ "$VERBOSE" = true ]; then
        build_args+=("--verbose")
    fi

    # Build appropriate targets based on profile
    if [ "$profile" = "parser" ]; then
        build_args+=("--target" "lexer-module" "--target" "parser-module")
    fi

    run_cmd cmake "${build_args[@]}"

    # Post-build optimization
    if [ "$SKIP_WASM_OPT" = false ] && [ "$DRY_RUN" = false ]; then
        local wasm_opt=""
        if command -v wasm-opt &> /dev/null; then
            wasm_opt="wasm-opt"
        elif [ -f "${EMSDK}/upstream/bin/wasm-opt" ]; then
            wasm_opt="${EMSDK}/upstream/bin/wasm-opt"
        fi

        if [ -n "$wasm_opt" ]; then
            log_profile "$profile" "Optimizing WASM with wasm-opt..."

            local wasm_files
            wasm_files=$(find "${build_dir}" -name "*.wasm" -type f 2>/dev/null || true)

            for wasm_file in $wasm_files; do
                if [ -f "$wasm_file" ]; then
                    local orig_size
                    orig_size=$(get_file_size "$wasm_file")

                    local opt_flags="-Oz"
                    if [ "$profile" = "parser" ]; then
                        opt_flags="-Oz --converge"
                    fi

                    "$wasm_opt" \
                        $opt_flags \
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

                    local new_size
                    new_size=$(get_file_size "$wasm_file")

                    if [ "$orig_size" -gt 0 ]; then
                        local saved=$((orig_size - new_size))
                        local percent=$((saved * 100 / orig_size))
                        log_profile "$profile" "Optimized: $(basename "$wasm_file") reduced by $(format_size $saved) (${percent}%)"
                    fi
                fi
            done
        fi
    fi

    # Copy to distribution directory
    if [ "$DRY_RUN" = false ]; then
        run_cmd mkdir -p "${dist_profile_dir}"

        local js_files
        local wasm_files
        js_files=$(find "${build_dir}" -maxdepth 3 -name "*.js" -type f 2>/dev/null || true)
        wasm_files=$(find "${build_dir}" -maxdepth 3 -name "*.wasm" -type f 2>/dev/null || true)

        for file in $js_files $wasm_files; do
            if [ -f "$file" ]; then
                cp "$file" "${dist_profile_dir}/"
            fi
        done

        # Rename output files to match profile
        for wasm_file in "${dist_profile_dir}"/*.wasm; do
            if [ -f "$wasm_file" ]; then
                local new_name="${dist_profile_dir}/chdb-${profile}.wasm"
                if [ "$wasm_file" != "$new_name" ]; then
                    mv "$wasm_file" "$new_name" 2>/dev/null || true
                fi
            fi
        done
    fi

    end_time=$(date +%s)
    duration=$((end_time - start_time))

    log_profile "$profile" "Build completed in ${duration}s"

    # Print file sizes
    if [ "$DRY_RUN" = false ] && [ -d "${dist_profile_dir}" ]; then
        for wasm_file in "${dist_profile_dir}"/*.wasm; do
            if [ -f "$wasm_file" ]; then
                local size
                local gzip_size
                size=$(get_file_size "$wasm_file")
                gzip_size=$(gzip -c "$wasm_file" 2>/dev/null | wc -c)
                log_profile "$profile" "Output: $(basename "$wasm_file")"
                log_profile "$profile" "  Size: $(format_size $size) (gzipped: $(format_size $gzip_size))"
            fi
        done
    fi

    echo ""
}

# ============================================================================
# Build All Selected Profiles
# ============================================================================

log_section "Building ${#SELECTED_PROFILES[@]} Profile(s)"

TOTAL_START=$(date +%s)
SUCCESSFUL_BUILDS=()
FAILED_BUILDS=()

for profile in "${SELECTED_PROFILES[@]}"; do
    if build_profile "$profile"; then
        SUCCESSFUL_BUILDS+=("$profile")
    else
        FAILED_BUILDS+=("$profile")
        log_error "Build failed for profile: $profile"
    fi
done

TOTAL_END=$(date +%s)
TOTAL_DURATION=$((TOTAL_END - TOTAL_START))

# ============================================================================
# Summary
# ============================================================================

log_section "Build Summary"

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  Build Complete${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
echo -e "  Total time:        ${TOTAL_DURATION}s"
echo -e "  Successful builds: ${#SUCCESSFUL_BUILDS[@]}"
echo -e "  Failed builds:     ${#FAILED_BUILDS[@]}"
echo ""

if [ ${#SUCCESSFUL_BUILDS[@]} -gt 0 ]; then
    echo -e "${GREEN}Successful builds:${NC}"
    for profile in "${SUCCESSFUL_BUILDS[@]}"; do
        local wasm_file="${DIST_DIR}/${profile}/chdb-${profile}.wasm"
        if [ -f "$wasm_file" ]; then
            local size
            local gzip_size
            size=$(get_file_size "$wasm_file")
            gzip_size=$(gzip -c "$wasm_file" 2>/dev/null | wc -c)
            printf "  %-12s %-15s %-15s\n" \
                "$profile" \
                "$(format_size $size)" \
                "(gzip: $(format_size $gzip_size))"
        else
            echo "  $profile (output not found)"
        fi
    done
    echo ""
fi

if [ ${#FAILED_BUILDS[@]} -gt 0 ]; then
    echo -e "${RED}Failed builds:${NC}"
    for profile in "${FAILED_BUILDS[@]}"; do
        echo "  $profile"
    done
    echo ""
fi

echo "Output directory: ${DIST_DIR}"
echo ""

# Print next steps
if [ ${#SUCCESSFUL_BUILDS[@]} -gt 0 ]; then
    log_info "Build artifacts are in: ${DIST_DIR}/<profile>/"
    echo ""
    log_info "To use a profile in your project:"
    echo "  import createChDB from './dist/dashboard/chdb-dashboard.js'"
    echo ""
    log_info "To deploy to Cloudflare Workers:"
    echo "  Copy the WASM file to your worker's assets"
    echo ""
fi

# Exit with error if any builds failed
if [ ${#FAILED_BUILDS[@]} -gt 0 ]; then
    exit 1
fi
