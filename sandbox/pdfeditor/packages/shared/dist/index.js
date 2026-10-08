/**
 * @pdfeditor/shared
 *
 * Single source of truth for API contracts, JWT claims, and domain types.
 * Used by both apps/web and apps/api — change here, both sides stay in sync.
 */
import { z } from 'zod';
// ---------------------------------------------------------------------------
// JWT claims (issued by the existing FastAPI backend)
// ---------------------------------------------------------------------------
export const JwtClaimsSchema = z.object({
    /** Subject — the user id in FastAPI */
    sub: z.string().min(1),
    /** Subscription plan, e.g. "free" | "pro" */
    plan: z.string().default('free'),
    /** Issued-at (seconds since epoch) */
    iat: z.number().int().optional(),
    /** Expiry (seconds since epoch) */
    exp: z.number().int(),
    /** Optional scopes granted to this token */
    scopes: z.array(z.string()).optional(),
});
// ---------------------------------------------------------------------------
// Usage metadata (the ONLY thing ever sent to FastAPI after a PDF operation)
// ---------------------------------------------------------------------------
export const UsageMetadataSchema = z.object({
    tool: z.string().min(1), // e.g. "compress" | "merge" | "split" | "edit-export"
    fileSize: z.number().int().nonnegative(), // bytes of the source PDF
    pageCount: z.number().int().positive(),
    timestamp: z.string().datetime(), // ISO 8601
    userId: z.string().min(1), // from JWT sub
});
// ---------------------------------------------------------------------------
// Editor domain types
// ---------------------------------------------------------------------------
export const ElementKindSchema = z.enum([
    'text',
    'image',
    'highlight',
    'signature',
    'shape',
]);
const BaseElementSchema = z.object({
    /** UUID — never an array index */
    id: z.string().uuid(),
    /** UUID of the page this element belongs to */
    pageId: z.string().uuid(),
    kind: ElementKindSchema,
    /** Position in PDF points, origin bottom-left */
    x: z.number(),
    y: z.number(),
    /** Rotation in degrees */
    rotation: z.number().default(0),
});
export const TextElementSchema = BaseElementSchema.extend({
    kind: z.literal('text'),
    text: z.string(),
    fontSize: z.number().positive().default(12),
    fontFamily: z.string().default('Helvetica'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
    bold: z.boolean().default(false),
    italic: z.boolean().default(false),
    width: z.number().positive().optional(),
});
export const ImageElementSchema = BaseElementSchema.extend({
    kind: z.literal('image'),
    /** data URL or blob URL — memory only, never persisted */
    src: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive(),
    /** Original MIME type, validated on upload */
    mime: z.string().min(1),
});
export const HighlightElementSchema = BaseElementSchema.extend({
    kind: z.literal('highlight'),
    width: z.number().positive(),
    height: z.number().positive(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FFFF00'),
    opacity: z.number().min(0).max(1).default(0.4),
});
export const SignatureElementSchema = BaseElementSchema.extend({
    kind: z.literal('signature'),
    /** data URL of the drawn signature — memory only */
    src: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive(),
});
export const ShapeElementSchema = BaseElementSchema.extend({
    kind: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse', 'line', 'arrow']),
    width: z.number(),
    height: z.number(),
    stroke: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
    strokeWidth: z.number().positive().default(2),
    fill: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
});
export const EditorElementSchema = z.discriminatedUnion('kind', [
    TextElementSchema,
    ImageElementSchema,
    HighlightElementSchema,
    SignatureElementSchema,
    ShapeElementSchema,
]);
export const PageSchema = z.object({
    /** UUID — never an array index */
    id: z.string().uuid(),
    /** Original 1-based page number in the source PDF */
    sourceIndex: z.number().int().positive(),
    width: z.number().positive(), // PDF points
    height: z.number().positive(), // PDF points
    rotation: z.number().default(0), // 0 | 90 | 180 | 270
});
// ---------------------------------------------------------------------------
// PDF service API contracts
// ---------------------------------------------------------------------------
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const ALLOWED_MIME_TYPES = ['application/pdf'];
const PdfFileMetaSchema = z.object({
    fileName: z.string().min(1).max(255),
    fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    mimeType: z.enum(ALLOWED_MIME_TYPES),
});
/** POST /pdf/compress */
export const CompressRequestSchema = z.object({
    file: PdfFileMetaSchema,
    /** Target quality hint; service picks the strategy */
    quality: z.enum(['low', 'medium', 'high']).default('medium'),
});
/** POST /pdf/merge — files arrive as multipart parts; this describes the JSON side */
export const MergeRequestSchema = z.object({
    files: z.array(PdfFileMetaSchema).min(2).max(20),
});
/** POST /pdf/split */
export const SplitRequestSchema = z.object({
    file: PdfFileMetaSchema,
    /** 1-based page ranges, e.g. [{ from: 1, to: 3 }] */
    ranges: z
        .array(z.object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
    }))
        .min(1)
        .max(50),
});
/** Standard error envelope returned by the API */
export const ApiErrorSchema = z.object({
    error: z.string(),
    code: z.string(),
    details: z.unknown().optional(),
});
//# sourceMappingURL=index.js.map