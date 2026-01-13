#!/usr/bin/env bash
#
# Setup Cloudflare Pipelines for Artifact Storage
#
# Creates three pipelines with different batch configurations:
# - artifacts-preview: Fast visibility for development (100KB, 5s)
# - artifacts-build: Balanced for CI/CD (1MB, 30s)
# - artifacts-bulk: Efficient for migrations (5MB, 120s)
#
# All pipelines write to the artifacts-lake R2 bucket with Parquet format.
#
# Usage:
#   ./scripts/setup-pipelines.sh         # Create all pipelines
#   ./scripts/setup-pipelines.sh --list  # List existing pipelines
#   ./scripts/setup-pipelines.sh --help  # Show help
#
# Prerequisites:
#   - wrangler authenticated (run: npx wrangler login)
#   - artifacts-lake R2 bucket exists (created via wrangler or dashboard)
#

set -euo pipefail

BUCKET="artifacts-lake"
PARTITIONS="ns,type"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
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
Setup Cloudflare Pipelines for Artifact Storage

Usage:
  ./scripts/setup-pipelines.sh           Create all pipelines
  ./scripts/setup-pipelines.sh --list    List existing pipelines
  ./scripts/setup-pipelines.sh --delete  Delete all artifact pipelines
  ./scripts/setup-pipelines.sh --help    Show this help

Pipelines Created:
  artifacts-preview  Small batches (100KB, 5s) for dev/testing
  artifacts-build    Balanced batches (1MB, 30s) for CI/CD
  artifacts-bulk     Large batches (5MB, 120s) for migrations/analytics

Prerequisites:
  1. Run 'npx wrangler login' to authenticate
  2. Create the artifacts-lake R2 bucket:
     npx wrangler r2 bucket create artifacts-lake

Environment:
  Pipelines will write Parquet files to R2 bucket: ${BUCKET}
  Partitioned by: ${PARTITIONS}
EOF
}

list_pipelines() {
  log_info "Listing existing pipelines..."
  npx wrangler pipelines list
}

create_pipeline() {
  local name=$1
  local max_mb=$2
  local max_rows=$3
  local max_seconds=$4

  log_info "Creating pipeline: ${name}"
  log_info "  Batch: ${max_mb}MB / ${max_rows} rows / ${max_seconds}s"
  log_info "  Destination: R2 bucket '${BUCKET}' with Parquet format"
  log_info "  Partitions: ${PARTITIONS}"

  # Check if pipeline already exists
  if npx wrangler pipelines show "${name}" &>/dev/null; then
    log_warn "Pipeline '${name}' already exists, skipping..."
    return 0
  fi

  npx wrangler pipelines create "${name}" \
    --batch-max-mb "${max_mb}" \
    --batch-max-rows "${max_rows}" \
    --batch-max-seconds "${max_seconds}" \
    --r2 "${BUCKET}" \
    --partition-by "${PARTITIONS}"

  log_info "Pipeline '${name}' created successfully"
}

delete_pipelines() {
  log_warn "Deleting artifact pipelines..."

  for pipeline in artifacts-preview artifacts-build artifacts-bulk; do
    if npx wrangler pipelines show "${pipeline}" &>/dev/null; then
      log_info "Deleting pipeline: ${pipeline}"
      npx wrangler pipelines delete "${pipeline}" --yes
    else
      log_info "Pipeline '${pipeline}' does not exist"
    fi
  done

  log_info "Deletion complete"
}

create_all_pipelines() {
  log_info "Setting up Cloudflare Pipelines for artifact storage..."
  echo ""

  # artifacts-preview: Fast visibility for development
  # 100KB max batch, 1000 rows, 5 second timeout
  create_pipeline "artifacts-preview" "0.1" "1000" "5"
  echo ""

  # artifacts-build: Balanced for CI/CD
  # 1MB max batch, 10000 rows, 30 second timeout
  create_pipeline "artifacts-build" "1" "10000" "30"
  echo ""

  # artifacts-bulk: Efficient for migrations/analytics
  # 5MB max batch, 100000 rows, 120 second timeout
  create_pipeline "artifacts-bulk" "5" "100000" "120"
  echo ""

  log_info "Pipeline setup complete!"
  echo ""
  log_info "Next steps:"
  echo "  1. Deploy your Worker: npx wrangler deploy"
  echo "  2. Use env.ARTIFACTS_PREVIEW.send([...]) for fast writes"
  echo "  3. Use env.ARTIFACTS_BUILD.send([...]) for production writes"
  echo "  4. Use env.ARTIFACTS_BULK.send([...]) for batch imports"
}

# Main
case "${1:-}" in
  --help|-h)
    show_help
    ;;
  --list|-l)
    list_pipelines
    ;;
  --delete|-d)
    delete_pipelines
    ;;
  *)
    create_all_pipelines
    ;;
esac
