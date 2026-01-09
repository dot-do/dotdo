# DuckDB WASM Builder for Cloudflare Workers
#
# This Dockerfile creates a build environment for compiling DuckDB to WASM
# with flags optimized for Cloudflare Workers runtime compatibility.
#
# Key Workers constraints addressed:
# - No GOT.func/GOT.mem dynamic linking (use -sMAIN_MODULE=0)
# - No SharedArrayBuffer (single-threaded only)
# - Memory limits (128MB max)
# - No filesystem access (memory-only FS)
# - Synchronous WASM instantiation at deploy time
#
# Usage:
#   docker build -t duckdb-worker-builder .
#   docker run --rm -v $(pwd)/dist:/output duckdb-worker-builder

FROM emscripten/emsdk:3.1.50

# Install build dependencies
RUN apt-get update && apt-get install -y \
    cmake \
    ninja-build \
    git \
    python3 \
    python3-pip \
    ccache \
    && rm -rf /var/lib/apt/lists/*

# Set up ccache for faster rebuilds
ENV CCACHE_DIR=/ccache
ENV CMAKE_C_COMPILER_LAUNCHER=ccache
ENV CMAKE_CXX_COMPILER_LAUNCHER=ccache

WORKDIR /build

# Clone DuckDB at specified version
ARG DUCKDB_VERSION=v1.1.3
RUN git clone --depth 1 --branch ${DUCKDB_VERSION} https://github.com/duckdb/duckdb.git

# Copy build scripts
COPY build-workers.sh /build/
COPY patches/ /build/patches/
RUN chmod +x /build/build-workers.sh

# Create output directory
RUN mkdir -p /output

# Set default output location
ENV OUTPUT_DIR=/output

# Entry point runs the build script
ENTRYPOINT ["/build/build-workers.sh"]

# Default command (can be overridden)
CMD ["--release"]
