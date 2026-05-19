/**
 * Tests for ZipStore AdmZip instance caching.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import { ZipStore } from "../src/data/stores.ts";

const FIXTURE_PATH = "zh_CN/gamedata/excel/sample.json";
const FIXTURE_DATA = { name: "阿米娅", rarity: 5 };

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "prts-zipcache-test-"));
}

function writeFixtureZip(path: string, data: unknown = FIXTURE_DATA): void {
  mkdirSync(dirname(path), { recursive: true });
  const zip = new AdmZip();
  zip.addFile(FIXTURE_PATH, Buffer.from(JSON.stringify(data), "utf-8"));
  zip.writeZip(path);
}

test("ZipStore reuses AdmZip instance across calls", () => {
  const root = tempRoot();
  const zipPath = join(root, "fixture.zip");
  writeFixtureZip(zipPath);
  const store = new ZipStore(zipPath);

  assert.equal(store.exists(FIXTURE_PATH), true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zip1 = (store as any)._zip;
  assert.ok(zip1 && typeof zip1 === "object" && typeof zip1.getEntry === "function",
    "first zip() should create an AdmZip-like object");

  assert.deepEqual(store.readJson(FIXTURE_PATH), FIXTURE_DATA);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zip2 = (store as any)._zip;

  assert.strictEqual(
    zip1,
    zip2,
    "ZipStore should reuse the same AdmZip instance",
  );
});

test("ZipStore cached instance still functions correctly", () => {
  const root = tempRoot();
  const zipPath = join(root, "fixture.zip");
  writeFixtureZip(zipPath);

  const store = new ZipStore(zipPath);

  for (let i = 0; i < 5; i++) {
    assert.equal(store.exists(FIXTURE_PATH), true);
    assert.match(store.readText(FIXTURE_PATH), /阿米娅/);
    assert.deepEqual(store.readJson(FIXTURE_PATH), FIXTURE_DATA);
  }
});

test("ZipStore reports missing entries correctly with cached instance", () => {
  const root = tempRoot();
  const zipPath = join(root, "fixture.zip");
  writeFixtureZip(zipPath);
  const store = new ZipStore(zipPath);

  assert.equal(store.exists("zh_CN/missing.json"), false);
  assert.throws(
    () => store.readText("zh_CN/missing.json"),
    /Dataset zip entry not found/,
  );
});
