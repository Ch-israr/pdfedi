// Static tool catalog for landing page cards and static route generation.
// Full specs (options etc.) come from the API at runtime.
export interface ToolCard {
  key: string;
  name: string;
  tagline: string;
  icon: string;
  category: string; // organize | convert | edit | optimize | security
}

export interface Category {
  key: string;
  name: string;
  tagline: string;
  icon: string;
}

export const CATEGORIES: Category[] = [
  { key: "organize", name: "Organize", tagline: "Merge, split and rearrange pages", icon: "📑" },
  { key: "convert", name: "Convert", tagline: "Turn PDFs into other formats and back", icon: "🔄" },
  { key: "edit", name: "Edit", tagline: "Tweak content and document info", icon: "✏️" },
  { key: "optimize", name: "Optimize", tagline: "Make files smaller and faster", icon: "🗜️" },
  { key: "security", name: "Security", tagline: "Protect, unlock and finalize documents", icon: "🔒" },
];

export const TOOL_CARDS: ToolCard[] = [
  { key: "merge", name: "Merge PDF", tagline: "Combine multiple PDFs into one", icon: "📚", category: "organize" },
  { key: "split", name: "Split PDF", tagline: "Split a PDF into separate files", icon: "✂️", category: "organize" },
  { key: "rotate_pages", name: "Rotate Pages", tagline: "Rotate PDF pages", icon: "🔄", category: "organize" },
  { key: "delete_pages", name: "Delete Pages", tagline: "Remove pages from a PDF", icon: "🗑️", category: "organize" },
  { key: "reorder_pages", name: "Reorder Pages", tagline: "Rearrange page order", icon: "🔀", category: "organize" },
  { key: "extract_text", name: "Extract Text", tagline: "Get text out of a PDF", icon: "📝", category: "convert" },
  { key: "pdf_to_images", name: "PDF to Images", tagline: "Convert pages to images", icon: "🖼️", category: "convert" },
  { key: "images_to_pdf", name: "Images to PDF", tagline: "Make a PDF from images", icon: "📷", category: "convert" },
  { key: "thumbnails", name: "Thumbnails", tagline: "Page thumbnail contact sheet", icon: "🎞️", category: "convert" },
  { key: "ocr", name: "OCR", tagline: "Make scanned PDFs searchable", icon: "👁️", category: "convert" },
  { key: "metadata", name: "View Metadata", tagline: "Inspect PDF metadata", icon: "🔍", category: "edit" },
  { key: "edit_metadata", name: "Edit Metadata", tagline: "Update title, author and more", icon: "✏️", category: "edit" },
  { key: "watermark", name: "Watermark", tagline: "Stamp text on every page", icon: "💧", category: "edit" },
  { key: "page_numbers", name: "Page Numbers", tagline: "Add page numbers", icon: "🔢", category: "edit" },
  { key: "compress", name: "Compress PDF", tagline: "Reduce PDF file size", icon: "🗜️", category: "optimize" },
  { key: "password_protect", name: "Protect PDF", tagline: "Add a password to a PDF", icon: "🔒", category: "security" },
  { key: "unlock_pdf", name: "Unlock PDF", tagline: "Remove password protection", icon: "🔓", category: "security" },
  { key: "redact", name: "Redact", tagline: "Permanently black out text", icon: "⬛", category: "security" },
  { key: "flatten", name: "Flatten PDF", tagline: "Bake annotations into pages", icon: "🧱", category: "security" },
];

export const TOOL_SLUGS = TOOL_CARDS.map((t) => t.key);
