/**
 * Charge Command
 *
 * Create charges via payments.do
 *
 * Usage:
 *   do charge cus_123 --amount 9900
 *   do charge cus_123 --amount 1000 --currency eur
 *   do charge cus_123 --amount 5000 --description "Monthly subscription"
 *   do charge cus_123 --amount 1000 --metadata '{"order_id":"ord_123"}'
 *   do charge cus_123 --amount 1000 --json
 */

import { parseArgs, requirePositional, requireFlag, getStringFlag, getBooleanFlag, getNumberFlag, isPositiveInteger } from '../args'
import { paymentsRequest } from '../rpc'
import { formatJson } from '../output'
import { getConfig } from '../config'

// ============================================================================
// Types
// ============================================================================

interface ChargeRequest {
  customer: string
  amount: number
  currency: string
  description?: string
  metadata?: Record<string, unknown>
}

interface ChargeResponse {
  charge_id: string
  status: string
  amount: number
  currency: string
}

// ============================================================================
// Command
// ============================================================================

export async function run(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  // Validate required arguments
  const customer = requirePositional(args, 0, 'customer ID')
  const amountStr = requireFlag(args, 'amount', 'amount in smallest currency unit (e.g., cents)')
  const amount = parseInt(amountStr, 10)

  if (isNaN(amount) || !isPositiveInteger(amount)) {
    throw new Error(`Invalid --amount: must be a positive integer (in smallest currency unit)`)
  }

  // Build request
  const config = await getConfig()
  const request: ChargeRequest = {
    customer,
    amount,
    currency: getStringFlag(args, 'currency') ?? config.default_currency ?? 'usd',
  }

  const description = getStringFlag(args, 'description')
  if (description) {
    request.description = description
  }

  const metadata = getStringFlag(args, 'metadata')
  if (metadata) {
    try {
      request.metadata = JSON.parse(metadata)
    } catch {
      throw new Error(`Invalid --metadata: expected valid JSON`)
    }
  }

  // Make request
  const response = await paymentsRequest<ChargeResponse>('/charges', {
    method: 'POST',
    body: request,
  })

  // Output result
  const jsonOutput = getBooleanFlag(args, 'json') || config.json_output

  if (jsonOutput) {
    console.log(formatJson(response))
  } else {
    console.log(`Charge created: ${response.charge_id}`)
    if (response.amount !== undefined && response.currency) {
      console.log(`Amount: ${(response.amount / 100).toFixed(2)} ${response.currency.toUpperCase()}`)
    }
    if (response.status) {
      console.log(`Status: ${response.status}`)
    }
  }
}
