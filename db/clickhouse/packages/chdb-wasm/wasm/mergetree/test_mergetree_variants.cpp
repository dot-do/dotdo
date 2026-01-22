/**
 * test_mergetree_variants.cpp - Unit tests for MergeTree variant support
 *
 * This file contains tests for the MergeTree variant functionality including:
 *   - Mode parsing from engine names
 *   - Feature flag detection
 *   - Variant support queries
 *   - MergeTreeVariant C++ class
 *
 * Compile: g++ -std=c++17 -o test_mergetree_variants test_mergetree_variants.cpp -I.
 * Run: ./test_mergetree_variants
 */

#define MERGETREE_STANDALONE_BUILD
#define MERGETREE_VARIANTS_IMPLEMENTATION
#include "MergeTreeVariants.h"

#include <cassert>
#include <cstring>
#include <iostream>
#include <sstream>
#include <vector>

// Test helpers
static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) \
    void test_##name(); \
    static struct Test_##name { \
        Test_##name() { \
            std::cout << "Running " #name "..." << std::endl; \
            tests_run++; \
            try { \
                test_##name(); \
                tests_passed++; \
                std::cout << "  PASS" << std::endl; \
            } catch (const std::exception& e) { \
                std::cout << "  FAIL: " << e.what() << std::endl; \
            } \
        } \
    } test_instance_##name; \
    void test_##name()

#define ASSERT(cond) \
    if (!(cond)) { \
        throw std::runtime_error("Assertion failed: " #cond); \
    }

#define ASSERT_EQ(a, b) \
    if ((a) != (b)) { \
        std::ostringstream ss; \
        ss << "Assertion failed: " << #a << " != " << #b; \
        throw std::runtime_error(ss.str()); \
    }

#define ASSERT_STREQ(a, b) \
    if (std::strcmp(a, b) != 0) { \
        std::ostringstream ss; \
        ss << "Assertion failed: \"" << a << "\" != \"" << b << "\""; \
        throw std::runtime_error(ss.str()); \
    }

// =============================================================================
// C API Tests
// =============================================================================

TEST(mode_from_name_ordinary)
{
    ASSERT_EQ(mergetree_mode_from_name("MergeTree"), MERGETREE_MODE_ORDINARY);
    ASSERT_EQ(mergetree_mode_from_name("Ordinary"), MERGETREE_MODE_ORDINARY);
}

TEST(mode_from_name_replacing)
{
    ASSERT_EQ(mergetree_mode_from_name("ReplacingMergeTree"), MERGETREE_MODE_REPLACING);
    ASSERT_EQ(mergetree_mode_from_name("Replacing"), MERGETREE_MODE_REPLACING);
}

TEST(mode_from_name_summing)
{
    ASSERT_EQ(mergetree_mode_from_name("SummingMergeTree"), MERGETREE_MODE_SUMMING);
    ASSERT_EQ(mergetree_mode_from_name("Summing"), MERGETREE_MODE_SUMMING);
}

TEST(mode_from_name_aggregating)
{
    ASSERT_EQ(mergetree_mode_from_name("AggregatingMergeTree"), MERGETREE_MODE_AGGREGATING);
    ASSERT_EQ(mergetree_mode_from_name("Aggregating"), MERGETREE_MODE_AGGREGATING);
}

TEST(mode_from_name_collapsing)
{
    ASSERT_EQ(mergetree_mode_from_name("CollapsingMergeTree"), MERGETREE_MODE_COLLAPSING);
    ASSERT_EQ(mergetree_mode_from_name("Collapsing"), MERGETREE_MODE_COLLAPSING);
}

TEST(mode_from_name_versioned_collapsing)
{
    ASSERT_EQ(mergetree_mode_from_name("VersionedCollapsingMergeTree"), MERGETREE_MODE_VERSIONED_COLLAPSING);
    ASSERT_EQ(mergetree_mode_from_name("VersionedCollapsing"), MERGETREE_MODE_VERSIONED_COLLAPSING);
}

TEST(mode_from_name_graphite)
{
    ASSERT_EQ(mergetree_mode_from_name("GraphiteMergeTree"), MERGETREE_MODE_GRAPHITE);
    ASSERT_EQ(mergetree_mode_from_name("Graphite"), MERGETREE_MODE_GRAPHITE);
}

TEST(mode_from_name_coalescing)
{
    ASSERT_EQ(mergetree_mode_from_name("CoalescingMergeTree"), MERGETREE_MODE_COALESCING);
    ASSERT_EQ(mergetree_mode_from_name("Coalescing"), MERGETREE_MODE_COALESCING);
}

TEST(mode_from_name_invalid)
{
    ASSERT_EQ(mergetree_mode_from_name("InvalidEngine"), MERGETREE_MODE_INVALID);
    ASSERT_EQ(mergetree_mode_from_name(nullptr), MERGETREE_MODE_INVALID);
    ASSERT_EQ(mergetree_mode_from_name(""), MERGETREE_MODE_INVALID);
}

TEST(mode_to_name_all)
{
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_ORDINARY), "MergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_REPLACING), "ReplacingMergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_SUMMING), "SummingMergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_AGGREGATING), "AggregatingMergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_COLLAPSING), "CollapsingMergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_VERSIONED_COLLAPSING), "VersionedCollapsingMergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_GRAPHITE), "GraphiteMergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_COALESCING), "CoalescingMergeTree");
    ASSERT_STREQ(mergetree_mode_to_name(MERGETREE_MODE_INVALID), "Unknown");
}

TEST(mode_features_ordinary)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_ORDINARY);
    ASSERT_EQ(features, MERGETREE_FEATURE_NONE);
    ASSERT(!mergetree_mode_has_feature(MERGETREE_MODE_ORDINARY, MERGETREE_FEATURE_SIGN_COLUMN));
    ASSERT(!mergetree_mode_has_feature(MERGETREE_MODE_ORDINARY, MERGETREE_FEATURE_VERSION_COLUMN));
}

TEST(mode_features_replacing)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_REPLACING);
    ASSERT(features & MERGETREE_FEATURE_VERSION_COLUMN);
    ASSERT(features & MERGETREE_FEATURE_DELETED_COLUMN);
    ASSERT(mergetree_mode_has_feature(MERGETREE_MODE_REPLACING, MERGETREE_FEATURE_VERSION_COLUMN));
    ASSERT(!mergetree_mode_has_feature(MERGETREE_MODE_REPLACING, MERGETREE_FEATURE_SIGN_COLUMN));
}

TEST(mode_features_summing)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_SUMMING);
    ASSERT(features & MERGETREE_FEATURE_SUM_COLUMNS);
    ASSERT(mergetree_mode_has_feature(MERGETREE_MODE_SUMMING, MERGETREE_FEATURE_SUM_COLUMNS));
}

TEST(mode_features_aggregating)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_AGGREGATING);
    ASSERT(features & MERGETREE_FEATURE_AGGREGATION);
    ASSERT(mergetree_mode_has_feature(MERGETREE_MODE_AGGREGATING, MERGETREE_FEATURE_AGGREGATION));
}

TEST(mode_features_collapsing)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_COLLAPSING);
    ASSERT(features & MERGETREE_FEATURE_SIGN_COLUMN);
    ASSERT(mergetree_mode_has_feature(MERGETREE_MODE_COLLAPSING, MERGETREE_FEATURE_SIGN_COLUMN));
    ASSERT(!mergetree_mode_has_feature(MERGETREE_MODE_COLLAPSING, MERGETREE_FEATURE_VERSION_COLUMN));
}

TEST(mode_features_versioned_collapsing)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_VERSIONED_COLLAPSING);
    ASSERT(features & MERGETREE_FEATURE_SIGN_COLUMN);
    ASSERT(features & MERGETREE_FEATURE_VERSION_COLUMN);
    ASSERT(mergetree_mode_has_feature(MERGETREE_MODE_VERSIONED_COLLAPSING, MERGETREE_FEATURE_SIGN_COLUMN));
    ASSERT(mergetree_mode_has_feature(MERGETREE_MODE_VERSIONED_COLLAPSING, MERGETREE_FEATURE_VERSION_COLUMN));
}

TEST(mode_features_graphite)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_GRAPHITE);
    ASSERT(features & MERGETREE_FEATURE_GRAPHITE);
    ASSERT(mergetree_mode_has_feature(MERGETREE_MODE_GRAPHITE, MERGETREE_FEATURE_GRAPHITE));
}

TEST(mode_features_coalescing)
{
    uint32_t features = mergetree_mode_get_features(MERGETREE_MODE_COALESCING);
    ASSERT(features & MERGETREE_FEATURE_SUM_COLUMNS);
}

TEST(mode_description_not_empty)
{
    const char* desc;

    desc = mergetree_mode_description(MERGETREE_MODE_ORDINARY);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);

    desc = mergetree_mode_description(MERGETREE_MODE_REPLACING);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);

    desc = mergetree_mode_description(MERGETREE_MODE_SUMMING);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);

    desc = mergetree_mode_description(MERGETREE_MODE_AGGREGATING);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);

    desc = mergetree_mode_description(MERGETREE_MODE_COLLAPSING);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);

    desc = mergetree_mode_description(MERGETREE_MODE_VERSIONED_COLLAPSING);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);

    desc = mergetree_mode_description(MERGETREE_MODE_GRAPHITE);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);

    desc = mergetree_mode_description(MERGETREE_MODE_COALESCING);
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);
}

TEST(variant_is_supported)
{
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_ORDINARY));
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_REPLACING));
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_SUMMING));
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_AGGREGATING));
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_COLLAPSING));
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_VERSIONED_COLLAPSING));
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_GRAPHITE));
    ASSERT(mergetree_variant_is_supported(MERGETREE_MODE_COALESCING));
    ASSERT(!mergetree_variant_is_supported(MERGETREE_MODE_INVALID));
}

TEST(get_supported_variants)
{
    MergeTreeMode modes[16];
    int count = mergetree_get_supported_variants(modes, 16);

    ASSERT(count == 8);  // All 8 variants should be supported

    // Verify all expected modes are present
    bool found_ordinary = false, found_replacing = false, found_summing = false;
    bool found_aggregating = false, found_collapsing = false, found_versioned = false;
    bool found_graphite = false, found_coalescing = false;

    for (int i = 0; i < count; ++i) {
        switch (modes[i]) {
            case MERGETREE_MODE_ORDINARY: found_ordinary = true; break;
            case MERGETREE_MODE_REPLACING: found_replacing = true; break;
            case MERGETREE_MODE_SUMMING: found_summing = true; break;
            case MERGETREE_MODE_AGGREGATING: found_aggregating = true; break;
            case MERGETREE_MODE_COLLAPSING: found_collapsing = true; break;
            case MERGETREE_MODE_VERSIONED_COLLAPSING: found_versioned = true; break;
            case MERGETREE_MODE_GRAPHITE: found_graphite = true; break;
            case MERGETREE_MODE_COALESCING: found_coalescing = true; break;
            default: break;
        }
    }

    ASSERT(found_ordinary);
    ASSERT(found_replacing);
    ASSERT(found_summing);
    ASSERT(found_aggregating);
    ASSERT(found_collapsing);
    ASSERT(found_versioned);
    ASSERT(found_graphite);
    ASSERT(found_coalescing);
}

TEST(get_supported_variants_limited_buffer)
{
    MergeTreeMode modes[3];
    int count = mergetree_get_supported_variants(modes, 3);
    ASSERT(count == 3);  // Limited by buffer size
}

// =============================================================================
// C++ API Tests
// =============================================================================

TEST(MergeTreeVariant_default_constructor)
{
    DB::MergeTreeVariant v;
    ASSERT_EQ(v.mode, MERGETREE_MODE_ORDINARY);
    ASSERT(v.isOrdinary());
}

TEST(MergeTreeVariant_mode_constructor)
{
    DB::MergeTreeVariant v(MERGETREE_MODE_REPLACING);
    ASSERT_EQ(v.mode, MERGETREE_MODE_REPLACING);
    ASSERT(v.isReplacing());
    ASSERT_EQ(v.engine_name, "ReplacingMergeTree");
}

TEST(MergeTreeVariant_from_string)
{
    auto v = DB::MergeTreeVariant::fromString("SummingMergeTree");
    ASSERT_EQ(v.mode, MERGETREE_MODE_SUMMING);
    ASSERT(v.isSumming());
    ASSERT_EQ(v.engine_name, "SummingMergeTree");
}

TEST(MergeTreeVariant_hasFeature)
{
    DB::MergeTreeVariant v(MERGETREE_MODE_VERSIONED_COLLAPSING);
    ASSERT(v.hasSignColumn());
    ASSERT(v.hasVersionColumn());
    ASSERT(!v.hasDeletedColumn());
    ASSERT(!v.hasSumColumns());
    ASSERT(!v.hasGraphiteParams());
    ASSERT(!v.hasAggregation());
}

TEST(MergeTreeVariant_isSupported)
{
    DB::MergeTreeVariant v1(MERGETREE_MODE_AGGREGATING);
    ASSERT(v1.isSupported());

    DB::MergeTreeVariant v2(MERGETREE_MODE_INVALID);
    ASSERT(!v2.isSupported());
}

TEST(MergeTreeVariant_description)
{
    DB::MergeTreeVariant v(MERGETREE_MODE_GRAPHITE);
    const char* desc = v.description();
    ASSERT(desc != nullptr);
    ASSERT(strlen(desc) > 0);
}

TEST(MergeTreeVariant_mode_checks)
{
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_ORDINARY).isOrdinary());
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_REPLACING).isReplacing());
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_SUMMING).isSumming());
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_AGGREGATING).isAggregating());
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_COLLAPSING).isCollapsing());
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_VERSIONED_COLLAPSING).isVersionedCollapsing());
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_GRAPHITE).isGraphite());
    ASSERT(DB::MergeTreeVariant(MERGETREE_MODE_COALESCING).isCoalescing());
}

TEST(getSupportedMergeTreeVariants)
{
    auto variants = DB::getSupportedMergeTreeVariants();
    ASSERT_EQ(variants.size(), 8);

    bool found_replacing = false;
    for (const auto& v : variants) {
        if (v.isReplacing()) {
            found_replacing = true;
            break;
        }
    }
    ASSERT(found_replacing);
}

// =============================================================================
// Roundtrip Tests
// =============================================================================

TEST(roundtrip_mode_name)
{
    // Test that mode -> name -> mode is identity
    MergeTreeMode modes[] = {
        MERGETREE_MODE_ORDINARY,
        MERGETREE_MODE_REPLACING,
        MERGETREE_MODE_SUMMING,
        MERGETREE_MODE_AGGREGATING,
        MERGETREE_MODE_COLLAPSING,
        MERGETREE_MODE_VERSIONED_COLLAPSING,
        MERGETREE_MODE_GRAPHITE,
        MERGETREE_MODE_COALESCING
    };

    for (MergeTreeMode mode : modes) {
        const char* name = mergetree_mode_to_name(mode);
        MergeTreeMode parsed = mergetree_mode_from_name(name);
        ASSERT_EQ(mode, parsed);
    }
}

// =============================================================================
// Main
// =============================================================================

int main()
{
    std::cout << "=== MergeTree Variants Unit Tests ===" << std::endl;
    std::cout << std::endl;

    // Tests run automatically via static constructors

    std::cout << std::endl;
    std::cout << "=== Results: " << tests_passed << "/" << tests_run << " passed ===" << std::endl;

    return tests_passed == tests_run ? 0 : 1;
}
