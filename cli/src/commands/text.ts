/**
 * Text Command
 *
 * Send SMS/MMS via texts.do
 *
 * Usage:
 *   do text +15551234567 "Reply YES to confirm"
 *   do text +15551234567 "Hello" --from +15559876543
 *   do text +15551234567 "Check this out" --media-url https://example.com/image.jpg
 *   do text +15551234567 "Hello" --json
 */

import { parseArgs, requirePositional, getStringFlag, getBooleanFlag, isValidPhoneNumber } from '../args'
import { textsRequest } from '../rpc'
import { formatJson } from '../output'
import { getConfig } from '../config'

// ============================================================================
// Types
// ============================================================================

interface TextRequest {
  to: string
  body: string
  from?: string
  media_url?: string
}

interface TextResponse {
  message_id: string
  status: string
}

// ============================================================================
// Command
// ============================================================================

export async function run(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  // Validate required arguments
  const to = requirePositional(args, 0, 'phone number')
  const body = requirePositional(args, 1, 'message')

  if (!isValidPhoneNumber(to)) {
    throw new Error(`Invalid phone number format. Use E.164 format (e.g., +15551234567)`)
  }

  // Build request
  const request: TextRequest = {
    to,
    body,
  }

  const from = getStringFlag(args, 'from')
  if (from) {
    if (!isValidPhoneNumber(from)) {
      throw new Error(`Invalid --from phone number format. Use E.164 format (e.g., +15551234567)`)
    }
    request.from = from
  }

  const mediaUrl = getStringFlag(args, 'media-url')
  if (mediaUrl) {
    request.media_url = mediaUrl
  }

  // Make request
  const response = await textsRequest<TextResponse>('/messages', {
    method: 'POST',
    body: request,
  })

  // Output result
  const config = await getConfig()
  const jsonOutput = getBooleanFlag(args, 'json') || config.json_output

  if (jsonOutput) {
    console.log(formatJson(response))
  } else {
    console.log(`Message sent: ${response.message_id}`)
    if (response.status) {
      console.log(`Status: ${response.status}`)
    }
  }
}
