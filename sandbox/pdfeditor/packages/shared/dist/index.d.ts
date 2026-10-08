/**
 * @pdfeditor/shared
 *
 * Single source of truth for API contracts, JWT claims, and domain types.
 * Used by both apps/web and apps/api — change here, both sides stay in sync.
 */
import { z } from 'zod';
export declare const JwtClaimsSchema: z.ZodObject<{
    /** Subject — the user id in FastAPI */
    sub: z.ZodString;
    /** Subscription plan, e.g. "free" | "pro" */
    plan: z.ZodDefault<z.ZodString>;
    /** Issued-at (seconds since epoch) */
    iat: z.ZodOptional<z.ZodNumber>;
    /** Expiry (seconds since epoch) */
    exp: z.ZodNumber;
    /** Optional scopes granted to this token */
    scopes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    sub: string;
    plan: string;
    exp: number;
    iat?: number | undefined;
    scopes?: string[] | undefined;
}, {
    sub: string;
    exp: number;
    plan?: string | undefined;
    iat?: number | undefined;
    scopes?: string[] | undefined;
}>;
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;
export declare const UsageMetadataSchema: z.ZodObject<{
    tool: z.ZodString;
    fileSize: z.ZodNumber;
    pageCount: z.ZodNumber;
    timestamp: z.ZodString;
    userId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    tool: string;
    fileSize: number;
    pageCount: number;
    timestamp: string;
    userId: string;
}, {
    tool: string;
    fileSize: number;
    pageCount: number;
    timestamp: string;
    userId: string;
}>;
export type UsageMetadata = z.infer<typeof UsageMetadataSchema>;
export declare const ElementKindSchema: z.ZodEnum<["text", "image", "highlight", "signature", "shape"]>;
export type ElementKind = z.infer<typeof ElementKindSchema>;
export declare const TextElementSchema: z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"text">;
    text: z.ZodString;
    fontSize: z.ZodDefault<z.ZodNumber>;
    fontFamily: z.ZodDefault<z.ZodString>;
    color: z.ZodDefault<z.ZodString>;
    bold: z.ZodDefault<z.ZodBoolean>;
    italic: z.ZodDefault<z.ZodBoolean>;
    width: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    text: string;
    id: string;
    pageId: string;
    kind: "text";
    x: number;
    y: number;
    rotation: number;
    fontSize: number;
    fontFamily: string;
    color: string;
    bold: boolean;
    italic: boolean;
    width?: number | undefined;
}, {
    text: string;
    id: string;
    pageId: string;
    kind: "text";
    x: number;
    y: number;
    rotation?: number | undefined;
    fontSize?: number | undefined;
    fontFamily?: string | undefined;
    color?: string | undefined;
    bold?: boolean | undefined;
    italic?: boolean | undefined;
    width?: number | undefined;
}>;
export declare const ImageElementSchema: z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"image">;
    src: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
    mime: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    pageId: string;
    kind: "image";
    x: number;
    y: number;
    rotation: number;
    width: number;
    src: string;
    height: number;
    mime: string;
}, {
    id: string;
    pageId: string;
    kind: "image";
    x: number;
    y: number;
    width: number;
    src: string;
    height: number;
    mime: string;
    rotation?: number | undefined;
}>;
export declare const HighlightElementSchema: z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"highlight">;
    width: z.ZodNumber;
    height: z.ZodNumber;
    color: z.ZodDefault<z.ZodString>;
    opacity: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    pageId: string;
    kind: "highlight";
    x: number;
    y: number;
    rotation: number;
    color: string;
    width: number;
    height: number;
    opacity: number;
}, {
    id: string;
    pageId: string;
    kind: "highlight";
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number | undefined;
    color?: string | undefined;
    opacity?: number | undefined;
}>;
export declare const SignatureElementSchema: z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"signature">;
    src: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    pageId: string;
    kind: "signature";
    x: number;
    y: number;
    rotation: number;
    width: number;
    src: string;
    height: number;
}, {
    id: string;
    pageId: string;
    kind: "signature";
    x: number;
    y: number;
    width: number;
    src: string;
    height: number;
    rotation?: number | undefined;
}>;
export declare const ShapeElementSchema: z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"shape">;
    shape: z.ZodEnum<["rect", "ellipse", "line", "arrow"]>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    stroke: z.ZodDefault<z.ZodString>;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    fill: string | null;
    shape: "rect" | "ellipse" | "line" | "arrow";
    id: string;
    pageId: string;
    kind: "shape";
    x: number;
    y: number;
    rotation: number;
    width: number;
    height: number;
    stroke: string;
    strokeWidth: number;
}, {
    shape: "rect" | "ellipse" | "line" | "arrow";
    id: string;
    pageId: string;
    kind: "shape";
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string | null | undefined;
    rotation?: number | undefined;
    stroke?: string | undefined;
    strokeWidth?: number | undefined;
}>;
export declare const EditorElementSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"text">;
    text: z.ZodString;
    fontSize: z.ZodDefault<z.ZodNumber>;
    fontFamily: z.ZodDefault<z.ZodString>;
    color: z.ZodDefault<z.ZodString>;
    bold: z.ZodDefault<z.ZodBoolean>;
    italic: z.ZodDefault<z.ZodBoolean>;
    width: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    text: string;
    id: string;
    pageId: string;
    kind: "text";
    x: number;
    y: number;
    rotation: number;
    fontSize: number;
    fontFamily: string;
    color: string;
    bold: boolean;
    italic: boolean;
    width?: number | undefined;
}, {
    text: string;
    id: string;
    pageId: string;
    kind: "text";
    x: number;
    y: number;
    rotation?: number | undefined;
    fontSize?: number | undefined;
    fontFamily?: string | undefined;
    color?: string | undefined;
    bold?: boolean | undefined;
    italic?: boolean | undefined;
    width?: number | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"image">;
    src: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
    mime: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    pageId: string;
    kind: "image";
    x: number;
    y: number;
    rotation: number;
    width: number;
    src: string;
    height: number;
    mime: string;
}, {
    id: string;
    pageId: string;
    kind: "image";
    x: number;
    y: number;
    width: number;
    src: string;
    height: number;
    mime: string;
    rotation?: number | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"highlight">;
    width: z.ZodNumber;
    height: z.ZodNumber;
    color: z.ZodDefault<z.ZodString>;
    opacity: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    pageId: string;
    kind: "highlight";
    x: number;
    y: number;
    rotation: number;
    color: string;
    width: number;
    height: number;
    opacity: number;
}, {
    id: string;
    pageId: string;
    kind: "highlight";
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number | undefined;
    color?: string | undefined;
    opacity?: number | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"signature">;
    src: z.ZodString;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    pageId: string;
    kind: "signature";
    x: number;
    y: number;
    rotation: number;
    width: number;
    src: string;
    height: number;
}, {
    id: string;
    pageId: string;
    kind: "signature";
    x: number;
    y: number;
    width: number;
    src: string;
    height: number;
    rotation?: number | undefined;
}>, z.ZodObject<{
    id: z.ZodString;
    pageId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
} & {
    kind: z.ZodLiteral<"shape">;
    shape: z.ZodEnum<["rect", "ellipse", "line", "arrow"]>;
    width: z.ZodNumber;
    height: z.ZodNumber;
    stroke: z.ZodDefault<z.ZodString>;
    strokeWidth: z.ZodDefault<z.ZodNumber>;
    fill: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    fill: string | null;
    shape: "rect" | "ellipse" | "line" | "arrow";
    id: string;
    pageId: string;
    kind: "shape";
    x: number;
    y: number;
    rotation: number;
    width: number;
    height: number;
    stroke: string;
    strokeWidth: number;
}, {
    shape: "rect" | "ellipse" | "line" | "arrow";
    id: string;
    pageId: string;
    kind: "shape";
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string | null | undefined;
    rotation?: number | undefined;
    stroke?: string | undefined;
    strokeWidth?: number | undefined;
}>]>;
export type EditorElement = z.infer<typeof EditorElementSchema>;
export declare const PageSchema: z.ZodObject<{
    /** UUID — never an array index */
    id: z.ZodString;
    /** Original 1-based page number in the source PDF */
    sourceIndex: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    rotation: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    id: string;
    rotation: number;
    width: number;
    height: number;
    sourceIndex: number;
}, {
    id: string;
    width: number;
    height: number;
    sourceIndex: number;
    rotation?: number | undefined;
}>;
export type Page = z.infer<typeof PageSchema>;
export declare const MAX_UPLOAD_BYTES: number;
export declare const ALLOWED_MIME_TYPES: readonly ["application/pdf"];
/** POST /pdf/compress */
export declare const CompressRequestSchema: z.ZodObject<{
    file: z.ZodObject<{
        fileName: z.ZodString;
        fileSize: z.ZodNumber;
        mimeType: z.ZodEnum<["application/pdf"]>;
    }, "strip", z.ZodTypeAny, {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }, {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }>;
    /** Target quality hint; service picks the strategy */
    quality: z.ZodDefault<z.ZodEnum<["low", "medium", "high"]>>;
}, "strip", z.ZodTypeAny, {
    file: {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    };
    quality: "low" | "medium" | "high";
}, {
    file: {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    };
    quality?: "low" | "medium" | "high" | undefined;
}>;
export type CompressRequest = z.infer<typeof CompressRequestSchema>;
/** POST /pdf/merge — files arrive as multipart parts; this describes the JSON side */
export declare const MergeRequestSchema: z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        fileName: z.ZodString;
        fileSize: z.ZodNumber;
        mimeType: z.ZodEnum<["application/pdf"]>;
    }, "strip", z.ZodTypeAny, {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }, {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    files: {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }[];
}, {
    files: {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }[];
}>;
export type MergeRequest = z.infer<typeof MergeRequestSchema>;
/** POST /pdf/split */
export declare const SplitRequestSchema: z.ZodObject<{
    file: z.ZodObject<{
        fileName: z.ZodString;
        fileSize: z.ZodNumber;
        mimeType: z.ZodEnum<["application/pdf"]>;
    }, "strip", z.ZodTypeAny, {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }, {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    }>;
    /** 1-based page ranges, e.g. [{ from: 1, to: 3 }] */
    ranges: z.ZodArray<z.ZodObject<{
        from: z.ZodNumber;
        to: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        from: number;
        to: number;
    }, {
        from: number;
        to: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    file: {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    };
    ranges: {
        from: number;
        to: number;
    }[];
}, {
    file: {
        fileSize: number;
        fileName: string;
        mimeType: "application/pdf";
    };
    ranges: {
        from: number;
        to: number;
    }[];
}>;
export type SplitRequest = z.infer<typeof SplitRequestSchema>;
/** Standard error envelope returned by the API */
export declare const ApiErrorSchema: z.ZodObject<{
    error: z.ZodString;
    code: z.ZodString;
    details: z.ZodOptional<z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    code: string;
    error: string;
    details?: unknown;
}, {
    code: string;
    error: string;
    details?: unknown;
}>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export interface HistoryCommand {
    /** Human-readable label, e.g. "Add text" */
    label: string;
    undo(): void | Promise<void>;
    redo(): void | Promise<void>;
}
//# sourceMappingURL=index.d.ts.map