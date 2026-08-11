const t = (zh, en) => (navigator.language || "").toLowerCase().startsWith("zh") ? zh : en;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const snap = (value, step, min = 0) => Math.round((value - min) / step) * step + min;

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

  disconnectedCallback() { if (this._unsubscribe) this._unsubscribe(); }

  async load() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    try {
      this.state = await this._hass.callWS({type: "climate_sleep_curve/get_state"});
      this.error = null;
      if (!this._unsubscribe) {
        this._unsubscribe = await this._hass.connection.subscribeMessage(() => this.refresh(), {type: "climate_sleep_curve/subscribe"});
      }
    } catch (error) {
      this.error = t("尚未安装或加载 Climate Sleep Curve 后端集成。", "Climate Sleep Curve backend is not installed or loaded.");
    } finally {
      this._loading = false;
      this._loaded = true;
      this.render();
    }
  }

  async refresh() {
    this.state = await this._hass.callWS({type: "climate_sleep_curve/get_state"});
    if (!this.dialog?.open) this.render();
  }

  get controller() {
    const configured = this.config?.controller_id;
    return this.state?.controllers.find((item) => item.id === configured) || (!configured && this.state?.controllers.length === 1 ? this.state.controllers[0] : null);
  }

  get profile() { return this.state?.profiles.find((item) => item.id === this.controller?.profile_id); }
  get session() { return this.state?.active_sessions.find((item) => item.controller_id === this.controller?.id); }

  render() {
    if (!this.shadowRoot) return;
    const style = `<style>
      :host{display:block;font-family:var(--paper-font-body1_-_font-family,Roboto,sans-serif)}ha-card{padding:20px;color:var(--primary-text-color);overflow:hidden}
      .row{display:flex;align-items:center;gap:12px}.between{justify-content:space-between}.muted{color:var(--secondary-text-color);font-size:13px}.title{font-size:20px;font-weight:600}
      button{border:0;border-radius:18px;padding:9px 16px;background:var(--primary-color);color:var(--text-primary-color,#fff);cursor:pointer;font:inherit}button.secondary{background:transparent;color:var(--primary-color);border:1px solid var(--divider-color)}button.danger{background:var(--error-color)}button:disabled{opacity:.5}.actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
      .progress{height:7px;background:var(--divider-color);border-radius:5px;margin:15px 0;overflow:hidden}.progress i{display:block;height:100%;background:var(--primary-color)}
      dialog{border:0;border-radius:18px;padding:0;background:var(--card-background-color);color:var(--primary-text-color);width:min(720px,calc(100vw - 24px));max-height:calc(100vh - 24px)}dialog::backdrop{background:#0008}.editor{padding:20px;overflow:auto;max-height:calc(100vh - 64px)}
      label{display:block;margin:14px 0 5px}.field,select{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--divider-color);border-radius:8px;background:var(--card-background-color);color:var(--primary-text-color)}
      .chart{touch-action:none;width:100%;height:auto;background:color-mix(in srgb,var(--primary-color) 5%,transparent);border-radius:12px}.grid{stroke:var(--divider-color);stroke-width:1}.curve{fill:none;stroke:var(--primary-color);stroke-width:3}.area{fill:color-mix(in srgb,var(--primary-color) 18%,transparent)}.dot{fill:var(--primary-color);stroke:var(--card-background-color);stroke-width:3;cursor:ns-resize}.hit{fill:transparent;cursor:ns-resize}.axis{fill:var(--secondary-text-color);font-size:11px}.bubble{fill:var(--card-background-color);stroke:var(--primary-color)}
      .notice{padding:12px;border-radius:8px;background:color-mix(in srgb,var(--error-color) 12%,transparent);color:var(--error-color)}@media(max-width:420px){ha-card{padding:16px}.editor{padding:14px}.title{font-size:18px}}
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
    const climate = this._hass.states[this.controller.climate_entity_id];
    const profile = this.profile;
    const session = this.session;
    let progress = 0;
    let next = null;
    let nextTime = null;
    if (session) {
      progress = clamp((Date.now() - Date.parse(session.started_at)) / (Date.parse(session.ends_at) - Date.parse(session.started_at)) * 100, 0, 100);
      next = session.profile_snapshot?.points.find((point) => point.offset_minutes === session.next_offset_minutes);
      if (next) nextTime = new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"}).format(new Date(Date.parse(session.started_at)+next.offset_minutes*60000));
    }
    this.shadowRoot.innerHTML = `${style}<ha-card>
      <div class="row between"><div><div class="title">${esc(this.config.name || this.controller.name)}</div><div class="muted">${esc(session?.profile_snapshot?.name || profile?.name || t("曲线不存在", "Missing profile"))}</div></div><ha-icon icon="mdi:sleep"></ha-icon></div>
      ${this.config.show_climate_state ? `<p>${esc(this.controller.climate_entity_id)} · ${esc(climate?.state || "unknown")}${climate?.attributes?.temperature != null ? ` · ${climate.attributes.temperature}°` : ""}</p>` : ""}
      <div class="progress"><i style="width:${progress}%"></i></div>
      <div class="row between"><span>${session ? t("运行中", "Running") : t("未运行", "Idle")}</span>${this.config.show_next_point && session ? `<span class="muted">${t("下一节点", "Next")}: ${next ? `${nextTime} · ${next.temperature}°C` : t("等待结束", "finishing")}</span>` : ""}</div>
      <div class="actions">${session ? `<button class="danger" id="stop">${t("停止", "Stop")}</button><button class="secondary" id="restart">${t("重新开始", "Restart")}</button>` : `<button id="start">${t("启动曲线", "Start curve")}</button>`}<button class="secondary" id="edit">${t("编辑曲线", "Edit curve")}</button><button class="secondary" id="settings">${t("控制器", "Controller")}</button></div>
      <dialog id="dialog"></dialog>
    </ha-card>`;
    this.bindCommon();
    this.shadowRoot.querySelector("#start")?.addEventListener("click", () => this.action("start"));
    this.shadowRoot.querySelector("#stop")?.addEventListener("click", () => this.action("stop"));
    this.shadowRoot.querySelector("#restart")?.addEventListener("click", () => this.action("restart"));
    this.shadowRoot.querySelector("#edit").onclick = () => this.openProfile(profile);
    this.shadowRoot.querySelector("#settings").onclick = () => this.openController(this.controller);
  }

  bindCommon() { this.dialog = this.shadowRoot.querySelector("#dialog"); }

  async action(action) {
    try { await this._hass.callWS({type: `climate_sleep_curve/session/${action}`, controller_id: this.controller.id}); await this.refresh(); }
    catch (error) { alert(error.message || String(error)); }
  }

  openSetup() {
    const climates = Object.values(this._hass.states).filter((state) => state.entity_id.startsWith("climate."));
    this.dialog.innerHTML = `<div class="editor"><div class="title">${t("创建睡眠曲线", "Create sleep curve")}</div><label>${t("曲线名称", "Profile name")}</label><input class="field" id="pname" value="${t("默认睡眠曲线", "Default sleep curve")}"><label>${t("控制器名称", "Controller name")}</label><input class="field" id="cname" value="${t("卧室睡眠曲线", "Bedroom sleep curve")}"><label>${t("空调实体", "Climate entity")}</label><select id="entity">${climates.map((state) => `<option value="${state.entity_id}">${esc(state.attributes.friendly_name || state.entity_id)}</option>`).join("")}</select><div class="actions"><button id="save">${t("创建", "Create")}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button></div></div>`;
    this.dialog.showModal();
    this.dialog.querySelector("#cancel").onclick = () => this.dialog.close();
    this.dialog.querySelector("#save").onclick = async () => {
      if (!this.dialog.querySelector("#entity").value) return alert(t("没有可用的 climate 实体", "No climate entity is available"));
      let profile = null;
      try {
        profile = await this._hass.callWS({type:"climate_sleep_curve/profile/save", profile:{name:this.dialog.querySelector("#pname").value,duration_minutes:480,interpolation:"step",points:[26.5,26.5,27,27.5,28,28,27.5,27].map((temperature,index)=>({offset_minutes:index*60,temperature}))}, expected_revision:null});
        const controller = await this._hass.callWS({type:"climate_sleep_curve/controller/save",controller:{name:this.dialog.querySelector("#cname").value,climate_entity_id:this.dialog.querySelector("#entity").value,profile_id:profile.id,enabled:true,automatic_start:{enabled:false,time:"23:00:00",weekdays:[0,1,2,3,4,5,6]}},expected_revision:null});
        this.config.controller_id = controller.id; this.dialog.close(); await this.refresh();
      } catch (error) {
        if (profile) {
          try { await this._hass.callWS({type:"climate_sleep_curve/profile/delete",profile_id:profile.id,expected_revision:profile.revision}); } catch {}
        }
        alert(error.message || String(error));
      }
    };
  }

  openController(controller) {
    const climates = Object.values(this._hass.states).filter((state) => state.entity_id.startsWith("climate."));
    const profiles = this.state.profiles;
    const auto = controller.automatic_start;
    this.dialog.innerHTML = `<div class="editor"><div class="title">${t("控制器设置", "Controller settings")}</div><label>${t("名称", "Name")}</label><input class="field" id="name" value="${esc(controller.name)}"><label>${t("空调实体", "Climate entity")}</label><select id="entity">${climates.map((state) => `<option ${state.entity_id===controller.climate_entity_id?"selected":""} value="${state.entity_id}">${esc(state.attributes.friendly_name||state.entity_id)}</option>`).join("")}</select><label>${t("下次会话使用的曲线", "Profile for the next session")}</label><select id="profile">${profiles.map((profile)=>`<option ${profile.id===controller.profile_id?"selected":""} value="${profile.id}">${esc(profile.name)}</option>`).join("")}</select><label><input type="checkbox" id="automatic" ${auto.enabled?"checked":""}> ${t("每天自动启动", "Start automatically")}</label><input class="field" id="time" type="time" step="1" value="${auto.time}"><label>${t("星期（0=周一…6=周日）", "Weekdays (0=Monday…6=Sunday)")}</label><input class="field" id="weekdays" value="${auto.weekdays.join(",")}"><div class="actions"><button id="save">${t("保存", "Save")}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button><button class="danger" id="delete">${t("删除控制器", "Delete controller")}</button></div></div>`;
    this.dialog.showModal();
    this.dialog.querySelector("#cancel").onclick = () => this.dialog.close();
    this.dialog.querySelector("#save").onclick = async () => {
      try {
        const time = this.dialog.querySelector("#time").value;
        const weekdayText = this.dialog.querySelector("#weekdays").value.trim();
        const weekdays = weekdayText ? weekdayText.split(",").map((value) => Number(value.trim())) : [];
        await this._hass.callWS({type:"climate_sleep_curve/controller/save",controller:{...controller,name:this.dialog.querySelector("#name").value,climate_entity_id:this.dialog.querySelector("#entity").value,profile_id:this.dialog.querySelector("#profile").value,automatic_start:{enabled:this.dialog.querySelector("#automatic").checked,time:time.length===5?`${time}:00`:time,weekdays}},expected_revision:controller.revision});
        this.dialog.close(); await this.refresh();
      } catch(error) { alert(error.message || String(error)); }
    };
    this.dialog.querySelector("#delete").onclick = async () => {
      if (!confirm(t("删除此控制器？运行中的会话会停止，但不会关闭空调。", "Delete this controller? Its session will stop without turning off the climate device."))) return;
      try { await this._hass.callWS({type:"climate_sleep_curve/controller/delete",controller_id:controller.id,expected_revision:controller.revision});this.config.controller_id=undefined;this.dialog.close();await this.refresh(); }
      catch(error){alert(error.message||String(error));}
    };
  }

  openProfile(profile) {
    if (!profile) return alert(t("曲线不存在。", "The profile does not exist."));
    this.draft = structuredClone(profile);
    this.dirty = false;
    this.selected = 0;
    this.renderProfileDialog();
    this.dialog.showModal();
  }

  renderProfileDialog() {
    const draft = this.draft, hours = draft.duration_minutes / 60;
    this.dialog.innerHTML = `<div class="editor"><div class="row between"><div class="title">${t("编辑温度曲线", "Edit temperature curve")}</div><button class="secondary" id="close">${t("返回", "Back")}</button></div><label>${t("名称", "Name")}</label><input class="field" id="name" maxlength="64" value="${esc(draft.name)}"><label>${t("时长", "Duration")}: <b>${hours}h</b></label><input id="duration" type="range" min="4" max="12" step="1" value="${hours}" style="width:100%"><div class="row between"><label>${t("温度曲线", "Temperature curve")}</label><button class="secondary" id="recommend">${t("推荐曲线", "Recommend")}</button></div>${this.chart(draft.points)}<p class="muted">${t("拖动节点或使用方向键调整。后台只在离散节点调温。", "Drag a point or use arrow keys. The backend adjusts only at discrete points.")}</p><div class="actions"><button id="save">${t("保存", "Save")}</button><button class="secondary" id="duplicate">${t("复制", "Duplicate")}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button><button class="danger" id="delete">${t("删除", "Delete")}</button></div></div>`;
    this.bindChart();
    this.dialog.querySelector("#close").onclick = this.dialog.querySelector("#cancel").onclick = () => { if (!this.dirty || confirm(t("放弃未保存的修改？", "Discard unsaved changes?"))) this.dialog.close(); };
    this.dialog.querySelector("#name").oninput = (event) => { this.draft.name=event.target.value;this.dirty=true; };
    this.dialog.querySelector("#duration").onchange = (event) => {
      const next = Number(event.target.value), previous = this.draft.duration_minutes / 60;
      if (next < previous && !confirm(t("缩短时长会删除末尾节点，继续？", "Shortening removes trailing points. Continue?"))) { event.target.value=previous;return; }
      this.draft.points=this.resize(this.draft.points,next);this.draft.duration_minutes=next*60;this.dirty=true;this.renderProfileDialog();
    };
    this.dialog.querySelector("#recommend").onclick = async () => {
      try { const recommended=await this._hass.callWS({type:"climate_sleep_curve/profile/recommend",duration_minutes:this.draft.duration_minutes,starting_temperature:this.draft.points[0].temperature,preference:"comfort"});this.draft.points=recommended.points;this.dirty=true;this.renderProfileDialog(); } catch(error){alert(error.message||String(error));}
    };
    this.dialog.querySelector("#save").onclick = async () => {
      const button=this.dialog.querySelector("#save");button.disabled=true;
      try { this.draft.name=this.dialog.querySelector("#name").value;await this._hass.callWS({type:"climate_sleep_curve/profile/save",profile:this.draft,expected_revision:this.draft.revision});this.dirty=false;this.dialog.close();await this.refresh(); }
      catch(error){button.disabled=false;alert(error.code==="revision_conflict"?t("配置已在其他页面修改。", "Configuration was modified elsewhere."):error.message||String(error));}
    };
    this.dialog.querySelector("#duplicate").onclick = async () => {
      const name=prompt(t("副本名称", "Copy name"),`${this.draft.name} ${t("副本", "copy")}`);if(!name)return;
      try{await this._hass.callWS({type:"climate_sleep_curve/profile/duplicate",profile_id:this.draft.id,name});this.dialog.close();await this.refresh();}catch(error){alert(error.message||String(error));}
    };
    this.dialog.querySelector("#delete").onclick = async () => {
      if(!confirm(t("删除此曲线？仍被控制器使用时将拒绝删除。", "Delete this profile? Deletion is rejected while a controller uses it.")))return;
      try{await this._hass.callWS({type:"climate_sleep_curve/profile/delete",profile_id:this.draft.id,expected_revision:this.draft.revision});this.dialog.close();await this.refresh();}catch(error){alert(error.message||String(error));}
    };
  }

  resize(points, hours) {
    const result=points.filter((point)=>point.offset_minutes<hours*60).map((point)=>({...point}));const temperature=result.at(-1)?.temperature??26;
    for(let hour=0;hour<hours;hour++)if(!result.some((point)=>point.offset_minutes===hour*60))result.push({offset_minutes:hour*60,temperature});
    return result.sort((a,b)=>a.offset_minutes-b.offset_minutes);
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
    const climate=this._hass.states[this.controller?.climate_entity_id],attrs=climate?.attributes||{},fahrenheit=attrs.temperature_unit==="°F";
    const toC=(value)=>fahrenheit?(Number(value)-32)*5/9:Number(value);
    const values=points.map((point)=>point.temperature);
    let min=Number.isFinite(toC(attrs.min_temp))?toC(attrs.min_temp):Math.min(16,...values);
    let max=Number.isFinite(toC(attrs.max_temp))?toC(attrs.max_temp):Math.max(30,...values);
    min=Math.floor(Math.min(min,...values));max=Math.ceil(Math.max(max,...values));
    if(max<=min)max=min+1;
    const rawStep=Number(attrs.target_temp_step),step=!fahrenheit&&[0.5,1].includes(rawStep)?rawStep:0.5;
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
window.customCards.push({type:"climate-sleep-curve-card",name:"Climate Sleep Curve",description:t("可视化空调睡眠温度曲线","Visual sleep temperature curves for climate entities"),preview:true});
