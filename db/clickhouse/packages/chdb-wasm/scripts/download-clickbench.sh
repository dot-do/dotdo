#!/bin/bash
# ============================================================================
# Download ClickBench Dataset
# ============================================================================
#
# This script downloads the ClickBench hits dataset from the official source.
# The dataset contains ~100M rows of web analytics data with 105 columns.
#
# Available formats:
# - Parquet (recommended): ~14GB
# - CSV: ~100GB compressed
# - TSV: Similar to CSV
# - JSONlines: ~100GB compressed
# - Native ClickHouse: Fastest for ClickHouse import
#
# Partitioned Parquet (100 files) is also available for parallel processing.
#
# Usage:
#   ./scripts/download-clickbench.sh [format] [output_dir]
#
# Examples:
#   ./scripts/download-clickbench.sh                    # Download Parquet to data/clickbench/
#   ./scripts/download-clickbench.sh parquet data/     # Download Parquet to data/
#   ./scripts/download-clickbench.sh partitioned       # Download partitioned Parquet
#   ./scripts/download-clickbench.sh subset            # Download first 1M rows subset
#
# ============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEFAULT_FORMAT="parquet"
DEFAULT_OUTPUT_DIR="data/clickbench"

# Dataset URLs
PARQUET_URL="https://datasets.clickhouse.com/hits_compatible/hits.parquet"
CSV_URL="https://datasets.clickhouse.com/hits_compatible/hits.csv.gz"
TSV_URL="https://datasets.clickhouse.com/hits_compatible/hits.tsv.gz"
JSON_URL="https://datasets.clickhouse.com/hits_compatible/hits.json.gz"
ATHENA_PARQUET_URL="https://datasets.clickhouse.com/hits_compatible/athena/hits.parquet"
PARTITIONED_BASE_URL="https://datasets.clickhouse.com/hits_compatible/athena_partitioned"

# Parse arguments
FORMAT="${1:-$DEFAULT_FORMAT}"
OUTPUT_DIR="${2:-$DEFAULT_OUTPUT_DIR}"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed."
        exit 1
    fi

    # Check for aria2c for faster downloads (optional)
    if command -v aria2c &> /dev/null; then
        log_info "aria2c detected - using parallel downloads"
        USE_ARIA2C=true
    else
        USE_ARIA2C=false
    fi
}

# Create output directory
create_output_dir() {
    log_info "Creating output directory: $OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
}

# Download with progress
download_file() {
    local url="$1"
    local output="$2"

    log_info "Downloading: $url"
    log_info "Output: $output"

    if [[ "$USE_ARIA2C" == true ]]; then
        aria2c -x 16 -s 16 -d "$(dirname "$output")" -o "$(basename "$output")" "$url"
    else
        curl -L --progress-bar -o "$output" "$url"
    fi

    log_success "Downloaded: $output"
}

# Download single Parquet file
download_parquet() {
    local output="$OUTPUT_DIR/hits.parquet"

    log_info "Downloading ClickBench dataset (Parquet format)"
    log_info "This file is approximately 14GB"

    download_file "$PARQUET_URL" "$output"

    # Verify download
    if [[ -f "$output" ]]; then
        local size=$(du -h "$output" | cut -f1)
        log_success "Download complete: $output ($size)"
    else
        log_error "Download failed"
        exit 1
    fi
}

# Download Athena-compatible Parquet
download_athena_parquet() {
    local output="$OUTPUT_DIR/hits_athena.parquet"

    log_info "Downloading ClickBench dataset (Athena-compatible Parquet)"

    download_file "$ATHENA_PARQUET_URL" "$output"
}

# Download partitioned Parquet files (100 files)
download_partitioned() {
    local output_subdir="$OUTPUT_DIR/partitioned"
    mkdir -p "$output_subdir"

    log_info "Downloading ClickBench dataset (Partitioned Parquet - 100 files)"
    log_info "Output directory: $output_subdir"

    # Download all 100 partitions
    for i in $(seq 0 99); do
        local padded_i=$(printf "%d" $i)
        local url="${PARTITIONED_BASE_URL}/hits_${padded_i}.parquet"
        local output="$output_subdir/hits_${padded_i}.parquet"

        if [[ -f "$output" ]]; then
            log_info "Skipping existing file: hits_${padded_i}.parquet"
            continue
        fi

        log_info "Downloading partition $((i+1))/100..."
        download_file "$url" "$output"
    done

    log_success "All partitions downloaded to: $output_subdir"
}

# Download CSV (compressed)
download_csv() {
    local output="$OUTPUT_DIR/hits.csv.gz"

    log_info "Downloading ClickBench dataset (CSV format, gzipped)"
    log_warning "This file is approximately 100GB compressed"

    download_file "$CSV_URL" "$output"
}

# Download TSV (compressed)
download_tsv() {
    local output="$OUTPUT_DIR/hits.tsv.gz"

    log_info "Downloading ClickBench dataset (TSV format, gzipped)"
    log_warning "This file is approximately 100GB compressed"

    download_file "$TSV_URL" "$output"
}

# Download JSON (compressed)
download_json() {
    local output="$OUTPUT_DIR/hits.json.gz"

    log_info "Downloading ClickBench dataset (JSONlines format, gzipped)"
    log_warning "This file is approximately 100GB compressed"

    download_file "$JSON_URL" "$output"
}

# Download a subset (first partition only for quick tests)
download_subset() {
    local output="$OUTPUT_DIR/hits_subset.parquet"
    local url="${PARTITIONED_BASE_URL}/hits_0.parquet"

    log_info "Downloading ClickBench subset (~1M rows, first partition)"
    log_info "This is approximately 140MB"

    download_file "$url" "$output"

    if [[ -f "$output" ]]; then
        local size=$(du -h "$output" | cut -f1)
        log_success "Subset download complete: $output ($size)"
        log_info "This subset contains approximately 1M rows from the full dataset"
    fi
}

# Show available formats
show_formats() {
    echo ""
    echo "Available formats:"
    echo "  parquet      - Single Parquet file (~14GB)"
    echo "  athena       - Athena-compatible Parquet"
    echo "  partitioned  - 100 partitioned Parquet files"
    echo "  csv          - CSV format, gzipped (~100GB)"
    echo "  tsv          - TSV format, gzipped (~100GB)"
    echo "  json         - JSONlines format, gzipped (~100GB)"
    echo "  subset       - First partition only (~1M rows, ~140MB)"
    echo ""
}

# Print schema information
print_schema_info() {
    echo ""
    log_info "ClickBench Dataset Schema (105 columns):"
    echo ""
    cat << 'EOF'
Key columns:
  - WatchID (UInt64): Unique event identifier
  - JavaEnable (UInt8): Java enabled flag
  - Title (String): Page title
  - GoodEvent (Int16): Event quality flag
  - EventTime (DateTime): Event timestamp
  - EventDate (Date): Event date
  - CounterID (UInt32): Counter identifier
  - ClientIP (UInt32): Client IP address
  - RegionID (UInt32): Region identifier
  - UserID (UInt64): User identifier
  - URL (String): Page URL
  - Referer (String): Referrer URL
  - ResolutionWidth (UInt16): Screen width
  - ResolutionHeight (UInt16): Screen height
  ... and 90+ more columns

Total rows: ~99,997,497
Typical Parquet size: ~14GB

For complete schema, see: https://github.com/ClickHouse/ClickBench
EOF
    echo ""
}

# Main
main() {
    echo ""
    echo "=============================================="
    echo "  ClickBench Dataset Downloader"
    echo "=============================================="
    echo ""

    check_prerequisites
    create_output_dir

    case "$FORMAT" in
        parquet)
            download_parquet
            ;;
        athena)
            download_athena_parquet
            ;;
        partitioned)
            download_partitioned
            ;;
        csv)
            download_csv
            ;;
        tsv)
            download_tsv
            ;;
        json)
            download_json
            ;;
        subset)
            download_subset
            ;;
        help|--help|-h)
            show_formats
            print_schema_info
            exit 0
            ;;
        *)
            log_error "Unknown format: $FORMAT"
            show_formats
            exit 1
            ;;
    esac

    echo ""
    log_success "Download complete!"
    log_info "Output directory: $OUTPUT_DIR"
    echo ""

    # Show next steps
    echo "Next steps:"
    echo "  1. Prepare data for R2: npx tsx scripts/prepare-clickbench.ts"
    echo "  2. Upload to R2: wrangler r2 object put clickbench-data/hits.parquet --file $OUTPUT_DIR/hits.parquet"
    echo ""
}

main
