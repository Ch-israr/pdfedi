/** Tool metadata + params form definitions (pure data — safe to import anywhere). */

export type ParamField =
  | { name: string; label: string; type: "text"; placeholder?: string; required?: boolean; hint?: string }
  | { name: string; label: string; type: "password"; placeholder?: string; required?: boolean; hint?: string }
  | { name: string; label: string; type: "number"; min?: number; max?: number; default?: number; required?: boolean; hint?: string }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; default?: string; required?: boolean; hint?: string }
  | { name: string; label: string; type: "range"; min: number; max: number; step: number; default: number; required?: boolean; hint?: string };

export interface ToolMeta {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  accept: string;
  multiple: boolean;
  fields: ParamField[];
  outputHint: string;
}

export const TOOL_CATEGORIES = [
  "Organize",
  "Convert",
  "Optimize",
  "Edit",
  "Security",
  "View",
] as const;

export const TOOLS: ToolMeta[] = [
  {
    key: "merge",
    name: "Merge PDFs",
    description: "Combine multiple PDF files into one document, in the order you choose.",
    icon: "▣",
    category: "Organize",
    accept: ".pdf,application/pdf",
    multiple: true,
    fields: [],
    outputHint: "One merged PDF file.",
  },
  {
    key: "split",
    name: "Split PDF",
    description: "Extract page ranges into separate PDFs, or split every N pages.",
    icon: "◫",
    category: "Organize",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "mode", label: "Split mode", type: "select", default: "ranges", options: [
        { value: "ranges", label: "Page ranges" },
        { value: "every_n", label: "Every N pages" },
      ]},
      { name: "ranges", label: "Ranges", type: "text", placeholder: "1-3, 5, 8-10", hint: "Used in “Page ranges” mode. Example: 1-3, 5" },
      { name: "every_n", label: "Pages per file", type: "number", min: 1, max: 1000, default: 1, hint: "Used in “Every N pages” mode." },
    ],
    outputHint: "One PDF per range or chunk.",
  },
  {
    key: "reorder_pages",
    name: "Reorder Pages",
    description: "Rearrange pages into any order you like.",
    icon: "⇄",
    category: "Organize",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "order", label: "New page order", type: "text", placeholder: "3, 1, 2", required: true, hint: "Comma-separated page numbers, e.g. 3, 1, 2" },
    ],
    outputHint: "PDF with pages in your order.",
  },
  {
    key: "rotate_pages",
    name: "Rotate Pages",
    description: "Rotate all pages or a selected range by 90°, 180° or 270°.",
    icon: "⟳",
    category: "Organize",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "rotation", label: "Rotation", type: "select", default: "90", options: [
        { value: "90", label: "90° clockwise" },
        { value: "180", label: "180°" },
        { value: "270", label: "270° clockwise (90° counter-clockwise)" },
      ]},
      { name: "pages", label: "Pages (optional)", type: "text", placeholder: "1-3, 5", hint: "Leave empty to rotate all pages." },
    ],
    outputHint: "PDF with rotated pages.",
  },
  {
    key: "delete_pages",
    name: "Delete Pages",
    description: "Remove unwanted pages from your PDF.",
    icon: "🗑",
    category: "Organize",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "pages", label: "Pages to delete", type: "text", placeholder: "2, 4-5", required: true, hint: "Example: 2, 4-5" },
    ],
    outputHint: "PDF without the deleted pages.",
  },
  {
    key: "extract_text",
    name: "Extract Text",
    description: "Pull all text content out of a PDF into a plain text file.",
    icon: "≡",
    category: "Convert",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [],
    outputHint: "A .txt file with the extracted text.",
  },
  {
    key: "thumbnails",
    name: "PDF Thumbnails",
    description: "Generate PNG preview images for each page.",
    icon: "🖼",
    category: "View",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "width", label: "Thumbnail width (px)", type: "number", min: 50, max: 1200, default: 300 },
      { name: "pages", label: "Pages (optional)", type: "text", placeholder: "1-3", hint: "Leave empty for all pages." },
    ],
    outputHint: "PNG images, one per page.",
  },
  {
    key: "watermark",
    name: "Add Watermark",
    description: "Stamp a text watermark across every page.",
    icon: "©",
    category: "Edit",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "text", label: "Watermark text", type: "text", placeholder: "CONFIDENTIAL", required: true },
      { name: "opacity", label: "Opacity", type: "range", min: 0.05, max: 0.6, step: 0.05, default: 0.2 },
    ],
    outputHint: "PDF with watermark applied.",
  },
  {
    key: "password_protect",
    name: "Password Protect",
    description: "Encrypt your PDF with a password.",
    icon: "🔒",
    category: "Security",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "user_password", label: "Password", type: "password", placeholder: "Choose a strong password", required: true },
      { name: "owner_password", label: "Owner password (optional)", type: "password", placeholder: "Defaults to the same password" },
    ],
    outputHint: "Encrypted PDF.",
  },
  {
    key: "images_to_pdf",
    name: "Images to PDF",
    description: "Combine JPG/PNG images into a single PDF, one image per page.",
    icon: "📷",
    category: "Convert",
    accept: ".png,.jpg,.jpeg,.webp,image/*",
    multiple: true,
    fields: [],
    outputHint: "One PDF with each image on its own page.",
  },
  {
    key: "pdf_to_images",
    name: "PDF to Images",
    description: "Convert each PDF page into a PNG or JPEG image.",
    icon: "🎞",
    category: "Convert",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "format", label: "Image format", type: "select", default: "png", options: [
        { value: "png", label: "PNG" },
        { value: "jpeg", label: "JPEG" },
      ]},
      { name: "dpi", label: "Resolution (DPI)", type: "number", min: 72, max: 300, default: 150 },
    ],
    outputHint: "Image files, one per page.",
  },
  {
    key: "compress",
    name: "Compress PDF",
    description: "Reduce PDF file size while keeping it readable.",
    icon: "🗜",
    category: "Optimize",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "quality", label: "Compression level", type: "select", default: "medium", options: [
        { value: "low", label: "High compression (smaller file)" },
        { value: "medium", label: "Balanced" },
        { value: "high", label: "Light compression (better quality)" },
      ]},
    ],
    outputHint: "Smaller PDF file.",
  },
  {
    key: "metadata",
    name: "Inspect Metadata",
    description: "View a PDF's title, author, page count and other properties.",
    icon: "ℹ",
    category: "View",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [],
    outputHint: "A JSON report of the document metadata.",
  },
  {
    key: "ocr",
    name: "OCR — Searchable PDF",
    description: "Run OCR on scanned PDFs to make the text selectable and searchable.",
    icon: "🔍",
    category: "Convert",
    accept: ".pdf,application/pdf",
    multiple: false,
    fields: [
      { name: "language", label: "Document language", type: "select", default: "eng", options: [
        { value: "eng", label: "English" },
        { value: "fra", label: "French" },
        { value: "deu", label: "German" },
        { value: "spa", label: "Spanish" },
        { value: "ara", label: "Arabic" },
        { value: "urd", label: "Urdu" },
      ]},
    ],
    outputHint: "Searchable PDF with an invisible text layer.",
  },
];

export function getToolMeta(key: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.key === key);
}
