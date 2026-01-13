/**
 * Video Transcode Tests - TDD RED Phase
 *
 * Tests for video transcoding capabilities within Cloudflare Workers.
 *
 * FEASIBILITY NOTE:
 * Native video transcoding in Workers is not directly supported due to:
 * - CPU execution limits (50ms for free, 30s for paid plans)
 * - Memory limits (128MB)
 * - No native FFmpeg or video codec support
 *
 * This test file documents two strategies:
 * 1. Delegation to Cloudflare Stream API for transcoding
 * 2. WebCodecs-based approach for limited operations (metadata, thumbnails)
 * 3. External service integration (e.g., AWS MediaConvert, Mux)
 *
 * These tests are designed to fail until the implementation is complete.
 * @see https://developers.cloudflare.com/stream/
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createVideoTranscoder,
  type VideoTranscoder,
  type TranscodeOptions,
  type VideoFormat,
  type VideoCodec,
  type AudioCodec,
  type VideoMetadata,
  type TranscodeResult,
  type TranscodeJobStatus,
  type ThumbnailOptions,
  type ClipOptions,
  VideoTranscodeError,
  VideoUnsupportedError,
} from '../video-transcode'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestVideoTranscoder(): VideoTranscoder {
  return createVideoTranscoder()
}

/**
 * Creates a minimal valid MP4 buffer for testing
 * This is a proper ftyp + moov minimal structure
 */
function createTestMp4Buffer(): Uint8Array {
  // Minimal MP4: ftyp box + moov box structure (32 bytes)
  // Real videos would be much larger - this is for API testing
  return new Uint8Array([
    // ftyp box (20 bytes)
    0x00, 0x00, 0x00, 0x14, // size = 20
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // brand 'isom'
    0x00, 0x00, 0x00, 0x00, // version
    0x69, 0x73, 0x6f, 0x6d, // compatible brand
    // Minimal moov box (12 bytes - just header)
    0x00, 0x00, 0x00, 0x0c, // size = 12
    0x6d, 0x6f, 0x6f, 0x76, // 'moov'
    0x00, 0x00, 0x00, 0x00, // empty content
  ])
}

/**
 * Creates a minimal WebM buffer for testing
 */
function createTestWebmBuffer(): Uint8Array {
  // WebM magic bytes (EBML header)
  return new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, // EBML element ID
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x14, // size
    0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
    0x42, 0xf7, 0x81, 0x01, // EBMLReadVersion = 1
    0x42, 0xf2, 0x81, 0x04, // EBMLMaxIDLength = 4
    0x42, 0xf3, 0x81, 0x08, // EBMLMaxSizeLength = 8
  ])
}

/**
 * Creates test video metadata
 */
function createTestVideoMetadata(
  width: number,
  height: number,
  duration: number,
  format: VideoFormat = 'mp4'
): VideoMetadata {
  return {
    width,
    height,
    duration,
    format,
    codec: format === 'mp4' ? 'h264' : 'vp9',
    audioCodec: 'aac',
    frameRate: 30,
    bitrate: 5_000_000, // 5 Mbps
    size: width * height * duration * 0.1, // Rough approximation
  }
}

// =============================================================================
// Video Transcoder Factory Tests
// =============================================================================

describe('VideoTranscoder', () => {
  describe('factory', () => {
    it('should create a video transcoder instance', () => {
      const transcoder = createVideoTranscoder()
      expect(transcoder).toBeDefined()
      expect(typeof transcoder.transcode).toBe('function')
      expect(typeof transcoder.getMetadata).toBe('function')
      expect(typeof transcoder.generateThumbnail).toBe('function')
      expect(typeof transcoder.extractClip).toBe('function')
      expect(typeof transcoder.isFormatSupported).toBe('function')
    })

    it('should accept configuration options', () => {
      const transcoder = createVideoTranscoder({
        provider: 'cloudflare-stream',
        accountId: 'test-account',
        apiToken: 'test-token',
        maxDuration: 3600, // 1 hour max
        maxFileSize: 200 * 1024 * 1024, // 200MB max
      })
      expect(transcoder).toBeDefined()
    })

    it('should support multiple provider backends', () => {
      const cfTranscoder = createVideoTranscoder({ provider: 'cloudflare-stream' })
      const muxTranscoder = createVideoTranscoder({ provider: 'mux' })
      const workerTranscoder = createVideoTranscoder({ provider: 'worker-native' })

      expect(cfTranscoder).toBeDefined()
      expect(muxTranscoder).toBeDefined()
      expect(workerTranscoder).toBeDefined()
    })
  })

  // ===========================================================================
  // Format Support Tests
  // ===========================================================================

  describe('format support', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    describe('input format detection', () => {
      it('should detect MP4 format from magic bytes', async () => {
        const input = createTestMp4Buffer()
        const metadata = await transcoder.getMetadata(input)

        expect(metadata.format).toBe('mp4')
      })

      it('should detect WebM format from magic bytes', async () => {
        const input = createTestWebmBuffer()
        const metadata = await transcoder.getMetadata(input)

        expect(metadata.format).toBe('webm')
      })

      it('should detect MOV format', async () => {
        // MOV shares structure with MP4
        const input = new Uint8Array([
          0x00, 0x00, 0x00, 0x14,
          0x66, 0x74, 0x79, 0x70, // ftyp
          0x71, 0x74, 0x20, 0x20, // 'qt  '
          0x00, 0x00, 0x00, 0x00,
          0x71, 0x74, 0x20, 0x20,
        ])
        const metadata = await transcoder.getMetadata(input)

        expect(metadata.format).toBe('mov')
      })

      it('should detect AVI format', async () => {
        // AVI RIFF header
        const input = new Uint8Array([
          0x52, 0x49, 0x46, 0x46, // 'RIFF'
          0x00, 0x00, 0x00, 0x00, // size
          0x41, 0x56, 0x49, 0x20, // 'AVI '
        ])
        const metadata = await transcoder.getMetadata(input)

        expect(metadata.format).toBe('avi')
      })

      it('should detect MKV format', async () => {
        // MKV shares EBML header with WebM but has different DocType
        const input = new Uint8Array([
          0x1a, 0x45, 0xdf, 0xa3, // EBML element ID
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f,
          0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f,
          0x73, 0x6b, 0x61, // DocType = 'matroska'
        ])
        const metadata = await transcoder.getMetadata(input)

        expect(metadata.format).toBe('mkv')
      })
    })

    describe('output format support', () => {
      it('should report MP4 as supported output format', () => {
        expect(transcoder.isFormatSupported('mp4', 'output')).toBe(true)
      })

      it('should report WebM as supported output format', () => {
        expect(transcoder.isFormatSupported('webm', 'output')).toBe(true)
      })

      it('should report HLS as supported output format', () => {
        expect(transcoder.isFormatSupported('hls', 'output')).toBe(true)
      })

      it('should report DASH as supported output format', () => {
        expect(transcoder.isFormatSupported('dash', 'output')).toBe(true)
      })

      it('should report GIF as supported output format', () => {
        // Animated GIF generation from video
        expect(transcoder.isFormatSupported('gif', 'output')).toBe(true)
      })

      it('should report unsupported formats correctly', () => {
        expect(transcoder.isFormatSupported('wmv', 'output')).toBe(false)
        expect(transcoder.isFormatSupported('flv', 'output')).toBe(false)
      })
    })

    describe('codec support', () => {
      it('should report H.264 as supported video codec', () => {
        expect(transcoder.isCodecSupported('h264', 'video')).toBe(true)
      })

      it('should report H.265/HEVC as supported video codec', () => {
        expect(transcoder.isCodecSupported('h265', 'video')).toBe(true)
        expect(transcoder.isCodecSupported('hevc', 'video')).toBe(true)
      })

      it('should report VP8 as supported video codec', () => {
        expect(transcoder.isCodecSupported('vp8', 'video')).toBe(true)
      })

      it('should report VP9 as supported video codec', () => {
        expect(transcoder.isCodecSupported('vp9', 'video')).toBe(true)
      })

      it('should report AV1 as supported video codec', () => {
        expect(transcoder.isCodecSupported('av1', 'video')).toBe(true)
      })

      it('should report AAC as supported audio codec', () => {
        expect(transcoder.isCodecSupported('aac', 'audio')).toBe(true)
      })

      it('should report Opus as supported audio codec', () => {
        expect(transcoder.isCodecSupported('opus', 'audio')).toBe(true)
      })

      it('should report MP3 as supported audio codec', () => {
        expect(transcoder.isCodecSupported('mp3', 'audio')).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Metadata Extraction Tests
  // ===========================================================================

  describe('metadata extraction', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    it('should extract basic video metadata', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata).toBeDefined()
      expect(metadata.width).toBeGreaterThan(0)
      expect(metadata.height).toBeGreaterThan(0)
      expect(metadata.duration).toBeGreaterThanOrEqual(0)
      expect(metadata.format).toBeDefined()
    })

    it('should extract video codec information', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.codec).toBeDefined()
      // Common codecs: h264, h265, vp8, vp9, av1
    })

    it('should extract audio codec information', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.audioCodec).toBeDefined()
      // Common codecs: aac, mp3, opus, vorbis
    })

    it('should extract frame rate', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.frameRate).toBeGreaterThan(0)
      // Common frame rates: 24, 25, 30, 60
    })

    it('should extract bitrate', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.bitrate).toBeGreaterThan(0)
    })

    it('should extract file size', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.size).toBe(input.length)
    })

    it('should extract aspect ratio', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.aspectRatio).toBeDefined()
      // Common aspect ratios: 16:9, 4:3, 1:1, 9:16
    })

    it('should detect HDR content', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.isHDR).toBeDefined()
      expect(typeof metadata.isHDR).toBe('boolean')
    })

    it('should detect rotation metadata', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      expect(metadata.rotation).toBeDefined()
      // 0, 90, 180, 270
    })

    it('should handle videos without audio track', async () => {
      const input = createTestMp4Buffer()
      const metadata = await transcoder.getMetadata(input)

      // audioCodec should be undefined or null for video-only files
      expect(metadata.hasAudio).toBeDefined()
    })
  })

  // ===========================================================================
  // Basic Transcoding Tests
  // ===========================================================================

  describe('basic transcoding', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    describe('format conversion', () => {
      it('should convert MP4 to WebM', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'webm',
        })

        expect(result).toBeDefined()
        expect(result.format).toBe('webm')
        expect(result.data).toBeInstanceOf(Uint8Array)
      })

      it('should convert WebM to MP4', async () => {
        const input = createTestWebmBuffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
        })

        expect(result).toBeDefined()
        expect(result.format).toBe('mp4')
      })

      it('should convert to HLS for streaming', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'hls',
        })

        expect(result).toBeDefined()
        expect(result.format).toBe('hls')
        // HLS produces playlist + segments
        expect(result.playlist).toBeDefined()
        expect(result.segments).toBeDefined()
        expect(result.segments!.length).toBeGreaterThan(0)
      })

      it('should convert to DASH for adaptive streaming', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'dash',
        })

        expect(result).toBeDefined()
        expect(result.format).toBe('dash')
        expect(result.manifest).toBeDefined()
        expect(result.segments).toBeDefined()
      })

      it('should convert video to animated GIF', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'gif',
          startTime: 0,
          endTime: 3, // First 3 seconds
          width: 320,
        })

        expect(result).toBeDefined()
        expect(result.format).toBe('gif')
        // GIF magic number
        expect(result.data[0]).toBe(0x47) // G
        expect(result.data[1]).toBe(0x49) // I
        expect(result.data[2]).toBe(0x46) // F
      })
    })

    describe('codec conversion', () => {
      it('should transcode to H.264 codec', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          videoCodec: 'h264',
        })

        expect(result).toBeDefined()
        expect(result.metadata?.codec).toBe('h264')
      })

      it('should transcode to H.265/HEVC codec', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          videoCodec: 'h265',
        })

        expect(result).toBeDefined()
        expect(result.metadata?.codec).toBe('h265')
      })

      it('should transcode to VP9 codec', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'webm',
          videoCodec: 'vp9',
        })

        expect(result).toBeDefined()
        expect(result.metadata?.codec).toBe('vp9')
      })

      it('should transcode to AV1 codec', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          videoCodec: 'av1',
        })

        expect(result).toBeDefined()
        expect(result.metadata?.codec).toBe('av1')
      })

      it('should transcode audio to AAC', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          audioCodec: 'aac',
        })

        expect(result).toBeDefined()
        expect(result.metadata?.audioCodec).toBe('aac')
      })

      it('should transcode audio to Opus', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'webm',
          audioCodec: 'opus',
        })

        expect(result).toBeDefined()
        expect(result.metadata?.audioCodec).toBe('opus')
      })
    })

    describe('resolution scaling', () => {
      it('should scale down to 1080p', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 1920,
          height: 1080,
        })

        expect(result.metadata?.width).toBeLessThanOrEqual(1920)
        expect(result.metadata?.height).toBeLessThanOrEqual(1080)
      })

      it('should scale down to 720p', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 1280,
          height: 720,
        })

        expect(result.metadata?.width).toBeLessThanOrEqual(1280)
        expect(result.metadata?.height).toBeLessThanOrEqual(720)
      })

      it('should scale down to 480p', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 854,
          height: 480,
        })

        expect(result.metadata?.width).toBeLessThanOrEqual(854)
        expect(result.metadata?.height).toBeLessThanOrEqual(480)
      })

      it('should scale down to 360p', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 640,
          height: 360,
        })

        expect(result.metadata?.width).toBeLessThanOrEqual(640)
        expect(result.metadata?.height).toBeLessThanOrEqual(360)
      })

      it('should preserve aspect ratio by default', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 1280,
        })

        expect(result).toBeDefined()
        // Height should be calculated based on original aspect ratio
        expect(result.metadata?.width).toBe(1280)
      })

      it('should support fit modes like image transformer', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 1280,
          height: 720,
          fit: 'cover', // Crop to fill
        })

        expect(result.metadata?.width).toBe(1280)
        expect(result.metadata?.height).toBe(720)
      })

      it('should support padding to fill dimensions', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 1920,
          height: 1080,
          fit: 'pad',
          background: '#000000', // Black letterboxing
        })

        expect(result.metadata?.width).toBe(1920)
        expect(result.metadata?.height).toBe(1080)
      })

      it('should not upscale by default', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          width: 4000,
          height: 3000,
        })

        // Should maintain original resolution if smaller
        expect(result.metadata?.width).toBeLessThanOrEqual(4000)
      })
    })

    describe('bitrate control', () => {
      it('should transcode with target bitrate', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          videoBitrate: 2_000_000, // 2 Mbps
        })

        expect(result).toBeDefined()
        // Bitrate may be close but not exact
        expect(result.metadata?.bitrate).toBeLessThanOrEqual(2_500_000)
      })

      it('should transcode with maximum bitrate (VBR)', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          videoBitrate: 2_000_000,
          bitrateMode: 'vbr',
          maxBitrate: 4_000_000,
        })

        expect(result).toBeDefined()
      })

      it('should transcode with constant bitrate (CBR)', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          videoBitrate: 2_000_000,
          bitrateMode: 'cbr',
        })

        expect(result).toBeDefined()
      })

      it('should set audio bitrate', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          audioBitrate: 128_000, // 128 kbps
        })

        expect(result).toBeDefined()
      })
    })

    describe('frame rate control', () => {
      it('should convert to 30fps', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          frameRate: 30,
        })

        expect(result.metadata?.frameRate).toBe(30)
      })

      it('should convert to 24fps (film)', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          frameRate: 24,
        })

        expect(result.metadata?.frameRate).toBe(24)
      })

      it('should convert to 60fps', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          frameRate: 60,
        })

        expect(result.metadata?.frameRate).toBe(60)
      })
    })
  })

  // ===========================================================================
  // Thumbnail Generation Tests
  // ===========================================================================

  describe('thumbnail generation', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    it('should generate thumbnail at specific time', async () => {
      const input = createTestMp4Buffer()
      const thumbnail = await transcoder.generateThumbnail(input, {
        time: 5, // 5 seconds into video
        width: 320,
        height: 180,
        format: 'jpeg',
      })

      expect(thumbnail).toBeDefined()
      expect(thumbnail.data).toBeInstanceOf(Uint8Array)
      expect(thumbnail.format).toBe('jpeg')
    })

    it('should generate thumbnail at percentage position', async () => {
      const input = createTestMp4Buffer()
      const thumbnail = await transcoder.generateThumbnail(input, {
        position: '50%', // Middle of video
        width: 640,
        format: 'webp',
      })

      expect(thumbnail).toBeDefined()
      expect(thumbnail.format).toBe('webp')
    })

    it('should generate multiple thumbnails (sprite sheet)', async () => {
      const input = createTestMp4Buffer()
      const thumbnails = await transcoder.generateThumbnails(input, {
        count: 10, // 10 evenly spaced thumbnails
        width: 160,
        height: 90,
        format: 'jpeg',
      })

      expect(thumbnails).toBeDefined()
      expect(thumbnails.length).toBe(10)
    })

    it('should generate thumbnail grid/sprite', async () => {
      const input = createTestMp4Buffer()
      const sprite = await transcoder.generateSprite(input, {
        columns: 5,
        rows: 4, // 20 thumbnails total
        thumbWidth: 160,
        thumbHeight: 90,
        format: 'jpeg',
      })

      expect(sprite).toBeDefined()
      expect(sprite.data).toBeInstanceOf(Uint8Array)
      expect(sprite.width).toBe(160 * 5)
      expect(sprite.height).toBe(90 * 4)
    })

    it('should respect quality settings', async () => {
      const input = createTestMp4Buffer()
      const lowQuality = await transcoder.generateThumbnail(input, {
        time: 1,
        format: 'jpeg',
        quality: 50,
      })
      const highQuality = await transcoder.generateThumbnail(input, {
        time: 1,
        format: 'jpeg',
        quality: 95,
      })

      expect(lowQuality.data.length).toBeLessThan(highQuality.data.length)
    })

    it('should auto-detect best frame for thumbnail', async () => {
      const input = createTestMp4Buffer()
      const thumbnail = await transcoder.generateThumbnail(input, {
        time: 'auto', // Find visually interesting frame
        width: 320,
        format: 'jpeg',
      })

      expect(thumbnail).toBeDefined()
    })
  })

  // ===========================================================================
  // Video Clipping Tests
  // ===========================================================================

  describe('video clipping', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    it('should extract clip with start and end time', async () => {
      const input = createTestMp4Buffer()
      const clip = await transcoder.extractClip(input, {
        startTime: 10,
        endTime: 20,
      })

      expect(clip).toBeDefined()
      expect(clip.metadata?.duration).toBeCloseTo(10, 0.5)
    })

    it('should extract clip with start time and duration', async () => {
      const input = createTestMp4Buffer()
      const clip = await transcoder.extractClip(input, {
        startTime: 5,
        duration: 15,
      })

      expect(clip).toBeDefined()
      expect(clip.metadata?.duration).toBeCloseTo(15, 0.5)
    })

    it('should extract clip without re-encoding (fast mode)', async () => {
      const input = createTestMp4Buffer()
      const clip = await transcoder.extractClip(input, {
        startTime: 0,
        endTime: 10,
        reencode: false, // Fast clip at keyframes
      })

      expect(clip).toBeDefined()
      // Duration may be slightly different due to keyframe alignment
    })

    it('should extract clip with re-encoding for precise timing', async () => {
      const input = createTestMp4Buffer()
      const clip = await transcoder.extractClip(input, {
        startTime: 5.5, // Non-keyframe start
        endTime: 15.3, // Non-keyframe end
        reencode: true,
      })

      expect(clip).toBeDefined()
      expect(clip.metadata?.duration).toBeCloseTo(9.8, 0.1)
    })

    it('should clip and transcode in single operation', async () => {
      const input = createTestMp4Buffer()
      const clip = await transcoder.extractClip(input, {
        startTime: 0,
        endTime: 5,
        outputFormat: 'webm',
        videoCodec: 'vp9',
      })

      expect(clip).toBeDefined()
      expect(clip.format).toBe('webm')
    })
  })

  // ===========================================================================
  // Async Job Tests (for large videos)
  // ===========================================================================

  describe('async transcoding jobs', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    it('should create async transcode job', async () => {
      const input = createTestMp4Buffer()
      const job = await transcoder.createJob(input, {
        outputFormat: 'webm',
      })

      expect(job).toBeDefined()
      expect(job.id).toBeDefined()
      expect(job.status).toBe('pending')
    })

    it('should get job status', async () => {
      const input = createTestMp4Buffer()
      const job = await transcoder.createJob(input, {
        outputFormat: 'webm',
      })

      const status = await transcoder.getJobStatus(job.id)

      expect(status).toBeDefined()
      expect(['pending', 'processing', 'completed', 'failed']).toContain(status.status)
    })

    it('should get job progress', async () => {
      const input = createTestMp4Buffer()
      const job = await transcoder.createJob(input, {
        outputFormat: 'webm',
      })

      const status = await transcoder.getJobStatus(job.id)

      expect(status.progress).toBeDefined()
      expect(status.progress).toBeGreaterThanOrEqual(0)
      expect(status.progress).toBeLessThanOrEqual(100)
    })

    it('should cancel pending job', async () => {
      const input = createTestMp4Buffer()
      const job = await transcoder.createJob(input, {
        outputFormat: 'webm',
      })

      const cancelled = await transcoder.cancelJob(job.id)

      expect(cancelled).toBe(true)
      const status = await transcoder.getJobStatus(job.id)
      expect(status.status).toBe('cancelled')
    })

    it('should get completed job result', async () => {
      const input = createTestMp4Buffer()
      const job = await transcoder.createJob(input, {
        outputFormat: 'webm',
      })

      // Simulate waiting for completion
      const result = await transcoder.waitForJob(job.id, {
        timeout: 60000, // 60 second timeout
        pollInterval: 1000,
      })

      expect(result).toBeDefined()
      expect(result.status).toBe('completed')
      expect(result.output).toBeDefined()
    })

    it('should support webhook callback on completion', async () => {
      const input = createTestMp4Buffer()
      const job = await transcoder.createJob(input, {
        outputFormat: 'webm',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'test-secret',
      })

      expect(job).toBeDefined()
      expect(job.webhookUrl).toBe('https://example.com/webhook')
    })

    it('should support output to R2/S3 storage', async () => {
      const input = createTestMp4Buffer()
      const job = await transcoder.createJob(input, {
        outputFormat: 'webm',
        outputDestination: {
          type: 'r2',
          bucket: 'videos',
          key: 'transcoded/video.webm',
        },
      })

      expect(job).toBeDefined()
      expect(job.outputDestination).toBeDefined()
    })
  })

  // ===========================================================================
  // Workers Runtime Limitations Tests
  // ===========================================================================

  describe('Workers runtime limitations', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    describe('native worker-based operations', () => {
      it('should indicate which operations are native vs delegated', () => {
        const capabilities = transcoder.getCapabilities()

        expect(capabilities).toBeDefined()
        expect(capabilities.nativeOperations).toContain('metadata')
        expect(capabilities.nativeOperations).toContain('thumbnail')
        expect(capabilities.delegatedOperations).toContain('transcode')
      })

      it('should support metadata extraction natively via WebCodecs', async () => {
        // WebCodecs API can be used for limited operations
        const input = createTestMp4Buffer()
        const metadata = await transcoder.getMetadata(input, {
          method: 'native', // Use WebCodecs if available
        })

        expect(metadata).toBeDefined()
      })

      it('should throw VideoUnsupportedError for native transcode in Workers', async () => {
        const nativeTranscoder = createVideoTranscoder({
          provider: 'worker-native',
          allowDelegation: false,
        })

        const input = createTestMp4Buffer()

        await expect(
          nativeTranscoder.transcode(input, { outputFormat: 'webm' })
        ).rejects.toThrow(VideoUnsupportedError)
      })
    })

    describe('file size limits', () => {
      it('should enforce maximum file size', async () => {
        const transcoder = createVideoTranscoder({
          maxFileSize: 100 * 1024 * 1024, // 100MB
        })

        // Create a buffer that reports as larger than limit
        const largeBuffer = new Uint8Array(1024) // Small actual buffer
        // Mock or set metadata to indicate larger size

        await expect(
          transcoder.transcode(largeBuffer, { outputFormat: 'webm' })
        ).rejects.toThrow(/file size|too large/i)
      })

      it('should enforce maximum duration', async () => {
        const transcoder = createVideoTranscoder({
          maxDuration: 300, // 5 minutes
        })

        const input = createTestMp4Buffer()
        // Assume input metadata shows > 5 min duration

        await expect(
          transcoder.transcode(input, { outputFormat: 'webm' })
        ).rejects.toThrow(/duration|too long/i)
      })
    })

    describe('delegation to external services', () => {
      it('should delegate to Cloudflare Stream when configured', async () => {
        const transcoder = createVideoTranscoder({
          provider: 'cloudflare-stream',
          accountId: 'test-account',
          apiToken: 'test-token',
        })

        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'hls',
        })

        expect(result.provider).toBe('cloudflare-stream')
      })

      it('should delegate to Mux when configured', async () => {
        const transcoder = createVideoTranscoder({
          provider: 'mux',
          tokenId: 'test-token-id',
          tokenSecret: 'test-token-secret',
        })

        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'hls',
        })

        expect(result.provider).toBe('mux')
      })

      it('should support fallback providers', async () => {
        const transcoder = createVideoTranscoder({
          provider: 'cloudflare-stream',
          fallbackProviders: ['mux', 'aws-mediaconvert'],
        })

        // Primary provider failure should trigger fallback
        expect(transcoder).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    it('should reject invalid video data', async () => {
      const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03])

      await expect(
        transcoder.transcode(invalidData, { outputFormat: 'webm' })
      ).rejects.toThrow(VideoTranscodeError)
    })

    it('should reject empty buffer', async () => {
      const emptyData = new Uint8Array(0)

      await expect(
        transcoder.transcode(emptyData, { outputFormat: 'webm' })
      ).rejects.toThrow(/empty|invalid/i)
    })

    it('should reject unsupported input format', async () => {
      // Create mock WMV header
      const wmvData = new Uint8Array([
        0x30, 0x26, 0xb2, 0x75, // ASF header GUID start
      ])

      await expect(
        transcoder.transcode(wmvData, { outputFormat: 'webm' })
      ).rejects.toThrow(/unsupported.*format/i)
    })

    it('should reject unsupported output format', async () => {
      const input = createTestMp4Buffer()

      await expect(
        transcoder.transcode(input, { outputFormat: 'wmv' as VideoFormat })
      ).rejects.toThrow(/unsupported.*format/i)
    })

    it('should handle corrupted video data gracefully', async () => {
      // Valid MP4 header but corrupted body
      const corruptedData = new Uint8Array([
        0x00, 0x00, 0x00, 0x14,
        0x66, 0x74, 0x79, 0x70,
        0x69, 0x73, 0x6f, 0x6d,
        // Garbage after header
        0xff, 0xff, 0xff, 0xff,
      ])

      await expect(
        transcoder.transcode(corruptedData, { outputFormat: 'webm' })
      ).rejects.toThrow(/corrupted|invalid|truncated/i)
    })

    it('should provide detailed error information', async () => {
      const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03])

      try {
        await transcoder.transcode(invalidData, { outputFormat: 'webm' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VideoTranscodeError)
        const transcodeError = error as VideoTranscodeError
        expect(transcodeError.code).toBeDefined()
        expect(transcodeError.message).toBeDefined()
      }
    })

    it('should timeout on long-running operations', async () => {
      const input = createTestMp4Buffer()

      await expect(
        transcoder.transcode(input, {
          outputFormat: 'webm',
          timeout: 1, // 1ms timeout - should fail
        })
      ).rejects.toThrow(/timeout/i)
    }, 5000)

    it('should handle provider errors gracefully', async () => {
      const transcoder = createVideoTranscoder({
        provider: 'cloudflare-stream',
        accountId: 'invalid-account',
        apiToken: 'invalid-token',
      })

      const input = createTestMp4Buffer()

      await expect(
        transcoder.transcode(input, { outputFormat: 'hls' })
      ).rejects.toThrow(/authentication|unauthorized|provider/i)
    })
  })

  // ===========================================================================
  // Advanced Transcoding Options Tests
  // ===========================================================================

  describe('advanced transcoding options', () => {
    let transcoder: VideoTranscoder

    beforeEach(() => {
      transcoder = createTestVideoTranscoder()
    })

    describe('video filters', () => {
      it('should apply rotation filter', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          rotate: 90,
        })

        expect(result).toBeDefined()
        // Width and height should be swapped
      })

      it('should apply crop filter', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          crop: {
            x: 100,
            y: 50,
            width: 800,
            height: 600,
          },
        })

        expect(result.metadata?.width).toBe(800)
        expect(result.metadata?.height).toBe(600)
      })

      it('should apply deinterlace filter', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          deinterlace: true,
        })

        expect(result).toBeDefined()
      })

      it('should apply noise reduction', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          denoise: 'light', // light, medium, strong
        })

        expect(result).toBeDefined()
      })
    })

    describe('audio options', () => {
      it('should remove audio track', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          removeAudio: true,
        })

        expect(result.metadata?.hasAudio).toBe(false)
      })

      it('should normalize audio levels', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          normalizeAudio: true,
        })

        expect(result).toBeDefined()
      })

      it('should adjust audio volume', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          audioVolume: 1.5, // 150% volume
        })

        expect(result).toBeDefined()
      })

      it('should set audio sample rate', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          audioSampleRate: 44100,
        })

        expect(result).toBeDefined()
      })

      it('should set audio channels', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          audioChannels: 2, // Stereo
        })

        expect(result).toBeDefined()
      })
    })

    describe('multi-resolution output', () => {
      it('should generate multiple resolution variants', async () => {
        const input = createTestMp4Buffer()
        const result = await transcoder.transcodeMultiple(input, {
          variants: [
            { width: 1920, height: 1080, videoBitrate: 5_000_000 }, // 1080p
            { width: 1280, height: 720, videoBitrate: 2_500_000 },  // 720p
            { width: 854, height: 480, videoBitrate: 1_000_000 },   // 480p
            { width: 640, height: 360, videoBitrate: 500_000 },     // 360p
          ],
          outputFormat: 'hls',
        })

        expect(result).toBeDefined()
        expect(result.variants).toBeDefined()
        expect(result.variants!.length).toBe(4)
        expect(result.masterPlaylist).toBeDefined()
      })
    })

    describe('watermark/overlay', () => {
      it('should add image watermark', async () => {
        const input = createTestMp4Buffer()
        const watermarkImage = new Uint8Array([/* PNG data */])

        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          watermark: {
            image: watermarkImage,
            position: 'bottom-right',
            opacity: 0.7,
            padding: 20,
          },
        })

        expect(result).toBeDefined()
      })

      it('should add text watermark', async () => {
        const input = createTestMp4Buffer()

        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          textOverlay: {
            text: 'Copyright 2024',
            position: 'bottom-left',
            fontSize: 24,
            color: '#ffffff',
            opacity: 0.5,
          },
        })

        expect(result).toBeDefined()
      })
    })

    describe('subtitle/caption handling', () => {
      it('should burn in subtitles', async () => {
        const input = createTestMp4Buffer()
        const subtitles = 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello World'

        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          subtitles: {
            content: subtitles,
            format: 'vtt',
            burn: true, // Burn into video
          },
        })

        expect(result).toBeDefined()
      })

      it('should embed subtitles as separate track', async () => {
        const input = createTestMp4Buffer()
        const subtitles = 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello World'

        const result = await transcoder.transcode(input, {
          outputFormat: 'mp4',
          subtitles: {
            content: subtitles,
            format: 'vtt',
            burn: false, // Embed as track
            language: 'en',
          },
        })

        expect(result).toBeDefined()
      })
    })
  })
})
