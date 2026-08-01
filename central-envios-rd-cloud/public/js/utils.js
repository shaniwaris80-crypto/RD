export const SIZE_KEYS = ["small", "medium", "large"];
export const SIZE_LABELS = { small: "Pequeña", medium: "Mediana", large: "Grande" };

export function money(value) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR"
  }).format(Number(value) || 0);
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeSpainPhone(value) {
  let d = digits(value);
  if (d.startsWith("34") && d.length === 11) d = d.slice(2);
  return d;
}

export function normalizeDRPhone(value) {
  let d = digits(value);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export function validSpainPhone(value) {
  return normalizeSpainPhone(value).length === 9;
}

export function validDRPhone(value) {
  return normalizeDRPhone(value).length === 10;
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[m]);
}

export function aggregateShipments(shipments) {
  return shipments.reduce((r, x) => {
    r.docs += 1;
    r.small += Number(x.quantities?.small || 0);
    r.medium += Number(x.quantities?.medium || 0);
    r.large += Number(x.quantities?.large || 0);
    r.packages += Number(x.totalPackages || 0);
    r.sales += Number(x.totalAmount || 0);
    r.cost += Number(x.totalCost || 0);
    r.profit += Number(x.profit || 0);
    r.promos += Number(x.promotionValue || 0);
    if (x.paymentStatus !== "Pagado") r.pending += Number(x.totalAmount || 0);
    if (x.status === "Cargado para Madrid") r.loaded += Number(x.totalPackages || 0);
    if (x.status === "Descargado en Madrid") r.delivered += Number(x.totalPackages || 0);
    return r;
  }, {
    docs: 0, small: 0, medium: 0, large: 0, packages: 0,
    sales: 0, cost: 0, profit: 0, promos: 0, pending: 0,
    loaded: 0, delivered: 0
  });
}

export function isoWeekInfo(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export function weekIdFromInfo(info) {
  return `${info.year}-S${String(info.week).padStart(2, "0")}`;
}

export function nextISOWeek(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7 + 7);
  return isoWeekInfo(monday);
}

export function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
