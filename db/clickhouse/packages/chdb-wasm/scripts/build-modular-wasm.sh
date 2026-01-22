#!/bin/bash
# build-modular-wasm.sh
# Build script for WASM modules using Emscripten dynamic linking
#
# This script builds:
# - Core MAIN_MODULE (wasm/core) - Provides shared memory, malloc/free, extension registry
# - Extension SIDE_MODULEs (wasm/extensions/*) - Math, Geo, JSON, JSON-Columnar
#
# Architecture:
# - MAIN_MODULE=2: Core module with dynamic linking and dead code elimination
# - SIDE_MODULE=2: Extension modules that import functions from core
#
# Prerequisites:
# - Emscripten SDK (emsdk) must be installed
# - CMake >= 3.16
#
# Usage:
#   ./scripts/build-modular-wasm.sh [OPTIONS]
#
# Options:
#   --clean         Clean build directories before building
#   --release       Build in Release mode (default)
#   --debug         Build in Debug mode with source maps
#   --verbose       Enable verbose build output
#   --core-only     Build only the core module
#   --ext NAME      Build only the specified extension (math, geo, json, json-columnar)
#   --check-emsdk   Only check Emscripten SDK installation
#   --install-emsdk Show instructions for installing Emscripten
#   --continue      Continue building even if a module fails
#   --help, -h      Show this help message
#
# Output directories:
#   wasm/core/dist/         - Core module output
#   wasm/extensions/*/dist/ - Extension module outputs
#   wasm/dist/modular/      - Combined output for deployment

set -e

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Module paths
CORE_DIR="${PROJECT_ROOT}/wasm/core"
EXT_DIR="${PROJECT_ROOT}/wasm/extensions"
MODULAR_DIST="${PROJECT_ROOT}/wasm/dist/modular"

# Build directories
BUILD_BASE="${PROJECT_ROOT}/build"
BUILD_CORE="${BUILD_BASE}/core"
BUILD_EXT_MATH="${BUILD_BASE}/ext-math"
BUILD_EXT_GEO="${BUILD_BASE}/ext-geo"
BUILD_EXT_JSON="${BUILD_BASE}/ext-json"
BUILD_EXT_JSON_COLUMNAR="${BUILD_BASE}/ext-json-columnar"

# Default options
BUILD_TYPE="Release"
CLEAN_BUILD=false
VERBOSE=false
CORE_ONLY=false
EXT_ONLY=""
CHECK_EMSDK_ONLY=false
SHOW_INSTALL=false
CONTINUE_ON_ERROR=false

# Track build results
BUILD_FAILURES=()
BUILD_SUCCESSES=()

# ============================================================================
# Color Output
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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
# Help and Installation Instructions
# ============================================================================

show_help() {
    head -40 "$0" | tail -35
    exit 0
}

show_install_instructions() {
    log_section "Emscripten SDK Installation Instructions"
    echo ""
    echo -e "${BOLD}macOS Installation:${NC}"
    echo ""
    echo "  # Clone the Emscripten SDK"
    echo "  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk"
    echo "  cd ~/emsdk"
    echo ""
    echo "  # Install and activate the latest version"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo ""
    echo "  # Add to your shell profile (~/.zshrc or ~/.bashrc)"
    echo "  echo 'source ~/emsdk/emsdk_env.sh' >> ~/.zshrc"
    echo ""
    echo "  # Or source it for the current session"
    echo "  source ~/emsdk/emsdk_env.sh"
    echo ""
    echo -e "${BOLD}Linux Installation:${NC}"
    echo ""
    echo "  # Same as macOS, but use ~/.bashrc"
    echo "  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk"
    echo "  cd ~/emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ~/emsdk/emsdk_env.sh"
    echo ""
    echo -e "${BOLD}Verify Installation:${NC}"
    echo ""
    echo "  emcc --version"
    echo "  # Should show: emcc (Emscripten gcc/clang-like replacement) X.X.X (...)"
    echo ""
    echo -e "${BOLD}Alternative: Using Homebrew (macOS):${NC}"
    echo ""
    echo "  brew install emscripten"
    echo "  # Note: Homebrew version may be older than emsdk"
    echo ""
    echo -e "${BOLD}Required versions:${NC}"
    echo "  - Emscripten: 3.1.x or higher recommended"
    echo "  - CMake: 3.16 or higher"
    echo ""
    exit 0
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
        --core-only)
            CORE_ONLY=true
            shift
            ;;
        --ext)
            EXT_ONLY="$2"
            shift 2
            ;;
        --check-emsdk)
            CHECK_EMSDK_ONLY=true
            shift
            ;;
        --install-emsdk)
            SHOW_INSTALL=true
            shift
            ;;
        --continue)
            CONTINUE_ON_ERROR=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information."
            exit 1
            ;;
    esac
done

# Show install instructions if requested
if [ "$SHOW_INSTALL" = true ]; then
    show_install_instructions
fi

# ============================================================================
# Header
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
echo -e "${BOLD}  chdb-wasm Modular WASM Build Script${NC}"
echo -e "${BOLD}================================================================${NC}"
echo ""
log_info "Project Root: ${PROJECT_ROOT}"
log_info "Build Type: ${BUILD_TYPE}"
echo ""

# ============================================================================
# Emscripten SDK Setup
# ============================================================================

log_section "Emscripten SDK Setup"

find_emsdk() {
    # Check environment variable first
    if [ -n "${EMSDK}" ] && [ -d "${EMSDK}" ]; then
        echo "${EMSDK}"
        return 0
    fi

    # Check if emcc is already in PATH
    if command -v emcc &> /dev/null; then
        # Try to find EMSDK from emcc path
        local emcc_path=$(which emcc)
        local emsdk_root=$(dirname $(dirname $(dirname "$emcc_path")))
        if [ -f "${emsdk_root}/emsdk_env.sh" ]; then
            echo "${emsdk_root}"
            return 0
        fi
    fi

    # Common installation locations
    local EMSDK_PATHS=(
        "${HOME}/emsdk"
        "/opt/emsdk"
        "/usr/local/emsdk"
        "${HOME}/.emsdk"
        "/emsdk"
        "${HOME}/Library/emsdk"  # macOS alternative
        "/opt/homebrew/Cellar/emscripten"  # Homebrew
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
        echo "To install Emscripten SDK, run:"
        echo "  ./scripts/build-modular-wasm.sh --install-emsdk"
        echo ""
        echo "Or manually:"
        echo "  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk"
        echo "  cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest"
        echo "  source ~/emsdk/emsdk_env.sh"
        echo ""
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

    # Verify emcc is available
    if ! command -v emcc &> /dev/null; then
        log_error "emcc not found after sourcing emsdk_env.sh"
        exit 1
    fi

    # Get and display version
    local emcc_version
    emcc_version=$(emcc --version | head -n1)
    log_success "Emscripten ready: ${emcc_version}"

    # Verify emcmake and emmake
    if ! command -v emcmake &> /dev/null; then
        log_error "emcmake not found"
        exit 1
    fi

    if ! command -v emmake &> /dev/null; then
        log_error "emmake not found"
        exit 1
    fi

    log_success "emcmake and emmake available"

    # Export for child processes
    export EMSDK="${emsdk_path}"
    export EMSCRIPTEN="${EMSDK}/upstream/emscripten"
}

setup_emsdk

# Check-only mode
if [ "$CHECK_EMSDK_ONLY" = true ]; then
    echo ""
    log_success "Emscripten SDK is properly configured!"
    echo ""
    emcc --version
    echo ""
    log_info "EMSDK path: ${EMSDK}"
    log_info "Emscripten path: ${EMSCRIPTEN}"
    exit 0
fi

# ============================================================================
# Clean Build Directories
# ============================================================================

if [ "$CLEAN_BUILD" = true ]; then
    log_section "Cleaning Build Directories"

    for dir in "${BUILD_CORE}" "${BUILD_EXT_MATH}" "${BUILD_EXT_GEO}" "${BUILD_EXT_JSON}" "${BUILD_EXT_JSON_COLUMNAR}"; do
        if [ -d "${dir}" ]; then
            log_info "Removing ${dir}..."
            rm -rf "${dir}"
        fi
    done

    # Clean dist directories
    for dist_dir in "${CORE_DIR}/dist" "${EXT_DIR}/math/dist" "${EXT_DIR}/geo/dist" "${EXT_DIR}/json/dist" "${EXT_DIR}/json-columnar/dist"; do
        if [ -d "${dist_dir}" ]; then
            log_info "Cleaning ${dist_dir}..."
            rm -f "${dist_dir}"/*.wasm "${dist_dir}"/*.js 2>/dev/null || true
        fi
    done

    log_success "Clean complete"
fi

# ============================================================================
# Helper Functions
# ============================================================================

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
        echo "$(( size / 1024 ))KB"
    else
        echo "$(( size / 1048576 ))MB"
    fi
}

build_module() {
    local name="$1"
    local source_dir="$2"
    local build_dir="$3"
    local output_name="$4"

    log_section "Building ${name}"

    # Create build directory
    mkdir -p "${build_dir}"

    # Create dist directory
    mkdir -p "${source_dir}/dist"

    # CMake configure
    log_info "Configuring ${name}..."

    local cmake_args=(
        "-B" "${build_dir}"
        "-S" "${source_dir}"
        "-DCMAKE_BUILD_TYPE=${BUILD_TYPE}"
    )

    if [ "${BUILD_TYPE}" = "Debug" ]; then
        cmake_args+=("-DBUILD_DEBUG=ON")
    fi

    if [ "$VERBOSE" = true ]; then
        cmake_args+=("-DCMAKE_VERBOSE_MAKEFILE=ON")
    fi

    if ! emcmake cmake "${cmake_args[@]}"; then
        log_error "CMake configuration failed for ${name}"
        BUILD_FAILURES+=("${name}")
        if [ "$CONTINUE_ON_ERROR" = true ]; then
            return 0
        fi
        return 1
    fi

    # Build
    log_info "Building ${name}..."

    local build_args=("--build" "${build_dir}" "--parallel" "$(get_cpu_count)")

    if [ "$VERBOSE" = true ]; then
        build_args+=("--verbose")
    fi

    if ! emmake cmake "${build_args[@]}"; then
        log_error "Build failed for ${name}"
        BUILD_FAILURES+=("${name}")
        if [ "$CONTINUE_ON_ERROR" = true ]; then
            return 0
        fi
        return 1
    fi

    # Check output
    local output_file="${source_dir}/dist/${output_name}"
    if [ -f "${output_file}" ]; then
        local size=$(get_file_size "${output_file}")
        log_success "Built ${output_name} ($(format_size $size))"
        BUILD_SUCCESSES+=("${name}")
    else
        # Check build directory as fallback
        output_file="${build_dir}/${output_name}"
        if [ -f "${output_file}" ]; then
            # Copy to dist
            cp "${output_file}" "${source_dir}/dist/"
            local size=$(get_file_size "${output_file}")
            log_success "Built ${output_name} ($(format_size $size))"
            BUILD_SUCCESSES+=("${name}")
        else
            log_error "Output not found for ${name}"
            BUILD_FAILURES+=("${name}")
            if [ "$CONTINUE_ON_ERROR" = false ]; then
                return 1
            fi
        fi
    fi
}

# ============================================================================
# Build Core Module
# ============================================================================

if [ -z "$EXT_ONLY" ]; then
    build_module "Core MAIN_MODULE" "${CORE_DIR}" "${BUILD_CORE}" "core.js"

    # Core also produces core.wasm
    if [ -f "${CORE_DIR}/dist/core.wasm" ]; then
        log_success "Core WASM produced"
    elif [ -f "${BUILD_CORE}/core.wasm" ]; then
        cp "${BUILD_CORE}/core.wasm" "${CORE_DIR}/dist/"
        cp "${BUILD_CORE}/core.js" "${CORE_DIR}/dist/" 2>/dev/null || true
        log_success "Core WASM copied to dist"
    fi
fi

# ============================================================================
# Build Extension Modules (if not --core-only)
# ============================================================================

if [ "$CORE_ONLY" = false ]; then

    # Build Math Extension
    if [ -z "$EXT_ONLY" ] || [ "$EXT_ONLY" = "math" ]; then
        if [ -f "${EXT_DIR}/math/CMakeLists.txt" ]; then
            build_module "ext-math SIDE_MODULE" "${EXT_DIR}/math" "${BUILD_EXT_MATH}" "ext-math.wasm"
        else
            log_warn "Math extension CMakeLists.txt not found, skipping"
        fi
    fi

    # Build Geo Extension
    if [ -z "$EXT_ONLY" ] || [ "$EXT_ONLY" = "geo" ]; then
        if [ -f "${EXT_DIR}/geo/CMakeLists.txt" ]; then
            build_module "ext-geo SIDE_MODULE" "${EXT_DIR}/geo" "${BUILD_EXT_GEO}" "ext-geo.wasm"
        else
            log_warn "Geo extension CMakeLists.txt not found, skipping"
        fi
    fi

    # Build JSON Extension
    if [ -z "$EXT_ONLY" ] || [ "$EXT_ONLY" = "json" ]; then
        if [ -f "${EXT_DIR}/json/CMakeLists.txt" ]; then
            build_module "ext-json SIDE_MODULE" "${EXT_DIR}/json" "${BUILD_EXT_JSON}" "ext-json.wasm"
        else
            log_warn "JSON extension CMakeLists.txt not found, skipping"
        fi
    fi

    # Build JSON-Columnar Extension
    if [ -z "$EXT_ONLY" ] || [ "$EXT_ONLY" = "json-columnar" ]; then
        if [ -f "${EXT_DIR}/json-columnar/CMakeLists.txt" ]; then
            build_module "ext-json-columnar SIDE_MODULE" "${EXT_DIR}/json-columnar" "${BUILD_EXT_JSON_COLUMNAR}" "ext-json-columnar.wasm"
        else
            log_warn "JSON-Columnar extension CMakeLists.txt not found, skipping"
        fi
    fi
fi

# ============================================================================
# Copy to Modular Distribution Directory
# ============================================================================

log_section "Creating Distribution"

mkdir -p "${MODULAR_DIST}"

# Copy core module
if [ -f "${CORE_DIR}/dist/core.wasm" ]; then
    cp "${CORE_DIR}/dist/core.wasm" "${MODULAR_DIST}/"
    cp "${CORE_DIR}/dist/core.js" "${MODULAR_DIST}/" 2>/dev/null || true
    log_info "Copied core module to ${MODULAR_DIST}"
fi

# Copy extension modules
for ext in math geo json json-columnar; do
    ext_wasm="${EXT_DIR}/${ext}/dist/ext-${ext}.wasm"
    if [ -f "${ext_wasm}" ]; then
        cp "${ext_wasm}" "${MODULAR_DIST}/"
        log_info "Copied ext-${ext}.wasm to modular dist"
    fi
done

# ============================================================================
# Build Summary
# ============================================================================

log_section "Build Summary"

echo ""
echo -e "${BOLD}Core Module:${NC}"
if [ -f "${MODULAR_DIST}/core.wasm" ]; then
    echo "  core.wasm:     $(format_size $(get_file_size "${MODULAR_DIST}/core.wasm"))"
fi
if [ -f "${MODULAR_DIST}/core.js" ]; then
    echo "  core.js:       $(format_size $(get_file_size "${MODULAR_DIST}/core.js"))"
fi

echo ""
echo -e "${BOLD}Extension Modules:${NC}"
for ext in math geo json json-columnar; do
    ext_wasm="${MODULAR_DIST}/ext-${ext}.wasm"
    if [ -f "${ext_wasm}" ]; then
        echo "  ext-${ext}.wasm: $(format_size $(get_file_size "${ext_wasm}"))"
    fi
done

echo ""
echo -e "${BOLD}Output Directory:${NC}"
echo "  ${MODULAR_DIST}"
echo ""

# List all files in modular dist
log_info "Files in modular distribution:"
ls -la "${MODULAR_DIST}" 2>/dev/null || echo "  (none)"

# ============================================================================
# Build Results Summary
# ============================================================================

if [ ${#BUILD_SUCCESSES[@]} -gt 0 ]; then
    echo ""
    echo -e "${BOLD}Successfully Built:${NC}"
    for module in "${BUILD_SUCCESSES[@]}"; do
        echo -e "  ${GREEN}[OK]${NC} ${module}"
    done
fi

if [ ${#BUILD_FAILURES[@]} -gt 0 ]; then
    echo ""
    echo -e "${BOLD}Failed Builds:${NC}"
    for module in "${BUILD_FAILURES[@]}"; do
        echo -e "  ${RED}[FAIL]${NC} ${module}"
    done
fi

# ============================================================================
# Done
# ============================================================================

echo ""
echo -e "${BOLD}================================================================${NC}"
if [ ${#BUILD_FAILURES[@]} -gt 0 ]; then
    log_warn "BUILD COMPLETED WITH ERRORS"
    echo -e "${BOLD}================================================================${NC}"
    echo ""
    echo "Some modules failed to build. Run with --verbose for more details."
    echo "Failed modules may need source code fixes before they can be built."
    EXIT_CODE=1
else
    log_success "BUILD COMPLETE"
    echo -e "${BOLD}================================================================${NC}"
    EXIT_CODE=0
fi
echo ""
echo "To test the modules:"
echo "  node test/test-modular-wasm.mjs"
echo ""
echo "To load dynamically in JavaScript:"
echo "  const coreModule = await WebAssembly.instantiate(coreWasm, imports);"
echo "  const extModule = await coreModule.loadDynamicLibrary('ext-math.wasm');"
echo ""

exit ${EXIT_CODE:-0}
