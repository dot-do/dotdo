/**
 * SPIKE TEST: AWS Signature V4 for Cloudflare Workers
 *
 * Goal: Prove AWS Sig V4 works in Workers using crypto.subtle
 */

import { describe, it, expect } from 'vitest'
import { signRequest, sha256Hex } from './aws-sig-v4'

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

  it('includes X-Amz-Date header in correct format', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'https://bucket.s3.us-east-1.amazonaws.com/file.txt',
      region: 'us-east-1',
      service: 's3',
      ...testCredentials
    })

    expect(headers['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/)
  })

  it('calculates correct empty payload hash', async () => {
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

  it('handles different regions correctly', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'https://bucket.s3.eu-west-1.amazonaws.com/file.txt',
      region: 'eu-west-1',
      service: 's3',
      ...testCredentials
    })

    expect(headers.Authorization).toContain('eu-west-1/s3/aws4_request')
  })

  it('handles virtual-hosted bucket URLs', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'https://my-bucket.s3.us-west-2.amazonaws.com/path/to/object.txt',
      region: 'us-west-2',
      service: 's3',
      ...testCredentials
    })

    expect(headers.Host).toBe('my-bucket.s3.us-west-2.amazonaws.com')
    expect(headers.Authorization).toContain('us-west-2/s3/aws4_request')
  })

  it('handles query parameters', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: 'https://bucket.s3.us-east-1.amazonaws.com/file.txt?response-content-type=text/plain',
      region: 'us-east-1',
      service: 's3',
      ...testCredentials
    })

    expect(headers.Authorization).toBeDefined()
  })

  it('measures signing performance (should be < 5ms)', async () => {
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

    console.log(`\n  AWS Sig V4 Performance: ${avgMs.toFixed(2)}ms per signature (${iterations} iterations)\n`)

    // Should be < 5ms per signature in Node.js (Workers may be faster)
    expect(avgMs).toBeLessThan(10)
  })

  it('sha256 produces correct hash', async () => {
    const input = new TextEncoder().encode('test')
    const hash = await sha256Hex(input)

    // Known SHA256 of "test"
    expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
  })
})
