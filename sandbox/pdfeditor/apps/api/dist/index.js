/**
 * @pdfeditor/api — stateless PDF operations service.
 *
 * - Verifies FastAPI-issued JWTs on protected routes.
 * - PDF bytes live only in request memory; never persisted.
 */
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { bearerToken, verifyJwt } from './auth.js';
import { pdfRoutes } from './routes.js';
const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);
const authConfig = {
    jwtSecret: process.env.JWT_SECRET,
    jwksUrl: process.env.JWT_JWKS_URL,
};
async function main() {
    const app = Fastify({
        logger: { level: process.env.LOG_LEVEL ?? 'info' },
        // Never log request bodies (they may contain PDF bytes)
        disableRequestLogging: false,
    });
    await app.register(cors, {
        origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
        methods: ['GET', 'POST', 'OPTIONS'],
    });
    await app.register(multipart, {
        limits: { fileSize: MAX_BYTES, files: 20 },
        // attachFieldsToBody: false → stream parts, keep in memory only
    });
    await app.register(rateLimit, {
        max: 60,
        timeWindow: '1 minute',
        allowList: (req) => req.url === '/health',
    });
    // JWT auth for /pdf/* — attaches req.user, rejects invalid tokens
    app.addHook('onRequest', async (req, reply) => {
        if (!req.url.startsWith('/pdf/'))
            return;
        const token = bearerToken(req.headers.authorization);
        if (!token) {
            return reply.code(401).send({ error: 'Missing bearer token', code: 'unauthorized' });
        }
        try {
            req.user = await verifyJwt(token, authConfig);
        }
        catch {
            return reply.code(401).send({ error: 'Invalid or expired token', code: 'unauthorized' });
        }
    });
    app.get('/health', async () => ({
        ok: true,
        service: 'pdfeditor-api',
        version: '0.1.0',
        // Privacy attestation for operators
        storage: 'none — PDFs are processed in memory only',
    }));
    await app.register(pdfRoutes);
    app.setErrorHandler((err, _req, reply) => {
        const status = err.statusCode ?? 500;
        const message = err instanceof Error ? err.message : 'Internal server error';
        // Never echo file contents or sensitive details
        reply.code(status).send({
            error: status >= 500 ? 'Internal server error' : message,
            code: status >= 500 ? 'internal' : 'bad_request',
        });
    });
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`pdfeditor-api listening on ${HOST}:${PORT}`);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
//# sourceMappingURL=index.js.map