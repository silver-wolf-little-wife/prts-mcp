# PRTS-MCP Roadmap

_Last updated: 2026-05-19_

PRTS-MCP has reached its first stable release. The public tool surface and
data architecture are now under a compatibility contract.

## Current Release

- Python: `1.4.0`
- TypeScript: `1.4.0`
- The public tool surface (21 MCP tools) is frozen in the 1.x line.
  Automated CI checks enforce this.
- 1.1.0 adds 3 search tools. 1.2.0 adds 2 story summary tools. 1.3.0 adds 3 PRTS
  Wiki deep integration tools. 1.4.0 adds 4 tools (template extraction + enemy
  handbook).
- A migration guide covers behavioral changes for users upgrading from 0.x.

## 1.x Patch Policy

Patch releases (1.1.1, 1.1.2, …) are limited to bug fixes and documentation
improvements within the 1.x compatibility contract.

## 1.0 Goals

1. **Version alignment**
   - Python and TypeScript share the same major and minor versions.
   - Patch versions may diverge only for implementation-specific fixes.
   - Release notes explicitly state cross-implementation compatibility.

2. **Standardized data pipeline**
   - Separate upstream source, local storage, JSON reading, and domain parsing.
   - Keep existing `GAMEDATA_PATH` and `STORYJSON_PATH` semantics compatible.
   - Hide zip-vs-directory details behind a shared reader abstraction.
   - Make new data-backed tools easier to add without new one-off sync logic.

3. **Cross-implementation behavior parity**
   - Python and TypeScript expose the same MCP tools.
   - Core outputs are covered by shared fixture/golden tests.
   - CI verifies both implementations before release.

4. **Documented compatibility boundary**
   - Docker, npm, and PyPI data-bundling behavior is explicit.
   - Migration notes cover custom data paths and startup auto-sync behavior.
   - 1.0 starts the compatibility contract for public tool parameters and
     response formats.

## 1.0 Non-Goals

- Shipping every possible Arknights data table.
- Embedding large fallback data in PyPI wheels.
- Replacing GitHub Release based sync with a different hosting model.
- Adding generated LLM summaries as a required runtime dependency.

## Release Plan

### `1.0.0-alpha.1`: Architecture Skeleton

- Status: ready for prerelease tagging from the current `main` commit.
- Introduced the dataset/reader abstraction in both implementations.
- Moved existing operator and story readers behind the new abstraction.
- Kept current user-facing behavior compatible.
- Added focused tests around directory-backed and zip-backed reads.
- Added prerelease-aware release workflows for Python and TypeScript tags.

### `1.0.0-alpha.2`: Sync and Storage Consolidation

- Status: ready for prerelease tagging from the current `main` commit.
- Added bounded retry for `offline_fallback` / `no_data` startup-sync
  results on the Python side (TypeScript already had it).
- Added post-download zip integrity validation for the storyjson Release
  asset on the TypeScript side (Python already had it).
- Normalize release metadata, cache freshness, and fallback decisions.
- Decide which datasets remain zip-backed at runtime and which are extracted.
- Verify Docker and npm bundled fallback data through CI package inspection.

### `1.0.0-beta.1`: Behavior Freeze

- Freeze the public tool list and core response formats for 1.0.
- Add migration notes from the 0.x line.
- Expand cross-implementation fixture tests.

### `1.0.0`: Stable Release

- Publish Python and TypeScript 1.0 releases together.
- Announce version alignment and compatibility rules.
- Keep later 1.0.x releases focused on bug fixes and documentation.

## 1.1.0 Added

- **Search tools** (`list_search_scopes`, `search_data`, `search_stories`):
  full-text regex search across operator data and story dialogue, with filtering
  by speaker, line type, and configurable context lines.

## 1.1.1 Fixed

- **PRTS API investigation.** Systematic testing uncovered severe quality issues
  in the two PRTS Wiki tools dating back to 0.1.0:

  *`read_prts_page`*
  - Used `action=query&prop=extracts&explaintext=1`. MediaWiki's `explaintext`
    strips all template-rendered content. PRTS character pages are >99% template-
    driven (infoboxes, skill tables, archive templates). Result: ~400 chars of
    empty section headers for a page like "阿米娅".
  - **Fix**: switched to `action=parse&prop=text`, which returns fully rendered
    HTML. After HTML-tag stripping and CSS/JS removal, "阿米娅" yields 22K+ chars
    of readable text covering all sections (attributes, talents, skills, archives).

  *`search_prts`*
  - No namespace filtering. Default MediaWiki search scans ALL namespaces,
    returning technical data pages (JSON-like spine data, Lua module dumps)
    mixed with real articles.
  - Snippets contained raw HTML entities (`&quot;`, `&#039;`) and wikitext
    template parameter syntax (`|名称=xxx`).
  - **Fix**: added `srnamespace=0` (main namespace only), HTML entity decoding,
    and residual-wikitext snippet cleanup.

  *Known remaining issues (PRTS Wiki structural, not our code)*
  - PRTS puts auto-generated technical pages (`*/spine`) in the main namespace
    (ns=0), so namespace filtering alone can't fully sanitise results.
  - Redirect pages appear as search results without being resolved to their
    targets (MediaWiki `list=search` does not auto-resolve redirects).
  - Free-text snippets from MediaWiki's search index are inherently imprecise;
    the only fully reliable way to identify a page's topic is to retrieve and
    parse the rendered content via `action=parse`.

## 1.2.0 PRTS API Enhancement Candidates

Based on the 1.1.1 investigation, PRTS Wiki's MediaWiki API exposes significant
capabilities beyond the current `search_prts` + `read_prts_page` pair. No
decisions yet; this section captures what's possible.

*Categories and navigation*
- `prop=categories` on `action=parse` returns page categories. PRTS categorises
  pages under labels like "干员", "敌方", "阵营", "势力", "物品". Category-driven
  queries would let agents discover related pages precisely.
- `prop=links` / `prop=backlinks` would allow graph traversal — e.g. from a
  character page to all pages that reference that character.

*Structured sections*
- `action=parse&prop=sections` returns a table of contents with section indices,
  levels, and byte offsets. Combined with `action=parse&section=N`, agents could
  read specific sections (e.g. "天赋", "档案") without fetching the entire page.
- This would enable tools like `read_prts_page_section(title, section_index)` or
  `list_prts_page_sections(title)`.

*Search quality*
- `srwhat=title` could power an exact-title lookup mode. Combined with
  `srredirects=1`, searches could resolve redirects transparently.
- `srinfo=totalhits` would give agents a sense of result volume before paginating.
- Pre-filtering known technical page patterns (e.g. titles ending in `/spine`,
  `/data`, `Widget:`) could further clean results client-side.

*Template data extraction*
- PRTS infobox data lives in raw wikitext templates (`{{干员信息|...}}`).
  `action=parse&prop=parsetree` returns a structured parse tree that could be
  mined for key-value pairs. This is complex but would yield machine-readable
  structured data without relying on external ArknightsGameData JSON files.

## 1.2.0 Added

- **Story summary tools** (`get_event_summary`, `get_story_summary`, enhanced
  `list_stories`): chapter-by-chapter and event-level narrative overviews with
  LLM-generated long summaries (5~7:1 per-chapter, 10:1 per-event). Three-tier
  fallback ensures graceful degradation when LLM data is unavailable.

## 1.3.0: PRTS API Deep Integration

Delivered in both Python and TypeScript. See [Python CHANGELOG](python/CHANGELOG.md#130---2026-05-18) and [TS CHANGELOG](ts/CHANGELOG.md#130---2026-05-18).

### Added

- `list_prts_sections(page_title)` — section table of contents
- `get_prts_categories(page_title)` — page category tags
- `get_prts_links(page_title, direction, limit)` — outbound/inbound links

### Changed

- `read_prts_page` — new `section_index` parameter
- `search_prts` — new `search_mode`, `filter_technical`; returns `totalhits`

### Delivered in 1.4.0

- Template data extraction (`prop=parsetree`) — see 1.4.0 section below.

## 1.4.0: Template Extraction + Enemy Handbook

Delivered in both Python and TypeScript. See [Python CHANGELOG](python/CHANGELOG.md#140---2026-05-19) and [TS CHANGELOG](ts/CHANGELOG.md#140---2026-05-19).

### Added

- `get_prts_template(page_title)` — structured key-value extraction from PRTS
  Wiki templates via `action=parse&prop=parsetree`. Top-level templates only;
  nested templates inside values are stripped.
- `list_enemies(threat_level, limit, offset, full)` — paginated enemy handbook
  listing with threat-level filter (boss/elite/normal).
- `get_enemy_info(name)` — handbook entry merged with combat stats from
  `enemy_database.json` (HP/ATK/DEF/RES, immunities, skills with blackboard
  parameters).
- `search_enemies(pattern, max_results)` — regex search across enemy names,
  descriptions, and abilities.

### Notes

- Enemy data is local JSON only — no PRTS Wiki API rate-limit cost.
- `enemy_database.json` lives at `levels/enemydata/`; loaded on demand and
  cleared together with operator caches after a successful sync.

## Next

Possible directions for 1.5.0 — items / stages, additional PRTS Wiki
enhancements. Scope TBD.

## Detailed Plans

- [1.0 architecture plan](docs/dev/plans/1.0-architecture-plan.md)
- [1.0 development roadmap](docs/dev/plans/1.0-development-roadmap.md)
