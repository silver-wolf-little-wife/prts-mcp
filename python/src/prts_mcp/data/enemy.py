from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from prts_mcp.config import Config
from prts_mcp.data.stores import DirectoryStore


def _get_config() -> Config:
    return Config.load()


def clear_enemy_caches() -> None:
    _load_enemy_data.cache_clear()
    _build_enemy_name_to_id.cache_clear()


_ENEMY_FILE = "enemy_handbook_table.json"


def _missing_data_message() -> str:
    config = _get_config()
    return (
        "敌人图鉴数据暂不可用。"
        "容器启动时的 auto-sync 可能仍在进行中，请稍后重试；"
        "若持续出现此提示，请检查网络连接或提供 GITHUB_TOKEN 以降低限速风险。"
        f"（当前同步目标路径：{config.excel_path}）"
    )


def _store() -> DirectoryStore:
    ep = _get_config().effective_excel_path
    assert ep is not None
    return DirectoryStore(ep)


def _has_enemy_data() -> bool:
    cfg = _get_config()
    if cfg.effective_excel_path is None:
        return False
    return _store().exists(_ENEMY_FILE)


@lru_cache(maxsize=1)
def _load_enemy_data() -> dict[str, Any]:
    store = _store()
    if not store.exists(_ENEMY_FILE):
        raise FileNotFoundError(
            f"敌人图鉴数据文件不存在：{store.root / _ENEMY_FILE}。"
            "数据目录可能为空，或挂载路径有误。"
        )
    return store.read_json(_ENEMY_FILE)


@lru_cache(maxsize=1)
def _build_enemy_name_to_id() -> dict[str, str]:
    raw = _load_enemy_data()
    ed = raw.get("enemyData", {})
    return {info["name"]: eid for eid, info in ed.items() if info.get("name")}


def _resolve_enemy_id(name: str) -> str | None:
    mapping = _build_enemy_name_to_id()
    return mapping.get(name)


# ---------------------------------------------------------------------------
# Format helpers
# ---------------------------------------------------------------------------

_LABEL_ZH: dict[str, str] = {
    "enemyId": "ID",
    "enemyIndex": "编号",
    "name": "名称",
    "enemyLevel": "威胁等级",
    "description": "描述",
    "attackType": "攻击方式",
    "ability": "特殊能力",
}

_ENEMY_LEVEL_ZH: dict[str, str] = {
    "BOSS": "领袖",
    "ELITE": "精英",
    "NORMAL": "普通",
}


def _fmt_enemy(info: dict, include_id: bool = False) -> str:
    lines: list[str] = []
    name = info.get("name", "")
    if name:
        lines.append(f"# {name} - 敌人图鉴\n")
        if include_id:
            lines.append(f"- **ID**：{info.get('enemyId', '')}")

    enemy_index = info.get("enemyIndex", "")
    if enemy_index:
        lines.append(f"- **编号**：{enemy_index}")

    level = info.get("enemyLevel", "")
    level_zh = _ENEMY_LEVEL_ZH.get(level, level)
    if level_zh:
        lines.append(f"- **威胁等级**：{level_zh}")

    desc = info.get("description", "")
    if desc:
        lines.append(f"- **描述**：{desc}")

    attack = info.get("attackType") or ""
    if attack:
        lines.append(f"- **攻击方式**：{attack}")

    ability = info.get("ability") or ""
    if ability:
        lines.append(f"- **特殊能力**：{ability}")

    damage_types: list[str] = info.get("damageType") or []
    if damage_types:
        dt_zh = ", ".join(
            {"PHYSIC": "物理", "MAGIC": "法术", "HEAL": "治疗"}.get(dt, dt)
            for dt in damage_types
        )
        lines.append(f"- **伤害类型**：{dt_zh}")

    enemy_tags: list[str] = info.get("enemyTags") or []
    if enemy_tags:
        lines.append(f"- **标签**：{'、'.join(enemy_tags)}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def list_enemies() -> str:
    """Return a list of all enemies in the handbook."""
    if not _has_enemy_data():
        return _missing_data_message()

    try:
        raw = _load_enemy_data()
    except FileNotFoundError as exc:
        return str(exc)

    ed = raw.get("enemyData", {})
    if not ed:
        return "敌人图鉴数据为空。"

    # Filter hidden entries, sort by index
    entries = [
        (eid, info)
        for eid, info in ed.items()
        if not info.get("hideInHandbook") and info.get("name")
    ]
    entries.sort(key=lambda x: (x[1].get("sortId", 9999), x[0]))

    lines: list[str] = [f"# 全部敌人图鉴（共 {len(entries)} 个）\n"]
    for _eid, info in entries:
        level = info.get("enemyLevel", "")
        level_zh = _ENEMY_LEVEL_ZH.get(level, level)
        index = info.get("enemyIndex", "")
        name = info.get("name", "")
        desc = (info.get("description") or "")[:60]
        line = f"- **{name}** [{level_zh}] ({index})"
        if desc:
            line += f" — {desc}"
        lines.append(line)

    return "\n".join(lines)


def get_enemy_info(name: str) -> str:
    """Return full info for a single enemy by name."""
    if not _has_enemy_data():
        return _missing_data_message()

    try:
        eid = _resolve_enemy_id(name)
    except FileNotFoundError as exc:
        return str(exc)
    if eid is None:
        return f"未找到敌人 '{name}'。请使用游戏内名称。"

    try:
        raw = _load_enemy_data()
    except FileNotFoundError as exc:
        return str(exc)

    ed = raw.get("enemyData", {})
    info = ed.get(eid)
    if info is None:
        return f"敌人 '{name}' 暂无详细信息。"

    return _fmt_enemy(info, include_id=True)


def search_enemies(pattern: str, max_results: int = 30) -> str:
    """Regex search across enemy names and descriptions."""
    if not _has_enemy_data():
        return _missing_data_message()

    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        return f"正则表达式无效：{exc}"

    try:
        raw = _load_enemy_data()
    except FileNotFoundError as exc:
        return str(exc)

    ed = raw.get("enemyData", {})
    matches: list[dict] = []
    for _eid, info in ed.items():
        if info.get("hideInHandbook"):
            continue
        name = info.get("name") or ""
        desc = info.get("description") or ""
        ability = info.get("ability") or ""
        searchable = f"{name} {desc} {ability}"
        if regex.search(searchable):
            matches.append(info)
        if len(matches) >= max_results:
            break

    if not matches:
        return f"未找到匹配 '{pattern}' 的敌人。"

    lines: list[str] = [f"# 搜索结果：{pattern}（共 {len(matches)} 个）\n"]
    for info in matches:
        lines.append(_fmt_enemy(info))
        lines.append("")
    return "\n".join(lines).strip()
