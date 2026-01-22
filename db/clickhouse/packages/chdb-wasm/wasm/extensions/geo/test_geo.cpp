/**
 * test_geo.cpp - Native Unit Tests for ext-geo Side Module
 *
 * These tests verify the geospatial functions work correctly in a native build
 * before compiling to WASM. This allows faster iteration during development.
 *
 * Build for native:
 *   cmake -B build/ext-geo-test -DBUILD_TESTS=ON wasm/extensions/geo
 *   make -C build/ext-geo-test
 *   ./build/ext-geo-test/test_ext_geo_native
 *
 * Note: In native builds, the core functions are stubbed out with
 * simple implementations to allow standalone testing.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <cmath>

// ============================================================================
// Stub implementations for core functions (used in native testing)
// ============================================================================

static char g_last_error[1024] = "";
static int g_query_count = 0;

extern "C" {

// Stub: Memory allocation (use system malloc)
void* malloc(size_t size);
void free(void* ptr);

// Stub: Core logging - just print to stdout
void core_log(const char* message) {
    printf("[CORE] %s\n", message);
}

// Stub: Error handling
void core_set_error(const char* error) {
    if (error) {
        strncpy(g_last_error, error, sizeof(g_last_error) - 1);
        g_last_error[sizeof(g_last_error) - 1] = '\0';
        printf("[CORE ERROR] %s\n", error);
    }
}

const char* core_get_error() {
    return g_last_error;
}

// Stub: Core version
int core_get_version() {
    return 1;
}

// Stub: Query count tracking
void core_increment_query_count() {
    g_query_count++;
}

int core_get_query_count() {
    return g_query_count;
}

} // extern "C"

// ============================================================================
// Include the geo module functions (forward declarations)
// ============================================================================

extern "C" {
    // Initialization and metadata
    int ext_geo_init();
    const char* ext_geo_get_name();
    int ext_geo_get_version();
    int ext_geo_is_initialized();
    int ext_geo_get_computation_count();

    // Distance calculations
    double ext_geo_distance(double lat1, double lon1, double lat2, double lon2);
    double ext_geo_distance_spheroid(double lat1, double lon1, double lat2, double lon2);

    // H3 functions
    uint64_t ext_geo_to_h3(double lat, double lon, int resolution);
    int ext_geo_h3_to_geo(uint64_t h3, double* lat_out, double* lon_out);
    int ext_geo_h3_get_resolution(uint64_t h3);
    int ext_geo_h3_is_valid(uint64_t h3);

    // Point-in-polygon
    int ext_geo_point_in_polygon(double lat, double lon, const double* polygon, int num_points);
    int ext_geo_point_on_boundary(double lat, double lon, const double* polygon, int num_points, double tolerance);

    // Polygon operations
    double ext_geo_area(const double* polygon, int num_points);
    double ext_geo_perimeter(const double* polygon, int num_points);

    // Bearing and midpoint
    double ext_geo_bearing(double lat1, double lon1, double lat2, double lon2);
    int ext_geo_midpoint(double lat1, double lon1, double lat2, double lon2, double* lat_out, double* lon_out);

    // Bounding box
    int ext_geo_bounding_box(const double* points, int num_points,
                             double* min_lat, double* min_lon, double* max_lat, double* max_lon);
    int ext_geo_point_in_bbox(double lat, double lon,
                              double min_lat, double min_lon, double max_lat, double max_lon);

    // Memory operations
    double* ext_geo_create_polygon(int num_points);
    void ext_geo_free_polygon(double* polygon);
}

// ============================================================================
// Test Macros
// ============================================================================

#define TEST_ASSERT(condition, message) \
    do { \
        if (!(condition)) { \
            printf("FAIL: %s (line %d)\n", message, __LINE__); \
            return 1; \
        } \
    } while (0)

#define TEST_ASSERT_EQ(expected, actual, message) \
    do { \
        auto _expected = (expected); \
        auto _actual = (actual); \
        if (_expected != _actual) { \
            printf("FAIL: %s - expected %lld, got %lld (line %d)\n", \
                   message, (long long)_expected, (long long)_actual, __LINE__); \
            return 1; \
        } \
    } while (0)

#define TEST_ASSERT_NEAR(expected, actual, epsilon, message) \
    do { \
        double _expected = (expected); \
        double _actual = (actual); \
        double _diff = _expected - _actual; \
        if (_diff < 0) _diff = -_diff; \
        if (_diff > (epsilon)) { \
            printf("FAIL: %s - expected %.10f, got %.10f, diff %.10f > epsilon %.10f (line %d)\n", \
                   message, _expected, _actual, _diff, (double)(epsilon), __LINE__); \
            return 1; \
        } \
    } while (0)

#define RUN_TEST(test_fn) \
    do { \
        printf("Running %s...\n", #test_fn); \
        int result = test_fn(); \
        if (result != 0) { \
            printf("  FAILED\n"); \
            failed++; \
        } else { \
            printf("  PASSED\n"); \
            passed++; \
        } \
    } while (0)

// ============================================================================
// Test Cases - Initialization
// ============================================================================

int test_init() {
    int result = ext_geo_init();
    TEST_ASSERT_EQ(0, result, "ext_geo_init should return 0");
    TEST_ASSERT_EQ(1, ext_geo_is_initialized(), "should be initialized");
    return 0;
}

int test_metadata() {
    ext_geo_init();

    const char* name = ext_geo_get_name();
    TEST_ASSERT(name != nullptr, "name should not be null");
    TEST_ASSERT(strcmp(name, "ext-geo") == 0, "name should be 'ext-geo'");

    int version = ext_geo_get_version();
    TEST_ASSERT_EQ(1, version, "version should be 1");

    return 0;
}

// ============================================================================
// Test Cases - Haversine Distance
// ============================================================================

int test_distance_same_point() {
    ext_geo_init();

    // Distance from a point to itself should be 0
    double distance = ext_geo_distance(37.7749, -122.4194, 37.7749, -122.4194);
    TEST_ASSERT_NEAR(0.0, distance, 0.001, "distance to self should be 0");

    return 0;
}

int test_distance_sf_to_nyc() {
    ext_geo_init();

    // San Francisco to New York City
    // SF: 37.7749, -122.4194
    // NYC: 40.7128, -74.0060
    // Expected: ~4130 km (4,130,000 meters)

    double distance = ext_geo_distance(37.7749, -122.4194, 40.7128, -74.0060);

    // Allow 1% tolerance for our Taylor series approximations
    TEST_ASSERT(distance > 4000000.0, "SF to NYC should be > 4000 km");
    TEST_ASSERT(distance < 4300000.0, "SF to NYC should be < 4300 km");

    return 0;
}

int test_distance_london_to_paris() {
    ext_geo_init();

    // London to Paris
    // London: 51.5074, -0.1278
    // Paris: 48.8566, 2.3522
    // Expected: ~344 km

    double distance = ext_geo_distance(51.5074, -0.1278, 48.8566, 2.3522);

    TEST_ASSERT(distance > 300000.0, "London to Paris should be > 300 km");
    TEST_ASSERT(distance < 400000.0, "London to Paris should be < 400 km");

    return 0;
}

int test_distance_equator() {
    ext_geo_init();

    // Two points on the equator, 1 degree apart
    // At the equator, 1 degree longitude ~ 111 km
    double distance = ext_geo_distance(0.0, 0.0, 0.0, 1.0);

    TEST_ASSERT(distance > 110000.0, "1 degree at equator should be > 110 km");
    TEST_ASSERT(distance < 112000.0, "1 degree at equator should be < 112 km");

    return 0;
}

int test_distance_poles() {
    ext_geo_init();

    // North pole to South pole
    // Expected: ~20,000 km (half Earth's circumference)
    double distance = ext_geo_distance(90.0, 0.0, -90.0, 0.0);

    TEST_ASSERT(distance > 19000000.0, "pole to pole should be > 19000 km");
    TEST_ASSERT(distance < 21000000.0, "pole to pole should be < 21000 km");

    return 0;
}

int test_distance_invalid_coords() {
    ext_geo_init();

    // Invalid latitude
    double result = ext_geo_distance(100.0, 0.0, 0.0, 0.0);
    TEST_ASSERT(result < 0, "should fail for lat > 90");

    // Invalid longitude
    result = ext_geo_distance(0.0, 200.0, 0.0, 0.0);
    TEST_ASSERT(result < 0, "should fail for lon > 180");

    return 0;
}

// ============================================================================
// Test Cases - H3 Indexing (Stubbed)
// ============================================================================

int test_h3_basic() {
    ext_geo_init();

    // Convert SF coordinates to H3 at resolution 9
    uint64_t h3 = ext_geo_to_h3(37.7749, -122.4194, 9);

    TEST_ASSERT(h3 != 0, "H3 index should not be 0");
    TEST_ASSERT(ext_geo_h3_is_valid(h3) == 1, "H3 index should be valid");

    return 0;
}

int test_h3_resolution() {
    ext_geo_init();

    uint64_t h3 = ext_geo_to_h3(37.7749, -122.4194, 7);
    int resolution = ext_geo_h3_get_resolution(h3);

    TEST_ASSERT_EQ(7, resolution, "resolution should be 7");

    return 0;
}

int test_h3_roundtrip() {
    ext_geo_init();

    double lat_in = 37.7749;
    double lon_in = -122.4194;

    uint64_t h3 = ext_geo_to_h3(lat_in, lon_in, 9);

    double lat_out, lon_out;
    int result = ext_geo_h3_to_geo(h3, &lat_out, &lon_out);

    TEST_ASSERT_EQ(0, result, "h3_to_geo should succeed");

    // Our stub should round-trip reasonably well
    TEST_ASSERT_NEAR(lat_in, lat_out, 0.01, "latitude should round-trip");
    TEST_ASSERT_NEAR(lon_in, lon_out, 0.01, "longitude should round-trip");

    return 0;
}

int test_h3_invalid_resolution() {
    ext_geo_init();

    // Resolution must be 0-15
    uint64_t h3 = ext_geo_to_h3(37.7749, -122.4194, 16);
    TEST_ASSERT_EQ(0, h3, "should fail for resolution > 15");

    h3 = ext_geo_to_h3(37.7749, -122.4194, -1);
    TEST_ASSERT_EQ(0, h3, "should fail for negative resolution");

    return 0;
}

// ============================================================================
// Test Cases - Point-in-Polygon
// ============================================================================

int test_point_in_triangle() {
    ext_geo_init();

    // Simple triangle
    double triangle[] = {
        0.0, 0.0,   // Point 1
        2.0, 0.0,   // Point 2
        1.0, 2.0    // Point 3
    };

    // Point inside
    int result = ext_geo_point_in_polygon(1.0, 0.5, triangle, 3);
    TEST_ASSERT_EQ(1, result, "point (1, 0.5) should be inside");

    // Point outside
    result = ext_geo_point_in_polygon(3.0, 0.0, triangle, 3);
    TEST_ASSERT_EQ(0, result, "point (3, 0) should be outside");

    return 0;
}

int test_point_in_square() {
    ext_geo_init();

    // Unit square
    double square[] = {
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
    };

    // Center point
    int result = ext_geo_point_in_polygon(0.5, 0.5, square, 4);
    TEST_ASSERT_EQ(1, result, "center should be inside");

    // Corner (on boundary - behavior may vary)
    // Outside point
    result = ext_geo_point_in_polygon(2.0, 2.0, square, 4);
    TEST_ASSERT_EQ(0, result, "point (2, 2) should be outside");

    return 0;
}

int test_point_in_polygon_invalid() {
    ext_geo_init();

    // Less than 3 points
    double line[] = { 0.0, 0.0, 1.0, 1.0 };
    int result = ext_geo_point_in_polygon(0.5, 0.5, line, 2);
    TEST_ASSERT_EQ(-1, result, "should fail for < 3 points");

    // Null polygon
    result = ext_geo_point_in_polygon(0.5, 0.5, nullptr, 3);
    TEST_ASSERT_EQ(-1, result, "should fail for null polygon");

    return 0;
}

// ============================================================================
// Test Cases - Polygon Area
// ============================================================================

int test_area_unit_square() {
    ext_geo_init();

    // Unit square at equator (1 degree x 1 degree)
    double square[] = {
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
    };

    double area = ext_geo_area(square, 4);

    // 1 degree at equator ~ 111 km
    // Area should be roughly 111 * 111 km^2 = ~12,000 km^2
    TEST_ASSERT(area > 0, "area should be positive");
    TEST_ASSERT(area > 10e9, "area should be > 10B sq meters");
    TEST_ASSERT(area < 15e9, "area should be < 15B sq meters");

    return 0;
}

int test_area_invalid() {
    ext_geo_init();

    double line[] = { 0.0, 0.0, 1.0, 1.0 };
    double area = ext_geo_area(line, 2);
    TEST_ASSERT(area < 0, "should fail for < 3 points");

    return 0;
}

// ============================================================================
// Test Cases - Perimeter
// ============================================================================

int test_perimeter_square() {
    ext_geo_init();

    // Unit square at equator
    double square[] = {
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
    };

    double perimeter = ext_geo_perimeter(square, 4);

    // 4 sides of ~111 km each = ~444 km
    TEST_ASSERT(perimeter > 400000.0, "perimeter should be > 400 km");
    TEST_ASSERT(perimeter < 500000.0, "perimeter should be < 500 km");

    return 0;
}

// ============================================================================
// Test Cases - Bearing
// ============================================================================

int test_bearing_north() {
    ext_geo_init();

    // Going straight north: bearing should be ~0 degrees
    double bearing = ext_geo_bearing(0.0, 0.0, 10.0, 0.0);

    TEST_ASSERT(bearing >= 0.0, "bearing should be >= 0");
    TEST_ASSERT(bearing < 5.0 || bearing > 355.0, "north bearing should be ~0");

    return 0;
}

int test_bearing_east() {
    ext_geo_init();

    // Going straight east: bearing should be ~90 degrees
    double bearing = ext_geo_bearing(0.0, 0.0, 0.0, 10.0);

    TEST_ASSERT(bearing > 85.0, "east bearing should be > 85");
    TEST_ASSERT(bearing < 95.0, "east bearing should be < 95");

    return 0;
}

int test_bearing_south() {
    ext_geo_init();

    // Going straight south: bearing should be ~180 degrees
    double bearing = ext_geo_bearing(10.0, 0.0, 0.0, 0.0);

    TEST_ASSERT(bearing > 175.0, "south bearing should be > 175");
    TEST_ASSERT(bearing < 185.0, "south bearing should be < 185");

    return 0;
}

// ============================================================================
// Test Cases - Midpoint
// ============================================================================

int test_midpoint_equator() {
    ext_geo_init();

    double lat_out, lon_out;
    int result = ext_geo_midpoint(0.0, 0.0, 0.0, 10.0, &lat_out, &lon_out);

    TEST_ASSERT_EQ(0, result, "midpoint should succeed");
    TEST_ASSERT_NEAR(0.0, lat_out, 0.1, "midpoint lat should be 0");
    TEST_ASSERT_NEAR(5.0, lon_out, 0.5, "midpoint lon should be ~5");

    return 0;
}

// ============================================================================
// Test Cases - Bounding Box
// ============================================================================

int test_bounding_box() {
    ext_geo_init();

    double points[] = {
        10.0, 20.0,
        15.0, 25.0,
        12.0, 30.0,
        8.0, 22.0
    };

    double min_lat, min_lon, max_lat, max_lon;
    int result = ext_geo_bounding_box(points, 4, &min_lat, &min_lon, &max_lat, &max_lon);

    TEST_ASSERT_EQ(0, result, "bounding_box should succeed");
    TEST_ASSERT_NEAR(8.0, min_lat, 0.001, "min_lat should be 8");
    TEST_ASSERT_NEAR(20.0, min_lon, 0.001, "min_lon should be 20");
    TEST_ASSERT_NEAR(15.0, max_lat, 0.001, "max_lat should be 15");
    TEST_ASSERT_NEAR(30.0, max_lon, 0.001, "max_lon should be 30");

    return 0;
}

int test_point_in_bbox() {
    ext_geo_init();

    // Inside
    int result = ext_geo_point_in_bbox(10.0, 25.0, 8.0, 20.0, 15.0, 30.0);
    TEST_ASSERT_EQ(1, result, "point should be inside bbox");

    // Outside
    result = ext_geo_point_in_bbox(20.0, 25.0, 8.0, 20.0, 15.0, 30.0);
    TEST_ASSERT_EQ(0, result, "point should be outside bbox");

    return 0;
}

// ============================================================================
// Test Cases - Memory Operations
// ============================================================================

int test_create_polygon() {
    ext_geo_init();

    double* polygon = ext_geo_create_polygon(5);
    TEST_ASSERT(polygon != nullptr, "polygon should be allocated");

    // Fill with test data
    polygon[0] = 0.0;
    polygon[1] = 0.0;
    polygon[2] = 1.0;
    polygon[3] = 0.0;
    polygon[4] = 1.0;
    polygon[5] = 1.0;
    polygon[6] = 0.0;
    polygon[7] = 1.0;
    polygon[8] = 0.0;
    polygon[9] = 0.0; // Close the polygon

    ext_geo_free_polygon(polygon);

    return 0;
}

int test_create_polygon_invalid() {
    ext_geo_init();

    double* polygon = ext_geo_create_polygon(0);
    TEST_ASSERT(polygon == nullptr, "zero-length polygon should fail");

    polygon = ext_geo_create_polygon(-1);
    TEST_ASSERT(polygon == nullptr, "negative length should fail");

    return 0;
}

// ============================================================================
// Test Cases - Computation Count
// ============================================================================

int test_computation_count() {
    ext_geo_init();

    int initial_count = ext_geo_get_computation_count();

    ext_geo_distance(0.0, 0.0, 1.0, 1.0);
    ext_geo_to_h3(37.7749, -122.4194, 9);

    int final_count = ext_geo_get_computation_count();

    TEST_ASSERT(final_count > initial_count, "computation count should increase");

    return 0;
}

// ============================================================================
// Main Test Runner
// ============================================================================

int main() {
    printf("\n");
    printf("================================================================\n");
    printf("  ext-geo Native Unit Tests\n");
    printf("================================================================\n");
    printf("\n");

    int passed = 0;
    int failed = 0;

    // Initialization tests
    RUN_TEST(test_init);
    RUN_TEST(test_metadata);

    // Distance tests
    RUN_TEST(test_distance_same_point);
    RUN_TEST(test_distance_sf_to_nyc);
    RUN_TEST(test_distance_london_to_paris);
    RUN_TEST(test_distance_equator);
    RUN_TEST(test_distance_poles);
    RUN_TEST(test_distance_invalid_coords);

    // H3 tests
    RUN_TEST(test_h3_basic);
    RUN_TEST(test_h3_resolution);
    RUN_TEST(test_h3_roundtrip);
    RUN_TEST(test_h3_invalid_resolution);

    // Point-in-polygon tests
    RUN_TEST(test_point_in_triangle);
    RUN_TEST(test_point_in_square);
    RUN_TEST(test_point_in_polygon_invalid);

    // Area tests
    RUN_TEST(test_area_unit_square);
    RUN_TEST(test_area_invalid);

    // Perimeter tests
    RUN_TEST(test_perimeter_square);

    // Bearing tests
    RUN_TEST(test_bearing_north);
    RUN_TEST(test_bearing_east);
    RUN_TEST(test_bearing_south);

    // Midpoint tests
    RUN_TEST(test_midpoint_equator);

    // Bounding box tests
    RUN_TEST(test_bounding_box);
    RUN_TEST(test_point_in_bbox);

    // Memory tests
    RUN_TEST(test_create_polygon);
    RUN_TEST(test_create_polygon_invalid);

    // Tracking tests
    RUN_TEST(test_computation_count);

    // Summary
    printf("\n");
    printf("================================================================\n");
    printf("  Results: %d passed, %d failed\n", passed, failed);
    printf("================================================================\n");
    printf("\n");

    return failed > 0 ? 1 : 0;
}
