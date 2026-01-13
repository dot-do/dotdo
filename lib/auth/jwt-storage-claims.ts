// lib/auth/jwt-storage-claims.ts

import { jwtVerify } from 'jose'

export interface StorageClaims {
  orgId: string
  subject: string
  tenantId?: string
  bucket?: string
  pathPrefix?: string
  region?: string
}

export async function extractStorageClaims(
  jwt: string,
  secret: Uint8Array
): Promise<StorageClaims> {
  // Validate JWT format
  if (!jwt || jwt.split('.').length !== 3) {
    throw new Error('Invalid JWT')
  }

  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(jwt, secret)
    payload = result.payload as Record<string, unknown>
  } catch (e: any) {
    if (e?.code === 'ERR_JWT_EXPIRED') {
      throw new Error('JWT expired')
    }
    throw new Error('Invalid JWT')
  }

  // Extract and validate org_id (required)
  const orgId = payload.org_id as string
  if (!orgId) throw new Error('Missing org_id')

  // Extract subject (from sub claim)
  const subject = payload.sub as string

  // Extract optional tenant_id
  const tenantId = payload.tenant_id as string | undefined

  // Extract optional storage claims
  const storage = payload.storage as { bucket?: string; path_prefix?: string } | undefined

  return {
    orgId,
    subject,
    tenantId,
    bucket: storage?.bucket,
    pathPrefix: storage?.path_prefix,
  }
}
