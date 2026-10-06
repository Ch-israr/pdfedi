// Static tool catalog for landing page cards and static route generation.
// Full specs (options etc.) come from the API at runtime.
export interface ToolCard {
  key: string;
  name: string;
  tagline: string;
  icon: string;
}

export const TOOL_CARDS: ToolCard[] = [
  { key: "merge", name: "Merge PDF", tagline: "Combine multiple PDFs into one", icon: "📚" },
  { key: "split", name: "Split PDF", tagline: "Split a PDF into separate files", icon: "✂️" },
  { key: "compress", name: "Compress PDF", tagline: "Reduce PDF file size", icon: "🗜️" },
  { key: "rotate_pages", name: "Rotate Pages", tagline: "Rotate PDF pages", icon: "🔄" },
  { key: "delete_pages", name: "Delete Pages", tagline: "Remove pages from a PDF", icon: "🗑️" },
  { key: "reorder_pages", name: "Reorder Pages", tagline: "Rearrange page order", icon: "🔀" },
  { key: "extract_text", name: "Extract Text", tagline: "Get text out of a PDF", icon: "📝" },
  { key: "pdf_to_images", name: "PDF to Images", tagline: "Convert pages to images", icon: "🖼️" },
  { key: "images_to_pdf", name: "Images to PDF", tagline: "Make a PDF from images", icon: "📷" },
  { key: "thumbnails", name: "Thumbnails", tagline: "Page thumbnail contact sheet", icon: "🎞️" },
  { key: "metadata", name: "View Metadata", tagline: "Inspect PDF metadata", icon: "🔍" },
  { key: "edit_metadata", name: "Edit Metadata", tagline: "Update title, author and more", icon: "✏️" },
  { key: "password_protect", name: "Protect PDF", tagline: "Add a password to a PDF", icon: "🔒" },
  { key: "watermark", name: "Watermark", tagline: "Stamp text on every page", icon: "💧" },
  { key: "page_numbers", name: "Page Numbers", tagline: "Add page numbers", icon: "🔢" },
  { key: "redact", name: "Redact", tagline: "Permanently black out text", icon: "⬛" },
  { key: "flatten", name: "Flatten PDF", tagline: "Bake annotations into pages", icon: "🧱" },
  { key: "ocr", name: "OCR", tagline: "Make scanned PDFs searchable", icon: "👁️" },
];

export const TOOL_SLUGS = TOOL_CARDS.map((t) => t.key);
