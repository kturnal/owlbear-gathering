// Run with: node --test gathering.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyYield, bandFor, cryptoRandomInt, resolveGather, rollGather, undoLatest } from "./gathering.js";

const rules = JSON.parse(readFileSync(new URL("./rules.json", import.meta.url), "utf8"));

/** A fake generator that hands back the given 0-based values in order. */
function scripted(...values) {
  let next = 0;
  return () => values[next++];
}

test("bands are even, 20 wide, and cover the whole d100", () => {
  assert.deepEqual(rules.bands.map((band) => band.upTo), [20, 40, 60, 80, 100]);
  assert.deepEqual(rules.bands.map((band) => band.dice), [1, 2, 3, 4, 5]);
  assert.equal(rules.bands.at(-1).upTo, rules.checkDie);
});

test("each band edge grants the right number of d4", () => {
  const edges = { 1: 1, 20: 1, 21: 2, 40: 2, 41: 3, 60: 3, 61: 4, 80: 4, 81: 5, 100: 5 };
  for (const [check, dice] of Object.entries(edges)) {
    assert.equal(bandFor(rules, Number(check)).dice, dice, `d100 = ${check}`);
  }
});

test("a d100 outside 1-100 is refused", () => {
  for (const bad of [0, 101, -5, 12.5, NaN]) {
    assert.throws(() => bandFor(rules, bad), RangeError);
  }
});

test("stone is the value, ore is half rounded up, skill rises by the value", () => {
  assert.deepEqual(resolveGather(rules, 50, [2, 4, 1]), {
    check: 50,
    dice: [2, 4, 1],
    value: 7,
    primary: 7,
    secondary: 4,
    rare: 0,
    skillIncrease: 7,
  });
  assert.equal(resolveGather(rules, 5, [1]).secondary, 1);
  assert.equal(resolveGather(rules, 30, [4, 4]).secondary, 4);
});

test("gems are value minus 14 and never negative", () => {
  assert.equal(resolveGather(rules, 70, [4, 4, 3, 3]).rare, 0); // value 14
  assert.equal(resolveGather(rules, 70, [4, 4, 4, 3]).rare, 1); // value 15
  assert.equal(resolveGather(rules, 70, [4, 4, 4, 4]).rare, 2); // value 16
  assert.equal(resolveGather(rules, 100, [4, 4, 4, 4, 4]).rare, 6); // value 20
  assert.equal(resolveGather(rules, 1, [1]).rare, 0);
});

test("the dice must match the band", () => {
  assert.throws(() => resolveGather(rules, 50, [2, 4]), RangeError);
  assert.throws(() => resolveGather(rules, 50, [2, 4, 5]), RangeError);
  assert.throws(() => resolveGather(rules, 50, [2, 4, 0]), RangeError);
});

test("rollGather rolls the d100, then as many d4 as its band grants", () => {
  // 0-based draws: d100 -> 57, then 3d4 -> 2, 4, 1
  const result = rollGather(rules, scripted(56, 1, 3, 0));
  assert.equal(result.check, 57);
  assert.deepEqual(result.dice, [2, 4, 1]);
  assert.equal(result.value, 7);
});

test("rollGather keeps a d100 rolled elsewhere and only rolls the d4s", () => {
  const result = rollGather(rules, scripted(3, 3, 3, 3, 3), 95);
  assert.equal(result.check, 95);
  assert.deepEqual(result.dice, [4, 4, 4, 4, 4]);
  assert.equal(result.rare, 6);
  assert.throws(() => rollGather(rules, scripted(0), 0), RangeError);
});

test("yield formulas round the way they say", () => {
  assert.equal(applyYield({ divideBy: 2, round: "up", minus: 0 }, 7), 4);
  assert.equal(applyYield({ divideBy: 2, round: "down", minus: 0 }, 7), 3);
  assert.equal(applyYield({ divideBy: 1, round: "up", minus: 14 }, 3), 0);
});

test("the real generator stays in range and reaches both ends", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(cryptoRandomInt(4));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test("every profession names its three materials", () => {
  for (const profession of rules.professions) {
    for (const key of ["id", "name", "primary", "secondary", "rare"]) {
      assert.ok(profession[key], `${profession.id ?? "profession"} is missing ${key}`);
    }
  }
});

test("undo removes the latest gather and takes back its skill", () => {
  const record = {
    name: "Daldun",
    skills: { mining: 56, fishing: 4 },
    log: [
      { t: 2, p: "mining", c: 90, d: [4, 2, 2, 4, 4], s: 56, i: 16 },
      { t: 1, p: "mining", c: 95, d: [2, 1, 3, 2, 1], s: 40, i: 9 },
    ],
  };
  const first = undoLatest(rules, record);
  assert.equal(first.skillIncrease, 16);
  assert.deepEqual(first.record.skills, { mining: 40, fishing: 4 });
  assert.equal(first.record.log.length, 1);
  assert.equal(record.log.length, 2, "the original record is left alone");

  const second = undoLatest(rules, first.record);
  assert.equal(second.record.skills.mining, 31);
  assert.equal(second.record.log.length, 0);
  assert.equal(undoLatest(rules, second.record), null);
});

test("undo works out older entries from their dice and never goes below 0", () => {
  const record = { skills: { mining: 3 }, log: [{ t: 1, p: "mining", c: 50, d: [2, 4, 1] }] };
  const undone = undoLatest(rules, record);
  assert.equal(undone.skillIncrease, 7);
  assert.equal(undone.record.skills.mining, 0);
});

test("an unreadable entry is removed without touching the skill", () => {
  const record = { skills: { mining: 20 }, log: [{ t: 1, p: "mining", c: 50, d: [9] }] };
  const undone = undoLatest(rules, record);
  assert.equal(undone.record.skills.mining, 20);
  assert.equal(undone.record.log.length, 0);
});

test("typing in a d100 rolled elsewhere is a switch in rules.json, off at this table", () => {
  assert.equal(rules.typeInCheck, false);
});
