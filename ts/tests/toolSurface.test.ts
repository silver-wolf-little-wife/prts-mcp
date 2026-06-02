import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXPECTED_TOOLS = [
  "search_prts",
  "read_prts_page",
  "list_prts_sections",
  "get_prts_categories",
  "get_prts_links",
  "get_prts_template",
  "get_operator_archives",
  "get_operator_voicelines",
  "get_operator_basic_info",
  "list_enemies",
  "get_enemy_info",
  "search_enemies",
  "get_stage_enemies",
  "get_enemy_appearances",
  "list_stages",
  "get_stage_info",
  "search_stages",
  "list_items",
  "get_item_info",
  "search_items",
  "list_story_events",
  "list_stories",
  "get_event_summary",
  "get_story_summary",
  "read_story",
  "read_activity",
  "list_search_scopes",
  "search_data",
  "search_stories",
  "get_operator_memoirs",
];

test("TypeScript MCP tool names are frozen", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "src", "server.ts"), "utf-8");
  // Alpha hardening assumes tool names are registered as direct string literals.
  // Update this parser if server.tool(...) moves to constants or helper wrappers.
  const toolNames = Array.from(source.matchAll(/server\.tool\(\s*"([^"]+)"/g), (match) => match[1]);

  assert.deepEqual(toolNames, EXPECTED_TOOLS);
});
