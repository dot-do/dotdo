#!/usr/bin/env bash
#
# build.sh - Build chdb as WebAssembly using Emscripten
#
# This script compiles vendor/chdb to WASM for use in Cloudflare Workers.
# It handles Emscripten SDK setup, CMake configuration, and post-build optimization.
#
# Usage:
#   ./build.sh                  # Build with default settings (minimal profile)
#   ./build.sh minimal          # Build minimal profile (~5-10MB)
#   ./build.sh standard         # Build standard profile (~15-25MB)
#   ./build.sh full             # Build full profile (~50MB+)
#   ./build.sh --clean          # Clean and rebuild
#   ./build.sh --help           # Show help
#
# Environment Variables:
#   EMSDK      - Path to Emscripten SDK (auto-detected if not set)
#   JOBS       - Number of parallel build jobs (default: auto)
#   BUILD_TYPE - CMake build type (default: Release)
#
# Requirements:
#   - Emscripten SDK (emsdk) installed and activated
#   - CMake 3.20+
#   - wasm-opt (optional, for additional optimization)

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Script directory (packages/chdb-wasm/build/emscripten)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Project directories
BUILD_PARENT_DIR="$(dirname "$SCRIPT_DIR")"          # packages/chdb-wasm/build
CHDB_WASM_DIR="$(dirname "$BUILD_PARENT_DIR")"       # packages/chdb-wasm
PACKAGES_DIR="$(dirname "$CHDB_WASM_DIR")"           # packages
PROJECT_ROOT="$(dirname "$PACKAGES_DIR")"            # project root

# Output directories
BUILD_OUTPUT_DIR="${CHDB_WASM_DIR}/build-emscripten"
DIST_DIR="${CHDB_WASM_DIR}/dist/wasm"

# Build configuration
PROFILE="${PROFILE:-minimal}"
BUILD_TYPE="${BUILD_TYPE:-Release}"
JOBS="${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

# Flags
CLEAN_BUILD=0
VERBOSE=0
SKIP_WASM_OPT=0

# =============================================================================
# Colors and Logging
# =============================================================================

if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    CYAN=''
    BOLD=''
    NC=''
fi

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_step() {
    echo -e "\n${CYAN}${BOLD}>>> $*${NC}\n"
}

# =============================================================================
# Help
# =============================================================================

show_help() {
    cat << 'EOF'
Build chdb as WebAssembly for Cloudflare Workers

USAGE:
    ./build.sh [OPTIONS] [PROFILE]

PROFILES:
    minimal     Smallest binary, parser + memory engine (~5-10MB)
    standard    + MergeTree + Parquet formats (~15-25MB)
    full        All WASM-compatible features (~50MB+)

OPTIONS:
    -h, --help          Show this help message
    -c, --clean         Clean build directory before building
    -v, --verbose       Enable verbose output
    -j, --jobs N        Number of parallel build jobs (default: auto)
    -t, --type TYPE     Build type: Debug, Release, MinSizeRel (default: Release)
    --no-opt            Skip wasm-opt post-processing
    --check             Check prerequisites without building

ENVIRONMENT VARIABLES:
    EMSDK               Path to Emscripten SDK
    JOBS                Number of parallel build jobs
    BUILD_TYPE          CMake build type
    PROFILE             Build profile

EXAMPLES:
    ./build.sh                      # Build minimal profile
    ./build.sh minimal              # Same as above
    ./build.sh standard             # Build with MergeTree + formats
    ./build.sh -c minimal           # Clean build of minimal profile
    ./build.sh -j 8 full            # Build full profile with 8 jobs
    PROFILE=standard ./build.sh     # Build standard via environment

TARGET ENVIRONMENT:
    - Cloudflare Workers (128MB memory limit)
    - Single-threaded execution
    - No persistent filesystem (use R2/KV instead)
    - WebAssembly output (not asm.js)

OUTPUT:
    ${DIST_DIR}/
    ├── chdb.js          # JavaScript glue code (ES6 module)
    ├── chdb.wasm        # WebAssembly binary
    └── chdb.d.ts        # TypeScript definitions (if generated)

EOF
}

# =============================================================================
# Emscripten Setup
# =============================================================================

find_emsdk() {
    # Check common locations for Emscripten SDK
    local locations=(
        "${EMSDK:-}"
        "/opt/emsdk"
        "$HOME/emsdk"
        "/usr/local/emsdk"
        "/opt/homebrew/opt/emscripten"
    )

    for loc in "${locations[@]}"; do
        if [[ -n "$loc" && -d "$loc" ]]; then
            if [[ -f "$loc/emsdk_env.sh" ]] || [[ -f "$loc/upstream/emscripten/emcc" ]]; then
                echo "$loc"
                return 0
            fi
        fi
    done

    return 1
}

setup_emsdk() {
    log_step "Setting up Emscripten SDK"

    local emsdk_path
    if ! emsdk_path=$(find_emsdk); then
        log_error "Emscripten SDK not found!"
        echo ""
        echo "Please install Emscripten:"
        echo ""
        echo "  git clone https://github.com/emscripten-core/emsdk.git"
        echo "  cd emsdk"
        echo "  ./emsdk install latest"
        echo "  ./emsdk activate latest"
        echo "  source ./emsdk_env.sh"
        echo ""
        exit 1
    fi

    log_info "Found Emscripten SDK at: $emsdk_path"

    # Source the environment if available
    if [[ -f "$emsdk_path/emsdk_env.sh" ]]; then
        # shellcheck source=/dev/null
        source "$emsdk_path/emsdk_env.sh" 2>/dev/null || true
    fi

    # Export for CMake toolchain
    export EMSDK="$emsdk_path"

    # Verify emcc is available
    if ! command -v emcc &>/dev/null; then
        # Try adding to PATH manually
        if [[ -f "$emsdk_path/upstream/emscripten/emcc" ]]; then
            export PATH="$emsdk_path/upstream/emscripten:$PATH"
        fi
    fi

    if ! command -v emcc &>/dev/null; then
        log_error "emcc not found in PATH after sourcing emsdk_env.sh"
        exit 1
    fi

    local emcc_version
    emcc_version=$(emcc --version | head -n1)
    log_success "Emscripten ready: $emcc_version"
}

# =============================================================================
# Prerequisite Checks
# =============================================================================

check_prerequisites() {
    log_step "Checking prerequisites"

    local all_ok=1

    # Check CMake
    if command -v cmake &>/dev/null; then
        local cmake_version
        cmake_version=$(cmake --version | head -n1)
        log_success "CMake found: $cmake_version"
    else
        log_error "CMake not found"
        all_ok=0
    fi

    # Check Emscripten
    if command -v emcc &>/dev/null; then
        local emcc_version
        emcc_version=$(emcc --version | head -n1)
        log_success "Emscripten found: $emcc_version"
    else
        log_warn "Emscripten not found in PATH (will attempt setup)"
    fi

    # Check wasm-opt
    if command -v wasm-opt &>/dev/null; then
        local wasm_opt_version
        wasm_opt_version=$(wasm-opt --version 2>&1 | head -n1)
        log_success "wasm-opt found: $wasm_opt_version"
    elif [[ -n "${EMSDK:-}" && -f "$EMSDK/upstream/bin/wasm-opt" ]]; then
        log_success "wasm-opt found in EMSDK"
    else
        log_warn "wasm-opt not found (optional, for additional optimization)"
    fi

    # Check vendor/chdb
    if [[ -f "$PROJECT_ROOT/vendor/chdb/CMakeLists.txt" ]]; then
        log_success "vendor/chdb found"
    else
        log_error "vendor/chdb not found at $PROJECT_ROOT/vendor/chdb"
        echo "  Run: git submodule update --init --recursive"
        all_ok=0
    fi

    return $((1 - all_ok))
}

# =============================================================================
# Build Functions
# =============================================================================

clean_build_dir() {
    if [[ -d "$BUILD_OUTPUT_DIR" ]]; then
        log_info "Cleaning build directory: $BUILD_OUTPUT_DIR"
        rm -rf "$BUILD_OUTPUT_DIR"
    fi
}

configure_cmake() {
    log_step "Configuring CMake for profile: $PROFILE"

    mkdir -p "$BUILD_OUTPUT_DIR"

    local cmake_args=(
        -S "$SCRIPT_DIR"
        -B "$BUILD_OUTPUT_DIR"
        -DCMAKE_TOOLCHAIN_FILE="$SCRIPT_DIR/toolchain.cmake"
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
        -DCHDB_PROFILE="$PROFILE"
    )

    if [[ "$VERBOSE" -eq 1 ]]; then
        cmake_args+=(-DCMAKE_VERBOSE_MAKEFILE=ON)
    fi

    log_info "Running: cmake ${cmake_args[*]}"

    cmake "${cmake_args[@]}"

    log_success "CMake configuration complete"
}

build_wasm() {
    log_step "Building WASM (profile: $PROFILE, jobs: $JOBS)"

    local build_args=(
        --build "$BUILD_OUTPUT_DIR"
        --parallel "$JOBS"
    )

    if [[ "$VERBOSE" -eq 1 ]]; then
        build_args+=(--verbose)
    fi

    cmake "${build_args[@]}"

    log_success "WASM build complete"
}

optimize_wasm() {
    if [[ "$SKIP_WASM_OPT" -eq 1 ]]; then
        log_info "Skipping wasm-opt optimization (--no-opt flag set)"
        return
    fi

    local wasm_file="$BUILD_OUTPUT_DIR/dist/chdb.wasm"

    if [[ ! -f "$wasm_file" ]]; then
        log_warn "WASM file not found at $wasm_file, skipping optimization"
        return
    fi

    # Find wasm-opt
    local wasm_opt=""
    if command -v wasm-opt &>/dev/null; then
        wasm_opt="wasm-opt"
    elif [[ -n "${EMSDK:-}" && -f "$EMSDK/upstream/bin/wasm-opt" ]]; then
        wasm_opt="$EMSDK/upstream/bin/wasm-opt"
    fi

    if [[ -z "$wasm_opt" ]]; then
        log_warn "wasm-opt not found, skipping additional optimization"
        return
    fi

    log_step "Running wasm-opt for additional size reduction"

    # Get original size
    local original_size
    original_size=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file" 2>/dev/null || echo "0")

    # Create optimized copy
    local optimized_file="${wasm_file}.opt"

    log_info "Running: $wasm_opt -Oz ..."

    "$wasm_opt" \
        -Oz \
        --enable-simd \
        --enable-bulk-memory \
        --enable-sign-ext \
        --enable-nontrapping-float-to-int \
        --converge \
        --strip-debug \
        --strip-dwarf \
        --strip-producers \
        --vacuum \
        --duplicate-function-elimination \
        --duplicate-import-elimination \
        --remove-unused-module-elements \
        --remove-unused-names \
        --merge-similar-functions \
        --simplify-locals \
        --reorder-functions \
        --reorder-locals \
        "$wasm_file" \
        -o "$optimized_file"

    # Replace original with optimized
    mv "$optimized_file" "$wasm_file"

    # Get new size
    local new_size
    new_size=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file" 2>/dev/null || echo "0")

    # Calculate savings
    if [[ "$original_size" -gt 0 ]]; then
        local saved=$((original_size - new_size))
        local percent=$((saved * 100 / original_size))
        log_success "wasm-opt reduced size by $saved bytes ($percent%)"
    fi
}

copy_to_dist() {
    log_step "Copying outputs to dist directory"

    mkdir -p "$DIST_DIR"

    # Copy JS and WASM files
    local files_copied=0

    if [[ -f "$BUILD_OUTPUT_DIR/dist/chdb.js" ]]; then
        cp "$BUILD_OUTPUT_DIR/dist/chdb.js" "$DIST_DIR/"
        files_copied=$((files_copied + 1))
    fi

    if [[ -f "$BUILD_OUTPUT_DIR/dist/chdb.wasm" ]]; then
        cp "$BUILD_OUTPUT_DIR/dist/chdb.wasm" "$DIST_DIR/"
        files_copied=$((files_copied + 1))
    fi

    if [[ "$files_copied" -eq 0 ]]; then
        log_warn "No output files found to copy"
        return
    fi

    log_success "Copied $files_copied files to $DIST_DIR"
}

print_summary() {
    log_step "Build Summary"

    echo "Profile:     $PROFILE"
    echo "Build Type:  $BUILD_TYPE"
    echo "Output Dir:  $DIST_DIR"
    echo ""

    if [[ -f "$DIST_DIR/chdb.wasm" ]]; then
        local wasm_size
        wasm_size=$(stat -f%z "$DIST_DIR/chdb.wasm" 2>/dev/null || stat -c%s "$DIST_DIR/chdb.wasm" 2>/dev/null || echo "0")

        local gzip_size
        gzip_size=$(gzip -c "$DIST_DIR/chdb.wasm" 2>/dev/null | wc -c | tr -d ' ')

        echo "Output Files:"
        echo "  chdb.js   - JavaScript glue code"
        echo "  chdb.wasm - WebAssembly binary"
        echo ""
        echo "Sizes:"
        printf "  WASM:         %s bytes (%s)\n" "$wasm_size" "$(numfmt --to=iec "$wasm_size" 2>/dev/null || echo "${wasm_size}B")"
        printf "  WASM (gzip):  %s bytes (%s)\n" "$gzip_size" "$(numfmt --to=iec "$gzip_size" 2>/dev/null || echo "${gzip_size}B")"
    else
        echo "Output files not found - build may have failed"
    fi

    echo ""
    echo "Usage in JavaScript:"
    echo ""
    echo "  import createChDBModule from './chdb.js';"
    echo ""
    echo "  const chdb = await createChDBModule();"
    echo "  chdb._chdb_wasm_init();"
    echo "  const result = chdb.ccall('chdb_wasm_query', 'number', ['string'], ['SELECT 1']);"
    echo ""
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_help
                exit 0
                ;;
            -c|--clean)
                CLEAN_BUILD=1
                shift
                ;;
            -v|--verbose)
                VERBOSE=1
                shift
                ;;
            -j|--jobs)
                JOBS="$2"
                shift 2
                ;;
            -t|--type)
                BUILD_TYPE="$2"
                shift 2
                ;;
            --no-opt)
                SKIP_WASM_OPT=1
                shift
                ;;
            --check)
                setup_emsdk
                check_prerequisites
                exit $?
                ;;
            minimal|standard|full)
                PROFILE="$1"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Run '$0 --help' for usage"
                exit 1
                ;;
        esac
    done

    echo ""
    echo "============================================================"
    echo "  chdb-wasm Emscripten Build"
    echo "============================================================"
    echo "  Profile:    $PROFILE"
    echo "  Build Type: $BUILD_TYPE"
    echo "  Jobs:       $JOBS"
    echo "============================================================"
    echo ""

    # Setup and checks
    setup_emsdk
    check_prerequisites || exit 1

    # Clean if requested
    if [[ "$CLEAN_BUILD" -eq 1 ]]; then
        clean_build_dir
    fi

    # Build
    configure_cmake
    build_wasm

    # Post-processing (only in Release mode)
    if [[ "$BUILD_TYPE" == "Release" || "$BUILD_TYPE" == "MinSizeRel" ]]; then
        optimize_wasm
    fi

    # Copy outputs
    copy_to_dist

    # Summary
    print_summary

    log_success "Build complete!"
}

main "$@"
