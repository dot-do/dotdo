// Device Flow - OAuth 2.0 Device Authorization Grant (RFC 8628)
// Implements the device flow for CLI authentication

/**
 * Device code response from the authorization server
 */
export interface DeviceCodeResponse {
  /** The device verification code */
  device_code: string
  /** The end-user verification code (displayed to user) */
  user_code: string
  /** The verification URI for the user to visit */
  verification_uri: string
  /** Optional verification URI with user code pre-filled */
  verification_uri_complete?: string
  /** Lifetime of device_code and user_code in seconds */
  expires_in: number
  /** Minimum polling interval in seconds */
  interval?: number
}

/**
 * Token response from a successful device flow
 */
export interface DeviceTokenResponse {
  /** OAuth access token */
  access_token: string
  /** Token type (typically 'Bearer') */
  token_type: string
  /** Access token lifetime in seconds */
  expires_in: number
  /** OAuth refresh token (optional) */
  refresh_token?: string
  /** Granted scopes (space-separated) */
  scope?: string
}

/**
 * Device flow error codes per RFC 8628
 */
export type DeviceFlowErrorCode =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'

/**
 * Error thrown during device flow
 */
export class DeviceFlowError extends Error {
  constructor(
    public readonly code: DeviceFlowErrorCode,
    public readonly description?: string
  ) {
    super(description || code)
    this.name = 'DeviceFlowError'
  }
}

/**
 * Options for the DeviceFlow client
 */
export interface DeviceFlowOptions {
  /** OAuth client ID */
  clientId: string
  /** Base URL of the OAuth server (e.g., 'https://oauth.do') */
  oauthBaseUrl: string
  /** Scopes to request (space-separated) */
  scope?: string
  /** Custom fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch
  /** Polling interval in milliseconds (default: 5000) */
  pollIntervalMs?: number
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Device Flow - implements OAuth 2.0 Device Authorization Grant
 *
 * Used for CLI authentication where the user completes auth in a browser.
 *
 * @example
 * ```typescript
 * const flow = new DeviceFlow({
 *   clientId: 'my-cli',
 *   oauthBaseUrl: 'https://oauth.do',
 *   scope: 'read write',
 * })
 *
 * // Step 1: Get device code
 * const deviceCode = await flow.requestDeviceCode()
 * console.log(`Go to ${deviceCode.verification_uri} and enter: ${deviceCode.user_code}`)
 *
 * // Step 2: Poll for token
 * const tokens = await flow.pollForToken(deviceCode.device_code)
 * console.log(`Logged in! Token: ${tokens.access_token}`)
 * ```
 */
export class DeviceFlow {
  private readonly clientId: string
  private readonly oauthBaseUrl: string
  private readonly scope?: string
  private readonly fetchImpl: typeof globalThis.fetch
  private pollIntervalMs: number

  constructor(options: DeviceFlowOptions) {
    this.clientId = options.clientId
    this.oauthBaseUrl = options.oauthBaseUrl
    if (options.scope !== undefined) {
      this.scope = options.scope
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.pollIntervalMs = options.pollIntervalMs ?? 5000
  }

  /**
   * Request a device code from the authorization server
   * @returns DeviceCodeResponse containing user_code and verification_uri
   */
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const params = new URLSearchParams()
    params.set('client_id', this.clientId)
    if (this.scope) {
      params.set('scope', this.scope)
    }

    const response = await this.fetchImpl(`${this.oauthBaseUrl}/device/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const error = await response.json() as { error: string; error_description?: string }
      throw new DeviceFlowError(
        error.error as DeviceFlowErrorCode,
        error.error_description
      )
    }

    return response.json() as Promise<DeviceCodeResponse>
  }

  /**
   * Poll for token until authorization is complete
   * @param deviceCode - The device_code from requestDeviceCode()
   * @returns DeviceTokenResponse on successful authorization
   * @throws DeviceFlowError on access_denied, expired_token, or other errors
   */
  async pollForToken(deviceCode: string): Promise<DeviceTokenResponse> {
    while (true) {
      const params = new URLSearchParams()
      params.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code')
      params.set('device_code', deviceCode)
      params.set('client_id', this.clientId)

      const response = await this.fetchImpl(`${this.oauthBaseUrl}/device/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      })

      if (response.ok) {
        return response.json() as Promise<DeviceTokenResponse>
      }

      const error = await response.json() as { error: DeviceFlowErrorCode; error_description?: string }

      switch (error.error) {
        case 'authorization_pending':
          // User hasn't completed authorization yet, keep polling
          await sleep(this.pollIntervalMs)
          continue

        case 'slow_down':
          // Increase polling interval by 5 seconds (per RFC 8628)
          this.pollIntervalMs += 5000
          await sleep(this.pollIntervalMs)
          continue

        case 'access_denied':
        case 'expired_token':
        case 'invalid_grant':
          throw new DeviceFlowError(error.error, error.error_description)

        default:
          throw new DeviceFlowError(
            error.error || 'invalid_grant' as DeviceFlowErrorCode,
            error.error_description || 'Unknown error during device flow'
          )
      }
    }
  }
}
