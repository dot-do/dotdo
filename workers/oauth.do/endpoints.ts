/**
 * OAuth 2.0 Authorization Server Endpoints
 *
 * Implements RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 7009 (Token Revocation),
 * RFC 7662 (Token Introspection), and OpenID Connect Core 1.0.
 */

import type {
  OAuthServerConfig,
  OAuthDatabase,
  AuthorizationRequest,
  StoredAuthRequest,
  TokenRequest,
  TokenResponse,
  IntrospectionResponse,
  DiscoveryDocument,
  OAuthError,
  OAuthErrorCode,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
} from './types'
import {
  getJWKS,
  generateAuthorizationCode,
  generateAccessToken,
  generateRefreshToken,
  generateClientId,
  generateClientSecret,
  generateIdToken,
  verifyCodeChallenge,
} from './crypto'

// ============================================================================
// Response Helpers
// ============================================================================

function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

function errorResponse(
  error: OAuthErrorCode,
  description?: string,
  status = 400
): Response {
  const body: OAuthError = { error }
  if (description) {
    body.error_description = description
  }
  return jsonResponse(body, status)
}

function redirectWithError(
  redirectUri: string,
  error: OAuthErrorCode,
  description?: string,
  state?: string
): Response {
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  if (description) {
    url.searchParams.set('error_description', description)
  }
  if (state) {
    url.searchParams.set('state', state)
  }
  return Response.redirect(url.toString(), 302)
}

// ============================================================================
// Discovery Endpoint
// ============================================================================

export function handleDiscovery(config: OAuthServerConfig): Response {
  const discovery: DiscoveryDocument = {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    userinfo_endpoint: `${config.issuer}/userinfo`,
    jwks_uri: `${config.issuer}/.well-known/jwks.json`,
    registration_endpoint: `${config.issuer}/register`,
    introspection_endpoint: `${config.issuer}/introspect`,
    revocation_endpoint: `${config.issuer}/revoke`,
    scopes_supported: config.scopes || ['openid', 'profile', 'email', 'offline_access'],
    response_types_supported: ['code', 'token', 'id_token', 'code token', 'code id_token', 'token id_token', 'code token id_token'],
    response_modes_supported: ['query', 'fragment', 'form_post'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['plain', 'S256'],
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'nbf',
      'nonce',
      'email',
      'email_verified',
      'name',
      'picture',
    ],
  }

  return jsonResponse(discovery)
}

// ============================================================================
// JWKS Endpoint
// ============================================================================

export async function handleJWKS(config: OAuthServerConfig): Promise<Response> {
  const jwks = await getJWKS(config.signingKey)

  return jsonResponse(jwks, 200, {
    'Cache-Control': 'public, max-age=86400',
  })
}

// ============================================================================
// Authorization Endpoint
// ============================================================================

export async function handleAuthorization(
  request: Request,
  config: OAuthServerConfig,
  db: OAuthDatabase,
  authRequestStore: Map<string, StoredAuthRequest>
): Promise<Response> {
  const url = new URL(request.url)
  const params = Object.fromEntries(url.searchParams) as unknown as AuthorizationRequest

  // Validate required parameters
  const clientId = params.client_id
  const redirectUri = params.redirect_uri
  const responseType = params.response_type
  const scope = params.scope || ''
  const state = params.state
  const codeChallenge = params.code_challenge
  const codeChallengeMethod = params.code_challenge_method

  // Look up client
  const client = db.clients.get(clientId)
  if (!client) {
    return errorResponse('invalid_client', 'Unknown client_id')
  }

  // Validate redirect_uri
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return errorResponse('invalid_redirect_uri', 'redirect_uri does not match registered URIs')
  }

  // Enforce HTTPS in production
  if (config.enforceHttps && !redirectUri.startsWith('https://')) {
    return errorResponse('invalid_redirect_uri', 'redirect_uri must use HTTPS')
  }

  // Validate response_type
  if (!responseType) {
    return redirectWithError(
      redirectUri,
      'invalid_request',
      'Missing response_type parameter',
      state
    )
  }

  if (responseType !== 'code') {
    return redirectWithError(
      redirectUri,
      'unsupported_response_type',
      'Only code response_type is supported',
      state
    )
  }

  // Require PKCE for public clients
  if (client.public && !codeChallenge) {
    return redirectWithError(
      redirectUri,
      'invalid_request',
      'code_challenge is required for public clients',
      state
    )
  }

  // Store authorization request for login/consent flow
  const authRequestId = crypto.randomUUID()
  const storedRequest: StoredAuthRequest = {
    id: authRequestId,
    ...params,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 600000), // 10 minutes
  }
  authRequestStore.set(authRequestId, storedRequest)

  // Redirect to login page
  const loginUrl = new URL(config.loginUrl || `${config.issuer}/login`)
  loginUrl.searchParams.set('auth_request_id', authRequestId)

  return Response.redirect(loginUrl.toString(), 302)
}

// ============================================================================
// Authorization Callback (after login/consent)
// ============================================================================

export async function handleAuthorizationCallback(
  request: Request,
  config: OAuthServerConfig,
  db: OAuthDatabase,
  authRequestStore: Map<string, StoredAuthRequest>
): Promise<Response> {
  const url = new URL(request.url)
  const authRequestId = url.searchParams.get('auth_request_id')
  const userId = url.searchParams.get('user_id')
  const consent = url.searchParams.get('consent')

  if (!authRequestId || !userId) {
    return errorResponse('invalid_request', 'Missing auth_request_id or user_id')
  }

  const authRequest = authRequestStore.get(authRequestId)
  if (!authRequest) {
    return errorResponse('invalid_request', 'Auth request not found or expired')
  }

  // Check if request is expired
  if (new Date() > authRequest.expiresAt) {
    authRequestStore.delete(authRequestId)
    return errorResponse('invalid_request', 'Auth request expired')
  }

  // Check consent
  if (consent !== 'granted') {
    return redirectWithError(
      authRequest.redirect_uri,
      'access_denied',
      'User denied consent',
      authRequest.state
    )
  }

  // Generate authorization code
  const code = generateAuthorizationCode()
  const scopes = (authRequest.scope || '').split(' ').filter(Boolean)

  db.authCodes.set(code, {
    code,
    clientId: authRequest.client_id,
    userId,
    redirectUri: authRequest.redirect_uri,
    scopes,
    codeChallenge: authRequest.code_challenge,
    codeChallengeMethod: authRequest.code_challenge_method,
    nonce: authRequest.nonce,
    expiresAt: new Date(Date.now() + (config.authorizationCodeTtl || 600) * 1000),
    used: false,
  })

  // Clean up auth request
  authRequestStore.delete(authRequestId)

  // Redirect back to client with code
  const redirectUrl = new URL(authRequest.redirect_uri)
  redirectUrl.searchParams.set('code', code)
  if (authRequest.state) {
    redirectUrl.searchParams.set('state', authRequest.state)
  }

  return Response.redirect(redirectUrl.toString(), 302)
}

// ============================================================================
// Token Endpoint
// ============================================================================

export async function handleToken(
  request: Request,
  config: OAuthServerConfig,
  db: OAuthDatabase
): Promise<Response> {
  // Parse request body
  const contentType = request.headers.get('Content-Type') || ''
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return errorResponse('invalid_request', 'Content-Type must be application/x-www-form-urlencoded')
  }

  const body = await request.text()
  const params = Object.fromEntries(new URLSearchParams(body)) as unknown as TokenRequest

  // Authenticate client
  const clientAuth = await authenticateClient(request, params, db)
  if ('error' in clientAuth) {
    return jsonResponse(clientAuth, 401, {
      'WWW-Authenticate': 'Basic',
    })
  }
  const client = clientAuth.client

  // Handle grant type
  const grantType = params.grant_type

  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(params, client, config, db)
  }

  if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(params, client, config, db)
  }

  return errorResponse('unsupported_grant_type', `Grant type ${grantType} is not supported`)
}

async function authenticateClient(
  request: Request,
  params: TokenRequest,
  db: OAuthDatabase
): Promise<{ client: NonNullable<ReturnType<typeof db.clients.get>> } | OAuthError> {
  let clientId: string | undefined
  let clientSecret: string | undefined

  // Try Basic auth
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice(6))
    const [id, secret] = decoded.split(':')
    clientId = id
    clientSecret = secret
  }

  // Try body params
  if (!clientId) {
    clientId = params.client_id
    clientSecret = params.client_secret
  }

  if (!clientId) {
    return { error: 'invalid_client', error_description: 'Client authentication required' }
  }

  const client = db.clients.get(clientId)
  if (!client) {
    return { error: 'invalid_client', error_description: 'Unknown client' }
  }

  // Public clients don't need secret
  if (client.public) {
    return { client }
  }

  // Confidential clients need valid secret
  if (!clientSecret || clientSecret !== client.clientSecret) {
    return { error: 'invalid_client', error_description: 'Invalid client credentials' }
  }

  return { client }
}

async function handleAuthorizationCodeGrant(
  params: TokenRequest,
  client: { clientId: string; grantTypes: string[] },
  config: OAuthServerConfig,
  db: OAuthDatabase
): Promise<Response> {
  if (!client.grantTypes.includes('authorization_code')) {
    return errorResponse('unauthorized_client', 'Client not authorized for authorization_code grant')
  }

  const code = params.code
  if (!code) {
    return errorResponse('invalid_request', 'Missing code parameter')
  }

  const authCode = db.authCodes.get(code)
  if (!authCode) {
    return errorResponse('invalid_grant', 'Invalid authorization code')
  }

  // Validate code hasn't been used
  if (authCode.used) {
    return errorResponse('invalid_grant', 'Authorization code already used')
  }

  // Validate code hasn't expired
  if (new Date() > authCode.expiresAt) {
    return errorResponse('invalid_grant', 'Authorization code expired')
  }

  // Validate code was issued to this client
  if (authCode.clientId !== client.clientId) {
    return errorResponse('invalid_grant', 'Authorization code was not issued to this client')
  }

  // Validate redirect_uri matches
  if (params.redirect_uri && params.redirect_uri !== authCode.redirectUri) {
    return errorResponse('invalid_grant', 'redirect_uri does not match')
  }

  // Validate PKCE if code_challenge was used
  if (authCode.codeChallenge) {
    if (!params.code_verifier) {
      return errorResponse('invalid_grant', 'code_verifier required for PKCE')
    }

    const valid = await verifyCodeChallenge(
      params.code_verifier,
      authCode.codeChallenge,
      authCode.codeChallengeMethod
    )

    if (!valid) {
      return errorResponse('invalid_grant', 'Invalid code_verifier')
    }
  }

  // Mark code as used
  authCode.used = true

  // Get user
  const user = db.users.get(authCode.userId)

  // Generate tokens
  const accessToken = generateAccessToken()
  const accessTokenTtl = config.accessTokenTtl || 3600

  db.tokens.set(accessToken, {
    id: crypto.randomUUID(),
    token: accessToken,
    clientId: client.clientId,
    userId: authCode.userId,
    scopes: authCode.scopes,
    expiresAt: new Date(Date.now() + accessTokenTtl * 1000),
    revoked: false,
  })

  const response: TokenResponse = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessTokenTtl,
    scope: authCode.scopes.join(' '),
  }

  // Include refresh token if offline_access scope requested
  if (authCode.scopes.includes('offline_access')) {
    const refreshToken = generateRefreshToken()
    const refreshTokenTtl = config.refreshTokenTtl || 86400 * 30

    db.refreshTokens.set(refreshToken, {
      id: crypto.randomUUID(),
      token: refreshToken,
      clientId: client.clientId,
      userId: authCode.userId,
      scopes: authCode.scopes,
      expiresAt: new Date(Date.now() + refreshTokenTtl * 1000),
      revoked: false,
    })

    response.refresh_token = refreshToken
  }

  // Include ID token if openid scope requested
  if (authCode.scopes.includes('openid') && user) {
    const includeEmail = authCode.scopes.includes('email')
    const includeProfile = authCode.scopes.includes('profile')

    response.id_token = await generateIdToken(
      {
        issuer: config.issuer,
        subject: authCode.userId,
        audience: client.clientId,
        nonce: authCode.nonce,
        email: includeEmail ? user.email : undefined,
        emailVerified: includeEmail ? user.emailVerified : undefined,
        name: includeProfile ? user.name : undefined,
        picture: includeProfile ? user.image : undefined,
      },
      config.signingKey
    )
  }

  return jsonResponse(response, 200, {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  })
}

async function handleRefreshTokenGrant(
  params: TokenRequest,
  client: { clientId: string; grantTypes: string[] },
  config: OAuthServerConfig,
  db: OAuthDatabase
): Promise<Response> {
  if (!client.grantTypes.includes('refresh_token')) {
    return errorResponse('unauthorized_client', 'Client not authorized for refresh_token grant')
  }

  const refreshToken = params.refresh_token
  if (!refreshToken) {
    return errorResponse('invalid_request', 'Missing refresh_token parameter')
  }

  const storedToken = db.refreshTokens.get(refreshToken)
  if (!storedToken) {
    return errorResponse('invalid_grant', 'Invalid refresh token')
  }

  // Validate token hasn't been revoked
  if (storedToken.revoked) {
    return errorResponse('invalid_grant', 'Refresh token has been revoked')
  }

  // Validate token hasn't expired
  if (new Date() > storedToken.expiresAt) {
    return errorResponse('invalid_grant', 'Refresh token expired')
  }

  // Validate token was issued to this client
  if (storedToken.clientId !== client.clientId) {
    return errorResponse('invalid_grant', 'Refresh token was not issued to this client')
  }

  // Get user
  const user = db.users.get(storedToken.userId)

  // Generate new access token
  const accessToken = generateAccessToken()
  const accessTokenTtl = config.accessTokenTtl || 3600

  db.tokens.set(accessToken, {
    id: crypto.randomUUID(),
    token: accessToken,
    clientId: client.clientId,
    userId: storedToken.userId,
    scopes: storedToken.scopes,
    expiresAt: new Date(Date.now() + accessTokenTtl * 1000),
    revoked: false,
  })

  const response: TokenResponse = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessTokenTtl,
    scope: storedToken.scopes.join(' '),
  }

  // Optionally rotate refresh token
  // For now, we don't rotate (same as many providers)

  return jsonResponse(response, 200, {
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
  })
}

// ============================================================================
// Token Revocation Endpoint (RFC 7009)
// ============================================================================

export async function handleRevocation(
  request: Request,
  config: OAuthServerConfig,
  db: OAuthDatabase
): Promise<Response> {
  const body = await request.text()
  const params = Object.fromEntries(new URLSearchParams(body)) as {
    token: string
    token_type_hint?: string
  }

  // Authenticate client
  const clientAuth = await authenticateClient(request, params as TokenRequest, db)
  if ('error' in clientAuth) {
    return jsonResponse(clientAuth, 401)
  }

  const token = params.token
  if (!token) {
    return errorResponse('invalid_request', 'Missing token parameter')
  }

  const tokenTypeHint = params.token_type_hint

  // Try to find and revoke the token
  // RFC 7009: Always return 200, even if token not found
  if (tokenTypeHint === 'refresh_token' || !tokenTypeHint) {
    const refreshToken = db.refreshTokens.get(token)
    if (refreshToken && refreshToken.clientId === clientAuth.client.clientId) {
      refreshToken.revoked = true
      return new Response(null, { status: 200 })
    }
  }

  if (tokenTypeHint === 'access_token' || !tokenTypeHint) {
    const accessToken = db.tokens.get(token)
    if (accessToken && accessToken.clientId === clientAuth.client.clientId) {
      accessToken.revoked = true
      return new Response(null, { status: 200 })
    }
  }

  // RFC 7009: Return 200 even if token not found
  return new Response(null, { status: 200 })
}

// ============================================================================
// Token Introspection Endpoint (RFC 7662)
// ============================================================================

export async function handleIntrospection(
  request: Request,
  config: OAuthServerConfig,
  db: OAuthDatabase
): Promise<Response> {
  const body = await request.text()
  const params = Object.fromEntries(new URLSearchParams(body)) as {
    token: string
    token_type_hint?: string
  }

  // Authenticate client
  const clientAuth = await authenticateClient(request, params as TokenRequest, db)
  if ('error' in clientAuth) {
    return jsonResponse(clientAuth, 401)
  }

  const token = params.token
  if (!token) {
    return errorResponse('invalid_request', 'Missing token parameter')
  }

  // Try to find the token
  const accessToken = db.tokens.get(token)
  if (accessToken) {
    // Check if active
    const isActive =
      !accessToken.revoked && new Date() < accessToken.expiresAt

    if (!isActive) {
      return jsonResponse({ active: false })
    }

    const response: IntrospectionResponse = {
      active: true,
      scope: accessToken.scopes.join(' '),
      client_id: accessToken.clientId,
      sub: accessToken.userId,
      exp: Math.floor(accessToken.expiresAt.getTime() / 1000),
      token_type: 'Bearer',
    }

    return jsonResponse(response)
  }

  // Check refresh tokens too
  const refreshToken = db.refreshTokens.get(token)
  if (refreshToken) {
    const isActive =
      !refreshToken.revoked && new Date() < refreshToken.expiresAt

    if (!isActive) {
      return jsonResponse({ active: false })
    }

    const response: IntrospectionResponse = {
      active: true,
      scope: refreshToken.scopes.join(' '),
      client_id: refreshToken.clientId,
      sub: refreshToken.userId,
      exp: Math.floor(refreshToken.expiresAt.getTime() / 1000),
      token_type: 'Bearer',
    }

    return jsonResponse(response)
  }

  return jsonResponse({ active: false })
}

// ============================================================================
// UserInfo Endpoint (OpenID Connect)
// ============================================================================

export async function handleUserInfo(
  request: Request,
  config: OAuthServerConfig,
  db: OAuthDatabase
): Promise<Response> {
  // Extract bearer token
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'invalid_request' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer',
      },
    })
  }

  const token = authHeader.slice(7)
  const accessToken = db.tokens.get(token)

  if (!accessToken || accessToken.revoked || new Date() > accessToken.expiresAt) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      },
    })
  }

  const user = db.users.get(accessToken.userId)
  if (!user) {
    return new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      },
    })
  }

  const scopes = accessToken.scopes
  const claims: Record<string, unknown> = {
    sub: user.id,
  }

  // Add claims based on scopes
  if (scopes.includes('email')) {
    claims.email = user.email
    claims.email_verified = user.emailVerified
  }

  if (scopes.includes('profile')) {
    claims.name = user.name
    if (user.image) {
      claims.picture = user.image
    }
  }

  return jsonResponse(claims)
}

// ============================================================================
// Client Registration Endpoint (RFC 7591)
// ============================================================================

export async function handleClientRegistration(
  request: Request,
  config: OAuthServerConfig,
  db: OAuthDatabase
): Promise<Response> {
  let body: ClientRegistrationRequest

  try {
    body = await request.json() as ClientRegistrationRequest
  } catch {
    return errorResponse('invalid_request', 'Invalid JSON body')
  }

  // Validate required fields
  if (!body.redirect_uris || body.redirect_uris.length === 0) {
    return errorResponse('invalid_client_metadata', 'redirect_uris is required')
  }

  // Generate client credentials
  const clientId = generateClientId()
  const clientSecret = generateClientSecret()

  // Create client
  const client = {
    id: crypto.randomUUID(),
    clientId,
    clientSecret,
    name: body.client_name || 'Unnamed Client',
    redirectUris: body.redirect_uris,
    scopes: (body.scope || 'openid profile email').split(' '),
    grantTypes: body.grant_types || ['authorization_code'],
    responseTypes: body.response_types || ['code'],
    tokenEndpointAuthMethod: body.token_endpoint_auth_method || 'client_secret_basic',
    public: false,
    skipConsent: false,
    userId: '', // Dynamic registration doesn't require a user
  }

  db.clients.set(clientId, client)

  const response: ClientRegistrationResponse = {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: client.grantTypes,
    response_types: client.responseTypes || ['code'],
    token_endpoint_auth_method: client.tokenEndpointAuthMethod || 'client_secret_basic',
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0, // Never expires
  }

  return jsonResponse(response, 201)
}
