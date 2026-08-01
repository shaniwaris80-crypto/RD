import { money, escapeHTML, SIZE_KEYS, SIZE_LABELS, aggregateShipments, todayISO } from "./utils.js";

function setPrintHTML(html) {
  const root = document.getElementById("print-root");
  root.innerHTML = html;
  window.print();
}

function sizeRows(shipment) {
  return SIZE_KEYS
    .filter((size) => Number(shipment.quantities?.[size] || 0) > 0)
    .map((size) => `
      <tr>
        <td>${SIZE_LABELS[size]}</td>
        <td>${shipment.quantities[size]}</td>
        <td>${shipment.freeQuantities?.[size] || 0}</td>
        <td>${shipment.chargedQuantities?.[size] || 0}</td>
        <td>${money(shipment.appliedPrices?.[size] || 0)}</td>
        <td>${money(shipment.subtotals?.[size] || 0)}</td>
      </tr>`)
    .join("");
}

export function printShipment(shipment) {
  const parcels = (shipment.parcels || []).map((p) => `
    <tr><td>${escapeHTML(p.code)}</td><td>${escapeHTML(SIZE_LABELS[p.size] || p.size)}</td><td>${escapeHTML(p.status)}</td></tr>
  `).join("");

  setPrintHTML(`
    <div class="print-sheet">
      <header class="print-header">
        <div>
          <div class="print-brand">🇪🇸 CENTRAL ENVÍOS RD 🇩🇴</div>
          <h1>COMPROBANTE DE RECOGIDA</h1>
          <p>Burgos → Madrid → República Dominicana</p>
        </div>
        <div class="print-number">
          <small>NÚMERO DE RECOGIDA</small>
          <strong>${escapeHTML(shipment.visibleNumber || "PENDIENTE")}</strong>
          <span>${escapeHTML(shipment.date || "")}</span>
        </div>
      </header>

      <div class="print-two-col">
        <section><h2>🇪🇸 REMITENTE</h2><strong>${escapeHTML(shipment.sender?.name)}</strong><p>${escapeHTML(shipment.sender?.phone)}<br>${escapeHTML(shipment.sender?.address || "Dirección no indicada")}</p></section>
        <section><h2>🇩🇴 DESTINATARIO</h2><strong>${escapeHTML(shipment.receiver?.name)}</strong><p>${escapeHTML(shipment.receiver?.phone)}<br>${escapeHTML(shipment.receiver?.address)}<br>${escapeHTML(shipment.receiver?.area || "")} ${escapeHTML(shipment.receiver?.reference || "")}</p></section>
      </div>

      <table class="print-table">
        <thead><tr><th>Tamaño</th><th>Cantidad</th><th>Sin cargo</th><th>Cobradas</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${sizeRows(shipment)}</tbody>
      </table>

      <div class="print-two-col print-bottom">
        <section>
          <h2>Contenido declarado</h2>
          <p>${escapeHTML((shipment.content || []).join(", ") || "No indicado")}</p>
          <h2>Observaciones</h2>
          <p>${escapeHTML(shipment.notes || "Sin observaciones")}</p>
        </section>
        <section class="print-total-box">
          <span>TOTAL DE BULTOS</span><strong>${shipment.totalPackages || 0}</strong>
          <span>TOTAL A PAGAR</span><strong>${money(shipment.totalAmount || 0)}</strong>
          <p>${escapeHTML(shipment.paymentMethod)} · ${escapeHTML(shipment.paymentStatus)}</p>
        </section>
      </div>

      ${parcels ? `<h2 class="parcel-title">Control individual de bultos</h2><table class="print-table compact"><thead><tr><th>Código</th><th>Tamaño</th><th>Estado</th></tr></thead><tbody>${parcels}</tbody></table>` : ""}

      <div class="print-notice">Este documento acredita la recogida de los bultos indicados para su posterior entrega a la empresa encargada del transporte hacia República Dominicana. Conserve este comprobante e indique el número <strong>${escapeHTML(shipment.visibleNumber || "")}</strong> para cualquier consulta.</div>
      <div class="signatures"><div>Firma del remitente</div><div>Firma del recogedor</div></div>
      <footer>★ Gracias por confiar en nosotros ★</footer>
    </div>
  `);
}

export function printWeeklyReport(shipments, week, title = "RESUMEN COMPLETO DE RECOGIDAS") {
  const totals = aggregateShipments(shipments);
  const rows = shipments.map((s) => {
    const sizes = SIZE_KEYS.filter((size) => Number(s.quantities?.[size] || 0) > 0)
      .map((size) => `${SIZE_LABELS[size]}: ${s.quantities[size]}`)
      .join(" · ");
    return `
      <tr>
        <td><strong>${escapeHTML(s.visibleNumber || "PENDIENTE")}</strong><br>${escapeHTML(s.date || "")}</td>
        <td>${escapeHTML(s.sender?.name)}<br>${escapeHTML(s.sender?.phone)}<br>${escapeHTML(s.sender?.address || "")}</td>
        <td>${escapeHTML(s.receiver?.name)}<br>${escapeHTML(s.receiver?.phone)}<br>${escapeHTML(s.receiver?.address || "")}<br>${escapeHTML(s.receiver?.area || "")}</td>
        <td>${escapeHTML(s.destinationLabel)}</td>
        <td>${escapeHTML(sizes)}</td>
        <td><strong>${s.totalPackages || 0}</strong></td>
        <td>${escapeHTML(s.status)}</td>
        <td>${escapeHTML(s.paymentStatus)}</td>
      </tr>`;
  }).join("");

  setPrintHTML(`
    <div class="print-sheet report">
      <header class="print-header">
        <div><div class="print-brand">🇪🇸 CENTRAL ENVÍOS RD 🇩🇴</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(week?.label || "Semana")} · Burgos → Madrid</p></div>
        <div class="print-number"><small>FECHA DE EMISIÓN</small><strong class="date">${todayISO()}</strong></div>
      </header>
      <div class="report-kpis">
        <div><span>ALBARANES</span><strong>${totals.docs}</strong></div>
        <div><span>BULTOS</span><strong>${totals.packages}</strong></div>
        <div><span>PEQUEÑAS</span><strong>${totals.small}</strong></div>
        <div><span>MEDIANAS</span><strong>${totals.medium}</strong></div>
        <div><span>GRANDES</span><strong>${totals.large}</strong></div>
      </div>
      <table class="print-table report-table"><thead><tr><th>Envío</th><th>Remitente</th><th>Destinatario</th><th>Destino</th><th>Tamaños</th><th>Bultos</th><th>Estado</th><th>Cobro</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="print-notice"><strong>Conteo final:</strong> ${totals.packages} bultos · ${totals.small} pequeñas · ${totals.medium} medianas · ${totals.large} grandes.</div>
    </div>
  `);
}

export function buildCustomerMessage(shipment) {
  const sizes = SIZE_KEYS.filter((size) => Number(shipment.quantities?.[size] || 0) > 0)
    .map((size) => `${shipment.quantities[size]} ${SIZE_LABELS[size].toLowerCase()}${shipment.quantities[size] === 1 ? "" : "s"}`)
    .join(", ");
  return `Hola ${shipment.sender?.name || ""},\n\nTu recogida ha sido registrada correctamente.\n\nNúmero: ${shipment.visibleNumber || "PENDIENTE"}\nFecha: ${shipment.date}\nDestino: ${shipment.destinationLabel}\nBultos: ${shipment.totalPackages}\nDetalle: ${sizes}\nTotal: ${money(shipment.totalAmount)}\nEstado del pago: ${shipment.paymentStatus}\n\nConserva el número como referencia.\nGracias.`;
}
