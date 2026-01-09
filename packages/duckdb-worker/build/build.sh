#!/bin/bash
# =============================================================================
# Local Build Helper for DuckDB WASM Workers Build
# =============================================================================
#
# This script provides a convenient interface for building DuckDB WASM
# locally using Docker. It handles all the container management.
#
# Usage:
#   ./build.sh                    # Build release (default)
#   ./build.sh --debug            # Build with debug symbols
#   ./build.sh --size             # Build size-optimized
#   ./build.sh --clean            # Clean and rebuild
#   ./build.sh --shell            # Open shell in build container
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${SCRIPT_DIR}/dist"
IMAGE_NAME="duckdb-worker-builder"
DUCKDB_VERSION="${DUCKDB_VERSION:-v1.1.3}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
DuckDB WASM Builder for Cloudflare Workers

Usage: $(basename "$0") [OPTIONS]

Options:
    --release       Build release configuration (default)
    --debug         Build with debug symbols and assertions
    --size          Build size-optimized with closure compiler
    --clean         Clean build artifacts and rebuild
    --shell         Open interactive shell in build container
    --no-cache      Build Docker image without cache
    --version VER   Use specific DuckDB version (default: ${DUCKDB_VERSION})
    --help          Show this help message

Environment Variables:
    DUCKDB_VERSION  DuckDB version to build (default: ${DUCKDB_VERSION})

Examples:
    $(basename "$0")                      # Build release
    $(basename "$0") --size               # Size-optimized build
    $(basename "$0") --version v1.0.0     # Build specific version
    DUCKDB_VERSION=main $(basename "$0")  # Build from main branch
EOF
}

# Parse arguments
BUILD_TYPE="--release"
DOCKER_NO_CACHE=""
OPEN_SHELL=false
CLEAN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --release)
            BUILD_TYPE="--release"
            shift
            ;;
        --debug)
            BUILD_TYPE="--debug"
            shift
            ;;
        --size)
            BUILD_TYPE="--size"
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --shell)
            OPEN_SHELL=true
            shift
            ;;
        --no-cache)
            DOCKER_NO_CACHE="--no-cache"
            shift
            ;;
        --version)
            DUCKDB_VERSION="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check Docker is available
if ! command -v docker &> /dev/null; then
    log_error "Docker is required but not installed."
    log_info "Install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check Docker daemon is running
if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running."
    log_info "Please start Docker and try again."
    exit 1
fi

# Clean if requested
if [ "$CLEAN" = true ]; then
    log_info "Cleaning build artifacts..."
    rm -rf "${DIST_DIR}"
    docker rmi "${IMAGE_NAME}" 2>/dev/null || true
    log_info "Clean complete."
fi

# Create output directory
mkdir -p "${DIST_DIR}"

# Build Docker image
log_info "Building Docker image (DuckDB ${DUCKDB_VERSION})..."
log_info "This may take a few minutes on first run..."

docker build \
    ${DOCKER_NO_CACHE} \
    --build-arg DUCKDB_VERSION="${DUCKDB_VERSION}" \
    -t "${IMAGE_NAME}" \
    "${SCRIPT_DIR}"

# Check if we should open shell
if [ "$OPEN_SHELL" = true ]; then
    log_info "Opening interactive shell in build container..."
    docker run --rm -it \
        -v "${DIST_DIR}:/output" \
        --entrypoint /bin/bash \
        "${IMAGE_NAME}"
    exit 0
fi

# Run the build
log_info "Building DuckDB WASM (${BUILD_TYPE})..."
log_info "Output will be in: ${DIST_DIR}"

START_TIME=$(date +%s)

docker run --rm \
    -v "${DIST_DIR}:/output" \
    "${IMAGE_NAME}" \
    "${BUILD_TYPE}"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Verify output
if [ -f "${DIST_DIR}/duckdb-worker.wasm" ]; then
    WASM_SIZE=$(ls -lh "${DIST_DIR}/duckdb-worker.wasm" | awk '{print $5}')
    log_info "Build successful! (${DURATION}s)"
    echo ""
    echo "Output files:"
    ls -la "${DIST_DIR}"
    echo ""
    log_info "WASM size: ${WASM_SIZE}"
    echo ""
    echo "To use in your Workers project:"
    echo "  1. Copy dist/duckdb-worker.wasm to your project"
    echo "  2. Import as: import wasmModule from './duckdb-worker.wasm'"
    echo "  3. Instantiate with WebAssembly.instantiate(wasmModule, imports)"
else
    log_error "Build failed - no WASM output found"
    exit 1
fi
