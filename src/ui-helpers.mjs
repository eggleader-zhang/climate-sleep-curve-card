export const t = (zh, en) => (navigator.language || "").toLowerCase().startsWith("zh") ? zh : en;

export const esc = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char],
);

export const errorMessage = (error) => error?.message || String(error);

export function resultMeta(result) {
  const values = {
    applied: [t("已应用", "Applied"), "success", "mdi:check-circle"],
    no_change: [t("无需调整", "No change"), "neutral", "mdi:check"],
    skipped_off: [t("设备已关闭", "Device off"), "warning", "mdi:power"],
    skipped_unavailable: [t("设备不可用", "Unavailable"), "warning", "mdi:cloud-off-outline"],
    skipped_unknown: [t("状态未知", "Unknown"), "warning", "mdi:help-circle-outline"],
    skipped_unsupported: [t("风速不支持", "Fan unsupported"), "warning", "mdi:fan-off"],
    skipped_state_changed: [t("设备状态已改变", "State changed"), "warning", "mdi:swap-horizontal"],
    skipped_no_snapshot: [t("缺少启动快照", "No starting snapshot"), "warning", "mdi:camera-off-outline"],
    skipped_cancelled: [t("操作已取消", "Cancelled"), "warning", "mdi:cancel"],
    skipped_mixed: [t("部分已跳过", "Skipped"), "warning", "mdi:skip-next-circle-outline"],
    skipped_off_after_failure: [t("失败后关闭", "Off after failure"), "warning", "mdi:power"],
    failed: [t("执行失败", "Failed"), "error", "mdi:alert-circle"],
    partial_failure: [t("部分失败", "Partial failure"), "error", "mdi:alert-circle-outline"],
  };
  const [label, tone, icon] = values[result] || [result || t("等待执行", "Pending"), "neutral", "mdi:clock-outline"];
  return {label, tone, icon};
}

export function entityResultSummary(result) {
  if (!result) return "";
  const parts = [];
  if (result.temperature_result) {
    parts.push(`${t("温度", "Temp")}: ${resultMeta(result.temperature_result).label}`);
  }
  if (result.fan_result && result.fan_result !== "not_requested") {
    parts.push(`${t("风速", "Fan")}: ${resultMeta(result.fan_result).label}`);
  }
  return parts.join(" · ");
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

export function showMessage(host, message, type = "error") {
  const container = host.dialog?.open
    ? host.dialog.querySelector(".editor")
    : host.shadowRoot.querySelector("ha-card");
  if (!container) return;
  container.querySelector("ha-alert[data-card-message]")?.remove();
  const alert = document.createElement("ha-alert");
  alert.dataset.cardMessage = "true";
  alert.setAttribute("alert-type", type);
  alert.textContent = message;
  container.prepend(alert);
  setTimeout(() => alert.remove(), type === "success" ? 3500 : 7000);
}

export function askConfirmation(host, {title, message, confirmLabel, danger = false}) {
  const dialog = ensureAuxDialog(host);
  dialog.innerHTML = `<div class="editor"><div class="title">${esc(title)}</div><p>${esc(message)}</p><div class="actions"><button class="${danger ? "danger" : ""}" id="confirm">${esc(confirmLabel)}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button></div></div>`;
  return new Promise((resolve) => {
    let settled = false;
    const onCancel = (event) => { event.preventDefault(); finish(false); };
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

export function askText(host, {title, label, value = "", confirmLabel}) {
  const dialog = ensureAuxDialog(host);
  dialog.innerHTML = `<div class="editor"><div class="title">${esc(title)}</div><ha-textfield id="value" label="${esc(label)}" maxlength="64"></ha-textfield><div class="actions"><button id="confirm">${esc(confirmLabel)}</button><button class="secondary" id="cancel">${t("取消", "Cancel")}</button></div></div>`;
  const field = dialog.querySelector("#value");
  field.value = value;
  return new Promise((resolve) => {
    let settled = false;
    const onCancel = (event) => { event.preventDefault(); finish(null); };
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
        field.validationMessage = t("名称不能为空", "Name is required");
        return;
      }
      finish(result);
    };
    dialog.querySelector("#confirm").onclick = submit;
    dialog.querySelector("#cancel").onclick = () => finish(null);
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
    dialog.addEventListener("cancel", onCancel);
    dialog.showModal();
    field.focus();
  });
}
