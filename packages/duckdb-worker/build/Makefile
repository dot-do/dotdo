# =============================================================================
# DuckDB WASM Build Makefile for Cloudflare Workers
# =============================================================================
#
# This Makefile provides convenient targets for building DuckDB WASM.
#
# Usage:
#   make build          # Build release configuration
#   make build-debug    # Build with debug symbols
#   make build-size     # Build size-optimized
#   make shell          # Open shell in build container
#   make clean          # Clean build artifacts
#   make help           # Show available targets
#

# Configuration
IMAGE_NAME := duckdb-worker-builder
DUCKDB_VERSION ?= v1.1.3
DIST_DIR := $(shell pwd)/dist
WASM_DIR := ../wasm

# Docker build args
DOCKER_BUILD_ARGS := --build-arg DUCKDB_VERSION=$(DUCKDB_VERSION)

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Build Targets
# =============================================================================

.PHONY: build
build: docker-image ## Build release configuration
	@echo "Building DuckDB WASM (release)..."
	docker run --rm -v $(DIST_DIR):/output $(IMAGE_NAME) --release
	@$(MAKE) --no-print-directory copy-wasm

.PHONY: build-debug
build-debug: docker-image ## Build with debug symbols
	@echo "Building DuckDB WASM (debug)..."
	docker run --rm -v $(DIST_DIR):/output $(IMAGE_NAME) --debug
	@$(MAKE) --no-print-directory copy-wasm

.PHONY: build-size
build-size: docker-image ## Build size-optimized with closure compiler
	@echo "Building DuckDB WASM (size-optimized)..."
	docker run --rm -v $(DIST_DIR):/output $(IMAGE_NAME) --size
	@$(MAKE) --no-print-directory copy-wasm

# =============================================================================
# Docker Targets
# =============================================================================

.PHONY: docker-image
docker-image: ## Build Docker image
	@echo "Building Docker image (DuckDB $(DUCKDB_VERSION))..."
	docker build $(DOCKER_BUILD_ARGS) -t $(IMAGE_NAME) .

.PHONY: docker-image-no-cache
docker-image-no-cache: ## Build Docker image without cache
	@echo "Building Docker image without cache..."
	docker build --no-cache $(DOCKER_BUILD_ARGS) -t $(IMAGE_NAME) .

.PHONY: shell
shell: docker-image ## Open interactive shell in build container
	@echo "Opening shell in build container..."
	docker run --rm -it \
		-v $(DIST_DIR):/output \
		--entrypoint /bin/bash \
		$(IMAGE_NAME)

# =============================================================================
# Utility Targets
# =============================================================================

.PHONY: copy-wasm
copy-wasm: ## Copy WASM to package wasm directory
	@if [ -f $(DIST_DIR)/duckdb-worker.wasm ]; then \
		mkdir -p $(WASM_DIR); \
		cp $(DIST_DIR)/duckdb-worker.wasm $(WASM_DIR)/; \
		cp $(DIST_DIR)/duckdb-worker.d.ts $(WASM_DIR)/ 2>/dev/null || true; \
		echo "Copied WASM to $(WASM_DIR)"; \
		ls -lh $(WASM_DIR)/duckdb-worker.wasm; \
	else \
		echo "ERROR: No WASM file found in $(DIST_DIR)"; \
		exit 1; \
	fi

.PHONY: clean
clean: ## Clean build artifacts
	@echo "Cleaning build artifacts..."
	rm -rf $(DIST_DIR)
	rm -f $(WASM_DIR)/duckdb-worker.wasm
	rm -f $(WASM_DIR)/duckdb-worker.d.ts
	rm -f $(WASM_DIR)/duckdb-worker.js
	@echo "Clean complete."

.PHONY: clean-docker
clean-docker: clean ## Clean build artifacts and Docker image
	@echo "Removing Docker image..."
	docker rmi $(IMAGE_NAME) 2>/dev/null || true
	@echo "Docker cleanup complete."

.PHONY: verify
verify: ## Verify WASM file exists and check size
	@if [ -f $(WASM_DIR)/duckdb-worker.wasm ]; then \
		echo "WASM file found:"; \
		ls -lh $(WASM_DIR)/duckdb-worker.wasm; \
		echo ""; \
		echo "WASM sections:"; \
		wasm-objdump -h $(WASM_DIR)/duckdb-worker.wasm 2>/dev/null || echo "(wasm-objdump not available)"; \
	else \
		echo "ERROR: No WASM file found"; \
		echo "Run 'make build' first"; \
		exit 1; \
	fi

.PHONY: info
info: ## Show build configuration
	@echo "DuckDB WASM Build Configuration"
	@echo "================================"
	@echo "DuckDB Version: $(DUCKDB_VERSION)"
	@echo "Docker Image:   $(IMAGE_NAME)"
	@echo "Dist Directory: $(DIST_DIR)"
	@echo "WASM Directory: $(WASM_DIR)"
	@echo ""
	@echo "Docker:"
	@docker --version 2>/dev/null || echo "  Docker not installed"
	@echo ""
	@echo "Image Status:"
	@docker images $(IMAGE_NAME) --format "  {{.Repository}}:{{.Tag}} ({{.Size}})" 2>/dev/null || echo "  Not built"

# =============================================================================
# CI/CD Targets
# =============================================================================

.PHONY: ci-build
ci-build: ## Build for CI (with size verification)
	@$(MAKE) --no-print-directory build-size
	@$(MAKE) --no-print-directory verify
	@WASM_SIZE=$$(stat -f%z $(WASM_DIR)/duckdb-worker.wasm 2>/dev/null || stat -c%s $(WASM_DIR)/duckdb-worker.wasm); \
	if [ $$WASM_SIZE -gt 52428800 ]; then \
		echo "WARNING: WASM size ($$WASM_SIZE bytes) exceeds 50MB"; \
		echo "Consider disabling more extensions"; \
	fi

# =============================================================================
# Help
# =============================================================================

.PHONY: help
help: ## Show this help message
	@echo "DuckDB WASM Build for Cloudflare Workers"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'
	@echo ""
	@echo "Environment Variables:"
	@echo "  DUCKDB_VERSION   DuckDB version to build (default: $(DUCKDB_VERSION))"
	@echo ""
	@echo "Examples:"
	@echo "  make build                          # Build release"
	@echo "  make build-size                     # Build size-optimized"
	@echo "  DUCKDB_VERSION=v1.2.0 make build    # Build specific version"
