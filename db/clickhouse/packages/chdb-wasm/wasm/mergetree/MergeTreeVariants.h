/**
 * MergeTreeVariants.h - MergeTree variant type definitions for WASM build
 *
 * This header defines the MergeTree engine variants supported in the WASM build:
 *   - MergeTree (Ordinary) - Base engine, no special merge behavior
 *   - ReplacingMergeTree - Deduplication by version column
 *   - SummingMergeTree - Automatic summation of numeric columns
 *   - AggregatingMergeTree - Pre-aggregation with aggregate function states
 *   - CollapsingMergeTree - Row collapsing by sign column
 *   - VersionedCollapsingMergeTree - Versioned row collapsing
 *   - GraphiteMergeTree - Time series aggregation for Graphite
 *   - CoalescingMergeTree - Like Summing but keeps non-null values
 *
 * Each variant has specific merge-time behavior that affects how data parts
 * are combined during background merges. For read operations in WASM, the
 * variant type determines:
 *   - Which columns have special meaning (sign, version, is_deleted)
 *   - How to interpret aggregated values
 *   - Whether to apply FINAL semantics
 *
 * Usage:
 *   #include "MergeTreeVariants.h"
 *
 *   auto variant = MergeTreeVariant::fromString("ReplacingMergeTree");
 *   if (variant.mode == MergeTreeMode::Replacing) {
 *       // Handle version column logic
 *   }
 */

#pragma once

#include <cstdint>
#include <cstring>

#ifdef __cplusplus
#include <string>
#include <vector>
#endif

// =============================================================================
// MergeTree Mode Enumeration (matches ClickHouse MergeTreeData::MergingParams::Mode)
// =============================================================================

/**
 * MergeTree merging modes.
 * Values must match ClickHouse enum values for compatibility.
 */
typedef enum MergeTreeMode {
    MERGETREE_MODE_ORDINARY             = 0,  // Base MergeTree, no special behavior
    MERGETREE_MODE_COLLAPSING           = 1,  // Collapse rows by sign column
    MERGETREE_MODE_SUMMING              = 2,  // Sum numeric columns on merge
    MERGETREE_MODE_AGGREGATING          = 3,  // Merge aggregate function states
    // Note: 4 is skipped in ClickHouse
    MERGETREE_MODE_REPLACING            = 5,  // Keep latest row by version
    MERGETREE_MODE_GRAPHITE             = 6,  // Graphite time series rollup
    MERGETREE_MODE_VERSIONED_COLLAPSING = 7,  // Versioned collapsing
    MERGETREE_MODE_COALESCING           = 8,  // Like summing, keeps non-null

    MERGETREE_MODE_INVALID              = -1  // Invalid/unknown mode
} MergeTreeMode;

// =============================================================================
// Feature flags for MergeTree variants
// =============================================================================

/**
 * Feature flags indicating what special columns/behavior a variant supports.
 */
typedef enum MergeTreeVariantFeatures {
    MERGETREE_FEATURE_NONE           = 0,
    MERGETREE_FEATURE_SIGN_COLUMN    = (1 << 0),  // Has sign column (Collapsing variants)
    MERGETREE_FEATURE_VERSION_COLUMN = (1 << 1),  // Has version column (Replacing, VersionedCollapsing)
    MERGETREE_FEATURE_DELETED_COLUMN = (1 << 2),  // Has is_deleted column (Replacing with cleanup)
    MERGETREE_FEATURE_SUM_COLUMNS    = (1 << 3),  // Has columns_to_sum (Summing, Coalescing)
    MERGETREE_FEATURE_GRAPHITE       = (1 << 4),  // Has graphite_params (GraphiteMergeTree)
    MERGETREE_FEATURE_AGGREGATION    = (1 << 5),  // Stores aggregate function states
} MergeTreeVariantFeatures;

// =============================================================================
// C API structures
// =============================================================================

/**
 * Information about a MergeTree variant parsed from engine definition.
 */
typedef struct MergeTreeVariantInfo {
    MergeTreeMode mode;
    uint32_t features;           // Bitmask of MergeTreeVariantFeatures
    const char* engine_name;     // Original engine name (e.g., "ReplacingMergeTree")
    const char* sign_column;     // Sign column name (Collapsing variants)
    const char* version_column;  // Version column name (Replacing, VersionedCollapsing)
    const char* deleted_column;  // is_deleted column name (Replacing with cleanup)
} MergeTreeVariantInfo;

// =============================================================================
// C API functions
// =============================================================================

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Get the mode for a MergeTree engine name.
 *
 * @param engine_name  Engine name (e.g., "ReplacingMergeTree", "MergeTree")
 * @return             MergeTreeMode value, or MERGETREE_MODE_INVALID if unknown
 */
MergeTreeMode mergetree_mode_from_name(const char* engine_name);

/**
 * Get the engine name for a MergeTree mode.
 *
 * @param mode  MergeTree mode
 * @return      Engine name string, or "Unknown" if invalid
 */
const char* mergetree_mode_to_name(MergeTreeMode mode);

/**
 * Get feature flags for a MergeTree mode.
 *
 * @param mode  MergeTree mode
 * @return      Bitmask of MergeTreeVariantFeatures
 */
uint32_t mergetree_mode_get_features(MergeTreeMode mode);

/**
 * Check if a mode supports a specific feature.
 *
 * @param mode     MergeTree mode
 * @param feature  Feature flag to check
 * @return         1 if supported, 0 if not
 */
int mergetree_mode_has_feature(MergeTreeMode mode, MergeTreeVariantFeatures feature);

/**
 * Get a human-readable description of a mode.
 *
 * @param mode  MergeTree mode
 * @return      Description string
 */
const char* mergetree_mode_description(MergeTreeMode mode);

/**
 * Check if a MergeTree variant is supported in this WASM build.
 *
 * @param mode  MergeTree mode
 * @return      1 if supported, 0 if not
 */
int mergetree_variant_is_supported(MergeTreeMode mode);

/**
 * Get a list of all supported MergeTree variants.
 *
 * @param out_modes  Output array for mode values (caller-allocated)
 * @param max_count  Maximum number of modes to return
 * @return           Number of modes written to out_modes
 */
int mergetree_get_supported_variants(MergeTreeMode* out_modes, int max_count);

#ifdef __cplusplus
} // extern "C"
#endif

// =============================================================================
// C++ API (when building with C++)
// =============================================================================

#ifdef __cplusplus
namespace DB {

/**
 * MergeTree variant descriptor with full metadata.
 */
struct MergeTreeVariant {
    MergeTreeMode mode = MERGETREE_MODE_ORDINARY;
    std::string engine_name;
    std::string sign_column;
    std::string version_column;
    std::string is_deleted_column;
    std::vector<std::string> columns_to_sum;

    MergeTreeVariant() = default;

    explicit MergeTreeVariant(MergeTreeMode m) : mode(m) {
        engine_name = mergetree_mode_to_name(m);
    }

    /**
     * Parse a MergeTree variant from engine name string.
     */
    static MergeTreeVariant fromString(const std::string& engine_name) {
        MergeTreeVariant v;
        v.mode = mergetree_mode_from_name(engine_name.c_str());
        v.engine_name = engine_name;
        return v;
    }

    /**
     * Check if this variant has a specific feature.
     */
    bool hasFeature(MergeTreeVariantFeatures feature) const {
        return mergetree_mode_has_feature(mode, feature) != 0;
    }

    /**
     * Get feature flags for this variant.
     */
    uint32_t getFeatures() const {
        return mergetree_mode_get_features(mode);
    }

    /**
     * Check if this variant is supported in the current build.
     */
    bool isSupported() const {
        return mergetree_variant_is_supported(mode) != 0;
    }

    /**
     * Get human-readable description.
     */
    const char* description() const {
        return mergetree_mode_description(mode);
    }

    // Feature convenience methods
    bool hasSignColumn() const { return hasFeature(MERGETREE_FEATURE_SIGN_COLUMN); }
    bool hasVersionColumn() const { return hasFeature(MERGETREE_FEATURE_VERSION_COLUMN); }
    bool hasDeletedColumn() const { return hasFeature(MERGETREE_FEATURE_DELETED_COLUMN); }
    bool hasSumColumns() const { return hasFeature(MERGETREE_FEATURE_SUM_COLUMNS); }
    bool hasGraphiteParams() const { return hasFeature(MERGETREE_FEATURE_GRAPHITE); }
    bool hasAggregation() const { return hasFeature(MERGETREE_FEATURE_AGGREGATION); }

    // Mode check convenience methods
    bool isOrdinary() const { return mode == MERGETREE_MODE_ORDINARY; }
    bool isReplacing() const { return mode == MERGETREE_MODE_REPLACING; }
    bool isSumming() const { return mode == MERGETREE_MODE_SUMMING; }
    bool isAggregating() const { return mode == MERGETREE_MODE_AGGREGATING; }
    bool isCollapsing() const { return mode == MERGETREE_MODE_COLLAPSING; }
    bool isVersionedCollapsing() const { return mode == MERGETREE_MODE_VERSIONED_COLLAPSING; }
    bool isGraphite() const { return mode == MERGETREE_MODE_GRAPHITE; }
    bool isCoalescing() const { return mode == MERGETREE_MODE_COALESCING; }
};

/**
 * Get list of all supported MergeTree variants.
 */
inline std::vector<MergeTreeVariant> getSupportedMergeTreeVariants() {
    std::vector<MergeTreeVariant> variants;
    MergeTreeMode modes[16];
    int count = mergetree_get_supported_variants(modes, 16);
    for (int i = 0; i < count; ++i) {
        variants.emplace_back(modes[i]);
    }
    return variants;
}

} // namespace DB
#endif // __cplusplus

// =============================================================================
// Implementation (inline for header-only usage)
// =============================================================================

#ifdef MERGETREE_VARIANTS_IMPLEMENTATION

#ifdef __cplusplus
extern "C" {
#endif

MergeTreeMode mergetree_mode_from_name(const char* engine_name) {
    if (!engine_name) return MERGETREE_MODE_INVALID;

    // Handle both with and without "MergeTree" suffix
    if (strcmp(engine_name, "MergeTree") == 0 ||
        strcmp(engine_name, "Ordinary") == 0) {
        return MERGETREE_MODE_ORDINARY;
    }
    if (strcmp(engine_name, "ReplacingMergeTree") == 0 ||
        strcmp(engine_name, "Replacing") == 0) {
        return MERGETREE_MODE_REPLACING;
    }
    if (strcmp(engine_name, "SummingMergeTree") == 0 ||
        strcmp(engine_name, "Summing") == 0) {
        return MERGETREE_MODE_SUMMING;
    }
    if (strcmp(engine_name, "AggregatingMergeTree") == 0 ||
        strcmp(engine_name, "Aggregating") == 0) {
        return MERGETREE_MODE_AGGREGATING;
    }
    if (strcmp(engine_name, "CollapsingMergeTree") == 0 ||
        strcmp(engine_name, "Collapsing") == 0) {
        return MERGETREE_MODE_COLLAPSING;
    }
    if (strcmp(engine_name, "VersionedCollapsingMergeTree") == 0 ||
        strcmp(engine_name, "VersionedCollapsing") == 0) {
        return MERGETREE_MODE_VERSIONED_COLLAPSING;
    }
    if (strcmp(engine_name, "GraphiteMergeTree") == 0 ||
        strcmp(engine_name, "Graphite") == 0) {
        return MERGETREE_MODE_GRAPHITE;
    }
    if (strcmp(engine_name, "CoalescingMergeTree") == 0 ||
        strcmp(engine_name, "Coalescing") == 0) {
        return MERGETREE_MODE_COALESCING;
    }

    return MERGETREE_MODE_INVALID;
}

const char* mergetree_mode_to_name(MergeTreeMode mode) {
    switch (mode) {
        case MERGETREE_MODE_ORDINARY:             return "MergeTree";
        case MERGETREE_MODE_REPLACING:            return "ReplacingMergeTree";
        case MERGETREE_MODE_SUMMING:              return "SummingMergeTree";
        case MERGETREE_MODE_AGGREGATING:          return "AggregatingMergeTree";
        case MERGETREE_MODE_COLLAPSING:           return "CollapsingMergeTree";
        case MERGETREE_MODE_VERSIONED_COLLAPSING: return "VersionedCollapsingMergeTree";
        case MERGETREE_MODE_GRAPHITE:             return "GraphiteMergeTree";
        case MERGETREE_MODE_COALESCING:           return "CoalescingMergeTree";
        default:                                  return "Unknown";
    }
}

uint32_t mergetree_mode_get_features(MergeTreeMode mode) {
    switch (mode) {
        case MERGETREE_MODE_ORDINARY:
            return MERGETREE_FEATURE_NONE;

        case MERGETREE_MODE_REPLACING:
            return MERGETREE_FEATURE_VERSION_COLUMN | MERGETREE_FEATURE_DELETED_COLUMN;

        case MERGETREE_MODE_SUMMING:
            return MERGETREE_FEATURE_SUM_COLUMNS;

        case MERGETREE_MODE_AGGREGATING:
            return MERGETREE_FEATURE_AGGREGATION;

        case MERGETREE_MODE_COLLAPSING:
            return MERGETREE_FEATURE_SIGN_COLUMN;

        case MERGETREE_MODE_VERSIONED_COLLAPSING:
            return MERGETREE_FEATURE_SIGN_COLUMN | MERGETREE_FEATURE_VERSION_COLUMN;

        case MERGETREE_MODE_GRAPHITE:
            return MERGETREE_FEATURE_GRAPHITE;

        case MERGETREE_MODE_COALESCING:
            return MERGETREE_FEATURE_SUM_COLUMNS;

        default:
            return MERGETREE_FEATURE_NONE;
    }
}

int mergetree_mode_has_feature(MergeTreeMode mode, MergeTreeVariantFeatures feature) {
    return (mergetree_mode_get_features(mode) & (uint32_t)feature) != 0 ? 1 : 0;
}

const char* mergetree_mode_description(MergeTreeMode mode) {
    switch (mode) {
        case MERGETREE_MODE_ORDINARY:
            return "Base MergeTree engine with no special merge behavior";

        case MERGETREE_MODE_REPLACING:
            return "Deduplicates rows by keeping the latest version based on version column";

        case MERGETREE_MODE_SUMMING:
            return "Automatically sums numeric columns when merging rows with same primary key";

        case MERGETREE_MODE_AGGREGATING:
            return "Merges rows by combining aggregate function states (for pre-aggregation)";

        case MERGETREE_MODE_COLLAPSING:
            return "Collapses (removes) pairs of rows with opposite sign column values";

        case MERGETREE_MODE_VERSIONED_COLLAPSING:
            return "Collapses rows with versioning support for out-of-order inserts";

        case MERGETREE_MODE_GRAPHITE:
            return "Optimized for Graphite time series with automatic rollup aggregation";

        case MERGETREE_MODE_COALESCING:
            return "Like SummingMergeTree but keeps first non-null value for non-summed columns";

        default:
            return "Unknown MergeTree variant";
    }
}

int mergetree_variant_is_supported(MergeTreeMode mode) {
    // In the WASM build, we support reading all variants
    // (write support may be limited)
    switch (mode) {
        case MERGETREE_MODE_ORDINARY:
        case MERGETREE_MODE_REPLACING:
        case MERGETREE_MODE_SUMMING:
        case MERGETREE_MODE_AGGREGATING:
        case MERGETREE_MODE_COLLAPSING:
        case MERGETREE_MODE_VERSIONED_COLLAPSING:
        case MERGETREE_MODE_GRAPHITE:
        case MERGETREE_MODE_COALESCING:
            return 1;
        default:
            return 0;
    }
}

int mergetree_get_supported_variants(MergeTreeMode* out_modes, int max_count) {
    static const MergeTreeMode supported[] = {
        MERGETREE_MODE_ORDINARY,
        MERGETREE_MODE_REPLACING,
        MERGETREE_MODE_SUMMING,
        MERGETREE_MODE_AGGREGATING,
        MERGETREE_MODE_COLLAPSING,
        MERGETREE_MODE_VERSIONED_COLLAPSING,
        MERGETREE_MODE_GRAPHITE,
        MERGETREE_MODE_COALESCING,
    };
    int count = sizeof(supported) / sizeof(supported[0]);
    if (count > max_count) count = max_count;
    for (int i = 0; i < count; ++i) {
        out_modes[i] = supported[i];
    }
    return count;
}

#ifdef __cplusplus
} // extern "C"
#endif

#endif // MERGETREE_VARIANTS_IMPLEMENTATION
