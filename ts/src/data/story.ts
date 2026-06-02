/**
 * Story data reader for PRTS-MCP (TypeScript).
 *
 * Reads from the bundled/synced zh_CN.zip (ArknightsStoryJson fork release).
 * Mirrors python/src/prts_mcp/data/story.py.
 *
 * Zip internal layout (all paths prefixed with "zh_CN/"):
 *   zh_CN/storyinfo.json                          — {story_key: summary_text}
 *   zh_CN/gamedata/excel/story_review_table.json  — event metadata + ordered chapter list
 *   zh_CN/gamedata/story/{story_key}.json         — per-chapter dialogue JSON
 */

import { DirectoryStore, JsonStore, ZipStore } from "./stores.js";
import { statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Zip path constants
// ---------------------------------------------------------------------------

const STORY_REVIEW_TABLE = "zh_CN/gamedata/excel/story_review_table.json";
const STORYINFO = "zh_CN/storyinfo.json";
const SUMMARIES = "zh_CN/summaries.json";
const EVENT_SUMMARIES = "zh_CN/event_summaries.json";
const CHARDICT = "zh_CN/chardict.json";

function storyZipPath(storyKey: string): string {
  return `zh_CN/gamedata/story/${storyKey}.json`;
}

// entryType → category filter mapping (mirrors Python _CATEGORY_MAP)
const CATEGORY_MAP: Record<string, string[]> = {
  main: ["MAINLINE"],
  activities: ["ACTIVITY", "MINI_ACTIVITY"],
  memoirs: ["NONE"],
};

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

const RICH_TAG_RE = /<[^>]+>/g;
const MEMOIR_EVENT_RE = /^story_([a-z0-9_]+)_set_\d+$/;

function cleanText(text: string): string {
  return text.replace(/\{@nickname\}/g, "博士").replace(RICH_TAG_RE, "").trim();
}

// ---------------------------------------------------------------------------
// JSON shape types (only fields we use)
// ---------------------------------------------------------------------------

interface RawStoryItem {
  prop?: string;
  attributes?: Record<string, unknown>;
}

interface RawStoryChapter {
  storyCode?: string;
  storyName?: string;
  avgTag?: string | null;
  eventName?: string;
  storyInfo?: string;
  storyList?: RawStoryItem[];
}

interface RawInfoUnlockData {
  storyTxt?: string;
  storyCode?: string;
  storyName?: string;
  avgTag?: string | null;
  storySort?: number;
}

interface RawReviewEntry {
  id?: string;
  name?: string;
  entryType?: string;
  infoUnlockDatas?: RawInfoUnlockData[];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StoryLine {
  type: "dialog" | "narration" | "choice";
  role: string | null;
  text: string;
}

export interface StoryChapter {
  storyKey: string;
  storyCode: string;
  storyName: string;
  avgTag: string | null;
  eventName: string;
  storyInfo: string;
  lines: StoryLine[];
}

export interface EventInfo {
  eventId: string;
  name: string;
  entryType: string;
  storyCount: number;
}

export interface ChapterSummary {
  storyKey: string;
  storyCode: string;
  storyName: string;
  avgTag: string | null;
  sortOrder: number;
}

export interface ActivityResult {
  eventId: string;
  eventName: string;
  totalChapters: number;
  hasMore: boolean;
  chapters: StoryChapter[];
}

export interface MemoirChapter {
  eventId: string;
  storyKey: string;
  storyCode: string;
  storyName: string;
}

export interface OperatorMemoirResult {
  operatorName: string;
  internalCode: string;
  operatorId: string;
  totalChapters: number;
  chapters: MemoirChapter[];
}

interface StorySearchChapter {
  eventId: string;
  storyCode: string;
  lines: StoryLine[];
}

interface StorySearchRecord {
  chapterIndex: number;
  lineIndex: number;
  line: StoryLine;
}

interface StorySearchIndex {
  eventIds: Set<string>;
  chapters: StorySearchChapter[];
  records: StorySearchRecord[];
}

let storySearchCache:
  | { descriptor: string; index: StorySearchIndex }
  | null = null;

interface CharDictEntry {
  name?: string;
  id?: string;
}

let charDictCache: Record<string, CharDictEntry> | null = null;

export function clearStoryCaches(): void {
  storySearchCache = null;
  charDictCache = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function storyStore(zipPath: string): ZipStore {
  return new ZipStore(zipPath);
}

function withStoryStore<T>(zipPath: string, read: (store: ZipStore) => T): T {
  const store = storyStore(zipPath);
  try {
    return read(store);
  } finally {
    store.close();
  }
}

function parseStoryList(
  storyList: RawStoryItem[],
  includeNarration: boolean
): StoryLine[] {
  const lines: StoryLine[] = [];
  for (const item of storyList) {
    const prop = (item.prop ?? "").toLowerCase();
    const attrs = (item.attributes ?? {}) as Record<string, unknown>;

    if (prop === "name") {
      const name = String(attrs["name"] ?? "");
      const content = String(attrs["content"] ?? "");
      if (content && (includeNarration || name)) {
        lines.push({
          type: "dialog",
          role: name ? cleanText(name) : null,
          text: cleanText(content),
        });
      }
    } else if (
      includeNarration &&
      (prop === "sticker" || prop === "subtitle" || prop === "animtext")
    ) {
      // Sticker uses "text" OR "content" field — check both (see porting guide §4.2)
      const content = String(attrs["content"] ?? attrs["text"] ?? "");
      if (content) {
        lines.push({ type: "narration", role: null, text: cleanText(content) });
      }
    } else if (prop === "decision") {
      const options = attrs["options"];
      if (Array.isArray(options)) {
        for (const opt of options) {
          let text = "";
          if (typeof opt === "string") text = opt;
          else if (opt !== null && typeof opt === "object") {
            text = String((opt as Record<string, unknown>)["text"] ?? "");
          }
          if (text) {
            lines.push({ type: "choice", role: null, text: cleanText(text) });
          }
        }
      }
    }
    // All other props (Dialog, Background, PlayMusic, etc.) are skipped.
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a list of events from story_review_table.json.
 *
 * @param zipPath  Absolute path to zh_CN.zip.
 * @param category Optional filter — "main" or "activities".
 */
export function listStoryEvents(
  zipPath: string,
  category?: string
): EventInfo[] {
  return withStoryStore(zipPath, (store) => listStoryEventsFromStore(store, category));
}

export function listStoryEventsFromStore(
  store: JsonStore,
  category?: string
): EventInfo[] {
  const allowedTypes = category ? (CATEGORY_MAP[category] ?? null) : null;
  const table = store.readJson<Record<string, RawReviewEntry>>(
    STORY_REVIEW_TABLE
  );

  const events: EventInfo[] = [];
  for (const [eventId, entry] of Object.entries(table)) {
    const entryType = entry.entryType ?? "NONE";
    if (allowedTypes !== null) {
      if (allowedTypes.length === 1 && allowedTypes[0] === "NONE") {
        // "memoirs" category: NONE entries whose eventId matches memoir pattern
        if (!isMemoirEvent(eventId)) continue;
      } else if (!allowedTypes.includes(entryType)) {
        continue;
      }
    }
    events.push({
      eventId,
      name: entry.name ?? eventId,
      entryType,
      storyCount: (entry.infoUnlockDatas ?? []).length,
    });
  }
  return events;
}

/**
 * Return ordered chapter list for an event.
 *
 * @param zipPath  Absolute path to zh_CN.zip.
 * @param eventId  Event key, e.g. "act31side".
 * @throws Error if eventId is not found in story_review_table.
 */
export function listStories(
  zipPath: string,
  eventId: string
): ChapterSummary[] {
  return withStoryStore(zipPath, (store) => listStoriesFromStore(store, eventId));
}

export function listStoriesFromStore(
  store: JsonStore,
  eventId: string
): ChapterSummary[] {
  const table = store.readJson<Record<string, RawReviewEntry>>(
    STORY_REVIEW_TABLE
  );

  const entry = table[eventId];
  if (!entry) throw new Error(`Event not found: "${eventId}"`);

  const datas = (entry.infoUnlockDatas ?? []).slice();
  datas.sort((a, b) => (a.storySort ?? 0) - (b.storySort ?? 0));

  const chapters: ChapterSummary[] = [];
  for (const d of datas) {
    if (!d.storyTxt) continue;
    chapters.push({
      storyKey: d.storyTxt,
      storyCode: d.storyCode ?? "",
      storyName: d.storyName ?? "",
      avgTag: d.avgTag ?? null,
      sortOrder: d.storySort ?? 0,
    });
  }
  return chapters;
}

/**
 * Read and parse a single story chapter from the zip.
 *
 * @param zipPath         Absolute path to zh_CN.zip.
 * @param storyKey        Story key from storyTxt / storyinfo.json.
 * @param includeNarration Whether to include narration/scene lines (default true).
 * @throws Error if the story file is not found in the zip.
 */
export function readStory(
  zipPath: string,
  storyKey: string,
  includeNarration = true
): StoryChapter {
  return withStoryStore(zipPath, (store) => readStoryFromStore(store, storyKey, includeNarration));
}

export function readStoryFromStore(
  store: JsonStore,
  storyKey: string,
  includeNarration = true
): StoryChapter {
  const innerPath = storyZipPath(storyKey);
  if (!store.exists(innerPath)) {
    throw new Error(`Story not found in store: "${storyKey}"`);
  }
  const raw = store.readJson<RawStoryChapter>(innerPath);

  const lines = parseStoryList(raw.storyList ?? [], includeNarration);

  return {
    storyKey,
    storyCode: raw.storyCode ?? "",
    storyName: raw.storyName ?? "",
    avgTag: raw.avgTag ?? null,
    eventName: raw.eventName ?? "",
    storyInfo: raw.storyInfo ?? "",
    lines,
  };
}

/**
 * Read all chapters of an activity in official story order.
 *
 * @param zipPath         Absolute path to zh_CN.zip.
 * @param eventId         Event key, e.g. "act31side".
 * @param includeNarration Whether to include narration lines (default true).
 * @param page            1-based page index. undefined = return all chapters.
 * @param pageSize        Chapters per page when page is set (default 5).
 * @throws Error if eventId is not found.
 */
export function readActivity(
  zipPath: string,
  eventId: string,
  includeNarration = true,
  page?: number,
  pageSize = 5
): ActivityResult {
  return withStoryStore(zipPath, (store) => readActivityFromStore(
    store,
    eventId,
    includeNarration,
    page,
    pageSize,
  ));
}

export function readActivityFromStore(
  store: JsonStore,
  eventId: string,
  includeNarration = true,
  page?: number,
  pageSize = 5
): ActivityResult {
  const summaries = listStoriesFromStore(store, eventId);
  const total = summaries.length;

  let selected: ChapterSummary[];
  let hasMore: boolean;
  if (page !== undefined) {
    if (page < 1) throw new Error("page 参数必须 >= 1");
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    selected = summaries.slice(start, end);
    hasMore = end < total;
  } else {
    selected = summaries;
    hasMore = false;
  }

  const chapters: StoryChapter[] = [];
  let eventName = "";
  for (const summary of selected) {
    try {
      const chapter = readStoryFromStore(store, summary.storyKey, includeNarration);
      if (!eventName) eventName = chapter.eventName;
      chapters.push(chapter);
    } catch (err) {
      if (err instanceof SyntaxError) { /* corrupt JSON */ }
      else if (err instanceof Error && /not found/i.test(err.message)) { /* missing */ }
      else throw err;
    }
  }

  return { eventId, eventName, totalChapters: total, hasMore, chapters };
}

// ---------------------------------------------------------------------------
// Chardict + operator memoir helpers
// ---------------------------------------------------------------------------

function loadCharDict(store: JsonStore): Record<string, CharDictEntry> {
  if (charDictCache) return charDictCache;
  if (!store.exists(CHARDICT)) {
    charDictCache = {};
    return charDictCache;
  }
  try {
    charDictCache = store.readJson<Record<string, CharDictEntry>>(CHARDICT);
  } catch {
    charDictCache = {};
  }
  return charDictCache ?? {};
}

function resolveOperatorCode(
  charDict: Record<string, CharDictEntry>,
  operatorName: string
): string | null {
  for (const [code, info] of Object.entries(charDict)) {
    if (info.name === operatorName) return code;
  }
  return null;
}

function isMemoirEvent(eventId: string): boolean {
  return MEMOIR_EVENT_RE.test(eventId);
}

export function getOperatorMemoirs(
  zipPath: string,
  operatorName: string,
): OperatorMemoirResult {
  return withStoryStore(zipPath, (store) => getOperatorMemoirsFromStore(store, operatorName));
}

export function getOperatorMemoirsFromStore(
  store: JsonStore,
  operatorName: string,
): OperatorMemoirResult {
  const charDict = loadCharDict(store);
  if (Object.keys(charDict).length === 0) {
    throw new Error("chardict.json 未在 story zip 中找到。");
  }

  const code = resolveOperatorCode(charDict, operatorName);
  if (code === null) {
    throw new Error(
      `未找到干员名称 '${operatorName}' 对应的内部代码。请使用游戏内中文名称。`
    );
  }

  const charInfo = charDict[code];
  const operatorId = charInfo.id ?? "";

  const table = store.readJson<Record<string, RawReviewEntry>>(STORY_REVIEW_TABLE);
  const prefix = `story_${code}_set_`;
  const memoirEvents = Object.keys(table)
    .filter((eid) => eid.startsWith(prefix))
    .sort((a, b) => {
      const aNum = parseInt(a.split("_").pop() ?? "0", 10) || 0;
      const bNum = parseInt(b.split("_").pop() ?? "0", 10) || 0;
      return aNum - bNum;
    });

  if (memoirEvents.length === 0) {
    throw new Error(`干员 '${operatorName}' (code=${code}) 暂无密录数据。`);
  }

  const chapters: MemoirChapter[] = [];
  for (const eventId of memoirEvents) {
    const entry = table[eventId];
    const datas = (entry?.infoUnlockDatas ?? []).slice();
    datas.sort((a, b) => (a.storySort ?? 0) - (b.storySort ?? 0));
    for (const d of datas) {
      if (!d.storyTxt) continue;
      chapters.push({
        eventId,
        storyKey: d.storyTxt,
        storyCode: d.storyCode ?? "",
        storyName: d.storyName ?? "",
      });
    }
  }

  return {
    operatorName,
    internalCode: code,
    operatorId,
    totalChapters: chapters.length,
    chapters,
  };
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

const VALID_LINE_TYPES = new Set(["dialog", "narration", "choice"]);

function formatStoryLine(line: StoryLine): string {
  if (line.type === "dialog") {
    return `${line.role ?? "（旁白）"}：${line.text}`;
  } else if (line.type === "narration") {
    return `*${line.text}*`;
  } else {
    return `【选项】${line.text}`;
  }
}

/**
 * Search story text across all events (or a single event).
 *
 * Convenience wrapper around searchStoriesFromStore that auto-creates
 * a ZipStore from *zipPath*.
 */
export function searchStories(
  zipPath: string,
  pattern: string,
  character?: string,
  lineType?: string,
  contextLines = 1,
  maxResults = 30,
  eventId?: string,
): string {
  return withStoryStore(zipPath, (store) => searchStoriesFromStore(
    store,
    pattern,
    character,
    lineType,
    contextLines,
    maxResults,
    eventId,
  ));
}

interface SearchResult {
  eventId: string;
  storyCode: string;
  lineNumber: number;
  context: string;
}

/**
 * Full-text search across story dialogue, narration and choice lines.
 */
export function searchStoriesFromStore(
  store: JsonStore,
  pattern: string,
  character?: string,
  lineType?: string,
  contextLines = 1,
  maxResults = 30,
  eventId?: string,
): string {
  if (maxResults < 1) return "max_results 必须 >= 1。";
  if (maxResults > 100) return "max_results 必须 <= 100。";
  if (contextLines < 0) return "context_lines 必须 >= 0。";
  if (contextLines > 5) return "context_lines 必须 <= 5。";

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch (exc) {
    return `正则表达式无效：${exc instanceof Error ? exc.message : String(exc)}`;
  }

  if (lineType !== undefined && !VALID_LINE_TYPES.has(lineType)) {
    const valid = Array.from(VALID_LINE_TYPES).sort().join(", ");
    return `无效的 line_type：${JSON.stringify(lineType)}，可选值：${valid}`;
  }

  let index: StorySearchIndex;
  try {
    index = storySearchIndex(store);
  } catch (exc) {
    return `读取剧情数据索引失败：${exc instanceof Error ? exc.message : String(exc)}`;
  }

  if (eventId !== undefined && !index.eventIds.has(eventId)) {
    return `未找到匹配的活动：${JSON.stringify(eventId)}。`;
  }

  const results: SearchResult[] = [];

  for (const record of index.records) {
    if (results.length >= maxResults) break;
    const chapter = index.chapters[record.chapterIndex];
    const line = record.line;

    if (eventId !== undefined && chapter.eventId !== eventId) continue;
    if (character !== undefined) {
      if (line.type !== "dialog" || (line.role ?? "").toLowerCase() !== character.toLowerCase()) {
        continue;
      }
    }
    if (lineType !== undefined && line.type !== lineType) continue;
    if (!regex.test(line.text)) continue;

    const start = Math.max(0, record.lineIndex - contextLines);
    const end = Math.min(chapter.lines.length, record.lineIndex + contextLines + 1);
    const ctxParts: string[] = [];
    for (let j = start; j < end; j++) {
      const prefix = j === record.lineIndex ? ">>> " : "    ";
      ctxParts.push(prefix + formatStoryLine(chapter.lines[j]));
    }

    results.push({
      eventId: chapter.eventId,
      storyCode: chapter.storyCode,
      lineNumber: record.lineIndex + 1,
      context: ctxParts.join("\n"),
    });
  }

  if (results.length === 0) {
    const filters: string[] = [];
    if (eventId) filters.push(`event_id=${JSON.stringify(eventId)}`);
    if (character) filters.push(`character=${JSON.stringify(character)}`);
    if (lineType) filters.push(`line_type=${JSON.stringify(lineType)}`);
    const filterSuffix = filters.length > 0 ? `（过滤条件：${filters.join("。")}）` : "";
    return `未找到匹配 '${pattern}' 的剧情台词。${filterSuffix}`;
  }

  const parts: string[] = [`# 搜索 "${pattern}" 的结果（共 ${results.length} 条）`];
  for (const r of results) {
    parts.push(
      `\n---\n\n[stories/${r.eventId}/${r.storyCode} L${r.lineNumber}]\n${r.context}`
    );
  }

  return parts.join("\n");
}

function storySearchIndex(store: JsonStore): StorySearchIndex {
  const descriptor = storyStoreDescriptor(store);
  if (descriptor !== null && storySearchCache?.descriptor === descriptor) {
    return storySearchCache.index;
  }
  const index = buildStorySearchIndex(store);
  if (descriptor !== null) storySearchCache = { descriptor, index };
  return index;
}

function storyStoreDescriptor(store: JsonStore): string | null {
  if (store instanceof ZipStore) {
    const stat = statSync(store.zipPath);
    return `zip:${store.zipPath}:${stat.size}:${stat.mtimeMs}`;
  }
  if (store instanceof DirectoryStore) {
    const review = join(store.root, STORY_REVIEW_TABLE);
    try {
      const stat = statSync(review);
      return `directory:${store.root}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  }
  return null;
}

function buildStorySearchIndex(store: JsonStore): StorySearchIndex {
  const table = store.readJson<Record<string, RawReviewEntry>>(STORY_REVIEW_TABLE);
  const eventIds = new Set<string>();
  const chapters: StorySearchChapter[] = [];
  const records: StorySearchRecord[] = [];

  for (const [evId, entry] of Object.entries(table)) {
    const datas = (entry.infoUnlockDatas ?? []).slice();
    if (datas.length === 0) continue;
    // Only include NONE entries that are operator memoirs
    if ((entry.entryType ?? "NONE") === "NONE" && !isMemoirEvent(evId)) continue;
    eventIds.add(evId);
    datas.sort((a, b) => (a.storySort ?? 0) - (b.storySort ?? 0));
    for (const d of datas) {
      if (!d.storyTxt) continue;
      let chapter: StoryChapter;
      try {
        chapter = readStoryFromStore(store, d.storyTxt, true);
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        if (err instanceof Error && /not found/i.test(err.message)) continue;
        throw err;
      }
      const chapterIndex = chapters.length;
      chapters.push({
        eventId: evId,
        storyCode: d.storyCode ?? "",
        lines: chapter.lines,
      });
      for (let i = 0; i < chapter.lines.length; i++) {
        records.push({ chapterIndex, lineIndex: i, line: chapter.lines[i] });
      }
    }
  }

  return { eventIds, chapters, records };
}

// ---------------------------------------------------------------------------
// Event summary
// ---------------------------------------------------------------------------

/**
 * Return a chapter-by-chapter summary overview of an event.
 *
 * Convenience wrapper around getEventSummaryFromStore.
 */
export function getEventSummary(zipPath: string, eventId: string): string {
  return withStoryStore(zipPath, (store) => getEventSummaryFromStore(store, eventId));
}

/**
 * Return a chapter-by-chapter summary overview of an event.
 *
 * Reads story_review_table for chapter ordering and storyinfo.json
 * for per-chapter summaries.
 */
export function getEventSummaryFromStore(store: JsonStore, eventId: string): string {
  // --- event metadata ---
  let table: Record<string, RawReviewEntry>;
  try {
    table = store.readJson<Record<string, RawReviewEntry>>(STORY_REVIEW_TABLE);
  } catch (exc) {
    return `读取剧情数据索引失败：${exc instanceof Error ? exc.message : String(exc)}`;
  }

  const entry = table[eventId];
  if (!entry) {
    return `未找到活动：${JSON.stringify(eventId)}。请先调用 list_story_events 确认活动 ID。`;
  }

  const eventName = entry.name ?? eventId;
  const datas = (entry.infoUnlockDatas ?? []).slice();
  datas.sort((a, b) => (a.storySort ?? 0) - (b.storySort ?? 0));

  if (datas.length === 0) {
    return `活动 ${JSON.stringify(eventId)}（${eventName}）暂无剧情章节。`;
  }

  // --- load summary index ---
  let summaries: Record<string, string> = {};
  if (store.exists(STORYINFO)) {
    try {
      const raw = store.readJson<Record<string, unknown>>(STORYINFO);
      for (const [k, v] of Object.entries(raw)) {
        if (v) summaries[k] = String(v);
      }
    } catch {
      // storyinfo.json is optional for this tool
    }
  }

  // --- tier 1: LLM event summary ---
  let eventSummaryText = "";
  if (store.exists(EVENT_SUMMARIES)) {
    try {
      const raw = store.readJson<Record<string, unknown>>(EVENT_SUMMARIES);
      const text = raw[eventId];
      if (typeof text === "string") eventSummaryText = text.trim();
    } catch {
      // continue without LLM event summary
    }
  }

  // --- build output ---
  const total = datas.length;
  const lines: string[] = [`# ${eventName} — 共 ${total} 章`];
  if (eventSummaryText) lines.push(`\n${eventSummaryText}`);
  for (const d of datas) {
    const storyKey = d.storyTxt;
    if (!storyKey) continue;
    const code = d.storyCode ?? "";
    const name = d.storyName ?? "";
    const tag = d.avgTag ? `[${d.avgTag}] ` : "";

    const summary = summaries[storyKey] ?? "";
    if (summary) {
      lines.push(`\n${code} ${tag}${name}\n  ${summary}`);
    } else {
      lines.push(`\n${code} ${tag}${name}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-chapter summary
// ---------------------------------------------------------------------------

/**
 * Return a summary for a single story chapter.
 *
 * Convenience wrapper around getStorySummaryFromStore.
 */
export function getStorySummary(zipPath: string, storyKey: string): string {
  return withStoryStore(zipPath, (store) => getStorySummaryFromStore(store, storyKey));
}

/**
 * Return a summary for a single story chapter.
 *
 * Fallback chain:
 * 1. zh_CN/summaries.json — LLM-generated long summary (future)
 * 2. zh_CN/storyinfo.json — official one-line summary
 * 3. Chapter JSON storyInfo field — identical to #2, last resort
 */
export function getStorySummaryFromStore(store: JsonStore, storyKey: string): string {
  // --- tier 1: LLM summaries (future) ---
  if (store.exists(SUMMARIES)) {
    try {
      const raw = store.readJson<Record<string, unknown>>(SUMMARIES);
      const text = raw[storyKey];
      if (typeof text === "string" && text) return text.trim();
    } catch {
      // continue to next fallback
    }
  }

  // --- tier 2: storyinfo.json ---
  if (store.exists(STORYINFO)) {
    try {
      const raw = store.readJson<Record<string, unknown>>(STORYINFO);
      const text = raw[storyKey];
      if (typeof text === "string" && text) return text.trim();
    } catch {
      // continue to next fallback
    }
  }

  // --- tier 3: chapter JSON storyInfo ---
  const storyPath = storyZipPath(storyKey);
  if (store.exists(storyPath)) {
    try {
      const raw = store.readJson<Record<string, unknown>>(storyPath);
      const text = raw["storyInfo"];
      if (typeof text === "string" && text) return text.trim();
    } catch {
      // continue to not-found
    }
  }

  return `未找到剧情章节 '${storyKey}' 的梗概。`;
}
