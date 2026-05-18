/**
 * Enemy handbook reader — loads enemy_handbook_table.json from local game data.
 * Mirrors python/src/prts_mcp/data/enemy.py.
 */

import { loadConfig } from "../config.js";
import { DirectoryStore } from "./stores.js";

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

let _enemyData: Record<string, EnemyEntry> | null = null;
let _nameToEnemyId: Map<string, string> | null = null;

const ENEMY_FILE = "enemy_handbook_table.json";

export function clearEnemyCaches(): void {
  _enemyData = null;
  _nameToEnemyId = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnemyEntry {
  enemyId?: string;
  enemyIndex?: string;
  enemyTags?: string[] | null;
  sortId?: number;
  name?: string;
  enemyLevel?: string;
  description?: string;
  attackType?: string | null;
  ability?: string | null;
  isInvalidKilled?: boolean;
  hideInHandbook?: boolean;
  hideInStage?: boolean;
  invisibleDetail?: boolean;
  damageType?: string[];
}

interface EnemyHandbookData {
  enemyData?: Record<string, EnemyEntry>;
  raceData?: Record<string, { id?: string; raceName?: string }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function missingDataMessage(): string {
  const cfg = loadConfig();
  return (
    "敌人图鉴数据暂不可用。" +
    "容器启动时的 auto-sync 可能仍在进行中，请稍后重试；" +
    "若持续出现此提示，请检查网络连接或提供 GITHUB_TOKEN 以降低限速风险。" +
    `（当前同步目标路径：${cfg.excelPath}）`
  );
}

function hasEnemyData(): boolean {
  const cfg = loadConfig();
  if (cfg.effectiveExcelPath === null) return false;
  const store = new DirectoryStore(cfg.effectiveExcelPath);
  return store.exists(ENEMY_FILE);
}

function getEnemyData(): EnemyHandbookData {
  if (_enemyData === null) {
    const cfg = loadConfig();
    if (cfg.effectiveExcelPath === null) {
      throw new Error("effectiveExcelPath is null");
    }
    const store = new DirectoryStore(cfg.effectiveExcelPath);
    if (!store.exists(ENEMY_FILE)) {
      throw new Error(
        `敌人图鉴数据文件不存在：${store.resolveForDiagnostics(ENEMY_FILE)}。` +
          "数据目录可能为空，或挂载路径有误。"
      );
    }
    _enemyData = store.readJson<EnemyHandbookData>(ENEMY_FILE);
  }
  if (_enemyData === undefined) throw new Error("enemy_handbook_table load failed");
  return _enemyData;
}

function buildNameToEnemyId(): Map<string, string> {
  if (_nameToEnemyId === null) {
    const raw = getEnemyData();
    const ed = raw.enemyData ?? {};
    _nameToEnemyId = new Map(
      Object.entries(ed)
        .filter(([, info]) => info.name)
        .map(([eid, info]) => [info.name!, eid])
    );
  }
  return _nameToEnemyId;
}

function resolveEnemyId(name: string): string | null {
  return buildNameToEnemyId().get(name) ?? null;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

const ENEMY_LEVEL_ZH: Record<string, string> = {
  BOSS: "领袖",
  ELITE: "精英",
  NORMAL: "普通",
};

function fmtEnemy(info: EnemyEntry, includeId = false): string {
  const lines: string[] = [];
  const name = info.name ?? "";
  if (name) {
    lines.push(`# ${name} - 敌人图鉴\n`);
    if (includeId) {
      lines.push(`- **ID**：${info.enemyId ?? ""}`);
    }
  }

  if (info.enemyIndex) lines.push(`- **编号**：${info.enemyIndex}`);
  const level = info.enemyLevel ?? "";
  const levelZh = ENEMY_LEVEL_ZH[level] ?? level;
  if (levelZh) lines.push(`- **威胁等级**：${levelZh}`);
  if (info.description) lines.push(`- **描述**：${info.description}`);
  if (info.attackType) lines.push(`- **攻击方式**：${info.attackType}`);
  if (info.ability) lines.push(`- **特殊能力**：${info.ability}`);

  const damageTypes = info.damageType ?? [];
  if (damageTypes.length > 0) {
    const dtZh = damageTypes
      .map((dt) => ({ PHYSIC: "物理", MAGIC: "法术", HEAL: "治疗" })[dt] ?? dt)
      .join("、");
    lines.push(`- **伤害类型**：${dtZh}`);
  }

  const tags = info.enemyTags ?? [];
  if (tags && tags.length > 0) {
    lines.push(`- **标签**：${tags.join("、")}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return a list of all enemies in the handbook. */
export function listEnemies(): string {
  if (!hasEnemyData()) return missingDataMessage();

  let raw: EnemyHandbookData;
  try {
    raw = getEnemyData();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const ed = raw.enemyData ?? {};
  const entries = Object.entries(ed)
    .filter(
      ([, info]) => !info.hideInHandbook && info.name
    )
    .sort((a, b) => {
      const sa = a[1].sortId ?? 9999;
      const sb = b[1].sortId ?? 9999;
      return sa !== sb ? sa - sb : a[0].localeCompare(b[0]);
    });

  if (entries.length === 0) return "敌人图鉴数据为空。";

  const lines: string[] = [`# 全部敌人图鉴（共 ${entries.length} 个）\n`];
  for (const [, info] of entries) {
    const level = info.enemyLevel ?? "";
    const levelZh = ENEMY_LEVEL_ZH[level] ?? level;
    const index = info.enemyIndex ?? "";
    const name = info.name ?? "";
    const desc = (info.description ?? "").slice(0, 60);
    let line = `- **${name}** [${levelZh}] (${index})`;
    if (desc) line += ` — ${desc}`;
    lines.push(line);
  }
  return lines.join("\n");
}

/** Return full info for a single enemy by name. */
export function getEnemyInfo(name: string): string {
  if (!hasEnemyData()) return missingDataMessage();

  let eid: string | null;
  try {
    eid = resolveEnemyId(name);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (eid === null) return `未找到敌人 '${name}'。请使用游戏内名称。`;

  let raw: EnemyHandbookData;
  try {
    raw = getEnemyData();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const info = raw.enemyData?.[eid];
  if (!info) return `敌人 '${name}' 暂无详细信息。`;

  return fmtEnemy(info, true);
}

/** Regex search across enemy names and descriptions. */
export function searchEnemies(pattern: string, maxResults = 30): string {
  if (!hasEnemyData()) return missingDataMessage();

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch (err) {
    return `正则表达式无效：${err instanceof Error ? err.message : String(err)}`;
  }

  let raw: EnemyHandbookData;
  try {
    raw = getEnemyData();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const ed = raw.enemyData ?? {};
  const matches: EnemyEntry[] = [];
  for (const info of Object.values(ed)) {
    if (info.hideInHandbook) continue;
    const searchable = `${info.name ?? ""} ${info.description ?? ""} ${info.ability ?? ""}`;
    if (regex.test(searchable)) {
      matches.push(info);
      if (matches.length >= maxResults) break;
    }
  }

  if (matches.length === 0) return `未找到匹配 '${pattern}' 的敌人。`;

  const lines: string[] = [`# 搜索结果：${pattern}（共 ${matches.length} 个）\n`];
  for (const info of matches) {
    lines.push(fmtEnemy(info));
    lines.push("");
  }
  return lines.join("\n").trim();
}
