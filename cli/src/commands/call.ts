/**
 * Call Command
 *
 * Make voice calls via calls.do
 *
 * Usage:
 *   do call +15551234567 "Your appointment is tomorrow"
 *   do call +15551234567 "Hello" --from +15559876543
 *   do call +15551234567 "Hello" --voice alice
 *   do call +15551234567 "Hello" --json
 */

import { parseArgs, requirePositional, getStringFlag, getBooleanFlag, isValidPhoneNumber } from '../args'
import { callsRequest } from '../rpc'
import { formatJson } from '../output'
import { getConfig } from '../config'

// ============================================================================
// Types
// ============================================================================

interface CallRequest {
  to: string
  message: string
  from?: string
  voice?: string
}

interface CallResponse {
  call_id: string
  status: string
}

// ============================================================================
// Command
// ============================================================================

export async function run(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  // Validate required arguments
  const to = requirePositional(args, 0, 'phone number')
  const message = requirePositional(args, 1, 'message')

  if (!isValidPhoneNumber(to)) {
    throw new Error(`Invalid phone number format. Use E.164 format (e.g., +15551234567)`)
  }

  // Build request
  const request: CallRequest = {
    to,
    message,
  }

  const from = getStringFlag(args, 'from')
  if (from) {
    if (!isValidPhoneNumber(from)) {
      throw new Error(`Invalid --from phone number format. Use E.164 format (e.g., +15551234567)`)
    }
    request.from = from
  }

  const voice = getStringFlag(args, 'voice')
  if (voice) {
    request.voice = voice
  }

  // Make request
  const response = await callsRequest<CallResponse>('/calls', {
    method: 'POST',
    body: request,
  })

  // Output result
  const config = await getConfig()
  const jsonOutput = getBooleanFlag(args, 'json') || config.json_output

  if (jsonOutput) {
    console.log(formatJson(response))
  } else {
    console.log(`Call initiated: ${response.call_id}`)
    console.log(`Status: ${response.status}`)
  }
}
