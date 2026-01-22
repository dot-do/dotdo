// Webhook Signature Verification Utilities
// Cloudflare Workers-compatible signature verification for third-party integrations
/**
 * Convert a hex string to Uint8Array
 */
function hexToUint8Array(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}
/**
 * Convert Uint8Array to hex string
 */
function uint8ArrayToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Constant-time comparison to prevent timing attacks
 */
function secureCompare(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
/**
 * Compute HMAC-SHA256 signature
 */
async function hmacSha256(key, message) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const messageData = encoder.encode(message);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return uint8ArrayToHex(new Uint8Array(signature));
}
/**
 * Compute HMAC-SHA1 signature (for Twilio)
 */
async function hmacSha1(key, message) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const messageData = encoder.encode(message);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return uint8ArrayToHex(new Uint8Array(signature));
}
/**
 * Parse Stripe-Signature header
 * Format: t=timestamp,v1=signature1,v1=signature2,...
 */
export function parseStripeSignature(header) {
    const parts = header.split(',');
    let timestamp = 0;
    const signatures = [];
    for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 't') {
            timestamp = parseInt(value || '', 10);
        }
        else if (key === 'v1') {
            signatures.push(value || '');
        }
    }
    if (timestamp === 0 || signatures.length === 0) {
        return null;
    }
    return { timestamp, signatures };
}
/**
 * Verify Stripe webhook signature
 *
 * @param payload - Raw request body string
 * @param signatureHeader - Value of the Stripe-Signature header
 * @param secret - Webhook signing secret (whsec_xxx)
 * @param tolerance - Maximum age of the webhook in seconds (default: 300 = 5 minutes)
 */
export async function verifyStripeSignature(payload, signatureHeader, secret, tolerance = 300) {
    const parsed = parseStripeSignature(signatureHeader);
    if (!parsed) {
        return { valid: false, error: 'Unable to parse Stripe-Signature header' };
    }
    const { timestamp, signatures } = parsed;
    // Check timestamp tolerance
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
        return { valid: false, error: 'Webhook timestamp outside tolerance window' };
    }
    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = await hmacSha256(secret, signedPayload);
    // Check if any of the provided signatures match
    for (const sig of signatures) {
        if (secureCompare(sig, expectedSignature)) {
            return { valid: true };
        }
    }
    return { valid: false, error: 'Signature verification failed' };
}
// ============================================================================
// SendGrid Webhook Verification
// https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
// ============================================================================
/**
 * Verify SendGrid Event Webhook signature using ECDSA
 *
 * SendGrid uses ECDSA P-256 signatures. The verification key is provided in the
 * SendGrid dashboard and the signature is sent in the X-Twilio-Email-Event-Webhook-Signature header.
 *
 * @param payload - Raw request body string
 * @param signatureHeader - Value of the X-Twilio-Email-Event-Webhook-Signature header
 * @param timestampHeader - Value of the X-Twilio-Email-Event-Webhook-Timestamp header
 * @param publicKey - ECDSA public key from SendGrid (base64 encoded)
 * @param tolerance - Maximum age of the webhook in seconds (default: 300 = 5 minutes)
 */
export async function verifySendGridSignature(payload, signatureHeader, timestampHeader, publicKey, tolerance = 300) {
    // Check timestamp tolerance
    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp)) {
        return { valid: false, error: 'Invalid timestamp header' };
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
        return { valid: false, error: 'Webhook timestamp outside tolerance window' };
    }
    try {
        // SendGrid uses timestamp + payload as the signed message
        const signedPayload = `${timestampHeader}${payload}`;
        // Import the public key (base64 encoded P-256 public key in SPKI format)
        const keyData = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
        const cryptoKey = await crypto.subtle.importKey('spki', keyData, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        // Decode the signature (base64)
        const signatureData = Uint8Array.from(atob(signatureHeader), (c) => c.charCodeAt(0));
        // Verify the signature
        const encoder = new TextEncoder();
        const messageData = encoder.encode(signedPayload);
        const isValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, signatureData, messageData);
        return { valid: isValid };
    }
    catch (error) {
        return {
            valid: false,
            error: `Signature verification error: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
// ============================================================================
// Twilio Webhook Verification
// https://www.twilio.com/docs/usage/security#validating-requests
// ============================================================================
/**
 * Verify Twilio webhook signature
 *
 * Twilio uses HMAC-SHA1 with the auth token as the key.
 * The signature base is: URL + sorted POST parameters (as a string).
 *
 * @param url - Full request URL (including protocol, host, path, and query string)
 * @param params - POST body parameters as a record
 * @param signatureHeader - Value of the X-Twilio-Signature header
 * @param authToken - Twilio Auth Token
 */
export async function verifyTwilioSignature(url, params, signatureHeader, authToken) {
    try {
        // Build signature base string: URL + sorted parameters
        const sortedKeys = Object.keys(params).sort();
        let signatureBase = url;
        for (const key of sortedKeys) {
            signatureBase += key + params[key];
        }
        // Compute HMAC-SHA1 and encode as base64
        const encoder = new TextEncoder();
        const keyData = encoder.encode(authToken);
        const messageData = encoder.encode(signatureBase);
        const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
        // Twilio uses base64 encoding for the signature
        const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
        if (secureCompare(signatureHeader, expectedSignature)) {
            return { valid: true };
        }
        return { valid: false, error: 'Signature verification failed' };
    }
    catch (error) {
        return {
            valid: false,
            error: `Signature verification error: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
// ============================================================================
// Generic HMAC verification (for custom webhooks)
// ============================================================================
/**
 * Verify a generic HMAC-SHA256 webhook signature
 *
 * @param payload - Raw request body string
 * @param signature - The signature to verify (hex encoded)
 * @param secret - The signing secret
 * @param timestamp - Optional timestamp for replay protection
 * @param tolerance - Maximum age in seconds (only used if timestamp provided)
 */
export async function verifyHmacSignature(payload, signature, secret, timestamp, tolerance = 300) {
    // Check timestamp if provided
    if (timestamp !== undefined) {
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - timestamp) > tolerance) {
            return { valid: false, error: 'Webhook timestamp outside tolerance window' };
        }
    }
    // Build signed payload
    const signedPayload = timestamp !== undefined ? `${timestamp}.${payload}` : payload;
    // Compute expected signature
    const expectedSignature = await hmacSha256(secret, signedPayload);
    // Handle signatures that may have a prefix like "sha256="
    const normalizedSignature = signature.replace(/^sha256=/, '');
    if (secureCompare(normalizedSignature, expectedSignature)) {
        return { valid: true };
    }
    return { valid: false, error: 'Signature verification failed' };
}
//# sourceMappingURL=webhook-verify.js.map