/**
 * SPIKE: AWS Signature V4 for Cloudflare Workers
 *
 * Goal: Prove AWS Sig V4 works in Workers using crypto.subtle
 * Timebox: 2 hours
 *
 * Run: npx vitest run aws-sig-v4.test.ts
 */

interface SignRequestOptions {
  method: string
  url: string
  region: string
  service: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  payload?: ArrayBuffer
}

/**
 * Generate AWS Signature Version 4 headers
 * Uses crypto.subtle which is native to Cloudflare Workers
 */
export async function signRequest(options: SignRequestOptions): Promise<Record<string, string>> {
  const { method, url, region, service, accessKeyId, secretAccessKey, sessionToken, payload } = options

  const urlObj = new URL(url)
  const host = urlObj.hostname
  const path = urlObj.pathname || '/'
  const queryString = urlObj.search.slice(1)

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '')
  const dateStamp = amzDate.slice(0, 8)

  // Calculate payload hash
  const payloadHash = await sha256Hex(payload || new ArrayBuffer(0))

  // Build signed headers
  const signedHeadersList = sessionToken
    ? ['host', 'x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token']
    : ['host', 'x-amz-content-sha256', 'x-amz-date']
  const signedHeaders = signedHeadersList.join(';')

  // Build canonical headers
  let canonicalHeaders = `host:${host}\n`
  canonicalHeaders += `x-amz-content-sha256:${payloadHash}\n`
  canonicalHeaders += `x-amz-date:${amzDate}\n`
  if (sessionToken) {
    canonicalHeaders += `x-amz-security-token:${sessionToken}\n`
  }

  // Build canonical request
  const canonicalRequest = [
    method,
    path,
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n')

  const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest))

  // Build string to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash
  ].join('\n')

  // Calculate signature
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service)
  const signature = await hmacSha256Hex(signingKey, stringToSign)

  // Build authorization header
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const headers: Record<string, string> = {
    'Host': host,
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
    'Authorization': authorization
  }

  if (sessionToken) {
    headers['X-Amz-Security-Token'] = sessionToken
  }

  return headers
}

// SHA256 hash returning hex string
async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? data.buffer : data
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return bufferToHex(hashBuffer)
}

// HMAC-SHA256 returning hex string
async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(data)
  )

  return bufferToHex(signature)
}

// HMAC-SHA256 returning raw ArrayBuffer
async function hmacSha256Raw(key: ArrayBuffer | string, data: string): Promise<ArrayBuffer> {
  const keyBuffer = typeof key === 'string'
    ? new TextEncoder().encode(key)
    : key

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

// Calculate the signing key
async function getSignatureKey(
  key: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256Raw(`AWS4${key}`, dateStamp)
  const kRegion = await hmacSha256Raw(kDate, region)
  const kService = await hmacSha256Raw(kRegion, service)
  return hmacSha256Raw(kService, 'aws4_request')
}

// Convert ArrayBuffer to hex string
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// SPIKE TESTS - Run with vitest
// ============================================================================

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('AWS Signature V4 Spike', () => {
    // Test credentials (from AWS docs examples)
    const testCredentials = {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    }

    it('generates valid Authorization header format', async () => {
      const headers = await signRequest({
        method: 'GET',
        url: 'https://examplebucket.s3.us-east-1.amazonaws.com/test.txt',
        region: 'us-east-1',
        service: 's3',
        ...testCredentials
      })

      expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256/)
      expect(headers.Authorization).toContain('Credential=AKIAIOSFODNN7EXAMPLE/')
      expect(headers.Authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date')
      expect(headers.Authorization).toContain('Signature=')
    })

    it('includes X-Amz-Date header', async () => {
      const headers = await signRequest({
        method: 'GET',
        url: 'https://bucket.s3.us-east-1.amazonaws.com/file.txt',
        region: 'us-east-1',
        service: 's3',
        ...testCredentials
      })

      expect(headers['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/)
    })

    it('includes X-Amz-Content-Sha256 header', async () => {
      const headers = await signRequest({
        method: 'GET',
        url: 'https://bucket.s3.us-east-1.amazonaws.com/file.txt',
        region: 'us-east-1',
        service: 's3',
        ...testCredentials
      })

      // SHA256 of empty payload
      expect(headers['X-Amz-Content-Sha256']).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      )
    })

    it('includes session token when provided', async () => {
      const headers = await signRequest({
        method: 'GET',
        url: 'https://bucket.s3.us-east-1.amazonaws.com/file.txt',
        region: 'us-east-1',
        service: 's3',
        ...testCredentials,
        sessionToken: 'AQoDYXdzEJr...'
      })

      expect(headers['X-Amz-Security-Token']).toBe('AQoDYXdzEJr...')
      expect(headers.Authorization).toContain('x-amz-security-token')
    })

    it('handles different regions', async () => {
      const headers = await signRequest({
        method: 'GET',
        url: 'https://bucket.s3.eu-west-1.amazonaws.com/file.txt',
        region: 'eu-west-1',
        service: 's3',
        ...testCredentials
      })

      expect(headers.Authorization).toContain('eu-west-1/s3/aws4_request')
    })

    it('measures signing performance', async () => {
      const iterations = 100
      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        await signRequest({
          method: 'GET',
          url: 'https://bucket.s3.us-east-1.amazonaws.com/file.txt',
          region: 'us-east-1',
          service: 's3',
          ...testCredentials
        })
      }

      const elapsed = performance.now() - start
      const avgMs = elapsed / iterations

      console.log(`AWS Sig V4 Performance: ${avgMs.toFixed(2)}ms per signature (${iterations} iterations)`)

      // Should be < 5ms per signature
      expect(avgMs).toBeLessThan(10)
    })
  })
}

export { sha256Hex, hmacSha256Hex }
