#!/bin/bash
# ClickBench Data Preparation Script
#
# Prepares the ClickBench dataset for deployment to Cloudflare R2.
#
# Dataset: https://datasets.clickhouse.com/hits_compatible/hits.parquet
# Schema: 105 columns, 99,997,497 rows, ~14.7 GB Parquet
#
# Usage:
#   ./prepare-clickbench.sh [OPTIONS]
#
# Options:
#   --full          Download full dataset (~14.7 GB)
#   --sample N      Create sample with N rows (default: 1000000)
#   --partition N   Partition into N files
#   --upload        Upload to R2
#   --r2-bucket     R2 bucket name (default: chdb-data)
#   --help          Show this help message
#
# Environment Variables:
#   R2_ACCESS_KEY_ID       - Cloudflare R2 access key
#   R2_SECRET_ACCESS_KEY   - Cloudflare R2 secret key
#   R2_ACCOUNT_ID          - Cloudflare account ID
#   R2_ENDPOINT            - R2 S3-compatible endpoint

set -euo pipefail

# Configuration
DATASET_URL="https://datasets.clickhouse.com/hits_compatible/hits.parquet"
DATA_DIR="./data/clickbench"
SAMPLE_SIZE=1000000
PARTITION_COUNT=0
DO_UPLOAD=false
R2_BUCKET="${R2_BUCKET:-chdb-data}"
FULL_DATASET=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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
    exit 1
}

show_help() {
    cat << 'EOF'
ClickBench Data Preparation Script

USAGE:
    ./prepare-clickbench.sh [OPTIONS]

OPTIONS:
    --full              Download full dataset (~14.7 GB)
    --sample N          Create sample with N rows (default: 1000000)
    --partition N       Partition data into N files
    --upload            Upload to Cloudflare R2
    --r2-bucket NAME    R2 bucket name (default: chdb-data)
    --data-dir DIR      Data directory (default: ./data/clickbench)
    --help              Show this help message

ENVIRONMENT:
    R2_ACCESS_KEY_ID        Cloudflare R2 access key
    R2_SECRET_ACCESS_KEY    Cloudflare R2 secret key
    R2_ACCOUNT_ID           Cloudflare account ID

EXAMPLES:
    # Download sample dataset (1M rows)
    ./prepare-clickbench.sh --sample 1000000

    # Download full dataset
    ./prepare-clickbench.sh --full

    # Download sample and partition into 10 files
    ./prepare-clickbench.sh --sample 1000000 --partition 10

    # Download and upload to R2
    ./prepare-clickbench.sh --sample 1000000 --upload

DATA SIZES:
    Full dataset:   ~14.7 GB (Parquet), ~99.9M rows
    Sample 10M:     ~1.5 GB
    Sample 1M:      ~150 MB
    Sample 100K:    ~15 MB

SCHEMA:
    The hits table has 105 columns including:
    - WatchID, JavaEnable, Title, GoodEvent, EventTime, EventDate
    - CounterID, ClientIP, RegionID, UserID
    - URL, Referer, SearchPhrase, SearchEngineID
    - UserAgent, OS, IsMobile, ResolutionWidth/Height
    - And many more web analytics fields

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --full)
            FULL_DATASET=true
            SAMPLE_SIZE=0
            shift
            ;;
        --sample)
            SAMPLE_SIZE="$2"
            shift 2
            ;;
        --partition)
            PARTITION_COUNT="$2"
            shift 2
            ;;
        --upload)
            DO_UPLOAD=true
            shift
            ;;
        --r2-bucket)
            R2_BUCKET="$2"
            shift 2
            ;;
        --data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            ;;
    esac
done

# Check dependencies
check_dependencies() {
    log_info "Checking dependencies..."

    local missing=()

    if ! command -v curl &> /dev/null; then
        missing+=("curl")
    fi

    if ! command -v duckdb &> /dev/null; then
        log_warn "DuckDB CLI not found. Install with: brew install duckdb"
        log_warn "Will use Python for data processing if available"
    fi

    if [ "$DO_UPLOAD" = true ]; then
        if ! command -v aws &> /dev/null && ! command -v wrangler &> /dev/null; then
            log_warn "Neither AWS CLI nor Wrangler found. Install one for R2 upload."
            missing+=("aws-cli or wrangler")
        fi
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing[*]}"
    fi

    log_success "Dependencies OK"
}

# Create data directory
setup_dirs() {
    log_info "Creating data directories..."
    mkdir -p "$DATA_DIR"
    mkdir -p "$DATA_DIR/partitions"
    log_success "Directories created: $DATA_DIR"
}

# Download dataset
download_dataset() {
    local output_file="$DATA_DIR/hits.parquet"

    if [ -f "$output_file" ]; then
        log_warn "Dataset already exists: $output_file"
        read -p "Redownload? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return
        fi
    fi

    log_info "Downloading ClickBench dataset..."
    log_info "URL: $DATASET_URL"
    log_info "This may take a while (~14.7 GB)..."

    curl -L --progress-bar -o "$output_file" "$DATASET_URL"

    local size=$(du -h "$output_file" | cut -f1)
    log_success "Downloaded: $output_file ($size)"
}

# Create sample dataset
create_sample() {
    if [ "$SAMPLE_SIZE" -eq 0 ]; then
        log_info "Using full dataset (no sampling)"
        return
    fi

    local input_file="$DATA_DIR/hits.parquet"
    local output_file="$DATA_DIR/hits_sample_${SAMPLE_SIZE}.parquet"

    if [ ! -f "$input_file" ]; then
        log_error "Input file not found: $input_file"
    fi

    log_info "Creating sample with $SAMPLE_SIZE rows..."

    if command -v duckdb &> /dev/null; then
        duckdb -c "
            COPY (
                SELECT * FROM read_parquet('$input_file')
                LIMIT $SAMPLE_SIZE
            ) TO '$output_file' (FORMAT PARQUET, COMPRESSION ZSTD);
        "
    elif command -v python3 &> /dev/null; then
        python3 << EOF
import pyarrow.parquet as pq
import pyarrow as pa

print("Reading parquet file...")
table = pq.read_table('$input_file')
print(f"Total rows: {table.num_rows}")

print("Creating sample...")
sample = table.slice(0, $SAMPLE_SIZE)
print(f"Sample rows: {sample.num_rows}")

print("Writing sample...")
pq.write_table(sample, '$output_file', compression='ZSTD')
print("Done!")
EOF
    else
        log_error "Neither DuckDB nor Python available for sampling"
    fi

    local size=$(du -h "$output_file" | cut -f1)
    log_success "Created sample: $output_file ($size)"
}

# Partition dataset
partition_dataset() {
    if [ "$PARTITION_COUNT" -eq 0 ]; then
        log_info "No partitioning requested"
        return
    fi

    local input_file
    if [ "$SAMPLE_SIZE" -gt 0 ]; then
        input_file="$DATA_DIR/hits_sample_${SAMPLE_SIZE}.parquet"
    else
        input_file="$DATA_DIR/hits.parquet"
    fi

    if [ ! -f "$input_file" ]; then
        log_error "Input file not found: $input_file"
    fi

    log_info "Partitioning into $PARTITION_COUNT files..."

    if command -v duckdb &> /dev/null; then
        duckdb << EOF
-- Calculate rows per partition
CREATE TEMP TABLE source AS SELECT *, row_number() OVER () as rn FROM read_parquet('$input_file');
CREATE TEMP TABLE total_count AS SELECT COUNT(*) as cnt FROM source;

-- Export partitions
$(for i in $(seq 0 $((PARTITION_COUNT - 1))); do
    echo "COPY (
        SELECT * EXCLUDE (rn) FROM source
        WHERE (rn - 1) % $PARTITION_COUNT = $i
    ) TO '$DATA_DIR/partitions/hits_part_${i}.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);"
done)
EOF
    else
        log_error "DuckDB required for partitioning"
    fi

    log_success "Created $PARTITION_COUNT partitions in $DATA_DIR/partitions/"
    ls -lh "$DATA_DIR/partitions/"
}

# Upload to R2
upload_to_r2() {
    if [ "$DO_UPLOAD" != true ]; then
        log_info "Upload not requested (use --upload)"
        return
    fi

    # Check for required environment variables
    if [ -z "${R2_ACCESS_KEY_ID:-}" ] || [ -z "${R2_SECRET_ACCESS_KEY:-}" ]; then
        log_error "R2 credentials not set. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY"
    fi

    if [ -z "${R2_ACCOUNT_ID:-}" ]; then
        log_error "R2_ACCOUNT_ID not set"
    fi

    local endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

    log_info "Uploading to R2..."
    log_info "Bucket: $R2_BUCKET"
    log_info "Endpoint: $endpoint"

    # Configure AWS CLI for R2
    export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

    # Upload main file
    local main_file
    if [ "$SAMPLE_SIZE" -gt 0 ]; then
        main_file="$DATA_DIR/hits_sample_${SAMPLE_SIZE}.parquet"
    else
        main_file="$DATA_DIR/hits.parquet"
    fi

    if [ -f "$main_file" ]; then
        log_info "Uploading $(basename "$main_file")..."
        aws s3 cp "$main_file" "s3://$R2_BUCKET/clickbench/$(basename "$main_file")" \
            --endpoint-url "$endpoint"
        log_success "Uploaded: $(basename "$main_file")"
    fi

    # Upload partitions if they exist
    if [ -d "$DATA_DIR/partitions" ] && [ "$(ls -A "$DATA_DIR/partitions" 2>/dev/null)" ]; then
        log_info "Uploading partitions..."
        aws s3 sync "$DATA_DIR/partitions" "s3://$R2_BUCKET/clickbench/partitions/" \
            --endpoint-url "$endpoint"
        log_success "Uploaded partitions"
    fi

    log_success "R2 upload complete!"
}

# Generate manifest file
generate_manifest() {
    local manifest_file="$DATA_DIR/manifest.json"

    log_info "Generating manifest..."

    local files=()
    local total_size=0

    # Add main file
    local main_file
    if [ "$SAMPLE_SIZE" -gt 0 ]; then
        main_file="$DATA_DIR/hits_sample_${SAMPLE_SIZE}.parquet"
    else
        main_file="$DATA_DIR/hits.parquet"
    fi

    if [ -f "$main_file" ]; then
        local size=$(stat -f%z "$main_file" 2>/dev/null || stat -c%s "$main_file")
        total_size=$((total_size + size))
    fi

    # Count partitions
    local partition_count=0
    if [ -d "$DATA_DIR/partitions" ]; then
        partition_count=$(ls -1 "$DATA_DIR/partitions"/*.parquet 2>/dev/null | wc -l | tr -d ' ')
    fi

    cat > "$manifest_file" << EOF
{
  "name": "ClickBench hits dataset",
  "source": "$DATASET_URL",
  "table": "hits",
  "format": "parquet",
  "compression": "zstd",
  "schema_version": "1.0",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sample_size": $SAMPLE_SIZE,
  "partition_count": $partition_count,
  "files": {
    "main": "$(basename "$main_file")",
    "partitions_dir": "partitions/"
  },
  "r2_bucket": "$R2_BUCKET",
  "r2_path": "clickbench/",
  "schema": {
    "columns": 105,
    "description": "Web analytics data with user events, page views, and attribution"
  }
}
EOF

    log_success "Manifest created: $manifest_file"
    cat "$manifest_file"
}

# Print summary
print_summary() {
    echo
    echo "============================================"
    echo "ClickBench Data Preparation Summary"
    echo "============================================"
    echo
    echo "Dataset URL:    $DATASET_URL"
    echo "Data directory: $DATA_DIR"
    echo "Sample size:    $( [ "$SAMPLE_SIZE" -eq 0 ] && echo 'Full dataset' || echo "$SAMPLE_SIZE rows" )"
    echo "Partitions:     $( [ "$PARTITION_COUNT" -eq 0 ] && echo 'None' || echo "$PARTITION_COUNT files" )"
    echo "R2 upload:      $( [ "$DO_UPLOAD" = true ] && echo 'Yes' || echo 'No' )"
    echo
    echo "Files created:"
    ls -lh "$DATA_DIR"/*.parquet 2>/dev/null || echo "  (none)"
    echo
    if [ -d "$DATA_DIR/partitions" ] && [ "$(ls -A "$DATA_DIR/partitions" 2>/dev/null)" ]; then
        echo "Partitions:"
        ls -lh "$DATA_DIR/partitions/"
    fi
    echo
    echo "Next steps:"
    if [ "$DO_UPLOAD" != true ]; then
        echo "  1. Run with --upload to upload to R2"
    fi
    echo "  2. Update worker configuration with R2 paths"
    echo "  3. Run benchmarks with: npx tsx benchmarks/run-clickbench.ts"
    echo
}

# Main execution
main() {
    echo "========================================"
    echo "ClickBench Data Preparation"
    echo "========================================"
    echo

    check_dependencies
    setup_dirs

    if [ "$FULL_DATASET" = true ] || [ "$SAMPLE_SIZE" -gt 0 ]; then
        download_dataset

        if [ "$SAMPLE_SIZE" -gt 0 ]; then
            create_sample
        fi

        partition_dataset
    fi

    upload_to_r2
    generate_manifest
    print_summary
}

main
