# PRTS-MCP 项目状态

_Last updated: 2026-05-28_

## 当前版本

| 实现 | 版本 | 状态 |
|------|------|------|
| Python | 1.5.0 | stable |
| TypeScript | 1.5.0 | stable |

- 当前稳定发布：24 个 MCP 工具（1.5.0）
- main 分支开发中：29 个 MCP 工具（1.6.0 目标，新增关卡敌人融合与物品/材料域）
- 兼容性合约：1.x 期间既有工具名和必填参数不变；minor 版本允许新增工具和可选参数

## 仓库结构

```
PRTS-MCP/
├── python/                 # Python 实现 (stdio, FastMCP)
│   ├── src/prts_mcp/       # 源码
│   │   ├── server.py       # MCP 工具注册 + 启动同步
│   │   ├── config.py       # 路径解析、环境变量
│   │   ├── api/            # PRTS Wiki MediaWiki API 客户端
│   │   ├── data/           # 干员/剧情/搜索/同步/store 抽象
│   │   └── utils/          # wikitext 清洗等工具
│   ├── tests/              # pytest 测试
│   ├── pyproject.toml      # 包元数据、依赖
│   └── CHANGELOG.md
├── ts/                     # TypeScript 实现 (Streamable HTTP, Express)
│   ├── src/                # 源码，结构对齐 python/
│   ├── tests/              # node --test 测试
│   ├── package.json
│   └── CHANGELOG.md
├── data/                   # 共享数据（gamedata zip 等）
├── docs/                   # 文档
│   ├── dev/                # 开发者文档
│   ├── admin/              # 管理员文档
│   └── user/               # 用户文档
├── dev/                    # 本地开发草稿（.gitignore 排除）
├── .github/workflows/      # CI/CD
│   ├── ci.yml              # 双实现测试
│   ├── cd.yml              # Python PyPI 发布
│   └── cd-ts.yml           # TS npm + Docker 发布
├── CLAUDE.md               # AI 协作说明（本会话必读）
├── ROADMAP.md              # 路线图
├── STATUS.md               # 本文件
└── README.md               # 面向用户的说明
```

## 数据源

| 数据源 | 用途 | 同步方式 |
|--------|------|----------|
| [ArknightsGameData](https://github.com/3aKHP/ArknightsGameData) | 干员/敌人/关卡/物品表格 | GitHub Release `zh_CN-excel.zip` |
| [ArknightsGameData](https://github.com/3aKHP/ArknightsGameData) | 关卡实际出怪与关卡级敌人数值 | GitHub Release `zh_CN-levels.zip` |
| [ArknightsStoryJson](https://github.com/3aKHP/ArknightsStoryJson) | 剧情台词 | GitHub Release `zh_CN.zip` |
| [PRTS Wiki API](https://prts.wiki/api.php) | 世界观词条/阵营设定 | 实时 HTTP 请求 |

## 工具清单 (29, main)

| # | 工具 | 数据源 | 版本 |
|---|------|--------|------|
| 1 | `search_prts` | PRTS Wiki | 0.1.0 |
| 2 | `read_prts_page` | PRTS Wiki | 0.1.0 |
| 3 | `get_operator_archives` | GameData | 0.1.0 |
| 4 | `get_operator_voicelines` | GameData | 0.1.0 |
| 5 | `get_operator_basic_info` | GameData | 0.1.0 |
| 6 | `list_story_events` | StoryJson | 0.3.0 |
| 7 | `list_stories` | StoryJson | 0.3.0 |
| 8 | `read_story` | StoryJson | 0.3.0 |
| 9 | `read_activity` | StoryJson | 0.3.0 |
| 10 | `list_search_scopes` | 混合 | 1.1.0 |
| 11 | `search_data` | GameData | 1.1.0 |
| 12 | `search_stories` | StoryJson | 1.1.0 |
| 13 | `get_event_summary` | StoryJson | 1.2.0 |
| 14 | `get_story_summary` | StoryJson | 1.2.0 |
| 15 | `list_prts_sections` | PRTS Wiki | 1.3.0 |
| 16 | `get_prts_categories` | PRTS Wiki | 1.3.0 |
| 17 | `get_prts_links` | PRTS Wiki | 1.3.0 |
| 18 | `get_prts_template` | PRTS Wiki | 1.4.0 |
| 19 | `list_enemies` | GameData | 1.4.0 |
| 20 | `get_enemy_info` | GameData | 1.4.0 |
| 21 | `search_enemies` | GameData | 1.4.0 |
| 22 | `get_stage_enemies` | GameData levels | 1.6.0 |
| 23 | `get_enemy_appearances` | GameData levels | 1.6.0 |
| 24 | `list_stages` | GameData | 1.5.0 |
| 25 | `get_stage_info` | GameData | 1.5.0 |
| 26 | `search_stages` | GameData | 1.5.0 |
| 27 | `list_items` | GameData | 1.6.0 |
| 28 | `get_item_info` | GameData | 1.6.0 |
| 29 | `search_items` | GameData | 1.6.0 |

## 遗留 TODO

- [ ] PRTS 搜索结果中 redirect 页面自动解析（MediaWiki API 限制）
- [ ] PRTS 搜索结果中 `/spine`、`/data` 等技术页面的更精确过滤

## 最近发布

| 版本 | 日期 | 亮点 |
|------|------|------|
| 1.6.0 | planned | 关卡敌人融合 + 物品/材料域（29 工具） |
| 1.5.0 | 2026-05-25 | 关卡数据域：list_stages、get_stage_info、search_stages（24 工具） |
| 1.4.2 | 2026-05-25 | 修复 Streamable HTTP session pool 400 错误 |
| 1.4.1 | 2026-05-19 | 生产修复：ZipStore 缓存、session 泄漏、httpx 复用、审计 parity |
| 1.4.0 | 2026-05-19 | 模板提取工具 + 敌人图鉴（含战斗属性） |
| 1.3.1 | 2026-05-19 | 修复 trap/token 同名干员 ID 碰撞 |
| 1.3.0 | 2026-05-18 | PRTS 深度集成：章节列表、分类标签、链接遍历 |
| 1.2.0 | 2026-05-14 | 剧情摘要工具 + LLM 管线 |
| 1.1.1 | 2026-05-14 | PRTS API 修复（parse 替代 extracts） |
| 1.1.0 | 2026-05-14 | 全文搜索工具 |
| 1.0.0 | 2026-05-13 | 稳定版，工具面冻结 |
