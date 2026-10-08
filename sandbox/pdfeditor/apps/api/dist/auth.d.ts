import { type JwtClaims } from '@pdfeditor/shared';
export interface AuthConfig {
    /** HS256 shared secret (MVP). Mutually exclusive with jwksUrl. */
    jwtSecret?: string;
    /** Optional JWKS URL for RS256 (production upgrade path). */
    jwksUrl?: string;
}
export declare function verifyJwt(token: string, config: AuthConfig): Promise<JwtClaims>;
/** Extract a Bearer token from the Authorization header. */
export declare function bearerToken(header: string | undefined): string | null;
//# sourceMappingURL=auth.d.ts.map