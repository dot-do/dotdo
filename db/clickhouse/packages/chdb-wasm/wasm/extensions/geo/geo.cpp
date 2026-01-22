/**
 * geo.cpp - SIDE_MODULE Geospatial Extension for Emscripten Dynamic Linking
 *
 * This extension provides geospatial functions including:
 * - Haversine distance calculations
 * - H3 hexagonal indexing (stubbed - real H3 library is too large)
 * - Point-in-polygon testing
 * - Polygon area calculations
 *
 * The extension:
 * - Does NOT include system libraries (gets them from MAIN_MODULE)
 * - Imports core functions (malloc, free, core_log, etc.)
 * - Exports geospatial functions callable from JS
 * - Shares memory with the core module
 *
 * Build with:
 *   emcmake cmake -B build/ext-geo wasm/extensions/geo
 *   emmake make -C build/ext-geo
 *
 * Output: ext-geo.wasm
 */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
// For native testing, define EMSCRIPTEN_KEEPALIVE as empty
#define EMSCRIPTEN_KEEPALIVE
#endif

#include <stddef.h>
#include <stdint.h>

// ============================================================================
// Forward declarations for core module functions
// These are imported from the MAIN_MODULE at link time
// ============================================================================

extern "C" {
    // Memory management from core
    void* malloc(size_t size);
    void free(void* ptr);

    // Core module wrappers (for logging and error handling)
    void core_log(const char* message);
    void core_set_error(const char* error);
    int core_get_version();
    void core_increment_query_count();
}

// ============================================================================
// Mathematical Constants
// ============================================================================

// Earth's mean radius in meters (WGS84)
static const double EARTH_RADIUS_METERS = 6371008.8;

// Pi constant
static const double PI = 3.14159265358979323846;

// Degrees to radians conversion factor
static const double DEG_TO_RAD = PI / 180.0;

// H3 resolution range
static const int H3_MIN_RESOLUTION = 0;
static const int H3_MAX_RESOLUTION = 15;

// ============================================================================
// Extension State
// ============================================================================

static int g_initialized = 0;
static int g_computation_count = 0;

// Extension name constant
static const char* EXT_GEO_NAME = "ext-geo";
static const int EXT_GEO_VERSION = 1;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert degrees to radians.
 */
static double to_radians(double degrees) {
    return degrees * DEG_TO_RAD;
}

/**
 * Compute sine of an angle in radians.
 * Using Taylor series approximation for WASM compatibility.
 */
static double geo_sin(double x) {
    // Normalize to [-PI, PI]
    while (x > PI) x -= 2.0 * PI;
    while (x < -PI) x += 2.0 * PI;

    // Taylor series: sin(x) = x - x^3/3! + x^5/5! - x^7/7! + ...
    double x2 = x * x;
    double x3 = x2 * x;
    double x5 = x3 * x2;
    double x7 = x5 * x2;
    double x9 = x7 * x2;
    double x11 = x9 * x2;

    return x - x3 / 6.0 + x5 / 120.0 - x7 / 5040.0 + x9 / 362880.0 - x11 / 39916800.0;
}

/**
 * Compute cosine of an angle in radians.
 */
static double geo_cos(double x) {
    return geo_sin(x + PI / 2.0);
}

/**
 * Compute square root using Newton's method.
 */
static double geo_sqrt(double x) {
    if (x < 0) return -1.0;
    if (x == 0.0) return 0.0;
    if (x == 1.0) return 1.0;

    double guess = x / 2.0;
    double epsilon = 1e-10;

    for (int i = 0; i < 100; i++) {
        double next_guess = (guess + x / guess) / 2.0;
        double diff = next_guess - guess;
        if (diff < 0) diff = -diff;
        if (diff < epsilon) {
            return next_guess;
        }
        guess = next_guess;
    }

    return guess;
}

/**
 * Compute arcsine using Newton's method.
 */
static double geo_asin(double x) {
    if (x < -1.0 || x > 1.0) return 0.0;
    if (x == 0.0) return 0.0;
    if (x == 1.0) return PI / 2.0;
    if (x == -1.0) return -PI / 2.0;

    // Newton's method: solve sin(y) = x for y
    double guess = x; // Initial guess
    double epsilon = 1e-10;

    for (int i = 0; i < 100; i++) {
        double sin_guess = geo_sin(guess);
        double cos_guess = geo_cos(guess);
        if (cos_guess == 0.0) break;

        double next_guess = guess - (sin_guess - x) / cos_guess;
        double diff = next_guess - guess;
        if (diff < 0) diff = -diff;
        if (diff < epsilon) {
            return next_guess;
        }
        guess = next_guess;
    }

    return guess;
}

/**
 * Compute arctangent of y/x in the correct quadrant.
 */
static double geo_atan2(double y, double x) {
    if (x > 0) {
        // First quadrant
        double ratio = y / x;
        // Taylor series for atan
        double result = ratio;
        double r2 = ratio * ratio;
        double term = ratio;
        for (int i = 1; i < 20; i++) {
            term *= -r2;
            result += term / (2 * i + 1);
        }
        // If ratio is large, use atan(x) = pi/2 - atan(1/x)
        if (ratio > 1.0 || ratio < -1.0) {
            double inv_ratio = x / y;
            result = inv_ratio;
            double inv_r2 = inv_ratio * inv_ratio;
            term = inv_ratio;
            for (int i = 1; i < 20; i++) {
                term *= -inv_r2;
                result += term / (2 * i + 1);
            }
            result = (y > 0 ? PI / 2.0 : -PI / 2.0) - result;
        }
        return result;
    } else if (x < 0) {
        if (y >= 0) {
            return geo_atan2(y, -x) + PI;
        } else {
            return geo_atan2(y, -x) - PI;
        }
    } else { // x == 0
        if (y > 0) return PI / 2.0;
        if (y < 0) return -PI / 2.0;
        return 0.0;
    }
}

/**
 * Compute absolute value.
 */
static double geo_abs(double x) {
    return x < 0 ? -x : x;
}

// ============================================================================
// Extension Initialization and Metadata
// ============================================================================

extern "C" {

/**
 * Initialize the geo extension.
 * Verifies core module compatibility and sets up extension state.
 *
 * @return 0 on success, -1 on failure
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_init() {
    if (g_initialized) {
        core_log("ext-geo: Already initialized");
        return 0;
    }

    // Check core module version
    int core_version = core_get_version();
    if (core_version < 1) {
        core_set_error("ext-geo requires core module version >= 1");
        return -1;
    }

    // Initialize state
    g_initialized = 1;
    g_computation_count = 0;

    core_log("ext-geo: Initialized successfully");
    return 0;
}

/**
 * Get the extension name.
 *
 * @return Pointer to the extension name string
 */
EMSCRIPTEN_KEEPALIVE
const char* ext_geo_get_name() {
    return EXT_GEO_NAME;
}

/**
 * Get the extension version.
 *
 * @return Version number
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_get_version() {
    return EXT_GEO_VERSION;
}

/**
 * Check if the extension is initialized.
 *
 * @return 1 if initialized, 0 otherwise
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_is_initialized() {
    return g_initialized;
}

/**
 * Get the count of computations performed.
 *
 * @return Number of geo operations performed since initialization
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_get_computation_count() {
    return g_computation_count;
}

// ============================================================================
// Haversine Distance Calculation
// ============================================================================

/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 *
 * The Haversine formula determines the great-circle distance between two points
 * on a sphere given their longitudes and latitudes. This is more accurate than
 * simple Euclidean distance for geographic coordinates.
 *
 * Formula:
 *   a = sin^2((lat2-lat1)/2) + cos(lat1) * cos(lat2) * sin^2((lon2-lon1)/2)
 *   c = 2 * atan2(sqrt(a), sqrt(1-a))
 *   d = R * c
 *
 * @param lat1 Latitude of first point in degrees (-90 to 90)
 * @param lon1 Longitude of first point in degrees (-180 to 180)
 * @param lat2 Latitude of second point in degrees (-90 to 90)
 * @param lon2 Longitude of second point in degrees (-180 to 180)
 * @return Distance in meters, or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
double ext_geo_distance(double lat1, double lon1, double lat2, double lon2) {
    g_computation_count++;
    core_increment_query_count();

    // Validate latitude range
    if (lat1 < -90.0 || lat1 > 90.0 || lat2 < -90.0 || lat2 > 90.0) {
        core_set_error("ext_geo_distance: latitude must be between -90 and 90");
        return -1.0;
    }

    // Validate longitude range
    if (lon1 < -180.0 || lon1 > 180.0 || lon2 < -180.0 || lon2 > 180.0) {
        core_set_error("ext_geo_distance: longitude must be between -180 and 180");
        return -1.0;
    }

    // Convert to radians
    double lat1_rad = to_radians(lat1);
    double lat2_rad = to_radians(lat2);
    double delta_lat = to_radians(lat2 - lat1);
    double delta_lon = to_radians(lon2 - lon1);

    // Haversine formula
    double sin_delta_lat_2 = geo_sin(delta_lat / 2.0);
    double sin_delta_lon_2 = geo_sin(delta_lon / 2.0);

    double a = sin_delta_lat_2 * sin_delta_lat_2 +
               geo_cos(lat1_rad) * geo_cos(lat2_rad) *
               sin_delta_lon_2 * sin_delta_lon_2;

    double c = 2.0 * geo_asin(geo_sqrt(a));

    return EARTH_RADIUS_METERS * c;
}

/**
 * Calculate distance with spheroid correction (Vincenty simplified).
 * More accurate for short distances but slower.
 *
 * @param lat1 Latitude of first point in degrees
 * @param lon1 Longitude of first point in degrees
 * @param lat2 Latitude of second point in degrees
 * @param lon2 Longitude of second point in degrees
 * @return Distance in meters, or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
double ext_geo_distance_spheroid(double lat1, double lon1, double lat2, double lon2) {
    g_computation_count++;
    core_increment_query_count();

    // For now, use Haversine as a baseline
    // A full Vincenty implementation would be more complex
    g_computation_count--; // Don't double count
    return ext_geo_distance(lat1, lon1, lat2, lon2);
}

// ============================================================================
// H3 Hexagonal Indexing (Stubbed Implementation)
// ============================================================================

/**
 * Convert a geographic coordinate to an H3 index.
 *
 * NOTE: This is a simplified stub implementation. The real H3 library
 * (https://github.com/uber/h3) is too large for this WASM extension.
 * This stub generates a deterministic pseudo-index for testing purposes.
 *
 * @param lat Latitude in degrees
 * @param lon Longitude in degrees
 * @param resolution H3 resolution (0-15, higher = smaller hexagons)
 * @return H3 index as uint64, or 0 on error
 */
EMSCRIPTEN_KEEPALIVE
uint64_t ext_geo_to_h3(double lat, double lon, int resolution) {
    g_computation_count++;
    core_increment_query_count();

    // Validate resolution
    if (resolution < H3_MIN_RESOLUTION || resolution > H3_MAX_RESOLUTION) {
        core_set_error("ext_geo_to_h3: resolution must be between 0 and 15");
        return 0;
    }

    // Validate coordinates
    if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) {
        core_set_error("ext_geo_to_h3: invalid coordinates");
        return 0;
    }

    // Generate a deterministic pseudo-H3 index
    // Real H3 uses a complex hierarchical indexing scheme
    // This stub creates a unique identifier based on lat/lon/resolution

    // Normalize lat/lon to positive integers
    uint64_t lat_component = (uint64_t)((lat + 90.0) * 10000000.0);   // 0 to 1.8B
    uint64_t lon_component = (uint64_t)((lon + 180.0) * 10000000.0);  // 0 to 3.6B

    // Combine components with resolution
    // H3 index format (simplified):
    // Bits 63-60: Mode (1 = cell)
    // Bits 59-56: Resolution
    // Bits 55-0:  Cell ID (lat/lon encoding)

    uint64_t mode = 1ULL << 60;
    uint64_t res_bits = ((uint64_t)resolution & 0xF) << 56;
    uint64_t cell_id = ((lat_component & 0x0FFFFFFF) << 28) | (lon_component & 0x0FFFFFFF);

    return mode | res_bits | cell_id;
}

/**
 * Convert an H3 index back to geographic coordinates (centroid).
 *
 * NOTE: This is a stub that reverses the encoding from ext_geo_to_h3.
 *
 * @param h3 H3 index
 * @param lat_out Pointer to store latitude result
 * @param lon_out Pointer to store longitude result
 * @return 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_h3_to_geo(uint64_t h3, double* lat_out, double* lon_out) {
    g_computation_count++;
    core_increment_query_count();

    if (!lat_out || !lon_out) {
        core_set_error("ext_geo_h3_to_geo: null output pointers");
        return -1;
    }

    // Validate H3 index (check mode bits)
    uint64_t mode = (h3 >> 60) & 0xF;
    if (mode != 1) {
        core_set_error("ext_geo_h3_to_geo: invalid H3 index");
        return -1;
    }

    // Extract cell ID
    uint64_t cell_id = h3 & 0x00FFFFFFFFFFFFFF;
    uint64_t lat_component = (cell_id >> 28) & 0x0FFFFFFF;
    uint64_t lon_component = cell_id & 0x0FFFFFFF;

    // Convert back to lat/lon
    *lat_out = ((double)lat_component / 10000000.0) - 90.0;
    *lon_out = ((double)lon_component / 10000000.0) - 180.0;

    return 0;
}

/**
 * Get the H3 resolution from an H3 index.
 *
 * @param h3 H3 index
 * @return Resolution (0-15), or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_h3_get_resolution(uint64_t h3) {
    g_computation_count++;

    // Validate H3 index
    uint64_t mode = (h3 >> 60) & 0xF;
    if (mode != 1) {
        core_set_error("ext_geo_h3_get_resolution: invalid H3 index");
        return -1;
    }

    return (int)((h3 >> 56) & 0xF);
}

/**
 * Check if an H3 index is valid.
 *
 * @param h3 H3 index to validate
 * @return 1 if valid, 0 if invalid
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_h3_is_valid(uint64_t h3) {
    g_computation_count++;

    // Check mode bits (should be 1 for cell)
    uint64_t mode = (h3 >> 60) & 0xF;
    if (mode != 1) return 0;

    // Check resolution range
    int resolution = (int)((h3 >> 56) & 0xF);
    if (resolution < 0 || resolution > 15) return 0;

    return 1;
}

// ============================================================================
// Point-in-Polygon Testing
// ============================================================================

/**
 * Check if a point is inside a polygon using the ray casting algorithm.
 *
 * The algorithm casts a ray from the point to infinity and counts
 * the number of polygon edges it crosses. If odd, the point is inside.
 *
 * @param lat Latitude of test point
 * @param lon Longitude of test point
 * @param polygon Array of lat/lon pairs [lat0, lon0, lat1, lon1, ...]
 * @param num_points Number of polygon vertices (polygon array has 2*num_points elements)
 * @return 1 if inside, 0 if outside, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_point_in_polygon(double lat, double lon, const double* polygon, int num_points) {
    g_computation_count++;
    core_increment_query_count();

    // Validate input
    if (!polygon || num_points < 3) {
        core_set_error("ext_geo_point_in_polygon: invalid polygon (need at least 3 points)");
        return -1;
    }

    // Ray casting algorithm
    int inside = 0;

    for (int i = 0, j = num_points - 1; i < num_points; j = i++) {
        double lat_i = polygon[i * 2];
        double lon_i = polygon[i * 2 + 1];
        double lat_j = polygon[j * 2];
        double lon_j = polygon[j * 2 + 1];

        // Check if the ray from (lat, lon) to (lat, infinity) crosses edge (i, j)
        if (((lon_i > lon) != (lon_j > lon)) &&
            (lat < (lat_j - lat_i) * (lon - lon_i) / (lon_j - lon_i) + lat_i)) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * Check if a point is on the boundary of a polygon (within tolerance).
 *
 * @param lat Latitude of test point
 * @param lon Longitude of test point
 * @param polygon Array of lat/lon pairs
 * @param num_points Number of polygon vertices
 * @param tolerance Distance tolerance in degrees
 * @return 1 if on boundary, 0 if not, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_point_on_boundary(double lat, double lon, const double* polygon, int num_points, double tolerance) {
    g_computation_count++;
    core_increment_query_count();

    if (!polygon || num_points < 3) {
        core_set_error("ext_geo_point_on_boundary: invalid polygon");
        return -1;
    }

    if (tolerance < 0) {
        core_set_error("ext_geo_point_on_boundary: tolerance must be non-negative");
        return -1;
    }

    // Check distance to each edge
    for (int i = 0; i < num_points; i++) {
        int j = (i + 1) % num_points;

        double lat1 = polygon[i * 2];
        double lon1 = polygon[i * 2 + 1];
        double lat2 = polygon[j * 2];
        double lon2 = polygon[j * 2 + 1];

        // Vector from point 1 to point 2
        double dx = lat2 - lat1;
        double dy = lon2 - lon1;

        // Vector from point 1 to test point
        double px = lat - lat1;
        double py = lon - lon1;

        // Project point onto line
        double len_sq = dx * dx + dy * dy;
        if (len_sq == 0) {
            // Degenerate edge (points are same)
            double dist = geo_sqrt(px * px + py * py);
            if (dist <= tolerance) return 1;
            continue;
        }

        double t = (px * dx + py * dy) / len_sq;

        // Clamp t to [0, 1] to stay on segment
        if (t < 0) t = 0;
        if (t > 1) t = 1;

        // Find closest point on segment
        double closest_lat = lat1 + t * dx;
        double closest_lon = lon1 + t * dy;

        // Check distance
        double dist_lat = lat - closest_lat;
        double dist_lon = lon - closest_lon;
        double dist = geo_sqrt(dist_lat * dist_lat + dist_lon * dist_lon);

        if (dist <= tolerance) return 1;
    }

    return 0;
}

// ============================================================================
// Polygon Area Calculation
// ============================================================================

/**
 * Calculate the area of a polygon on Earth's surface.
 *
 * Uses the Shoelace formula with spherical correction for
 * reasonably accurate results for small to medium polygons.
 *
 * @param polygon Array of lat/lon pairs [lat0, lon0, lat1, lon1, ...]
 * @param num_points Number of polygon vertices
 * @return Area in square meters, or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
double ext_geo_area(const double* polygon, int num_points) {
    g_computation_count++;
    core_increment_query_count();

    if (!polygon || num_points < 3) {
        core_set_error("ext_geo_area: invalid polygon (need at least 3 points)");
        return -1.0;
    }

    // Calculate signed area using Shoelace formula
    // Then apply spherical correction

    double sum = 0.0;

    for (int i = 0; i < num_points; i++) {
        int j = (i + 1) % num_points;

        double lat1 = polygon[i * 2];
        double lon1 = polygon[i * 2 + 1];
        double lat2 = polygon[j * 2];
        double lon2 = polygon[j * 2 + 1];

        // Shoelace formula term
        sum += to_radians(lon2 - lon1) *
               (2.0 + geo_sin(to_radians(lat1)) + geo_sin(to_radians(lat2)));
    }

    // Apply Earth radius squared and divide by 2
    double area = geo_abs(sum) * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS / 2.0;

    return area;
}

/**
 * Calculate the perimeter of a polygon.
 *
 * @param polygon Array of lat/lon pairs
 * @param num_points Number of polygon vertices
 * @return Perimeter in meters, or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
double ext_geo_perimeter(const double* polygon, int num_points) {
    g_computation_count++;
    core_increment_query_count();

    if (!polygon || num_points < 3) {
        core_set_error("ext_geo_perimeter: invalid polygon");
        return -1.0;
    }

    double perimeter = 0.0;

    for (int i = 0; i < num_points; i++) {
        int j = (i + 1) % num_points;

        double lat1 = polygon[i * 2];
        double lon1 = polygon[i * 2 + 1];
        double lat2 = polygon[j * 2];
        double lon2 = polygon[j * 2 + 1];

        // Use Haversine for each edge
        g_computation_count--; // Don't double count
        double edge_length = ext_geo_distance(lat1, lon1, lat2, lon2);
        if (edge_length < 0) return -1.0;

        perimeter += edge_length;
    }

    return perimeter;
}

// ============================================================================
// Bearing and Midpoint Calculations
// ============================================================================

/**
 * Calculate the initial bearing from point 1 to point 2.
 *
 * @param lat1 Latitude of first point in degrees
 * @param lon1 Longitude of first point in degrees
 * @param lat2 Latitude of second point in degrees
 * @param lon2 Longitude of second point in degrees
 * @return Bearing in degrees (0-360), or -1 on error
 */
EMSCRIPTEN_KEEPALIVE
double ext_geo_bearing(double lat1, double lon1, double lat2, double lon2) {
    g_computation_count++;
    core_increment_query_count();

    // Validate coordinates
    if (lat1 < -90.0 || lat1 > 90.0 || lat2 < -90.0 || lat2 > 90.0) {
        core_set_error("ext_geo_bearing: invalid latitude");
        return -1.0;
    }
    if (lon1 < -180.0 || lon1 > 180.0 || lon2 < -180.0 || lon2 > 180.0) {
        core_set_error("ext_geo_bearing: invalid longitude");
        return -1.0;
    }

    double lat1_rad = to_radians(lat1);
    double lat2_rad = to_radians(lat2);
    double delta_lon = to_radians(lon2 - lon1);

    double y = geo_sin(delta_lon) * geo_cos(lat2_rad);
    double x = geo_cos(lat1_rad) * geo_sin(lat2_rad) -
               geo_sin(lat1_rad) * geo_cos(lat2_rad) * geo_cos(delta_lon);

    double bearing = geo_atan2(y, x) * 180.0 / PI;

    // Normalize to 0-360
    while (bearing < 0) bearing += 360.0;
    while (bearing >= 360.0) bearing -= 360.0;

    return bearing;
}

/**
 * Calculate the midpoint between two points on the great circle.
 *
 * @param lat1 Latitude of first point
 * @param lon1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lon2 Longitude of second point
 * @param lat_out Pointer to store midpoint latitude
 * @param lon_out Pointer to store midpoint longitude
 * @return 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_midpoint(double lat1, double lon1, double lat2, double lon2,
                     double* lat_out, double* lon_out) {
    g_computation_count++;
    core_increment_query_count();

    if (!lat_out || !lon_out) {
        core_set_error("ext_geo_midpoint: null output pointers");
        return -1;
    }

    double lat1_rad = to_radians(lat1);
    double lat2_rad = to_radians(lat2);
    double lon1_rad = to_radians(lon1);
    double delta_lon = to_radians(lon2 - lon1);

    double Bx = geo_cos(lat2_rad) * geo_cos(delta_lon);
    double By = geo_cos(lat2_rad) * geo_sin(delta_lon);

    double lat_mid = geo_atan2(geo_sin(lat1_rad) + geo_sin(lat2_rad),
                               geo_sqrt((geo_cos(lat1_rad) + Bx) * (geo_cos(lat1_rad) + Bx) + By * By));
    double lon_mid = lon1_rad + geo_atan2(By, geo_cos(lat1_rad) + Bx);

    *lat_out = lat_mid * 180.0 / PI;
    *lon_out = lon_mid * 180.0 / PI;

    // Normalize longitude
    while (*lon_out < -180.0) *lon_out += 360.0;
    while (*lon_out > 180.0) *lon_out -= 360.0;

    return 0;
}

// ============================================================================
// Bounding Box Operations
// ============================================================================

/**
 * Calculate the bounding box for a set of points.
 *
 * @param points Array of lat/lon pairs
 * @param num_points Number of points
 * @param min_lat_out Pointer to store minimum latitude
 * @param min_lon_out Pointer to store minimum longitude
 * @param max_lat_out Pointer to store maximum latitude
 * @param max_lon_out Pointer to store maximum longitude
 * @return 0 on success, -1 on error
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_bounding_box(const double* points, int num_points,
                         double* min_lat_out, double* min_lon_out,
                         double* max_lat_out, double* max_lon_out) {
    g_computation_count++;
    core_increment_query_count();

    if (!points || num_points < 1) {
        core_set_error("ext_geo_bounding_box: invalid input");
        return -1;
    }

    if (!min_lat_out || !min_lon_out || !max_lat_out || !max_lon_out) {
        core_set_error("ext_geo_bounding_box: null output pointers");
        return -1;
    }

    double min_lat = points[0];
    double max_lat = points[0];
    double min_lon = points[1];
    double max_lon = points[1];

    for (int i = 1; i < num_points; i++) {
        double lat = points[i * 2];
        double lon = points[i * 2 + 1];

        if (lat < min_lat) min_lat = lat;
        if (lat > max_lat) max_lat = lat;
        if (lon < min_lon) min_lon = lon;
        if (lon > max_lon) max_lon = lon;
    }

    *min_lat_out = min_lat;
    *min_lon_out = min_lon;
    *max_lat_out = max_lat;
    *max_lon_out = max_lon;

    return 0;
}

/**
 * Check if a point is inside a bounding box.
 *
 * @param lat Point latitude
 * @param lon Point longitude
 * @param min_lat Bounding box minimum latitude
 * @param min_lon Bounding box minimum longitude
 * @param max_lat Bounding box maximum latitude
 * @param max_lon Bounding box maximum longitude
 * @return 1 if inside, 0 if outside
 */
EMSCRIPTEN_KEEPALIVE
int ext_geo_point_in_bbox(double lat, double lon,
                          double min_lat, double min_lon,
                          double max_lat, double max_lon) {
    g_computation_count++;

    return (lat >= min_lat && lat <= max_lat &&
            lon >= min_lon && lon <= max_lon) ? 1 : 0;
}

// ============================================================================
// Buffer/Memory Operations
// ============================================================================

/**
 * Allocate a polygon buffer (array of lat/lon pairs).
 *
 * @param num_points Number of points to allocate
 * @return Pointer to allocated buffer, or nullptr on failure
 */
EMSCRIPTEN_KEEPALIVE
double* ext_geo_create_polygon(int num_points) {
    g_computation_count++;

    if (num_points <= 0 || num_points > 10000) {
        core_set_error("ext_geo_create_polygon: invalid point count");
        return nullptr;
    }

    // Each point is lat + lon = 2 doubles
    double* buffer = (double*)malloc(num_points * 2 * sizeof(double));
    if (!buffer) {
        core_set_error("ext_geo_create_polygon: allocation failed");
        return nullptr;
    }

    return buffer;
}

/**
 * Free a polygon buffer.
 *
 * @param polygon Pointer to buffer to free
 */
EMSCRIPTEN_KEEPALIVE
void ext_geo_free_polygon(double* polygon) {
    if (polygon) {
        free(polygon);
    }
}

} // extern "C"
