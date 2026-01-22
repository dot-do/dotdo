#!/bin/bash
# build.sh - Build script for chdb-wasm
# Builds chdb as WebAssembly for Cloudflare Workers

set -e

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${PROJECT_DIR}/build-output"
DIST_DIR="${PROJECT_DIR}/dist"

# Default build profile
PROFILE="${PROFILE:-standard}"

# Number of parallel jobs
JOBS="${JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

# Build type
BUILD_TYPE="${BUILD_TYPE:-Release}"

# wasm-opt path (if installed separately)
WASM_OPT="${WASM_OPT:-wasm-opt}"

# =============================================================================
# Color Output
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# =============================================================================
# Help
# =============================================================================

show_help() {
    cat << EOF
Usage: $0 [OPTIONS] [PROFILE]

Build chdb as WebAssembly for Cloudflare Workers.

PROFILES:
    minimal     Smallest binary (~3MB gzipped), basic features
    standard    Balanced size/features (~10MB gzipped) [default]
    full        All features (~20MB gzipped)
    all         Build all profiles

OPTIONS:
    -h, --help      Show this help message
    -c, --clean     Clean build directory before building
    -d, --debug     Build with debug symbols
    -v, --verbose   Verbose output
    -j, --jobs N    Number of parallel build jobs (default: auto)
    --no-opt        Skip wasm-opt optimization step
    --check-emsdk   Only check Emscripten SDK installation

ENVIRONMENT VARIABLES:
    EMSDK           Path to Emscripten SDK
    PROFILE         Build profile (minimal, standard, full)
    JOBS            Number of parallel jobs
    BUILD_TYPE      CMake build type (Release, Debug, etc.)
    WASM_OPT        Path to wasm-opt binary

EXAMPLES:
    $0                      # Build standard profile
    $0 minimal              # Build minimal profile
    $0 all                  # Build all profiles
    $0 -c standard          # Clean build of standard profile
    PROFILE=full $0         # Build full profile via environment

EOF
}

# =============================================================================
# Emscripten SDK Setup
# =============================================================================

setup_emsdk() {
    info "Setting up Emscripten SDK..."

    # Check common locations for emsdk
    if [[ -n "${EMSDK}" ]]; then
        EMSDK_PATH="${EMSDK}"
    elif [[ -d "/opt/emsdk" ]]; then
        EMSDK_PATH="/opt/emsdk"
    elif [[ -d "${HOME}/emsdk" ]]; then
        EMSDK_PATH="${HOME}/emsdk"
    elif [[ -d "/usr/local/emsdk" ]]; then
        EMSDK_PATH="/usr/local/emsdk"
    else
        error "Emscripten SDK not found. Please install it:
    git clone https://github.com/emscripten-core/emsdk.git
    cd emsdk
    ./emsdk install latest
    ./emsdk activate latest

Or set the EMSDK environment variable to point to your installation."
    fi

    info "Using Emscripten SDK at: ${EMSDK_PATH}"

    # Source the emsdk environment
    if [[ -f "${EMSDK_PATH}/emsdk_env.sh" ]]; then
        # shellcheck source=/dev/null
        source "${EMSDK_PATH}/emsdk_env.sh" > /dev/null 2>&1 || true
    else
        error "emsdk_env.sh not found at ${EMSDK_PATH}"
    fi

    # Verify emcc is available
    if ! command -v emcc &> /dev/null; then
        error "emcc not found after sourcing emsdk_env.sh"
    fi

    # Print version
    EMCC_VERSION=$(emcc --version | head -n1)
    info "Emscripten version: ${EMCC_VERSION}"

    export EMSDK="${EMSDK_PATH}"
}

check_emsdk() {
    setup_emsdk
    success "Emscripten SDK is properly configured"
    emcc --version
    exit 0
}

# =============================================================================
# Build Functions
# =============================================================================

clean_build() {
    local profile="$1"
    local build_path="${BUILD_DIR}/${profile}"

    if [[ -d "${build_path}" ]]; then
        info "Cleaning build directory: ${build_path}"
        rm -rf "${build_path}"
    fi
}

configure_build() {
    local profile="$1"
    local build_path="${BUILD_DIR}/${profile}"

    info "Configuring CMake for profile: ${profile}"

    mkdir -p "${build_path}"

    local cmake_args=(
        -DCMAKE_TOOLCHAIN_FILE="${SCRIPT_DIR}/toolchain.cmake"
        -DCMAKE_BUILD_TYPE="${BUILD_TYPE}"
        -DCHDB_WASM_PROFILE="${profile}"
        -S "${SCRIPT_DIR}"
        -B "${build_path}"
    )

    if [[ "${VERBOSE}" == "1" ]]; then
        cmake_args+=(-DCMAKE_VERBOSE_MAKEFILE=ON)
    fi

    cmake "${cmake_args[@]}"
}

build_wasm() {
    local profile="$1"
    local build_path="${BUILD_DIR}/${profile}"

    info "Building WASM for profile: ${profile} (using ${JOBS} jobs)"

    cmake --build "${build_path}" --parallel "${JOBS}"

    success "Build completed for ${profile}"
}

optimize_wasm() {
    local profile="$1"
    local wasm_file="${BUILD_DIR}/${profile}/chdb-${profile}.wasm"
    local optimized_file="${BUILD_DIR}/${profile}/chdb-${profile}.opt.wasm"

    if [[ "${NO_OPT}" == "1" ]]; then
        warn "Skipping wasm-opt optimization (--no-opt flag set)"
        return
    fi

    # Check if wasm-opt is available
    if ! command -v "${WASM_OPT}" &> /dev/null; then
        # Try to find wasm-opt in emsdk
        if [[ -f "${EMSDK}/upstream/bin/wasm-opt" ]]; then
            WASM_OPT="${EMSDK}/upstream/bin/wasm-opt"
        else
            warn "wasm-opt not found, skipping additional optimization"
            return
        fi
    fi

    if [[ ! -f "${wasm_file}" ]]; then
        warn "WASM file not found: ${wasm_file}"
        return
    fi

    info "Running wasm-opt for additional size reduction..."

    # Get original size
    local original_size
    original_size=$(stat -f%z "${wasm_file}" 2>/dev/null || stat -c%s "${wasm_file}" 2>/dev/null || echo "0")

    # Run wasm-opt with aggressive size optimizations
    "${WASM_OPT}" \
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
        "${wasm_file}" \
        -o "${optimized_file}"

    # Get optimized size
    local optimized_size
    optimized_size=$(stat -f%z "${optimized_file}" 2>/dev/null || stat -c%s "${optimized_file}" 2>/dev/null || echo "0")

    # Replace original with optimized
    mv "${optimized_file}" "${wasm_file}"

    # Calculate savings
    local saved=$((original_size - optimized_size))
    local percent=$((saved * 100 / original_size))

    info "wasm-opt reduced size by ${saved} bytes (${percent}%)"
    info "  Original: $(numfmt --to=iec ${original_size} 2>/dev/null || echo "${original_size} bytes")"
    info "  Optimized: $(numfmt --to=iec ${optimized_size} 2>/dev/null || echo "${optimized_size} bytes")"
}

copy_to_dist() {
    local profile="$1"
    local build_path="${BUILD_DIR}/${profile}"
    local dist_path="${DIST_DIR}/${profile}"

    info "Copying outputs to dist directory..."

    mkdir -p "${dist_path}"

    # Copy JS and WASM files
    cp "${build_path}/chdb-${profile}.js" "${dist_path}/" 2>/dev/null || true
    cp "${build_path}/chdb-${profile}.wasm" "${dist_path}/" 2>/dev/null || true

    # Create a simple package.json for the profile
    cat > "${dist_path}/package.json" << EOF
{
  "name": "@dotdo/chdb-wasm-${profile}",
  "version": "1.0.0",
  "main": "chdb-${profile}.js",
  "types": "chdb-${profile}.d.ts",
  "files": [
    "chdb-${profile}.js",
    "chdb-${profile}.wasm",
    "chdb-${profile}.d.ts"
  ]
}
EOF

    # Report file sizes
    if [[ -f "${dist_path}/chdb-${profile}.wasm" ]]; then
        local wasm_size
        wasm_size=$(stat -f%z "${dist_path}/chdb-${profile}.wasm" 2>/dev/null || stat -c%s "${dist_path}/chdb-${profile}.wasm" 2>/dev/null || echo "unknown")

        local gzip_size
        gzip_size=$(gzip -c "${dist_path}/chdb-${profile}.wasm" | wc -c)

        info "Output sizes for ${profile}:"
        info "  WASM: $(numfmt --to=iec ${wasm_size} 2>/dev/null || echo "${wasm_size} bytes")"
        info "  WASM (gzipped): $(numfmt --to=iec ${gzip_size} 2>/dev/null || echo "${gzip_size} bytes")"
    fi

    success "Outputs copied to ${dist_path}"
}

build_profile() {
    local profile="$1"

    echo ""
    echo "=============================================="
    echo "  Building profile: ${profile}"
    echo "=============================================="
    echo ""

    if [[ "${CLEAN}" == "1" ]]; then
        clean_build "${profile}"
    fi

    configure_build "${profile}"
    build_wasm "${profile}"
    optimize_wasm "${profile}"
    copy_to_dist "${profile}"

    success "Profile ${profile} built successfully!"
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
                CLEAN=1
                shift
                ;;
            -d|--debug)
                BUILD_TYPE="Debug"
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
            --no-opt)
                NO_OPT=1
                shift
                ;;
            --check-emsdk)
                check_emsdk
                ;;
            minimal|standard|full|all)
                PROFILE="$1"
                shift
                ;;
            *)
                error "Unknown option: $1"
                ;;
        esac
    done

    # Setup Emscripten
    setup_emsdk

    # Build requested profile(s)
    if [[ "${PROFILE}" == "all" ]]; then
        for p in minimal standard full; do
            build_profile "${p}"
        done
    else
        build_profile "${PROFILE}"
    fi

    echo ""
    success "Build complete!"
    echo ""
    echo "Outputs are in: ${DIST_DIR}/"
    echo ""

    # List output files
    if command -v tree &> /dev/null; then
        tree "${DIST_DIR}" 2>/dev/null || ls -la "${DIST_DIR}"
    else
        ls -la "${DIST_DIR}"
    fi
}

main "$@"
