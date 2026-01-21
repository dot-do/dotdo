import type { MiddlewareHandler } from 'hono';
import { type JWTPayload } from 'jose';
import { TokenValidationError } from './errors';
export interface TokenPayload extends JWTPayload {
    sub: string;
    email?: string;
    roles?: string[];
    scopes?: string[];
    [key: string]: unknown;
}
export interface TokenValidationOptions {
    secret: Uint8Array | string;
    issuer?: string;
    audience?: string;
    cookieName?: string;
    skipPaths?: string[];
    refreshThreshold?: number;
}
export interface TokenExtractionOptions {
    cookieName?: string;
}
export interface ExpirationCheckResult {
    expired: boolean;
    expiresIn: number | null;
    shouldRefresh?: boolean;
}
export interface ExpirationCheckOptions {
    refreshThreshold?: number;
}
/**
 * Result of token extraction with detailed error information
 */
export interface TokenExtractionResult {
    /** The extracted token, or null if extraction failed */
    token: string | null;
    /** Error details if extraction failed */
    error?: TokenValidationError;
}
/**
 * Extract Bearer token from Authorization header or cookies.
 *
 * @param request - The incoming request
 * @param options - Extraction options (cookie name)
 * @returns The extracted token or null
 */
export declare function extractToken(request: Request, options?: TokenExtractionOptions): string | null;
/**
 * Extract Bearer token with detailed error information.
 * Use this when you need to know why extraction failed.
 *
 * @param request - The incoming request
 * @param options - Extraction options (cookie name)
 * @returns Result with token and optional error details
 */
export declare function extractTokenWithError(request: Request, options?: TokenExtractionOptions): TokenExtractionResult;
/**
 * Verify JWT signature and validate claims.
 *
 * @param token - The JWT string to verify
 * @param options - Verification options including secret and expected claims
 * @returns The verified token payload
 * @throws {TokenValidationError} If verification fails (with specific error type)
 */
export declare function verifyTokenSignature(token: string, options: {
    secret: Uint8Array | string;
    issuer?: string;
    audience?: string;
}): Promise<TokenPayload>;
/**
 * Check token expiration and determine if refresh is needed
 */
export declare function checkTokenExpiration(payload: TokenPayload, options?: ExpirationCheckOptions): ExpirationCheckResult;
/**
 * Hono middleware for JWT token validation.
 *
 * Validates JWT tokens from Authorization header or cookies.
 * Provides detailed error messages for debugging while remaining secure.
 *
 * @param options - Middleware configuration options
 * @returns Hono middleware handler
 */
export declare function validateToken(options: TokenValidationOptions): MiddlewareHandler;
//# sourceMappingURL=token.d.ts.map