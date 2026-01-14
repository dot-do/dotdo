/**
 * @dotdo/calls - Twilio API Compatibility Tests
 *
 * TDD tests for voice call API compatibility with Twilio.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TwilioClient,
  validateMakeCallRequest,
  TwiMLBuilder,
  parseTwiML,
  parseVoiceWebhook,
  createVoiceRouter,
} from '../src/twilio-compat'
import type {
  MakeCallRequest,
  MakeCallResponse,
  VoiceWebhookPayload,
  TwiMLInstruction,
} from '../src/types'

// ============================================================================
// TwilioClient Tests
// ============================================================================

describe('TwilioClient', () => {
  describe('constructor', () => {
    it('creates a client with account credentials', () => {
      const client = new TwilioClient({
        accountSid: 'AC123',
        authToken: 'token123',
      })

      expect(client).toBeDefined()
    })

    it('creates a client with API key credentials', () => {
      const client = new TwilioClient({
        accountSid: 'AC123',
        apiKey: 'SK123',
        apiSecret: 'secret123',
      })

      expect(client).toBeDefined()
    })
  })

  describe('calls.create()', () => {
    let client: TwilioClient

    beforeEach(() => {
      client = new TwilioClient({
        accountSid: 'AC123',
        authToken: 'token123',
      })
    })

    it('creates an outbound call with URL', async () => {
      const result = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      expect(result.sid).toMatch(/^CA[a-f0-9]{32}$/i)
      expect(result.from).toBe('+14155559876')
      expect(result.to).toBe('+14155551234')
      expect(result.status).toBe('queued')
      expect(result.direction).toBe('outbound-api')
    })

    it('creates an outbound call with inline TwiML', async () => {
      const result = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        twiml: '<Response><Say>Hello World</Say></Response>',
      })

      expect(result.sid).toBeDefined()
      expect(result.status).toBe('queued')
    })

    it('throws error when neither url nor twiml provided', async () => {
      await expect(
        client.calls.create({
          to: '+14155551234',
          from: '+14155559876',
        })
      ).rejects.toThrow('Either url or twiml must be provided')
    })

    it('throws error for invalid to number', async () => {
      await expect(
        client.calls.create({
          to: 'invalid',
          from: '+14155559876',
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow('Invalid to address')
    })

    it('throws error for invalid from number', async () => {
      await expect(
        client.calls.create({
          to: '+14155551234',
          from: 'invalid',
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow('Invalid from address')
    })

    it('supports SIP URIs for to address', async () => {
      const result = await client.calls.create({
        to: 'sip:user@example.com',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      expect(result.to).toBe('sip:user@example.com')
    })

    it('includes status callback configuration', async () => {
      const result = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
        status_callback: 'https://example.com/status',
        status_callback_method: 'POST',
        status_callback_event: ['initiated', 'ringing', 'answered', 'completed'],
      })

      expect(result.sid).toBeDefined()
    })

    it('supports machine detection', async () => {
      const result = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
        machine_detection: 'Enable',
        machine_detection_timeout: 30,
      })

      expect(result.sid).toBeDefined()
    })

    it('supports call recording', async () => {
      const result = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
        record: true,
        recording_channels: 'dual',
      })

      expect(result.sid).toBeDefined()
    })
  })

  describe('calls.get()', () => {
    let client: TwilioClient

    beforeEach(() => {
      client = new TwilioClient({
        accountSid: 'AC123',
        authToken: 'token123',
      })
    })

    it('retrieves a call by SID', async () => {
      // First create a call
      const created = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const call = await client.calls.get(created.sid)

      expect(call.sid).toBe(created.sid)
      expect(call.from).toBe('+14155559876')
      expect(call.to).toBe('+14155551234')
    })

    it('throws error for non-existent call', async () => {
      await expect(
        client.calls.get('CA00000000000000000000000000000000')
      ).rejects.toThrow('Call not found')
    })
  })

  describe('calls.update()', () => {
    let client: TwilioClient

    beforeEach(() => {
      client = new TwilioClient({
        accountSid: 'AC123',
        authToken: 'token123',
      })
    })

    it('updates call with new TwiML URL', async () => {
      const created = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const updated = await client.calls.update(created.sid, {
        url: 'https://example.com/new-twiml',
      })

      expect(updated.sid).toBe(created.sid)
    })

    it('cancels a call', async () => {
      const created = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const updated = await client.calls.update(created.sid, {
        status: 'canceled',
      })

      expect(updated.status).toBe('canceled')
    })

    it('completes a call', async () => {
      const created = await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const updated = await client.calls.update(created.sid, {
        status: 'completed',
      })

      expect(updated.status).toBe('completed')
    })
  })

  describe('calls.list()', () => {
    let client: TwilioClient

    beforeEach(() => {
      client = new TwilioClient({
        accountSid: 'AC123',
        authToken: 'token123',
      })
    })

    it('lists all calls', async () => {
      // Create a few calls
      await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })
      await client.calls.create({
        to: '+14155551235',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const calls = await client.calls.list()

      expect(calls.length).toBeGreaterThanOrEqual(2)
    })

    it('filters calls by status', async () => {
      await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const calls = await client.calls.list({ status: 'queued' })

      calls.forEach((call) => {
        expect(call.status).toBe('queued')
      })
    })

    it('filters calls by to number', async () => {
      await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const calls = await client.calls.list({ to: '+14155551234' })

      calls.forEach((call) => {
        expect(call.to).toBe('+14155551234')
      })
    })

    it('filters calls by from number', async () => {
      await client.calls.create({
        to: '+14155551234',
        from: '+14155559876',
        url: 'https://example.com/twiml',
      })

      const calls = await client.calls.list({ from: '+14155559876' })

      calls.forEach((call) => {
        expect(call.from).toBe('+14155559876')
      })
    })
  })
})

// ============================================================================
// Request Validation Tests
// ============================================================================

describe('validateMakeCallRequest', () => {
  it('validates a valid request', () => {
    const result = validateMakeCallRequest({
      to: '+14155551234',
      from: '+14155559876',
      url: 'https://example.com/twiml',
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toBeUndefined()
  })

  it('rejects request without to', () => {
    const result = validateMakeCallRequest({
      from: '+14155559876',
      url: 'https://example.com/twiml',
    } as MakeCallRequest)

    expect(result.valid).toBe(false)
    expect(result.errors?.error.message).toContain('to')
  })

  it('rejects request without from', () => {
    const result = validateMakeCallRequest({
      to: '+14155551234',
      url: 'https://example.com/twiml',
    } as MakeCallRequest)

    expect(result.valid).toBe(false)
    expect(result.errors?.error.message).toContain('from')
  })

  it('rejects request without url or twiml', () => {
    const result = validateMakeCallRequest({
      to: '+14155551234',
      from: '+14155559876',
    })

    expect(result.valid).toBe(false)
    expect(result.errors?.error.message).toContain('url or twiml')
  })

  it('validates E.164 phone numbers', () => {
    const result = validateMakeCallRequest({
      to: '4155551234', // Missing +
      from: '+14155559876',
      url: 'https://example.com/twiml',
    })

    expect(result.valid).toBe(false)
    expect(result.errors?.error.message).toContain('to')
  })

  it('validates SIP URIs', () => {
    const result = validateMakeCallRequest({
      to: 'sip:user@example.com',
      from: '+14155559876',
      url: 'https://example.com/twiml',
    })

    expect(result.valid).toBe(true)
  })

  it('validates client addresses', () => {
    const result = validateMakeCallRequest({
      to: 'client:user123',
      from: '+14155559876',
      url: 'https://example.com/twiml',
    })

    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// TwiML Builder Tests
// ============================================================================

describe('TwiMLBuilder', () => {
  it('creates empty response', () => {
    const builder = new TwiMLBuilder()
    const xml = builder.build()

    expect(xml).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  })

  it('adds Say verb', () => {
    const builder = new TwiMLBuilder()
    builder.say('Hello World')
    const xml = builder.build()

    expect(xml).toContain('<Say>Hello World</Say>')
  })

  it('adds Say verb with options', () => {
    const builder = new TwiMLBuilder()
    builder.say('Hello World', { voice: 'alice', language: 'en-US', loop: 2 })
    const xml = builder.build()

    expect(xml).toContain('<Say voice="alice" language="en-US" loop="2">Hello World</Say>')
  })

  it('adds Play verb', () => {
    const builder = new TwiMLBuilder()
    builder.play('https://example.com/audio.mp3')
    const xml = builder.build()

    expect(xml).toContain('<Play>https://example.com/audio.mp3</Play>')
  })

  it('adds Play verb with loop', () => {
    const builder = new TwiMLBuilder()
    builder.play('https://example.com/audio.mp3', { loop: 3 })
    const xml = builder.build()

    expect(xml).toContain('<Play loop="3">https://example.com/audio.mp3</Play>')
  })

  it('adds Gather verb', () => {
    const builder = new TwiMLBuilder()
    builder.gather({
      action: '/handle-input',
      num_digits: 1,
      timeout: 5,
    })
    const xml = builder.build()

    // Verify Gather element with expected attributes (order may vary)
    expect(xml).toContain('<Gather')
    expect(xml).toContain('action="/handle-input"')
    expect(xml).toContain('numDigits="1"')
    expect(xml).toContain('timeout="5"')
    expect(xml).toContain('></Gather>')
  })

  it('adds Gather with nested Say', () => {
    const builder = new TwiMLBuilder()
    builder.gather({
      action: '/handle-input',
      num_digits: 1,
    }, (gather) => {
      gather.say('Press 1 for sales, 2 for support')
    })
    const xml = builder.build()

    expect(xml).toContain('<Gather action="/handle-input" numDigits="1">')
    expect(xml).toContain('<Say>Press 1 for sales, 2 for support</Say>')
    expect(xml).toContain('</Gather>')
  })

  it('adds Dial verb with number', () => {
    const builder = new TwiMLBuilder()
    builder.dial('+14155551234')
    const xml = builder.build()

    expect(xml).toContain('<Dial>+14155551234</Dial>')
  })

  it('adds Dial verb with options', () => {
    const builder = new TwiMLBuilder()
    builder.dial('+14155551234', {
      caller_id: '+14155559876',
      timeout: 30,
      record: 'record-from-answer',
    })
    const xml = builder.build()

    expect(xml).toContain('<Dial callerId="+14155559876" timeout="30" record="record-from-answer">+14155551234</Dial>')
  })

  it('adds Dial with Conference', () => {
    const builder = new TwiMLBuilder()
    builder.dial(null, {}, (dial) => {
      dial.conference('MyConference')
    })
    const xml = builder.build()

    expect(xml).toContain('<Conference>MyConference</Conference>')
  })

  it('adds Record verb', () => {
    const builder = new TwiMLBuilder()
    builder.record({
      action: '/handle-recording',
      max_length: 60,
      transcribe: true,
    })
    const xml = builder.build()

    expect(xml).toContain('<Record action="/handle-recording" maxLength="60" transcribe="true" />')
  })

  it('adds Hangup verb', () => {
    const builder = new TwiMLBuilder()
    builder.hangup()
    const xml = builder.build()

    expect(xml).toContain('<Hangup />')
  })

  it('adds Redirect verb', () => {
    const builder = new TwiMLBuilder()
    builder.redirect('/new-handler')
    const xml = builder.build()

    expect(xml).toContain('<Redirect>/new-handler</Redirect>')
  })

  it('adds Pause verb', () => {
    const builder = new TwiMLBuilder()
    builder.pause(2)
    const xml = builder.build()

    expect(xml).toContain('<Pause length="2" />')
  })

  it('adds Reject verb', () => {
    const builder = new TwiMLBuilder()
    builder.reject('busy')
    const xml = builder.build()

    expect(xml).toContain('<Reject reason="busy" />')
  })

  it('chains multiple verbs', () => {
    const builder = new TwiMLBuilder()
    builder
      .say('Welcome!')
      .pause(1)
      .say('Please hold.')
      .play('https://example.com/hold-music.mp3')

    const xml = builder.build()

    expect(xml).toContain('<Say>Welcome!</Say>')
    expect(xml).toContain('<Pause length="1" />')
    expect(xml).toContain('<Say>Please hold.</Say>')
    expect(xml).toContain('<Play>https://example.com/hold-music.mp3</Play>')
  })
})

// ============================================================================
// TwiML Parser Tests
// ============================================================================

describe('parseTwiML', () => {
  it('parses Say verb', () => {
    const xml = '<Response><Say>Hello World</Say></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    expect(instructions[0].type).toBe('Say')
    expect((instructions[0].params as { text: string }).text).toBe('Hello World')
  })

  it('parses Say verb with attributes', () => {
    const xml = '<Response><Say voice="alice" language="en-US" loop="2">Hello</Say></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    const params = instructions[0].params as { text: string; voice: string; language: string; loop: number }
    expect(params.voice).toBe('alice')
    expect(params.language).toBe('en-US')
    expect(params.loop).toBe(2)
  })

  it('parses Play verb', () => {
    const xml = '<Response><Play>https://example.com/audio.mp3</Play></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    expect(instructions[0].type).toBe('Play')
    expect((instructions[0].params as { url: string }).url).toBe('https://example.com/audio.mp3')
  })

  it('parses Gather verb with nested content', () => {
    const xml = '<Response><Gather action="/input" numDigits="1"><Say>Press 1</Say></Gather></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    expect(instructions[0].type).toBe('Gather')
    const params = instructions[0].params as { action: string; num_digits: number; nested: TwiMLInstruction[] }
    expect(params.action).toBe('/input')
    expect(params.num_digits).toBe(1)
    expect(params.nested).toHaveLength(1)
    expect(params.nested[0].type).toBe('Say')
  })

  it('parses Dial verb', () => {
    const xml = '<Response><Dial timeout="30">+14155551234</Dial></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    expect(instructions[0].type).toBe('Dial')
    const params = instructions[0].params as { number: string; timeout: number }
    expect(params.number).toBe('+14155551234')
    expect(params.timeout).toBe(30)
  })

  it('parses Record verb', () => {
    const xml = '<Response><Record action="/recording" maxLength="60" /></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    expect(instructions[0].type).toBe('Record')
    const params = instructions[0].params as { action: string; max_length: number }
    expect(params.action).toBe('/recording')
    expect(params.max_length).toBe(60)
  })

  it('parses Hangup verb', () => {
    const xml = '<Response><Hangup /></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    expect(instructions[0].type).toBe('Hangup')
  })

  it('parses Redirect verb', () => {
    const xml = '<Response><Redirect method="POST">/new-handler</Redirect></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(1)
    expect(instructions[0].type).toBe('Redirect')
    const params = instructions[0].params as { url: string; method: string }
    expect(params.url).toBe('/new-handler')
    expect(params.method).toBe('POST')
  })

  it('parses multiple verbs', () => {
    const xml = '<Response><Say>Hello</Say><Pause length="1" /><Say>Goodbye</Say><Hangup /></Response>'
    const instructions = parseTwiML(xml)

    expect(instructions).toHaveLength(4)
    expect(instructions[0].type).toBe('Say')
    expect(instructions[1].type).toBe('Pause')
    expect(instructions[2].type).toBe('Say')
    expect(instructions[3].type).toBe('Hangup')
  })

  it('throws on invalid XML', () => {
    expect(() => parseTwiML('not xml')).toThrow()
  })

  it('throws on missing Response element', () => {
    expect(() => parseTwiML('<Invalid><Say>Hello</Say></Invalid>')).toThrow('Missing Response element')
  })
})

// ============================================================================
// Webhook Parser Tests
// ============================================================================

describe('parseVoiceWebhook', () => {
  it('parses inbound call webhook', () => {
    const payload = {
      CallSid: 'CA123',
      AccountSid: 'AC123',
      From: '+14155551234',
      To: '+14155559876',
      CallStatus: 'ringing',
      Direction: 'inbound',
      ApiVersion: '2010-04-01',
    }

    const result = parseVoiceWebhook(payload)

    expect(result.CallSid).toBe('CA123')
    expect(result.From).toBe('+14155551234')
    expect(result.To).toBe('+14155559876')
    expect(result.CallStatus).toBe('ringing')
    expect(result.Direction).toBe('inbound')
  })

  it('parses webhook with gathered digits', () => {
    const payload = {
      CallSid: 'CA123',
      AccountSid: 'AC123',
      From: '+14155551234',
      To: '+14155559876',
      CallStatus: 'in-progress',
      Direction: 'inbound',
      ApiVersion: '2010-04-01',
      Digits: '1',
    }

    const result = parseVoiceWebhook(payload)

    expect(result.Digits).toBe('1')
  })

  it('parses webhook with speech result', () => {
    const payload = {
      CallSid: 'CA123',
      AccountSid: 'AC123',
      From: '+14155551234',
      To: '+14155559876',
      CallStatus: 'in-progress',
      Direction: 'inbound',
      ApiVersion: '2010-04-01',
      SpeechResult: 'Hello world',
      Confidence: '0.95',
    }

    const result = parseVoiceWebhook(payload)

    expect(result.SpeechResult).toBe('Hello world')
    expect(result.Confidence).toBe('0.95')
  })

  it('parses webhook with recording info', () => {
    const payload = {
      CallSid: 'CA123',
      AccountSid: 'AC123',
      From: '+14155551234',
      To: '+14155559876',
      CallStatus: 'completed',
      Direction: 'inbound',
      ApiVersion: '2010-04-01',
      RecordingUrl: 'https://example.com/recording.mp3',
      RecordingSid: 'RE123',
      RecordingDuration: '30',
    }

    const result = parseVoiceWebhook(payload)

    expect(result.RecordingUrl).toBe('https://example.com/recording.mp3')
    expect(result.RecordingSid).toBe('RE123')
    expect(result.RecordingDuration).toBe('30')
  })

  it('parses webhook with AMD result', () => {
    const payload = {
      CallSid: 'CA123',
      AccountSid: 'AC123',
      From: '+14155551234',
      To: '+14155559876',
      CallStatus: 'in-progress',
      Direction: 'outbound-api',
      ApiVersion: '2010-04-01',
      AnsweredBy: 'human',
    }

    const result = parseVoiceWebhook(payload)

    expect(result.AnsweredBy).toBe('human')
  })

  it('parses status callback', () => {
    const payload = {
      CallSid: 'CA123',
      AccountSid: 'AC123',
      From: '+14155551234',
      To: '+14155559876',
      CallStatus: 'completed',
      Direction: 'outbound-api',
      ApiVersion: '2010-04-01',
      CallDuration: '120',
      SequenceNumber: '5',
      Timestamp: '2024-01-01T00:00:00Z',
    }

    const result = parseVoiceWebhook(payload)

    expect(result.CallDuration).toBe('120')
    expect(result.SequenceNumber).toBe('5')
    expect(result.Timestamp).toBe('2024-01-01T00:00:00Z')
  })
})

// ============================================================================
// Hono Router Tests
// ============================================================================

describe('createVoiceRouter', () => {
  it('creates a Hono router', () => {
    const router = createVoiceRouter()

    expect(router).toBeDefined()
  })

  it('handles POST /Calls endpoint', async () => {
    const router = createVoiceRouter()

    const request = new Request('http://localhost/Calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        To: '+14155551234',
        From: '+14155559876',
        Url: 'https://example.com/twiml',
      }),
    })

    const response = await router.fetch(request)

    expect(response.status).toBe(201)
    const body = await response.json() as MakeCallResponse
    expect(body.sid).toBeDefined()
  })

  it('handles GET /Calls/:sid endpoint', async () => {
    const router = createVoiceRouter()

    // First create a call
    const createRequest = new Request('http://localhost/Calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        To: '+14155551234',
        From: '+14155559876',
        Url: 'https://example.com/twiml',
      }),
    })

    const createResponse = await router.fetch(createRequest)
    const created = await createResponse.json() as MakeCallResponse

    // Then retrieve it
    const getRequest = new Request(`http://localhost/Calls/${created.sid}`, {
      method: 'GET',
    })

    const getResponse = await router.fetch(getRequest)

    expect(getResponse.status).toBe(200)
    const body = await getResponse.json() as { sid: string }
    expect(body.sid).toBe(created.sid)
  })

  it('handles voice webhook POST', async () => {
    const router = createVoiceRouter()

    const request = new Request('http://localhost/webhook/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        CallSid: 'CA123',
        AccountSid: 'AC123',
        From: '+14155551234',
        To: '+14155559876',
        CallStatus: 'ringing',
        Direction: 'inbound',
        ApiVersion: '2010-04-01',
      }).toString(),
    })

    const response = await router.fetch(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('application/xml')
    const body = await response.text()
    expect(body).toContain('<Response>')
  })

  it('handles status callback POST', async () => {
    const router = createVoiceRouter()

    const request = new Request('http://localhost/webhook/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        CallSid: 'CA123',
        AccountSid: 'AC123',
        From: '+14155551234',
        To: '+14155559876',
        CallStatus: 'completed',
        Direction: 'outbound-api',
        ApiVersion: '2010-04-01',
        CallDuration: '120',
      }).toString(),
    })

    const response = await router.fetch(request)

    expect(response.status).toBe(200)
  })

  it('returns 400 for invalid call request', async () => {
    const router = createVoiceRouter()

    const request = new Request('http://localhost/Calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        To: '+14155551234',
        // Missing From and Url
      }),
    })

    const response = await router.fetch(request)

    expect(response.status).toBe(400)
  })

  it('returns 404 for non-existent call', async () => {
    const router = createVoiceRouter()

    const request = new Request('http://localhost/Calls/CA00000000000000000000000000000000', {
      method: 'GET',
    })

    const response = await router.fetch(request)

    expect(response.status).toBe(404)
  })
})
