/**
 * Stateless PDF operations.
 *
 * PRIVACY CONTRACT:
 * - PDF bytes arrive as multipart fields and live ONLY in memory (Buffer).
 * - They are NEVER written to disk, database, S3, or any persistent storage.
 * - The processed PDF is returned directly in the HTTP response.
 * - When the request ends, all buffers are eligible for GC — nothing remains.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PDFDocument, degrees } from 'pdf-lib';
import {
  ALLOWED_MIME_TYPES,
  CompressRequestSchema,
  MergeRequestSchema,
  SplitRequestSchema,
} from '@pdfeditor/shared';

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);

interface UploadedFile {
  filename: string;
  mimetype: string;
  data: Buffer;
}

async function readUploads(req: FastifyRequest): Promise<UploadedFile[]> {
  const files: UploadedFile[] = [];
  for await (const part of req.parts()) {
    if (part.type !== 'file') continue;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        throw Object.assign(new Error('File exceeds size limit'), { statusCode: 413 });
      }
      chunks.push(chunk as Buffer);
    }
    files.push({
      filename: part.filename ?? 'upload.pdf',
      mimetype: part.mimetype ?? '',
      data: Buffer.concat(chunks),
    });
  }
  return files;
}

function assertPdf(file: UploadedFile) {
  const okMime = (ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype);
  const okExt = file.filename.toLowerCase().endsWith('.pdf');
  if (!okMime || !okExt) {
    throw Object.assign(new Error('Only PDF files are accepted'), { statusCode: 415 });
  }
  // Magic bytes: %PDF
  if (file.data.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw Object.assign(new Error('File is not a valid PDF'), { statusCode: 422 });
  }
}

function pdfResponse(reply: FastifyReply, bytes: Uint8Array, name: string) {
  reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `attachment; filename="${name}"`)
    .header('Content-Length', bytes.length)
    .send(Buffer.from(bytes));
}

export async function pdfRoutes(app: FastifyInstance) {
  // ---- POST /pdf/compress -------------------------------------------------
  app.post('/pdf/compress', async (req, reply) => {
    const files = await readUploads(req);
    if (files.length !== 1 || !files[0]) {
      return reply.code(400).send({ error: 'Expected exactly one PDF file', code: 'bad_request' });
    }
    const file = files[0];
    assertPdf(file);

    const quality = (req.query as { quality?: string }).quality ?? 'medium';
    CompressRequestSchema.parse({
      file: { fileName: file.filename, fileSize: file.data.length, mimeType: 'application/pdf' },
      quality,
    });

    // MVP strategy: re-save with object streams + drop metadata.
    // Real compression (image downsampling) is a post-MVP enhancement.
    const doc = await PDFDocument.load(file.data, { ignoreEncryption: false });
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setProducer('PDFEditor');
    doc.setCreator('PDFEditor');
    const out = await doc.save({ useObjectStreams: true });

    const base = file.filename.replace(/\.pdf$/i, '');
    pdfResponse(reply, out, `${base}-compressed.pdf`);
  });

  // ---- POST /pdf/merge ----------------------------------------------------
  app.post('/pdf/merge', async (req, reply) => {
    const files = await readUploads(req);
    if (files.length < 2 || files.length > 20) {
      return reply.code(400).send({ error: 'Merge needs 2–20 PDF files', code: 'bad_request' });
    }
    for (const f of files) assertPdf(f);
    MergeRequestSchema.parse({
      files: files.map((f) => ({
        fileName: f.filename,
        fileSize: f.data.length,
        mimeType: 'application/pdf' as const,
      })),
    });

    const out = await PDFDocument.create();
    for (const f of files) {
      const src = await PDFDocument.load(f.data, { ignoreEncryption: false });
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    }
    const bytes = await out.save({ useObjectStreams: true });
    pdfResponse(reply, bytes, 'merged.pdf');
  });

  // ---- POST /pdf/split ----------------------------------------------------
  // Query: ranges=1-3,5  (1-based, comma-separated). Without ranges → one PDF per page
  // returned as a ZIP? MVP: single range → single PDF.
  app.post('/pdf/split', async (req, reply) => {
    const files = await readUploads(req);
    if (files.length !== 1 || !files[0]) {
      return reply.code(400).send({ error: 'Expected exactly one PDF file', code: 'bad_request' });
    }
    const file = files[0];
    assertPdf(file);

    const rawRanges = (req.query as { ranges?: string }).ranges;
    const src = await PDFDocument.load(file.data, { ignoreEncryption: false });
    const total = src.getPageCount();

    let ranges: { from: number; to: number }[];
    if (rawRanges) {
      ranges = rawRanges.split(',').map((r) => {
        const [a, b] = r.split('-').map(Number);
        const from = Math.max(1, Math.floor(a));
        const to = Math.min(total, Math.floor(b ?? a));
        if (!from || !to || from > to) {
          throw Object.assign(new Error(`Invalid range: ${r}`), { statusCode: 400 });
        }
        return { from, to };
      });
      SplitRequestSchema.parse({
        file: { fileName: file.filename, fileSize: file.data.length, mimeType: 'application/pdf' },
        ranges,
      });
    } else {
      ranges = [{ from: 1, to: total }];
    }

    // MVP: export the FIRST range as a single PDF.
    // Multi-range → multi-file (zip) is a post-MVP enhancement.
    const { from, to } = ranges[0]!;
    const out = await PDFDocument.create();
    const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
    const pages = await out.copyPages(src, indices);
    for (const p of pages) out.addPage(p);
    const bytes = await out.save({ useObjectStreams: true });

    const base = file.filename.replace(/\.pdf$/i, '');
    pdfResponse(reply, bytes, `${base}-p${from}-p${to}.pdf`);
  });

  // ---- POST /pdf/rotate ---------------------------------------------------
  // Query: pages=1,3 & angle=90 — rotates selected pages in place.
  app.post('/pdf/rotate', async (req, reply) => {
    const files = await readUploads(req);
    if (files.length !== 1 || !files[0]) {
      return reply.code(400).send({ error: 'Expected exactly one PDF file', code: 'bad_request' });
    }
    const file = files[0];
    assertPdf(file);

    const q = req.query as { pages?: string; angle?: string };
    const angle = Number(q.angle ?? 90);
    if (![90, 180, 270].includes(angle)) {
      return reply.code(400).send({ error: 'angle must be 90, 180 or 270', code: 'bad_request' });
    }
    const doc = await PDFDocument.load(file.data, { ignoreEncryption: false });
    const total = doc.getPageCount();
    const targets = q.pages
      ? q.pages.split(',').map(Number).filter((n) => n >= 1 && n <= total)
      : Array.from({ length: total }, (_, i) => i + 1);
    for (const n of targets) {
      const page = doc.getPage(n - 1);
      const cur = page.getRotation().angle;
      page.setRotation(degrees((cur + angle) % 360));
    }
    const bytes = await doc.save({ useObjectStreams: true });
    const base = file.filename.replace(/\.pdf$/i, '');
    pdfResponse(reply, bytes, `${base}-rotated.pdf`);
  });
}
