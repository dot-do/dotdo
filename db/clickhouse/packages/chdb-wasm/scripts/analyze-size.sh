#!/usr/bin/env bash
#
# analyze-size.sh - WASM Build Size Analysis Script
#
# This script analyzes the size of WASM builds and provides detailed
# breakdowns to help identify optimization opportunities.
#
# Usage:
#   ./scripts/analyze-size.sh [options] <wasm-file>
#
# Options:
#   -v, --verbose     Show detailed section breakdown
#   -c, --compare     Compare with a baseline file
#   -j, --json        Output results as JSON
#   -h, --help        Show this help message
#
# Examples:
#   ./scripts/analyze-size.sh dist/chdb.wasm
#   ./scripts/analyze-size.sh -v -c baseline.wasm dist/chdb.wasm
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_DIST_DIR="${PROJECT_ROOT}/dist"

# Size targets (in bytes)
MINIMAL_TARGET_UNCOMPRESSED=$((10 * 1024 * 1024))  # 10MB uncompressed
MINIMAL_TARGET_GZIPPED=$((3 * 1024 * 1024))        # 3MB gzipped
STANDARD_TARGET_GZIPPED=$((8 * 1024 * 1024))       # 8MB gzipped
FULL_TARGET_GZIPPED=$((15 * 1024 * 1024))          # 15MB gzipped

# Options
VERBOSE=false
COMPARE_FILE=""
JSON_OUTPUT=false

# Function to display help
show_help() {
    cat << EOF
WASM Build Size Analysis Script

Usage:
  ${0##*/} [options] <wasm-file>

Options:
  -v, --verbose     Show detailed section breakdown
  -c, --compare     Compare with a baseline file
  -j, --json        Output results as JSON
  -h, --help        Show this help message

Examples:
  ${0##*/} dist/chdb.wasm
  ${0##*/} -v dist/chdb.wasm
  ${0##*/} -c old-build.wasm dist/chdb.wasm
  ${0##*/} -j dist/chdb.wasm > size-report.json

Size Targets:
  Minimal Profile:  ~3MB gzipped  (~10MB uncompressed)
  Standard Profile: ~8MB gzipped  (~25MB uncompressed)
  Full Profile:     ~15MB gzipped (~50MB uncompressed)
EOF
}

# Function to format bytes to human readable
format_bytes() {
    local bytes=$1
    if [[ $bytes -lt 1024 ]]; then
        echo "${bytes}B"
    elif [[ $bytes -lt $((1024 * 1024)) ]]; then
        echo "$(echo "scale=2; $bytes / 1024" | bc)KB"
    else
        echo "$(echo "scale=2; $bytes / 1024 / 1024" | bc)MB"
    fi
}

# Function to get file size
get_file_size() {
    local file=$1
    if [[ -f "$file" ]]; then
        stat -f%z "$file" 2>/dev/null || stat --format=%s "$file" 2>/dev/null
    else
        echo "0"
    fi
}

# Function to get gzipped size
get_gzipped_size() {
    local file=$1
    if [[ -f "$file" ]]; then
        gzip -c "$file" | wc -c | tr -d ' '
    else
        echo "0"
    fi
}

# Function to get brotli compressed size (if brotli is available)
get_brotli_size() {
    local file=$1
    if command -v brotli &> /dev/null && [[ -f "$file" ]]; then
        brotli -c "$file" | wc -c | tr -d ' '
    else
        echo "N/A"
    fi
}

# Function to analyze WASM sections (requires wasm-objdump or similar)
analyze_wasm_sections() {
    local file=$1

    if command -v wasm-objdump &> /dev/null; then
        echo -e "\n${CYAN}${BOLD}WASM Section Analysis:${NC}"
        wasm-objdump -h "$file" 2>/dev/null | head -30 || echo "  (wasm-objdump failed)"
    elif command -v wasm2wat &> /dev/null; then
        echo -e "\n${CYAN}${BOLD}WASM Module Info:${NC}"
        local func_count
        func_count=$(wasm2wat "$file" 2>/dev/null | grep -c '(func' || echo "0")
        echo "  Functions: $func_count"
    else
        echo -e "\n${YELLOW}Note: Install wabt (wasm-objdump) for detailed section analysis${NC}"
    fi
}

# Function to check size against targets
check_size_target() {
    local gzipped_size=$1
    local profile=${2:-"minimal"}

    local target
    case $profile in
        minimal)  target=$MINIMAL_TARGET_GZIPPED ;;
        standard) target=$STANDARD_TARGET_GZIPPED ;;
        full)     target=$FULL_TARGET_GZIPPED ;;
        *)        target=$MINIMAL_TARGET_GZIPPED ;;
    esac

    local percentage
    percentage=$(echo "scale=1; $gzipped_size * 100 / $target" | bc)

    if [[ $gzipped_size -le $target ]]; then
        echo -e "${GREEN}PASS${NC} - ${percentage}% of ${profile} target ($(format_bytes $target))"
    else
        local over=$((gzipped_size - target))
        echo -e "${RED}OVER${NC} - ${percentage}% of ${profile} target ($(format_bytes $over) over)"
    fi
}

# Function to compare with baseline
compare_with_baseline() {
    local current_file=$1
    local baseline_file=$2

    if [[ ! -f "$baseline_file" ]]; then
        echo -e "${YELLOW}Warning: Baseline file not found: ${baseline_file}${NC}"
        return
    fi

    local current_size
    current_size=$(get_file_size "$current_file")
    local baseline_size
    baseline_size=$(get_file_size "$baseline_file")

    local current_gzip
    current_gzip=$(get_gzipped_size "$current_file")
    local baseline_gzip
    baseline_gzip=$(get_gzipped_size "$baseline_file")

    local diff_size=$((current_size - baseline_size))
    local diff_gzip=$((current_gzip - baseline_gzip))

    echo -e "\n${CYAN}${BOLD}Comparison with Baseline:${NC}"
    echo "  Baseline: $(format_bytes $baseline_size) ($(format_bytes $baseline_gzip) gzipped)"
    echo "  Current:  $(format_bytes $current_size) ($(format_bytes $current_gzip) gzipped)"

    if [[ $diff_size -lt 0 ]]; then
        echo -e "  Change:   ${GREEN}$(format_bytes ${diff_size#-}) smaller${NC} (${GREEN}$(format_bytes ${diff_gzip#-}) gzipped${NC})"
    elif [[ $diff_size -gt 0 ]]; then
        echo -e "  Change:   ${RED}$(format_bytes $diff_size) larger${NC} (${RED}$(format_bytes $diff_gzip) gzipped${NC})"
    else
        echo "  Change:   No change"
    fi

    local percentage
    if [[ $baseline_size -gt 0 ]]; then
        percentage=$(echo "scale=1; ($current_size - $baseline_size) * 100 / $baseline_size" | bc)
        echo "  Relative: ${percentage}%"
    fi
}

# Function to output JSON
output_json() {
    local file=$1
    local raw_size
    raw_size=$(get_file_size "$file")
    local gzip_size
    gzip_size=$(get_gzipped_size "$file")
    local brotli_size
    brotli_size=$(get_brotli_size "$file")

    cat << EOF
{
  "file": "$(basename "$file")",
  "path": "$file",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "sizes": {
    "raw": $raw_size,
    "raw_formatted": "$(format_bytes $raw_size)",
    "gzipped": $gzip_size,
    "gzipped_formatted": "$(format_bytes $gzip_size)",
    "brotli": "$brotli_size"
  },
  "targets": {
    "minimal": {
      "target_bytes": $MINIMAL_TARGET_GZIPPED,
      "under_target": $([ $gzip_size -le $MINIMAL_TARGET_GZIPPED ] && echo "true" || echo "false")
    },
    "standard": {
      "target_bytes": $STANDARD_TARGET_GZIPPED,
      "under_target": $([ $gzip_size -le $STANDARD_TARGET_GZIPPED ] && echo "true" || echo "false")
    },
    "full": {
      "target_bytes": $FULL_TARGET_GZIPPED,
      "under_target": $([ $gzip_size -le $FULL_TARGET_GZIPPED ] && echo "true" || echo "false")
    }
  }
}
EOF
}

# Function to analyze JS glue code
analyze_js_glue() {
    local wasm_file=$1
    local js_file="${wasm_file%.wasm}.js"

    if [[ -f "$js_file" ]]; then
        local js_size
        js_size=$(get_file_size "$js_file")
        local js_gzip
        js_gzip=$(get_gzipped_size "$js_file")

        echo -e "\n${CYAN}${BOLD}JavaScript Glue Code:${NC}"
        echo "  File:     $(basename "$js_file")"
        echo "  Size:     $(format_bytes $js_size)"
        echo "  Gzipped:  $(format_bytes $js_gzip)"
    fi
}

# Main analysis function
analyze_wasm() {
    local file=$1

    if [[ ! -f "$file" ]]; then
        echo -e "${RED}Error: File not found: ${file}${NC}"
        exit 1
    fi

    # Get sizes
    local raw_size
    raw_size=$(get_file_size "$file")
    local gzip_size
    gzip_size=$(get_gzipped_size "$file")
    local brotli_size
    brotli_size=$(get_brotli_size "$file")

    # Output based on format
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        output_json "$file"
        return
    fi

    # Print header
    echo -e "${BOLD}======================================${NC}"
    echo -e "${BOLD}  WASM Build Size Analysis${NC}"
    echo -e "${BOLD}======================================${NC}"
    echo ""
    echo -e "${CYAN}${BOLD}File:${NC} $(basename "$file")"
    echo -e "${CYAN}${BOLD}Path:${NC} $file"
    echo ""

    # Size breakdown
    echo -e "${CYAN}${BOLD}Size Analysis:${NC}"
    echo "  Raw Size:     $(format_bytes $raw_size)"
    echo "  Gzipped:      $(format_bytes $gzip_size)"
    if [[ "$brotli_size" != "N/A" ]]; then
        echo "  Brotli:       $(format_bytes $brotli_size)"
    fi

    # Target checks
    echo ""
    echo -e "${CYAN}${BOLD}Target Compliance:${NC}"
    echo -n "  Minimal (~3MB):  "
    check_size_target "$gzip_size" "minimal"
    echo -n "  Standard (~8MB): "
    check_size_target "$gzip_size" "standard"
    echo -n "  Full (~15MB):    "
    check_size_target "$gzip_size" "full"

    # JS glue analysis
    analyze_js_glue "$file"

    # Compare with baseline if specified
    if [[ -n "$COMPARE_FILE" ]]; then
        compare_with_baseline "$file" "$COMPARE_FILE"
    fi

    # Detailed section analysis if verbose
    if [[ "$VERBOSE" == "true" ]]; then
        analyze_wasm_sections "$file"
    fi

    echo ""
    echo -e "${BOLD}======================================${NC}"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -c|--compare)
            COMPARE_FILE="$2"
            shift 2
            ;;
        -j|--json)
            JSON_OUTPUT=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            # Positional argument (file path)
            WASM_FILE="$1"
            shift
            ;;
    esac
done

# Check if file was specified
if [[ -z "${WASM_FILE:-}" ]]; then
    # Try to find default WASM file
    if [[ -f "${DEFAULT_DIST_DIR}/chdb.wasm" ]]; then
        WASM_FILE="${DEFAULT_DIST_DIR}/chdb.wasm"
    else
        echo -e "${RED}Error: No WASM file specified${NC}"
        echo ""
        show_help
        exit 1
    fi
fi

# Run analysis
analyze_wasm "$WASM_FILE"
