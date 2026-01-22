#pragma once

/**
 * TokenIteratorStandalone.h - Standalone TokenIterator for Parser WASM
 *
 * This is a standalone implementation of Tokens and TokenIterator
 * that works with the standard library instead of LexerStandalone.h's
 * custom definitions.
 */

#ifdef PARSER_STANDALONE_BUILD

#include <vector>
#include <algorithm>

// Define ALWAYS_INLINE if not already defined
#ifndef ALWAYS_INLINE
#define ALWAYS_INLINE __attribute__((__always_inline__))
#endif

namespace DB
{

// Forward declare Token and TokenType from Lexer.h
// These are defined properly in Lexer.h which will be included

/**
 * Token stream for parsing.
 * Wraps the lexer and provides lazy tokenization with lookahead.
 */
class Tokens
{
private:
    std::vector<Token> data;
    size_t max_pos = 0;
    Lexer lexer;
    bool skip_insignificant;

public:
    Tokens(const char * begin, const char * end, size_t max_query_size = 0, bool skip_insignificant_ = true)
        : lexer(begin, end, max_query_size), skip_insignificant(skip_insignificant_)
    {
    }

    const Token & operator[] (size_t index)
    {
        while (true)
        {
            if (index < data.size())
            {
                max_pos = std::max(max_pos, index);
                return data[index];
            }

            if (!data.empty() && data.back().isEnd())
            {
                max_pos = data.size() - 1;
                return data.back();
            }

            Token token = lexer.nextToken();

            if (!skip_insignificant || token.isSignificant())
                data.emplace_back(token);
        }
    }

    const Token & max()
    {
        if (data.empty())
            return (*this)[0];
        return data[max_pos];
    }

    void reset()
    {
        max_pos = 0;
    }
};

/**
 * Iterator over token stream.
 */
class TokenIterator
{
private:
    Tokens * tokens;
    size_t index = 0;

public:
    explicit TokenIterator(Tokens & tokens_) : tokens(&tokens_) {}

    ALWAYS_INLINE const Token & get() { return (*tokens)[index]; }
    ALWAYS_INLINE const Token & operator*() { return get(); }
    ALWAYS_INLINE const Token * operator->() { return &get(); }

    ALWAYS_INLINE TokenIterator & operator++()
    {
        ++index;
        return *this;
    }
    ALWAYS_INLINE TokenIterator & operator--()
    {
        --index;
        return *this;
    }

    ALWAYS_INLINE bool operator<(const TokenIterator & rhs) const { return index < rhs.index; }
    ALWAYS_INLINE bool operator<=(const TokenIterator & rhs) const { return index <= rhs.index; }
    ALWAYS_INLINE bool operator==(const TokenIterator & rhs) const { return index == rhs.index; }
    ALWAYS_INLINE bool operator!=(const TokenIterator & rhs) const { return index != rhs.index; }

    ALWAYS_INLINE bool isValid() { return get().type < TokenType::EndOfStream; }

    /// Rightmost token we had looked.
    ALWAYS_INLINE const Token & max() { return tokens->max(); }
};

/// Returns positions of unmatched parentheses.
using UnmatchedParentheses = std::vector<Token>;

inline UnmatchedParentheses checkUnmatchedParentheses(TokenIterator begin)
{
    /// We have just two kind of parentheses: () and [].
    UnmatchedParentheses stack;

    /// We have to iterate through all tokens until the end to avoid false positive "Unmatched parentheses" error
    /// when parser failed in the middle of the query.
    for (TokenIterator it = begin; it.isValid(); ++it)
    {
        if (it->type == TokenType::OpeningRoundBracket || it->type == TokenType::OpeningSquareBracket)
        {
            stack.push_back(*it);
        }
        else if (it->type == TokenType::ClosingRoundBracket || it->type == TokenType::ClosingSquareBracket)
        {
            if (stack.empty())
            {
                /// Excessive closing bracket.
                stack.push_back(*it);
                return stack;
            }
            if ((stack.back().type == TokenType::OpeningRoundBracket && it->type == TokenType::ClosingRoundBracket)
                || (stack.back().type == TokenType::OpeningSquareBracket && it->type == TokenType::ClosingSquareBracket))
            {
                /// Valid match.
                stack.pop_back();
            }
            else
            {
                /// Closing bracket type doesn't match opening bracket type.
                stack.push_back(*it);
                return stack;
            }
        }
    }

    /// If stack is not empty, we have unclosed brackets.
    return stack;
}

} // namespace DB

#endif // PARSER_STANDALONE_BUILD
