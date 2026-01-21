import type { MiddlewareHandler } from 'hono';
import { type JWK } from 'jose';
import { type TokenPayload } from './token';
/**
 * JWKS (JSON Web Key Set) structure
 */
export interface Jwks {
    keys: JWK[];
}
/**
 * Options for creating a JWKS client
 */
export interface JwksClientOptions {
    /** URL to fetch JWKS from (e.g., https://id.org.ai/.well-known/jwks.json) */
    jwksUri: string;
    /** Cache TTL in seconds (default: 600 = 10 minutes) */
    cacheTtl?: number;
    /** Whether to refetch JWKS when a key ID is not found in cache (default: true) */
    refetchOnMissingKey?: boolean;
    /** Minimum seconds between refetch attempts for missing keys (default: 30) */
    refetchCooldown?: number;
}
/**
 * Options for verifying tokens with JWKS
 */
export interface JwksVerifyOptions {
    /** Expected issuer(s) */
    issuer?: string | string[];
    /** Expected audience(s) */
    audience?: string | string[];
    /** Algorithms to allow (default: RS256, RS384, RS512, ES256, ES384, ES512) */
    algorithms?: string[];
}
/**
 * Options for the JWKS validation middleware
 */
export interface JwksValidationOptions extends JwksVerifyOptions {
    /** JWKS client instance */
    jwksClient: JwksClient;
    /** Cookie name to extract token from (optional) */
    cookieName?: string;
    /** Paths to skip validation for */
    skipPaths?: string[];
    /** Seconds before expiration to suggest refresh (default: 300 = 5 minutes) */
    refreshThreshold?: number;
}
/**
 * JWKS client interface for fetching and caching keys
 */
export interface JwksClient {
    /** Get a public key by key ID */
    getKey(kid: string): Promise<CryptoKey>;
    /** Clear the cache */
    clearCache(): void;
}
/**
 * Fetch JWKS from a URL
 */
export declare function fetchJwks(jwksUri: string): Promise<Jwks>;
/**
 * Create a JWKS client with caching support
 */
export declare function createJwksClient(options: JwksClientOptions): JwksClient;
/**
 * Verify a JWT token using JWKS
 */
export declare function verifyTokenWithJwks(token: string, client: JwksClient, options?: JwksVerifyOptions): Promise<TokenPayload>;
/**
 * Hono middleware for JWT validation with JWKS
 */
export declare function validateTokenWithJwks(options: JwksValidationOptions): MiddlewareHandler;
/**
 * Create a JWKS client from an issuer URL
 * Automatically constructs the .well-known/jwks.json URL
 */
export declare function createJwksClientFromIssuer(issuer: string, options?: Omit<JwksClientOptions, 'jwksUri'>): JwksClient;
//# sourceMappingURL=jwks.d.ts.map