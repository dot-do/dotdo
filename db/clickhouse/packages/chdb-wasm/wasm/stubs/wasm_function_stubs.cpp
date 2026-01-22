/**
 * wasm_function_stubs.cpp - Stub implementations for heavy functions not supported in WASM
 *
 * This file provides stub implementations for ClickHouse functions that are too
 * resource-intensive, require external libraries, or are otherwise unsuitable for
 * the WASM build.
 *
 * STUB vs KEEP Decision Matrix:
 * =============================
 *
 * STUB (exclude from WASM):
 * -------------------------
 * Geospatial:
 * - H3 functions (h3ToGeo, h3ToParent, h3kRing, etc.) - Requires H3 library (~2MB)
 * - S2 functions (s2ToGeo, s2GetNeighbors, etc.) - Requires S2 library (~3MB)
 * - GeoHash functions (complex variant) - Heavy spatial indexing
 *
 * Machine Learning:
 * - catboostEvaluate - Requires CatBoost library (~50MB)
 * - MLMethod functions - Various ML inference
 * - stochasticLinearRegression - Training functions
 * - stochasticLogisticRegression
 *
 * Natural Language:
 * - lemmatize - Requires language models
 * - stem - Requires stemming dictionaries
 * - synonyms - Requires synonym databases
 * - detectLanguage - Requires language models
 * - detectCharset - Requires charset detection libs
 *
 * Cryptography (heavy):
 * - encrypt/decrypt with external providers
 * - Complex key derivation functions
 *
 * External integrations:
 * - s3* functions - AWS SDK required
 * - hdfs* functions - HDFS client required
 * - url* functions - Network I/O required
 *
 * Resource-intensive:
 * - windowFunnel (complex state) - Can be enabled with limits
 * - retention (complex state)
 * - sequenceMatch/sequenceCount - Complex pattern matching
 *
 * KEEP (include in WASM):
 * -----------------------
 * Core SQL functions:
 * - Arithmetic: plus, minus, multiply, divide, modulo, etc.
 * - Comparison: equals, notEquals, less, greater, etc.
 * - Logical: and, or, not, xor
 * - Type conversion: toInt*, toFloat*, toString, toDate*, etc.
 *
 * String functions:
 * - Basic: length, empty, notEmpty, reverse, concat
 * - Manipulation: substring, trim, lower, upper
 * - Search: position, positionUTF8, match (simple regex)
 * - Transformation: replaceOne, replaceAll, replaceRegexpOne
 *
 * Math functions:
 * - Basic: abs, sign, floor, ceil, round, exp, log, sqrt, pow
 * - Trigonometric: sin, cos, tan, asin, acos, atan
 *
 * Date/Time functions:
 * - Extraction: toYear, toMonth, toDay, toHour, toMinute, toSecond
 * - Arithmetic: addDays, addMonths, dateDiff
 * - Formatting: formatDateTime, toDate, toDateTime
 *
 * Aggregate functions (basic):
 * - count, sum, avg, min, max
 * - any, anyLast, argMin, argMax
 * - groupArray, groupUniqArray (with size limits)
 *
 * Array functions:
 * - Basic: length, empty, arrayElement, has, indexOf
 * - Manipulation: arrayConcat, arraySlice, arrayReverse
 * - Transformation: arrayMap, arrayFilter, arrayReduce
 *
 * Hash functions:
 * - Fast hashes: cityHash64, sipHash64, xxHash64
 * - Crypto hashes: MD5, SHA1, SHA256 (if size acceptable)
 *
 * JSON functions:
 * - JSONExtract*, JSONHas, JSONLength, JSONType
 *
 * Usage:
 * ======
 * Define USE_WASM_STUBS to enable these stub implementations.
 */

#ifdef USE_WASM_STUBS

#include <stdexcept>
#include <string>
#include <vector>

namespace DB
{

// Error codes
namespace ErrorCodes
{
    extern const int NOT_IMPLEMENTED;
    extern const int SUPPORT_IS_DISABLED;
    extern const int FUNCTION_NOT_ALLOWED;
}

// If not already defined in wasm_storage_stubs.cpp
#ifndef WASM_NOT_SUPPORTED
class Exception : public std::runtime_error
{
public:
    Exception(int code, const std::string& message)
        : std::runtime_error(message), error_code(code) {}
    int code() const { return error_code; }
private:
    int error_code;
};
#endif

/**
 * Helper macro for throwing WASM function not-supported exceptions
 */
#define WASM_FUNCTION_NOT_SUPPORTED(func_name, reason) \
    throw Exception(ErrorCodes::NOT_IMPLEMENTED, \
        "Function '" + std::string(func_name) + "' is not supported in WASM build. " \
        "Reason: " + std::string(reason))


// ============================================================================
// Base class for stubbed functions
// ============================================================================

/**
 * Mock IFunction interface (simplified)
 * Real version: src/Functions/IFunction.h
 */
class IFunction
{
public:
    virtual ~IFunction() = default;
    virtual std::string getName() const = 0;
    virtual void execute() = 0;
    virtual size_t getNumberOfArguments() const { return 0; }
    virtual bool isVariadic() const { return false; }
};


// ============================================================================
// H3 Geospatial Functions Stubs
// ============================================================================

/**
 * H3 library functions - Uber's hexagonal hierarchical geospatial indexing
 *
 * Stubbed because:
 * - Requires H3 C library (~2MB compiled)
 * - Complex geometric calculations
 * - Not commonly needed in browser WASM use cases
 */

class FunctionH3IsValid : public IFunction
{
public:
    std::string getName() const override { return "h3IsValid"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3IsValid", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3GetResolution : public IFunction
{
public:
    std::string getName() const override { return "h3GetResolution"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3GetResolution", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3ToGeo : public IFunction
{
public:
    std::string getName() const override { return "h3ToGeo"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3ToGeo", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3ToGeoBoundary : public IFunction
{
public:
    std::string getName() const override { return "h3ToGeoBoundary"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3ToGeoBoundary", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3kRing : public IFunction
{
public:
    std::string getName() const override { return "h3kRing"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3kRing", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionGeoToH3 : public IFunction
{
public:
    std::string getName() const override { return "geoToH3"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("geoToH3", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3ToParent : public IFunction
{
public:
    std::string getName() const override { return "h3ToParent"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3ToParent", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3ToChildren : public IFunction
{
public:
    std::string getName() const override { return "h3ToChildren"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3ToChildren", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3Distance : public IFunction
{
public:
    std::string getName() const override { return "h3Distance"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3Distance", "H3 geospatial library not included in WASM build (~2MB)");
    }
};

class FunctionH3HexAreaKm2 : public IFunction
{
public:
    std::string getName() const override { return "h3HexAreaKm2"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("h3HexAreaKm2", "H3 geospatial library not included in WASM build (~2MB)");
    }
};


// ============================================================================
// S2 Geospatial Functions Stubs
// ============================================================================

/**
 * S2 library functions - Google's spherical geometry library
 *
 * Stubbed because:
 * - Requires S2 C++ library (~3MB compiled)
 * - Heavy computational geometry
 * - Complex dependency chain
 */

class FunctionS2CellsIntersect : public IFunction
{
public:
    std::string getName() const override { return "s2CellsIntersect"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2CellsIntersect", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionS2CapContains : public IFunction
{
public:
    std::string getName() const override { return "s2CapContains"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2CapContains", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionS2CapUnion : public IFunction
{
public:
    std::string getName() const override { return "s2CapUnion"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2CapUnion", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionS2GetNeighbors : public IFunction
{
public:
    std::string getName() const override { return "s2GetNeighbors"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2GetNeighbors", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionS2RectAdd : public IFunction
{
public:
    std::string getName() const override { return "s2RectAdd"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2RectAdd", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionS2RectContains : public IFunction
{
public:
    std::string getName() const override { return "s2RectContains"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2RectContains", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionS2RectIntersection : public IFunction
{
public:
    std::string getName() const override { return "s2RectIntersection"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2RectIntersection", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionS2ToGeo : public IFunction
{
public:
    std::string getName() const override { return "s2ToGeo"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s2ToGeo", "S2 geometry library not included in WASM build (~3MB)");
    }
};

class FunctionGeoToS2 : public IFunction
{
public:
    std::string getName() const override { return "geoToS2"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("geoToS2", "S2 geometry library not included in WASM build (~3MB)");
    }
};


// ============================================================================
// Machine Learning Functions Stubs
// ============================================================================

/**
 * CatBoost ML inference
 *
 * Stubbed because:
 * - Requires CatBoost library (~50MB or more)
 * - Heavy computation
 * - Model loading requires filesystem access
 */

class FunctionCatBoostEvaluate : public IFunction
{
public:
    std::string getName() const override { return "catboostEvaluate"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("catboostEvaluate",
            "CatBoost ML library not included in WASM build (~50MB). "
            "Consider using a dedicated ML service for inference.");
    }
};


/**
 * Stochastic Linear Regression
 *
 * Stubbed because:
 * - Training requires significant memory
 * - State management complex for WASM
 */

class FunctionStochasticLinearRegression : public IFunction
{
public:
    std::string getName() const override { return "stochasticLinearRegression"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("stochasticLinearRegression",
            "ML training functions not supported in WASM build. "
            "Use pre-trained models or external ML services.");
    }
};

class FunctionStochasticLogisticRegression : public IFunction
{
public:
    std::string getName() const override { return "stochasticLogisticRegression"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("stochasticLogisticRegression",
            "ML training functions not supported in WASM build. "
            "Use pre-trained models or external ML services.");
    }
};


// ============================================================================
// Natural Language Processing Functions Stubs
// ============================================================================

/**
 * Lemmatization
 *
 * Stubbed because:
 * - Requires language models (large dictionaries)
 * - Different models per language
 */

class FunctionLemmatize : public IFunction
{
public:
    std::string getName() const override { return "lemmatize"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("lemmatize",
            "NLP lemmatization requires language models not included in WASM build. "
            "Consider pre-processing text before loading into WASM.");
    }
};


/**
 * Stemming
 *
 * Stubbed because:
 * - Requires stemming dictionaries
 * - Language-specific implementations
 */

class FunctionStem : public IFunction
{
public:
    std::string getName() const override { return "stem"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("stem",
            "NLP stemming requires dictionaries not included in WASM build.");
    }
};


/**
 * Synonym lookup
 *
 * Stubbed because:
 * - Requires synonym databases
 * - Large memory footprint
 */

class FunctionSynonyms : public IFunction
{
public:
    std::string getName() const override { return "synonyms"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("synonyms",
            "Synonym lookup requires databases not included in WASM build.");
    }
};


/**
 * Language detection
 *
 * Stubbed because:
 * - Requires language detection models
 * - Statistical models are large
 */

class FunctionDetectLanguage : public IFunction
{
public:
    std::string getName() const override { return "detectLanguage"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("detectLanguage",
            "Language detection requires models not included in WASM build.");
    }
};

class FunctionDetectLanguageMixed : public IFunction
{
public:
    std::string getName() const override { return "detectLanguageMixed"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("detectLanguageMixed",
            "Language detection requires models not included in WASM build.");
    }
};


/**
 * Charset detection
 *
 * Stubbed because:
 * - Requires charset detection library (like ICU)
 * - Large model files
 */

class FunctionDetectCharset : public IFunction
{
public:
    std::string getName() const override { return "detectCharset"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("detectCharset",
            "Charset detection requires libraries not included in WASM build.");
    }
};


// ============================================================================
// External Integration Functions Stubs
// ============================================================================

/**
 * S3 integration functions
 *
 * Stubbed because:
 * - Requires AWS SDK
 * - Network I/O not available
 */

class FunctionS3Read : public IFunction
{
public:
    std::string getName() const override { return "s3"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("s3",
            "S3 access requires AWS SDK and network I/O not available in WASM.");
    }
};


/**
 * URL/HTTP functions
 *
 * Stubbed because:
 * - Network I/O not available in WASM sandbox
 */

class FunctionURLRead : public IFunction
{
public:
    std::string getName() const override { return "url"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("url",
            "URL access requires network I/O not available in WASM sandbox. "
            "Fetch data in JavaScript and pass to WASM instead.");
    }
};


// ============================================================================
// Complex Aggregate Functions Stubs (optional - can be enabled with limits)
// ============================================================================

/**
 * Window funnel analysis
 *
 * Stubbed because:
 * - Complex state management
 * - High memory usage for large datasets
 *
 * Note: Could potentially be enabled with strict limits.
 */

class FunctionWindowFunnel : public IFunction
{
public:
    std::string getName() const override { return "windowFunnel"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("windowFunnel",
            "Complex funnel analysis requires significant memory. "
            "Consider using simpler aggregations or processing in chunks.");
    }
};


/**
 * Retention analysis
 *
 * Stubbed because:
 * - Complex state management
 * - High memory usage
 */

class FunctionRetention : public IFunction
{
public:
    std::string getName() const override { return "retention"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("retention",
            "Retention analysis requires significant memory. "
            "Consider using simpler aggregations.");
    }
};


/**
 * Sequence matching
 *
 * Stubbed because:
 * - Complex pattern matching state
 * - Can consume significant resources
 */

class FunctionSequenceMatch : public IFunction
{
public:
    std::string getName() const override { return "sequenceMatch"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("sequenceMatch",
            "Sequence matching requires complex state management. "
            "Consider pre-processing sequences before WASM analysis.");
    }
};

class FunctionSequenceCount : public IFunction
{
public:
    std::string getName() const override { return "sequenceCount"; }
    void execute() override
    {
        WASM_FUNCTION_NOT_SUPPORTED("sequenceCount",
            "Sequence counting requires complex state management.");
    }
};


// ============================================================================
// Function Registration
// ============================================================================

/**
 * List of all stubbed function names for documentation/introspection
 */
static const std::vector<std::string> STUBBED_FUNCTIONS = {
    // H3 functions
    "h3IsValid", "h3GetResolution", "h3ToGeo", "h3ToGeoBoundary",
    "h3kRing", "geoToH3", "h3ToParent", "h3ToChildren",
    "h3Distance", "h3HexAreaKm2", "h3HexAreaM2", "h3IndexesAreNeighbors",
    "h3GetBaseCell", "h3Line", "h3CellAreaM2", "h3CellAreaRads2",

    // S2 functions
    "s2CellsIntersect", "s2CapContains", "s2CapUnion", "s2GetNeighbors",
    "s2RectAdd", "s2RectContains", "s2RectIntersection", "s2RectUnion",
    "s2ToGeo", "geoToS2",

    // ML functions
    "catboostEvaluate", "stochasticLinearRegression", "stochasticLogisticRegression",
    "evalMLMethod",

    // NLP functions
    "lemmatize", "stem", "synonyms", "detectLanguage", "detectLanguageMixed",
    "detectCharset", "detectTonality", "detectProgrammingLanguage",

    // External integration functions
    "s3", "url", "hdfs", "remote", "remoteSecure",

    // Complex aggregates
    "windowFunnel", "retention", "sequenceMatch", "sequenceCount",
    "uniqCombined", "uniqCombined64", "uniqHLL12", "uniqTheta"
};


/**
 * Check if a function name is stubbed in WASM build
 */
bool isFunctionStubbedInWasm(const std::string& name)
{
    for (const auto& stubbed : STUBBED_FUNCTIONS)
    {
        if (stubbed == name) return true;
    }
    return false;
}


/**
 * Get list of all stubbed function names
 */
const std::vector<std::string>& getStubbedFunctionList()
{
    return STUBBED_FUNCTIONS;
}


/**
 * Register all stubbed functions with the function factory.
 * Call this during WASM module initialization.
 */
void registerWasmFunctionStubs()
{
    // In real implementation, would register with FunctionFactory
    // FunctionFactory::instance().registerFunction<FunctionH3IsValid>();
    // etc.
}

} // namespace DB

#endif // USE_WASM_STUBS
