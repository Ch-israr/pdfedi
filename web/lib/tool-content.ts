// SEO content library for tool pages.
// Each entry is unique, tool-specific, and describes actual functionality.
// Do not copy content between tools.

export interface ToolFaq {
  q: string;
  a: string;
}

export interface ToolContent {
  key: string;
  /** <title> — ~50-60 chars, unique per tool */
  title: string;
  /** meta description — ~150-160 chars, unique per tool */
  description: string;
  h1: string;
  /** 2-3 sentence introduction: what it does, problem it solves */
  intro: string;
  /** Step-by-step based on the actual UI flow */
  howTo: string[];
  /** Only features that actually exist */
  features: string[];
  /** Realistic scenarios */
  useCases: string[];
  faqs: ToolFaq[];
  /** Related tool keys for internal linking (must exist in TOOL_CARDS) */
  related: string[];
}

const PRIVACY_LINE =
  "Files are processed securely and deleted automatically. No sign-up required.";

export const TOOL_CONTENT: Record<string, ToolContent> = {
  merge: {
    key: "merge",
    title: "Merge PDF Files Online Free — Combine PDFs | PDFEDI",
    description:
      "Merge PDF files into one document online for free. Combine 2–20 PDFs in any order. No sign-up, no watermarks, 50MB limit.",
    h1: "Merge PDFs",
    intro:
      "Combine multiple PDF files into a single, well-ordered document. Upload 2 to 20 PDFs, arrange them the way you want, and download one clean merged file — perfect for reports, applications, and paperwork that arrives in pieces.",
    howTo: [
      "Upload 2 to 20 PDF files (up to 50MB each).",
      "The files are merged in upload order.",
      "Click Merge and wait for processing to finish.",
      "Download your combined PDF.",
    ],
    features: [
      "Combine 2–20 PDF files into one",
      "Preserves original page quality and formatting",
      "Free with no watermarks",
      "Works on desktop, tablet, and mobile",
    ],
    useCases: [
      "Combine chapters or sections into a finished report",
      "Merge invoices or receipts into a single file for accounting",
      "Join application documents (CV, cover letter, certificates) into one PDF",
      "Consolidate scanned pages into one document",
    ],
    faqs: [
      {
        q: "How do I merge multiple PDF files?",
        a: "Upload 2 to 20 PDF files to the Merge PDF tool, then click Merge. Your files are combined into a single PDF in upload order, ready to download.",
      },
      {
        q: "How many PDF files can I merge at once?",
        a: "You can merge between 2 and 20 PDF files in a single job. Each file can be up to 50MB.",
      },
      {
        q: "Will merging PDFs reduce their quality?",
        a: "No. Merging only rearranges pages into one file — the content, images, and text of each PDF are preserved exactly as they were.",
      },
      {
        q: "Can I merge a password-protected PDF?",
        a: "Password-protected PDFs must be unlocked first. Use the Unlock PDF tool with the correct password, then merge the unlocked file.",
      },
      {
        q: "Is it free to merge PDFs online?",
        a: `Yes. Merging PDFs on PDFEDI is completely free with no watermarks and no sign-up. ${PRIVACY_LINE}`,
      },
    ],
    related: ["split", "reorder_pages", "delete_pages", "compress"],
  },

  split: {
    key: "split",
    title: "Split PDF Online Free — Divide PDF into Files | PDFEDI",
    description:
      "Split a PDF into separate files online for free. Extract page ranges or split every page. No sign-up, download as ZIP.",
    h1: "Split PDF",
    intro:
      "Divide a PDF into multiple smaller files. Extract specific page ranges (for example pages 1–3 and 5) or split every page into its own PDF. Results are delivered as a convenient ZIP download.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Choose a mode: page ranges (e.g. 1-3,5) or every page separately.",
      "If using ranges, enter them like 1-3,5.",
      "Click Split and download the ZIP containing your files.",
    ],
    features: [
      "Split by custom page ranges (e.g. 1-3,5)",
      "Split every page into its own PDF",
      "Results delivered as a ZIP archive",
      "Original quality preserved",
    ],
    useCases: [
      "Extract a chapter from an ebook",
      "Separate a scanned batch into individual documents",
      "Pull out specific pages to share or print",
      "Break a large PDF into emailable chunks",
    ],
    faqs: [
      {
        q: "How do I split a PDF into separate files?",
        a: "Upload your PDF, choose 'ranges' mode and enter page ranges like 1-3,5, or choose 'every' to make each page its own file. Click Split and download the ZIP.",
      },
      {
        q: "What page range format should I use?",
        a: "Use 1-based page numbers with commas and dashes, for example 1-3,5,8-10. This extracts pages 1, 2, 3, 5, 8, 9, and 10.",
      },
      {
        q: "Can I split a PDF into individual pages?",
        a: "Yes. Select the 'every' mode and each page of your PDF becomes a separate PDF file inside the ZIP download.",
      },
      {
        q: "Is there a page limit for splitting?",
        a: "There's no fixed page limit, but the 50MB upload cap applies. Very large PDFs are processed page by page to stay within server memory.",
      },
    ],
    related: ["merge", "delete_pages", "extract_text", "compress"],
  },

  rotate_pages: {
    key: "rotate_pages",
    title: "Rotate PDF Pages Online Free | PDFEDI",
    description:
      "Rotate PDF pages 90°, 180°, or 270° online for free. Fix sideways scans. Apply to all pages or selected ranges.",
    h1: "Rotate Pages",
    intro:
      "Fix sideways or upside-down PDF pages. Rotate all pages or just selected page ranges by 90, 180, or 270 degrees — ideal for scanned documents that came out with the wrong orientation.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Choose the rotation angle: 90°, 180°, or 270°.",
      "Optionally limit rotation to specific pages (e.g. 1-3,5). Leave empty for all pages.",
      "Click Rotate and download the corrected PDF.",
    ],
    features: [
      "Rotate 90°, 180°, or 270°",
      "Apply to all pages or selected page ranges",
      "Fixes sideways scanned documents",
      "No quality loss",
    ],
    useCases: [
      "Correct pages scanned in landscape instead of portrait",
      "Fix upside-down pages in a scanned batch",
      "Rotate a single sideways page without affecting the rest",
      "Standardize orientation before merging documents",
    ],
    faqs: [
      {
        q: "How do I rotate a PDF page?",
        a: "Upload your PDF, pick 90°, 180°, or 270°, optionally enter page ranges like 2-4, then click Rotate. Leave the pages field empty to rotate every page.",
      },
      {
        q: "Can I rotate only some pages of a PDF?",
        a: "Yes. Enter 1-based page ranges such as 1-3,5 and only those pages are rotated. All other pages stay as they are.",
      },
      {
        q: "Will rotating reduce PDF quality?",
        a: "No. Rotation changes the page orientation metadata and content positioning — your text and images keep their original quality.",
      },
    ],
    related: ["delete_pages", "reorder_pages", "merge", "split"],
  },

  delete_pages: {
    key: "delete_pages",
    title: "Delete PDF Pages Online Free — Remove Pages | PDFEDI",
    description:
      "Delete pages from a PDF online for free. Remove unwanted pages by range. No sign-up, original quality kept.",
    h1: "Delete Pages",
    intro:
      "Remove unwanted pages from your PDF. Enter the page ranges to delete — like 2, 5-7 — and download a clean PDF with only the pages you want to keep.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Enter the pages to delete using ranges like 1-3,5.",
      "Click Delete Pages and download the result.",
    ],
    features: [
      "Delete pages by range (e.g. 1-3,5)",
      "Remaining pages keep original quality and order",
      "Free with no watermarks",
    ],
    useCases: [
      "Remove blank or duplicate pages from a scan",
      "Cut advertisement pages from a downloaded document",
      "Trim a report down to the relevant sections",
      "Clean up a PDF before sharing or printing",
    ],
    faqs: [
      {
        q: "How do I delete pages from a PDF?",
        a: "Upload your PDF, enter the 1-based page numbers or ranges to remove (for example 2,5-7), and click Delete Pages. The remaining pages are saved in their original order.",
      },
      {
        q: "Can I delete multiple non-consecutive pages?",
        a: "Yes. Separate pages and ranges with commas, like 1,3,5-8, to delete them all in one go.",
      },
      {
        q: "Does deleting pages affect the rest of the document?",
        a: "No. The pages you keep are untouched — same content, same order, same quality.",
      },
    ],
    related: ["split", "reorder_pages", "rotate_pages", "merge"],
  },

  reorder_pages: {
    key: "reorder_pages",
    title: "Reorder PDF Pages Online Free — Rearrange Pages | PDFEDI",
    description:
      "Rearrange PDF pages into any order online for free. Fix page sequence without re-scanning. No sign-up.",
    h1: "Reorder Pages",
    intro:
      "Put your PDF pages in the right order. Specify the new page sequence and get a PDF with pages rearranged exactly as you want — no need to re-scan or rebuild the document.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Enter the new page order as comma-separated page numbers (e.g. 3,1,2,4).",
      "Click Reorder and download the rearranged PDF.",
    ],
    features: [
      "Rearrange pages into any sequence",
      "Simple comma-separated page order input",
      "Content and quality fully preserved",
    ],
    useCases: [
      "Fix pages scanned in the wrong order",
      "Move the table of contents or cover to the front",
      "Reorganize a report's sections",
      "Correct page sequence before printing",
    ],
    faqs: [
      {
        q: "How do I rearrange pages in a PDF?",
        a: "Upload your PDF and enter the desired page order as numbers separated by commas — for example 3,1,2,4 puts old page 3 first. Click Reorder to download.",
      },
      {
        q: "Do I need to list every page?",
        a: "Enter the full sequence of pages you want in the output. Pages not listed are not included, so list every page you want to keep.",
      },
      {
        q: "Will reordering change my PDF's quality?",
        a: "No. Pages are rearranged without touching their content, so quality is identical.",
      },
    ],
    related: ["merge", "split", "delete_pages", "rotate_pages"],
  },

  extract_text: {
    key: "extract_text",
    title: "Extract Text from PDF Online Free | PDFEDI",
    description:
      "Extract text from a PDF online for free. Get plain .txt output from any text-based PDF, all pages or selected ranges.",
    h1: "Extract Text",
    intro:
      "Pull the plain text out of any text-based PDF and download it as a .txt file. Choose all pages or specific ranges — handy for quoting, archiving, or feeding text into other tools.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Optionally enter page ranges (e.g. 1-3,5). Leave empty for all pages.",
      "Click Extract and download the .txt file.",
    ],
    features: [
      "Extract text to plain .txt format",
      "All pages or selected page ranges",
      "Fast — no OCR needed for text PDFs",
    ],
    useCases: [
      "Copy article text for quoting or citing",
      "Archive contract text in a searchable format",
      "Feed PDF content into translation tools",
      "Quickly check what a long PDF contains",
    ],
    faqs: [
      {
        q: "How do I extract text from a PDF?",
        a: "Upload your PDF and click Extract. You'll get a .txt file with the document's text. Optionally limit extraction to page ranges like 1-3,5.",
      },
      {
        q: "Does this work on scanned PDFs?",
        a: "Text extraction reads the PDF's built-in text layer, so it works on text-based PDFs. For scanned image-only PDFs, use the OCR tool first to add a searchable text layer, then extract.",
      },
      {
        q: "What format is the extracted text?",
        a: "Plain text (.txt), which opens in any text editor and works everywhere.",
      },
    ],
    related: ["ocr", "split", "metadata", "pdf_to_images"],
  },

  pdf_to_images: {
    key: "pdf_to_images",
    title: "Convert PDF to Images Online Free — PNG & JPG | PDFEDI",
    description:
      "Convert PDF pages to PNG or JPG images online for free. Choose resolution up to 300 DPI. Download as ZIP.",
    h1: "PDF to Images",
    intro:
      "Turn every page of your PDF into a high-quality PNG or JPEG image. Pick the output format and resolution (72–300 DPI), select pages or convert them all, and download everything as a ZIP.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Choose PNG or JPEG output and a resolution from 72 to 300 DPI.",
      "Optionally select page ranges (e.g. 1-3,5). Leave empty for all pages.",
      "Click Convert and download the ZIP of images.",
    ],
    features: [
      "PNG or JPEG output",
      "Adjustable resolution: 72–300 DPI",
      "Convert all pages or selected ranges",
      "ZIP download with one image per page",
    ],
    useCases: [
      "Create slide images from a PDF presentation",
      "Extract figures or diagrams as images",
      "Make thumbnails or previews of documents",
      "Share PDF pages on platforms that only accept images",
    ],
    faqs: [
      {
        q: "How do I convert a PDF to JPG or PNG?",
        a: "Upload your PDF, choose JPEG or PNG, set your preferred DPI (higher means sharper), and click Convert. You get a ZIP with one image per page.",
      },
      {
        q: "What DPI should I choose?",
        a: "72–100 DPI is fine for screen viewing, 150 DPI is a good all-rounder, and 300 DPI gives print-quality images (with larger file sizes).",
      },
      {
        q: "Can I convert only some pages to images?",
        a: "Yes — enter page ranges like 1-3,5 and only those pages are converted.",
      },
    ],
    related: ["images_to_pdf", "thumbnails", "extract_text", "compress"],
  },

  images_to_pdf: {
    key: "images_to_pdf",
    title: "Convert Images to PDF Online Free — JPG/PNG to PDF | PDFEDI",
    description:
      "Combine JPG, PNG, or WebP images into one PDF online for free. Up to 20 images per PDF. No sign-up.",
    h1: "Images to PDF",
    intro:
      "Combine up to 20 JPG, PNG, or WebP images into a single PDF document. Each image becomes a page — ideal for turning photo scans, screenshots, or artwork into a shareable PDF.",
    howTo: [
      "Upload 1 to 20 images (JPG, PNG, or WebP, up to 50MB total).",
      "Images become pages in upload order.",
      "Click Convert and download your PDF.",
    ],
    features: [
      "JPG, PNG, and WebP input",
      "Up to 20 images per PDF",
      "Each image becomes a full page",
      "Free with no watermarks",
    ],
    useCases: [
      "Turn phone photos of documents into a PDF",
      "Combine screenshots into a single file",
      "Create a PDF portfolio from artwork",
      "Archive whiteboard photos as a document",
    ],
    faqs: [
      {
        q: "How do I convert JPG to PDF?",
        a: "Upload your JPG images (up to 20), then click Convert. Each image becomes a page in the resulting PDF, in upload order.",
      },
      {
        q: "Which image formats are supported?",
        a: "JPG/JPEG, PNG, and WebP images are supported.",
      },
      {
        q: "How many images can I combine?",
        a: "Between 1 and 20 images per PDF.",
      },
      {
        q: "Will my images lose quality?",
        a: "Images are embedded at their original resolution — nothing is downsampled during conversion.",
      },
    ],
    related: ["pdf_to_images", "ocr", "merge", "compress"],
  },

  thumbnails: {
    key: "thumbnails",
    title: "PDF Thumbnails Online Free — Page Contact Sheet | PDFEDI",
    description:
      "Generate a thumbnail contact sheet of PDF pages online for free. Preview all pages in one PNG image.",
    h1: "Page Thumbnails",
    intro:
      "See every page of your PDF at a glance. This tool renders a contact sheet — a single PNG image with small thumbnails of your pages arranged in a grid. Choose the number of columns, thumbnail width, and which pages to include.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Set the number of columns, thumbnail width, and page ranges (optional).",
      "Click Generate and download the PNG contact sheet.",
    ],
    features: [
      "Contact sheet of all or selected pages",
      "Adjustable columns and thumbnail width",
      "Single PNG output",
      "Up to 50 thumbnails per sheet",
    ],
    useCases: [
      "Preview a long document's layout at a glance",
      "Check scan quality across all pages",
      "Create a visual index of a PDF",
      "Spot blank or damaged pages quickly",
    ],
    faqs: [
      {
        q: "What is a PDF thumbnail contact sheet?",
        a: "A single image showing small previews of many PDF pages arranged in a grid — like a photographer's contact sheet. It lets you scan a whole document visually in seconds.",
      },
      {
        q: "How many thumbnails can I generate?",
        a: "Up to 50 thumbnails per contact sheet.",
      },
      {
        q: "Can I choose which pages appear?",
        a: "Yes — enter page ranges like 1-10, or leave empty to include all pages.",
      },
    ],
    related: ["pdf_to_images", "split", "metadata", "compress"],
  },

  ocr: {
    key: "ocr",
    title: "OCR PDF Online Free — Make Scanned PDFs Searchable | PDFEDI",
    description:
      "Run OCR on scanned PDFs online for free. Add a searchable, selectable text layer while keeping the original look.",
    h1: "OCR to Searchable PDF",
    intro:
      "Make scanned PDFs searchable and selectable. Optical character recognition reads the text in your scanned pages and adds an invisible text layer — the pages look identical, but you can now search, select, and copy the text. Pages that already contain text are skipped automatically.",
    howTo: [
      "Upload your scanned PDF (up to 50MB).",
      "Choose the document language (e.g. eng, eng+deu).",
      "Click Run OCR and wait — scanned pages are processed one by one.",
      "Download your searchable PDF.",
    ],
    features: [
      "Searchable, selectable text layer on scanned pages",
      "Original page images preserved exactly",
      "Pages with existing text are skipped automatically",
      "Multiple OCR languages supported",
    ],
    useCases: [
      "Make scanned contracts searchable",
      "Digitize paper archives into searchable PDFs",
      "Enable text selection in scanned books",
      "Prepare scans for text extraction or indexing",
    ],
    faqs: [
      {
        q: "What does OCR do to a PDF?",
        a: "OCR (optical character recognition) analyzes the images in a scanned PDF, recognizes the text, and embeds an invisible text layer. The pages look the same, but the text becomes searchable and selectable.",
      },
      {
        q: "How long does OCR take?",
        a: "It depends on page count and content — scanned pages are processed individually. Pages that already have text are skipped instantly, so mixed documents finish much faster.",
      },
      {
        q: "Which languages are supported?",
        a: "Set the language option with a Tesseract language code such as eng for English or eng+deu for English and German combined.",
      },
      {
        q: "Will OCR change how my pages look?",
        a: "No. The original scanned images are kept as the visible pages; only an invisible text layer is added underneath.",
      },
      {
        q: "My PDF already has some text. Will it be re-OCRed?",
        a: "No — pages with a usable text layer are detected and copied through unchanged. Only image-only pages go through recognition.",
      },
    ],
    related: ["extract_text", "images_to_pdf", "pdf_to_images", "compress"],
  },

  metadata: {
    key: "metadata",
    title: "View PDF Metadata Online Free | PDFEDI",
    description:
      "Inspect a PDF's hidden metadata online for free. See title, author, creation date, page count, and more.",
    h1: "Inspect Metadata",
    intro:
      "See what's hidden inside your PDF. This tool reads the document's metadata — title, author, subject, keywords, creation date, producer software, page count, and encryption status — and shows it as easy-to-read JSON.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Click View Metadata.",
      "Read the document info displayed as JSON.",
    ],
    features: [
      "Title, author, subject, keywords",
      "Creation and modification dates",
      "Page count and producer info",
      "Encryption status",
      "JSON output",
    ],
    useCases: [
      "Check a PDF's author and creation date",
      "Verify document properties before publishing",
      "Audit files for leftover metadata",
      "Debug PDF processing issues",
    ],
    faqs: [
      {
        q: "What is PDF metadata?",
        a: "Metadata is hidden information stored in the PDF: title, author, subject, keywords, creation date, the software that made it, page count, and whether it's encrypted.",
      },
      {
        q: "Can I see if a PDF is password protected?",
        a: "Yes — the metadata view includes the document's encryption status.",
      },
      {
        q: "Is the metadata always accurate?",
        a: "It reflects what the PDF's creator stored in the file. Some PDFs have empty or generic metadata if the authoring software didn't fill it in.",
      },
    ],
    related: ["edit_metadata", "extract_text", "thumbnails", "unlock_pdf"],
  },

  edit_metadata: {
    key: "edit_metadata",
    title: "Edit PDF Metadata Online Free | PDFEDI",
    description:
      "Edit PDF metadata online for free. Change title, author, subject, and keywords without special software.",
    h1: "Edit Metadata",
    intro:
      "Update your PDF's document info. Change the title, author, subject, and keywords that show up in PDF readers and search results — no desktop software needed.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Enter the new title, author, subject, and/or keywords.",
      "Click Save and download the updated PDF.",
    ],
    features: [
      "Edit title, author, subject, keywords",
      "Document content untouched",
      "Instant download",
    ],
    useCases: [
      "Set a proper title before publishing a PDF",
      "Add your name as author to your documents",
      "Clean up metadata inherited from a template",
      "Add keywords for better document organization",
    ],
    faqs: [
      {
        q: "How do I change a PDF's title or author?",
        a: "Upload the PDF, fill in the new title, author, subject, or keywords, and click Save. Only the metadata changes — your pages stay exactly the same.",
      },
      {
        q: "Will editing metadata affect my document's content?",
        a: "No. Metadata lives in the document info dictionary; pages, text, and images are not modified.",
      },
      {
        q: "Why does PDF metadata matter?",
        a: "PDF readers and search engines display the title and author. Correct metadata makes your documents look professional and easier to find.",
      },
    ],
    related: ["metadata", "watermark", "page_numbers", "compress"],
  },

  watermark: {
    key: "watermark",
    title: "Add Watermark to PDF Online Free | PDFEDI",
    description:
      "Stamp a diagonal text watermark across PDF pages online for free. Adjustable opacity. DRAFT, CONFIDENTIAL, and more.",
    h1: "Add Watermark",
    intro:
      "Stamp text diagonally across every page of your PDF. Add marks like DRAFT, CONFIDENTIAL, or SAMPLE with adjustable opacity — a simple way to label document status.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Enter your watermark text and choose an opacity level.",
      "Click Add Watermark and download the stamped PDF.",
    ],
    features: [
      "Diagonal text stamp on every page",
      "Custom text of your choice",
      "Adjustable opacity",
    ],
    useCases: [
      "Mark drafts as DRAFT before review",
      "Label sensitive files CONFIDENTIAL",
      "Stamp SAMPLE on preview documents",
      "Brand outgoing PDFs with your company name",
    ],
    faqs: [
      {
        q: "How do I add a watermark to a PDF?",
        a: "Upload your PDF, type the watermark text, set the opacity, and click Add Watermark. The text is stamped diagonally on every page.",
      },
      {
        q: "Can I control how visible the watermark is?",
        a: "Yes — the opacity option lets you make the watermark subtle or bold.",
      },
      {
        q: "Which pages get watermarked?",
        a: "Every page of the PDF receives the watermark.",
      },
    ],
    related: ["page_numbers", "edit_metadata", "password_protect", "flatten"],
  },

  page_numbers: {
    key: "page_numbers",
    title: "Add Page Numbers to PDF Online Free | PDFEDI",
    description:
      "Number your PDF pages online for free. Choose position, start number, prefix, suffix, and font size.",
    h1: "Add Page Numbers",
    intro:
      "Add page numbers to your PDF exactly where you want them. Choose the corner or edge position, starting number, optional prefix/suffix text, and font size — ideal for reports, ebooks, and print-ready documents.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Choose vertical and horizontal position, start number, and optional prefix/suffix.",
      "Set the font size and page ranges if needed.",
      "Click Add Numbers and download.",
    ],
    features: [
      "Any corner or edge position",
      "Custom start number",
      "Optional prefix and suffix text (e.g. 'Page 1 of 10')",
      "Adjustable font size (6–48pt)",
      "Apply to all pages or selected ranges",
    ],
    useCases: [
      "Number report pages for easy reference",
      "Prepare ebooks for print",
      "Add 'Page X of Y' footers to proposals",
      "Number scanned documents that lack pagination",
    ],
    faqs: [
      {
        q: "How do I add page numbers to a PDF?",
        a: "Upload your PDF, pick where the numbers go (e.g. bottom center), set the start number and font size, then click Add Numbers.",
      },
      {
        q: "Can I make page numbers like 'Page 1 of 10'?",
        a: "Yes — use the prefix field for 'Page ' and the suffix field for ' of 10' around the automatic number.",
      },
      {
        q: "Can I start numbering from a different number?",
        a: "Yes. Set the start number to whatever you need — useful when your PDF is one part of a larger document.",
      },
      {
        q: "Can I number only some pages?",
        a: "Yes — enter page ranges like 3-10 to number just those pages.",
      },
    ],
    related: ["watermark", "edit_metadata", "merge", "flatten"],
  },

  compress: {
    key: "compress",
    title: "Compress PDF Online Free — Reduce File Size | PDFEDI",
    description:
      "Reduce PDF file size online for free. Three quality levels. Shrink PDFs for email and upload. No sign-up.",
    h1: "Compress PDF",
    intro:
      "Make your PDF smaller without ruining it. Choose a compression level — low, medium, or high quality — and get a lighter file that's easier to email, upload, and store.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Pick a quality level: low, medium, or high.",
      "Click Compress and download the smaller PDF.",
    ],
    features: [
      "Three quality levels (low / medium / high)",
      "Image downsampling at lower levels",
      "Structural compression that preserves layout",
      "Free with no watermarks",
    ],
    useCases: [
      "Shrink a PDF to fit email attachment limits",
      "Reduce upload size for forms and portals",
      "Save storage space on large document archives",
      "Make scanned PDFs lighter",
    ],
    faqs: [
      {
        q: "How do I reduce a PDF's file size?",
        a: "Upload your PDF, choose a quality level, and click Compress. Lower quality gives smaller files; 'high' keeps images intact and only applies structural compression.",
      },
      {
        q: "What's the difference between the quality levels?",
        a: "'Low' and 'medium' downsample images for maximum size reduction. 'High' keeps images at full quality and only compresses the PDF structure — best when quality matters most.",
      },
      {
        q: "How much smaller will my PDF get?",
        a: "It depends on the content — image-heavy PDFs shrink the most, often by 50–80% at lower quality settings. Text-only PDFs are already small and compress less.",
      },
      {
        q: "Will compression hurt readability?",
        a: "Text stays sharp at all levels since only images are downsampled. At 'low' quality, photos may look softer — preview the result and re-run at a higher setting if needed.",
      },
    ],
    related: ["ocr", "pdf_to_images", "merge", "split"],
  },

  password_protect: {
    key: "password_protect",
    title: "Protect PDF with Password Online Free | PDFEDI",
    description:
      "Add password protection to a PDF online for free. Encrypt your document so only people with the password can open it.",
    h1: "Password Protect",
    intro:
      "Lock your PDF with a password. The document is encrypted so it can't be opened without the password you set — simple protection for sensitive files you need to share or store.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Enter the password you want to protect it with.",
      "Click Protect and download the encrypted PDF.",
    ],
    features: [
      "Strong PDF encryption",
      "Password required to open",
      "Works with any PDF reader",
    ],
    useCases: [
      "Protect contracts before emailing them",
      "Secure financial documents",
      "Lock personal records stored online",
      "Share sensitive files with controlled access",
    ],
    faqs: [
      {
        q: "How do I password-protect a PDF?",
        a: "Upload your PDF, enter a password, and click Protect. The downloaded PDF will require that password to open in any PDF reader.",
      },
      {
        q: "What happens if I forget the password?",
        a: "There's no recovery — without the password the PDF can't be opened. Store your password somewhere safe.",
      },
      {
        q: "What kind of encryption is used?",
        a: "The PDF is encrypted with standard PDF encryption supported by all major PDF readers.",
      },
    ],
    related: ["unlock_pdf", "redact", "watermark", "flatten"],
  },

  unlock_pdf: {
    key: "unlock_pdf",
    title: "Unlock PDF Online Free — Remove Password | PDFEDI",
    description:
      "Remove password protection from a PDF online for free. Unlock your own PDFs with the correct password.",
    h1: "Unlock PDF",
    intro:
      "Remove the password from a PDF you own. Enter the correct password and download an unlocked copy that's free to open, edit, and process with other tools.",
    howTo: [
      "Upload your password-protected PDF (up to 50MB).",
      "Enter the correct password.",
      "Click Unlock and download the unprotected PDF.",
    ],
    features: [
      "Removes password protection",
      "Output works with all other PDFEDI tools",
      "Free with no watermarks",
    ],
    useCases: [
      "Unlock your own PDF after forgetting it was locked",
      "Prepare a protected file for merging or splitting",
      "Remove passwords before archiving",
      "Enable text extraction on locked documents",
    ],
    faqs: [
      {
        q: "How do I remove a password from a PDF?",
        a: "Upload the protected PDF, enter its password, and click Unlock. You'll get a normal PDF with no password prompt.",
      },
      {
        q: "Can I unlock a PDF without the password?",
        a: "No. You must know the correct password — this tool removes protection from files you have the right to access; it cannot crack unknown passwords.",
      },
      {
        q: "Why would I unlock a PDF?",
        a: "Other tools refuse locked files for safety. Unlocking first lets you merge, split, compress, or convert the document normally.",
      },
    ],
    related: ["password_protect", "merge", "split", "extract_text"],
  },

  redact: {
    key: "redact",
    title: "Redact PDF Online Free — Black Out Sensitive Text | PDFEDI",
    description:
      "Permanently redact sensitive text in a PDF online for free. Black out names, emails, and IDs. True redaction, not just covering.",
    h1: "Redact PDF",
    intro:
      "Permanently black out sensitive text in your PDF. Enter the words or phrases to redact — names, emails, ID numbers — and they're covered with solid black boxes in the output document.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Enter comma-separated text to redact (e.g. SSN, john@example.com).",
      "Click Redact and download the blacked-out PDF.",
    ],
    features: [
      "Redact by exact text match",
      "Multiple terms in one pass",
      "Solid black redaction boxes",
    ],
    useCases: [
      "Black out personal data before sharing documents",
      "Redact client names from case files",
      "Remove email addresses from public reports",
      "Sanitize documents for FOIA-style release",
    ],
    faqs: [
      {
        q: "How do I black out text in a PDF?",
        a: "Upload your PDF, enter the exact words or phrases to redact separated by commas, and click Redact. Every match is covered with a black box.",
      },
      {
        q: "Is the redacted text truly removed?",
        a: "The matched text is covered with opaque black rectangles in the output PDF. For maximum safety with highly sensitive material, verify the output before distributing.",
      },
      {
        q: "Can I redact multiple different words at once?",
        a: "Yes — enter them as a comma-separated list, for example: SSN, john@example.com, 555-1234.",
      },
      {
        q: "Does redaction work on scanned PDFs?",
        a: "Redaction matches the PDF's text layer. For scanned image-only PDFs, run OCR first to add a text layer, then redact.",
      },
    ],
    related: ["password_protect", "unlock_pdf", "extract_text", "flatten"],
  },

  flatten: {
    key: "flatten",
    title: "Flatten PDF Online Free | PDFEDI",
    description:
      "Flatten a PDF online for free. Bake annotations and form fields permanently into pages. Lock document appearance.",
    h1: "Flatten PDF",
    intro:
      "Bake annotations and form fields permanently into your PDF's pages. Flattening merges markups, comments, and filled forms into the page content so the document looks the same everywhere and can't be edited further.",
    howTo: [
      "Upload your PDF file (up to 50MB).",
      "Click Flatten.",
      "Download the flattened PDF.",
    ],
    features: [
      "Merges annotations into page content",
      "Bakes form field values into pages",
      "Locks final document appearance",
    ],
    useCases: [
      "Finalize a filled form so values can't be changed",
      "Bake review comments into a document",
      "Ensure consistent appearance across PDF readers",
      "Prepare documents for printing or archiving",
    ],
    faqs: [
      {
        q: "What does flattening a PDF do?",
        a: "Flattening merges annotations, comments, and form field values directly into the page graphics. After flattening, they become part of the page and can no longer be edited or moved.",
      },
      {
        q: "Why should I flatten a filled form?",
        a: "An unflattened form's values can still be edited by anyone with a PDF editor. Flattening locks the filled-in values in place.",
      },
      {
        q: "Will flattening change how my PDF looks?",
        a: "No — the visual appearance stays the same. Only the editability of annotations and form fields changes.",
      },
    ],
    related: ["password_protect", "watermark", "page_numbers", "redact"],
  },
};
