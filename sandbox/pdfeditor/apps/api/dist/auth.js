/**
 * JWT verification — tokens are issued by the existing FastAPI backend.
 * This service only verifies; it never mints tokens and never touches
 * the FastAPI database.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { JwtClaimsSchema } from '@pdfeditor/shared';
export async function verifyJwt(token, config) {
    let payload;
    if (config.jwksUrl) {
        const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
        ({ payload } = await jwtVerify(token, jwks, { algorithms: ['RS256'] }));
    }
    else if (config.jwtSecret) {
        const key = new TextEncoder().encode(config.jwtSecret);
        ({ payload } = await jwtVerify(token, key, { algorithms: ['HS256'] }));
    }
    else {
        throw new Error('No JWT verification method configured');
    }
    // Validate claims shape with the shared Zod schema
    return JwtClaimsSchema.parse(payload);
}
/** Extract a Bearer token from the Authorization header. */
export function bearerToken(header) {
    if (!header)
        return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token)
        return null;
    return token;
}
//# sourceMappingURL=auth.js.map