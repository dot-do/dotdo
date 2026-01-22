#!/bin/bash
#
# ClickBench R2 Setup Script
# Downloads ClickBench hits dataset and uploads to Cloudflare R2
#

set -e

# Configuration
BUCKET_NAME="${R2_BUCKET:-clickbench-data}"
DATA_DIR="${DATA_DIR:-./data}"
PARQUET_URL="https://datasets.clickhouse.com/hits_compatible/hits.parquet"
PARTITIONED_BASE_URL="https://datasets.clickhouse.com/hits_compatible/athena_partitioned"

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

check_dependencies() {
    log_info "Checking dependencies..."

    if ! command -v curl &> /dev/null; then
        log_error "curl is required but not installed."
        exit 1
    fi

    if ! command -v rclone &> /dev/null; then
        log_warn "rclone not found. Checking for AWS CLI..."
        if ! command -v aws &> /dev/null; then
            log_error "Neither rclone nor AWS CLI found. Please install one of them."
            log_info "Install rclone: brew install rclone (macOS) or curl https://rclone.org/install.sh | sudo bash"
            exit 1
        fi
        USE_AWS_CLI=true
    else
        USE_AWS_CLI=false
    fi
}

check_r2_config() {
    log_info "Checking R2 configuration..."

    if [ "$USE_AWS_CLI" = true ]; then
        if [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ] || [ -z "$R2_ACCOUNT_ID" ]; then
            log_error "R2 credentials not set. Please set the following environment variables:"
            log_info "  export R2_ACCESS_KEY_ID='your_access_key'"
            log_info "  export R2_SECRET_ACCESS_KEY='your_secret_key'"
            log_info "  export R2_ACCOUNT_ID='your_account_id'"
            exit 1
        fi
        R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    else
        if ! rclone listremotes | grep -q "r2:"; then
            log_error "rclone remote 'r2' not configured. Please run 'rclone config' to set up R2."
            exit 1
        fi
    fi
}

download_single_file() {
    log_info "Downloading single Parquet file (~15GB)..."
    mkdir -p "$DATA_DIR"

    if [ -f "$DATA_DIR/hits.parquet" ]; then
        log_warn "File already exists: $DATA_DIR/hits.parquet"
        read -p "Re-download? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            return
        fi
    fi

    curl -L --progress-bar -o "$DATA_DIR/hits.parquet" "$PARQUET_URL"
    log_info "Download complete: $DATA_DIR/hits.parquet"
}

download_partitioned() {
    log_info "Downloading partitioned Parquet files (100 files)..."
    mkdir -p "$DATA_DIR/partitioned"

    for i in $(seq 0 99); do
        FILE="hits_$i.parquet"
        if [ -f "$DATA_DIR/partitioned/$FILE" ]; then
            log_info "Skipping existing file: $FILE"
            continue
        fi
        log_info "Downloading $FILE... ($((i+1))/100)"
        curl -L --progress-bar -o "$DATA_DIR/partitioned/$FILE" "$PARTITIONED_BASE_URL/hits_$i.parquet"
    done

    log_info "Download complete: $DATA_DIR/partitioned/"
}

upload_to_r2() {
    local src="$1"
    local dest="$2"

    log_info "Uploading to R2: $src -> $BUCKET_NAME/$dest"

    if [ "$USE_AWS_CLI" = true ]; then
        AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
        aws s3 cp "$src" "s3://$BUCKET_NAME/$dest" \
            --endpoint-url "$R2_ENDPOINT" \
            --cache-control "public, max-age=31536000, immutable"
    else
        rclone copy "$src" "r2:$BUCKET_NAME/$dest" \
            --header-upload "Cache-Control: public, max-age=31536000, immutable" \
            --progress
    fi
}

upload_single_file() {
    if [ ! -f "$DATA_DIR/hits.parquet" ]; then
        log_error "File not found: $DATA_DIR/hits.parquet"
        log_info "Run with --download first"
        exit 1
    fi

    upload_to_r2 "$DATA_DIR/hits.parquet" "hits.parquet"
    log_info "Upload complete!"
}

upload_partitioned() {
    if [ ! -d "$DATA_DIR/partitioned" ]; then
        log_error "Directory not found: $DATA_DIR/partitioned"
        log_info "Run with --download-partitioned first"
        exit 1
    fi

    if [ "$USE_AWS_CLI" = true ]; then
        AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
        aws s3 sync "$DATA_DIR/partitioned" "s3://$BUCKET_NAME/partitioned/" \
            --endpoint-url "$R2_ENDPOINT" \
            --cache-control "public, max-age=31536000, immutable"
    else
        rclone sync "$DATA_DIR/partitioned" "r2:$BUCKET_NAME/partitioned/" \
            --header-upload "Cache-Control: public, max-age=31536000, immutable" \
            --progress
    fi

    log_info "Upload complete!"
}

verify_upload() {
    log_info "Verifying R2 upload..."

    if [ "$USE_AWS_CLI" = true ]; then
        AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
        AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
        aws s3 ls "s3://$BUCKET_NAME/" --endpoint-url "$R2_ENDPOINT"
    else
        rclone ls "r2:$BUCKET_NAME/"
    fi
}

cleanup() {
    log_info "Cleaning up local data..."
    rm -rf "$DATA_DIR"
    log_info "Cleanup complete!"
}

show_help() {
    cat << EOF
ClickBench R2 Setup Script

Usage: $0 [options]

Options:
    --download              Download single Parquet file (~15GB)
    --download-partitioned  Download partitioned Parquet files (100 files)
    --upload                Upload single file to R2
    --upload-partitioned    Upload partitioned files to R2
    --verify                Verify R2 upload
    --cleanup               Remove local data files
    --all                   Download single file and upload to R2
    --all-partitioned       Download partitioned and upload to R2
    -h, --help              Show this help message

Environment Variables:
    R2_BUCKET               R2 bucket name (default: clickbench-data)
    R2_ACCESS_KEY_ID        R2 access key (required for AWS CLI)
    R2_SECRET_ACCESS_KEY    R2 secret key (required for AWS CLI)
    R2_ACCOUNT_ID           Cloudflare account ID (required for AWS CLI)
    DATA_DIR                Local data directory (default: ./data)

Examples:
    # Download and upload single file
    $0 --all

    # Download and upload partitioned files
    $0 --all-partitioned

    # Just download
    $0 --download

    # Just upload (after downloading)
    $0 --upload
EOF
}

main() {
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi

    check_dependencies

    case "$1" in
        --download)
            download_single_file
            ;;
        --download-partitioned)
            download_partitioned
            ;;
        --upload)
            check_r2_config
            upload_single_file
            ;;
        --upload-partitioned)
            check_r2_config
            upload_partitioned
            ;;
        --verify)
            check_r2_config
            verify_upload
            ;;
        --cleanup)
            cleanup
            ;;
        --all)
            download_single_file
            check_r2_config
            upload_single_file
            ;;
        --all-partitioned)
            download_partitioned
            check_r2_config
            upload_partitioned
            ;;
        -h|--help)
            show_help
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
