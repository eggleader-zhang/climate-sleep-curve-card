import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const registry = new Map();
globalThis.HTMLElement = class {};
globalThis.customElements = {
  define(name, constructor) { registry.set(name, constructor); },
  get(name) { return registry.get(name); },
};
Object.defineProperty(globalThis, "navigator", {value: {language: "en"}, configurable: true});
globalThis.window = {customCards: []};

await import("../src/card.mjs");
const {entityResultSummary, resultMeta} = await import("../src/ui-helpers.mjs");
const Card = customElements.get("climate-sleep-curve-card");

test("disconnect releases the subscription for a later reconnect", () => {
  const card = new Card();
  let unsubscribed = 0;
  card._unsubscribe = () => { unsubscribed += 1; };

  card.disconnectedCallback();

  assert.equal(unsubscribed, 1);
  assert.equal(card._unsubscribe, undefined);
});

test("queued refreshes are serialized and keep the newest state", async () => {
  const card = new Card();
  let calls = 0;
  let releaseFirst;
  card._hass = {
    callWS: async () => {
      calls += 1;
      if (calls === 1) await new Promise((resolve) => { releaseFirst = resolve; });
      return {schema_version: calls};
    },
  };
  card.render = () => {};

  const first = card.refresh();
  const second = card.refresh();
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(calls, 2);
  assert.equal(card.state.schema_version, 2);
});

test("automatic start time is validated and normalized", () => {
  const card = new Card();

  assert.equal(card.normalizeTime("23:15"), "23:15:00");
  assert.equal(card.normalizeTime("08:04:09"), "08:04:09");
  assert.equal(card.normalizeTime("24:00"), null);
  assert.equal(card.normalizeTime(undefined), null);
});

test("per-entity execution outcomes have readable presentation metadata", () => {
  assert.deepEqual(resultMeta("applied"), {label: "Applied", tone: "success", icon: "mdi:check-circle"});
  assert.equal(resultMeta("failed").tone, "error");
  assert.equal(resultMeta("partial_failure").tone, "error");
  assert.equal(resultMeta("skipped_off").tone, "warning");
  assert.equal(resultMeta("skipped_unsupported").tone, "warning");
  assert.equal(entityResultSummary({
    temperature_result: "applied",
    fan_result: "failed",
  }), "Temp: Applied · Fan: Failed");
});

test("fan curve only offers modes shared by every selected climate entity", () => {
  const card = new Card();
  card.config = {controller_id: "controller"};
  card.state = {
    controllers: [{
      id: "controller",
      climate_entity_ids: ["climate.bedroom", "climate.study"],
    }],
  };
  card._hass = {states: {
    "climate.bedroom": {attributes: {fan_modes: ["auto", "low", "high"]}},
    "climate.study": {attributes: {fan_modes: ["auto", "low"]}},
  }};

  assert.deepEqual(card.commonFanModes(), ["auto", "low"]);
  assert.deepEqual(card.fanModeChoices("high"), [
    {mode: "high", unsupported: true},
    {mode: "auto", unsupported: false},
    {mode: "low", unsupported: false},
  ]);
  assert.deepEqual(card.fanModeChoices("auto"), [
    {mode: "auto", unsupported: false},
    {mode: "low", unsupported: false},
  ]);
});

test("source uses non-blocking in-card dialogs instead of browser dialogs", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/card.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/ui-helpers.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(sources.join("\n"), /\b(?:alert|prompt|confirm)\s*\(/);
});
