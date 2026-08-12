import test from "node:test";
import assert from "node:assert/strict";
import {recommendation, resizePoints, snap} from "../src/curve-utils.mjs";

test("temperature snaps to entity precision", () => assert.equal(snap(26.7, .5), 26.5));
test("duration adds inherited hourly points", () => {
  const points = resizePoints([{offset_minutes: 0, temperature: 26, fan_mode: "low"}], 4);
  assert.deepEqual(points.map((point) => point.offset_minutes), [0, 60, 120, 180]);
  assert.ok(points.every((point) => point.temperature === 26));
  assert.ok(points.every((point) => point.fan_mode === "low"));
});
test("comfort recommendation matches specification", () => {
  assert.deepEqual(recommendation(8, 26.5).map((point) => point.temperature), [26.5, 26.5, 27, 27.5, 28, 28, 27.5, 27]);
});

