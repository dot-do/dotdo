/**
 * Email Command
 *
 * Send emails via emails.do
 *
 * Usage:
 *   do email user@example.com --subject "Hello" --body "Hi there!"
 *   do email user@example.com --template welcome
 *   do email user@example.com --subject "Hi" --html "<h1>Hello</h1>"
 *   do email user@example.com --subject "Hi" --from noreply@company.com
 *   do email user@example.com --template welcome --json
 */

import { parseArgs, requirePositional, getStringFlag, getBooleanFlag, isValidEmail } from '../args'
import { emailsRequest } from '../rpc'
import { formatJson } from '../output'
import { getConfig } from '../config'

// ============================================================================
// Types
// ============================================================================

interface EmailRequest {
  to: string
  from?: string
  subject?: string
  text?: string
  html?: string
  template?: string
  variables?: Record<string, unknown>
}

interface EmailResponse {
  email_id: string
  status: string
}

// ============================================================================
// Command
// ============================================================================

export async function run(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs)

  // Validate required arguments
  const to = requirePositional(args, 0, 'email address')

  if (!isValidEmail(to)) {
    throw new Error(`Invalid email address format`)
  }

  // Build request
  const request: EmailRequest = {
    to,
  }

  const from = getStringFlag(args, 'from')
  if (from) {
    if (!isValidEmail(from)) {
      throw new Error(`Invalid --from email address format`)
    }
    request.from = from
  }

  const subject = getStringFlag(args, 'subject')
  if (subject) {
    request.subject = subject
  }

  const body = getStringFlag(args, 'body')
  if (body) {
    request.text = body
  }

  const html = getStringFlag(args, 'html')
  if (html) {
    request.html = html
  }

  const template = getStringFlag(args, 'template')
  if (template) {
    request.template = template
  }

  const variables = getStringFlag(args, 'variables')
  if (variables) {
    try {
      request.variables = JSON.parse(variables)
    } catch {
      throw new Error(`Invalid --variables: expected valid JSON`)
    }
  }

  // Make request
  const response = await emailsRequest<EmailResponse>('/emails', {
    method: 'POST',
    body: request,
  })

  // Output result
  const config = await getConfig()
  const jsonOutput = getBooleanFlag(args, 'json') || config.json_output

  if (jsonOutput) {
    console.log(formatJson(response))
  } else {
    console.log(`Email sent: ${response.email_id}`)
    if (response.status) {
      console.log(`Status: ${response.status}`)
    }
  }
}
