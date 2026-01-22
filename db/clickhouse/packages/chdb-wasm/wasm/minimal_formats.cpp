/**
 * minimal_formats.cpp - Minimal Format Registration for WASM Build
 *
 * This file provides a stripped-down format registration for chdb WASM builds.
 * It includes only essential formats to minimize binary size:
 *
 * Included formats:
 *   - Native: ClickHouse internal binary format (required for internal operations)
 *   - CSV: Comma-separated values (widely used, lightweight)
 *   - TSV: Tab-separated values (lightweight, ClickHouse default)
 *   - JSON: Standard JSON format
 *   - JSONEachRow: NDJSON/JSON Lines format (streaming-friendly)
 *   - JSONCompact: Compact JSON array format
 *
 * Excluded heavy formats (for binary size reduction):
 *   - Parquet (requires Apache Arrow)
 *   - Arrow (requires Apache Arrow)
 *   - Avro (requires Avro library)
 *   - ORC (requires ORC library)
 *   - Protobuf (requires Protobuf library)
 *   - CapnProto (requires Cap'n Proto library)
 *   - MsgPack (requires MessagePack library)
 *   - BSON (requires BSON library)
 *   - Various other specialized formats
 *
 * Usage:
 *   Compile with -DCHDB_WASM_MINIMAL to use this minimal format set.
 *   This file should replace or supplement the standard registerFormats.cpp
 *   in WASM builds.
 */

#ifdef CHDB_WASM_MINIMAL

#include "config.h"
#include <Formats/FormatFactory.h>

namespace DB
{

// =============================================================================
// Forward declarations for file segmentation engines
// These are used for parallel reading in some contexts
// =============================================================================

void registerFileSegmentationEngineTabSeparated(FormatFactory & factory);
void registerFileSegmentationEngineCSV(FormatFactory & factory);
void registerFileSegmentationEngineJSONEachRow(FormatFactory & factory);
void registerFileSegmentationEngineJSONCompactEachRow(FormatFactory & factory);

// =============================================================================
// Forward declarations for Native format
// Native format is essential for internal ClickHouse operations
// =============================================================================

void registerInputFormatNative(FormatFactory & factory);
void registerOutputFormatNative(FormatFactory & factory);
void registerNativeSchemaReader(FormatFactory & factory);

// =============================================================================
// Forward declarations for CSV format
// CSV is a universal data interchange format
// =============================================================================

void registerInputFormatCSV(FormatFactory & factory);
void registerOutputFormatCSV(FormatFactory & factory);
void registerCSVSchemaReader(FormatFactory & factory);

// =============================================================================
// Forward declarations for TSV (Tab-Separated Values) format
// TSV is ClickHouse's default output format and very lightweight
// =============================================================================

void registerInputFormatTabSeparated(FormatFactory & factory);
void registerOutputFormatTabSeparated(FormatFactory & factory);
void registerTSVSchemaReader(FormatFactory & factory);

// =============================================================================
// Forward declarations for JSON format
// Standard JSON format for API responses
// =============================================================================

void registerInputFormatJSON(FormatFactory & factory);
void registerOutputFormatJSON(FormatFactory & factory);
void registerJSONSchemaReader(FormatFactory & factory);

// =============================================================================
// Forward declarations for JSONEachRow format
// Also known as NDJSON or JSON Lines - excellent for streaming
// =============================================================================

void registerInputFormatJSONEachRow(FormatFactory & factory);
void registerOutputFormatJSONEachRow(FormatFactory & factory);
void registerJSONEachRowSchemaReader(FormatFactory & factory);
void registerNonTrivialPrefixAndSuffixCheckerJSONEachRow(FormatFactory & factory);

// =============================================================================
// Forward declarations for JSONCompact format
// Compact JSON using arrays instead of objects - smaller output
// =============================================================================

void registerInputFormatJSONCompact(FormatFactory & factory);
void registerOutputFormatJSONCompact(FormatFactory & factory);
void registerInputFormatJSONCompactEachRow(FormatFactory & factory);
void registerOutputFormatJSONCompactEachRow(FormatFactory & factory);
void registerJSONCompactEachRowSchemaReader(FormatFactory & factory);

// =============================================================================
// Forward declarations for Values format
// Required for INSERT ... VALUES syntax support
// =============================================================================

void registerInputFormatValues(FormatFactory & factory);
void registerOutputFormatValues(FormatFactory & factory);
void registerValuesSchemaReader(FormatFactory & factory);

// =============================================================================
// Forward declarations for minimal output-only formats
// These are lightweight and useful for debugging/display
// =============================================================================

void registerOutputFormatPretty(FormatFactory & factory);
void registerOutputFormatNull(FormatFactory & factory);

// =============================================================================
// File extension registration
// =============================================================================

void registerFileExtensions(FormatFactory & factory);

// =============================================================================
// Main registration function for minimal WASM build
// =============================================================================

void registerFormats()
{
    auto & factory = FormatFactory::instance();

    // -------------------------------------------------------------------------
    // File segmentation engines (for parallel reading support)
    // -------------------------------------------------------------------------
    registerFileSegmentationEngineTabSeparated(factory);
    registerFileSegmentationEngineCSV(factory);
    registerFileSegmentationEngineJSONEachRow(factory);
    registerFileSegmentationEngineJSONCompactEachRow(factory);

    // -------------------------------------------------------------------------
    // Native format (required for internal operations)
    // -------------------------------------------------------------------------
    registerInputFormatNative(factory);
    registerOutputFormatNative(factory);
    registerNativeSchemaReader(factory);

    // -------------------------------------------------------------------------
    // CSV format (universal data interchange)
    // -------------------------------------------------------------------------
    registerInputFormatCSV(factory);
    registerOutputFormatCSV(factory);
    registerCSVSchemaReader(factory);

    // -------------------------------------------------------------------------
    // TSV format (ClickHouse default, lightweight)
    // -------------------------------------------------------------------------
    registerInputFormatTabSeparated(factory);
    registerOutputFormatTabSeparated(factory);
    registerTSVSchemaReader(factory);

    // -------------------------------------------------------------------------
    // JSON format (standard API format)
    // -------------------------------------------------------------------------
    registerInputFormatJSON(factory);
    registerOutputFormatJSON(factory);
    registerJSONSchemaReader(factory);

    // -------------------------------------------------------------------------
    // JSONEachRow format (NDJSON/JSON Lines - streaming friendly)
    // -------------------------------------------------------------------------
    registerInputFormatJSONEachRow(factory);
    registerOutputFormatJSONEachRow(factory);
    registerJSONEachRowSchemaReader(factory);
    registerNonTrivialPrefixAndSuffixCheckerJSONEachRow(factory);

    // -------------------------------------------------------------------------
    // JSONCompact format (smaller JSON output using arrays)
    // -------------------------------------------------------------------------
    registerInputFormatJSONCompact(factory);
    registerOutputFormatJSONCompact(factory);
    registerInputFormatJSONCompactEachRow(factory);
    registerOutputFormatJSONCompactEachRow(factory);
    registerJSONCompactEachRowSchemaReader(factory);

    // -------------------------------------------------------------------------
    // Values format (required for INSERT ... VALUES syntax)
    // -------------------------------------------------------------------------
    registerInputFormatValues(factory);
    registerOutputFormatValues(factory);
    registerValuesSchemaReader(factory);

    // -------------------------------------------------------------------------
    // Output-only formats (lightweight, useful for debugging)
    // -------------------------------------------------------------------------
    registerOutputFormatPretty(factory);  // Human-readable tables
    registerOutputFormatNull(factory);    // Discard output (testing)
}

} // namespace DB

#endif // CHDB_WASM_MINIMAL
