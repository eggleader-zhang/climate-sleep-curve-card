import {clamp, resizePoints, snap} from "./curve-utils.mjs";
import {askConfirmation, askText, entityResultSummary, errorMessage, esc, resultMeta, showMessage, t} from "./ui-helpers.mjs";

class ClimateSleepCurveCard extends HTMLElement {
  static getConfigElement() { return document.createElement("climate-sleep-curve-card-editor"); }
  static getStubConfig() { return {}; }

  setConfig(config) {
    this.config = {show_climate_state: true, show_next_point: true, compact: false, ...config};
    if (this._loaded) this.render();
  }

  set hass(value) {
    this._hass = value;
    if (!this._loaded) this.load(); else if (!this.dialog?.open) this.render();
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({mode: "open"});
    this.load();
  }

  disconnectedCallback() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = undefined;
  }

  async load() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      this.state = await this._hass.callWS({type: "climate_sleep_curve/get_state"});
      this.error = null;
      if (!this._unsubscribe) {
        this._unsubscribe = await this._hass.connection.subscribeMessage(() => { void this.refresh(); }, {type: "climate_sleep_curve/subscribe"});
      }
    } catch (error) {
      this.error = t("尚未安装或加载 Climate Sleep Curve 后端集成。", "Climate Sleep Curve backend is not installed or loaded.");
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
          this.state = await this._hass.callWS({type: "climate_sleep_curve/get_state"});
        } while (this._refreshQueued);
        this.error = null;
      } catch (error) {
        this.error = t("无法刷新 Climate Sleep Curve 状态。", "Unable to refresh Climate Sleep Curve state.");
      } finally {
        this._refreshPromise = undefined;
        if (!this.dialog?.open) this.render();
      }
    })();
    return this._refreshPromise;
  }

  get controller() {
    const configured = this.config?.controller_id;
    return this.state?.controllers.find((item) => item.id === configured) || (!configured && this.state?.controllers.length === 1 ? this.state.controllers[0] : null);
  }

  get profile() { return this.state?.profiles.find((item) => item.id === this.controller?.profile_id); }
  get session() { return this.state?.active_sessions.find((item) => item.controller_id === this.controller?.id); }

  entityIds(item) { return item?.climate_entity_ids || (item?.climate_entity_id ? [item.climate_entity_id] : []); }

  supportsCompletionPowerOff() {
    return this.state?.capabilities?.turn_off_after_completion === true;
  }

  commonFanModes() {
    const lists = this.entityIds(this.controller)
      .map((entityId) => this._hass.states[entityId]?.attributes?.fan_modes)
      .filter((modes) => Array.isArray(modes))
      .map((modes) => modes.filter((mode) => typeof mode === "string" && mode.length));
    if (!lists.length || lists.length !== this.entityIds(this.controller).length) return [];
    return [...new Set(lists[0])].filter((mode) => lists.every((modes) => modes.includes(mode)));
  }

  fanModeLabel(mode) {
    const labels = {
      auto: t("自动", "Auto"), low: t("低", "Low"), medium: t("中", "Medium"),
      middle: t("中", "Middle"), high: t("高", "High"), quiet: t("静音", "Quiet"),
      silent: t("静音", "Silent"), turbo: t("强劲", "Turbo"), diffuse: t("柔风", "Diffuse"),
    };
    return labels[String(mode).toLowerCase()] || mode;
  }

  fanModeChoices(currentMode, commonModes = this.commonFanModes()) {
    const choices = commonModes.map((mode) => ({mode, unsupported: false}));
    if (currentMode && !commonModes.includes(currentMode)) {
      choices.unshift({mode: currentMode, unsupported: true});
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

  setupSelector(selector, config, value) {
    const element = this.dialog.querySelector(selector);
    element.hass = this._hass;
    element.selector = config;
    element.value = value;
    element.addEventListener("value-changed", (event) => { element.value = event.detail.value; });
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
      ha-selector,ha-textfield,ha-alert{display:block}.setting-row{display:flex;align-items:center;gap:10px;margin-top:18px}.setting-row label{margin:0}.weekdays{display:grid;grid-template-columns:repeat(7,minmax(58px,1fr));gap:6px}.weekday{display:flex;align-items:center;justify-content:center;gap:2px;margin:0;padding:7px 3px;border:1px solid var(--divider-color);border-radius:10px;cursor:pointer}.entity-list{display:grid;gap:5px;margin:12px 0}.entity-state{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:9px;background:color-mix(in srgb,var(--primary-color) 5%,transparent)}.entity-main{flex:1;min-width:0}.result{display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:12px;font-size:12px;white-space:nowrap}.result ha-icon{--mdc-icon-size:16px}.result.success{color:var(--success-color);background:color-mix(in srgb,var(--success-color) 12%,transparent)}.result.warning{color:var(--warning-color);background:color-mix(in srgb,var(--warning-color) 12%,transparent)}.result.error{color:var(--error-color);background:color-mix(in srgb,var(--error-color) 12%,transparent)}.result.neutral{color:var(--secondary-text-color);background:var(--divider-color)}
      .chart{touch-action:none;width:100%;height:auto;background:color-mix(in srgb,var(--primary-color) 5%,transparent);border-radius:12px}.grid{stroke:var(--divider-color);stroke-width:1}.curve{fill:none;stroke:var(--primary-color);stroke-width:3}.area{fill:color-mix(in srgb,var(--primary-color) 18%,transparent)}.dot{fill:var(--primary-color);stroke:var(--card-background-color);stroke-width:3;cursor:ns-resize}.hit{fill:transparent;cursor:ns-resize}.axis{fill:var(--secondary-text-color);font-size:11px}.bubble{fill:var(--card-background-color);stroke:var(--primary-color)}
      .fan-curve{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin-top:8px}.fan-point{padding:8px;border:1px solid var(--divider-color);border-radius:10px;background:color-mix(in srgb,var(--primary-color) 4%,transparent)}.fan-point label{margin:0 0 5px;font-size:12px;color:var(--secondary-text-color)}.fan-point select{padding:7px}
      .notice{padding:12px;border-radius:8px;background:color-mix(in srgb,var(--error-color) 12%,transparent);color:var(--error-color)}@media(max-width:520px){ha-card{padding:16px}.editor{padding:14px}.title{font-size:18px}.weekdays{grid-template-columns:repeat(4,1fr)}}
    </style>`;
    if (this.error) { this.shadowRoot.innerHTML = `${style}<ha-card><div class="notice">${esc(this.error)}</div></ha-card>`; return; }
    if (!this.state) { this.shadowRoot.innerHTML = `${style}<ha-card>${t("正在加载…", "Loading…")}</ha-card>`; return; }
    if (!this.controller) {
      const choices = this.state.controllers.map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join("");
      this.shadowRoot.innerHTML = `${style}<ha-card><div class="title">${t("空调睡眠曲线", "Climate Sleep Curve")}</div><p class="muted">${t("选择已有控制器，或创建第一条曲线与控制器。", "Select a controller, or create your first profile and controller.")}</p>${choices ? `<select id="choose"><option value="">—</option>${choices}</select>` : ""}<div class="actions"><button id="create">${t("开始设置", "Get started")}</button></div><dialog id="dialog"></dialog></ha-card>`;
      this.bindCommon();
      this.shadowRoot.querySelector("#choose")?.addEventListener("change", (event) => { this.config.controller_id = event.target.value; this.render(); });
      this.shadowRoot.querySelector("#create").onclick = () => this.openSetup();
      return;
    }
    const profile = this.profile;
    const session = this.session;
    const entityIds = this.entityIds(session || this.controller);
    let progress = 0;
    let next = null;
    let nextTime = null;
    if (session) {
      progress = clamp((Date.now() - Date.parse(session.started_at)) / (Date.parse(session.ends_at) - Date.parse(session.started_at)) * 100, 0, 100);
      next = session.profile_snapshot?.points.find((point) => point.offset_minutes === session.next_offset_minutes);
      if (next) nextTime = new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"}).format(new Date(Date.parse(session.started_at)+next.offset_minutes*60000));
    }
    this.shadowRoot.innerHTML = `${style}<ha-card>
      <div class="row between"><div><div class="title">${esc(this.config.name || this.controller.name)}</div><div class="muted">${esc(session?.profile_snapshot?.name || profile?.name || t("曲线不存在", "Missing profile"))}${(session ? session.turn_off_after_completion : this.controller.turn_off_after_completion) ? ` · ${t("结束后关机", "turn off at end")}` : ""}</div></div><ha-icon icon="mdi:sleep"></ha-icon></div>
      ${this.config.show_climate_state ? `<div class="entity-list">${entityIds.map((entityId) => { const climate=this._hass.states[entityId],result=this.entityResult(session,entityId),meta=resultMeta(result?.result),detail=entityResultSummary(result),title=[detail,result?.error].filter(Boolean).join("\n"); return `<div class="entity-state"><div class="entity-main">${esc(climate?.attributes?.friendly_name || entityId)} · ${esc(climate?.state || "unknown")}${climate?.attributes?.temperature != null ? ` · ${esc(climate.attributes.temperature)}°` : ""}${climate?.attributes?.fan_mode ? ` · ${t("风速", "Fan")} ${esc(this.fanModeLabel(climate.attributes.fan_mode))}` : ""}<div class="muted">${esc(entityId)}${detail ? `<br>${esc(detail)}` : ""}</div></div>${result ? `<span class="result ${meta.tone}" title="${esc(title)}"><ha-icon icon="${meta.icon}"></ha-icon>${esc(meta.label)}</span>` : ""}</div>`; }).join("")}</div>` : ""}
      <div class="progress"><i style="width:${progress}%"></i></div>
      <div class="row between"><span>${session ? t("运行中", "Running") : t("未运行", "Idle")}</span>${this.config.show_next_point && session ? `<span class="muted">${t("下一节点", "Next")}: ${next ? `${nextTime} · ${next.temperature}°C${session.profile_snapshot?.fan_mode_control === "auto" ? ` · ${t("自动风", "Auto fan")}` : session.profile_snapshot?.fan_mode_control === "curve" && next.fan_mode ? ` · ${t("风速", "Fan")} ${esc(this.fanModeLabel(next.fan_mode))}` : ""}` : t("等待结束", "finishing")}</span>` : ""}</div>
      <div class="actions">${session ? `<button class="danger" id="stop">${t("停止", "Stop")}</button><button class="secondary" id="restart">${t("重新开始", "Restart")}</button>` : `<button id="start">${t("启动曲线", "Start curve")}</button>`}<button class="secondary" id="profiles">${t("曲线管理", "Profiles")}</button><button class="secondary" id="settings">${t("控制器", "Controller")}</button></div>
      <dialog id="dialog"></dialog>
    </ha-card>`;
    this.bindCommon();
    this.shadowRoot.querySelector("#start")?.addEventListener("click", () => this.action("start"));
    this.shadowRoot.querySelector("#stop")?.addEventListener("click", () => this.action("stop"));
    this.shadowRoot.querySelector("#restart")?.addEventListener("click", () => this.action("restart"));
    this.shadowRoot.querySelector("#profiles").onclick = () => this.openProfiles(profile?.id);
    this.shadowRoot.querySelector("#settings").onclick = () => this.openController(this.controller);
  }

  bindCommon() { this.dialog = this.shadowRoot.querySelector("#dialog"); }

  async action(action) {
    try { await this._hass.callWS({type: `climate_sleep_curve/session/${action}`, controller_id: this.controller.id}); await this.refresh(); }
    catch (error) { showMessage(this, errorMessage(error)); }
  }

  openSetup() {
    this.dialog.innerHTML = `<div class="editor"><div class="title">${t("创建睡眠曲线", "Create sleep curve")}</div><label>${t("曲线名称", "Profile name")}</label><input class="field" id="pname" value="${t("默认睡眠曲线", "Default sleep curve")}"><label>${t("控制器名称", "Controller name")}</label><input class="field" id="cname" value="${t("卧室睡眠曲线", "Bedroom sleep curve")}"><label>${t("空调实体（可多选）", "Climate entities (multiple allowed)")}</label><ha-selector id="entities"></ha-selector><div class="actions"><button id="save">${t("创建", "Create")}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button></div></div>`;
    this.dialog.showModal();
    const entitySelector = this.setupSelector("#entities", {entity:{filter:{domain:"climate"},multiple:true}}, []);
    this.dialog.querySelector("#cancel").onclick = () => this.dialog.close();
    this.dialog.querySelector("#save").onclick = async () => {
      const entityIds = Array.isArray(entitySelector.value) ? entitySelector.value : (entitySelector.value ? [entitySelector.value] : []);
      if (!entityIds.length) return showMessage(this, t("请至少选择一个 climate 实体", "Select at least one climate entity"));
      const button = this.dialog.querySelector("#save");
      button.disabled = true;
      let profile = null;
      try {
        profile = await this._hass.callWS({type:"climate_sleep_curve/profile/save", profile:{name:this.dialog.querySelector("#pname").value,duration_minutes:480,interpolation:"step",fan_mode_control:"none",points:[26.5,26.5,27,27.5,28,28,27.5,27].map((temperature,index)=>({offset_minutes:index*60,temperature}))}, expected_revision:null});
        const controller = await this._hass.callWS({type:"climate_sleep_curve/controller/save",controller:{name:this.dialog.querySelector("#cname").value,climate_entity_ids:entityIds,profile_id:profile.id,enabled:true,turn_off_after_completion:false,automatic_start:{enabled:false,time:"23:00:00",weekdays:[0,1,2,3,4,5,6]}},expected_revision:null});
        this.config.controller_id = controller.id; this.dialog.close(); await this.refresh();
      } catch (error) {
        if (profile) {
          try { await this._hass.callWS({type:"climate_sleep_curve/profile/delete",profile_id:profile.id,expected_revision:profile.revision}); } catch {}
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
    const powerOffDisabled = supportsCompletionPowerOff ? "" : "disabled";
    const powerOffHelp = supportsCompletionPowerOff
      ? t(
        "仅正常运行到曲线结束时生效；手动停止、重新开始、删除控制器或 Home Assistant 重启恢复都不会关闭空调。所选空调必须支持关机服务。",
        "Only applies when the curve reaches its natural end. Manual stop, restart, controller deletion, and Home Assistant recovery never turn devices off. Every selected climate entity must support turn off.",
      )
      : t(
        "请先将 Climate Sleep Curve 后端更新到 0.5.0 或更高版本。",
        "Update the Climate Sleep Curve backend to version 0.5.0 or later first.",
      );
    const weekdayLabels = [t("周一","Mon"),t("周二","Tue"),t("周三","Wed"),t("周四","Thu"),t("周五","Fri"),t("周六","Sat"),t("周日","Sun")];
    this.dialog.innerHTML = `<div class="editor"><div class="title">${t("控制器设置", "Controller settings")}</div><label>${t("名称", "Name")}</label><input class="field" id="name" value="${esc(controller.name)}"><label>${t("空调实体（可多选）", "Climate entities (multiple allowed)")}</label><ha-selector id="entities"></ha-selector><label>${t("下次会话使用的曲线", "Profile for the next session")}</label><select id="profile">${profiles.map((profile)=>`<option ${profile.id===controller.profile_id?"selected":""} value="${profile.id}">${esc(profile.name)}</option>`).join("")}</select><div class="setting-row"><ha-switch id="automatic"></ha-switch><label for="automatic">${t("每天自动启动", "Start automatically")}</label></div><label>${t("启动时间", "Start time")}</label><ha-selector id="time"></ha-selector><label>${t("生效日期", "Active weekdays")}</label><div class="weekdays">${weekdayLabels.map((label,index)=>`<label class="weekday"><ha-checkbox data-day="${index}"></ha-checkbox><span>${label}</span></label>`).join("")}</div><div class="setting-row"><ha-switch id="turn-off-after-completion" ${powerOffDisabled}></ha-switch><label for="turn-off-after-completion">${t("曲线自然结束后关闭空调", "Turn off climate devices after natural completion")}</label></div><p class="muted">${powerOffHelp}</p><div class="actions"><button id="save">${t("保存", "Save")}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button><button class="danger" id="delete">${t("删除控制器", "Delete controller")}</button></div></div>`;
    this.dialog.showModal();
    const entitySelector = this.setupSelector("#entities", {entity:{filter:{domain:"climate"},multiple:true}}, this.entityIds(controller));
    const timeSelector = this.setupSelector("#time", {time:{no_second:true}}, auto.time);
    this.dialog.querySelector("#automatic").checked = auto.enabled;
    this.dialog.querySelector("#turn-off-after-completion").checked = supportsCompletionPowerOff && Boolean(controller.turn_off_after_completion);
    this.dialog.querySelectorAll("ha-checkbox[data-day]").forEach((checkbox) => { checkbox.checked=auto.weekdays.includes(Number(checkbox.dataset.day)); });
    this.dialog.querySelector("#cancel").onclick = () => this.dialog.close();
    this.dialog.querySelector("#save").onclick = async () => {
      try {
        const entityIds = Array.isArray(entitySelector.value) ? entitySelector.value : (entitySelector.value ? [entitySelector.value] : []);
        if (!entityIds.length) return showMessage(this, t("请至少选择一个 climate 实体", "Select at least one climate entity"));
        const time = this.normalizeTime(timeSelector.value);
        if (!time) return showMessage(this, t("请选择有效的启动时间", "Select a valid start time"));
        const weekdays = [...this.dialog.querySelectorAll("ha-checkbox[data-day]")].filter((item)=>item.checked).map((item)=>Number(item.dataset.day));
        if (this.dialog.querySelector("#automatic").checked && !weekdays.length) return showMessage(this, t("请至少勾选一个生效星期", "Select at least one active weekday"));
        const button = this.dialog.querySelector("#save");
        button.disabled = true;
        await this._hass.callWS({
          type: "climate_sleep_curve/controller/save",
          controller: {
            ...controller,
            name: this.dialog.querySelector("#name").value,
            climate_entity_ids: entityIds,
            climate_entity_id: entityIds[0],
            profile_id: this.dialog.querySelector("#profile").value,
            turn_off_after_completion: supportsCompletionPowerOff
              && this.dialog.querySelector("#turn-off-after-completion").checked,
            automatic_start: {
              enabled: this.dialog.querySelector("#automatic").checked,
              time,
              weekdays,
            },
          },
          expected_revision: controller.revision,
        });
        this.dialog.close(); await this.refresh();
      } catch(error) { const button=this.dialog.querySelector("#save");if(button)button.disabled=false;showMessage(this, errorMessage(error)); }
    };
    this.dialog.querySelector("#delete").onclick = async () => {
      const confirmed = await askConfirmation(this, {
        title: t("删除控制器", "Delete controller"),
        message: t("运行中的会话会停止，但不会关闭空调。", "Its running session will stop without turning off any climate device."),
        confirmLabel: t("删除", "Delete"),
        danger: true,
      });
      if (!confirmed) return;
      try { await this._hass.callWS({type:"climate_sleep_curve/controller/delete",controller_id:controller.id,expected_revision:controller.revision});this.config.controller_id=undefined;this.dialog.close();await this.refresh(); }
      catch(error){showMessage(this, errorMessage(error));}
    };
  }

  openProfiles(selectedId = this.controller?.profile_id) {
    const profiles = this.state.profiles || [];
    const selected = profiles.find((item) => item.id === selectedId) || profiles[0];
    this.dialog.innerHTML = `<div class="editor"><div class="row between"><div><div class="title">${t("曲线管理", "Profile management")}</div><div class="muted">${t("创建多条曲线，并直接选择下次会话使用的默认曲线。", "Create multiple profiles and choose the next session's default here.")}</div></div><button class="secondary" id="close">${t("关闭", "Close")}</button></div>${selected ? `<label>${t("选择曲线", "Select profile")}</label><select id="profile-list">${profiles.map((profile)=>`<option value="${profile.id}" ${profile.id===selected.id?"selected":""}>${esc(profile.name)}${profile.id===this.controller?.profile_id?` · ${t("当前默认", "default")}`:""}</option>`).join("")}</select>` : `<p class="muted">${t("还没有曲线。", "No profiles yet.")}</p>`}<div class="actions">${selected ? `<button id="edit-profile">${t("编辑", "Edit")}</button><button class="secondary" id="duplicate-profile">${t("复制", "Duplicate")}</button>${selected.id!==this.controller?.profile_id?`<button class="secondary" id="set-default">${t("设为默认曲线", "Set as default")}</button>`:""}` : ""}<button class="secondary" id="new-profile">${t("新建曲线", "New profile")}</button></div></div>`;
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector("#close").onclick = () => this.dialog.close();
    this.dialog.querySelector("#profile-list")?.addEventListener("change", (event) => this.openProfiles(event.target.value));
    this.dialog.querySelector("#edit-profile")?.addEventListener("click", () => this.openProfile(selected, true));
    this.dialog.querySelector("#duplicate-profile")?.addEventListener("click", async () => {
      const name=await askText(this,{title:t("复制曲线","Duplicate profile"),label:t("副本名称","Copy name"),value:`${selected.name} ${t("副本", "copy")}`,confirmLabel:t("复制","Duplicate")});if(!name)return;
      try { const copy=await this._hass.callWS({type:"climate_sleep_curve/profile/duplicate",profile_id:selected.id,name});await this.refresh();this.openProfiles(copy.id); }
      catch(error){showMessage(this, errorMessage(error));}
    });
    this.dialog.querySelector("#set-default")?.addEventListener("click", async (event) => {
      const controller = this.controller;
      if (!controller) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await this._hass.callWS({type:"climate_sleep_curve/controller/save",controller:{...controller,profile_id:selected.id},expected_revision:controller.revision});
        await this.refresh();
        this.openProfiles(selected.id);
        showMessage(this, t("默认曲线已更新", "Default profile updated"), "success");
      } catch(error) {
        button.disabled = false;
        showMessage(this, errorMessage(error));
      }
    });
    this.dialog.querySelector("#new-profile").onclick = () => this.createProfile();
  }

  async createProfile() {
    const name = await askText(this,{title:t("新建曲线","New profile"),label:t("曲线名称","Profile name"),value:t("新睡眠曲线", "New sleep curve"),confirmLabel:t("创建","Create")});
    if (!name) return;
    try {
      const profile = await this._hass.callWS({
        type:"climate_sleep_curve/profile/save",
        profile:{name,duration_minutes:480,interpolation:"step",fan_mode_control:"none",points:[26.5,26.5,27,27.5,28,28,27.5,27].map((temperature,index)=>({offset_minutes:index*60,temperature}))},
        expected_revision:null,
      });
      await this.refresh();
      this.openProfile(profile, true);
    } catch(error) { showMessage(this, errorMessage(error)); }
  }

  openProfile(profile, returnToProfiles = false) {
    if (!profile) return showMessage(this, t("曲线不存在。", "The profile does not exist."));
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
    const fanCurve = fanControl === "curve" ? `<div class="fan-curve">${draft.points.map((point,index)=>`<div class="fan-point"><label>${index}h</label><select data-fan-index="${index}">${this.fanModeChoices(point.fan_mode, commonFanModes).map(({mode,unsupported})=>`<option value="${esc(mode)}" ${mode===point.fan_mode?"selected":""} ${unsupported?"disabled":""}>${esc(this.fanModeLabel(mode))}${unsupported?` · ${t("当前控制器不支持", "unsupported here")}`:""}</option>`).join("")}</select></div>`).join("")}</div>` : "";
    const incompatibleFanMode = fanControl === "auto"
      ? !commonFanModes.includes("auto")
      : fanControl === "curve" && draft.points.some((point) => !commonFanModes.includes(point.fan_mode));
    const fanHint = incompatibleFanMode
      ? t("这条共享曲线包含当前控制器并非全部空调都支持的风速；运行时会安全跳过不支持的设备。请选择共同模式即可替换旧值。", "This shared profile contains fan modes not supported by every climate entity in this controller. Unsupported devices are safely skipped at runtime; choose a shared mode to replace an old value.")
      : commonFanModes.length
      ? t("风速名称来自当前控制器所选空调共同支持的模式。", "Fan modes are shared by every climate entity in the current controller.")
      : t("当前所选空调没有共同的风速模式，只能选择不控制风速。", "The selected climate entities have no common fan mode, so fan control is unavailable.");
    this.dialog.innerHTML = `<div class="editor"><div class="row between"><div class="title">${t("编辑睡眠曲线", "Edit sleep curve")}</div><button class="secondary" id="close">${t("返回", "Back")}</button></div><label>${t("名称", "Name")}</label><input class="field" id="name" maxlength="64" value="${esc(draft.name)}"><label>${t("时长", "Duration")}: <b>${hours}h</b></label><input id="duration" type="range" min="4" max="12" step="1" value="${hours}" style="width:100%"><div class="row between"><label>${t("温度曲线", "Temperature curve")}</label><button class="secondary" id="recommend">${t("推荐曲线", "Recommend")}</button></div>${this.chart(draft.points)}<p class="muted">${t("拖动节点或使用方向键调整。后台只在离散节点执行。", "Drag a point or use arrow keys. The backend acts only at discrete points.")}</p><label>${t("风速控制", "Fan control")}</label><select id="fan-control"><option value="none" ${fanControl==="none"?"selected":""}>${t("不控制风速", "Do not control fan")}</option><option value="auto" ${fanControl==="auto"?"selected":""} ${!commonFanModes.includes("auto")&&fanControl!=="auto"?"disabled":""}>${t("全程自动风", "Automatic fan throughout")}</option><option value="curve" ${fanControl==="curve"?"selected":""} ${!commonFanModes.length&&fanControl!=="curve"?"disabled":""}>${t("风量曲线", "Fan curve")}</option></select><p class="muted">${fanHint}</p>${fanCurve}<div class="actions"><button id="save">${t("保存", "Save")}</button><button class="secondary" id="duplicate">${t("复制", "Duplicate")}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button><button class="danger" id="delete">${t("删除", "Delete")}</button></div></div>`;
    this.bindChart();
    const closeEditor = async () => {
      if (this.dirty) {
        const confirmed = await askConfirmation(this, {
          title: t("放弃修改", "Discard changes"),
          message: t("尚未保存的曲线修改将会丢失。", "Unsaved profile changes will be lost."),
          confirmLabel: t("放弃修改", "Discard"),
          danger: true,
        });
        if (!confirmed) return;
      }
      if(this.returnToProfiles)this.openProfiles(this.draft.id);else this.dialog.close();
    };
    this.dialog.querySelector("#close").onclick = this.dialog.querySelector("#cancel").onclick = closeEditor;
    this.dialog.querySelector("#name").oninput = (event) => { this.draft.name=event.target.value;this.dirty=true; };
    this.dialog.querySelector("#fan-control").onchange = (event) => {
      this.draft.fan_mode_control = event.target.value;
      if (event.target.value === "curve") {
        this.draft.points.forEach((point) => { point.fan_mode ||= defaultFanMode; });
      } else {
        this.draft.points.forEach((point) => { delete point.fan_mode; });
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
          title: t("缩短曲线", "Shorten profile"),
          message: t("缩短时长会删除末尾节点。", "Shortening the duration removes trailing points."),
          confirmLabel: t("继续缩短", "Shorten"),
          danger: true,
        });
        if (!confirmed) { event.target.value=previous;return; }
      }
      this.draft.points=this.resize(this.draft.points,next);this.draft.duration_minutes=next*60;this.dirty=true;this.renderProfileDialog();
    };
    this.dialog.querySelector("#recommend").onclick = async () => {
      try {
        const previousPoints = this.draft.points;
        const recommended=await this._hass.callWS({type:"climate_sleep_curve/profile/recommend",duration_minutes:this.draft.duration_minutes,starting_temperature:this.draft.points[0].temperature,preference:"comfort"});
        this.draft.points=recommended.points.map((point,index)=>({
          ...point,
          ...(this.draft.fan_mode_control === "curve"
            ? {fan_mode: previousPoints[index]?.fan_mode || defaultFanMode}
            : {}),
        }));
        this.dirty=true;this.renderProfileDialog();
      } catch(error){showMessage(this, errorMessage(error));}
    };
    this.dialog.querySelector("#save").onclick = async () => {
      const button=this.dialog.querySelector("#save");button.disabled=true;
      try { this.draft.name=this.dialog.querySelector("#name").value;const saved=await this._hass.callWS({type:"climate_sleep_curve/profile/save",profile:this.draft,expected_revision:this.draft.revision});this.dirty=false;await this.refresh();if(this.returnToProfiles)this.openProfiles(saved.id);else this.dialog.close(); }
      catch(error){button.disabled=false;showMessage(this, error.code==="revision_conflict"?t("配置已在其他页面修改。", "Configuration was modified elsewhere."):errorMessage(error));}
    };
    this.dialog.querySelector("#duplicate").onclick = async () => {
      const name=await askText(this,{title:t("复制曲线","Duplicate profile"),label:t("副本名称","Copy name"),value:`${this.draft.name} ${t("副本", "copy")}`,confirmLabel:t("复制","Duplicate")});if(!name)return;
      try{const copy=await this._hass.callWS({type:"climate_sleep_curve/profile/duplicate",profile_id:this.draft.id,name});await this.refresh();if(this.returnToProfiles)this.openProfiles(copy.id);else this.dialog.close();}catch(error){showMessage(this, errorMessage(error));}
    };
    this.dialog.querySelector("#delete").onclick = async () => {
      const confirmed=await askConfirmation(this,{title:t("删除曲线","Delete profile"),message:t("仍被控制器使用的曲线无法删除。", "A profile still used by a controller cannot be deleted."),confirmLabel:t("删除","Delete"),danger:true});
      if(!confirmed)return;
      try{await this._hass.callWS({type:"climate_sleep_curve/profile/delete",profile_id:this.draft.id,expected_revision:this.draft.revision});await this.refresh();if(this.returnToProfiles)this.openProfiles();else this.dialog.close();}catch(error){showMessage(this, errorMessage(error));}
    };
  }

  resize(points, hours) {
    return resizePoints(points, hours);
  }

  chart(points) {
    const settings=this.chartSettings(points),{min,max,step}=settings;
    const width=640,height=290,left=38,right=16,top=22,bottom=35,innerW=width-left-right,innerH=height-top-bottom;
    const x=(index)=>left+(points.length===1?0:index/(points.length-1))*innerW,y=(temp)=>top+(max-temp)/(max-min)*innerH;
    const coords=points.map((point,index)=>`${x(index)},${y(point.temperature)}`).join(" ");
    const area=`${left},${height-bottom} ${coords} ${left+innerW},${height-bottom}`;
    const grid=Array.from({length:5},(_,index)=>Math.round((min+(max-min)*index/4)*10)/10).map((temp)=>`<line class="grid" x1="${left}" y1="${y(temp)}" x2="${left+innerW}" y2="${y(temp)}"/><text class="axis" x="2" y="${y(temp)+4}">${temp}°</text>`).join("");
    const labels=points.map((point,index)=>`<text class="axis" text-anchor="middle" x="${x(index)}" y="${height-10}">${index}h</text>`).join("");
    const dots=points.map((point,index)=>`<circle class="hit" data-index="${index}" tabindex="0" role="slider" aria-label="${index} hours, ${point.temperature} degrees Celsius" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${point.temperature}" cx="${x(index)}" cy="${y(point.temperature)}" r="22"/><circle class="dot" cx="${x(index)}" cy="${y(point.temperature)}" r="7" pointer-events="none"/>`).join("");
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" data-top="${top}" data-height="${innerH}" data-min="${min}" data-max="${max}" data-step="${step}">${grid}<polygon class="area" points="${area}"/><polyline class="curve" points="${coords}"/>${labels}${dots}</svg>`;
  }

  chartSettings(points) {
    const values=points.map((point)=>point.temperature);
    const ranges=this.entityIds(this.controller).map((entityId)=>this._hass.states[entityId]?.attributes||{}).map((attrs)=>{
      const fahrenheit=attrs.temperature_unit==="°F",toC=(value)=>fahrenheit?(Number(value)-32)*5/9:Number(value);
      const min=toC(attrs.min_temp),max=toC(attrs.max_temp),rawStep=Number(attrs.target_temp_step);
      return {min,max,step:!fahrenheit&&[0.5,1].includes(rawStep)?rawStep:0.5};
    });
    const validMins=ranges.map((item)=>item.min).filter(Number.isFinite),validMaxes=ranges.map((item)=>item.max).filter(Number.isFinite);
    let min=validMins.length?Math.max(...validMins):Math.min(16,...values);
    let max=validMaxes.length?Math.min(...validMaxes):Math.max(30,...values);
    if(max<=min){min=Math.min(16,...values);max=Math.max(30,...values);}
    min=Math.floor(Math.min(min,...values));max=Math.ceil(Math.max(max,...values));
    if(max<=min)max=min+1;
    const step=ranges.some((item)=>item.step===1)?1:0.5;
    return {min,max,step};
  }

  bindChart() {
    const svg=this.dialog.querySelector("svg");let active=null;
    const update=(index,clientY,node)=>{const box=svg.getBoundingClientRect(),top=Number(svg.dataset.top),height=Number(svg.dataset.height),min=Number(svg.dataset.min),max=Number(svg.dataset.max),step=Number(svg.dataset.step),viewY=(clientY-box.top)*290/box.height;this.draft.points[index].temperature=Math.round(snap(clamp(max-(viewY-top)/height*(max-min),min,max),step,min)*10)/10;this.dirty=true;const cy=top+(max-this.draft.points[index].temperature)/(max-min)*height;node.setAttribute("cy",cy);node.nextElementSibling?.setAttribute("cy",cy);node.setAttribute("aria-valuenow",this.draft.points[index].temperature);};
    svg.querySelectorAll(".hit").forEach((node)=>{
      node.onpointerdown=(event)=>{active=Number(node.dataset.index);node.setPointerCapture(event.pointerId);event.preventDefault();};
      node.onpointermove=(event)=>{if(active===Number(node.dataset.index))update(active,event.clientY,node);};node.onpointerup=()=>{active=null;this.renderProfileDialog();};
      node.onkeydown=(event)=>{if(["ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();const index=Number(node.dataset.index),min=Number(svg.dataset.min),max=Number(svg.dataset.max),step=Number(svg.dataset.step);this.draft.points[index].temperature=Math.round(clamp(this.draft.points[index].temperature+(event.key==="ArrowUp"?step:-step),min,max)*10)/10;this.dirty=true;this.renderProfileDialog();}};
    });
  }

  getCardSize() { return this.config?.compact ? 2 : 3; }
}

class ClimateSleepCurveCardEditor extends HTMLElement {
  setConfig(config) { this.config=config;this.render(); }
  set hass(value) { this._hass=value;this.load(); }
  async load(){if(!this._hass)return;try{this.state=await this._hass.callWS({type:"climate_sleep_curve/get_state"});}catch{}this.render();}
  render(){if(!this.shadowRoot)this.attachShadow({mode:"open"});const controllers=this.state?.controllers||[];this.shadowRoot.innerHTML=`<style>:host{display:block;padding:8px}label{display:block;margin:12px 0 4px}select,input{width:100%;box-sizing:border-box;padding:8px}</style><label>${t("控制器","Controller")}</label><select id="controller"><option value="">—</option>${controllers.map((item)=>`<option value="${item.id}" ${item.id===this.config?.controller_id?"selected":""}>${esc(item.name)}</option>`).join("")}</select><label>${t("显示名称","Display name")}</label><input id="name" value="${esc(this.config?.name||"")}">`;
    const changed=()=>this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:{...this.config,controller_id:this.shadowRoot.querySelector("#controller").value||undefined,name:this.shadowRoot.querySelector("#name").value||undefined}},bubbles:true,composed:true}));this.shadowRoot.querySelector("#controller").onchange=changed;this.shadowRoot.querySelector("#name").onchange=changed;
  }
}

customElements.define("climate-sleep-curve-card", ClimateSleepCurveCard);
customElements.define("climate-sleep-curve-card-editor", ClimateSleepCurveCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({type:"climate-sleep-curve-card",name:"Climate Sleep Curve",description:t("可视化空调睡眠温度与风量曲线","Visual sleep temperature and fan curves for climate entities"),preview:true});
