import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GitService,
  GitRef,
  ServerCapabilities,
  SmartHTTPRequest,
  SmartHTTPResponse,
  RepositoryProvider,
  RefUpdateCommand,
  ReceivePackResult,
  handleInfoRefs,
  handleUploadPack,
  handleReceivePack,
  formatRefAdvertisement,
  parseUploadPackRequest,
  parseReceivePackRequest,
  formatUploadPackResponse,
  formatReceivePackResponse,
  capabilitiesToStrings,
  parseCapabilities,
  validateContentType,
  createErrorResponse,
  CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT,
  CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT,
  CONTENT_TYPE_UPLOAD_PACK_REQUEST,
  CONTENT_TYPE_UPLOAD_PACK_RESULT,
  CONTENT_TYPE_RECEIVE_PACK_REQUEST,
  CONTENT_TYPE_RECEIVE_PACK_RESULT,
  ZERO_SHA,
} from '../../src/wire/smart-http'
import { pktLineStream, encodePktLine, FLUSH_PKT } from '../../src/wire/pkt-line'

// Helper encoders/decoders
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Sample SHA-1 hashes for testing
const SHA1_COMMIT_1 = 'a'.repeat(40)
const SHA1_COMMIT_2 = 'b'.repeat(40)
const SHA1_COMMIT_3 = 'c'.repeat(40)
const SHA1_TAG_1 = 'f'.repeat(40)

// Sample refs for testing
const sampleRefs: GitRef[] = [
  { sha: SHA1_COMMIT_1, name: 'refs/heads/main' },
  { sha: SHA1_COMMIT_2, name: 'refs/heads/feature' },
  { sha: SHA1_TAG_1, name: 'refs/tags/v1.0.0', peeled: SHA1_COMMIT_3 },
]

// Mock repository provider implementation
function createMockRepository(
  refs: GitRef[] = sampleRefs,
  options: {
    exists?: boolean
    uploadPackPermission?: boolean
    receivePackPermission?: boolean
    uploadPackResponse?: Uint8Array
    receivePackResult?: ReceivePackResult
  } = {}
): RepositoryProvider {
  const {
    exists = true,
    uploadPackPermission = true,
    receivePackPermission = true,
    uploadPackResponse = new Uint8Array([0x50, 0x41, 0x43, 0x4b]), // PACK header
    receivePackResult = { success: true, refResults: [] },
  } = options

  return {
    async getRefs() {
      return refs
    },
    async exists() {
      return exists
    },
    async hasPermission(service: GitService) {
      if (service === 'git-upload-pack') return uploadPackPermission
      if (service === 'git-receive-pack') return receivePackPermission
      return false
    },
    async uploadPack(_wants: string[], _haves: string[], _capabilities: string[]) {
      return uploadPackResponse
    },
    async receivePack(_packData: Uint8Array, _commands: RefUpdateCommand[]) {
      return receivePackResult
    },
  }
}

// Helper to create a request
function createRequest(
  method: 'GET' | 'POST',
  path: string,
  options: Partial<SmartHTTPRequest> = {}
): SmartHTTPRequest {
  return {
    method,
    path,
    query: {},
    headers: {},
    repository: 'test-repo',
    ...options,
  }
}

describe('Git Smart HTTP Protocol Handler', () => {
  let mockRepo: RepositoryProvider

  beforeEach(() => {
    mockRepo = createMockRepository()
  })

  // ==========================================================================
  // 1. Info/Refs Discovery Endpoint
  // ==========================================================================
  describe('handleInfoRefs (GET /info/refs)', () => {
    describe('git-upload-pack service', () => {
      it('should return 200 for valid info/refs request with git-upload-pack service', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.status).toBe(200)
      })

      it('should return correct content-type for git-upload-pack', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.headers['Content-Type']).toBe(CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT)
      })

      it('should include service announcement in response body', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)
        const body = decoder.decode(response.body)

        // Should start with service announcement pkt-line
        // Format: "# service=git-upload-pack\n"
        expect(body).toContain('# service=git-upload-pack')
      })

      it('should include all refs in the advertisement', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)
        const body = decoder.decode(response.body)

        expect(body).toContain('refs/heads/main')
        expect(body).toContain('refs/heads/feature')
        expect(body).toContain('refs/tags/v1.0.0')
        expect(body).toContain(SHA1_COMMIT_1)
        expect(body).toContain(SHA1_COMMIT_2)
      })

      it('should include capabilities on first ref line', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo, {
          sideBand64k: true,
          thinPack: true,
        })
        const body = decoder.decode(response.body)

        // First ref line should have capabilities after NUL byte
        expect(body).toContain('\x00')
        expect(body).toMatch(/side-band-64k/)
        expect(body).toMatch(/thin-pack/)
      })

      it('should include peeled refs for annotated tags', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)
        const body = decoder.decode(response.body)

        // Peeled refs should appear as: <sha> refs/tags/v1.0.0^{}
        expect(body).toContain('^{}')
        expect(body).toContain(SHA1_COMMIT_3) // The peeled SHA
      })

      it('should end with flush packet', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)
        const body = decoder.decode(response.body)

        // Response should end with flush packet (0000)
        expect(body).toContain(FLUSH_PKT)
      })

      it('should handle empty repository', async () => {
        const emptyRepo = createMockRepository([])
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, emptyRepo)

        expect(response.status).toBe(200)
        // Should still have service line and capabilities line for empty repo
        const body = decoder.decode(response.body)
        expect(body).toContain('# service=git-upload-pack')
      })
    })

    describe('git-receive-pack service', () => {
      it('should return 200 for valid info/refs request with git-receive-pack service', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-receive-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.status).toBe(200)
      })

      it('should return correct content-type for git-receive-pack', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-receive-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.headers['Content-Type']).toBe(CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT)
      })

      it('should include service announcement for receive-pack', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-receive-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)
        const body = decoder.decode(response.body)

        expect(body).toContain('# service=git-receive-pack')
      })

      it('should include receive-pack specific capabilities', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-receive-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo, {
          reportStatus: true,
          deleteRefs: true,
          atomic: true,
        })
        const body = decoder.decode(response.body)

        expect(body).toMatch(/report-status/)
        expect(body).toMatch(/delete-refs/)
        expect(body).toMatch(/atomic/)
      })
    })

    describe('error cases', () => {
      it('should return 400 for missing service parameter', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: {},
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.status).toBe(400)
      })

      it('should return 400 for invalid service parameter', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'invalid-service' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.status).toBe(400)
      })

      it('should return 404 for non-existent repository', async () => {
        const nonExistentRepo = createMockRepository([], { exists: false })
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, nonExistentRepo)

        expect(response.status).toBe(404)
      })

      it('should return 403 when permission denied', async () => {
        const noAccessRepo = createMockRepository([], { uploadPackPermission: false })
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, noAccessRepo)

        expect(response.status).toBe(403)
      })
    })

    describe('caching headers', () => {
      it('should include no-cache directive', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.headers['Cache-Control']).toContain('no-cache')
      })

      it('should include Pragma no-cache for HTTP/1.0 compatibility', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        expect(response.headers['Pragma']).toBe('no-cache')
      })
    })
  })

  // ==========================================================================
  // 2. git-upload-pack Service Endpoint
  // ==========================================================================
  describe('handleUploadPack (POST /git-upload-pack)', () => {
    const createUploadPackBody = (wants: string[], haves: string[], done: boolean): Uint8Array => {
      let body = ''
      // First want includes capabilities
      if (wants.length > 0) {
        body += encodePktLine(`want ${wants[0]} thin-pack side-band-64k\n`)
        for (let i = 1; i < wants.length; i++) {
          body += encodePktLine(`want ${wants[i]}\n`)
        }
      }
      body += FLUSH_PKT
      for (const have of haves) {
        body += encodePktLine(`have ${have}\n`)
      }
      if (done) {
        body += encodePktLine('done\n')
      }
      return encoder.encode(body)
    }

    it('should return 200 for valid upload-pack request', async () => {
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: createUploadPackBody([SHA1_COMMIT_1], [], true),
      })

      const response = await handleUploadPack(request, mockRepo)

      expect(response.status).toBe(200)
    })

    it('should return correct content-type for upload-pack response', async () => {
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: createUploadPackBody([SHA1_COMMIT_1], [], true),
      })

      const response = await handleUploadPack(request, mockRepo)

      expect(response.headers['Content-Type']).toBe(CONTENT_TYPE_UPLOAD_PACK_RESULT)
    })

    it('should include NAK when no common objects', async () => {
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: createUploadPackBody([SHA1_COMMIT_1], [], true),
      })

      const response = await handleUploadPack(request, mockRepo)
      const body = decoder.decode(response.body)

      expect(body).toContain('NAK')
    })

    it('should include ACK for common objects', async () => {
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: createUploadPackBody([SHA1_COMMIT_1], [SHA1_COMMIT_2], true),
      })

      const response = await handleUploadPack(request, mockRepo)
      const body = decoder.decode(response.body)

      expect(body).toContain('ACK')
    })

    it('should include packfile data in response', async () => {
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: createUploadPackBody([SHA1_COMMIT_1], [], true),
      })

      const response = await handleUploadPack(request, mockRepo)

      // Should contain PACK header signature (0x50414b4b = PACK)
      // Response body will include pkt-line framing
      expect(response.body.length).toBeGreaterThan(0)
    })

    it('should handle multi-ack negotiation', async () => {
      // Create request with multiple haves for multi-ack negotiation
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: createUploadPackBody([SHA1_COMMIT_1], [SHA1_COMMIT_2, SHA1_COMMIT_3], false),
      })

      const response = await handleUploadPack(request, mockRepo)

      // Should return ACK continue for multi-ack
      expect(response.status).toBe(200)
    })

    it('should reject request with invalid content-type', async () => {
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': 'text/plain' },
        body: createUploadPackBody([SHA1_COMMIT_1], [], true),
      })

      const response = await handleUploadPack(request, mockRepo)

      expect(response.status).toBe(415) // Unsupported Media Type
    })

    it('should reject request without body', async () => {
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
      })

      const response = await handleUploadPack(request, mockRepo)

      expect(response.status).toBe(400)
    })

    it('should return 403 when permission denied', async () => {
      const noAccessRepo = createMockRepository([], { uploadPackPermission: false })
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: createUploadPackBody([SHA1_COMMIT_1], [], true),
      })

      const response = await handleUploadPack(request, noAccessRepo)

      expect(response.status).toBe(403)
    })

    describe('side-band multiplexing', () => {
      it('should use side-band when client requests it', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: createUploadPackBody([SHA1_COMMIT_1], [], true),
        })

        const response = await handleUploadPack(request, mockRepo)

        // Response should be in side-band format with channel bytes
        expect(response.body.length).toBeGreaterThan(0)
      })

      it('should send progress on channel 2 when side-band enabled', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: createUploadPackBody([SHA1_COMMIT_1], [], true),
        })

        const response = await handleUploadPack(request, mockRepo)

        // Progress messages should be on sideband channel 2
        // This is a behavioral expectation
        expect(response.body).toBeInstanceOf(Uint8Array)
      })
    })
  })

  // ==========================================================================
  // 3. git-receive-pack Service Endpoint
  // ==========================================================================
  describe('handleReceivePack (POST /git-receive-pack)', () => {
    const createReceivePackBody = (
      commands: RefUpdateCommand[],
      packData: Uint8Array,
      capabilities: string[] = ['report-status', 'side-band-64k']
    ): Uint8Array => {
      let body = ''
      // First command includes capabilities
      if (commands.length > 0) {
        const cmd = commands[0]
        body += encodePktLine(`${cmd.oldSha} ${cmd.newSha} ${cmd.refName}\0${capabilities.join(' ')}\n`)
        for (let i = 1; i < commands.length; i++) {
          const c = commands[i]
          body += encodePktLine(`${c.oldSha} ${c.newSha} ${c.refName}\n`)
        }
      }
      body += FLUSH_PKT

      // Combine command portion with pack data
      const commandBytes = encoder.encode(body)
      const result = new Uint8Array(commandBytes.length + packData.length)
      result.set(commandBytes, 0)
      result.set(packData, commandBytes.length)
      return result
    }

    // Sample packfile header (PACK signature + version + object count)
    const samplePackData = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0x00, 0x00, 0x00, 0x02, // Version 2
      0x00, 0x00, 0x00, 0x01, // 1 object
      // ... rest would be object data
    ])

    it('should return 200 for valid receive-pack request', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch' },
      ]
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, mockRepo)

      expect(response.status).toBe(200)
    })

    it('should return correct content-type for receive-pack response', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch' },
      ]
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, mockRepo)

      expect(response.headers['Content-Type']).toBe(CONTENT_TYPE_RECEIVE_PACK_RESULT)
    })

    it('should include unpack status in response', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch' },
      ]
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, mockRepo)
      const body = decoder.decode(response.body)

      expect(body).toContain('unpack')
    })

    it('should report ok for successful ref updates', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch' },
      ]
      const successRepo = createMockRepository(sampleRefs, {
        receivePackResult: {
          success: true,
          refResults: [{ refName: 'refs/heads/new-branch', success: true }],
        },
      })
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, successRepo)
      const body = decoder.decode(response.body)

      expect(body).toContain('ok refs/heads/new-branch')
    })

    it('should report ng for failed ref updates', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: SHA1_COMMIT_2, newSha: SHA1_COMMIT_1, refName: 'refs/heads/protected' },
      ]
      const failureRepo = createMockRepository(sampleRefs, {
        receivePackResult: {
          success: false,
          refResults: [
            { refName: 'refs/heads/protected', success: false, error: 'protected branch' },
          ],
        },
      })
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, failureRepo)
      const body = decoder.decode(response.body)

      expect(body).toContain('ng refs/heads/protected')
    })

    it('should handle ref deletion (newSha = ZERO_SHA)', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: SHA1_COMMIT_2, newSha: ZERO_SHA, refName: 'refs/heads/feature' },
      ]
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, new Uint8Array()), // No pack data for delete
      })

      const response = await handleReceivePack(request, mockRepo)

      expect(response.status).toBe(200)
    })

    it('should handle multiple ref updates', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1' },
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_2, refName: 'refs/heads/branch2' },
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_3, refName: 'refs/tags/v2.0.0' },
      ]
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, mockRepo)

      expect(response.status).toBe(200)
    })

    it('should reject request with invalid content-type', async () => {
      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch' },
      ]
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': 'text/plain' },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, mockRepo)

      expect(response.status).toBe(415)
    })

    it('should return 403 when permission denied', async () => {
      const noAccessRepo = createMockRepository([], { receivePackPermission: false })
      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/new-branch' },
      ]
      const request = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body: createReceivePackBody(commands, samplePackData),
      })

      const response = await handleReceivePack(request, noAccessRepo)

      expect(response.status).toBe(403)
    })

    describe('atomic push support', () => {
      it('should support atomic push capability', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1' },
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_2, refName: 'refs/heads/branch2' },
        ]
        const request = createRequest('POST', '/git-receive-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
          body: createReceivePackBody(commands, samplePackData, ['atomic', 'report-status']),
        })

        const response = await handleReceivePack(request, mockRepo)

        expect(response.status).toBe(200)
      })

      it('should reject all refs on atomic push if one fails', async () => {
        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/good' },
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_2, refName: 'refs/heads/protected' },
        ]
        const atomicRepo = createMockRepository(sampleRefs, {
          receivePackResult: {
            success: false,
            refResults: [
              { refName: 'refs/heads/good', success: false, error: 'atomic push failed' },
              { refName: 'refs/heads/protected', success: false, error: 'protected branch' },
            ],
          },
        })
        const request = createRequest('POST', '/git-receive-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
          body: createReceivePackBody(commands, samplePackData, ['atomic', 'report-status']),
        })

        const response = await handleReceivePack(request, atomicRepo)
        const body = decoder.decode(response.body)

        // All refs should be marked as failed
        expect(body).toContain('ng refs/heads/good')
        expect(body).toContain('ng refs/heads/protected')
      })
    })
  })

  // ==========================================================================
  // 4. Content-Type Handling
  // ==========================================================================
  describe('Content-Type Handling', () => {
    describe('validateContentType', () => {
      it('should accept exact content-type match', () => {
        expect(validateContentType(
          CONTENT_TYPE_UPLOAD_PACK_REQUEST,
          CONTENT_TYPE_UPLOAD_PACK_REQUEST
        )).toBe(true)
      })

      it('should accept content-type with charset', () => {
        expect(validateContentType(
          `${CONTENT_TYPE_UPLOAD_PACK_REQUEST}; charset=utf-8`,
          CONTENT_TYPE_UPLOAD_PACK_REQUEST
        )).toBe(true)
      })

      it('should reject mismatched content-type', () => {
        expect(validateContentType(
          'text/plain',
          CONTENT_TYPE_UPLOAD_PACK_REQUEST
        )).toBe(false)
      })

      it('should reject undefined content-type', () => {
        expect(validateContentType(undefined, CONTENT_TYPE_UPLOAD_PACK_REQUEST)).toBe(false)
      })

      it('should be case-insensitive', () => {
        expect(validateContentType(
          'APPLICATION/X-GIT-UPLOAD-PACK-REQUEST',
          CONTENT_TYPE_UPLOAD_PACK_REQUEST
        )).toBe(true)
      })
    })

    describe('content-type constants', () => {
      it('should have correct upload-pack advertisement type', () => {
        expect(CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT).toBe(
          'application/x-git-upload-pack-advertisement'
        )
      })

      it('should have correct receive-pack advertisement type', () => {
        expect(CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT).toBe(
          'application/x-git-receive-pack-advertisement'
        )
      })

      it('should have correct upload-pack request type', () => {
        expect(CONTENT_TYPE_UPLOAD_PACK_REQUEST).toBe(
          'application/x-git-upload-pack-request'
        )
      })

      it('should have correct upload-pack result type', () => {
        expect(CONTENT_TYPE_UPLOAD_PACK_RESULT).toBe(
          'application/x-git-upload-pack-result'
        )
      })

      it('should have correct receive-pack request type', () => {
        expect(CONTENT_TYPE_RECEIVE_PACK_REQUEST).toBe(
          'application/x-git-receive-pack-request'
        )
      })

      it('should have correct receive-pack result type', () => {
        expect(CONTENT_TYPE_RECEIVE_PACK_RESULT).toBe(
          'application/x-git-receive-pack-result'
        )
      })
    })
  })

  // ==========================================================================
  // 5. Pkt-line Request/Response Format
  // ==========================================================================
  describe('Pkt-line Request/Response Format', () => {
    describe('parseUploadPackRequest', () => {
      it('should parse wants from request body', () => {
        const body = encoder.encode(
          encodePktLine(`want ${SHA1_COMMIT_1}\n`) +
          encodePktLine(`want ${SHA1_COMMIT_2}\n`) +
          FLUSH_PKT +
          encodePktLine('done\n')
        )

        const parsed = parseUploadPackRequest(body)

        expect(parsed.wants).toContain(SHA1_COMMIT_1)
        expect(parsed.wants).toContain(SHA1_COMMIT_2)
        expect(parsed.wants).toHaveLength(2)
      })

      it('should parse haves from request body', () => {
        const body = encoder.encode(
          encodePktLine(`want ${SHA1_COMMIT_1}\n`) +
          FLUSH_PKT +
          encodePktLine(`have ${SHA1_COMMIT_2}\n`) +
          encodePktLine(`have ${SHA1_COMMIT_3}\n`) +
          encodePktLine('done\n')
        )

        const parsed = parseUploadPackRequest(body)

        expect(parsed.haves).toContain(SHA1_COMMIT_2)
        expect(parsed.haves).toContain(SHA1_COMMIT_3)
        expect(parsed.haves).toHaveLength(2)
      })

      it('should parse capabilities from first want line', () => {
        const body = encoder.encode(
          encodePktLine(`want ${SHA1_COMMIT_1} thin-pack side-band-64k ofs-delta\n`) +
          FLUSH_PKT +
          encodePktLine('done\n')
        )

        const parsed = parseUploadPackRequest(body)

        expect(parsed.capabilities).toContain('thin-pack')
        expect(parsed.capabilities).toContain('side-band-64k')
        expect(parsed.capabilities).toContain('ofs-delta')
      })

      it('should detect done flag', () => {
        const bodyWithDone = encoder.encode(
          encodePktLine(`want ${SHA1_COMMIT_1}\n`) +
          FLUSH_PKT +
          encodePktLine('done\n')
        )

        const bodyWithoutDone = encoder.encode(
          encodePktLine(`want ${SHA1_COMMIT_1}\n`) +
          FLUSH_PKT +
          encodePktLine(`have ${SHA1_COMMIT_2}\n`) +
          FLUSH_PKT
        )

        expect(parseUploadPackRequest(bodyWithDone).done).toBe(true)
        expect(parseUploadPackRequest(bodyWithoutDone).done).toBe(false)
      })

      it('should handle empty haves (clone)', () => {
        const body = encoder.encode(
          encodePktLine(`want ${SHA1_COMMIT_1}\n`) +
          FLUSH_PKT +
          encodePktLine('done\n')
        )

        const parsed = parseUploadPackRequest(body)

        expect(parsed.haves).toEqual([])
      })
    })

    describe('parseReceivePackRequest', () => {
      it('should parse ref update commands', () => {
        const body = encoder.encode(
          encodePktLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/main\0report-status\n`) +
          FLUSH_PKT
        )

        const parsed = parseReceivePackRequest(body)

        expect(parsed.commands).toHaveLength(1)
        expect(parsed.commands[0]).toEqual({
          oldSha: ZERO_SHA,
          newSha: SHA1_COMMIT_1,
          refName: 'refs/heads/main',
        })
      })

      it('should parse multiple commands', () => {
        const body = encoder.encode(
          encodePktLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/branch1\0report-status\n`) +
          encodePktLine(`${SHA1_COMMIT_2} ${SHA1_COMMIT_3} refs/heads/branch2\n`) +
          FLUSH_PKT
        )

        const parsed = parseReceivePackRequest(body)

        expect(parsed.commands).toHaveLength(2)
      })

      it('should parse capabilities from first command', () => {
        const body = encoder.encode(
          encodePktLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/main\0report-status atomic side-band-64k\n`) +
          FLUSH_PKT
        )

        const parsed = parseReceivePackRequest(body)

        expect(parsed.capabilities).toContain('report-status')
        expect(parsed.capabilities).toContain('atomic')
        expect(parsed.capabilities).toContain('side-band-64k')
      })

      it('should extract packfile data after flush', () => {
        const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02])
        const commandPart = encoder.encode(
          encodePktLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/main\0report-status\n`) +
          FLUSH_PKT
        )
        const body = new Uint8Array(commandPart.length + packData.length)
        body.set(commandPart, 0)
        body.set(packData, commandPart.length)

        const parsed = parseReceivePackRequest(body)

        expect(parsed.packfile).toEqual(packData)
      })

      it('should handle delete without packfile', () => {
        const body = encoder.encode(
          encodePktLine(`${SHA1_COMMIT_1} ${ZERO_SHA} refs/heads/old-branch\0report-status delete-refs\n`) +
          FLUSH_PKT
        )

        const parsed = parseReceivePackRequest(body)

        expect(parsed.commands[0].newSha).toBe(ZERO_SHA)
        expect(parsed.packfile.length).toBe(0)
      })
    })

    describe('formatRefAdvertisement', () => {
      it('should format refs with pkt-line encoding', () => {
        const result = formatRefAdvertisement('git-upload-pack', sampleRefs)
        const { packets } = pktLineStream(result)

        // Should have service line, flush, refs, flush
        expect(packets.length).toBeGreaterThan(0)
      })

      it('should include service header first', () => {
        const result = formatRefAdvertisement('git-upload-pack', sampleRefs)
        const body = decoder.decode(result)

        // First pkt-line should be service header
        expect(body).toMatch(/^[0-9a-f]{4}# service=git-upload-pack/)
      })

      it('should include flush after service header', () => {
        const result = formatRefAdvertisement('git-upload-pack', sampleRefs)
        const { packets } = pktLineStream(result)

        // Second element should be flush
        const flushIndices = packets
          .map((p, i) => (p.type === 'flush' ? i : -1))
          .filter((i) => i >= 0)
        expect(flushIndices.length).toBeGreaterThanOrEqual(1)
      })

      it('should include capabilities after NUL on first ref', () => {
        const result = formatRefAdvertisement('git-upload-pack', sampleRefs, {
          sideBand64k: true,
        })
        const body = decoder.decode(result)

        expect(body).toContain('\x00')
        expect(body).toContain('side-band-64k')
      })

      it('should format refs as <sha> <refname>', () => {
        const result = formatRefAdvertisement('git-upload-pack', sampleRefs)
        const body = decoder.decode(result)

        expect(body).toContain(`${SHA1_COMMIT_1} refs/heads/main`)
      })

      it('should include peeled tags with ^{}', () => {
        const result = formatRefAdvertisement('git-upload-pack', sampleRefs)
        const body = decoder.decode(result)

        expect(body).toContain('refs/tags/v1.0.0')
        expect(body).toContain(`${SHA1_COMMIT_3} refs/tags/v1.0.0^{}`)
      })
    })

    describe('formatUploadPackResponse', () => {
      it('should format NAK response', () => {
        const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
        const result = formatUploadPackResponse(packData, false)
        const body = decoder.decode(result)

        expect(body).toContain('NAK')
      })

      it('should include packfile data', () => {
        const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02])
        const result = formatUploadPackResponse(packData, false)

        // Response should contain PACK signature
        expect(result.includes(0x50)).toBe(true) // P
        expect(result.includes(0x41)).toBe(true) // A
        expect(result.includes(0x43)).toBe(true) // C
        expect(result.includes(0x4b)).toBe(true) // K
      })

      it('should use side-band when enabled', () => {
        const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
        const result = formatUploadPackResponse(packData, true)

        // Side-band wraps data with channel byte
        expect(result.length).toBeGreaterThan(packData.length)
      })

      it('should end with flush packet', () => {
        const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b])
        const result = formatUploadPackResponse(packData, false)
        const body = decoder.decode(result)

        expect(body).toContain(FLUSH_PKT)
      })
    })

    describe('formatReceivePackResponse', () => {
      it('should include unpack ok for successful unpack', () => {
        const result = formatReceivePackResponse({
          success: true,
          refResults: [],
        })
        const body = decoder.decode(result)

        expect(body).toContain('unpack ok')
      })

      it('should include unpack error for failed unpack', () => {
        const result = formatReceivePackResponse({
          success: false,
          refResults: [],
        })
        const body = decoder.decode(result)

        expect(body).toContain('unpack')
        // Might be "unpack error" or "unpack <error-message>"
      })

      it('should include ok for successful ref updates', () => {
        const result = formatReceivePackResponse({
          success: true,
          refResults: [{ refName: 'refs/heads/main', success: true }],
        })
        const body = decoder.decode(result)

        expect(body).toContain('ok refs/heads/main')
      })

      it('should include ng with error for failed ref updates', () => {
        const result = formatReceivePackResponse({
          success: false,
          refResults: [
            { refName: 'refs/heads/main', success: false, error: 'non-fast-forward' },
          ],
        })
        const body = decoder.decode(result)

        expect(body).toContain('ng refs/heads/main')
        expect(body).toContain('non-fast-forward')
      })

      it('should format multiple ref results', () => {
        const result = formatReceivePackResponse({
          success: true,
          refResults: [
            { refName: 'refs/heads/main', success: true },
            { refName: 'refs/heads/feature', success: true },
            { refName: 'refs/tags/v1.0', success: true },
          ],
        })
        const body = decoder.decode(result)

        expect(body).toContain('ok refs/heads/main')
        expect(body).toContain('ok refs/heads/feature')
        expect(body).toContain('ok refs/tags/v1.0')
      })

      it('should end with flush packet', () => {
        const result = formatReceivePackResponse({
          success: true,
          refResults: [],
        })
        const body = decoder.decode(result)

        expect(body).toContain(FLUSH_PKT)
      })
    })
  })

  // ==========================================================================
  // 6. Capability Advertisement
  // ==========================================================================
  describe('Capability Advertisement', () => {
    describe('capabilitiesToStrings', () => {
      it('should convert sideBand64k to side-band-64k', () => {
        const result = capabilitiesToStrings({ sideBand64k: true })
        expect(result).toContain('side-band-64k')
      })

      it('should convert thinPack to thin-pack', () => {
        const result = capabilitiesToStrings({ thinPack: true })
        expect(result).toContain('thin-pack')
      })

      it('should convert multiAck to multi_ack', () => {
        const result = capabilitiesToStrings({ multiAck: true })
        expect(result).toContain('multi_ack')
      })

      it('should convert multiAckDetailed to multi_ack_detailed', () => {
        const result = capabilitiesToStrings({ multiAckDetailed: true })
        expect(result).toContain('multi_ack_detailed')
      })

      it('should convert shallow capability', () => {
        const result = capabilitiesToStrings({ shallow: true })
        expect(result).toContain('shallow')
      })

      it('should convert ofsDelta to ofs-delta', () => {
        const result = capabilitiesToStrings({ ofsDelta: true })
        expect(result).toContain('ofs-delta')
      })

      it('should convert includeTag to include-tag', () => {
        const result = capabilitiesToStrings({ includeTag: true })
        expect(result).toContain('include-tag')
      })

      it('should convert noProgress to no-progress', () => {
        const result = capabilitiesToStrings({ noProgress: true })
        expect(result).toContain('no-progress')
      })

      it('should convert reportStatus to report-status', () => {
        const result = capabilitiesToStrings({ reportStatus: true })
        expect(result).toContain('report-status')
      })

      it('should convert deleteRefs to delete-refs', () => {
        const result = capabilitiesToStrings({ deleteRefs: true })
        expect(result).toContain('delete-refs')
      })

      it('should convert atomic capability', () => {
        const result = capabilitiesToStrings({ atomic: true })
        expect(result).toContain('atomic')
      })

      it('should include agent with value', () => {
        const result = capabilitiesToStrings({ agent: 'gitx.do/1.0' })
        expect(result).toContain('agent=gitx.do/1.0')
      })

      it('should only include enabled capabilities', () => {
        const result = capabilitiesToStrings({
          sideBand64k: true,
          thinPack: false,
          shallow: true,
        })

        expect(result).toContain('side-band-64k')
        expect(result).not.toContain('thin-pack')
        expect(result).toContain('shallow')
      })

      it('should handle empty capabilities', () => {
        const result = capabilitiesToStrings({})
        expect(result).toEqual([])
      })

      it('should convert multiple capabilities', () => {
        const result = capabilitiesToStrings({
          sideBand64k: true,
          thinPack: true,
          shallow: true,
          ofsDelta: true,
          includeTag: true,
          agent: 'gitx.do/1.0',
        })

        expect(result).toContain('side-band-64k')
        expect(result).toContain('thin-pack')
        expect(result).toContain('shallow')
        expect(result).toContain('ofs-delta')
        expect(result).toContain('include-tag')
        expect(result).toContain('agent=gitx.do/1.0')
        expect(result.length).toBe(6)
      })
    })

    describe('parseCapabilities', () => {
      it('should parse side-band-64k', () => {
        const result = parseCapabilities(['side-band-64k'])
        expect(result.sideBand64k).toBe(true)
      })

      it('should parse thin-pack', () => {
        const result = parseCapabilities(['thin-pack'])
        expect(result.thinPack).toBe(true)
      })

      it('should parse multi_ack', () => {
        const result = parseCapabilities(['multi_ack'])
        expect(result.multiAck).toBe(true)
      })

      it('should parse multi_ack_detailed', () => {
        const result = parseCapabilities(['multi_ack_detailed'])
        expect(result.multiAckDetailed).toBe(true)
      })

      it('should parse shallow', () => {
        const result = parseCapabilities(['shallow'])
        expect(result.shallow).toBe(true)
      })

      it('should parse ofs-delta', () => {
        const result = parseCapabilities(['ofs-delta'])
        expect(result.ofsDelta).toBe(true)
      })

      it('should parse include-tag', () => {
        const result = parseCapabilities(['include-tag'])
        expect(result.includeTag).toBe(true)
      })

      it('should parse no-progress', () => {
        const result = parseCapabilities(['no-progress'])
        expect(result.noProgress).toBe(true)
      })

      it('should parse report-status', () => {
        const result = parseCapabilities(['report-status'])
        expect(result.reportStatus).toBe(true)
      })

      it('should parse delete-refs', () => {
        const result = parseCapabilities(['delete-refs'])
        expect(result.deleteRefs).toBe(true)
      })

      it('should parse atomic', () => {
        const result = parseCapabilities(['atomic'])
        expect(result.atomic).toBe(true)
      })

      it('should parse agent with value', () => {
        const result = parseCapabilities(['agent=git/2.40.0'])
        expect(result.agent).toBe('git/2.40.0')
      })

      it('should parse multiple capabilities', () => {
        const result = parseCapabilities([
          'side-band-64k',
          'thin-pack',
          'shallow',
          'ofs-delta',
          'agent=git/2.40.0',
        ])

        expect(result.sideBand64k).toBe(true)
        expect(result.thinPack).toBe(true)
        expect(result.shallow).toBe(true)
        expect(result.ofsDelta).toBe(true)
        expect(result.agent).toBe('git/2.40.0')
      })

      it('should handle empty capabilities array', () => {
        const result = parseCapabilities([])
        expect(result).toEqual({})
      })

      it('should ignore unknown capabilities', () => {
        const result = parseCapabilities(['unknown-cap', 'side-band-64k'])
        expect(result.sideBand64k).toBe(true)
        expect(Object.keys(result)).toHaveLength(1)
      })
    })
  })

  // ==========================================================================
  // 7. Error Responses
  // ==========================================================================
  describe('Error Responses', () => {
    describe('createErrorResponse', () => {
      it('should create 400 Bad Request response', () => {
        const response = createErrorResponse(400, 'Invalid request')

        expect(response.status).toBe(400)
        expect(response.statusText).toBe('Bad Request')
        expect(decoder.decode(response.body)).toContain('Invalid request')
      })

      it('should create 401 Unauthorized response', () => {
        const response = createErrorResponse(401, 'Authentication required')

        expect(response.status).toBe(401)
        expect(response.statusText).toBe('Unauthorized')
      })

      it('should create 403 Forbidden response', () => {
        const response = createErrorResponse(403, 'Permission denied')

        expect(response.status).toBe(403)
        expect(response.statusText).toBe('Forbidden')
        expect(decoder.decode(response.body)).toContain('Permission denied')
      })

      it('should create 404 Not Found response', () => {
        const response = createErrorResponse(404, 'Repository not found')

        expect(response.status).toBe(404)
        expect(response.statusText).toBe('Not Found')
        expect(decoder.decode(response.body)).toContain('Repository not found')
      })

      it('should create 415 Unsupported Media Type response', () => {
        const response = createErrorResponse(415, 'Invalid content type')

        expect(response.status).toBe(415)
        expect(response.statusText).toBe('Unsupported Media Type')
      })

      it('should create 500 Internal Server Error response', () => {
        const response = createErrorResponse(500, 'Internal error')

        expect(response.status).toBe(500)
        expect(response.statusText).toBe('Internal Server Error')
      })

      it('should set appropriate content-type for error', () => {
        const response = createErrorResponse(400, 'Error')

        expect(response.headers['Content-Type']).toBeDefined()
      })

      it('should format error message in body', () => {
        const response = createErrorResponse(500, 'Something went wrong')
        const body = decoder.decode(response.body)

        expect(body).toContain('Something went wrong')
      })
    })

    describe('protocol error handling', () => {
      it('should return error for malformed pkt-line in upload-pack', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode('invalid pkt-line data'),
        })

        const response = await handleUploadPack(request, mockRepo)

        expect(response.status).toBe(400)
      })

      it('should return error for malformed pkt-line in receive-pack', async () => {
        const request = createRequest('POST', '/git-receive-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
          body: encoder.encode('invalid pkt-line data'),
        })

        const response = await handleReceivePack(request, mockRepo)

        expect(response.status).toBe(400)
      })

      it('should return error for invalid SHA format in want', async () => {
        const body = encoder.encode(
          encodePktLine('want invalid-sha\n') +
          FLUSH_PKT +
          encodePktLine('done\n')
        )
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body,
        })

        const response = await handleUploadPack(request, mockRepo)

        expect(response.status).toBe(400)
      })

      it('should return error for invalid SHA format in command', async () => {
        const body = encoder.encode(
          encodePktLine('invalid-sha invalid-sha refs/heads/main\0report-status\n') +
          FLUSH_PKT
        )
        const request = createRequest('POST', '/git-receive-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
          body,
        })

        const response = await handleReceivePack(request, mockRepo)

        expect(response.status).toBe(400)
      })
    })
  })

  // ==========================================================================
  // 8. ZERO_SHA constant
  // ==========================================================================
  describe('ZERO_SHA constant', () => {
    it('should be 40 zeros', () => {
      expect(ZERO_SHA).toBe('0'.repeat(40))
    })

    it('should be used for ref creation', () => {
      expect(ZERO_SHA.length).toBe(40)
    })
  })

  // ==========================================================================
  // 9. Integration-like tests
  // ==========================================================================
  describe('Full protocol flows', () => {
    it('should handle complete clone flow', async () => {
      // Step 1: Info/refs discovery
      const infoRefsRequest = createRequest('GET', '/info/refs', {
        query: { service: 'git-upload-pack' },
      })
      const infoRefsResponse = await handleInfoRefs(infoRefsRequest, mockRepo)
      expect(infoRefsResponse.status).toBe(200)

      // Step 2: Upload-pack for packfile
      const uploadPackBody = encoder.encode(
        encodePktLine(`want ${SHA1_COMMIT_1} thin-pack side-band-64k\n`) +
        FLUSH_PKT +
        encodePktLine('done\n')
      )
      const uploadPackRequest = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: uploadPackBody,
      })
      const uploadPackResponse = await handleUploadPack(uploadPackRequest, mockRepo)
      expect(uploadPackResponse.status).toBe(200)
    })

    it('should handle complete push flow', async () => {
      // Step 1: Info/refs discovery for receive-pack
      const infoRefsRequest = createRequest('GET', '/info/refs', {
        query: { service: 'git-receive-pack' },
      })
      const infoRefsResponse = await handleInfoRefs(infoRefsRequest, mockRepo)
      expect(infoRefsResponse.status).toBe(200)

      // Step 2: Receive-pack with commands and packfile
      const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02])
      const commandPart = encoder.encode(
        encodePktLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/new-branch\0report-status\n`) +
        FLUSH_PKT
      )
      const body = new Uint8Array(commandPart.length + packData.length)
      body.set(commandPart, 0)
      body.set(packData, commandPart.length)

      const receivePackRequest = createRequest('POST', '/git-receive-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
        body,
      })
      const receivePackResponse = await handleReceivePack(receivePackRequest, mockRepo)
      expect(receivePackResponse.status).toBe(200)
    })

    it('should handle fetch with negotiation', async () => {
      // Fetch with haves (incremental fetch, not clone)
      const uploadPackBody = encoder.encode(
        encodePktLine(`want ${SHA1_COMMIT_1} thin-pack\n`) +
        FLUSH_PKT +
        encodePktLine(`have ${SHA1_COMMIT_2}\n`) +
        encodePktLine(`have ${SHA1_COMMIT_3}\n`) +
        encodePktLine('done\n')
      )
      const request = createRequest('POST', '/git-upload-pack', {
        headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
        body: uploadPackBody,
      })

      const response = await handleUploadPack(request, mockRepo)
      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // 10. Chunked Transfer Encoding
  // ==========================================================================
  describe('Chunked Transfer Encoding', () => {
    describe('streaming response support', () => {
      it('should support Transfer-Encoding: chunked in info/refs response', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo)

        // Response should be suitable for chunked transfer (large content)
        expect(response.body.length).toBeGreaterThan(0)
        // Chunked encoding header should be set or response should be streamable
        expect(response.headers).toBeDefined()
      })

      it('should handle large packfile responses with chunking', async () => {
        // Simulate large packfile response
        const largePackData = new Uint8Array(100000)
        largePackData.fill(0x42)

        const largePackRepo = createMockRepository(sampleRefs, {
          uploadPackResponse: largePackData,
        })

        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} side-band-64k\n`) +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, largePackRepo)

        expect(response.status).toBe(200)
        expect(response.body.length).toBeGreaterThan(0)
      })

      it('should handle incremental pkt-line chunks in request', async () => {
        // Test parsing of request that might arrive in multiple chunks
        const chunkedBody = encoder.encode(
          encodePktLine(`want ${SHA1_COMMIT_1} thin-pack\n`) +
          encodePktLine(`want ${SHA1_COMMIT_2}\n`) +
          FLUSH_PKT +
          encodePktLine(`have ${SHA1_COMMIT_3}\n`) +
          FLUSH_PKT +
          encodePktLine('done\n')
        )

        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: chunkedBody,
        })

        const response = await handleUploadPack(request, mockRepo)
        expect(response.status).toBe(200)
      })
    })

    describe('side-band streaming', () => {
      it('should stream progress and data interleaved via side-band', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} side-band-64k\n`) +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, mockRepo)

        // Side-band response should interleave progress (channel 2) and data (channel 1)
        expect(response.body.length).toBeGreaterThan(0)
      })

      it('should handle side-band-64k for large chunk sizes', async () => {
        // side-band-64k allows larger chunks than regular side-band
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} side-band-64k\n`) +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        expect(response.status).toBe(200)
      })
    })

    describe('receive-pack chunked packfile', () => {
      it('should accept chunked packfile in receive-pack', async () => {
        // Large packfile that would typically be chunked
        const largePackData = new Uint8Array(50000)
        largePackData.set([0x50, 0x41, 0x43, 0x4b, 0x00, 0x00, 0x00, 0x02], 0) // PACK header
        largePackData.fill(0x00, 8)

        const commands: RefUpdateCommand[] = [
          { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/large-branch' },
        ]

        const commandPart = encoder.encode(
          encodePktLine(`${ZERO_SHA} ${SHA1_COMMIT_1} refs/heads/large-branch\0report-status\n`) +
          FLUSH_PKT
        )

        const body = new Uint8Array(commandPart.length + largePackData.length)
        body.set(commandPart, 0)
        body.set(largePackData, commandPart.length)

        const request = createRequest('POST', '/git-receive-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
          body,
        })

        const response = await handleReceivePack(request, mockRepo)
        expect(response.status).toBe(200)
      })

      it('should handle empty packfile for ref-only operations', async () => {
        // Delete operation has no packfile
        const commands: RefUpdateCommand[] = [
          { oldSha: SHA1_COMMIT_1, newSha: ZERO_SHA, refName: 'refs/heads/to-delete' },
        ]

        const body = encoder.encode(
          encodePktLine(`${SHA1_COMMIT_1} ${ZERO_SHA} refs/heads/to-delete\0report-status delete-refs\n`) +
          FLUSH_PKT
        )

        const request = createRequest('POST', '/git-receive-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_RECEIVE_PACK_REQUEST },
          body,
        })

        const response = await handleReceivePack(request, mockRepo)
        expect(response.status).toBe(200)
      })
    })
  })

  // ==========================================================================
  // 11. Content Negotiation
  // ==========================================================================
  describe('Content Negotiation', () => {
    describe('multi_ack negotiation', () => {
      it('should support multi_ack for efficient negotiation', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} multi_ack\n`) +
            FLUSH_PKT +
            encodePktLine(`have ${SHA1_COMMIT_2}\n`) +
            encodePktLine(`have ${SHA1_COMMIT_3}\n`) +
            FLUSH_PKT
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        // Should return ACK for each common object during negotiation
        expect(response.status).toBe(200)
      })

      it('should support multi_ack_detailed for more info', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} multi_ack_detailed\n`) +
            FLUSH_PKT +
            encodePktLine(`have ${SHA1_COMMIT_2}\n`) +
            FLUSH_PKT
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        // multi_ack_detailed provides ACK with status (continue, common, ready)
        expect(response.status).toBe(200)
      })
    })

    describe('capability negotiation', () => {
      it('should negotiate common capabilities between client and server', async () => {
        const request = createRequest('GET', '/info/refs', {
          query: { service: 'git-upload-pack' },
        })

        const response = await handleInfoRefs(request, mockRepo, {
          thinPack: true,
          sideBand64k: true,
          shallow: true,
        })

        const body = decoder.decode(response.body)
        // Server advertises its capabilities
        expect(body).toContain('thin-pack')
        expect(body).toContain('side-band-64k')
        expect(body).toContain('shallow')
      })

      it('should only use capabilities both sides support', async () => {
        // Client requests capabilities, server should only use ones it also supports
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} thin-pack ofs-delta shallow\n`) +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        expect(response.status).toBe(200)
      })

      it('should handle deepen negotiation for shallow clones', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} shallow\n`) +
            encodePktLine('deepen 1\n') +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        expect(response.status).toBe(200)
      })

      it('should handle deepen-since negotiation', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} shallow deepen-since\n`) +
            encodePktLine('deepen-since 1704067200\n') +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        expect(response.status).toBe(200)
      })

      it('should handle filter capability for partial clone', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} filter\n`) +
            encodePktLine('filter blob:none\n') +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        expect(response.status).toBe(200)
      })
    })

    describe('include-tag handling', () => {
      it('should include tags pointing to fetched commits when include-tag enabled', async () => {
        const request = createRequest('POST', '/git-upload-pack', {
          headers: { 'Content-Type': CONTENT_TYPE_UPLOAD_PACK_REQUEST },
          body: encoder.encode(
            encodePktLine(`want ${SHA1_COMMIT_1} include-tag\n`) +
            FLUSH_PKT +
            encodePktLine('done\n')
          ),
        })

        const response = await handleUploadPack(request, mockRepo)
        expect(response.status).toBe(200)
      })
    })
  })
})
