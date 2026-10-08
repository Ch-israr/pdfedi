import type { JwtClaims } from '@pdfeditor/shared';
declare module 'fastify' {
    interface FastifyRequest {
        user: JwtClaims | null;
    }
}
//# sourceMappingURL=index.d.ts.map