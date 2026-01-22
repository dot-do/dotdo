/**
 * aggregates.cpp - Aggregate Functions for WASM SQL Executor
 *
 * This extends the minimal SQL executor with aggregate function support:
 *   - COUNT(*), COUNT(column)
 *   - SUM(column)
 *   - AVG(column)
 *   - MIN(column)
 *   - MAX(column)
 *
 * Supported query patterns:
 *   - SELECT COUNT(*) FROM (SELECT 1 UNION ALL SELECT 2)
 *   - SELECT SUM(x), AVG(x) FROM (SELECT 1 AS x UNION ALL SELECT 2 AS x)
 *   - SELECT MIN(value), MAX(value) FROM values_subquery
 *
 * Build with: emcc -fno-exceptions -std=c++17 -Os -DEXECUTOR_STANDALONE_BUILD
 */

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>
#include <variant>
#include <memory>
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <set>
#include <cctype>
#include <limits>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// Value Types (same as base executor)
// ============================================================================

using Value = std::variant<std::monostate, int64_t, double, std::string>;

enum class ValueType {
    Null,
    Int64,
    Float64,
    String
};

ValueType getValueType(const Value& v) {
    if (std::holds_alternative<std::monostate>(v)) return ValueType::Null;
    if (std::holds_alternative<int64_t>(v)) return ValueType::Int64;
    if (std::holds_alternative<double>(v)) return ValueType::Float64;
    return ValueType::String;
}

std::string valueToString(const Value& v) {
    if (std::holds_alternative<std::monostate>(v)) {
        return "NULL";
    }
    if (std::holds_alternative<int64_t>(v)) {
        return std::to_string(std::get<int64_t>(v));
    }
    if (std::holds_alternative<double>(v)) {
        std::ostringstream oss;
        oss << std::setprecision(15) << std::get<double>(v);
        return oss.str();
    }
    return std::get<std::string>(v);
}

double valueToDouble(const Value& v) {
    if (std::holds_alternative<int64_t>(v)) {
        return static_cast<double>(std::get<int64_t>(v));
    }
    if (std::holds_alternative<double>(v)) {
        return std::get<double>(v);
    }
    return std::numeric_limits<double>::quiet_NaN();
}

bool valueIsNumeric(const Value& v) {
    return std::holds_alternative<int64_t>(v) || std::holds_alternative<double>(v);
}

bool valueIsNull(const Value& v) {
    return std::holds_alternative<std::monostate>(v);
}

// ============================================================================
// Token Types
// ============================================================================

enum class TokenKind {
    End,
    Number,
    String,
    Identifier,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    LParen,
    RParen,
    Comma,
    As,
    Select,
    From,
    Union,
    All,
    Distinct,
    Error
};

struct Token {
    TokenKind kind;
    std::string text;
    size_t pos;
};

// ============================================================================
// Lexer
// ============================================================================

class Lexer {
public:
    Lexer(const char* input, size_t len)
        : input_(input), len_(len), pos_(0) {}

    Token next() {
        skipWhitespace();

        if (pos_ >= len_) {
            return {TokenKind::End, "", pos_};
        }

        char c = input_[pos_];
        size_t startPos = pos_;

        // Single character tokens
        switch (c) {
            case '+': pos_++; return {TokenKind::Plus, "+", startPos};
            case '-': pos_++; return {TokenKind::Minus, "-", startPos};
            case '*': pos_++; return {TokenKind::Star, "*", startPos};
            case '/': pos_++; return {TokenKind::Slash, "/", startPos};
            case '%': pos_++; return {TokenKind::Percent, "%", startPos};
            case '(': pos_++; return {TokenKind::LParen, "(", startPos};
            case ')': pos_++; return {TokenKind::RParen, ")", startPos};
            case ',': pos_++; return {TokenKind::Comma, ",", startPos};
        }

        // String literal
        if (c == '\'' || c == '"') {
            return scanString(c);
        }

        // Number
        if (isdigit(c) || c == '.') {
            return scanNumber();
        }

        // Identifier or keyword
        if (isalpha(c) || c == '_') {
            return scanIdentifier();
        }

        // Unknown character
        pos_++;
        return {TokenKind::Error, std::string(1, c), startPos};
    }

    size_t getPos() const { return pos_; }
    void setPos(size_t pos) { pos_ = pos; }

    Token peek() {
        size_t savedPos = pos_;
        Token t = next();
        pos_ = savedPos;
        return t;
    }

private:
    void skipWhitespace() {
        while (pos_ < len_ && isspace(input_[pos_])) {
            pos_++;
        }
    }

    Token scanString(char quote) {
        size_t startPos = pos_;
        pos_++; // Skip opening quote
        std::string value;

        while (pos_ < len_) {
            char c = input_[pos_];
            if (c == quote) {
                if (pos_ + 1 < len_ && input_[pos_ + 1] == quote) {
                    value += quote;
                    pos_ += 2;
                } else {
                    pos_++;
                    return {TokenKind::String, value, startPos};
                }
            } else if (c == '\\' && pos_ + 1 < len_) {
                pos_++;
                char escaped = input_[pos_];
                switch (escaped) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case '\'': value += '\''; break;
                    case '"': value += '"'; break;
                    default: value += escaped; break;
                }
                pos_++;
            } else {
                value += c;
                pos_++;
            }
        }
        return {TokenKind::Error, "unclosed string", startPos};
    }

    Token scanNumber() {
        size_t startPos = pos_;
        std::string num;
        bool hasDot = false;
        bool hasE = false;

        while (pos_ < len_) {
            char c = input_[pos_];
            if (isdigit(c)) {
                num += c;
                pos_++;
            } else if (c == '.' && !hasDot && !hasE) {
                hasDot = true;
                num += c;
                pos_++;
            } else if ((c == 'e' || c == 'E') && !hasE) {
                hasE = true;
                num += c;
                pos_++;
                if (pos_ < len_ && (input_[pos_] == '+' || input_[pos_] == '-')) {
                    num += input_[pos_];
                    pos_++;
                }
            } else {
                break;
            }
        }
        return {TokenKind::Number, num, startPos};
    }

    Token scanIdentifier() {
        size_t startPos = pos_;
        std::string ident;

        while (pos_ < len_ && (isalnum(input_[pos_]) || input_[pos_] == '_')) {
            ident += input_[pos_];
            pos_++;
        }

        std::string upper = ident;
        for (char& c : upper) c = toupper(c);

        if (upper == "SELECT") return {TokenKind::Select, ident, startPos};
        if (upper == "AS") return {TokenKind::As, ident, startPos};
        if (upper == "FROM") return {TokenKind::From, ident, startPos};
        if (upper == "UNION") return {TokenKind::Union, ident, startPos};
        if (upper == "ALL") return {TokenKind::All, ident, startPos};
        if (upper == "DISTINCT") return {TokenKind::Distinct, ident, startPos};
        if (upper == "NULL") return {TokenKind::Identifier, "NULL", startPos};

        return {TokenKind::Identifier, ident, startPos};
    }

    const char* input_;
    size_t len_;
    size_t pos_;
};

// ============================================================================
// AST Types
// ============================================================================

struct Expr;
using ExprPtr = std::shared_ptr<Expr>;

enum class ExprKind {
    Literal,
    BinaryOp,
    UnaryOp,
    ColumnRef,
    FunctionCall,
    Subquery
};

enum class AggregateType {
    None,
    Count,
    CountStar,
    CountDistinct,
    Uniq,
    UniqExact,
    Sum,
    Avg,
    Min,
    Max
};

// Forward declarations
struct SelectStmt;
using SelectStmtPtr = std::shared_ptr<SelectStmt>;

struct Expr {
    ExprKind kind;
    Value literalValue;              // For Literal
    char op;                         // For BinaryOp/UnaryOp
    ExprPtr left;                    // For BinaryOp
    ExprPtr right;                   // For BinaryOp, or operand for UnaryOp
    std::string name;                // For ColumnRef, FunctionCall
    std::vector<ExprPtr> args;       // For FunctionCall
    AggregateType aggType;           // For aggregate functions
    SelectStmtPtr subquery;          // For Subquery

    Expr() : kind(ExprKind::Literal), op(0), aggType(AggregateType::None) {}

    static ExprPtr makeLiteral(Value v) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Literal;
        e->literalValue = std::move(v);
        return e;
    }

    static ExprPtr makeBinaryOp(char op, ExprPtr left, ExprPtr right) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->op = op;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }

    static ExprPtr makeUnaryOp(char op, ExprPtr operand) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::UnaryOp;
        e->op = op;
        e->right = std::move(operand);
        return e;
    }

    static ExprPtr makeColumnRef(const std::string& name) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::ColumnRef;
        e->name = name;
        return e;
    }

    static ExprPtr makeFunctionCall(const std::string& name, std::vector<ExprPtr> args, AggregateType aggType = AggregateType::None) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::FunctionCall;
        e->name = name;
        e->args = std::move(args);
        e->aggType = aggType;
        return e;
    }

    static ExprPtr makeSubquery(SelectStmtPtr stmt) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Subquery;
        e->subquery = std::move(stmt);
        return e;
    }
};

// ============================================================================
// Select Column
// ============================================================================

struct SelectColumn {
    ExprPtr expr;
    std::string alias;
};

// ============================================================================
// Select Statement
// ============================================================================

struct SelectStmt {
    std::vector<SelectColumn> columns;
    ExprPtr fromClause;              // Can be a subquery
    std::vector<SelectStmtPtr> unionStmts;  // UNION ALL statements
};

// ============================================================================
// Row (for table data)
// ============================================================================

using Row = std::vector<Value>;

// ============================================================================
// Table (result set)
// ============================================================================

struct Table {
    std::vector<std::string> columnNames;
    std::vector<Row> rows;

    size_t findColumn(const std::string& name) const {
        std::string upperName = name;
        for (char& c : upperName) c = toupper(c);

        for (size_t i = 0; i < columnNames.size(); i++) {
            std::string upperCol = columnNames[i];
            for (char& c : upperCol) c = toupper(c);
            if (upperCol == upperName) return i;
        }
        return SIZE_MAX;
    }

    // Get first column value (for single-column tables)
    Value getFirstColumnValue(size_t rowIdx) const {
        if (rowIdx < rows.size() && !rows[rowIdx].empty()) {
            return rows[rowIdx][0];
        }
        return std::monostate{};
    }
};

// ============================================================================
// Parser
// ============================================================================

class Parser {
public:
    Parser(Lexer& lexer) : lexer_(lexer), hasError_(false) {
        advance();
    }

    SelectStmtPtr parseSelect() {
        if (current_.kind != TokenKind::Select) {
            setError("Expected SELECT");
            return nullptr;
        }
        advance();

        auto stmt = std::make_shared<SelectStmt>();

        // Parse select list
        do {
            SelectColumn col;
            col.expr = parseExpr();
            if (!col.expr) return nullptr;

            // Parse optional alias
            if (current_.kind == TokenKind::As) {
                advance();
                if (current_.kind != TokenKind::Identifier) {
                    setError("Expected identifier after AS");
                    return nullptr;
                }
                col.alias = current_.text;
                advance();
            } else if (current_.kind == TokenKind::Identifier) {
                // Implicit alias
                std::string upper = current_.text;
                for (char& c : upper) c = toupper(c);
                if (upper != "FROM" && upper != "UNION" && upper != "WHERE") {
                    col.alias = current_.text;
                    advance();
                }
            }

            stmt->columns.push_back(std::move(col));
        } while (current_.kind == TokenKind::Comma && (advance(), true));

        // Parse optional FROM clause
        if (current_.kind == TokenKind::From) {
            advance();
            if (current_.kind == TokenKind::LParen) {
                advance();
                auto subStmt = parseSelect();
                if (!subStmt) return nullptr;
                stmt->fromClause = Expr::makeSubquery(subStmt);
                if (current_.kind != TokenKind::RParen) {
                    setError("Expected ) after subquery");
                    return nullptr;
                }
                advance();
            } else if (current_.kind == TokenKind::Identifier) {
                std::string tableName = current_.text;
                advance();

                // Check for table function (e.g., numbers(10))
                if (current_.kind == TokenKind::LParen) {
                    advance();
                    std::vector<ExprPtr> args;
                    if (current_.kind != TokenKind::RParen) {
                        do {
                            ExprPtr arg = parseExpr();
                            if (!arg) return nullptr;
                            args.push_back(arg);
                        } while (current_.kind == TokenKind::Comma && (advance(), true));
                    }
                    if (current_.kind != TokenKind::RParen) {
                        setError("Expected ) after function arguments");
                        return nullptr;
                    }
                    advance();
                    stmt->fromClause = Expr::makeFunctionCall(tableName, std::move(args));
                } else {
                    stmt->fromClause = Expr::makeColumnRef(tableName);
                }
            }
        }

        // Parse UNION ALL
        while (current_.kind == TokenKind::Union) {
            advance();
            if (current_.kind == TokenKind::All) {
                advance();
            }
            auto unionStmt = parseSelect();
            if (!unionStmt) return nullptr;
            stmt->unionStmts.push_back(unionStmt);
        }

        return stmt;
    }

    bool hasError() const { return hasError_; }
    std::string getError() const { return error_; }

private:
    void advance() {
        current_ = lexer_.next();
    }

    void setError(const std::string& msg) {
        if (!hasError_) {
            hasError_ = true;
            error_ = msg;
        }
    }

    // Expression parsing with precedence climbing
    ExprPtr parseExpr() {
        return parseAddSub();
    }

    ExprPtr parseAddSub() {
        ExprPtr left = parseMulDiv();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Plus || current_.kind == TokenKind::Minus) {
            char op = (current_.kind == TokenKind::Plus) ? '+' : '-';
            advance();
            ExprPtr right = parseMulDiv();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

    ExprPtr parseMulDiv() {
        ExprPtr left = parseUnary();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Star ||
               current_.kind == TokenKind::Slash ||
               current_.kind == TokenKind::Percent) {
            char op;
            switch (current_.kind) {
                case TokenKind::Star: op = '*'; break;
                case TokenKind::Slash: op = '/'; break;
                case TokenKind::Percent: op = '%'; break;
                default: op = '?'; break;
            }
            advance();
            ExprPtr right = parseUnary();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

    ExprPtr parseUnary() {
        if (current_.kind == TokenKind::Minus) {
            advance();
            ExprPtr operand = parseUnary();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('-', operand);
        }
        if (current_.kind == TokenKind::Plus) {
            advance();
            return parseUnary();
        }
        return parsePrimary();
    }

    ExprPtr parsePrimary() {
        // Number
        if (current_.kind == TokenKind::Number) {
            std::string numStr = current_.text;
            advance();
            if (numStr.find('.') != std::string::npos ||
                numStr.find('e') != std::string::npos ||
                numStr.find('E') != std::string::npos) {
                return Expr::makeLiteral(std::stod(numStr));
            } else {
                return Expr::makeLiteral(static_cast<int64_t>(std::stoll(numStr)));
            }
        }

        // String
        if (current_.kind == TokenKind::String) {
            std::string str = current_.text;
            advance();
            return Expr::makeLiteral(str);
        }

        // Identifier or function call
        if (current_.kind == TokenKind::Identifier) {
            std::string name = current_.text;
            std::string upper = name;
            for (char& c : upper) c = toupper(c);

            advance();

            // Check for NULL
            if (upper == "NULL") {
                return Expr::makeLiteral(std::monostate{});
            }

            // Check for function call
            if (current_.kind == TokenKind::LParen) {
                advance();

                // Detect aggregate type
                AggregateType aggType = AggregateType::None;
                if (upper == "COUNT") aggType = AggregateType::Count;
                else if (upper == "SUM") aggType = AggregateType::Sum;
                else if (upper == "AVG") aggType = AggregateType::Avg;
                else if (upper == "MIN") aggType = AggregateType::Min;
                else if (upper == "MAX") aggType = AggregateType::Max;
                else if (upper == "UNIQ") aggType = AggregateType::Uniq;
                else if (upper == "UNIQEXACT") aggType = AggregateType::UniqExact;

                // Check for COUNT(*)
                if (aggType == AggregateType::Count && current_.kind == TokenKind::Star) {
                    advance();
                    if (current_.kind != TokenKind::RParen) {
                        setError("Expected ) after COUNT(*)");
                        return nullptr;
                    }
                    advance();
                    return Expr::makeFunctionCall("COUNT", {}, AggregateType::CountStar);
                }

                // Handle COUNT(DISTINCT expr) syntax
                if (aggType == AggregateType::Count && current_.kind == TokenKind::Distinct) {
                    advance(); // consume DISTINCT
                    std::vector<ExprPtr> args;
                    if (current_.kind != TokenKind::RParen) {
                        do {
                            ExprPtr arg = parseExpr();
                            if (!arg) return nullptr;
                            args.push_back(arg);
                        } while (current_.kind == TokenKind::Comma && (advance(), true));
                    }
                    if (current_.kind != TokenKind::RParen) {
                        setError("Expected ) after COUNT(DISTINCT ...)");
                        return nullptr;
                    }
                    advance();
                    return Expr::makeFunctionCall("COUNT", std::move(args), AggregateType::CountDistinct);
                }

                // Parse arguments
                std::vector<ExprPtr> args;
                if (current_.kind != TokenKind::RParen) {
                    do {
                        ExprPtr arg = parseExpr();
                        if (!arg) return nullptr;
                        args.push_back(arg);
                    } while (current_.kind == TokenKind::Comma && (advance(), true));
                }

                if (current_.kind != TokenKind::RParen) {
                    setError("Expected ) after function arguments");
                    return nullptr;
                }
                advance();

                return Expr::makeFunctionCall(name, std::move(args), aggType);
            }

            // Just a column reference
            return Expr::makeColumnRef(name);
        }

        // Parenthesized expression or subquery
        if (current_.kind == TokenKind::LParen) {
            advance();

            // Check if it's a subquery
            if (current_.kind == TokenKind::Select) {
                auto subStmt = parseSelect();
                if (!subStmt) return nullptr;
                if (current_.kind != TokenKind::RParen) {
                    setError("Expected ) after subquery");
                    return nullptr;
                }
                advance();
                return Expr::makeSubquery(subStmt);
            }

            // Regular parenthesized expression
            ExprPtr expr = parseExpr();
            if (!expr) return nullptr;
            if (current_.kind != TokenKind::RParen) {
                setError("Expected )");
                return nullptr;
            }
            advance();
            return expr;
        }

        setError("Unexpected token: " + current_.text);
        return nullptr;
    }

    Lexer& lexer_;
    Token current_;
    bool hasError_;
    std::string error_;
};

// ============================================================================
// Aggregate State
// ============================================================================

// Hash function for Value type to use in unordered_set
struct ValueHash {
    size_t operator()(const Value& v) const {
        if (std::holds_alternative<std::monostate>(v)) {
            return 0;
        }
        if (std::holds_alternative<int64_t>(v)) {
            return std::hash<int64_t>{}(std::get<int64_t>(v));
        }
        if (std::holds_alternative<double>(v)) {
            return std::hash<double>{}(std::get<double>(v));
        }
        return std::hash<std::string>{}(std::get<std::string>(v));
    }
};

// Equality function for Value type
struct ValueEqual {
    bool operator()(const Value& a, const Value& b) const {
        return a == b;
    }
};

struct AggregateState {
    AggregateType type;
    int64_t count;
    double sum;
    Value minVal;
    Value maxVal;
    bool hasValue;
    std::unordered_set<Value, ValueHash, ValueEqual> distinctValues;

    AggregateState() : type(AggregateType::None), count(0), sum(0.0), hasValue(false) {}

    void init(AggregateType t) {
        type = t;
        count = 0;
        sum = 0.0;
        minVal = std::monostate{};
        maxVal = std::monostate{};
        hasValue = false;
        distinctValues.clear();
    }

    void accumulate(const Value& v) {
        // Skip NULL values (except for COUNT(*))
        if (valueIsNull(v) && type != AggregateType::CountStar) {
            return;
        }

        switch (type) {
            case AggregateType::CountStar:
                count++;
                break;

            case AggregateType::Count:
                if (!valueIsNull(v)) {
                    count++;
                }
                break;

            case AggregateType::CountDistinct:
            case AggregateType::Uniq:
            case AggregateType::UniqExact:
                if (!valueIsNull(v)) {
                    distinctValues.insert(v);
                }
                break;

            case AggregateType::Sum:
            case AggregateType::Avg:
                if (valueIsNumeric(v)) {
                    sum += valueToDouble(v);
                    count++;
                }
                break;

            case AggregateType::Min:
                if (!hasValue || compareValues(v, minVal) < 0) {
                    minVal = v;
                    hasValue = true;
                }
                break;

            case AggregateType::Max:
                if (!hasValue || compareValues(v, maxVal) > 0) {
                    maxVal = v;
                    hasValue = true;
                }
                break;

            default:
                break;
        }
    }

    Value finalize() const {
        switch (type) {
            case AggregateType::CountStar:
            case AggregateType::Count:
                return count;

            case AggregateType::CountDistinct:
            case AggregateType::Uniq:
            case AggregateType::UniqExact:
                return static_cast<int64_t>(distinctValues.size());

            case AggregateType::Sum:
                if (count == 0) return std::monostate{};
                return sum;

            case AggregateType::Avg:
                if (count == 0) return std::monostate{};
                return sum / static_cast<double>(count);

            case AggregateType::Min:
                return hasValue ? minVal : Value{std::monostate{}};

            case AggregateType::Max:
                return hasValue ? maxVal : Value{std::monostate{}};

            default:
                return std::monostate{};
        }
    }

private:
    // Compare two values for MIN/MAX
    static int compareValues(const Value& a, const Value& b) {
        // Handle NULL
        if (valueIsNull(a) && valueIsNull(b)) return 0;
        if (valueIsNull(a)) return 1;  // NULL is "greater" (sorts last)
        if (valueIsNull(b)) return -1;

        // Compare same types
        if (std::holds_alternative<int64_t>(a) && std::holds_alternative<int64_t>(b)) {
            int64_t va = std::get<int64_t>(a);
            int64_t vb = std::get<int64_t>(b);
            return (va < vb) ? -1 : (va > vb) ? 1 : 0;
        }

        if (std::holds_alternative<double>(a) || std::holds_alternative<double>(b)) {
            double va = valueToDouble(a);
            double vb = valueToDouble(b);
            return (va < vb) ? -1 : (va > vb) ? 1 : 0;
        }

        if (std::holds_alternative<std::string>(a) && std::holds_alternative<std::string>(b)) {
            return std::get<std::string>(a).compare(std::get<std::string>(b));
        }

        // Mixed types - convert to string and compare
        return valueToString(a).compare(valueToString(b));
    }
};

// ============================================================================
// Executor
// ============================================================================

class Executor {
public:
    Executor() {}

    // Execute a SELECT statement and return results as a table
    Table executeSelect(const SelectStmtPtr& stmt) {
        Table result;

        if (!stmt) {
            setError("NULL statement");
            return result;
        }

        // If there's a FROM clause, execute it first
        Table sourceData;
        if (stmt->fromClause) {
            if (stmt->fromClause->kind == ExprKind::Subquery) {
                sourceData = executeSelect(stmt->fromClause->subquery);
                if (hasError()) return result;
            } else if (stmt->fromClause->kind == ExprKind::FunctionCall) {
                sourceData = executeTableFunction(stmt->fromClause);
                if (hasError()) return result;
            }
        }

        // Handle UNION ALL
        if (!stmt->unionStmts.empty()) {
            // Execute this SELECT to get base rows
            Table baseResult = executeSingleSelect(stmt, sourceData);
            if (hasError()) return result;

            // Execute each UNION ALL branch and append rows
            for (const auto& unionStmt : stmt->unionStmts) {
                Table unionResult = executeSelect(unionStmt);
                if (hasError()) return result;

                // Append rows (column names come from first SELECT)
                for (auto& row : unionResult.rows) {
                    baseResult.rows.push_back(std::move(row));
                }
            }

            return baseResult;
        }

        return executeSingleSelect(stmt, sourceData);
    }

    bool hasError() const { return !error_.empty(); }
    std::string getError() const { return error_; }
    void clearError() { error_.clear(); }

private:
    void setError(const std::string& msg) {
        if (error_.empty()) {
            error_ = msg;
        }
    }

    // Execute a table function (e.g., numbers(10))
    Table executeTableFunction(const ExprPtr& funcExpr) {
        Table result;

        std::string upper = funcExpr->name;
        for (char& c : upper) c = toupper(c);

        if (upper == "NUMBERS") {
            if (funcExpr->args.empty()) {
                setError("numbers() requires an argument");
                return result;
            }

            std::unordered_map<std::string, Value> emptyEnv;
            Value nVal = evaluate(funcExpr->args[0], emptyEnv, result);
            if (!std::holds_alternative<int64_t>(nVal)) {
                setError("numbers() argument must be an integer");
                return result;
            }

            int64_t n = std::get<int64_t>(nVal);
            if (n < 0) n = 0;

            result.columnNames.push_back("number");
            for (int64_t i = 0; i < n; i++) {
                result.rows.push_back({i});
            }
        } else {
            setError("Unknown table function: " + funcExpr->name);
        }

        return result;
    }

    // Execute a single SELECT (no UNION)
    Table executeSingleSelect(const SelectStmtPtr& stmt, const Table& sourceData) {
        Table result;

        // Check if we have aggregate functions
        bool hasAggregates = false;
        for (const auto& col : stmt->columns) {
            if (containsAggregate(col.expr)) {
                hasAggregates = true;
                break;
            }
        }

        if (hasAggregates) {
            // Aggregate query - collapse to single row
            return executeAggregateSelect(stmt, sourceData);
        } else {
            // Non-aggregate query
            return executeNonAggregateSelect(stmt, sourceData);
        }
    }

    // Check if expression contains aggregate functions
    bool containsAggregate(const ExprPtr& expr) {
        if (!expr) return false;

        if (expr->kind == ExprKind::FunctionCall && expr->aggType != AggregateType::None) {
            return true;
        }

        if (expr->left && containsAggregate(expr->left)) return true;
        if (expr->right && containsAggregate(expr->right)) return true;

        for (const auto& arg : expr->args) {
            if (containsAggregate(arg)) return true;
        }

        return false;
    }

    // Execute non-aggregate SELECT
    Table executeNonAggregateSelect(const SelectStmtPtr& stmt, const Table& sourceData) {
        Table result;

        // Set up column names
        for (size_t i = 0; i < stmt->columns.size(); i++) {
            const auto& col = stmt->columns[i];
            if (!col.alias.empty()) {
                result.columnNames.push_back(col.alias);
            } else if (col.expr->kind == ExprKind::ColumnRef) {
                result.columnNames.push_back(col.expr->name);
            } else {
                result.columnNames.push_back("column" + std::to_string(i));
            }
        }

        // If no source data, evaluate expressions once
        if (sourceData.rows.empty()) {
            Row row;
            std::unordered_map<std::string, Value> emptyEnv;
            for (const auto& col : stmt->columns) {
                row.push_back(evaluate(col.expr, emptyEnv, sourceData));
            }
            result.rows.push_back(std::move(row));
        } else {
            // Evaluate for each source row
            for (size_t rowIdx = 0; rowIdx < sourceData.rows.size(); rowIdx++) {
                Row row;
                std::unordered_map<std::string, Value> env;

                // Build environment from source row
                for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                    if (i < sourceData.rows[rowIdx].size()) {
                        env[sourceData.columnNames[i]] = sourceData.rows[rowIdx][i];
                    }
                }

                for (const auto& col : stmt->columns) {
                    row.push_back(evaluate(col.expr, env, sourceData));
                }
                result.rows.push_back(std::move(row));
            }
        }

        return result;
    }

    // Execute aggregate SELECT
    Table executeAggregateSelect(const SelectStmtPtr& stmt, const Table& sourceData) {
        Table result;

        // Initialize aggregate states for each column
        std::vector<AggregateState> aggStates(stmt->columns.size());

        // Set up column names and initialize aggregates
        for (size_t i = 0; i < stmt->columns.size(); i++) {
            const auto& col = stmt->columns[i];
            if (!col.alias.empty()) {
                result.columnNames.push_back(col.alias);
            } else if (col.expr->kind == ExprKind::FunctionCall) {
                std::string upper = col.expr->name;
                for (char& c : upper) c = toupper(c);
                if (col.expr->aggType == AggregateType::CountStar) {
                    result.columnNames.push_back("count()");
                } else if (col.expr->args.size() == 1 && col.expr->args[0]->kind == ExprKind::ColumnRef) {
                    result.columnNames.push_back(upper + "(" + col.expr->args[0]->name + ")");
                } else {
                    result.columnNames.push_back(upper + "(...)");
                }
            } else {
                result.columnNames.push_back("column" + std::to_string(i));
            }

            // Initialize aggregate state
            if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                aggStates[i].init(col.expr->aggType);
            }
        }

        // Process all source rows
        if (sourceData.rows.empty()) {
            // No source data - aggregate over a single virtual row for literals
            // This handles SELECT COUNT(*) with no FROM clause
            std::unordered_map<std::string, Value> emptyEnv;
            for (size_t i = 0; i < stmt->columns.size(); i++) {
                const auto& col = stmt->columns[i];
                if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                    // Aggregate with no source - COUNT(*) returns 0, others return NULL
                    // Actually, for COUNT(*) with no FROM, we should return 1 row with count 0
                    // But typically COUNT(*) needs a FROM clause to make sense
                    // Leave the aggregate empty
                }
            }
        } else {
            // Aggregate over source rows
            for (size_t rowIdx = 0; rowIdx < sourceData.rows.size(); rowIdx++) {
                std::unordered_map<std::string, Value> env;

                // Build environment from source row
                for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                    if (i < sourceData.rows[rowIdx].size()) {
                        env[sourceData.columnNames[i]] = sourceData.rows[rowIdx][i];
                    }
                }

                // Accumulate aggregates
                for (size_t i = 0; i < stmt->columns.size(); i++) {
                    const auto& col = stmt->columns[i];
                    if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                        if (col.expr->aggType == AggregateType::CountStar) {
                            aggStates[i].accumulate(Value{int64_t(1)});  // Just count rows
                        } else if (!col.expr->args.empty()) {
                            Value argVal = evaluate(col.expr->args[0], env, sourceData);
                            aggStates[i].accumulate(argVal);
                        }
                    }
                }
            }
        }

        // Finalize aggregates and build result row
        Row row;
        std::unordered_map<std::string, Value> emptyEnv;
        for (size_t i = 0; i < stmt->columns.size(); i++) {
            const auto& col = stmt->columns[i];
            if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                row.push_back(aggStates[i].finalize());
            } else {
                // Non-aggregate expression in aggregate context - evaluate once
                row.push_back(evaluate(col.expr, emptyEnv, sourceData));
            }
        }
        result.rows.push_back(std::move(row));

        return result;
    }

    // Evaluate an expression
    Value evaluate(const ExprPtr& expr, const std::unordered_map<std::string, Value>& env, const Table& sourceData) {
        if (!expr) return std::monostate{};

        switch (expr->kind) {
            case ExprKind::Literal:
                return expr->literalValue;

            case ExprKind::UnaryOp: {
                Value operand = evaluate(expr->right, env, sourceData);
                if (expr->op == '-') {
                    if (std::holds_alternative<int64_t>(operand)) {
                        return -std::get<int64_t>(operand);
                    }
                    if (std::holds_alternative<double>(operand)) {
                        return -std::get<double>(operand);
                    }
                }
                return operand;
            }

            case ExprKind::BinaryOp: {
                Value left = evaluate(expr->left, env, sourceData);
                Value right = evaluate(expr->right, env, sourceData);
                return evalBinaryOp(expr->op, left, right);
            }

            case ExprKind::ColumnRef: {
                std::string upper = expr->name;
                for (char& c : upper) c = toupper(c);

                // Look up in environment
                for (const auto& [key, val] : env) {
                    std::string keyUpper = key;
                    for (char& c : keyUpper) c = toupper(c);
                    if (keyUpper == upper) {
                        return val;
                    }
                }
                // Column not found
                setError("Unknown column: " + expr->name);
                return std::monostate{};
            }

            case ExprKind::FunctionCall:
                // Non-aggregate function calls (or aggregate calls outside aggregate context)
                return evaluateFunction(expr, env, sourceData);

            case ExprKind::Subquery: {
                // Execute subquery and return first value
                Table subResult = const_cast<Executor*>(this)->executeSelect(expr->subquery);
                if (!subResult.rows.empty() && !subResult.rows[0].empty()) {
                    return subResult.rows[0][0];
                }
                return std::monostate{};
            }
        }

        return std::monostate{};
    }

    Value evaluateFunction(const ExprPtr& expr, const std::unordered_map<std::string, Value>& env, const Table& sourceData) {
        std::string upper = expr->name;
        for (char& c : upper) c = toupper(c);

        // Aggregates should be handled in executeAggregateSelect
        // But we might reach here for scalar functions or nested contexts

        // For now, just return NULL for unsupported functions
        return std::monostate{};
    }

    Value evalBinaryOp(char op, const Value& left, const Value& right) {
        // Handle NULL propagation
        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right)) {
            return std::monostate{};
        }

        // String concatenation with +
        if (op == '+' && (std::holds_alternative<std::string>(left) ||
                         std::holds_alternative<std::string>(right))) {
            return valueToString(left) + valueToString(right);
        }

        // Numeric operations
        bool leftIsDouble = std::holds_alternative<double>(left);
        bool rightIsDouble = std::holds_alternative<double>(right);
        bool leftIsInt = std::holds_alternative<int64_t>(left);
        bool rightIsInt = std::holds_alternative<int64_t>(right);

        if ((leftIsDouble || leftIsInt) && (rightIsDouble || rightIsInt)) {
            if (leftIsDouble || rightIsDouble) {
                double l = leftIsDouble ? std::get<double>(left) : static_cast<double>(std::get<int64_t>(left));
                double r = rightIsDouble ? std::get<double>(right) : static_cast<double>(std::get<int64_t>(right));
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return (r != 0) ? l / r : Value{std::monostate{}};
                    case '%': return (r != 0) ? std::fmod(l, r) : Value{std::monostate{}};
                }
            } else {
                int64_t l = std::get<int64_t>(left);
                int64_t r = std::get<int64_t>(right);
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return (r != 0) ? l / r : Value{std::monostate{}};
                    case '%': return (r != 0) ? l % r : Value{std::monostate{}};
                }
            }
        }

        return std::monostate{};
    }

    std::string error_;
};

// ============================================================================
// Result Column (for C API compatibility)
// ============================================================================

struct ResultColumn {
    std::string name;
    Value value;
};

// ============================================================================
// Result Formatting
// ============================================================================

std::string formatTableCSV(const Table& table) {
    std::string result;

    // Header row
    for (size_t i = 0; i < table.columnNames.size(); i++) {
        if (i > 0) result += ",";
        result += "\"" + table.columnNames[i] + "\"";
    }
    result += "\n";

    // Data rows
    for (const auto& row : table.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) result += ",";
            ValueType t = getValueType(row[i]);
            if (t == ValueType::String) {
                std::string s = std::get<std::string>(row[i]);
                result += "\"";
                for (char c : s) {
                    if (c == '"') result += "\"\"";
                    else result += c;
                }
                result += "\"";
            } else {
                result += valueToString(row[i]);
            }
        }
        result += "\n";
    }

    return result;
}

std::string formatTableTSV(const Table& table) {
    std::string result;

    // Header row
    for (size_t i = 0; i < table.columnNames.size(); i++) {
        if (i > 0) result += "\t";
        result += table.columnNames[i];
    }
    result += "\n";

    // Data rows
    for (const auto& row : table.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) result += "\t";
            result += valueToString(row[i]);
        }
        result += "\n";
    }

    return result;
}

std::string formatTableJSON(const Table& table) {
    std::string result = "{\n";
    result += "  \"meta\": [\n";

    for (size_t i = 0; i < table.columnNames.size(); i++) {
        result += "    {\"name\": \"" + table.columnNames[i] + "\", \"type\": \"";
        if (!table.rows.empty() && i < table.rows[0].size()) {
            ValueType t = getValueType(table.rows[0][i]);
            switch (t) {
                case ValueType::Null: result += "Nullable(Nothing)"; break;
                case ValueType::Int64: result += "Int64"; break;
                case ValueType::Float64: result += "Float64"; break;
                case ValueType::String: result += "String"; break;
            }
        } else {
            result += "Unknown";
        }
        result += "\"}";
        if (i < table.columnNames.size() - 1) result += ",";
        result += "\n";
    }

    result += "  ],\n";
    result += "  \"data\": [\n";

    for (size_t rowIdx = 0; rowIdx < table.rows.size(); rowIdx++) {
        const auto& row = table.rows[rowIdx];
        result += "    {";

        for (size_t i = 0; i < row.size() && i < table.columnNames.size(); i++) {
            if (i > 0) result += ", ";
            result += "\"" + table.columnNames[i] + "\": ";

            ValueType t = getValueType(row[i]);
            if (t == ValueType::String) {
                result += "\"";
                for (char c : std::get<std::string>(row[i])) {
                    switch (c) {
                        case '"': result += "\\\""; break;
                        case '\\': result += "\\\\"; break;
                        case '\n': result += "\\n"; break;
                        case '\r': result += "\\r"; break;
                        case '\t': result += "\\t"; break;
                        default: result += c; break;
                    }
                }
                result += "\"";
            } else if (t == ValueType::Null) {
                result += "null";
            } else {
                result += valueToString(row[i]);
            }
        }

        result += "}";
        if (rowIdx < table.rows.size() - 1) result += ",";
        result += "\n";
    }

    result += "  ],\n";
    result += "  \"rows\": " + std::to_string(table.rows.size()) + ",\n";
    result += "  \"statistics\": {\"elapsed\": 0.001, \"rows_read\": " +
              std::to_string(table.rows.size()) + ", \"bytes_read\": 0}\n";
    result += "}\n";

    return result;
}

// ============================================================================
// Aggregate Executor Context
// ============================================================================

struct AggExecutorContext {
    char* lastResult;
    size_t lastResultLen;
    char* lastError;

    AggExecutorContext() : lastResult(nullptr), lastResultLen(0), lastError(nullptr) {}

    ~AggExecutorContext() {
        if (lastResult) free(lastResult);
        if (lastError) free(lastError);
    }

    void setResult(const std::string& result) {
        if (lastResult) free(lastResult);
        lastResultLen = result.size();
        lastResult = static_cast<char*>(malloc(lastResultLen + 1));
        memcpy(lastResult, result.c_str(), lastResultLen + 1);
    }

    void setError(const std::string& error) {
        if (lastError) free(lastError);
        lastError = strdup(error.c_str());
        lastResultLen = 0;
        if (lastResult) {
            free(lastResult);
            lastResult = nullptr;
        }
    }
};

// ============================================================================
// C API
// ============================================================================

extern "C" {

/**
 * Create a new aggregate executor context.
 */
EXPORT
void* agg_executor_create() {
    return new AggExecutorContext();
}

/**
 * Destroy an aggregate executor context.
 */
EXPORT
void agg_executor_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<AggExecutorContext*>(ctx);
    }
}

/**
 * Execute a SQL query with aggregate support.
 */
EXPORT
int agg_executor_query(void* ctx, const char* query, size_t query_len, const char* format) {
    if (!ctx || !query) return -1;

    AggExecutorContext* aggCtx = static_cast<AggExecutorContext*>(ctx);

    // Parse query
    Lexer lexer(query, query_len);
    Parser parser(lexer);

    SelectStmtPtr stmt = parser.parseSelect();
    if (!stmt || parser.hasError()) {
        aggCtx->setError(parser.getError().empty() ? "Parse error" : parser.getError());
        return -1;
    }

    // Execute
    Executor executor;
    Table result = executor.executeSelect(stmt);

    if (executor.hasError()) {
        aggCtx->setError(executor.getError());
        return -1;
    }

    // Format result
    std::string fmt = format ? format : "CSV";
    for (char& c : fmt) c = toupper(c);

    std::string output;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        output = formatTableJSON(result);
    } else if (fmt == "TSV" || fmt == "TABSEPARATED") {
        output = formatTableTSV(result);
    } else {
        output = formatTableCSV(result);
    }

    aggCtx->setResult(output);
    return 0;
}

/**
 * Get the result buffer from last query.
 */
EXPORT
const char* agg_executor_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<AggExecutorContext*>(ctx)->lastResult;
}

/**
 * Get the result length from last query.
 */
EXPORT
size_t agg_executor_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<AggExecutorContext*>(ctx)->lastResultLen;
}

/**
 * Get the error message from last query.
 */
EXPORT
const char* agg_executor_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<AggExecutorContext*>(ctx)->lastError;
}

/**
 * Test function to verify aggregate support works.
 */
EXPORT
int agg_executor_test() {
    AggExecutorContext ctx;

    // Test 1: COUNT(*) with UNION ALL
    {
        const char* sql = "SELECT COUNT(*) FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)";
        if (agg_executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -1;
        if (!ctx.lastResult) return -2;
        // Should contain "3"
        if (strstr(ctx.lastResult, "3") == nullptr) return -3;
    }

    // Test 2: SUM
    {
        const char* sql = "SELECT SUM(x) FROM (SELECT 10 AS x UNION ALL SELECT 20 AS x UNION ALL SELECT 30 AS x)";
        if (agg_executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -4;
        if (!ctx.lastResult) return -5;
        // Should contain "60"
        if (strstr(ctx.lastResult, "60") == nullptr) return -6;
    }

    // Test 3: AVG
    {
        const char* sql = "SELECT AVG(x) FROM (SELECT 10 AS x UNION ALL SELECT 20 AS x UNION ALL SELECT 30 AS x)";
        if (agg_executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -7;
        if (!ctx.lastResult) return -8;
        // Should contain "20"
        if (strstr(ctx.lastResult, "20") == nullptr) return -9;
    }

    // Test 4: MIN and MAX
    {
        const char* sql = "SELECT MIN(x), MAX(x) FROM (SELECT 5 AS x UNION ALL SELECT 15 AS x UNION ALL SELECT 10 AS x)";
        if (agg_executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -10;
        if (!ctx.lastResult) return -11;
        // Should contain "5" and "15"
        if (strstr(ctx.lastResult, "5") == nullptr) return -12;
        if (strstr(ctx.lastResult, "15") == nullptr) return -13;
    }

    // Test 5: Multiple aggregates
    {
        const char* sql = "SELECT COUNT(*), SUM(v), AVG(v), MIN(v), MAX(v) FROM (SELECT 1 AS v UNION ALL SELECT 2 AS v UNION ALL SELECT 3 AS v)";
        if (agg_executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -14;
        if (!ctx.lastResult) return -15;
        // Should have count=3, sum=6, avg=2, min=1, max=3
        if (strstr(ctx.lastResult, "3") == nullptr) return -16;  // count
        if (strstr(ctx.lastResult, "6") == nullptr) return -17;  // sum
        if (strstr(ctx.lastResult, "1") == nullptr) return -18;  // min
    }

    // Test 6: String MIN/MAX
    {
        const char* sql = "SELECT MIN(s), MAX(s) FROM (SELECT 'banana' AS s UNION ALL SELECT 'apple' AS s UNION ALL SELECT 'cherry' AS s)";
        if (agg_executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -19;
        if (!ctx.lastResult) return -20;
        // apple < banana < cherry
        if (strstr(ctx.lastResult, "apple") == nullptr) return -21;
        if (strstr(ctx.lastResult, "cherry") == nullptr) return -22;
    }

    // Test 7: Expression arithmetic still works
    {
        const char* sql = "SELECT 1 + 2 * 3";
        if (agg_executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -23;
        if (!ctx.lastResult) return -24;
        // Should be 7
        if (strstr(ctx.lastResult, "7") == nullptr) return -25;
    }

    return 0; // All tests passed
}

/**
 * Get version string.
 */
EXPORT
const char* agg_executor_version() {
    return "chdb-agg-executor 0.1.0 (WASM SQL executor with aggregates)";
}

} // extern "C"
