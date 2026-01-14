/**
 * @dotdo/twilio/voice - Twilio Voice API Compatibility Tests
 *
 * TDD RED phase: Tests for Twilio Voice service.
 *
 * Test coverage:
 * 1. Make/receive calls
 * 2. TwiML response generation
 * 3. Call recording
 * 4. Call forwarding
 * 5. Conference calls
 * 6. IVR flows
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will fail until implemented - TDD RED phase
import {
  TwilioVoice,
  TwilioVoiceError,
  createVoiceClient,
  VoiceResponse,
  type Call,
  type CallCreateParams,
  type CallUpdateParams,
  type CallListParams,
  type CallStatus,
  type Recording,
  type RecordingCreateParams,
  type Conference,
  type ConferenceParticipant,
  type TwilioVoiceConfig,
  type VoiceWebhookPayload,
  type GatherInput,
} from '../voice'

// ============================================================================
// MOCK SETUP
// ============================================================================

const mockFetch = vi.fn()

// Helper to create mock call response
function createMockCall(overrides?: Partial<Call>): Call {
  const now = new Date().toISOString()
  return {
    sid: 'CA' + 'a'.repeat(32),
    account_sid: 'AC' + 'b'.repeat(32),
    annotation: null,
    answered_by: null,
    api_version: '2010-04-01',
    caller_name: null,
    date_created: now,
    date_updated: now,
    direction: 'outbound-api',
    duration: null,
    end_time: null,
    forwarded_from: null,
    from: '+15017122661',
    from_formatted: '(501) 712-2661',
    group_sid: null,
    parent_call_sid: null,
    phone_number_sid: 'PN' + 'c'.repeat(32),
    price: null,
    price_unit: 'USD',
    queue_time: '0',
    start_time: null,
    status: 'queued',
    to: '+15558675310',
    to_formatted: '(555) 867-5310',
    trunk_sid: null,
    uri: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Calls/CA${'a'.repeat(32)}.json`,
    subresource_uris: {
      recordings: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Calls/CA${'a'.repeat(32)}/Recordings.json`,
      notifications: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Calls/CA${'a'.repeat(32)}/Notifications.json`,
    },
    ...overrides,
  }
}

// Helper to create mock recording response
function createMockRecording(overrides?: Partial<Recording>): Recording {
  const now = new Date().toISOString()
  return {
    sid: 'RE' + 'a'.repeat(32),
    account_sid: 'AC' + 'b'.repeat(32),
    call_sid: 'CA' + 'c'.repeat(32),
    conference_sid: null,
    date_created: now,
    date_updated: now,
    duration: '60',
    channels: 1,
    source: 'RecordVerb',
    error_code: null,
    status: 'completed',
    start_time: now,
    price: '-0.0025',
    price_unit: 'USD',
    media_url: `https://api.twilio.com/2010-04-01/Accounts/AC${'b'.repeat(32)}/Recordings/RE${'a'.repeat(32)}.mp3`,
    uri: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Recordings/RE${'a'.repeat(32)}.json`,
    encryption_details: null,
    ...overrides,
  }
}

// Helper to create mock conference response
function createMockConference(overrides?: Partial<Conference>): Conference {
  const now = new Date().toISOString()
  return {
    sid: 'CF' + 'a'.repeat(32),
    account_sid: 'AC' + 'b'.repeat(32),
    friendly_name: 'TestConference',
    date_created: now,
    date_updated: now,
    status: 'in-progress',
    region: 'us1',
    reason_conference_ended: null,
    call_sid_ending_conference: null,
    subresource_uris: {
      participants: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Conferences/CF${'a'.repeat(32)}/Participants.json`,
      recordings: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Conferences/CF${'a'.repeat(32)}/Recordings.json`,
    },
    uri: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Conferences/CF${'a'.repeat(32)}.json`,
    ...overrides,
  }
}

// Helper to create mock conference participant
function createMockParticipant(overrides?: Partial<ConferenceParticipant>): ConferenceParticipant {
  const now = new Date().toISOString()
  return {
    account_sid: 'AC' + 'b'.repeat(32),
    call_sid: 'CA' + 'c'.repeat(32),
    call_sid_to_coach: null,
    coaching: false,
    conference_sid: 'CF' + 'a'.repeat(32),
    date_created: now,
    date_updated: now,
    end_conference_on_exit: false,
    hold: false,
    label: null,
    muted: false,
    start_conference_on_enter: true,
    status: 'connected',
    uri: `/2010-04-01/Accounts/AC${'b'.repeat(32)}/Conferences/CF${'a'.repeat(32)}/Participants/CA${'c'.repeat(32)}.json`,
    ...overrides,
  }
}

// Helper to create mock API response
function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Helper to create mock error response
function createMockErrorResponse(
  code: number,
  message: string,
  status = 400
): Response {
  return createMockResponse(
    {
      code,
      message,
      more_info: `https://www.twilio.com/docs/errors/${code}`,
      status,
    },
    status
  )
}

describe('Twilio Voice API', () => {
  const TEST_ACCOUNT_SID = 'AC' + 'test'.repeat(8)
  const TEST_AUTH_TOKEN = 'auth_token_' + 'test'.repeat(4)

  let voice: TwilioVoice

  beforeEach(() => {
    vi.clearAllMocks()
    voice = new TwilioVoice({
      accountSid: TEST_ACCOUNT_SID,
      authToken: TEST_AUTH_TOKEN,
      fetch: mockFetch,
      autoRetry: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // CLIENT CREATION
  // ============================================================================

  describe('TwilioVoice client', () => {
    it('should create a client with required credentials', () => {
      const client = new TwilioVoice({
        accountSid: 'AC123',
        authToken: 'token123',
      })
      expect(client).toBeDefined()
    })

    it('should throw error when accountSid is missing', () => {
      expect(
        () =>
          new TwilioVoice({
            accountSid: '',
            authToken: 'token123',
          })
      ).toThrow('accountSid is required')
    })

    it('should throw error when authToken is missing', () => {
      expect(
        () =>
          new TwilioVoice({
            accountSid: 'AC123',
            authToken: '',
          })
      ).toThrow('authToken is required')
    })

    it('should create client with factory function', () => {
      const client = createVoiceClient({
        accountSid: 'AC123',
        authToken: 'token123',
      })
      expect(client).toBeInstanceOf(TwilioVoice)
    })

    it('should accept custom configuration options', () => {
      const client = new TwilioVoice({
        accountSid: 'AC123',
        authToken: 'token123',
        region: 'au1',
        edge: 'sydney',
        timeout: 60000,
        autoRetry: true,
        maxRetries: 5,
      })
      expect(client).toBeDefined()
    })
  })

  // ============================================================================
  // 1. MAKE/RECEIVE CALLS
  // ============================================================================

  describe('Make outbound calls', () => {
    it('should create an outbound call with URL', async () => {
      const mockCall = createMockCall({ status: 'queued' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall, 201))

      const call = await voice.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        url: 'https://example.com/twiml',
      })

      expect(call.sid).toMatch(/^CA/)
      expect(call.to).toBe('+15558675310')
      expect(call.from).toBe('+15017122661')
      expect(call.status).toBe('queued')
      expect(call.direction).toBe('outbound-api')
    })

    it('should create an outbound call with inline TwiML', async () => {
      const mockCall = createMockCall({ status: 'queued' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall, 201))

      const call = await voice.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        twiml: '<Response><Say>Hello!</Say></Response>',
      })

      expect(call.sid).toMatch(/^CA/)
      expect(call.status).toBe('queued')
    })

    it('should throw error when to number is missing', async () => {
      await expect(
        voice.calls.create({
          to: '',
          from: '+15017122661',
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow(TwilioVoiceError)
    })

    it('should throw error when from number is missing', async () => {
      await expect(
        voice.calls.create({
          to: '+15558675310',
          from: '',
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow(TwilioVoiceError)
    })

    it('should throw error when neither url nor twiml is provided', async () => {
      await expect(
        voice.calls.create({
          to: '+15558675310',
          from: '+15017122661',
        })
      ).rejects.toThrow(TwilioVoiceError)
    })

    it('should support status callback configuration', async () => {
      const mockCall = createMockCall()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall, 201))

      await voice.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        url: 'https://example.com/twiml',
        statusCallback: 'https://example.com/status',
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('StatusCallback'),
        })
      )
    })

    it('should support machine detection', async () => {
      const mockCall = createMockCall()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall, 201))

      await voice.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        url: 'https://example.com/twiml',
        machineDetection: 'Enable',
        machineDetectionTimeout: 30,
        asyncAmd: true,
        asyncAmdStatusCallback: 'https://example.com/amd',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('MachineDetection=Enable'),
        })
      )
    })

    it('should support SIP endpoint calls', async () => {
      const mockCall = createMockCall({ to: 'sip:alice@example.com' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall, 201))

      const call = await voice.calls.create({
        to: 'sip:alice@example.com',
        from: '+15017122661',
        url: 'https://example.com/twiml',
        sipAuthUsername: 'user',
        sipAuthPassword: 'pass',
      })

      expect(call.to).toBe('sip:alice@example.com')
    })

    it('should support client endpoint calls', async () => {
      const mockCall = createMockCall({ to: 'client:alice' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall, 201))

      const call = await voice.calls.create({
        to: 'client:alice',
        from: '+15017122661',
        url: 'https://example.com/twiml',
      })

      expect(call.to).toBe('client:alice')
    })
  })

  describe('Receive inbound calls', () => {
    it('should parse inbound call webhook payload', () => {
      const payload: VoiceWebhookPayload = {
        CallSid: 'CA123',
        AccountSid: 'AC123',
        From: '+15558675310',
        To: '+15017122661',
        CallStatus: 'ringing',
        Direction: 'inbound',
        ApiVersion: '2010-04-01',
        CallerName: 'John Doe',
      }

      const call = voice.parseWebhook(payload)
      expect(call.sid).toBe('CA123')
      expect(call.from).toBe('+15558675310')
      expect(call.direction).toBe('inbound')
      expect(call.callerName).toBe('John Doe')
    })

    it('should handle gather digits from webhook', () => {
      const payload: VoiceWebhookPayload = {
        CallSid: 'CA123',
        AccountSid: 'AC123',
        From: '+15558675310',
        To: '+15017122661',
        CallStatus: 'in-progress',
        Direction: 'inbound',
        ApiVersion: '2010-04-01',
        Digits: '1234',
      }

      const result = voice.parseWebhook(payload)
      expect(result.digits).toBe('1234')
    })

    it('should handle speech recognition from webhook', () => {
      const payload: VoiceWebhookPayload = {
        CallSid: 'CA123',
        AccountSid: 'AC123',
        From: '+15558675310',
        To: '+15017122661',
        CallStatus: 'in-progress',
        Direction: 'inbound',
        ApiVersion: '2010-04-01',
        SpeechResult: 'Hello world',
        Confidence: '0.95',
      }

      const result = voice.parseWebhook(payload)
      expect(result.speechResult).toBe('Hello world')
      expect(result.confidence).toBe(0.95)
    })
  })

  describe('Manage calls', () => {
    it('should fetch a call by SID', async () => {
      const mockCall = createMockCall()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall))

      const call = await voice.calls('CA123').fetch()

      expect(call.sid).toBe(mockCall.sid)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/Calls/CA123'),
        expect.any(Object)
      )
    })

    it('should update a call in progress', async () => {
      const mockCall = createMockCall({ status: 'in-progress' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall))

      const call = await voice.calls('CA123').update({
        url: 'https://example.com/new-twiml',
        method: 'POST',
      })

      expect(call.status).toBe('in-progress')
    })

    it('should cancel a queued call', async () => {
      const mockCall = createMockCall({ status: 'canceled' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall))

      const call = await voice.calls('CA123').update({
        status: 'canceled',
      })

      expect(call.status).toBe('canceled')
    })

    it('should complete an in-progress call', async () => {
      const mockCall = createMockCall({ status: 'completed' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall))

      const call = await voice.calls('CA123').update({
        status: 'completed',
      })

      expect(call.status).toBe('completed')
    })

    it('should list calls with filters', async () => {
      const mockCalls = [createMockCall(), createMockCall()]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ calls: mockCalls })
      )

      const calls = await voice.calls.list({
        status: 'completed',
        to: '+15558675310',
        from: '+15017122661',
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-12-31'),
        pageSize: 50,
      })

      expect(calls).toHaveLength(2)
    })

    it('should handle call not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(20404, 'Call not found', 404)
      )

      await expect(voice.calls('CA_nonexistent').fetch()).rejects.toThrow(
        TwilioVoiceError
      )
    })
  })

  // ============================================================================
  // 2. TWIML RESPONSE GENERATION
  // ============================================================================

  describe('TwiML Response Generation', () => {
    describe('VoiceResponse builder', () => {
      it('should create empty response', () => {
        const response = new VoiceResponse()
        expect(response.toString()).toBe(
          '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
        )
      })

      it('should generate Say verb', () => {
        const response = new VoiceResponse()
        response.say('Hello, world!')

        expect(response.toString()).toContain('<Say>Hello, world!</Say>')
      })

      it('should generate Say with voice options', () => {
        const response = new VoiceResponse()
        response.say('Hello!', {
          voice: 'alice',
          language: 'en-US',
          loop: 2,
        })

        expect(response.toString()).toContain('voice="alice"')
        expect(response.toString()).toContain('language="en-US"')
        expect(response.toString()).toContain('loop="2"')
      })

      it('should generate Play verb', () => {
        const response = new VoiceResponse()
        response.play('https://example.com/audio.mp3')

        expect(response.toString()).toContain(
          '<Play>https://example.com/audio.mp3</Play>'
        )
      })

      it('should generate Play with DTMF digits', () => {
        const response = new VoiceResponse()
        response.play({ digits: 'wwww1928' })

        expect(response.toString()).toContain('digits="wwww1928"')
      })

      it('should generate Pause verb', () => {
        const response = new VoiceResponse()
        response.pause({ length: 5 })

        expect(response.toString()).toContain('<Pause length="5"/>')
      })

      it('should generate Hangup verb', () => {
        const response = new VoiceResponse()
        response.hangup()

        expect(response.toString()).toContain('<Hangup/>')
      })

      it('should generate Reject verb', () => {
        const response = new VoiceResponse()
        response.reject({ reason: 'busy' })

        expect(response.toString()).toContain('<Reject reason="busy"/>')
      })

      it('should generate Redirect verb', () => {
        const response = new VoiceResponse()
        response.redirect('https://example.com/twiml', { method: 'POST' })

        expect(response.toString()).toContain(
          '<Redirect method="POST">https://example.com/twiml</Redirect>'
        )
      })

      it('should escape XML special characters', () => {
        const response = new VoiceResponse()
        response.say('Hello <world> & "friends"!')

        const xml = response.toString()
        expect(xml).toContain('&lt;world&gt;')
        expect(xml).toContain('&amp;')
        expect(xml).toContain('&quot;')
      })
    })

    describe('Gather verb', () => {
      it('should generate Gather with action', () => {
        const response = new VoiceResponse()
        const gather = response.gather({
          action: '/handle-key',
          method: 'POST',
          numDigits: 1,
          timeout: 10,
        })

        expect(response.toString()).toContain('action="/handle-key"')
        expect(response.toString()).toContain('numDigits="1"')
      })

      it('should generate Gather with nested Say', () => {
        const response = new VoiceResponse()
        const gather = response.gather({ numDigits: 1 })
        gather.say('Press 1 for sales, 2 for support')

        expect(response.toString()).toContain(
          '<Gather numDigits="1"><Say>Press 1 for sales, 2 for support</Say></Gather>'
        )
      })

      it('should generate Gather with speech input', () => {
        const response = new VoiceResponse()
        response.gather({
          input: ['speech', 'dtmf'],
          speechTimeout: 'auto',
          hints: 'sales, support, billing',
          language: 'en-US',
        })

        expect(response.toString()).toContain('input="speech dtmf"')
        expect(response.toString()).toContain('speechTimeout="auto"')
      })

      it('should generate Gather with partial results callback', () => {
        const response = new VoiceResponse()
        response.gather({
          input: ['speech'],
          partialResultCallback: 'https://example.com/partial',
          partialResultCallbackMethod: 'POST',
        })

        expect(response.toString()).toContain(
          'partialResultCallback="https://example.com/partial"'
        )
      })

      it('should generate Gather with finish on key', () => {
        const response = new VoiceResponse()
        response.gather({
          finishOnKey: '#',
          timeout: 5,
        })

        expect(response.toString()).toContain('finishOnKey="#"')
      })
    })

    describe('Dial verb', () => {
      it('should generate Dial with phone number', () => {
        const response = new VoiceResponse()
        response.dial('+15558675310')

        expect(response.toString()).toContain('<Dial>+15558675310</Dial>')
      })

      it('should generate Dial with timeout and caller ID', () => {
        const response = new VoiceResponse()
        response.dial('+15558675310', {
          timeout: 30,
          callerId: '+15017122661',
          timeLimit: 3600,
        })

        expect(response.toString()).toContain('timeout="30"')
        expect(response.toString()).toContain('callerId="+15017122661"')
      })

      it('should generate Dial with Number noun', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.number('+15558675310', {
          statusCallback: 'https://example.com/status',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        })

        expect(response.toString()).toContain('<Number')
        expect(response.toString()).toContain('+15558675310')
      })

      it('should generate Dial with Client noun', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.client('alice')

        expect(response.toString()).toContain('<Client>alice</Client>')
      })

      it('should generate Dial with SIP noun', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.sip('sip:alice@example.com', {
          username: 'user',
          password: 'pass',
        })

        expect(response.toString()).toContain('<Sip')
        expect(response.toString()).toContain('sip:alice@example.com')
      })

      it('should generate Dial with Queue noun', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.queue('support', {
          url: 'https://example.com/about-to-connect',
        })

        expect(response.toString()).toContain('<Queue')
        expect(response.toString()).toContain('support')
      })

      it('should generate Dial with simultaneous ringing', () => {
        const response = new VoiceResponse()
        const dial = response.dial({ timeout: 20 })
        dial.number('+15558675310')
        dial.number('+15558675311')
        dial.number('+15558675312')

        const xml = response.toString()
        expect(xml).toContain('+15558675310')
        expect(xml).toContain('+15558675311')
        expect(xml).toContain('+15558675312')
      })
    })

    describe('Record verb', () => {
      it('should generate Record with defaults', () => {
        const response = new VoiceResponse()
        response.record()

        expect(response.toString()).toContain('<Record/>')
      })

      it('should generate Record with all options', () => {
        const response = new VoiceResponse()
        response.record({
          action: '/handle-recording',
          method: 'POST',
          maxLength: 60,
          playBeep: true,
          finishOnKey: '#',
          timeout: 10,
          transcribe: true,
          transcribeCallback: 'https://example.com/transcribe',
          recordingStatusCallback: 'https://example.com/recording-status',
          recordingStatusCallbackEvent: ['completed', 'failed'],
          trim: 'trim-silence',
        })

        expect(response.toString()).toContain('maxLength="60"')
        expect(response.toString()).toContain('playBeep="true"')
        expect(response.toString()).toContain('transcribe="true"')
      })

      it('should generate Record with speech timeout', () => {
        const response = new VoiceResponse()
        response.record({
          timeout: 5,
          finishOnKey: '',
        })

        expect(response.toString()).toContain('timeout="5"')
      })
    })
  })

  // ============================================================================
  // 3. CALL RECORDING
  // ============================================================================

  describe('Call Recording', () => {
    it('should enable recording when creating a call', async () => {
      const mockCall = createMockCall()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCall, 201))

      await voice.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        url: 'https://example.com/twiml',
        record: true,
        recordingChannels: 'dual',
        recordingStatusCallback: 'https://example.com/recording-status',
        recordingStatusCallbackMethod: 'POST',
        recordingStatusCallbackEvent: ['in-progress', 'completed', 'absent'],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Record=true'),
        })
      )
    })

    it('should create a recording for an in-progress call', async () => {
      const mockRecording = createMockRecording({ status: 'in-progress' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockRecording, 201))

      const recording = await voice.calls('CA123').recordings.create({
        recordingStatusCallback: 'https://example.com/status',
        recordingStatusCallbackEvent: ['completed'],
        recordingChannels: 'dual',
        trim: 'trim-silence',
      })

      expect(recording.sid).toMatch(/^RE/)
      expect(recording.status).toBe('in-progress')
    })

    it('should list recordings for a call', async () => {
      const mockRecordings = [createMockRecording(), createMockRecording()]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ recordings: mockRecordings })
      )

      const recordings = await voice.calls('CA123').recordings.list()

      expect(recordings).toHaveLength(2)
    })

    it('should fetch a specific recording', async () => {
      const mockRecording = createMockRecording()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockRecording))

      const recording = await voice.recordings('RE123').fetch()

      expect(recording.sid).toBe(mockRecording.sid)
    })

    it('should delete a recording', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

      await voice.recordings('RE123').remove()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/Recordings/RE123'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('should get recording media URL', async () => {
      const mockRecording = createMockRecording()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockRecording))

      const recording = await voice.recordings('RE123').fetch()

      expect(recording.media_url).toContain('.mp3')
    })

    it('should handle pause/resume recording', async () => {
      const mockRecording = createMockRecording({ status: 'paused' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockRecording))

      const recording = await voice.calls('CA123').recordings('RE123').update({
        status: 'paused',
      })

      expect(recording.status).toBe('paused')
    })

    it('should list all account recordings with filters', async () => {
      const mockRecordings = [createMockRecording()]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ recordings: mockRecordings })
      )

      const recordings = await voice.recordings.list({
        dateCreated: new Date('2024-01-01'),
        callSid: 'CA123',
        conferenceSid: 'CF123',
      })

      expect(recordings).toBeDefined()
    })
  })

  // ============================================================================
  // 4. CALL FORWARDING
  // ============================================================================

  describe('Call Forwarding', () => {
    it('should generate TwiML for simple forwarding', () => {
      const response = new VoiceResponse()
      response.dial('+15558675310')

      expect(response.toString()).toContain('<Dial>+15558675310</Dial>')
    })

    it('should generate TwiML for forwarding with timeout', () => {
      const response = new VoiceResponse()
      response.dial('+15558675310', {
        timeout: 20,
        action: '/handle-dial-outcome',
      })

      expect(response.toString()).toContain('timeout="20"')
      expect(response.toString()).toContain('action="/handle-dial-outcome"')
    })

    it('should generate TwiML for forwarding with whisper', () => {
      const response = new VoiceResponse()
      const dial = response.dial()
      dial.number('+15558675310', {
        url: 'https://example.com/whisper',
      })

      expect(response.toString()).toContain(
        'url="https://example.com/whisper"'
      )
    })

    it('should generate TwiML for sequential forwarding', () => {
      // This represents trying numbers in sequence
      const response = new VoiceResponse()
      response.dial('+15558675310', {
        timeout: 10,
        action: '/try-next-number',
      })

      expect(response.toString()).toContain('timeout="10"')
      expect(response.toString()).toContain('action="/try-next-number"')
    })

    it('should generate TwiML for ring group (simultaneous)', () => {
      const response = new VoiceResponse()
      const dial = response.dial({ timeout: 20 })
      dial.number('+15558675310')
      dial.number('+15558675311')
      dial.number('+15558675312')

      const xml = response.toString()
      expect(xml.match(/<Number/g)?.length).toBe(3)
    })

    it('should handle forwarding failure with fallback', () => {
      const response = new VoiceResponse()
      response.say('Sorry, no one is available. Please leave a message.')
      response.record({
        maxLength: 60,
        action: '/handle-voicemail',
      })

      expect(response.toString()).toContain('<Say>')
      expect(response.toString()).toContain('<Record')
    })

    it('should forward with caller ID preservation', () => {
      const response = new VoiceResponse()
      response.dial('+15558675310', {
        callerId: '+15017122661',
      })

      expect(response.toString()).toContain('callerId="+15017122661"')
    })

    it('should forward with recording enabled', () => {
      const response = new VoiceResponse()
      response.dial('+15558675310', {
        record: 'record-from-answer-dual',
        recordingStatusCallback: 'https://example.com/recording',
      })

      expect(response.toString()).toContain('record="record-from-answer-dual"')
    })
  })

  // ============================================================================
  // 5. CONFERENCE CALLS
  // ============================================================================

  describe('Conference Calls', () => {
    describe('Conference TwiML generation', () => {
      it('should generate basic conference', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference')

        expect(response.toString()).toContain(
          '<Conference>MyConference</Conference>'
        )
      })

      it('should generate conference with muted participant', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          muted: true,
        })

        expect(response.toString()).toContain('muted="true"')
      })

      it('should generate conference with beep settings', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          beep: 'onEnter',
          startConferenceOnEnter: true,
          endConferenceOnExit: false,
        })

        expect(response.toString()).toContain('beep="onEnter"')
        expect(response.toString()).toContain('startConferenceOnEnter="true"')
      })

      it('should generate conference with wait music', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          waitUrl: 'https://example.com/wait-music',
          waitMethod: 'POST',
        })

        expect(response.toString()).toContain(
          'waitUrl="https://example.com/wait-music"'
        )
      })

      it('should generate moderated conference', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          startConferenceOnEnter: false,
          waitUrl: 'https://example.com/hold-music',
        })

        expect(response.toString()).toContain('startConferenceOnEnter="false"')
      })

      it('should generate conference with max participants', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          maxParticipants: 10,
        })

        expect(response.toString()).toContain('maxParticipants="10"')
      })

      it('should generate conference with recording', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          record: 'record-from-start',
          recordingStatusCallback: 'https://example.com/recording',
          recordingStatusCallbackEvent: ['completed'],
        })

        expect(response.toString()).toContain('record="record-from-start"')
      })

      it('should generate conference with status callbacks', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          statusCallback: 'https://example.com/conference-events',
          statusCallbackEvent: ['start', 'end', 'join', 'leave', 'mute', 'hold', 'speaker'],
          statusCallbackMethod: 'POST',
        })

        expect(response.toString()).toContain(
          'statusCallback="https://example.com/conference-events"'
        )
      })

      it('should generate conference with coaching', () => {
        const response = new VoiceResponse()
        const dial = response.dial()
        dial.conference('MyConference', {
          coach: 'CA_agent_call_sid',
        })

        expect(response.toString()).toContain('coach="CA_agent_call_sid"')
      })
    })

    describe('Conference API operations', () => {
      it('should list conferences', async () => {
        const mockConferences = [createMockConference()]
        mockFetch.mockResolvedValueOnce(
          createMockResponse({ conferences: mockConferences })
        )

        const conferences = await voice.conferences.list({
          status: 'in-progress',
          friendlyName: 'TestConference',
        })

        expect(conferences).toHaveLength(1)
      })

      it('should fetch a conference', async () => {
        const mockConference = createMockConference()
        mockFetch.mockResolvedValueOnce(createMockResponse(mockConference))

        const conference = await voice.conferences('CF123').fetch()

        expect(conference.sid).toBe(mockConference.sid)
        expect(conference.friendly_name).toBe('TestConference')
      })

      it('should update a conference', async () => {
        const mockConference = createMockConference({ status: 'completed' })
        mockFetch.mockResolvedValueOnce(createMockResponse(mockConference))

        const conference = await voice.conferences('CF123').update({
          status: 'completed',
        })

        expect(conference.status).toBe('completed')
      })

      it('should list conference participants', async () => {
        const mockParticipants = [createMockParticipant()]
        mockFetch.mockResolvedValueOnce(
          createMockResponse({ participants: mockParticipants })
        )

        const participants = await voice.conferences('CF123').participants.list()

        expect(participants).toHaveLength(1)
      })

      it('should add participant to conference', async () => {
        const mockParticipant = createMockParticipant()
        mockFetch.mockResolvedValueOnce(createMockResponse(mockParticipant, 201))

        const participant = await voice.conferences('CF123').participants.create({
          from: '+15017122661',
          to: '+15558675310',
          statusCallback: 'https://example.com/status',
        })

        expect(participant.call_sid).toMatch(/^CA/)
      })

      it('should update participant (mute/unmute)', async () => {
        const mockParticipant = createMockParticipant({ muted: true })
        mockFetch.mockResolvedValueOnce(createMockResponse(mockParticipant))

        const participant = await voice
          .conferences('CF123')
          .participants('CA123')
          .update({ muted: true })

        expect(participant.muted).toBe(true)
      })

      it('should put participant on hold', async () => {
        const mockParticipant = createMockParticipant({ hold: true })
        mockFetch.mockResolvedValueOnce(createMockResponse(mockParticipant))

        const participant = await voice
          .conferences('CF123')
          .participants('CA123')
          .update({
            hold: true,
            holdUrl: 'https://example.com/hold-music',
          })

        expect(participant.hold).toBe(true)
      })

      it('should enable coaching for participant', async () => {
        const mockParticipant = createMockParticipant({
          coaching: true,
          call_sid_to_coach: 'CA_target',
        })
        mockFetch.mockResolvedValueOnce(createMockResponse(mockParticipant))

        const participant = await voice
          .conferences('CF123')
          .participants('CA123')
          .update({
            coaching: true,
            callSidToCoach: 'CA_target',
          })

        expect(participant.coaching).toBe(true)
      })

      it('should remove participant from conference', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

        await voice.conferences('CF123').participants('CA123').remove()

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/Participants/CA123'),
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    })
  })

  // ============================================================================
  // 6. IVR FLOWS
  // ============================================================================

  describe('IVR Flows', () => {
    describe('Basic IVR menu', () => {
      it('should generate IVR greeting with menu', () => {
        const response = new VoiceResponse()
        response.say('Welcome to Acme Inc.')
        const gather = response.gather({
          numDigits: 1,
          action: '/handle-menu',
          timeout: 5,
        })
        gather.say('Press 1 for sales. Press 2 for support. Press 0 for operator.')
        response.say('We did not receive your selection. Goodbye.')

        const xml = response.toString()
        expect(xml).toContain('Welcome to Acme Inc.')
        expect(xml).toContain('numDigits="1"')
        expect(xml).toContain('action="/handle-menu"')
      })

      it('should handle menu selection routing', () => {
        // Simulating the /handle-menu endpoint response for selection "1"
        const response = new VoiceResponse()
        response.say('Connecting you to sales.')
        response.dial('+15558675310', {
          action: '/handle-dial-outcome',
        })

        expect(response.toString()).toContain('Connecting you to sales')
        expect(response.toString()).toContain('<Dial')
      })

      it('should handle invalid menu selection', () => {
        const response = new VoiceResponse()
        response.say('Invalid selection. Please try again.')
        response.redirect('/ivr-menu')

        expect(response.toString()).toContain('Invalid selection')
        expect(response.toString()).toContain('<Redirect>/ivr-menu</Redirect>')
      })
    })

    describe('Multi-level IVR', () => {
      it('should generate sub-menu', () => {
        const response = new VoiceResponse()
        const gather = response.gather({
          numDigits: 1,
          action: '/support-menu',
        })
        gather.say(
          'Press 1 for technical support. Press 2 for billing. Press 3 to return to main menu.'
        )

        expect(response.toString()).toContain('action="/support-menu"')
      })

      it('should allow return to previous menu', () => {
        const response = new VoiceResponse()
        response.redirect('/main-menu')

        expect(response.toString()).toContain('<Redirect>/main-menu</Redirect>')
      })
    })

    describe('Speech recognition IVR', () => {
      it('should generate speech-enabled IVR', () => {
        const response = new VoiceResponse()
        const gather = response.gather({
          input: ['speech', 'dtmf'],
          timeout: 5,
          speechTimeout: 'auto',
          action: '/handle-speech',
          hints: 'sales, support, billing, operator',
          language: 'en-US',
        })
        gather.say('How can I help you today? You can say sales, support, or billing.')

        expect(response.toString()).toContain('input="speech dtmf"')
        expect(response.toString()).toContain('hints="sales, support, billing, operator"')
      })

      it('should handle speech recognition result', () => {
        // Simulating webhook with speech result
        const payload: VoiceWebhookPayload = {
          CallSid: 'CA123',
          AccountSid: 'AC123',
          From: '+15558675310',
          To: '+15017122661',
          CallStatus: 'in-progress',
          Direction: 'inbound',
          ApiVersion: '2010-04-01',
          SpeechResult: 'I need help with billing',
          Confidence: '0.92',
        }

        const result = voice.parseWebhook(payload)
        expect(result.speechResult).toBe('I need help with billing')
        expect(result.confidence).toBeGreaterThan(0.9)
      })

      it('should handle low confidence speech with retry', () => {
        const response = new VoiceResponse()
        response.say("I'm sorry, I didn't understand. Please try again.")
        response.redirect('/speech-menu')

        expect(response.toString()).toContain("didn't understand")
        expect(response.toString()).toContain('<Redirect>')
      })
    })

    describe('Queue-based IVR', () => {
      it('should add caller to queue', () => {
        const response = new VoiceResponse()
        response.say('Please hold while we connect you to an agent.')
        response.enqueue('support', {
          waitUrl: 'https://example.com/hold-music',
          waitUrlMethod: 'POST',
          action: '/queue-exit',
        })

        expect(response.toString()).toContain('<Enqueue')
        expect(response.toString()).toContain('support')
      })

      it('should generate queue wait TwiML', () => {
        const response = new VoiceResponse()
        response.say('You are caller number 3 in the queue.')
        response.play('https://example.com/hold-music.mp3', { loop: 10 })
        response.say('Thank you for your patience. An agent will be with you shortly.')

        expect(response.toString()).toContain('caller number 3')
        expect(response.toString()).toContain('loop="10"')
      })

      it('should handle queue timeout', () => {
        const response = new VoiceResponse()
        response.say('We apologize, but all agents are busy. Please leave a message.')
        response.record({
          maxLength: 120,
          action: '/handle-voicemail',
          transcribe: true,
        })

        expect(response.toString()).toContain('<Record')
        expect(response.toString()).toContain('maxLength="120"')
      })
    })

    describe('IVR with account lookup', () => {
      it('should gather account number', () => {
        const response = new VoiceResponse()
        const gather = response.gather({
          numDigits: 10,
          action: '/verify-account',
          finishOnKey: '#',
          timeout: 20,
        })
        gather.say('Please enter your 10-digit account number followed by the pound key.')

        expect(response.toString()).toContain('numDigits="10"')
        expect(response.toString()).toContain('finishOnKey="#"')
      })

      it('should handle account verification response', () => {
        // Account found
        const response = new VoiceResponse()
        response.say('Thank you. Your account has been verified.')
        const gather = response.gather({
          numDigits: 1,
          action: '/account-menu',
        })
        gather.say('Press 1 to check your balance. Press 2 to make a payment.')

        expect(response.toString()).toContain('account has been verified')
      })

      it('should handle invalid account', () => {
        const response = new VoiceResponse()
        response.say('We could not find that account number.')
        response.redirect('/enter-account')

        expect(response.toString()).toContain('could not find')
        expect(response.toString()).toContain('<Redirect>')
      })
    })

    describe('IVR with callback request', () => {
      it('should gather callback number', () => {
        const response = new VoiceResponse()
        const gather = response.gather({
          numDigits: 10,
          action: '/confirm-callback',
          finishOnKey: '#',
        })
        gather.say('Please enter the phone number where we can reach you, followed by pound.')

        expect(response.toString()).toContain('action="/confirm-callback"')
      })

      it('should confirm callback request', () => {
        const response = new VoiceResponse()
        response.say(
          'You have requested a callback at 5 5 5. 8 6 7. 5 3 1 0. ' +
          'Press 1 to confirm or 2 to re-enter.'
        )
        response.gather({
          numDigits: 1,
          action: '/process-callback',
        })

        expect(response.toString()).toContain('requested a callback')
      })
    })

    describe('After-hours IVR', () => {
      it('should play after-hours message', () => {
        const response = new VoiceResponse()
        response.say(
          'Thank you for calling Acme Inc. Our office is currently closed. ' +
          'Our regular business hours are Monday through Friday, 9 AM to 5 PM Eastern Time.'
        )
        response.say('Please leave a message after the beep, and we will return your call.')
        response.record({
          maxLength: 120,
          action: '/handle-after-hours-voicemail',
          transcribe: true,
        })

        expect(response.toString()).toContain('office is currently closed')
        expect(response.toString()).toContain('<Record')
      })

      it('should offer emergency option', () => {
        const response = new VoiceResponse()
        response.say('Our office is currently closed.')
        const gather = response.gather({
          numDigits: 1,
          action: '/after-hours-menu',
          timeout: 5,
        })
        gather.say('If this is an emergency, press 1 to reach our on-call technician. Otherwise, please leave a message after the tone.')
        response.record({
          action: '/handle-voicemail',
        })

        expect(response.toString()).toContain('emergency')
        expect(response.toString()).toContain('<Gather')
        expect(response.toString()).toContain('<Record')
      })
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error handling', () => {
    it('should throw TwilioVoiceError for API errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(21201, 'Invalid phone number', 400)
      )

      await expect(
        voice.calls.create({
          to: 'invalid',
          from: '+15017122661',
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow(TwilioVoiceError)
    })

    it('should include error code in TwilioVoiceError', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(21214, 'To number is required', 400)
      )

      try {
        await voice.calls.create({
          to: '',
          from: '+15017122661',
          url: 'https://example.com/twiml',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioVoiceError)
        expect((error as TwilioVoiceError).code).toBe(21214)
      }
    })

    it('should retry on network errors when autoRetry is enabled', async () => {
      const clientWithRetry = new TwilioVoice({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        fetch: mockFetch,
        autoRetry: true,
        maxRetries: 3,
      })

      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(createMockResponse(createMockCall(), 201))

      const call = await clientWithRetry.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        url: 'https://example.com/twiml',
      })

      expect(call.sid).toMatch(/^CA/)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should not retry on 4xx errors', async () => {
      const clientWithRetry = new TwilioVoice({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        fetch: mockFetch,
        autoRetry: true,
        maxRetries: 3,
      })

      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(21201, 'Invalid phone number', 400)
      )

      await expect(
        clientWithRetry.calls.create({
          to: 'invalid',
          from: '+15017122661',
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow(TwilioVoiceError)

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // WEBHOOK SIGNATURE VALIDATION
  // ============================================================================

  describe('Webhook signature validation', () => {
    it('should validate webhook signature', async () => {
      const authToken = 'test_auth_token'
      const url = 'https://example.com/webhook'
      const params = {
        CallSid: 'CA123',
        AccountSid: 'AC123',
        From: '+15558675310',
        To: '+15017122661',
      }

      // Generate signature
      const signature = await voice.webhooks.getExpectedSignature(
        authToken,
        url,
        params
      )

      // Validate signature
      const isValid = await voice.webhooks.validateRequest(
        authToken,
        signature,
        url,
        params
      )

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const authToken = 'test_auth_token'
      const url = 'https://example.com/webhook'
      const params = { CallSid: 'CA123' }

      const isValid = await voice.webhooks.validateRequest(
        authToken,
        'invalid_signature',
        url,
        params
      )

      expect(isValid).toBe(false)
    })

    it('should validate webhook with body hash', async () => {
      const authToken = 'test_auth_token'
      const url = 'https://example.com/webhook'
      const body = JSON.stringify({ CallSid: 'CA123' })

      const signature = await voice.webhooks.getExpectedSignatureForBody(
        authToken,
        url,
        body
      )

      const isValid = await voice.webhooks.validateRequestWithBody(
        authToken,
        signature,
        url,
        body
      )

      expect(isValid).toBe(true)
    })
  })
})
