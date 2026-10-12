import type { MetadataRoute } from "next";

const BASE_URL = "https://pdfedi.onrender.com";

// AI crawler policy (approved 2026-10-12): Option 1 — allow all legitimate,
// publicly documented AI search and retrieval crawlers, including training
// crawlers. /admin and /api/ stay disallowed for everyone. Only tokens
// verified in the operator's own documentation are listed; unverified
// tokens (e.g. xAI/Grok) are intentionally absent.
const AI_SEARCH_CRAWLERS = [
  "OAI-SearchBot", // OpenAI — ChatGPT search index
  "ChatGPT-User", // OpenAI — user-triggered fetch
  "Claude-SearchBot", // Anthropic — search index
  "Claude-User", // Anthropic — user-triggered fetch
  "PerplexityBot", // Perplexity — search results/citations
  "Perplexity-User", // Perplexity — user-triggered fetch
  "Googlebot", // Google — Search index, AI Overviews, AI Mode
  "Applebot", // Apple — Siri, Spotlight, Safari suggestions
  "meta-webindexer", // Meta — Meta AI answer citations
  "meta-externalfetcher", // Meta — user-initiated fetches
  "DuckAssistBot", // DuckDuckGo — AI answers with citations
  "bingbot", // Microsoft — Bing, Yahoo, DuckDuckGo web results, Copilot
];

const AI_TRAINING_CRAWLERS = [
  "GPTBot", // OpenAI — training data
  "ClaudeBot", // Anthropic — training data
  "CCBot", // Common Crawl — open corpus
  "meta-externalagent", // Meta — training/product indexing
];

// Control-only tokens: never crawl; govern reuse of already-crawled content.
const AI_TRAINING_CONTROL_TOKENS = [
  "Google-Extended", // Google — Gemini training/grounding opt-out token
  "Applebot-Extended", // Apple — foundation-model training opt-out token
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
      {
        userAgent: AI_SEARCH_CRAWLERS,
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
      {
        userAgent: AI_TRAINING_CRAWLERS,
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
      {
        userAgent: AI_TRAINING_CONTROL_TOKENS,
        allow: "/",
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
