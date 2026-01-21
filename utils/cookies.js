/**
 * Cookie parsing utilities for @dotdo/utils
 *
 * Shared cookie parsing functions used by auth and oauth packages.
 * These utilities handle parsing cookies from HTTP Cookie headers.
 *
 * @module @dotdo/utils/cookies
 */
/**
 * Parse cookies from a Cookie header string.
 *
 * Handles standard cookie format: "name1=value1; name2=value2"
 * Correctly handles values containing '=' characters.
 *
 * @param cookieHeader - The Cookie header value
 * @returns Record of cookie name to value
 *
 * @example
 * ```typescript
 * const cookies = parseCookies('session=abc123; auth_token=xyz789')
 * // { session: 'abc123', auth_token: 'xyz789' }
 * ```
 */
export function parseCookies(cookieHeader) {
    const cookies = {};
    for (const cookie of cookieHeader.split(';')) {
        const [name, ...rest] = cookie.split('=');
        if (name && rest.length > 0) {
            cookies[name.trim()] = rest.join('=').trim();
        }
    }
    return cookies;
}
/**
 * Get a specific cookie value from a Cookie header string.
 *
 * More efficient than parseCookies when you only need one cookie.
 *
 * @param cookieHeader - The Cookie header value (or null)
 * @param cookieName - Name of the cookie to extract
 * @returns The cookie value or null if not found
 *
 * @example
 * ```typescript
 * const token = getCookie('session=abc123; auth_token=xyz789', 'auth_token')
 * // 'xyz789'
 * ```
 */
export function getCookie(cookieHeader, cookieName) {
    if (!cookieHeader) {
        return null;
    }
    for (const cookie of cookieHeader.split(';')) {
        const [name, ...rest] = cookie.split('=');
        if (name && name.trim() === cookieName && rest.length > 0) {
            return rest.join('=').trim();
        }
    }
    return null;
}
//# sourceMappingURL=cookies.js.map