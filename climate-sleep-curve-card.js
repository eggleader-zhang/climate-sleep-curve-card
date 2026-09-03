// src/curve-utils.mjs
var clamp = (value, min, max) => Math.min(max, Math.max(min, value));
var snap = (value, step, min = 0) => Math.round((value - min) / step) * step + min;
function resizePoints(points, hours) {
  const result = points.filter((point) => point.offset_minutes < hours * 60).map((point) => ({ ...point }));
  const lastTemperature = result.at(-1)?.temperature ?? 26;
  const lastFanMode = result.at(-1)?.fan_mode;
  for (let hour = 0; hour < hours; hour += 1) {
    if (!result.some((point) => point.offset_minutes === hour * 60)) {
      result.push({
        offset_minutes: hour * 60,
        temperature: lastTemperature,
        ...lastFanMode ? { fan_mode: lastFanMode } : {}
      });
    }
  }
  return result.sort((a, b) => a.offset_minutes - b.offset_minutes);
}

// src/ui-helpers.mjs
var t = (zh, en) => (navigator.language || "").toLowerCase().startsWith("zh") ? zh : en;
var esc = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
);
var errorMessage = (error) => error?.message || String(error);
function resultMeta(result) {
  const values = {
    applied: [t("\u5DF2\u5E94\u7528", "Applied"), "success", "mdi:check-circle"],
    no_change: [t("\u65E0\u9700\u8C03\u6574", "No change"), "neutral", "mdi:check"],
    skipped_off: [t("\u8BBE\u5907\u5DF2\u5173\u95ED", "Device off"), "warning", "mdi:power"],
    skipped_unavailable: [t("\u8BBE\u5907\u4E0D\u53EF\u7528", "Unavailable"), "warning", "mdi:cloud-off-outline"],
    skipped_unknown: [t("\u72B6\u6001\u672A\u77E5", "Unknown"), "warning", "mdi:help-circle-outline"],
    skipped_unsupported: [t("\u98CE\u901F\u4E0D\u652F\u6301", "Fan unsupported"), "warning", "mdi:fan-off"],
    skipped_state_changed: [t("\u8BBE\u5907\u72B6\u6001\u5DF2\u6539\u53D8", "State changed"), "warning", "mdi:swap-horizontal"],
    skipped_no_snapshot: [t("\u7F3A\u5C11\u542F\u52A8\u5FEB\u7167", "No starting snapshot"), "warning", "mdi:camera-off-outline"],
    skipped_cancelled: [t("\u64CD\u4F5C\u5DF2\u53D6\u6D88", "Cancelled"), "warning", "mdi:cancel"],
    skipped_mixed: [t("\u90E8\u5206\u5DF2\u8DF3\u8FC7", "Skipped"), "warning", "mdi:skip-next-circle-outline"],
    skipped_off_after_failure: [t("\u5931\u8D25\u540E\u5173\u95ED", "Off after failure"), "warning", "mdi:power"],
    failed: [t("\u6267\u884C\u5931\u8D25", "Failed"), "error", "mdi:alert-circle"],
    partial_failure: [t("\u90E8\u5206\u5931\u8D25", "Partial failure"), "error", "mdi:alert-circle-outline"]
  };
  const [label, tone, icon] = values[result] || [result || t("\u7B49\u5F85\u6267\u884C", "Pending"), "neutral", "mdi:clock-outline"];
  return { label, tone, icon };
}
function entityResultSummary(result) {
  if (!result) return "";
  const parts = [];
  if (result.temperature_result) {
    parts.push(`${t("\u6E29\u5EA6", "Temp")}: ${resultMeta(result.temperature_result).label}`);
  }
  if (result.fan_result && result.fan_result !== "not_requested") {
    parts.push(`${t("\u98CE\u901F", "Fan")}: ${resultMeta(result.fan_result).label}`);
  }
  return parts.join(" \xB7 ");
}
function ensureAuxDialog(host) {
  let dialog = host.shadowRoot.querySelector("#aux-dialog");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "aux-dialog";
    host.shadowRoot.append(dialog);
  }
  return dialog;
}
function showMessage(host, message, type = "error") {
  const container = host.dialog?.open ? host.dialog.querySelector(".editor") : host.shadowRoot.querySelector("ha-card");
  if (!container) return;
  container.querySelector("ha-alert[data-card-message]")?.remove();
  const alert = document.createElement("ha-alert");
  alert.dataset.cardMessage = "true";
  alert.setAttribute("alert-type", type);
  alert.textContent = message;
  container.prepend(alert);
  setTimeout(() => alert.remove(), type === "success" ? 3500 : 7e3);
}
function askConfirmation(host, { title, message, confirmLabel, danger = false }) {
  const dialog = ensureAuxDialog(host);
  dialog.innerHTML = `<div class="editor"><div class="title">${esc(title)}</div><p>${esc(message)}</p><div class="actions"><button class="${danger ? "danger" : ""}" id="confirm">${esc(confirmLabel)}</button><button class="secondary" id="cancel">${t("\u53D6\u6D88", "Cancel")}</button></div></div>`;
  return new Promise((resolve) => {
    let settled = false;
    const onCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.querySelector("#confirm").onclick = () => finish(true);
    dialog.querySelector("#cancel").onclick = () => finish(false);
    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
  });
}
function askText(host, { title, label, value = "", confirmLabel }) {
  const dialog = ensureAuxDialog(host);
  dialog.innerHTML = `<div class="editor"><div class="title">${esc(title)}</div><ha-textfield id="value" label="${esc(label)}" maxlength="64"></ha-textfield><div class="actions"><button id="confirm">${esc(confirmLabel)}</button><button class="secondary" id="cancel">${t("\u53D6\u6D88", "Cancel")}</button></div></div>`;
  const field = dialog.querySelector("#value");
  field.value = value;
  return new Promise((resolve) => {
    let settled = false;
    const onCancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const submit = () => {
      const result = String(field.value || "").trim();
      if (!result) {
        field.invalid = true;
        field.validationMessage = t("\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A", "Name is required");
        return;
      }
      finish(result);
    };
    dialog.querySelector("#confirm").onclick = submit;
    dialog.querySelector("#cancel").onclick = () => finish(null);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });
    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
    field.focus();
  });
}

// src/card.mjs
var ClimateSleepCurveCard = class extends HTMLElement {
  static getConfigElement() {
    return document.createElement("climate-sleep-curve-card-editor");
  }
  static getStubConfig() {
    return {};
  }
  setConfig(config) {
    this.config = { show_climate_state: true, show_next_point: true, compact: false, ...config };
    if (this._loaded) this.render();
  }
  set hass(value) {
    this._hass = value;
    if (!this._loaded) this.load();
    else if (!this.dialog?.open) this.render();
  }
  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.load();
  }
  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = void 0;
  }
  async load() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      this.state = await this._hass.callWS({ type: "climate_sleep_curve/get_state" });
      this.error = null;
      if (!this._unsubscribe) {
        this._unsubscribe = await this._hass.connection.subscribeMessage(() => {
          void this.refresh();
        }, { type: "climate_sleep_curve/subscribe" });
      }
    } catch (error) {
      this.error = t("\u5C1A\u672A\u5B89\u88C5\u6216\u52A0\u8F7D Climate Sleep Curve \u540E\u7AEF\u96C6\u6210\u3002", "Climate Sleep Curve backend is not installed or loaded.");
    } finally {
      this._loading = false;
      this._loaded = true;
      this.render();
    }
  }
  refresh() {
    if (this._refreshPromise) {
      this._refreshQueued = true;
      return this._refreshPromise;
    }
    this._refreshPromise = (async () => {
      try {
        do {
          this._refreshQueued = false;
          this.state = await this._hass.callWS({ type: "climate_sleep_curve/get_state" });
        } while (this._refreshQueued);
        this.error = null;
      } catch (error) {
        this.error = t("\u65E0\u6CD5\u5237\u65B0 Climate Sleep Curve \u72B6\u6001\u3002", "Unable to refresh Climate Sleep Curve state.");
      } finally {
        this._refreshPromise = void 0;
        if (!this.dialog?.open) this.render();
      }
    })();
    return this._refreshPromise;
  }
  get controller() {
    const configured = this.config?.controller_id;
    return this.state?.controllers.find((item) => item.id === configured) || (!configured && this.state?.controllers.length === 1 ? this.state.controllers[0] : null);
  }
  get profile() {
    return this.state?.profiles.find((item) => item.id === this.controller?.profile_id);
  }
  get session() {
    return this.state?.active_sessions.find((item) => item.controller_id === this.controller?.id);
  }
  entityIds(item) {
    return item?.climate_entity_ids || (item?.climate_entity_id ? [item.climate_entity_id] : []);
  }
  supportsCompletionPowerOff() {
    return this.state?.capabilities?.turn_off_after_completion === true;
  }
  supportsScheduledPowerOff() {
    return this.state?.capabilities?.turn_off_after_minutes === true;
  }
  supportsPreviousSettingsRestore() {
    return this.state?.capabilities?.restore_previous_settings_after_end === true;
  }
  bindExclusiveSwitches(first, second) {
    first.addEventListener("change", () => {
      if (first.checked) second.checked = false;
    });
    second.addEventListener("change", () => {
      if (second.checked) first.checked = false;
    });
  }
  commonFanModes() {
    const lists = this.entityIds(this.controller).map((entityId) => this._hass.states[entityId]?.attributes?.fan_modes).filter((modes) => Array.isArray(modes)).map((modes) => modes.filter((mode) => typeof mode === "string" && mode.length));
    if (!lists.length || lists.length !== this.entityIds(this.controller).length) return [];
    return [...new Set(lists[0])].filter((mode) => lists.every((modes) => modes.includes(mode)));
  }
  fanModeLabel(mode) {
    const labels = {
      auto: t("\u81EA\u52A8", "Auto"),
      low: t("\u4F4E", "Low"),
      medium: t("\u4E2D", "Medium"),
      middle: t("\u4E2D", "Middle"),
      high: t("\u9AD8", "High"),
      quiet: t("\u9759\u97F3", "Quiet"),
      silent: t("\u9759\u97F3", "Silent"),
      turbo: t("\u5F3A\u52B2", "Turbo"),
      diffuse: t("\u67D4\u98CE", "Diffuse")
    };
    return labels[String(mode).toLowerCase()] || mode;
  }
  fanModeChoices(currentMode, commonModes = this.commonFanModes()) {
    const choices = commonModes.map((mode) => ({ mode, unsupported: false }));
    if (currentMode && !commonModes.includes(currentMode)) {
      choices.unshift({ mode: currentMode, unsupported: true });
    }
    return choices;
  }
  entityResult(session, entityId) {
    return session?.last_entity_results?.find((item) => item.entity_id === entityId);
  }
  normalizeTime(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(value || ""));
    return match ? `${match[1]}:${match[2]}:${match[3] || "00"}` : null;
  }
  formatHours(minutes) {
    const hours = Number(minutes) / 60;
    const value = Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10);
    return t(`${value} \u5C0F\u65F6`, `${value}h`);
  }
  powerOffBounds(profileId) {
    const profile = this.state?.profiles?.find((item) => item.id === profileId);
    const duration = Number(profile?.duration_minutes);
    if (!Number.isFinite(duration) || duration <= 30) return null;
    return {
      duration,
      min: 30,
      max: duration - 30,
      suggested: Math.max(30, Math.min(duration - 30, duration - 120))
    };
  }
  setupSelector(selector, config, value) {
    const element = this.dialog.querySelector(selector);
    element.hass = this._hass;
    element.selector = config;
    element.value = value;
    element.addEventListener("value-changed", (event) => {
      element.value = event.detail.value;
    });
    return element;
  }
  render() {
    if (!this.shadowRoot) return;
    const style = `<style>
      :host{display:block;font-family:var(--paper-font-body1_-_font-family,Roboto,sans-serif)}ha-card{padding:20px;color:var(--primary-text-color);overflow:hidden}
      .row{display:flex;align-items:center;gap:12px}.between{justify-content:space-between}.muted{color:var(--secondary-text-color);font-size:13px}.title{font-size:20px;font-weight:600}
      button{border:0;border-radius:18px;padding:9px 16px;background:var(--primary-color);color:var(--text-primary-color,#fff);cursor:pointer;font:inherit}button.secondary{background:transparent;color:var(--primary-color);border:1px solid var(--divider-color)}button.danger{background:var(--error-color)}button:disabled{opacity:.5}.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
      .progress{height:7px;background:var(--divider-color);border-radius:5px;margin:15px 0;overflow:hidden}.progress i{display:block;height:100%;background:var(--primary-color)}
      dialog{border:0;border-radius:18px;padding:0;background:var(--card-background-color);color:var(--primary-text-color);width:min(720px,calc(100vw - 24px));max-height:calc(100vh - 24px)}dialog::backdrop{background:#0008}.editor{padding:20px;overflow:auto;max-height:calc(100vh - 64px)}
      label{display:block;margin:14px 0 5px}.field,select{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color)}
      .end-actions{border:0;padding:0;margin:18px 0 0}.end-actions legend{font-weight:500;padding:0}.end-actions p{line-height:1.5;overflow-wrap:anywhere}
      ha-selector,ha-textfield,ha-alert{display:block}.setting-row{display:flex;align-items:center;gap:10px;margin-top:18px}.setting-row label{margin:0}.weekdays{display:grid;grid-template-columns:repeat(7,minmax(58px,1fr));gap:6px}.weekday{display:flex;align-items:center;justify-content:center;gap:2px;margin:0;padding:7px 3px;border:1px solid var(--divider-color);border-radius:10px;cursor:pointer}.entity-list{display:grid;gap:5px;margin:12px 0}.entity-state{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:9px;background:color-mix(in srgb,var(--primary-color) 5%,transparent)}.entity-main{flex:1;min-width:0}.result{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:12px;font-size:12px;white-space:nowrap}.result ha-icon{--mdc-icon-size:16px}.result.success{color:var(--success-color);background:color-mix(in srgb,var(--success-color) 12%,transparent)}.result.warning{color:var(--warning-color);background:color-mix(in srgb,var(--warning-color) 12%,transparent)}.result.error{color:var(--error-color);background:color-mix(in srgb,var(--error-color) 12%,transparent)}.result.neutral{color:var(--secondary-text-color);background:var(--divider-color)}
      .chart{touch-action:none;width:100%;height:auto;background:color-mix(in srgb,var(--primary-color) 5%,transparent);border-radius:12px}.grid{stroke:var(--divider-color);stroke-width:1}.curve{fill:none;stroke:var(--primary-color);stroke-width:3}.area{fill:color-mix(in srgb,var(--primary-color) 18%,transparent)}.dot{fill:var(--primary-color);stroke:var(--card-background-color);stroke-width:3;cursor:ns-resize}.hit{fill:transparent;cursor:ns-resize}.axis{fill:var(--secondary-text-color);font-size:11px}.bubble{fill:var(--card-background-color);stroke:var(--primary-color)}
      .fan-curve{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin-top:8px}.fan-point{padding:8px;border:1px solid var(--divider-color);border-radius:10px;background:color-mix(in srgb,var(--primary-color) 4%,transparent)}.fan-point label{margin:0 0 5px;font-size:12px;color:var(--secondary-text-color)}.fan-point select{padding:7px}
      .notice{padding:12px;border-radius:8px;background:color-mix(in srgb,var(--error-color) 12%,transparent);color:var(--error-color)}@media(max-width:520px){ha-card{padding:16px}.editor{padding:14px}.title{font-size:18px}.weekdays{grid-template-columns:repeat(4,1fr)}}
    </style>`;
    if (this.error) {
      this.shadowRoot.innerHTML = `${style}<ha-card><div class="notice">${esc(this.error)}</div></ha-card>`;
      return;
    }
    if (!this.state) {
      this.shadowRoot.innerHTML = `${style}<ha-card>${t("\u6B63\u5728\u52A0\u8F7D\u2026", "Loading\u2026")}</ha-card>`;
      return;
    }
    if (!this.controller) {
      const choices = this.state.controllers.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("");
      this.shadowRoot.innerHTML = `${style}<ha-card><div class="title">${t("\u7A7A\u8C03\u7761\u7720\u66F2\u7EBF", "Climate Sleep Curve")}</div><p class="muted">${t("\u9009\u62E9\u5DF2\u6709\u63A7\u5236\u5668\uFF0C\u6216\u521B\u5EFA\u7B2C\u4E00\u6761\u66F2\u7EBF\u4E0E\u63A7\u5236\u5668\u3002", "Select a controller, or create your first profile and controller.")}</p>${choices ? `<select id="choose"><option value="">\u2014</option>${choices}</select>` : ""}<div class="actions"><button id="create">${t("\u5F00\u59CB\u8BBE\u7F6E", "Get started")}</button></div><dialog id="dialog"></dialog></ha-card>`;
      this.bindCommon();
      this.shadowRoot.querySelector("#choose")?.addEventListener("change", (event) => {
        this.config.controller_id = event.target.value;
        this.render();
      });
      this.shadowRoot.querySelector("#create").onclick = () => this.openSetup();
      return;
    }
    const profile = this.profile;
    const session = this.session;
    const entityIds = this.entityIds(session || this.controller);
    const endAction = session || this.controller;
    const endActionLabel = endAction.restore_previous_settings_after_end ? ` \xB7 ${t("\u7ED3\u675F\u65F6\u6062\u590D", "restore at end")}` : endAction.turn_off_after_completion ? endAction.turn_off_after_minutes ? ` \xB7 ${this.formatHours(endAction.turn_off_after_minutes)}${t("\u540E\u5173\u673A", " until turn off")}` : ` \xB7 ${t("\u7ED3\u675F\u540E\u5173\u673A", "turn off at end")}` : "";
    let progress = 0;
    let next = null;
    let nextTime = null;
    if (session) {
      progress = clamp((Date.now() - Date.parse(session.started_at)) / (Date.parse(session.ends_at) - Date.parse(session.started_at)) * 100, 0, 100);
      next = session.profile_snapshot?.points.find((point) => point.offset_minutes === session.next_offset_minutes);
      if (next) nextTime = new Intl.DateTimeFormat(void 0, { hour: "2-digit", minute: "2-digit" }).format(new Date(Date.parse(session.started_at) + next.offset_minutes * 6e4));
    }
    this.shadowRoot.innerHTML = `${style}<ha-card>
      <div class="row between"><div><div class="title">${esc(this.config.name || this.controller.name)}</div><div class="muted">${esc(session?.profile_snapshot?.name || profile?.name || t("\u66F2\u7EBF\u4E0D\u5B58\u5728", "Missing profile"))}${endActionLabel}</div></div><ha-icon icon="mdi:sleep"></ha-icon></div>
      ${this.config.show_climate_state ? `<div class="entity-list">${entityIds.map((entityId) => {
      const climate = this._hass.states[entityId], result = this.entityResult(session, entityId), meta = resultMeta(result?.result), detail = entityResultSummary(result), title = [detail, result?.error].filter(Boolean).join("\n");
      return `<div class="entity-state"><div class="entity-main">${esc(climate?.attributes?.friendly_name || entityId)} \xB7 ${esc(climate?.state || "unknown")}${climate?.attributes?.temperature != null ? ` \xB7 ${esc(climate.attributes.temperature)}\xB0` : ""}${climate?.attributes?.fan_mode ? ` \xB7 ${t("\u98CE\u901F", "Fan")} ${esc(this.fanModeLabel(climate.attributes.fan_mode))}` : ""}<div class="muted">${esc(entityId)}${detail ? `<br>${esc(detail)}` : ""}</div></div>${result ? `<span class="result ${meta.tone}" title="${esc(title)}"><ha-icon icon="${meta.icon}"></ha-icon>${esc(meta.label)}</span>` : ""}</div>`;
    }).join("")}</div>` : ""}
      <div class="progress"><i style="width:${progress}%"></i></div>
      <div class="row between"><span>${session ? t("\u8FD0\u884C\u4E2D", "Running") : t("\u672A\u8FD0\u884C", "Idle")}</span>${this.config.show_next_point && session ? `<span class="muted">${next ? `${t("\u4E0B\u4E00\u8282\u70B9", "Next")}: ${nextTime} \xB7 ${next.temperature}\xB0C${session.profile_snapshot?.fan_mode_control === "auto" ? ` \xB7 ${t("\u81EA\u52A8\u98CE", "Auto fan")}` : session.profile_snapshot?.fan_mode_control === "curve" && next.fan_mode ? ` \xB7 ${t("\u98CE\u901F", "Fan")} ${esc(this.fanModeLabel(next.fan_mode))}` : ""}` : session.turn_off_after_minutes ? `${t("\u5B9A\u65F6\u5173\u673A", "Turn off")}: ${new Intl.DateTimeFormat(void 0, { hour: "2-digit", minute: "2-digit" }).format(new Date(session.ends_at))}` : t("\u7B49\u5F85\u7ED3\u675F", "finishing")}</span>` : ""}</div>
      <div class="actions">${session ? `<button class="danger" id="stop">${t("\u505C\u6B62", "Stop")}</button><button class="secondary" id="restart">${t("\u91CD\u65B0\u5F00\u59CB", "Restart")}</button>` : `<button id="start">${t("\u542F\u52A8\u66F2\u7EBF", "Start curve")}</button>`}<button class="secondary" id="profiles">${t("\u66F2\u7EBF\u7BA1\u7406", "Profiles")}</button><button class="secondary" id="settings">${t("\u63A7\u5236\u5668", "Controller")}</button></div>
      <dialog id="dialog"></dialog>
    </ha-card>`;
    this.bindCommon();
    this.shadowRoot.querySelector("#start")?.addEventListener("click", () => this.action("start"));
    this.shadowRoot.querySelector("#stop")?.addEventListener("click", () => this.action("stop"));
    this.shadowRoot.querySelector("#restart")?.addEventListener("click", () => this.action("restart"));
    this.shadowRoot.querySelector("#profiles").onclick = () => this.openProfiles(profile?.id);
    this.shadowRoot.querySelector("#settings").onclick = () => this.openController(this.controller);
  }
  bindCommon() {
    this.dialog = this.shadowRoot.querySelector("#dialog");
  }
  async action(action) {
    try {
      await this._hass.callWS({ type: `climate_sleep_curve/session/${action}`, controller_id: this.controller.id });
      await this.refresh();
    } catch (error) {
      showMessage(this, errorMessage(error));
    }
  }
  openSetup() {
    this.dialog.innerHTML = `<div class="editor"><div class="title">${t("\u521B\u5EFA\u7761\u7720\u66F2\u7EBF", "Create sleep curve")}</div><label>${t("\u66F2\u7EBF\u540D\u79F0", "Profile name")}</label><input class="field" id="pname" value="${t("\u9ED8\u8BA4\u7761\u7720\u66F2\u7EBF", "Default sleep curve")}"><label>${t("\u63A7\u5236\u5668\u540D\u79F0", "Controller name")}</label><input class="field" id="cname" value="${t("\u5367\u5BA4\u7761\u7720\u66F2\u7EBF", "Bedroom sleep curve")}"><label>${t("\u7A7A\u8C03\u5B9E\u4F53\uFF08\u53EF\u591A\u9009\uFF09", "Climate entities (multiple allowed)")}</label><ha-selector id="entities"></ha-selector><div class="actions"><button id="save">${t("\u521B\u5EFA", "Create")}</button><button class="secondary" id="cancel">${t("\u53D6\u6D88", "Cancel")}</button></div></div>`;
    this.dialog.showModal();
    const entitySelector = this.setupSelector("#entities", { entity: { filter: { domain: "climate" }, multiple: true } }, []);
    this.dialog.querySelector("#cancel").onclick = () => this.dialog.close();
    this.dialog.querySelector("#save").onclick = async () => {
      const entityIds = Array.isArray(entitySelector.value) ? entitySelector.value : entitySelector.value ? [entitySelector.value] : [];
      if (!entityIds.length) return showMessage(this, t("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A climate \u5B9E\u4F53", "Select at least one climate entity"));
      const button = this.dialog.querySelector("#save");
      button.disabled = true;
      let profile = null;
      try {
        profile = await this._hass.callWS({ type: "climate_sleep_curve/profile/save", profile: { name: this.dialog.querySelector("#pname").value, duration_minutes: 480, interpolation: "step", fan_mode_control: "none", points: [26.5, 26.5, 27, 27.5, 28, 28, 27.5, 27].map((temperature, index) => ({ offset_minutes: index * 60, temperature })) }, expected_revision: null });
        const controller = await this._hass.callWS({ type: "climate_sleep_curve/controller/save", controller: { name: this.dialog.querySelector("#cname").value, climate_entity_ids: entityIds, profile_id: profile.id, enabled: true, turn_off_after_completion: false, turn_off_after_minutes: null, restore_previous_settings_after_end: false, automatic_start: { enabled: false, time: "23:00:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } }, expected_revision: null });
        this.config.controller_id = controller.id;
        this.dialog.close();
        await this.refresh();
      } catch (error) {
        if (profile) {
          try {
            await this._hass.callWS({ type: "climate_sleep_curve/profile/delete", profile_id: profile.id, expected_revision: profile.revision });
          } catch {
          }
        }
        button.disabled = false;
        showMessage(this, errorMessage(error));
      }
    };
  }
  openController(controller) {
    const profiles = this.state.profiles;
    const auto = controller.automatic_start;
    const supportsCompletionPowerOff = this.supportsCompletionPowerOff();
    const supportsScheduledPowerOff = this.supportsScheduledPowerOff();
    const supportsPreviousSettingsRestore = this.supportsPreviousSettingsRestore();
    const powerOffDisabled = supportsCompletionPowerOff ? "" : "disabled";
    const restoreDisabled = supportsPreviousSettingsRestore ? "" : "disabled";
    const powerOffHelp = supportsScheduledPowerOff ? t(
      "\u4ECE\u66F2\u7EBF\u542F\u52A8\u65F6\u5F00\u59CB\u8BA1\u65F6\uFF0C\u5230\u70B9\u540E\u81EA\u7136\u7ED3\u675F\u672C\u6B21\u4F1A\u8BDD\u5E76\u5173\u95ED\u7A7A\u8C03\u3002\u65F6\u95F4\u5FC5\u987B\u5927\u4E8E 0 \u4E14\u5C0F\u4E8E\u6240\u9009\u66F2\u7EBF\u65F6\u957F\uFF0C\u754C\u9762\u6309 0.5 \u5C0F\u65F6\u9012\u589E\u3002\u624B\u52A8\u505C\u6B62\u3001\u91CD\u65B0\u5F00\u59CB\u3001\u5220\u9664\u63A7\u5236\u5668\u6216 Home Assistant \u91CD\u542F\u6062\u590D\u90FD\u4E0D\u4F1A\u5173\u95ED\u7A7A\u8C03\u3002",
      "Counts from the curve start, then naturally completes the session and turns the climate devices off. The time must be greater than zero and shorter than the selected profile, in 0.5-hour steps. Manual stop, restart, controller deletion, and Home Assistant recovery never turn devices off."
    ) : supportsCompletionPowerOff ? t(
      "\u4EC5\u6B63\u5E38\u8FD0\u884C\u5230\u66F2\u7EBF\u7ED3\u675F\u65F6\u751F\u6548\uFF1B\u624B\u52A8\u505C\u6B62\u3001\u91CD\u65B0\u5F00\u59CB\u3001\u5220\u9664\u63A7\u5236\u5668\u6216 Home Assistant \u91CD\u542F\u6062\u590D\u90FD\u4E0D\u4F1A\u5173\u95ED\u7A7A\u8C03\u3002\u6240\u9009\u7A7A\u8C03\u5FC5\u987B\u652F\u6301\u5173\u673A\u670D\u52A1\u3002",
      "Only applies when the curve reaches its natural end. Manual stop, restart, controller deletion, and Home Assistant recovery never turn devices off. Every selected climate entity must support turn off."
    ) : t(
      "\u8BF7\u5148\u5C06 Climate Sleep Curve \u540E\u7AEF\u66F4\u65B0\u5230 0.5.0 \u6216\u66F4\u9AD8\u7248\u672C\u3002",
      "Update the Climate Sleep Curve backend to version 0.5.0 or later first."
    );
    const restoreHelp = supportsPreviousSettingsRestore ? t(
      "\u81EA\u7136\u7ED3\u675F\u6216\u660E\u786E\u70B9\u51FB\u505C\u6B62\u65F6\uFF0C\u6062\u590D\u542F\u52A8\u524D\u7684\u76EE\u6807\u6E29\u5EA6\u548C\u98CE\u901F\u3002\u82E5\u8BBE\u5907\u5F00\u5173\u6216 HVAC \u6A21\u5F0F\u5DF2\u6539\u53D8\uFF0C\u5219\u6574\u53F0\u8BBE\u5907\u8DF3\u8FC7\uFF1B\u91CD\u65B0\u5F00\u59CB\u3001\u66FF\u6362\u3001\u5220\u9664\u3001\u91CD\u8F7D\u548C\u91CD\u542F\u6062\u590D\u4E0D\u4F1A\u6267\u884C\u3002",
      "On natural completion or an explicit stop, restore the starting target temperature and fan. If power or HVAC mode changed, the entire device is skipped. Restart, replacement, deletion, reload, and recovery do not restore it."
    ) : t(
      "\u8BF7\u5148\u5C06 Climate Sleep Curve \u540E\u7AEF\u66F4\u65B0\u5230 0.6.0 \u6216\u66F4\u9AD8\u7248\u672C\u3002",
      "Update the Climate Sleep Curve backend to version 0.6.0 or later first."
    );
    const weekdayLabels = [t("\u5468\u4E00", "Mon"), t("\u5468\u4E8C", "Tue"), t("\u5468\u4E09", "Wed"), t("\u5468\u56DB", "Thu"), t("\u5468\u4E94", "Fri"), t("\u5468\u516D", "Sat"), t("\u5468\u65E5", "Sun")];
    const timingField = supportsScheduledPowerOff ? `<label for="turn-off-after-hours">${t("\u542F\u52A8\u540E\u51E0\u5C0F\u65F6\u5173\u673A", "Turn off after")}</label><input class="field" id="turn-off-after-hours" type="number" inputmode="decimal" min="0.5" step="0.5"><p class="muted" id="turn-off-time-help"></p>` : "";
    this.dialog.innerHTML = `<div class="editor"><div class="title">${t("\u63A7\u5236\u5668\u8BBE\u7F6E", "Controller settings")}</div><label>${t("\u540D\u79F0", "Name")}</label><input class="field" id="name" value="${esc(controller.name)}"><label>${t("\u7A7A\u8C03\u5B9E\u4F53\uFF08\u53EF\u591A\u9009\uFF09", "Climate entities (multiple allowed)")}</label><ha-selector id="entities"></ha-selector><label>${t("\u4E0B\u6B21\u4F1A\u8BDD\u4F7F\u7528\u7684\u66F2\u7EBF", "Profile for the next session")}</label><select id="profile">${profiles.map((profile) => `<option ${profile.id === controller.profile_id ? "selected" : ""} value="${profile.id}">${esc(profile.name)}</option>`).join("")}</select><div class="setting-row"><ha-switch id="automatic"></ha-switch><label for="automatic">${t("\u6BCF\u5929\u81EA\u52A8\u542F\u52A8", "Start automatically")}</label></div><label>${t("\u542F\u52A8\u65F6\u95F4", "Start time")}</label><ha-selector id="time"></ha-selector><label>${t("\u751F\u6548\u65E5\u671F", "Active weekdays")}</label><div class="weekdays">${weekdayLabels.map((label, index) => `<label class="weekday"><ha-checkbox data-day="${index}"></ha-checkbox><span>${label}</span></label>`).join("")}</div><fieldset class="end-actions"><legend>${t("\u7ED3\u675F\u52A8\u4F5C\uFF08\u53EA\u80FD\u9009\u62E9\u4E00\u9879\uFF09", "End action (choose one)")}</legend><div class="setting-row"><ha-switch id="turn-off-after-completion" aria-describedby="turn-off-help" ${powerOffDisabled}></ha-switch><label for="turn-off-after-completion">${supportsScheduledPowerOff ? t("\u5B9A\u65F6\u5173\u95ED\u7A7A\u8C03", "Turn off climate devices on a timer") : t("\u66F2\u7EBF\u81EA\u7136\u7ED3\u675F\u540E\u5173\u95ED\u7A7A\u8C03", "Turn off climate devices after natural completion")}</label></div>${timingField}<p class="muted" id="turn-off-help">${powerOffHelp}</p><div class="setting-row"><ha-switch id="restore-previous-settings" aria-describedby="restore-help" ${restoreDisabled}></ha-switch><label for="restore-previous-settings">${t("\u7ED3\u675F\u65F6\u6062\u590D\u542F\u52A8\u524D\u7684\u6E29\u5EA6\u548C\u98CE\u901F", "Restore starting temperature and fan at end")}</label></div><p class="muted" id="restore-help">${restoreHelp}</p></fieldset><div class="actions"><button id="save">${t("\u4FDD\u5B58", "Save")}</button><button class="secondary" id="cancel">${t("\u53D6\u6D88", "Cancel")}</button><button class="danger" id="delete">${t("\u5220\u9664\u63A7\u5236\u5668", "Delete controller")}</button></div></div>`;
    this.dialog.showModal();
    const entitySelector = this.setupSelector("#entities", { entity: { filter: { domain: "climate" }, multiple: true } }, this.entityIds(controller));
    const timeSelector = this.setupSelector("#time", { time: { no_second: true } }, auto.time);
    this.dialog.querySelector("#automatic").checked = auto.enabled;
    const turnOffSwitch = this.dialog.querySelector("#turn-off-after-completion");
    const restoreSwitch = this.dialog.querySelector("#restore-previous-settings");
    const profileSelect = this.dialog.querySelector("#profile");
    const turnOffHours = this.dialog.querySelector("#turn-off-after-hours");
    let preserveLegacyCompletion = Boolean(controller.turn_off_after_completion) && controller.turn_off_after_minutes == null;
    turnOffSwitch.checked = supportsCompletionPowerOff && Boolean(controller.turn_off_after_completion);
    restoreSwitch.checked = supportsPreviousSettingsRestore && Boolean(controller.restore_previous_settings_after_end) && !turnOffSwitch.checked;
    this.bindExclusiveSwitches(turnOffSwitch, restoreSwitch);
    const updateTurnOffTime = (fillDefault = false) => {
      if (!turnOffHours) return;
      const bounds = this.powerOffBounds(profileSelect.value);
      turnOffHours.disabled = !turnOffSwitch.checked;
      if (!bounds) return;
      turnOffHours.max = String(bounds.max / 60);
      if (fillDefault && !turnOffHours.value) turnOffHours.value = String(bounds.suggested / 60);
      if (turnOffHours.value && Number(turnOffHours.value) * 60 >= bounds.duration) {
        turnOffHours.value = String(bounds.max / 60);
      }
      const help = this.dialog.querySelector("#turn-off-time-help");
      if (help) help.textContent = t(
        `\u53EF\u8BBE\u7F6E ${this.formatHours(bounds.min)}\uFF5E${this.formatHours(bounds.max)}\uFF1B\u6240\u9009\u66F2\u7EBF\u5171 ${this.formatHours(bounds.duration)}\u3002`,
        `Choose ${this.formatHours(bounds.min)}\u2013${this.formatHours(bounds.max)}; the selected profile is ${this.formatHours(bounds.duration)}.`
      );
    };
    if (turnOffHours && controller.turn_off_after_minutes != null) {
      turnOffHours.value = String(controller.turn_off_after_minutes / 60);
    }
    updateTurnOffTime(false);
    turnOffSwitch.addEventListener("change", () => {
      if (!turnOffSwitch.checked) preserveLegacyCompletion = false;
      updateTurnOffTime(turnOffSwitch.checked && !preserveLegacyCompletion);
    });
    restoreSwitch.addEventListener("change", () => updateTurnOffTime(false));
    profileSelect.addEventListener("change", () => updateTurnOffTime(turnOffSwitch.checked && !preserveLegacyCompletion));
    this.dialog.querySelectorAll("ha-checkbox[data-day]").forEach((checkbox) => {
      checkbox.checked = auto.weekdays.includes(Number(checkbox.dataset.day));
    });
    this.dialog.querySelector("#cancel").onclick = () => this.dialog.close();
    this.dialog.querySelector("#save").onclick = async () => {
      try {
        const entityIds = Array.isArray(entitySelector.value) ? entitySelector.value : entitySelector.value ? [entitySelector.value] : [];
        if (!entityIds.length) return showMessage(this, t("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A climate \u5B9E\u4F53", "Select at least one climate entity"));
        const time = this.normalizeTime(timeSelector.value);
        if (!time) return showMessage(this, t("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u542F\u52A8\u65F6\u95F4", "Select a valid start time"));
        const weekdays = [...this.dialog.querySelectorAll("ha-checkbox[data-day]")].filter((item) => item.checked).map((item) => Number(item.dataset.day));
        if (this.dialog.querySelector("#automatic").checked && !weekdays.length) return showMessage(this, t("\u8BF7\u81F3\u5C11\u52FE\u9009\u4E00\u4E2A\u751F\u6548\u661F\u671F", "Select at least one active weekday"));
        let turnOffAfterMinutes = null;
        if (supportsScheduledPowerOff && turnOffSwitch.checked && turnOffHours.value) {
          const hours = Number(turnOffHours.value);
          const bounds = this.powerOffBounds(profileSelect.value);
          turnOffAfterMinutes = Math.round(hours * 60);
          if (!bounds || !Number.isFinite(hours) || turnOffAfterMinutes % 30 !== 0 || turnOffAfterMinutes <= 0 || turnOffAfterMinutes >= bounds.duration) return showMessage(this, t("\u5173\u673A\u65F6\u95F4\u5FC5\u987B\u5927\u4E8E 0\u3001\u5C0F\u4E8E\u66F2\u7EBF\u65F6\u957F\uFF0C\u5E76\u6309 0.5 \u5C0F\u65F6\u8BBE\u7F6E\u3002", "Turn-off time must be greater than zero, shorter than the profile, and use 0.5-hour steps."));
        } else if (supportsScheduledPowerOff && turnOffSwitch.checked && !preserveLegacyCompletion) {
          return showMessage(this, t("\u8BF7\u8BBE\u7F6E\u5173\u673A\u65F6\u95F4\u3002", "Set a turn-off time."));
        }
        const button = this.dialog.querySelector("#save");
        button.disabled = true;
        await this._hass.callWS({
          type: "climate_sleep_curve/controller/save",
          controller: {
            ...controller,
            name: this.dialog.querySelector("#name").value,
            climate_entity_ids: entityIds,
            climate_entity_id: entityIds[0],
            profile_id: profileSelect.value,
            turn_off_after_completion: supportsCompletionPowerOff && turnOffSwitch.checked,
            turn_off_after_minutes: supportsScheduledPowerOff ? turnOffAfterMinutes : controller.turn_off_after_minutes,
            restore_previous_settings_after_end: supportsPreviousSettingsRestore && restoreSwitch.checked,
            automatic_start: {
              enabled: this.dialog.querySelector("#automatic").checked,
              time,
              weekdays
            }
          },
          expected_revision: controller.revision
        });
        this.dialog.close();
        await this.refresh();
      } catch (error) {
        const button = this.dialog.querySelector("#save");
        if (button) button.disabled = false;
        showMessage(this, errorMessage(error));
      }
    };
    this.dialog.querySelector("#delete").onclick = async () => {
      const confirmed = await askConfirmation(this, {
        title: t("\u5220\u9664\u63A7\u5236\u5668", "Delete controller"),
        message: t("\u8FD0\u884C\u4E2D\u7684\u4F1A\u8BDD\u4F1A\u505C\u6B62\uFF0C\u4F46\u4E0D\u4F1A\u5173\u95ED\u7A7A\u8C03\u3002", "Its running session will stop without turning off any climate device."),
        confirmLabel: t("\u5220\u9664", "Delete"),
        danger: true
      });
      if (!confirmed) return;
      try {
        await this._hass.callWS({ type: "climate_sleep_curve/controller/delete", controller_id: controller.id, expected_revision: controller.revision });
        this.config.controller_id = void 0;
        this.dialog.close();
        await this.refresh();
      } catch (error) {
        showMessage(this, errorMessage(error));
      }
    };
  }
  openProfiles(selectedId = this.controller?.profile_id) {
    const profiles = this.state.profiles || [];
    const selected = profiles.find((item) => item.id === selectedId) || profiles[0];
    this.dialog.innerHTML = `<div class="editor"><div class="row between"><div><div class="title">${t("\u66F2\u7EBF\u7BA1\u7406", "Profile management")}</div><div class="muted">${t("\u521B\u5EFA\u591A\u6761\u66F2\u7EBF\uFF0C\u5E76\u76F4\u63A5\u9009\u62E9\u4E0B\u6B21\u4F1A\u8BDD\u4F7F\u7528\u7684\u9ED8\u8BA4\u66F2\u7EBF\u3002", "Create multiple profiles and choose the next session's default here.")}</div></div><button class="secondary" id="close">${t("\u5173\u95ED", "Close")}</button></div>${selected ? `<label>${t("\u9009\u62E9\u66F2\u7EBF", "Select profile")}</label><select id="profile-list">${profiles.map((profile) => `<option value="${profile.id}" ${profile.id === selected.id ? "selected" : ""}>${esc(profile.name)}${profile.id === this.controller?.profile_id ? ` \xB7 ${t("\u5F53\u524D\u9ED8\u8BA4", "default")}` : ""}</option>`).join("")}</select>` : `<p class="muted">${t("\u8FD8\u6CA1\u6709\u66F2\u7EBF\u3002", "No profiles yet.")}</p>`}<div class="actions">${selected ? `<button id="edit-profile">${t("\u7F16\u8F91", "Edit")}</button><button class="secondary" id="duplicate-profile">${t("\u590D\u5236", "Duplicate")}</button>${selected.id !== this.controller?.profile_id ? `<button class="secondary" id="set-default">${t("\u8BBE\u4E3A\u9ED8\u8BA4\u66F2\u7EBF", "Set as default")}</button>` : ""}` : ""}<button class="secondary" id="new-profile">${t("\u65B0\u5EFA\u66F2\u7EBF", "New profile")}</button></div></div>`;
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector("#close").onclick = () => this.dialog.close();
    this.dialog.querySelector("#profile-list")?.addEventListener("change", (event) => this.openProfiles(event.target.value));
    this.dialog.querySelector("#edit-profile")?.addEventListener("click", () => this.openProfile(selected, true));
    this.dialog.querySelector("#duplicate-profile")?.addEventListener("click", async () => {
      const name = await askText(this, { title: t("\u590D\u5236\u66F2\u7EBF", "Duplicate profile"), label: t("\u526F\u672C\u540D\u79F0", "Copy name"), value: `${selected.name} ${t("\u526F\u672C", "copy")}`, confirmLabel: t("\u590D\u5236", "Duplicate") });
      if (!name) return;
      try {
        const copy = await this._hass.callWS({ type: "climate_sleep_curve/profile/duplicate", profile_id: selected.id, name });
        await this.refresh();
        this.openProfiles(copy.id);
      } catch (error) {
        showMessage(this, errorMessage(error));
      }
    });
    this.dialog.querySelector("#set-default")?.addEventListener("click", async (event) => {
      const controller = this.controller;
      if (!controller) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await this._hass.callWS({ type: "climate_sleep_curve/controller/save", controller: { ...controller, profile_id: selected.id }, expected_revision: controller.revision });
        await this.refresh();
        this.openProfiles(selected.id);
        showMessage(this, t("\u9ED8\u8BA4\u66F2\u7EBF\u5DF2\u66F4\u65B0", "Default profile updated"), "success");
      } catch (error) {
        button.disabled = false;
        showMessage(this, errorMessage(error));
      }
    });
    this.dialog.querySelector("#new-profile").onclick = () => this.createProfile();
  }
  async createProfile() {
    const name = await askText(this, { title: t("\u65B0\u5EFA\u66F2\u7EBF", "New profile"), label: t("\u66F2\u7EBF\u540D\u79F0", "Profile name"), value: t("\u65B0\u7761\u7720\u66F2\u7EBF", "New sleep curve"), confirmLabel: t("\u521B\u5EFA", "Create") });
    if (!name) return;
    try {
      const profile = await this._hass.callWS({
        type: "climate_sleep_curve/profile/save",
        profile: { name, duration_minutes: 480, interpolation: "step", fan_mode_control: "none", points: [26.5, 26.5, 27, 27.5, 28, 28, 27.5, 27].map((temperature, index) => ({ offset_minutes: index * 60, temperature })) },
        expected_revision: null
      });
      await this.refresh();
      this.openProfile(profile, true);
    } catch (error) {
      showMessage(this, errorMessage(error));
    }
  }
  openProfile(profile, returnToProfiles = false) {
    if (!profile) return showMessage(this, t("\u66F2\u7EBF\u4E0D\u5B58\u5728\u3002", "The profile does not exist."));
    this.draft = structuredClone(profile);
    this.dirty = false;
    this.selected = 0;
    this.returnToProfiles = returnToProfiles;
    this.renderProfileDialog();
    if (!this.dialog.open) this.dialog.showModal();
  }
  renderProfileDialog() {
    const draft = this.draft, hours = draft.duration_minutes / 60;
    const commonFanModes = this.commonFanModes();
    const fanControl = draft.fan_mode_control || "none";
    const defaultFanMode = commonFanModes.includes("auto") ? "auto" : commonFanModes[0];
    const fanCurve = fanControl === "curve" ? `<div class="fan-curve">${draft.points.map((point, index) => `<div class="fan-point"><label>${index}h</label><select data-fan-index="${index}">${this.fanModeChoices(point.fan_mode, commonFanModes).map(({ mode, unsupported }) => `<option value="${esc(mode)}" ${mode === point.fan_mode ? "selected" : ""} ${unsupported ? "disabled" : ""}>${esc(this.fanModeLabel(mode))}${unsupported ? ` \xB7 ${t("\u5F53\u524D\u63A7\u5236\u5668\u4E0D\u652F\u6301", "unsupported here")}` : ""}</option>`).join("")}</select></div>`).join("")}</div>` : "";
    const incompatibleFanMode = fanControl === "auto" ? !commonFanModes.includes("auto") : fanControl === "curve" && draft.points.some((point) => !commonFanModes.includes(point.fan_mode));
    const fanHint = incompatibleFanMode ? t("\u8FD9\u6761\u5171\u4EAB\u66F2\u7EBF\u5305\u542B\u5F53\u524D\u63A7\u5236\u5668\u5E76\u975E\u5168\u90E8\u7A7A\u8C03\u90FD\u652F\u6301\u7684\u98CE\u901F\uFF1B\u8FD0\u884C\u65F6\u4F1A\u5B89\u5168\u8DF3\u8FC7\u4E0D\u652F\u6301\u7684\u8BBE\u5907\u3002\u8BF7\u9009\u62E9\u5171\u540C\u6A21\u5F0F\u5373\u53EF\u66FF\u6362\u65E7\u503C\u3002", "This shared profile contains fan modes not supported by every climate entity in this controller. Unsupported devices are safely skipped at runtime; choose a shared mode to replace an old value.") : commonFanModes.length ? t("\u98CE\u901F\u540D\u79F0\u6765\u81EA\u5F53\u524D\u63A7\u5236\u5668\u6240\u9009\u7A7A\u8C03\u5171\u540C\u652F\u6301\u7684\u6A21\u5F0F\u3002", "Fan modes are shared by every climate entity in the current controller.") : t("\u5F53\u524D\u6240\u9009\u7A7A\u8C03\u6CA1\u6709\u5171\u540C\u7684\u98CE\u901F\u6A21\u5F0F\uFF0C\u53EA\u80FD\u9009\u62E9\u4E0D\u63A7\u5236\u98CE\u901F\u3002", "The selected climate entities have no common fan mode, so fan control is unavailable.");
    this.dialog.innerHTML = `<div class="editor"><div class="row between"><div class="title">${t("\u7F16\u8F91\u7761\u7720\u66F2\u7EBF", "Edit sleep curve")}</div><button class="secondary" id="close">${t("\u8FD4\u56DE", "Back")}</button></div><label>${t("\u540D\u79F0", "Name")}</label><input class="field" id="name" maxlength="64" value="${esc(draft.name)}"><label>${t("\u65F6\u957F", "Duration")}: <b>${hours}h</b></label><input id="duration" type="range" min="4" max="12" step="1" value="${hours}" style="width:100%"><div class="row between"><label>${t("\u6E29\u5EA6\u66F2\u7EBF", "Temperature curve")}</label><button class="secondary" id="recommend">${t("\u63A8\u8350\u66F2\u7EBF", "Recommend")}</button></div>${this.chart(draft.points)}<p class="muted">${t("\u62D6\u52A8\u8282\u70B9\u6216\u4F7F\u7528\u65B9\u5411\u952E\u8C03\u6574\u3002\u540E\u53F0\u53EA\u5728\u79BB\u6563\u8282\u70B9\u6267\u884C\u3002", "Drag a point or use arrow keys. The backend acts only at discrete points.")}</p><label>${t("\u98CE\u901F\u63A7\u5236", "Fan control")}</label><select id="fan-control"><option value="none" ${fanControl === "none" ? "selected" : ""}>${t("\u4E0D\u63A7\u5236\u98CE\u901F", "Do not control fan")}</option><option value="auto" ${fanControl === "auto" ? "selected" : ""} ${!commonFanModes.includes("auto") && fanControl !== "auto" ? "disabled" : ""}>${t("\u5168\u7A0B\u81EA\u52A8\u98CE", "Automatic fan throughout")}</option><option value="curve" ${fanControl === "curve" ? "selected" : ""} ${!commonFanModes.length && fanControl !== "curve" ? "disabled" : ""}>${t("\u98CE\u91CF\u66F2\u7EBF", "Fan curve")}</option></select><p class="muted">${fanHint}</p>${fanCurve}<div class="actions"><button id="save">${t("\u4FDD\u5B58", "Save")}</button><button class="secondary" id="duplicate">${t("\u590D\u5236", "Duplicate")}</button><button class="secondary" id="cancel">${t("\u53D6\u6D88", "Cancel")}</button><button class="danger" id="delete">${t("\u5220\u9664", "Delete")}</button></div></div>`;
    this.bindChart();
    const closeEditor = async () => {
      if (this.dirty) {
        const confirmed = await askConfirmation(this, {
          title: t("\u653E\u5F03\u4FEE\u6539", "Discard changes"),
          message: t("\u5C1A\u672A\u4FDD\u5B58\u7684\u66F2\u7EBF\u4FEE\u6539\u5C06\u4F1A\u4E22\u5931\u3002", "Unsaved profile changes will be lost."),
          confirmLabel: t("\u653E\u5F03\u4FEE\u6539", "Discard"),
          danger: true
        });
        if (!confirmed) return;
      }
      if (this.returnToProfiles) this.openProfiles(this.draft.id);
      else this.dialog.close();
    };
    this.dialog.querySelector("#close").onclick = this.dialog.querySelector("#cancel").onclick = closeEditor;
    this.dialog.querySelector("#name").oninput = (event) => {
      this.draft.name = event.target.value;
      this.dirty = true;
    };
    this.dialog.querySelector("#fan-control").onchange = (event) => {
      this.draft.fan_mode_control = event.target.value;
      if (event.target.value === "curve") {
        this.draft.points.forEach((point) => {
          point.fan_mode ||= defaultFanMode;
        });
      } else {
        this.draft.points.forEach((point) => {
          delete point.fan_mode;
        });
      }
      this.dirty = true;
      this.renderProfileDialog();
    };
    this.dialog.querySelectorAll("select[data-fan-index]").forEach((select) => {
      select.onchange = (event) => {
        this.draft.points[Number(event.target.dataset.fanIndex)].fan_mode = event.target.value;
        this.dirty = true;
      };
    });
    this.dialog.querySelector("#duration").onchange = async (event) => {
      const next = Number(event.target.value), previous = this.draft.duration_minutes / 60;
      if (next < previous) {
        const confirmed = await askConfirmation(this, {
          title: t("\u7F29\u77ED\u66F2\u7EBF", "Shorten profile"),
          message: t("\u7F29\u77ED\u65F6\u957F\u4F1A\u5220\u9664\u672B\u5C3E\u8282\u70B9\u3002", "Shortening the duration removes trailing points."),
          confirmLabel: t("\u7EE7\u7EED\u7F29\u77ED", "Shorten"),
          danger: true
        });
        if (!confirmed) {
          event.target.value = previous;
          return;
        }
      }
      this.draft.points = this.resize(this.draft.points, next);
      this.draft.duration_minutes = next * 60;
      this.dirty = true;
      this.renderProfileDialog();
    };
    this.dialog.querySelector("#recommend").onclick = async () => {
      try {
        const previousPoints = this.draft.points;
        const recommended = await this._hass.callWS({ type: "climate_sleep_curve/profile/recommend", duration_minutes: this.draft.duration_minutes, starting_temperature: this.draft.points[0].temperature, preference: "comfort" });
        this.draft.points = recommended.points.map((point, index) => ({
          ...point,
          ...this.draft.fan_mode_control === "curve" ? { fan_mode: previousPoints[index]?.fan_mode || defaultFanMode } : {}
        }));
        this.dirty = true;
        this.renderProfileDialog();
      } catch (error) {
        showMessage(this, errorMessage(error));
      }
    };
    this.dialog.querySelector("#save").onclick = async () => {
      const button = this.dialog.querySelector("#save");
      button.disabled = true;
      try {
        this.draft.name = this.dialog.querySelector("#name").value;
        const saved = await this._hass.callWS({ type: "climate_sleep_curve/profile/save", profile: this.draft, expected_revision: this.draft.revision });
        this.dirty = false;
        await this.refresh();
        if (this.returnToProfiles) this.openProfiles(saved.id);
        else this.dialog.close();
      } catch (error) {
        button.disabled = false;
        showMessage(this, error.code === "revision_conflict" ? t("\u914D\u7F6E\u5DF2\u5728\u5176\u4ED6\u9875\u9762\u4FEE\u6539\u3002", "Configuration was modified elsewhere.") : errorMessage(error));
      }
    };
    this.dialog.querySelector("#duplicate").onclick = async () => {
      const name = await askText(this, { title: t("\u590D\u5236\u66F2\u7EBF", "Duplicate profile"), label: t("\u526F\u672C\u540D\u79F0", "Copy name"), value: `${this.draft.name} ${t("\u526F\u672C", "copy")}`, confirmLabel: t("\u590D\u5236", "Duplicate") });
      if (!name) return;
      try {
        const copy = await this._hass.callWS({ type: "climate_sleep_curve/profile/duplicate", profile_id: this.draft.id, name });
        await this.refresh();
        if (this.returnToProfiles) this.openProfiles(copy.id);
        else this.dialog.close();
      } catch (error) {
        showMessage(this, errorMessage(error));
      }
    };
    this.dialog.querySelector("#delete").onclick = async () => {
      const confirmed = await askConfirmation(this, { title: t("\u5220\u9664\u66F2\u7EBF", "Delete profile"), message: t("\u4ECD\u88AB\u63A7\u5236\u5668\u4F7F\u7528\u7684\u66F2\u7EBF\u65E0\u6CD5\u5220\u9664\u3002", "A profile still used by a controller cannot be deleted."), confirmLabel: t("\u5220\u9664", "Delete"), danger: true });
      if (!confirmed) return;
      try {
        await this._hass.callWS({ type: "climate_sleep_curve/profile/delete", profile_id: this.draft.id, expected_revision: this.draft.revision });
        await this.refresh();
        if (this.returnToProfiles) this.openProfiles();
        else this.dialog.close();
      } catch (error) {
        showMessage(this, errorMessage(error));
      }
    };
  }
  resize(points, hours) {
    return resizePoints(points, hours);
  }
  chart(points) {
    const settings = this.chartSettings(points), { min, max, step } = settings;
    const width = 640, height = 290, left = 38, right = 16, top = 22, bottom = 35, innerW = width - left - right, innerH = height - top - bottom;
    const x = (index) => left + (points.length === 1 ? 0 : index / (points.length - 1)) * innerW, y = (temp) => top + (max - temp) / (max - min) * innerH;
    const coords = points.map((point, index) => `${x(index)},${y(point.temperature)}`).join(" ");
    const area = `${left},${height - bottom} ${coords} ${left + innerW},${height - bottom}`;
    const grid = Array.from({ length: 5 }, (_, index) => Math.round((min + (max - min) * index / 4) * 10) / 10).map((temp) => `<line class="grid" x1="${left}" y1="${y(temp)}" x2="${left + innerW}" y2="${y(temp)}"/><text class="axis" x="2" y="${y(temp) + 4}">${temp}\xB0</text>`).join("");
    const labels = points.map((point, index) => `<text class="axis" text-anchor="middle" x="${x(index)}" y="${height - 10}">${index}h</text>`).join("");
    const dots = points.map((point, index) => `<circle class="hit" data-index="${index}" tabindex="0" role="slider" aria-label="${index} hours, ${point.temperature} degrees Celsius" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${point.temperature}" cx="${x(index)}" cy="${y(point.temperature)}" r="22"/><circle class="dot" cx="${x(index)}" cy="${y(point.temperature)}" r="7" pointer-events="none"/>`).join("");
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" data-top="${top}" data-height="${innerH}" data-min="${min}" data-max="${max}" data-step="${step}">${grid}<polygon class="area" points="${area}"/><polyline class="curve" points="${coords}"/>${labels}${dots}</svg>`;
  }
  chartSettings(points) {
    const values = points.map((point) => point.temperature);
    const ranges = this.entityIds(this.controller).map((entityId) => this._hass.states[entityId]?.attributes || {}).map((attrs) => {
      const fahrenheit = attrs.temperature_unit === "\xB0F", toC = (value) => fahrenheit ? (Number(value) - 32) * 5 / 9 : Number(value);
      const min2 = toC(attrs.min_temp), max2 = toC(attrs.max_temp), rawStep = Number(attrs.target_temp_step);
      return { min: min2, max: max2, step: !fahrenheit && [0.5, 1].includes(rawStep) ? rawStep : 0.5 };
    });
    const validMins = ranges.map((item) => item.min).filter(Number.isFinite), validMaxes = ranges.map((item) => item.max).filter(Number.isFinite);
    let min = validMins.length ? Math.max(...validMins) : Math.min(16, ...values);
    let max = validMaxes.length ? Math.min(...validMaxes) : Math.max(30, ...values);
    if (max <= min) {
      min = Math.min(16, ...values);
      max = Math.max(30, ...values);
    }
    min = Math.floor(Math.min(min, ...values));
    max = Math.ceil(Math.max(max, ...values));
    if (max <= min) max = min + 1;
    const step = ranges.some((item) => item.step === 1) ? 1 : 0.5;
    return { min, max, step };
  }
  bindChart() {
    const svg = this.dialog.querySelector("svg");
    let active = null;
    const update = (index, clientY, node) => {
      const box = svg.getBoundingClientRect(), top = Number(svg.dataset.top), height = Number(svg.dataset.height), min = Number(svg.dataset.min), max = Number(svg.dataset.max), step = Number(svg.dataset.step), viewY = (clientY - box.top) * 290 / box.height;
      this.draft.points[index].temperature = Math.round(snap(clamp(max - (viewY - top) / height * (max - min), min, max), step, min) * 10) / 10;
      this.dirty = true;
      const cy = top + (max - this.draft.points[index].temperature) / (max - min) * height;
      node.setAttribute("cy", cy);
      node.nextElementSibling?.setAttribute("cy", cy);
      node.setAttribute("aria-valuenow", this.draft.points[index].temperature);
    };
    svg.querySelectorAll(".hit").forEach((node) => {
      node.onpointerdown = (event) => {
        active = Number(node.dataset.index);
        node.setPointerCapture(event.pointerId);
        event.preventDefault();
      };
      node.onpointermove = (event) => {
        if (active === Number(node.dataset.index)) update(active, event.clientY, node);
      };
      node.onpointerup = () => {
        active = null;
        this.renderProfileDialog();
      };
      node.onkeydown = (event) => {
        if (["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const index = Number(node.dataset.index), min = Number(svg.dataset.min), max = Number(svg.dataset.max), step = Number(svg.dataset.step);
          this.draft.points[index].temperature = Math.round(clamp(this.draft.points[index].temperature + (event.key === "ArrowUp" ? step : -step), min, max) * 10) / 10;
          this.dirty = true;
          this.renderProfileDialog();
        }
      };
    });
  }
  getCardSize() {
    return this.config?.compact ? 2 : 3;
  }
};
var ClimateSleepCurveCardEditor = class extends HTMLElement {
  setConfig(config) {
    this.config = config;
    this.render();
  }
  set hass(value) {
    this._hass = value;
    this.load();
  }
  async load() {
    if (!this._hass) return;
    try {
      this.state = await this._hass.callWS({ type: "climate_sleep_curve/get_state" });
    } catch {
    }
    this.render();
  }
  render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const controllers = this.state?.controllers || [];
    this.shadowRoot.innerHTML = `<style>:host{display:block;padding:8px}label{display:block;margin:12px 0 4px}select,input{width:100%;box-sizing:border-box;padding:8px}</style><label>${t("\u63A7\u5236\u5668", "Controller")}</label><select id="controller"><option value="">\u2014</option>${controllers.map((item) => `<option value="${item.id}" ${item.id === this.config?.controller_id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select><label>${t("\u663E\u793A\u540D\u79F0", "Display name")}</label><input id="name" value="${esc(this.config?.name || "")}">`;
    const changed = () => this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: { ...this.config, controller_id: this.shadowRoot.querySelector("#controller").value || void 0, name: this.shadowRoot.querySelector("#name").value || void 0 } }, bubbles: true, composed: true }));
    this.shadowRoot.querySelector("#controller").onchange = changed;
    this.shadowRoot.querySelector("#name").onchange = changed;
  }
};
customElements.define("climate-sleep-curve-card", ClimateSleepCurveCard);
customElements.define("climate-sleep-curve-card-editor", ClimateSleepCurveCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({ type: "climate-sleep-curve-card", name: "Climate Sleep Curve", description: t("\u53EF\u89C6\u5316\u7A7A\u8C03\u7761\u7720\u6E29\u5EA6\u4E0E\u98CE\u91CF\u66F2\u7EBF", "Visual sleep temperature and fan curves for climate entities"), preview: true });
