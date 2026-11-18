// Static tool catalog for route generation and page structure.
// Display strings (names, taglines) live in the messages dictionaries
// (tools/categories namespaces) so every locale renders them translated.
// Full specs (options etc.) come from the API at runtime.
export interface ToolCard {
  key: string;
  icon: string;
  category: string; // organize | convert | edit | optimize | security | legal
}

export interface Category {
  key: string;
  icon: string;
}

export const CATEGORIES: Category[] = [
  { key: "organize", icon: "📑" },
  { key: "convert", icon: "🔄" },
  { key: "edit", icon: "✏️" },
  { key: "optimize", icon: "🗜️" },
  { key: "security", icon: "🔒" },
  { key: "legal", icon: "⚖️" },
];

export const TOOL_CARDS: ToolCard[] = [
  { key: "merge", icon: "📚", category: "organize" },
  { key: "split", icon: "✂️", category: "organize" },
  { key: "rotate_pages", icon: "🔄", category: "organize" },
  { key: "delete_pages", icon: "🗑️", category: "organize" },
  { key: "reorder_pages", icon: "🔀", category: "organize" },
  { key: "n_up", icon: "🗂️", category: "organize" },
  { key: "extract_text", icon: "📝", category: "convert" },
  { key: "pdf_to_images", icon: "🖼️", category: "convert" },
  { key: "images_to_pdf", icon: "📷", category: "convert" },
  { key: "ocr", icon: "👁️", category: "convert" },
  { key: "pdf_to_word", icon: "📘", category: "convert" },
  { key: "metadata", icon: "🔍", category: "edit" },
  { key: "edit_metadata", icon: "✏️", category: "edit" },
  { key: "watermark", icon: "💧", category: "edit" },
  { key: "page_numbers", icon: "🔢", category: "edit" },
  { key: "crop", icon: "🔲", category: "edit" },
  { key: "grayscale", icon: "🩶", category: "optimize" },
  { key: "compress", icon: "🗜️", category: "optimize" },
  { key: "repair", icon: "🛠️", category: "optimize" },
  { key: "password_protect", icon: "🔒", category: "security" },
  { key: "unlock_pdf", icon: "🔓", category: "security" },
  { key: "redact", icon: "⬛", category: "security" },
  { key: "flatten", icon: "🧱", category: "security" },
  { key: "strip_image_metadata", icon: "📸", category: "security" },
  { key: "exhibit_combine", icon: "⚖️", category: "legal" },
  { key: "strip_metadata", icon: "🧹", category: "legal" },
];

export const TOOL_SLUGS = TOOL_CARDS.map((t) => t.key);

// Phase 1 organizer canvases (thumbnail-first workspaces). These slugs
// render OrganizerTool instead of the generic ToolRunner. Kept here
// (not in the client component) so the server tool page can branch on
// it — importing a value out of a "use client" module is not allowed.
export const ORGANIZER_TOOL_SLUGS = [
  "merge",
  "split",
  "rotate_pages",
  "delete_pages",
  "reorder_pages",
] as const;
