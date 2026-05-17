from __future__ import annotations

import asyncio
import html as _html
import re

import httpx

from prts_mcp.config import PRTS_API_ENDPOINT, USER_AGENT, RATE_LIMIT_INTERVAL
from prts_mcp.utils.sanitizer import strip_wikitext

_last_request_time: float = 0.0

# MediaWiki parser output contains inline CSS / JS blocks (charinfo font-face,
# RLQ push snippets, etc.) that produce noise after tag stripping.
_CSS_JS_RE = re.compile(
    r"@(font-face|keyframes|media|import|charset|namespace|supports|page)[^{]*\{[^}]*\}|"
    r"\(window\.RLQ\s*\|\|\s*\[\]\)\.push\([^)]*\)|"
    r"<style[^>]*>.*?</style>|"
    r"<script[^>]*>.*?</script>",
    re.DOTALL | re.IGNORECASE,
)

_HTML_TAG_RE = re.compile(r"<[^>]+>")

_HTML_ENTITY_RE = re.compile(r"&#?[a-zA-Z0-9]+;")


async def _rate_limit() -> None:
    global _last_request_time
    now = asyncio.get_event_loop().time()
    elapsed = now - _last_request_time
    if elapsed < RATE_LIMIT_INTERVAL:
        await asyncio.sleep(RATE_LIMIT_INTERVAL - elapsed)
    _last_request_time = asyncio.get_event_loop().time()


_TECHNICAL_PAGE_PATTERNS = (
    "/spine",
    "/data",
    "/db",
    "/lua",
    "/json",
    "Widget:",
    "Template:",
)


def _is_technical_page(title: str) -> bool:
    return any(p in title for p in _TECHNICAL_PAGE_PATTERNS)


async def search_prts(
    query: str,
    limit: int = 5,
    search_mode: str = "text",
    filter_technical: bool = True,
) -> dict:
    """Search PRTS wiki.

    Returns:
        {"totalhits": int, "results": list[dict]} where each result has
        "title" and "snippet" keys.
    """
    await _rate_limit()
    srwhat = "title" if search_mode == "title" else None
    params: dict = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": str(limit * 2 if filter_technical else limit),
        "srnamespace": "0",
        "srinfo": "totalhits",
        "format": "json",
    }
    if srwhat:
        params["srwhat"] = srwhat
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=15) as client:
        resp = await client.get(PRTS_API_ENDPOINT, params=params)
        resp.raise_for_status()
    data = resp.json()
    totalhits = data.get("query", {}).get("searchinfo", {}).get("totalhits", 0)
    results: list[dict] = []
    for item in data.get("query", {}).get("search", []):
        title = item["title"]
        if filter_technical and _is_technical_page(title):
            continue
        if len(results) >= limit:
            break
        snippet = strip_wikitext(item.get("snippet", ""))
        snippet = _html.unescape(snippet)
        snippet = _clean_snippet(snippet)
        results.append({
            "title": title,
            "snippet": snippet,
        })
    return {"totalhits": totalhits, "results": results}


def _strip_html(text: str) -> str:
    """Remove CSS/JS, HTML tags, entities, and collapse whitespace from parsed output."""
    text = _CSS_JS_RE.sub("", text)
    text = _HTML_TAG_RE.sub("", text)
    text = _HTML_ENTITY_RE.sub(lambda m: _html.unescape(m.group(0)), text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


async def read_page(title: str, section_index: int | None = None) -> str:
    """Fetch rendered plain-text content for a PRTS wiki page.

    Args:
        title: Wiki page title.
        section_index: If set, fetch only that section (from prop=sections index).
    """
    await _rate_limit()
    params: dict = {
        "action": "parse",
        "page": title,
        "prop": "text",
        "format": "json",
    }
    if section_index is not None:
        params["section"] = str(section_index)
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=15) as client:
        resp = await client.get(PRTS_API_ENDPOINT, params=params)
        resp.raise_for_status()
    data = resp.json()

    error = data.get("error", {}).get("info", "")
    if error:
        return f"页面 '{title}' 未找到或内容为空。"

    html_text = data.get("parse", {}).get("text", {}).get("*", "")
    if not html_text:
        return f"页面 '{title}' 未找到或内容为空。"

    return _strip_html(html_text)


async def list_sections(title: str) -> list[dict]:
    """Return the table of contents (sections) for a wiki page.

    Each dict has keys: index, level, line, fromtitle.
    Template-transcluded sections have index values like "T-1".
    """
    await _rate_limit()
    params = {
        "action": "parse",
        "page": title,
        "prop": "sections",
        "format": "json",
    }
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=15) as client:
        resp = await client.get(PRTS_API_ENDPOINT, params=params)
        resp.raise_for_status()
    data = resp.json()
    error = data.get("error", {}).get("info", "")
    if error:
        raise ValueError(f"页面 '{title}' 未找到。")
    sections = data.get("parse", {}).get("sections", [])
    return [
        {
            "index": s.get("index", ""),
            "level": s.get("level", ""),
            "line": s.get("line", ""),
            "fromtitle": s.get("fromtitle", ""),
        }
        for s in sections
    ]


async def get_categories(title: str) -> list[str]:
    """Return the category names for a wiki page."""
    await _rate_limit()
    params = {
        "action": "parse",
        "page": title,
        "prop": "categories",
        "format": "json",
    }
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=15) as client:
        resp = await client.get(PRTS_API_ENDPOINT, params=params)
        resp.raise_for_status()
    data = resp.json()
    error = data.get("error", {}).get("info", "")
    if error:
        raise ValueError(f"页面 '{title}' 未找到。")
    return [c["*"] for c in data.get("parse", {}).get("categories", [])]


async def get_links(
    title: str,
    direction: str = "outbound",
    limit: int = 30,
) -> dict:
    """Return outbound or inbound links for a wiki page.

    Returns:
        {"title": str, "links": list[str], "total": int, "has_more": bool}
    """
    await _rate_limit()
    if direction == "outbound":
        params = {
            "action": "parse",
            "page": title,
            "prop": "links",
            "format": "json",
        }
        async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=15) as client:
            resp = await client.get(PRTS_API_ENDPOINT, params=params)
            resp.raise_for_status()
        data = resp.json()
        error = data.get("error", {}).get("info", "")
        if error:
            raise ValueError(f"页面 '{title}' 未找到。")
        all_links = [l["*"] for l in data.get("parse", {}).get("links", [])]
        return {
            "title": title,
            "links": all_links[:limit],
            "total": len(all_links),
            "has_more": len(all_links) > limit,
        }

    # inbound: use list=backlinks
    params = {
        "action": "query",
        "list": "backlinks",
        "bltitle": title,
        "bllimit": min(limit, 500),
        "blnamespace": "0",
        "format": "json",
    }
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=15) as client:
        resp = await client.get(PRTS_API_ENDPOINT, params=params)
        resp.raise_for_status()
    data = resp.json()
    backlinks = data.get("query", {}).get("backlinks", [])
    links = [bl["title"] for bl in backlinks]
    has_more = "continue" in data
    return {
        "title": title,
        "links": links[:limit],
        "total": len(links),
        "has_more": has_more,
    }


def _clean_snippet(snippet: str) -> str:
    """Remove residual wikitext artifacts from a search snippet."""
    # Remove JSON key-value fragments from technical data pages
    snippet = re.sub(r'\s*"[^"]*"\s*:\s*"[^"]*"\s*,?\s*', " ", snippet)
    # Remove isolated pipe-value artifacts with Chinese keys
    snippet = re.sub(r"\|[一-鿿\w]+\s*=[^\n]*", "", snippet)
    snippet = re.sub(r"#重定向|#REDIRECT", "", snippet)
    # Collapse whitespace
    snippet = re.sub(r"[ \t]+", " ", snippet)
    snippet = re.sub(r",{2,}", "", snippet)
    snippet = re.sub(r"\n{2,}", "\n", snippet)
    return snippet.strip(" ,\n")
