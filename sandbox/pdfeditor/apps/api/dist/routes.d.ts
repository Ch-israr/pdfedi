/**
 * Stateless PDF operations.
 *
 * PRIVACY CONTRACT:
 * - PDF bytes arrive as multipart fields and live ONLY in memory (Buffer).
 * - They are NEVER written to disk, database, S3, or any persistent storage.
 * - The processed PDF is returned directly in the HTTP response.
 * - When the request ends, all buffers are eligible for GC — nothing remains.
 */
import type { FastifyInstance } from 'fastify';
export declare function pdfRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map