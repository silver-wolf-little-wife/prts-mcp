"""Full-text search across operator data tables."""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from prts_mcp.config import Config
from prts_mcp.data.operator import (
    _build_name_to_id,
    _load_character_table,
    _load_charword_table,
    _load_handbook_table,
)
from prts_mcp.utils.sanitizer import strip_wikitext


@dataclass(frozen=True)
class _OperatorSearchRecord:
    operator: str
    category: str
    field: str
    text: str


def clear_search_caches() -> None:
    """Clear cached cross-table search records."""
    _operator_search_records.cache_clear()


def search_operator_data(pattern: str, max_results: int = 30) -> str:
    """Search operator names, archive texts, and voice lines by regex.

    Case-insensitive.  Returns a formatted multi-block string.
    """
    if max_results < 1:
        return "max_results 必须 >= 1。"
    if max_results > 100:
        return "max_results 必须 <= 100。"

    config = Config.load()
    if not config.has_operator_data:
        return (
            "干员数据暂不可用。"
            "容器启动时的 auto-sync 可能仍在进行中，请稍后重试；"
            "若持续出现此提示，请检查网络连接或提供 GITHUB_TOKEN 以降低限速风险。"
            f"（当前同步目标路径：{config.excel_path}）"
        )

    try:
        regex = re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        return f"正则表达式无效：{exc}"

    results: list[_OperatorSearchRecord] = []
    for record in _operator_search_records():
        if regex.search(record.text):
            results.append(record)
            if len(results) >= max_results:
                break

    if not results:
        return f"未找到匹配 '{pattern}' 的干员数据。"

    blocks = [f"# 搜索 \"{pattern}\" 的结果（共 {len(results)} 条）"]
    for r in results:
        blocks.append(
            f"\n---\n\n"
            f"[operators/{r.category}/{r.operator}]\n"
            f"匹配：{r.field}\n"
            f"{r.text}"
        )

    return "".join(blocks)


@lru_cache(maxsize=1)
def _operator_search_records() -> tuple[_OperatorSearchRecord, ...]:
    ct = _load_character_table()
    handbook = _load_handbook_table().get("handbookDict", {})
    charwords = _load_charword_table().get("charWords", {})
    name_to_id = _build_name_to_id()

    charid_to_voices: dict[str, list[dict]] = {}
    for entry in charwords.values():
        cid = entry.get("charId")
        if cid and entry.get("voiceText"):
            charid_to_voices.setdefault(cid, []).append(entry)

    records: list[_OperatorSearchRecord] = []
    for name, char_id in name_to_id.items():
        info = ct.get(char_id)
        if info is None:
            continue

        records.append(_OperatorSearchRecord(
            operator=name,
            category="basic",
            field="干员名称",
            text=name,
        ))

        desc = info.get("description") or ""
        if desc:
            records.append(_OperatorSearchRecord(
                operator=name,
                category="basic",
                field="攻击属性",
                text=strip_wikitext(desc),
            ))

        hb_entry = handbook.get(char_id)
        if hb_entry:
            for story in hb_entry.get("storyTextAudio", []):
                title = story.get("storyTitle", "")
                for s in story.get("stories", []):
                    text = s.get("storyText", "")
                    if text:
                        records.append(_OperatorSearchRecord(
                            operator=name,
                            category="archives",
                            field=title,
                            text=text,
                        ))

        for v in charid_to_voices.get(char_id, []):
            records.append(_OperatorSearchRecord(
                operator=name,
                category="voicelines",
                field=v.get("voiceTitle", "未知"),
                text=v["voiceText"],
            ))

    return tuple(records)
