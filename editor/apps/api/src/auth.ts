/**
 * JWT verification — tokens are issued by the existing FastAPI backend.
 * This service only verifies; it never mints tokens and never touches
 * the FastAPI database.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { JwtClaimsSchema, type JwtClaims } from '@pdfeditor/shared';

export interface AuthConfig {
  /** HS256 shared secret (MVP). Mutually exclusive with jwksUrl. */
  jwtSecret?: string;
  /** Optional JWKS URL for RS256 (production upgrade path). */
  jwksUrl?: string;
}

export async function verifyJwt(token: string, config: AuthConfig): Promise<JwtClaims> {
  let payload: Record<string, unknown>;
  if (config.jwksUrl) {
    const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
    ({ payload } = await jwtVerify(token, jwks, { algorithms: ['RS256'] }));
  } else if (config.jwtSecret) {
    const key = new TextEncoder().encode(config.jwtSecret);
    ({ payload } = await jwtVerify(token, key, { algorithms: ['HS256'] }));
  } else {
    throw new Error('No JWT verification method configured');
  }
  // Validate claims shape with the shared Zod schema
  return JwtClaimsSchema.parse(payload);
}

/** Extract a Bearer token from the Authorization header. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
