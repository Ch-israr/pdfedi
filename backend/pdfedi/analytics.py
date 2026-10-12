"""Visitor analytics for the admin dashboard — privacy-first.

What is captured per page view (/, /editor, /tools/* only):
  timestamp, truncated IP (/24 for IPv4, /48 for IPv6 — full IPs are NEVER
  stored), country + city (local DB-IP City Lite MMDB lookup, CC BY 4.0 —
  no third-party APIs), device class, browser, traffic source, path.

What is NOT captured: full IP addresses, user IDs, file contents, form
inputs, query strings with potential PII.

Bots (search crawlers, AI crawlers, scrapers) are excluded from counts.
Rows older than ANALYTICS_RETENTION_DAYS (30) are pruned automatically.
All failures are swallowed — analytics must never break a request.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

log = logging.getLogger("pdfedi.analytics")

RETENTION_DAYS = 30
GEOIP_PATH = Path("/srv/geoip/dbip-city-lite.mmdb")

# ---------------------------------------------------------------------------
# Bot detection
# ---------------------------------------------------------------------------
_BOT_RE = re.compile(
    r"bot|crawl|spider|scrap|archiver|monitor|uptime|pingdom|"
    r"GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|"
    r"PerplexityBot|Perplexity-User|Googlebot|Google-Extended|GoogleOther|"
    r"bingbot|Applebot|DuckAssistBot|CCBot|facebookexternalhit|"
    r"meta-externalagent|meta-externalfetcher|meta-webindexer|"
    r"Bytespider|SemrushBot|AhrefsBot|MJ12bot|DotBot|PetalBot|"
    r"curl|wget|python-requests|python-httpx|go-http-client|java/|"
    r"headlesschrome|lighthouse|pagespeed",
    re.IGNORECASE,
)


def is_bot(user_agent: str) -> bool:
    return bool(user_agent) and bool(_BOT_RE.search(user_agent))


# Known bot tokens -> friendly display names (checked in order).
_BOT_NAMES = [
    ("GPTBot", "GPTBot (OpenAI)"),
    ("OAI-SearchBot", "OAI-SearchBot (OpenAI)"),
    ("ChatGPT-User", "ChatGPT-User (OpenAI)"),
    ("ClaudeBot", "ClaudeBot (Anthropic)"),
    ("Claude-SearchBot", "Claude-SearchBot (Anthropic)"),
    ("Claude-User", "Claude-User (Anthropic)"),
    ("PerplexityBot", "PerplexityBot"),
    ("Perplexity-User", "Perplexity-User"),
    ("Googlebot", "Googlebot"),
    ("Google-Extended", "Google-Extended"),
    ("bingbot", "Bingbot"),
    ("Applebot", "Applebot"),
    ("DuckAssistBot", "DuckAssistBot"),
    ("CCBot", "CCBot (Common Crawl)"),
    ("facebookexternalhit", "Facebook External Hit"),
    ("meta-externalagent", "Meta External Agent"),
    ("meta-externalfetcher", "Meta External Fetcher"),
    ("meta-webindexer", "Meta Web Indexer"),
    ("Bytespider", "Bytespider"),
    ("SemrushBot", "SemrushBot"),
    ("AhrefsBot", "AhrefsBot"),
    ("MJ12bot", "MJ12bot"),
    ("DotBot", "DotBot"),
    ("PetalBot", "PetalBot"),
]


def bot_name(user_agent: str) -> str:
    """Friendly bot name from the User-Agent; 'Unknown bot' as fallback."""
    ua = user_agent or ""
    for token, label in _BOT_NAMES:
        if token.lower() in ua.lower():
            return label
    m = re.search(r"([A-Za-z][\w.-]*?(?:bot|crawler|spider|scraper)[\w.-]*)", ua, re.I)
    if m:
        return m.group(1)[:64]
    return "Unknown bot"


# ---------------------------------------------------------------------------
# Device / browser classification from User-Agent
# ---------------------------------------------------------------------------
_TABLET_RE = re.compile(r"ipad|tablet|playbook|sm-t\d|gt-p\d|kindle|nexus\s*7|nexus\s*9", re.I)
_MOBILE_RE = re.compile(
    r"iphone|ipod|android.*mobile|windows phone|blackberry|bb10|mobile|"
    r"opera mini|iemobile|wpdesktop",
    re.I,
)


def classify_device(user_agent: str) -> str:
    ua = user_agent or ""
    if _TABLET_RE.search(ua):
        return "tablet"
    if _MOBILE_RE.search(ua):
        return "mobile"
    if not ua:
        return "unknown"
    return "desktop"


def classify_browser(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if "edg/" in ua:
        return "Edge"
    if "samsungbrowser/" in ua:
        return "Samsung Internet"
    if "opr/" in ua or "opera/" in ua:
        return "Opera"
    if "firefox/" in ua or "fxios/" in ua:
        return "Firefox"
    if "crios/" in ua or "chrome/" in ua:
        return "Chrome"
    if "safari/" in ua and "version/" in ua:
        return "Safari"
    if not ua:
        return "Unknown"
    return "Other"


# ---------------------------------------------------------------------------
# Traffic source from Referer
# ---------------------------------------------------------------------------
_SOURCE_MAP = {
    "google.": "Google",
    "bing.com": "Bing",
    "duckduckgo.com": "DuckDuckGo",
    "yahoo.com": "Yahoo",
    "facebook.com": "Facebook",
    "instagram.com": "Instagram",
    "x.com": "X",
    "twitter.com": "X",
    "linkedin.com": "LinkedIn",
    "tiktok.com": "TikTok",
    "youtube.com": "YouTube",
    "reddit.com": "Reddit",
    "pinterest.com": "Pinterest",
}


def classify_source(referrer: str) -> str:
    if not referrer:
        return "Direct"
    try:
        host = urlparse(referrer).hostname or ""
    except Exception:
        return "Direct"
    host = host.lower().removeprefix("www.")
    if not host:
        return "Direct"
    for key, label in _SOURCE_MAP.items():
        if key in host:
            return label
    return host  # other referring domain


# ---------------------------------------------------------------------------
# IP handling — truncate, never store full addresses
# ---------------------------------------------------------------------------
def truncate_ip(ip: str) -> str:
    """192.168.1.42 -> 192.168.1.0 ; 2001:db8::1 -> 2001:db8:: ."""
    if not ip or ip == "unknown":
        return "unknown"
    if "." in ip:  # IPv4 -> /24
        parts = ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3]) + ".0"
    if ":" in ip:  # IPv6 -> /48 (first 3 hextets)
        parts = ip.split(":")
        if len(parts) >= 3:
            return ":".join(parts[:3]) + "::"
    return "unknown"


def client_ip_from_headers(headers) -> str:
    # cf-connecting-ip (if Cloudflare is in front), else X-Forwarded-For.
    for name in ("cf-connecting-ip", "x-forwarded-for"):
        val = headers.get(name)
        if val:
            return val.split(",")[0].strip()
    return "unknown"


# ---------------------------------------------------------------------------
# GeoIP — local MMDB lookup, graceful when the DB is absent
# ---------------------------------------------------------------------------
_reader = None
_reader_failed = False


def _get_reader():
    global _reader, _reader_failed
    if _reader is not None:
        return _reader
    if _reader_failed or not GEOIP_PATH.is_file():
        return None
    try:
        import geoip2.database

        _reader = geoip2.database.Reader(str(GEOIP_PATH))
        return _reader
    except Exception as exc:  # never break the app over geo
        log.warning("GeoIP reader unavailable: %s", exc)
        _reader_failed = True
        return None


def geo_lookup(ip: str) -> tuple[str | None, str | None]:
    """Return (country_name, city_name); (None, None) when unavailable."""
    reader = _get_reader()
    if reader is None or not ip or ip == "unknown":
        return None, None
    try:
        r = reader.city(ip)
        country = r.country.name
        city = r.city.name
        return country, city
    except Exception:
        return None, None


# ---------------------------------------------------------------------------
# Visit logging
# ---------------------------------------------------------------------------
_TRACKED_PREFIXES = ("/tools/", "/editor")


def should_track(path: str, user_agent: str) -> bool:
    """Human page views: /, /editor, /tools/*. Bots go to the bot table."""
    if is_bot(user_agent or ""):
        return False
    if path == "/" or path.startswith(_TRACKED_PREFIXES):
        return True
    return False


def should_track_bot(path: str, user_agent: str) -> bool:
    """Bot page views on the same tracked paths, logged separately."""
    if not is_bot(user_agent or ""):
        return False
    if path == "/" or path.startswith(_TRACKED_PREFIXES):
        return True
    return False


def log_visit(db, *, ip: str, user_agent: str, referrer: str, path: str) -> None:
    """Write one visit row + prune old rows. Never raises."""
    try:
        from .models import Visit

        country, city = geo_lookup(ip)
        db.add(
            Visit(
                id=__import__("uuid").uuid4().hex,
                ip_trunc=truncate_ip(ip),
                country=country,
                city=city,
                device=classify_device(user_agent),
                browser=classify_browser(user_agent),
                source=classify_source(referrer),
                path=path[:256],
                created_at=datetime.now(timezone.utc).isoformat(),
            )
        )
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        db.query(Visit).filter(Visit.created_at < cutoff).delete()
        db.commit()
    except Exception as exc:
        log.warning("visit logging failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


def log_bot_visit(db, *, ip: str, user_agent: str, path: str) -> None:
    """Write one bot visit row (name + country only) + prune. Never raises."""
    try:
        from .models import BotVisit

        country, _ = geo_lookup(ip)
        db.add(
            BotVisit(
                id=__import__("uuid").uuid4().hex,
                name=bot_name(user_agent),
                country=country,
                path=path[:256],
                created_at=datetime.now(timezone.utc).isoformat(),
            )
        )
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        db.query(BotVisit).filter(BotVisit.created_at < cutoff).delete()
        db.commit()
    except Exception as exc:
        log.warning("bot visit logging failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass


def get_analytics(db, days: int = 30) -> dict:
    """Aggregated stats for the admin dashboard. Never raises."""
    from sqlalchemy import func

    from .models import BotVisit, Visit

    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        base = db.query(Visit).filter(Visit.created_at >= cutoff)
        total = base.count()
        unique = base.with_entities(func.count(func.distinct(Visit.ip_trunc))).scalar() or 0

        def grouped(model, col, limit=10):
            rows = (
                db.query(col, func.count(model.id))
                .filter(model.created_at >= cutoff)
                .group_by(col)
                .order_by(func.count(model.id).desc())
                .limit(limit)
                .all()
            )
            return [{"name": (r[0] or "Unknown"), "count": r[1]} for r in rows]

        by_day = (
            db.query(func.substr(Visit.created_at, 1, 10), func.count(Visit.id))
            .filter(Visit.created_at >= cutoff)
            .group_by(func.substr(Visit.created_at, 1, 10))
            .order_by(func.substr(Visit.created_at, 1, 10))
            .all()
        )
        recent = (
            db.query(Visit).order_by(Visit.created_at.desc()).limit(20).all()
        )
        bot_total = db.query(BotVisit).filter(BotVisit.created_at >= cutoff).count()
        return {
            "total_visits": total,
            "unique_visitors": unique,
            "days": days,
            "retention_days": RETENTION_DAYS,
            "geo_available": GEOIP_PATH.is_file(),
            "by_country": grouped(Visit, Visit.country),
            "by_city": grouped(Visit, Visit.city),
            "by_device": grouped(Visit, Visit.device),
            "by_browser": grouped(Visit, Visit.browser),
            "by_source": grouped(Visit, Visit.source),
            "by_day": [{"date": r[0], "count": r[1]} for r in by_day],
            "by_path": grouped(Visit, Visit.path),
            "recent": [
                {
                    "created_at": v.created_at,
                    "ip": v.ip_trunc,
                    "country": v.country or "Unknown",
                    "city": v.city or "—",
                    "device": v.device,
                    "browser": v.browser,
                    "source": v.source,
                    "path": v.path,
                }
                for v in recent
            ],
            "bots": {
                "total": bot_total,
                "by_name": grouped(BotVisit, BotVisit.name),
                "by_country": grouped(BotVisit, BotVisit.country),
            },
        }
    except Exception as exc:
        log.warning("analytics query failed: %s", exc)
        return {"error": str(exc)}
