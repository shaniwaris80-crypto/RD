import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  ensureBootstrap,
  subscribeSettings,
  subscribeActiveWeek,
  subscribeWeeks,
  subscribeShipments,
  subscribeSenders,
  subscribeReceivers,
  getSenderByPhone,
  getReceiverByPhone,
  getBeneficiariesForSender,
  createShipment,
  updateShipment,
  updateShipmentStatus,
  markAllLoaded,
  closeWeek,
  getShipmentsForWeek,
  saveSettings,
  saveUserRole,
  finalizePendingShipments,
  DEFAULT_SETTINGS
} from "./data.js";
import {
  money,
  todayISO,
  normalizeSpainPhone,
  normalizeDRPhone,
  validSpainPhone,
  validDRPhone,
  escapeHTML,
  aggregateShipments,
  SIZE_KEYS,
  SIZE_LABELS,
  downloadText
} from "./utils.js";
import { printShipment, printWeeklyReport, buildCustomerMessage } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  activeWeek: null,
  weeks: [],
  shipments: [],
  senders: [],
  receivers: [],
  destination: "",
  editingId: null,
  editingShipment: null,
  draftForReview: null,
  pendingShare: null,
  unsubs: []
};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(id) {
  $(id).classList.add("hidden");
}

function goView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setSyncStatus(text, mode = "") {
  const el = $("sync-status");
  el.textContent = text;
  el.className = `sync-badge ${mode}`;
}

function renderBoxEditor() {
  $("box-editor").innerHTML = SIZE_KEYS.map((size) => `
    <div class="box-row">
      <div><strong>${SIZE_LABELS[size]}s</strong><small id="rate-${size}">Selecciona destino</small></div>
      <div><label>Cantidad</label><div class="qty-control"><button type="button" data-size="${size}" data-delta="-1">−</button><input id="qty-${size}" type="number" min="0" value="0"><button type="button" data-size="${size}" data-delta="1">+</button></div></div>
      <div><label>Sin cargo</label><input id="free-${size}" type="number" min="0" value="0"></div>
      <div><label>Precio especial</label><input id="custom-${size}" type="number" min="0" step="0.01" placeholder="Normal"></div>
      <div class="box-subtotal" id="subtotal-${size}">0,00 €</div>
    </div>
  `).join("");

  document.querySelectorAll("[data-size][data-delta]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(`qty-${button.dataset.size}`);
      input.value = Math.max(0, Number(input.value || 0) + Number(button.dataset.delta));
      renderCalculation();
    });
  });

  SIZE_KEYS.forEach((size) => {
    [$(`qty-${size}`), $(`free-${size}`), $(`custom-${size}`)].forEach((input) => input.addEventListener("input", renderCalculation));
  });
}

function getRateSet() {
  if (state.destination === "capital") return state.settings.capitalPrices;
  if (state.destination === "interior") return state.settings.interiorPrices;
  return { small: 0, medium: 0, large: 0 };
}

function calculateDraft() {
  const basePrices = getRateSet();
  const quantities = {};
  const freeQuantities = {};
  const chargedQuantities = {};
  const appliedPrices = {};
  const subtotals = {};
  const costs = {};
  let totalPackages = 0;
  let totalAmount = 0;
  let totalCost = 0;
  let theoretical = 0;

  SIZE_KEYS.forEach((size) => {
    const qty = Math.max(0, Math.floor(Number($(`qty-${size}`)?.value || 0)));
    const free = Math.min(qty, Math.max(0, Math.floor(Number($(`free-${size}`)?.value || 0))));
    if ($(`free-${size}`)) $(`free-${size}`).value = free;
    const custom = Math.max(0, Number($(`custom-${size}`)?.value || 0));
    const price = custom || Number(basePrices[size] || 0);
    const charged = qty - free;
    const subtotal = charged * price;
    const cost = qty * Number(state.settings.madridCosts[size] || 0);

    quantities[size] = qty;
    freeQuantities[size] = free;
    chargedQuantities[size] = charged;
    appliedPrices[size] = price;
    subtotals[size] = subtotal;
    costs[size] = cost;
    totalPackages += qty;
    totalAmount += subtotal;
    totalCost += cost;
    theoretical += qty * Number(basePrices[size] || 0);
  });

  const content = [...document.querySelectorAll(".content-check:checked")].map((x) => x.value);
  const other = $("other-content").value.trim();
  if (other) content.push(other);

  return {
    date: $("shipment-date").value,
    status: $("shipment-status").value,
    destinationType: state.destination,
    destinationLabel: state.destination === "capital" ? "Capital" : state.destination === "interior" ? "Interior" : "",
    sender: {
      name: $("sender-name").value.trim(),
      phone: $("sender-phone").value.trim(),
      address: $("sender-address").value.trim()
    },
    receiver: {
      name: $("receiver-name").value.trim(),
      phone: $("receiver-phone").value.trim(),
      address: $("receiver-address").value.trim(),
      area: $("receiver-area").value.trim(),
      reference: $("receiver-reference").value.trim()
    },
    quantities,
    freeQuantities,
    chargedQuantities,
    basePrices,
    appliedPrices,
    subtotals,
    costs,
    totalPackages,
    totalAmount,
    totalCost,
    profit: totalAmount - totalCost,
    promotionValue: Math.max(0, theoretical - totalAmount),
    promotionReason: $("promotion-reason").value,
    promotionNote: $("promotion-note").value.trim(),
    paymentMethod: $("payment-method").value,
    paymentStatus: $("payment-status").value,
    content,
    notes: $("shipment-notes").value.trim()
  };
}

function renderCalculation() {
  const draft = calculateDraft();
  const rates = getRateSet();
  $("destination-capital").classList.toggle("active", state.destination === "capital");
  $("destination-interior").classList.toggle("active", state.destination === "interior");
  $("summary-destination").textContent = draft.destinationLabel || "Sin seleccionar";
  $("summary-free").textContent = SIZE_KEYS.reduce((sum, s) => sum + draft.freeQuantities[s], 0);
  $("summary-packages").textContent = draft.totalPackages;
  $("summary-total").textContent = money(draft.totalAmount);

  $("summary-size-lines").innerHTML = SIZE_KEYS.filter((s) => draft.quantities[s] > 0).map((s) => `
    <div><span>${SIZE_LABELS[s]}s</span><strong>${draft.quantities[s]}</strong></div>
  `).join("");

  SIZE_KEYS.forEach((size) => {
    $(`rate-${size}`).textContent = state.destination ? `${money(rates[size])} por caja` : "Selecciona destino";
    $(`subtotal-${size}`).textContent = money(draft.subtotals[size]);
  });
}

function validateDraft(draft) {
  const errors = [];
  if (!state.activeWeek) errors.push("No hay una semana activa.");
  if (!draft.destinationType) errors.push("Selecciona Capital o Interior.");
  if (draft.totalPackages < 1) errors.push("Añade al menos una caja.");
  if (!draft.sender.name) errors.push("Falta el nombre del remitente.");
  if (!validSpainPhone(draft.sender.phone)) errors.push("El teléfono del remitente debe tener 9 dígitos.");
  if (!draft.receiver.name) errors.push("Falta el nombre del destinatario.");
  if (!validDRPhone(draft.receiver.phone)) errors.push("El teléfono dominicano debe tener 10 dígitos.");
  if (!draft.receiver.address) errors.push("Falta la dirección del destinatario.");
  return errors;
}

function renderReview(draft) {
  const lines = SIZE_KEYS.filter((s) => draft.quantities[s] > 0).map((s) => `<div><span>${SIZE_LABELS[s]}s</span><strong>${draft.quantities[s]}</strong></div>`).join("");
  $("review-content").innerHTML = `
    <div class="review-confirm">Confirmación: ${draft.quantities.small} pequeñas + ${draft.quantities.medium} medianas + ${draft.quantities.large} grandes = ${draft.totalPackages} bultos.</div>
    <div class="two-col">
      <div class="card"><h3>Remitente</h3><strong>${escapeHTML(draft.sender.name)}</strong><p>${escapeHTML(draft.sender.phone)}<br>${escapeHTML(draft.sender.address)}</p></div>
      <div class="card"><h3>Destinatario</h3><strong>${escapeHTML(draft.receiver.name)}</strong><p>${escapeHTML(draft.receiver.phone)}<br>${escapeHTML(draft.receiver.address)}</p></div>
    </div>
    <div class="customer-summary"><div><span>Destino</span><strong>${escapeHTML(draft.destinationLabel)}</strong></div>${lines}<div><span>Total bultos</span><strong>${draft.totalPackages}</strong></div><div class="summary-total"><span>Total</span><strong>${money(draft.totalAmount)}</strong></div></div>
  `;
}

function resetForm() {
  state.destination = "";
  state.editingId = null;
  state.editingShipment = null;
  state.draftForReview = null;
  $("form-title").textContent = "Nuevo albarán";
  $("shipment-number").value = "Automático";
  $("shipment-date").value = todayISO();
  $("shipment-status").value = "Recogido";
  SIZE_KEYS.forEach((s) => {
    $(`qty-${s}`).value = 0;
    $(`free-${s}`).value = 0;
    $(`custom-${s}`).value = "";
  });
  ["promotion-note", "sender-phone", "sender-name", "sender-address", "receiver-phone", "receiver-name", "receiver-address", "receiver-area", "receiver-reference", "other-content", "shipment-notes"].forEach((id) => $(id).value = "");
  $("promotion-reason").value = "";
  $("payment-method").value = "Efectivo";
  $("payment-status").value = "Pagado";
  document.querySelectorAll(".content-check").forEach((x) => x.checked = false);
  $("beneficiaries-panel").classList.add("hidden");
  $("beneficiaries-list").innerHTML = "";
  $("sender-history-note").textContent = "";
  hideError("form-error");
  renderCalculation();
  validatePhoneInputs();
}

function fillForm(shipment) {
  state.editingId = shipment.id;
  state.editingShipment = shipment;
  state.destination = shipment.destinationType;
  $("form-title").textContent = `Editar ${shipment.visibleNumber}`;
  $("shipment-number").value = shipment.visibleNumber;
  $("shipment-date").value = shipment.date;
  $("shipment-status").value = shipment.status;
  SIZE_KEYS.forEach((s) => {
    $(`qty-${s}`).value = shipment.quantities?.[s] || 0;
    $(`free-${s}`).value = shipment.freeQuantities?.[s] || 0;
    const custom = shipment.appliedPrices?.[s];
    const base = shipment.basePrices?.[s];
    $(`custom-${s}`).value = custom && custom !== base ? custom : "";
  });
  $("promotion-reason").value = shipment.promotionReason || "";
  $("promotion-note").value = shipment.promotionNote || "";
  $("sender-phone").value = shipment.sender?.phone || "";
  $("sender-name").value = shipment.sender?.name || "";
  $("sender-address").value = shipment.sender?.address || "";
  $("receiver-phone").value = shipment.receiver?.phone || "";
  $("receiver-name").value = shipment.receiver?.name || "";
  $("receiver-address").value = shipment.receiver?.address || "";
  $("receiver-area").value = shipment.receiver?.area || "";
  $("receiver-reference").value = shipment.receiver?.reference || "";
  $("shipment-notes").value = shipment.notes || "";
  $("payment-method").value = shipment.paymentMethod || "Efectivo";
  $("payment-status").value = shipment.paymentStatus || "Pagado";
  document.querySelectorAll(".content-check").forEach((x) => x.checked = (shipment.content || []).includes(x.value));
  renderCalculation();
  validatePhoneInputs();
  goView("new");
}

function validatePhoneInputs() {
  const sender = $("sender-phone");
  const receiver = $("receiver-phone");
  const esLen = normalizeSpainPhone(sender.value).length;
  const drLen = normalizeDRPhone(receiver.value).length;
  sender.classList.toggle("valid", esLen === 9);
  sender.classList.toggle("invalid", sender.value && esLen !== 9);
  receiver.classList.toggle("valid", drLen === 10);
  receiver.classList.toggle("invalid", receiver.value && drLen !== 10);
  $("sender-phone-help").textContent = esLen === 9 ? "Número correcto" : esLen < 9 ? `Faltan ${9 - esLen} dígitos` : "Sobran dígitos";
  $("receiver-phone-help").textContent = drLen === 10 ? "Número correcto" : drLen < 10 ? `Faltan ${10 - drLen} dígitos` : "Sobran dígitos";
}

async function findSender(showMessage = true) {
  if (!validSpainPhone($("sender-phone").value)) return;
  const sender = await getSenderByPhone($("sender-phone").value);
  if (sender) {
    $("sender-name").value = sender.name || "";
    $("sender-address").value = sender.address || "";
    $("sender-history-note").textContent = `Cliente con ${sender.totalShipments || 0} envíos registrados.`;
    if (showMessage) toast("Ficha del remitente cargada");
  } else if (showMessage) {
    toast("Remitente nuevo");
  }
  await renderBeneficiaries();
}

async function findReceiver(showMessage = true) {
  if (!validDRPhone($("receiver-phone").value)) return;
  const receiver = await getReceiverByPhone($("receiver-phone").value);
  if (receiver) {
    $("receiver-name").value = receiver.name || "";
    $("receiver-address").value = receiver.address || "";
    $("receiver-area").value = receiver.area || "";
    $("receiver-reference").value = receiver.reference || "";
    if (showMessage) toast("Ficha del destinatario cargada");
  } else if (showMessage) {
    toast("Beneficiario nuevo");
  }
}

async function renderBeneficiaries() {
  const panel = $("beneficiaries-panel");
  if (!validSpainPhone($("sender-phone").value)) {
    panel.classList.add("hidden");
    return;
  }
  const items = await getBeneficiariesForSender($("sender-phone").value);
  panel.classList.remove("hidden");
  $("beneficiaries-list").innerHTML = items.length ? items.map((item, index) => `
    <button type="button" class="beneficiary-btn" data-beneficiary="${index}"><strong>${escapeHTML(item.receiver?.name)}</strong><span>${escapeHTML(item.receiver?.phone)} · ${escapeHTML(item.receiver?.area || item.receiver?.address || "")}</span><small>${item.shipmentCount || 0} envíos · último ${escapeHTML(item.lastShipmentDate || "")}</small></button>
  `).join("") : `<div class="muted-note">Este remitente todavía no tiene destinatarios anteriores.</div>`;
  document.querySelectorAll("[data-beneficiary]").forEach((button) => button.addEventListener("click", () => {
    const receiver = items[Number(button.dataset.beneficiary)].receiver;
    $("receiver-name").value = receiver.name || "";
    $("receiver-phone").value = receiver.phone || "";
    $("receiver-address").value = receiver.address || "";
    $("receiver-area").value = receiver.area || "";
    $("receiver-reference").value = receiver.reference || "";
    validatePhoneInputs();
    toast("Beneficiario seleccionado");
  }));
}

function aggregateAndRender() {
  const totals = aggregateShipments(state.shipments.filter((s) => !s.deleted));
  $("kpi-docs").textContent = totals.docs;
  $("kpi-packages").textContent = totals.packages;
  $("kpi-small").textContent = totals.small;
  $("kpi-medium").textContent = totals.medium;
  $("kpi-large").textContent = totals.large;
  $("madrid-docs").textContent = totals.docs;
  $("madrid-packages").textContent = totals.packages;
  $("madrid-small").textContent = totals.small;
  $("madrid-medium").textContent = totals.medium;
  $("madrid-large").textContent = totals.large;
  $("admin-sales").textContent = money(totals.sales);
  $("admin-cost").textContent = money(totals.cost);
  $("admin-profit").textContent = money(totals.profit);
  $("admin-promos").textContent = money(totals.promos);
  $("admin-pending").textContent = money(totals.pending);
  $("operational-summary").innerHTML = `
    <div><span>Pagados</span><strong>${state.shipments.filter((s) => s.paymentStatus === "Pagado").length}</strong></div>
    <div><span>Pendientes de cobro</span><strong>${state.shipments.filter((s) => s.paymentStatus !== "Pagado").length}</strong></div>
    <div><span>Cargados para Madrid</span><strong>${totals.loaded}</strong></div>
    <div><span>Descargados en Madrid</span><strong>${totals.delivered}</strong></div>`;
  $("recent-shipments").innerHTML = state.shipments.slice(0, 6).map((s) => `<div><span><strong>${escapeHTML(s.visibleNumber)}</strong> · ${escapeHTML(s.sender?.name)}</span><strong>${s.totalPackages} bultos</strong></div>`).join("") || `<div class="muted-note">Sin recogidas.</div>`;
  $("madrid-list").innerHTML = state.shipments.map((s) => `<div><span>${escapeHTML(s.visibleNumber)} · ${escapeHTML(s.sender?.name)}</span><strong>${s.totalPackages} bultos · ${escapeHTML(s.status)}</strong></div>`).join("") || `<div class="muted-note">No hay envíos.</div>`;
}

function shipmentMatchesFilters(shipment) {
  const search = $("shipment-search").value.toLowerCase().trim();
  const status = $("shipment-status-filter").value;
  const payment = $("shipment-payment-filter").value;
  const haystack = JSON.stringify(shipment).toLowerCase();
  return (!search || haystack.includes(search)) && (!status || shipment.status === status) && (!payment || shipment.paymentStatus === payment);
}

function renderShipmentList() {
  const items = state.shipments.filter(shipmentMatchesFilters);
  $("shipments-list").innerHTML = items.map((s) => `
    <article class="shipment-card">
      <div class="shipment-head"><div><h4>${escapeHTML(s.visibleNumber || "PENDIENTE")} ${s.pendingWrites ? "· sincronizando" : ""}</h4><div class="shipment-meta">${escapeHTML(s.date)} · ${escapeHTML(s.destinationLabel)} · ${s.totalPackages} bultos</div></div><div><span class="tag ${s.status === "Descargado en Madrid" ? "green" : "amber"}">${escapeHTML(s.status)}</span> <span class="tag">${escapeHTML(s.paymentStatus)}</span></div></div>
      <p><strong>${escapeHTML(s.sender?.name)}</strong> ${escapeHTML(s.sender?.phone)} → <strong>${escapeHTML(s.receiver?.name)}</strong> ${escapeHTML(s.receiver?.phone)}</p>
      <div class="shipment-actions">
        <button class="btn ghost compact" data-action="print" data-id="${s.id}">PDF</button>
        <button class="btn ghost compact" data-action="whatsapp" data-id="${s.id}">WhatsApp</button>
        <button class="btn ghost compact" data-action="sms" data-id="${s.id}">SMS</button>
        <button class="btn ghost compact" data-action="edit" data-id="${s.id}">Editar</button>
        <button class="btn secondary compact" data-action="loaded" data-id="${s.id}">Cargado</button>
        <button class="btn primary compact" data-action="delivered" data-id="${s.id}">Descargado</button>
      </div>
    </article>
  `).join("") || `<div class="muted-note">Sin resultados.</div>`;

  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    const shipment = state.shipments.find((s) => s.id === button.dataset.id);
    if (!shipment) return;
    const action = button.dataset.action;
    if (action === "print") printShipment(shipment);
    if (action === "edit") fillForm(shipment);
    if (action === "whatsapp") openMessage(shipment, "whatsapp");
    if (action === "sms") openMessage(shipment, "sms");
    if (action === "loaded" || action === "delivered") {
      await updateShipmentStatus(shipment, action === "loaded" ? "Cargado para Madrid" : "Descargado en Madrid", state.user);
      toast("Estado actualizado");
    }
  }));
}

function openMessage(shipment, mode) {
  if (mode === "none") return;
  const text = encodeURIComponent(buildCustomerMessage(shipment));
  const phone = normalizeSpainPhone(shipment.sender?.phone);
  if (mode === "whatsapp") window.open(`https://wa.me/34${phone}?text=${text}`, "_blank");
  else window.location.href = `sms:${phone}?body=${text}`;
}

function renderContacts() {
  const senderSearch = $("sender-search").value.toLowerCase();
  const receiverSearch = $("receiver-search").value.toLowerCase();
  $("senders-list").innerHTML = state.senders.filter((x) => JSON.stringify(x).toLowerCase().includes(senderSearch)).map((x) => `<div class="contact-card"><strong>${escapeHTML(x.name)}</strong><div>${escapeHTML(x.phone)}</div><small>${escapeHTML(x.address || "")} · ${x.totalShipments || 0} envíos</small></div>`).join("") || `<div class="muted-note">Sin remitentes.</div>`;
  $("receivers-list").innerHTML = state.receivers.filter((x) => JSON.stringify(x).toLowerCase().includes(receiverSearch)).map((x) => `<div class="contact-card"><strong>${escapeHTML(x.name)}</strong><div>${escapeHTML(x.phone)}</div><small>${escapeHTML(x.address || "")} · ${escapeHTML(x.area || "")}</small></div>`).join("") || `<div class="muted-note">Sin destinatarios.</div>`;
}

function renderWeeks() {
  $("weeks-list").innerHTML = state.weeks.filter((w) => w.status === "closed").map((w) => `<div><span><strong>${escapeHTML(w.label)}</strong><br><small>Cerrada ${w.madridDeliveryDate || ""}</small></span><button class="btn ghost compact" data-week-report="${w.id}">Generar PDF</button></div>`).join("") || `<div class="muted-note">No hay semanas cerradas.</div>`;
  document.querySelectorAll("[data-week-report]").forEach((button) => button.addEventListener("click", async () => {
    const week = state.weeks.find((w) => w.id === button.dataset.weekReport);
    const shipments = await getShipmentsForWeek(week.id);
    printWeeklyReport(shipments, week, "REPORTE DE SEMANA CERRADA");
  }));
}

function renderSettings() {
  $("capital-rates").textContent = `${state.settings.capitalPrices.small} € · ${state.settings.capitalPrices.medium} € · ${state.settings.capitalPrices.large} €`;
  $("interior-rates").textContent = `${state.settings.interiorPrices.small} € · ${state.settings.interiorPrices.medium} € · ${state.settings.interiorPrices.large} €`;
  $("settings-rates").innerHTML = [
    ["Capital", "capitalPrices"], ["Interior", "interiorPrices"], ["Coste Madrid", "madridCosts"]
  ].map(([label, key]) => `<div class="rate-block"><h4>${label}</h4><div class="field-grid three">${SIZE_KEYS.map((size) => `<div><label>${SIZE_LABELS[size]}</label><input id="setting-${key}-${size}" type="number" min="0" step="0.01" value="${state.settings[key][size]}"></div>`).join("")}</div></div>`).join("");
  $("settings-next-trip").value = state.settings.nextTrip || "";
  $("next-trip-date").value = state.settings.nextTrip || "";
  renderCalculation();
}

function exportCSV() {
  const rows = [["Número", "Fecha", "Remitente", "Teléfono remitente", "Destinatario", "Teléfono destinatario", "Destino", "Pequeñas", "Medianas", "Grandes", "Bultos", "Total", "Estado", "Cobro"]];
  state.shipments.forEach((s) => rows.push([s.visibleNumber, s.date, s.sender?.name, s.sender?.phone, s.receiver?.name, s.receiver?.phone, s.destinationLabel, s.quantities?.small, s.quantities?.medium, s.quantities?.large, s.totalPackages, s.totalAmount, s.status, s.paymentStatus]));
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  downloadText("recogidas_semana.csv", csv, "text/csv;charset=utf-8");
}

function startRealtime() {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  state.unsubs.push(subscribeSettings((settings) => {
    state.settings = settings;
    renderSettings();
  }, console.error));
  state.unsubs.push(subscribeWeeks((weeks) => {
    state.weeks = weeks;
    renderWeeks();
  }, console.error));
  state.unsubs.push(subscribeActiveWeek((week) => {
    if (!week) return;
    state.activeWeek = week;
    $("week-label").textContent = week.label;
    if (state.shipmentUnsub) state.shipmentUnsub();
    state.shipmentUnsub = subscribeShipments(week.id, (shipments, fromCache) => {
      state.shipments = shipments.filter((s) => !s.deleted);
      setSyncStatus(fromCache ? "Caché local" : "Sincronizado", fromCache ? "offline" : "online");
      aggregateAndRender();
      renderShipmentList();
    }, (error) => {
      console.error(error);
      setSyncStatus("Error de sincronización", "offline");
    });
  }, console.error));
  state.unsubs.push(subscribeSenders((items) => { state.senders = items; renderContacts(); }, console.error));
  state.unsubs.push(subscribeReceivers((items) => { state.receivers = items; renderContacts(); }, console.error));
}

async function enterApp(user) {
  state.user = user;
  state.profile = await ensureBootstrap(user);
  $("login-screen").classList.add("hidden");
  $("app-shell").classList.remove("hidden");
  const isAdmin = state.profile.role === "admin";
  const isMadrid = state.profile.role === "madrid";
  document.querySelectorAll(".admin-nav").forEach((x) => x.classList.toggle("hidden", !isAdmin));
  document.querySelectorAll('[data-view="new"], [data-view="contacts"], [data-go="new"]').forEach((x) => x.classList.toggle("hidden", isMadrid));
  if (isMadrid) goView("madrid");
  startRealtime();
  if (navigator.onLine) await finalizePendingShipments(user);
}

function setupEvents() {
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError("login-error");
    try {
      await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-password").value);
    } catch (error) {
      showError("login-error", "No se pudo iniciar sesión. Revisa el correo y la contraseña.");
      console.error(error);
    }
  });
  $("logout-btn").addEventListener("click", () => signOut(auth));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => goView(button.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => goView(button.dataset.go)));
  $("destination-capital").addEventListener("click", () => { state.destination = "capital"; renderCalculation(); });
  $("destination-interior").addEventListener("click", () => { state.destination = "interior"; renderCalculation(); });
  $("sender-phone").addEventListener("input", () => { validatePhoneInputs(); renderBeneficiaries(); });
  $("receiver-phone").addEventListener("input", validatePhoneInputs);
  $("sender-phone").addEventListener("blur", () => findSender(false));
  $("receiver-phone").addEventListener("blur", () => findReceiver(false));
  $("find-sender-btn").addEventListener("click", () => findSender(true));
  $("find-receiver-btn").addEventListener("click", () => findReceiver(true));
  $("new-beneficiary-btn").addEventListener("click", () => {
    ["receiver-phone", "receiver-name", "receiver-address", "receiver-area", "receiver-reference"].forEach((id) => $(id).value = "");
    $("receiver-phone").focus();
    validatePhoneInputs();
  });
  $("reset-form-btn").addEventListener("click", resetForm);
  $("shipment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = calculateDraft();
    const errors = validateDraft(draft);
    if (errors.length) {
      showError("form-error", errors.join(" "));
      return;
    }
    hideError("form-error");
    state.draftForReview = draft;
    renderReview(draft);
    $("review-dialog").showModal();
  });
  $("close-review-btn").addEventListener("click", () => $("review-dialog").close());
  $("edit-review-btn").addEventListener("click", () => $("review-dialog").close());
  $("confirm-save-btn").addEventListener("click", async () => {
    try {
      const draft = state.draftForReview;
      let result;
      if (state.editingId) {
        await updateShipment(state.editingId, draft, state.user, state.activeWeek);
        result = { visibleNumber: state.editingShipment.visibleNumber, provisional: false };
      } else {
        result = await createShipment(draft, state.user, state.activeWeek.id);
      }
      $("review-dialog").close();
      toast(result.provisional ? "Guardado sin conexión · número pendiente" : `Guardado ${result.visibleNumber}`);
      resetForm();
      goView("shipments");
    } catch (error) {
      showError("form-error", error.message);
      $("review-dialog").close();
      console.error(error);
    }
  });
  $("print-current-btn").addEventListener("click", () => {
    const draft = calculateDraft();
    const errors = validateDraft(draft);
    if (errors.length) return showError("form-error", errors.join(" "));
    const printable = { ...draft, visibleNumber: state.editingShipment?.visibleNumber || "PENDIENTE", parcels: state.editingShipment?.parcels || [] };
    state.pendingShare = { shipment: printable, mode: $("send-after-pdf").value };
    printShipment(printable);
  });
  ["shipment-search", "shipment-status-filter", "shipment-payment-filter"].forEach((id) => $(id).addEventListener("input", renderShipmentList));
  $("sender-search").addEventListener("input", renderContacts);
  $("receiver-search").addEventListener("input", renderContacts);
  $("weekly-report-btn").addEventListener("click", () => printWeeklyReport(state.shipments, state.activeWeek));
  $("madrid-report-btn").addEventListener("click", () => printWeeklyReport(state.shipments, state.activeWeek, "REPORTE DE CARGA Y DESCARGA"));
  $("export-csv-btn").addEventListener("click", exportCSV);
  $("mark-loaded-btn").addEventListener("click", async () => {
    try { await markAllLoaded(state.shipments, state.user); toast("Todos marcados como cargados"); } catch (error) { showError("madrid-error", error.message); }
  });
  $("close-week-btn").addEventListener("click", async () => {
    hideError("madrid-error");
    if (!confirm(`¿Confirmas la descarga de ${aggregateShipments(state.shipments).packages} bultos y el cierre de la semana?`)) return;
    try {
      await closeWeek(state.activeWeek, state.shipments, $("madrid-date").value, $("next-trip-date").value, state.user);
      toast("Semana cerrada · contador reiniciado a BUR-001");
      goView("dashboard");
    } catch (error) { showError("madrid-error", error.message); }
  });
  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = { nextTrip: $("settings-next-trip").value };
    ["capitalPrices", "interiorPrices", "madridCosts"].forEach((key) => {
      settings[key] = {};
      SIZE_KEYS.forEach((size) => settings[key][size] = Number($(`setting-${key}-${size}`).value || 0));
    });
    await saveSettings(settings);
    toast("Ajustes guardados");
  });
  $("role-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveUserRole({ uid: $("role-uid").value.trim(), email: $("role-email").value.trim(), name: $("role-name").value.trim(), role: $("role-value").value });
    event.target.reset();
    toast("Acceso guardado");
  });
  window.addEventListener("afterprint", () => {
    if (!state.pendingShare) return;
    const pending = state.pendingShare;
    state.pendingShare = null;
    setTimeout(() => openMessage(pending.shipment, pending.mode), 250);
  });
  window.addEventListener("online", async () => {
    $("offline-banner").classList.add("hidden");
    setSyncStatus("Sincronizando…");
    if (state.user) await finalizePendingShipments(state.user);
  });
  window.addEventListener("offline", () => {
    $("offline-banner").classList.remove("hidden");
    setSyncStatus("Sin conexión", "offline");
  });
}

renderBoxEditor();
setupEvents();
resetForm();
$("madrid-date").value = todayISO();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.unsubs.forEach((u) => u());
    if (state.shipmentUnsub) state.shipmentUnsub();
    state.user = null;
    $("app-shell").classList.add("hidden");
    $("login-screen").classList.remove("hidden");
    return;
  }
  try {
    await enterApp(user);
  } catch (error) {
    await signOut(auth);
    showError("login-error", error.message);
  }
});
