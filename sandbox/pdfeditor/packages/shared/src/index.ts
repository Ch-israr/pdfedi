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

export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

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

export type UsageMetadata = z.infer<typeof UsageMetadataSchema>;

// ---------------------------------------------------------------------------
// Editor domain types
// ---------------------------------------------------------------------------

export const ElementKindSchema = z.enum([
  'text',
  'image',
  'highlight',
  'signature',
  'shape',
  'native-text',
]);
export type ElementKind = z.infer<typeof ElementKindSchema>;

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
  /** Optional hyperlink URL (http/https only, validated in UI) */
  link: z.string().url().optional(),
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

/**
 * An edit of existing native PDF text. x/y is the bottom-left of the
 * opaque cover box (PDF points); the replacement text is drawn at the
 * original baseline (y + baselineOffset). On export the original text is
 * covered with an opaque rect so no remnants show through.
 */
export const NativeTextElementSchema = BaseElementSchema.extend({
  kind: z.literal('native-text'),
  /** Text as extracted from the PDF (reference only) */
  originalText: z.string(),
  /** Current edited text */
  text: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Distance from cover-box bottom to the text baseline */
  baselineOffset: z.number().nonnegative().default(0),
  fontSize: z.number().positive(),
  fontFamily: z.string().default('Helvetica'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#000000'),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
});

export const EditorElementSchema = z.discriminatedUnion('kind', [
  TextElementSchema,
  ImageElementSchema,
  HighlightElementSchema,
  SignatureElementSchema,
  ShapeElementSchema,
  NativeTextElementSchema,
]);
export type EditorElement = z.infer<typeof EditorElementSchema>;

/** A text fragment extracted from the PDF itself (not a user element). */
export const NativeTextItemSchema = z.object({
  id: z.string(),
  /** PDF points, bottom-left origin — matches the editor coordinate system */
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Baseline offset from the box bottom */
  baselineOffset: z.number().nonnegative(),
  text: z.string(),
  fontSize: z.number().positive(),
  fontFamily: z.string(),
  bold: z.boolean(),
  italic: z.boolean(),
});
export type NativeTextItem = z.infer<typeof NativeTextItemSchema>;

export const PageSchema = z.object({
  /** UUID — never an array index */
  id: z.string().uuid(),
  /** Original 1-based page number in the source PDF; 0 = blank inserted page */
  sourceIndex: z.number().int().min(0),
  width: z.number().positive(), // PDF points
  height: z.number().positive(), // PDF points
  rotation: z.number().default(0), // 0 | 90 | 180 | 270
});
export type Page = z.infer<typeof PageSchema>;

// ---------------------------------------------------------------------------
// PDF service API contracts
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const ALLOWED_MIME_TYPES = ['application/pdf'] as const;

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
export type CompressRequest = z.infer<typeof CompressRequestSchema>;

/** POST /pdf/merge — files arrive as multipart parts; this describes the JSON side */
export const MergeRequestSchema = z.object({
  files: z.array(PdfFileMetaSchema).min(2).max(20),
});
export type MergeRequest = z.infer<typeof MergeRequestSchema>;

/** POST /pdf/split */
export const SplitRequestSchema = z.object({
  file: PdfFileMetaSchema,
  /** 1-based page ranges, e.g. [{ from: 1, to: 3 }] */
  ranges: z
    .array(
      z.object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(50),
});
export type SplitRequest = z.infer<typeof SplitRequestSchema>;

/** Standard error envelope returned by the API */
export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ---------------------------------------------------------------------------
// PDFEDI embedded state package (re-editable PDF via attachments)
//
// A downloaded PDF carries:
//   - "PDFEDI_STATE.json" — this manifest (current active objects)
//   - "PDFEDI_SOURCE.pdf" — the clean original source PDF
//   - "PDFEDI_ASSET_<id>.<ext>" — image/signature binaries referenced below
// No database, no server storage: everything travels inside the one PDF.
// ---------------------------------------------------------------------------

/** Attachment filenames inside the exported PDF. */
export const PDFEDI_MANIFEST_NAME = 'PDFEDI_STATE.json';
export const PDFEDI_SOURCE_NAME = 'PDFEDI_SOURCE.pdf';
export const PDFEDI_ASSET_PREFIX = 'PDFEDI_ASSET_';
export const PDFEDI_MANIFEST_VERSION = 1;
/** Upper bounds for untrusted manifest data (DoS protection). */
export const PDFEDI_MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
export const PDFEDI_MAX_ELEMENTS = 10_000;
export const PDFEDI_MAX_ASSETS = 500;

const ManifestPageSchema = z.object({
  id: z.string().uuid(),
  sourceIndex: z.number().int().min(0),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
  rotation: z.number().finite().default(0),
});
export type ManifestPage = z.infer<typeof ManifestPageSchema>;

// Image/signature elements reference an embedded binary attachment instead
// of carrying a (possibly blob:) URL that cannot survive a download.
const ManifestImageElementSchema = ImageElementSchema.omit({ src: true }).extend({
  /** Attachment filename, e.g. "PDFEDI_ASSET_<uuid>.png" */
  assetRef: z.string().min(1).max(128),
});
const ManifestSignatureElementSchema = SignatureElementSchema.omit({ src: true }).extend({
  assetRef: z.string().min(1).max(128),
});
const ManifestElementSchema = z.discriminatedUnion('kind', [
  TextElementSchema,
  ManifestImageElementSchema,
  HighlightElementSchema,
  ManifestSignatureElementSchema,
  ShapeElementSchema,
  NativeTextElementSchema,
]);
export type ManifestElement = z.infer<typeof ManifestElementSchema>;

export const PdfediManifestSchema = z.object({
  /** Format identifier so future versions can recognise this file */
  format: z.literal('pdfedi-state'),
  /** Schema version — readers must reject unknown versions */
  version: z.literal(PDFEDI_MANIFEST_VERSION),
  /** SHA-256 hex of the clean source PDF this manifest belongs to */
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** ISO-8601 export timestamp */
  exportedAt: z.string().datetime(),
  /** Current page order (UUIDs preserved across round trips) */
  pages: z.array(ManifestPageSchema).min(1).max(5000),
  /** Current active objects only — no history, no deleted objects */
  elements: z.array(ManifestElementSchema).max(PDFEDI_MAX_ELEMENTS),
  /** Binary assets embedded alongside the manifest */
  assets: z
    .array(
      z.object({
        /** Attachment filename referenced by assetRef */
        name: z.string().min(1).max(128),
        /** UUID of the element that uses this asset */
        elementId: z.string().uuid(),
        mime: z.string().min(1).max(64),
      }),
    )
    .max(PDFEDI_MAX_ASSETS),
});
export type PdfediManifest = z.infer<typeof PdfediManifestSchema>;

// ---------------------------------------------------------------------------
// Command-based history entries
// ---------------------------------------------------------------------------

export interface HistoryCommand {
  /** Unique ID linking this command to its HistoryRecord */
  id: string;
  /** Human-readable label, e.g. "Add text" */
  label: string;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  /**
   * Merge key for drag sessions: consecutive commands carrying the same key
   * are folded into one entry so a single drag = a single undo step.
   */
  mergeKey?: string;
  /** Optional metadata for history panel (not used by undo/redo) */
  meta?: {
    actionType: string;
    pageId?: string;
    objectIds?: string[];
  };
}

/** Serializable metadata for a history entry (for history panel, persistence). */
export interface HistoryRecord {
  id: string;
  /** ID of the HistoryCommand this record corresponds to (stable across splices) */
  commandId: string;
  /** Machine-readable action type, e.g. "add-element", "move-element", "rotate-page" */
  actionType: string;
  label: string;
  timestamp: number;
  /** 1-based page number at time of action, if applicable */
  pageNumber?: number;
  pageId?: string;
  /** IDs of affected elements, if applicable */
  objectIds?: string[];
  /** Index in the past[] array this record corresponds to */
  commandIndex: number;
}
