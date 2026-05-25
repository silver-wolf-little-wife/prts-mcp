from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

from prts_mcp.data.stage import (
    clear_stage_caches,
    list_stages,
    get_stage_info,
    search_stages,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _write_sentinels(excel: Path) -> None:
    """Write minimal operator files so filesComplete() passes."""
    for fname in (
        "character_table.json",
        "handbook_info_table.json",
        "charword_table.json",
        "story_review_table.json",
    ):
        (excel / fname).write_text("{}", encoding="utf-8")


def _make_fixture(root: Path) -> None:
    excel = root / "zh_CN" / "gamedata" / "excel"
    excel.mkdir(parents=True, exist_ok=True)
    _write_sentinels(excel)

    stages = {
        "main_00-01": {
            "stageId": "main_00-01",
            "code": "0-1",
            "name": "坍塌",
            "stageType": "MAIN",
            "difficulty": "NORMAL",
            "zoneId": "main_0",
            "levelId": "Obt/Main/level_main_00-01",
            "apCost": 6,
            "dangerLevel": "LV.1",
            "description": "三点方向出现了敌人的先锋部队。",
            "stageDropInfo": {
                "displayRewards": [
                    {"type": "TKT_RECRUIT", "id": "7001", "dropType": "ONCE"},
                ],
            },
            "unlockCondition": [],
            "hardStagedId": "main_00-01#f#",
            "bossMark": False,
        },
        "main_00-01#f#": {
            "stageId": "main_00-01#f#",
            "code": "TR-1",
            "name": "坍塌·突袭",
            "stageType": "MAIN",
            "difficulty": "FOUR_STAR",
            "zoneId": "main_0",
            "levelId": "Obt/Main/level_main_00-01",
            "apCost": 9,
            "dangerLevel": "LV.2",
            "description": "<@lv.fs>突袭条件</>：敌方生命值提升。",
            "stageDropInfo": None,
            "unlockCondition": [
                {"stageId": "main_00-01", "completeState": "STAR_3"},
            ],
            "hardStagedId": None,
            "bossMark": True,
        },
        "act31side_01": {
            "stageId": "act31side_01",
            "code": "AS-1",
            "name": "测试活动关",
            "stageType": "ACTIVITY",
            "difficulty": "NORMAL",
            "zoneId": "act31side_zone1",
            "levelId": None,
            "apCost": 12,
            "dangerLevel": "NORMAL",
            "description": "",
            "stageDropInfo": {"displayRewards": []},
            "unlockCondition": [
                {"stageId": "act31side_02", "completeState": "PASS"},
            ],
            "hardStagedId": None,
            "bossMark": False,
        },
        "daily_01": {
            "stageId": "daily_01",
            "code": "CE-5",
            "name": "货物运送",
            "stageType": "DAILY",
            "difficulty": "NORMAL",
            "zoneId": "daily_zone1",
            "levelId": "Activities/Daily/level_daily_01",
            "apCost": 30,
            "dangerLevel": "ELITE",
            "description": "高资源产出的每日关卡。",
            "stageDropInfo": {
                "displayRewards": [
                    {"type": "GOLD", "dropType": "ONCE"},
                    {"type": "CARD_EXP", "dropType": "ONCE"},
                ],
            },
            "unlockCondition": [],
            "hardStagedId": None,
            "bossMark": False,
        },
    }

    zones = {
        "main_0": {
            "zoneID": "main_0",
            "zoneNameFirst": "序章",
            "zoneNameSecond": "黑暗时代·上",
        },
        "act31side_zone1": {
            "zoneID": "act31side_zone1",
            "zoneNameFirst": "火山旅梦",
            "zoneNameSecond": None,
        },
        "daily_zone1": {
            "zoneID": "daily_zone1",
            "zoneNameFirst": None,
            "zoneNameSecond": None,
        },
    }

    stage_table = {"stages": stages}
    zone_table = {"zones": zones}
    (excel / "stage_table.json").write_text(
        json.dumps(stage_table, ensure_ascii=False), encoding="utf-8"
    )
    (excel / "zone_table.json").write_text(
        json.dumps(zone_table, ensure_ascii=False), encoding="utf-8"
    )


@pytest.fixture(autouse=True)
def _reset_caches() -> None:
    clear_stage_caches()


@pytest.fixture
def gamedata() -> str:
    root = tempfile.mkdtemp(prefix="prts-stage-test-")
    os.environ["GAMEDATA_PATH"] = root
    _make_fixture(Path(root))
    yield root
    clear_stage_caches()
    os.environ.pop("GAMEDATA_PATH", None)


# ---------------------------------------------------------------------------
# list_stages
# ---------------------------------------------------------------------------


class TestListStages:
    def test_default_returns_all(self, gamedata: str) -> None:
        out = list_stages()
        assert "关卡列表" in out
        assert "坍塌" in out
        assert "测试活动关" in out
        assert "货物运送" in out
        assert "共 4 个" in out

    def test_chapter_filter(self, gamedata: str) -> None:
        out = list_stages(chapter="main_0")
        assert "坍塌" in out
        assert "坍塌·突袭" in out
        assert "测试活动关" not in out
        assert "共 2 个" in out

    def test_type_filter(self, gamedata: str) -> None:
        out = list_stages(type="DAILY")
        assert "货物运送" in out
        assert "坍塌" not in out
        assert "共 1 个" in out

    def test_combined_filter(self, gamedata: str) -> None:
        out = list_stages(chapter="main_0", type="MAIN")
        assert "坍塌" in out
        assert "坍塌·突袭" in out
        assert "共 2 个" in out

    def test_pagination(self, gamedata: str) -> None:
        out = list_stages(limit=2, offset=0)
        assert "显示第 1–2 条" in out
        assert "offset=2" in out

    def test_offset_beyond_range(self, gamedata: str) -> None:
        out = list_stages(offset=100)
        assert "offset 100 超出范围" in out

    def test_no_match(self, gamedata: str) -> None:
        out = list_stages(chapter="nonexistent")
        assert "没有匹配的关卡" in out

    def test_invalid_type(self, gamedata: str) -> None:
        out = list_stages(type="INVALID")
        assert "无效的 type" in out

    def test_invalid_limit(self, gamedata: str) -> None:
        out = list_stages(limit=0)
        assert "limit 必须 >= 1" in out

    def test_invalid_offset(self, gamedata: str) -> None:
        out = list_stages(offset=-1)
        assert "offset 必须 >= 0" in out


# ---------------------------------------------------------------------------
# get_stage_info
# ---------------------------------------------------------------------------


class TestGetStageInfo:
    def test_full_info(self, gamedata: str) -> None:
        out = get_stage_info("main_00-01")
        assert "坍塌" in out
        assert "0-1" in out
        assert "主线" in out
        assert "普通" in out
        assert "序章-黑暗时代·上" in out
        assert "6" in out
        assert "三点方向" in out
        assert "TKT_RECRUIT" in out
        assert "无条件" in out
        assert "main_00-01#f#" in out

    def test_four_star_variant(self, gamedata: str) -> None:
        out = get_stage_info("main_00-01#f#")
        assert "突袭" in out
        assert "三星通关 main_00-01" in out
        assert "BOSS标记" in out
        # description should have markup stripped
        assert "<@lv.fs>" not in out
        assert "</>" not in out
        assert "突袭条件" in out

    def test_null_level_id(self, gamedata: str) -> None:
        out = get_stage_info("act31side_01")
        assert "测试活动关" in out
        assert "AS-1" in out
        # levelId is null, so no level data line
        assert "关卡数据" not in out

    def test_empty_description(self, gamedata: str) -> None:
        out = get_stage_info("act31side_01")
        assert "无描述" in out

    def test_empty_drops(self, gamedata: str) -> None:
        out = get_stage_info("act31side_01")
        assert "（无）" in out

    def test_multi_drops(self, gamedata: str) -> None:
        out = get_stage_info("daily_01")
        assert "GOLD" in out
        assert "CARD_EXP" in out

    def test_unknown_stage(self, gamedata: str) -> None:
        out = get_stage_info("nonexistent")
        assert "未找到关卡" in out


# ---------------------------------------------------------------------------
# search_stages
# ---------------------------------------------------------------------------


class TestSearchStages:
    def test_by_name(self, gamedata: str) -> None:
        out = search_stages("坍塌")
        assert "坍塌" in out
        assert "坍塌·突袭" in out
        assert "搜索结果" in out

    def test_by_code(self, gamedata: str) -> None:
        out = search_stages("AS-1")
        assert "测试活动关" in out

    def test_by_description(self, gamedata: str) -> None:
        out = search_stages("先锋")
        assert "坍塌" in out

    def test_multiple_matches(self, gamedata: str) -> None:
        out = search_stages(".")
        assert "共 " in out

    def test_no_match(self, gamedata: str) -> None:
        out = search_stages("ZZZZNOMATCH")
        assert "未找到匹配" in out

    def test_invalid_regex(self, gamedata: str) -> None:
        out = search_stages("[invalid")
        assert "正则表达式无效" in out

    def test_max_results_cap(self, gamedata: str) -> None:
        out = search_stages(".", max_results=1)
        # Should only have 1 result despite 4 stages matching
        assert "共 1 个" in out
