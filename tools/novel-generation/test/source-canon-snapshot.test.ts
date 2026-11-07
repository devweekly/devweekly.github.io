import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { restrictKnowledgeDatabaseToEntry } from "../src/source-canon-snapshot.js";

function fixture(): { dir: string; databasePath: string; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "novel-canon-snapshot-"));
  const databasePath = join(dir, "novel.db");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE world_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO world_meta VALUES('world_id','source-world');
    CREATE TABLE novel_kb_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO novel_kb_meta VALUES('schema','8');
    CREATE TABLE novel_chapters(chapter_id TEXT PRIMARY KEY, title TEXT NOT NULL, ordinal INTEGER NOT NULL);
    INSERT INTO novel_chapters VALUES
      ('c1','第一章',1),('c2','第二章',2),('c3','第三章',3);
    CREATE TABLE novel_mentions(chapter_id TEXT NOT NULL,name TEXT NOT NULL,count INTEGER NOT NULL,
      PRIMARY KEY(chapter_id,name),FOREIGN KEY(chapter_id) REFERENCES novel_chapters(chapter_id));
    INSERT INTO novel_mentions VALUES ('c1','甲',2),('c2','乙',3),('c3','丙',4);
    CREATE TABLE novel_beats(id TEXT PRIMARY KEY,chapter_ordinal INTEGER,summary TEXT);
    INSERT INTO novel_beats VALUES ('b1',1,'before'),('b2',2,'entry'),('b3',3,'future'),('b0',NULL,'unknown');
    CREATE TABLE novel_relations(id TEXT PRIMARY KEY,chapter_ordinal INTEGER,summary TEXT);
    INSERT INTO novel_relations VALUES ('r1',1,'before'),('r2',2,'entry'),('r3',3,'future');
    CREATE TABLE novel_character_chapter_states(id TEXT PRIMARY KEY,chapter_ordinal INTEGER,character_name TEXT,state TEXT);
    INSERT INTO novel_character_chapter_states VALUES ('s1',1,'甲','before'),('s2',2,'乙','entry'),('s3',3,'丙','future');
    CREATE TABLE story_analysis(singleton INTEGER PRIMARY KEY,payload_json TEXT);
    INSERT INTO story_analysis VALUES (1,'{"future":"spoiler"}');
    CREATE TABLE novel_characters(character_id TEXT PRIMARY KEY,name TEXT,bio TEXT);
    INSERT INTO novel_characters VALUES ('char1','全书人物画像','包含未来剧情');
    CREATE TABLE future_aggregate(id TEXT PRIMARY KEY,summary TEXT);
    INSERT INTO future_aggregate VALUES ('f1','未知表也必须清空');
  `);
  db.close();
  return { dir, databasePath, close: () => rmSync(dir, { recursive: true, force: true }) };
}

function rows(databasePath: string, sql: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(databasePath);
  try { return db.prepare(sql).all().map(row => ({ ...row })) as Array<Record<string, unknown>>; }
  finally { db.close(); }
}

test("historical snapshot retains only chapter evidence through the selected entry and rebinds world identity", () => {
  const f = fixture();
  try {
    const cutoff = restrictKnowledgeDatabaseToEntry(f.databasePath, "universe-one", "第二章");
    assert.equal(cutoff, 2);
    assert.deepEqual(rows(f.databasePath, "SELECT chapter_id,ordinal FROM novel_chapters ORDER BY ordinal"), [
      { chapter_id: "c1", ordinal: 1 }, { chapter_id: "c2", ordinal: 2 }
    ]);
    assert.deepEqual(rows(f.databasePath, "SELECT chapter_id,name FROM novel_mentions ORDER BY chapter_id"), [
      { chapter_id: "c1", name: "甲" }, { chapter_id: "c2", name: "乙" }
    ]);
    assert.deepEqual(rows(f.databasePath, "SELECT id FROM novel_beats ORDER BY id"), [{ id: "b1" }, { id: "b2" }]);
    assert.deepEqual(rows(f.databasePath, "SELECT id FROM novel_relations ORDER BY id"), [{ id: "r1" }, { id: "r2" }]);
    assert.deepEqual(rows(f.databasePath, "SELECT id FROM novel_character_chapter_states ORDER BY id"), [{ id: "s1" }, { id: "s2" }]);
    assert.equal(rows(f.databasePath, "SELECT * FROM story_analysis").length, 0);
    assert.equal(rows(f.databasePath, "SELECT * FROM novel_characters").length, 0);
    assert.equal(rows(f.databasePath, "SELECT * FROM future_aggregate").length, 0);
    assert.deepEqual(rows(f.databasePath, "SELECT value FROM world_meta WHERE key='world_id'"), [{ value: "universe-one" }]);
  } finally { f.close(); }
});

test("unresolvable entry chapter deletes the copied database instead of retaining full canon", () => {
  const f = fixture();
  try {
    assert.equal(restrictKnowledgeDatabaseToEntry(f.databasePath, "universe-one", "不存在的章节"), 0);
    assert.equal(existsSync(f.databasePath), false);
  } finally { f.close(); }
});

test("missing chapter ordinal schema fails closed and removes the copied database", () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-canon-invalid-"));
  const databasePath = join(dir, "novel.db");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE novel_chapters(chapter_id TEXT PRIMARY KEY,title TEXT NOT NULL); INSERT INTO novel_chapters VALUES('c1','第一章');");
  db.close();
  try {
    assert.equal(restrictKnowledgeDatabaseToEntry(databasePath, "universe-one", "第一章"), 0);
    assert.equal(existsSync(databasePath), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a chapter-addressable table missing its cutoff column is emptied", () => {
  const dir = mkdtempSync(join(tmpdir(), "novel-canon-missing-column-"));
  const databasePath = join(dir, "novel.db");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE novel_chapters(chapter_id TEXT PRIMARY KEY,title TEXT NOT NULL,ordinal INTEGER NOT NULL);
    INSERT INTO novel_chapters VALUES('c1','第一章',1);
    CREATE TABLE novel_beats(id TEXT PRIMARY KEY,summary TEXT);
    INSERT INTO novel_beats VALUES('b1','cannot establish chapter position');
  `);
  db.close();
  try {
    assert.equal(restrictKnowledgeDatabaseToEntry(databasePath, "universe-one", "第一章"), 1);
    assert.equal(rows(databasePath, "SELECT * FROM novel_beats").length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
