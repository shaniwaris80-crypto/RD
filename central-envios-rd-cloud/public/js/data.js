import { db } from "./firebase.js";
import { ADMIN_EMAIL } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  increment,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import {
  isoWeekInfo,
  weekIdFromInfo,
  nextISOWeek,
  normalizeSpainPhone,
  normalizeDRPhone,
  SIZE_KEYS
} from "./utils.js";

export const DEFAULT_SETTINGS = {
  companyName: "Central Envíos RD",
  phone: "631667893",
  collectionArea: "Burgos y alrededores",
  capitalPrices: { small: 25, medium: 60, large: 120 },
  interiorPrices: { small: 30, medium: 65, large: 130 },
  madridCosts: { small: 15, medium: 40, large: 80 },
  nextTrip: ""
};

export async function ensureBootstrap(user) {
  const userRef = doc(db, "users", user.uid);
  let userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    if (String(user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      throw new Error("El usuario existe en Authentication, pero todavía no tiene acceso asignado.");
    }
    await setDoc(userRef, {
      email: user.email,
      name: user.displayName || "Arslan",
      role: "admin",
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    userSnap = await getDoc(userRef);
  }

  const profile = { id: userSnap.id, ...userSnap.data() };
  if (!profile.active) throw new Error("Este usuario está desactivado.");

  if (profile.role === "admin") {
    const settingsRef = doc(db, "settings", "general");
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      await setDoc(settingsRef, {
        ...DEFAULT_SETTINGS,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    const activeQuery = query(collection(db, "weeks"), where("status", "==", "active"));
    const activeSnap = await getDocs(activeQuery);
    if (activeSnap.empty) {
      const info = isoWeekInfo();
      const weekId = weekIdFromInfo(info);
      await setDoc(doc(db, "weeks", weekId), {
        label: `Semana ${info.week} · ${info.year}`,
        year: info.year,
        weekNumber: info.week,
        status: "active",
        nextSequence: 1,
        totalShipments: 0,
        totalPackages: 0,
        smallBoxes: 0,
        mediumBoxes: 0,
        largeBoxes: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  }

  return profile;
}

export function subscribeSettings(callback, errorCallback) {
  return onSnapshot(doc(db, "settings", "general"), (snap) => {
    callback(snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : DEFAULT_SETTINGS);
  }, errorCallback);
}

export function subscribeActiveWeek(callback, errorCallback) {
  const q = query(collection(db, "weeks"), where("status", "==", "active"));
  return onSnapshot(q, (snap) => {
    const weeks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(weeks[0] || null);
  }, errorCallback);
}

export function subscribeWeeks(callback, errorCallback) {
  return onSnapshot(collection(db, "weeks"), (snap) => {
    const weeks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    weeks.sort((a, b) => (b.year - a.year) || (b.weekNumber - a.weekNumber));
    callback(weeks);
  }, errorCallback);
}

export function subscribeShipments(weekId, callback, errorCallback) {
  const q = query(collection(db, "shipments"), where("weekId", "==", weekId));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const items = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      pendingWrites: d.metadata.hasPendingWrites
    }));
    items.sort((a, b) => Number(b.clientCreatedAt || 0) - Number(a.clientCreatedAt || 0));
    callback(items, snap.metadata.fromCache);
  }, errorCallback);
}

export function subscribeSenders(callback, errorCallback) {
  return onSnapshot(collection(db, "senders"), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    callback(items);
  }, errorCallback);
}

export function subscribeReceivers(callback, errorCallback) {
  return onSnapshot(collection(db, "receivers"), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    callback(items);
  }, errorCallback);
}

export async function getSenderByPhone(phone) {
  const key = normalizeSpainPhone(phone);
  if (!key) return null;
  const snap = await getDoc(doc(db, "senders", key));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getReceiverByPhone(phone) {
  const key = normalizeDRPhone(phone);
  if (!key) return null;
  const snap = await getDoc(doc(db, "receivers", key));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getBeneficiariesForSender(phone) {
  const senderKey = normalizeSpainPhone(phone);
  if (!senderKey) return [];
  const q = query(collection(db, "senderReceivers"), where("senderKey", "==", senderKey));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => Number(b.shipmentCount || 0) - Number(a.shipmentCount || 0));
  return items;
}

function createParcels(payload, visibleNumber) {
  const parcels = [];
  const total = SIZE_KEYS.reduce((sum, size) => sum + Number(payload.quantities[size] || 0), 0);
  let index = 0;
  SIZE_KEYS.forEach((size) => {
    for (let i = 0; i < Number(payload.quantities[size] || 0); i += 1) {
      index += 1;
      parcels.push({
        code: `${visibleNumber}-${index}/${total}`,
        index,
        total,
        size,
        status: payload.status || "Recogido"
      });
    }
  });
  return parcels;
}

async function finalizeShipment(shipmentId, user) {
  const shipmentRef = doc(db, "shipments", shipmentId);
  const activeQuery = query(collection(db, "weeks"), where("status", "==", "active"));
  const activeSnap = await getDocs(activeQuery);
  if (activeSnap.empty) throw new Error("No hay una semana activa.");
  const activeWeek = { id: activeSnap.docs[0].id, ...activeSnap.docs[0].data() };
  const weekRef = doc(db, "weeks", activeWeek.id);

  return runTransaction(db, async (tx) => {
    const shipmentSnap = await tx.get(shipmentRef);
    if (!shipmentSnap.exists()) throw new Error("No se encontró el albarán pendiente.");
    const shipment = shipmentSnap.data();
    if (!shipment.provisional) return shipment.visibleNumber;

    const weekSnap = await tx.get(weekRef);
    if (!weekSnap.exists() || weekSnap.data().status !== "active") {
      throw new Error("La semana activa cambió. Vuelve a intentarlo.");
    }

    const week = weekSnap.data();
    const sequence = Number(week.nextSequence || 1);
    const visibleNumber = `BUR-${String(sequence).padStart(3, "0")}`;
    const parcels = createParcels(shipment, visibleNumber);

    tx.update(shipmentRef, {
      visibleNumber,
      internalNumber: `${activeWeek.id}-${visibleNumber}`,
      weekId: activeWeek.id,
      parcels,
      provisional: false,
      finalizedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    tx.update(weekRef, {
      nextSequence: sequence + 1,
      totalShipments: Number(week.totalShipments || 0) + 1,
      totalPackages: Number(week.totalPackages || 0) + Number(shipment.totalPackages || 0),
      smallBoxes: Number(week.smallBoxes || 0) + Number(shipment.quantities?.small || 0),
      mediumBoxes: Number(week.mediumBoxes || 0) + Number(shipment.quantities?.medium || 0),
      largeBoxes: Number(week.largeBoxes || 0) + Number(shipment.quantities?.large || 0),
      updatedAt: serverTimestamp()
    });

    const senderKey = normalizeSpainPhone(shipment.sender.phone);
    const receiverKey = normalizeDRPhone(shipment.receiver.phone);
    const senderRef = doc(db, "senders", senderKey);
    const receiverRef = doc(db, "receivers", receiverKey);
    const relationRef = doc(db, "senderReceivers", `${senderKey}_${receiverKey}`);

    tx.set(senderRef, {
      ...shipment.sender,
      normalizedPhone: senderKey,
      totalShipments: increment(1),
      lastShipmentDate: shipment.date,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(receiverRef, {
      ...shipment.receiver,
      normalizedPhone: receiverKey,
      totalShipments: increment(1),
      lastShipmentDate: shipment.date,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(relationRef, {
      senderKey,
      receiverKey,
      receiver: shipment.receiver,
      shipmentCount: increment(1),
      lastShipmentDate: shipment.date,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(doc(collection(db, "auditLogs")), {
      action: "shipment_created",
      documentId: shipmentId,
      visibleNumber,
      userId: user.uid,
      userEmail: user.email,
      timestamp: serverTimestamp()
    });

    return visibleNumber;
  });
}

export async function createShipment(payload, user, weekId) {
  const ref = await addDoc(collection(db, "shipments"), {
    ...payload,
    weekId,
    visibleNumber: "PENDIENTE",
    internalNumber: "",
    parcels: [],
    provisional: true,
    deleted: false,
    createdBy: user.uid,
    createdByEmail: user.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    clientCreatedAt: Date.now()
  });

  if (navigator.onLine) {
    const number = await finalizeShipment(ref.id, user);
    return { id: ref.id, visibleNumber: number, provisional: false };
  }

  return { id: ref.id, visibleNumber: "PENDIENTE", provisional: true };
}

export async function finalizePendingShipments(user) {
  if (!navigator.onLine) return;
  const q = query(collection(db, "shipments"), where("provisional", "==", true));
  const snap = await getDocs(q);
  for (const shipmentDoc of snap.docs) {
    const data = shipmentDoc.data();
    if (data.createdBy === user.uid || user.email === ADMIN_EMAIL) {
      try {
        await finalizeShipment(shipmentDoc.id, user);
      } catch (error) {
        console.warn("No se pudo finalizar", shipmentDoc.id, error);
      }
    }
  }
}

export async function updateShipment(shipmentId, payload, user, activeWeek) {
  if (!navigator.onLine) throw new Error("Para editar cantidades necesitas conexión a Internet.");
  const shipmentRef = doc(db, "shipments", shipmentId);
  const weekRef = doc(db, "weeks", activeWeek.id);

  await runTransaction(db, async (tx) => {
    const oldSnap = await tx.get(shipmentRef);
    const weekSnap = await tx.get(weekRef);
    if (!oldSnap.exists()) throw new Error("Albarán no encontrado.");
    if (!weekSnap.exists()) throw new Error("Semana no encontrada.");

    const old = oldSnap.data();
    const week = weekSnap.data();
    const visibleNumber = old.visibleNumber;
    const parcels = createParcels(payload, visibleNumber);

    const packageDelta = Number(payload.totalPackages || 0) - Number(old.totalPackages || 0);
    const smallDelta = Number(payload.quantities.small || 0) - Number(old.quantities?.small || 0);
    const mediumDelta = Number(payload.quantities.medium || 0) - Number(old.quantities?.medium || 0);
    const largeDelta = Number(payload.quantities.large || 0) - Number(old.quantities?.large || 0);

    tx.update(shipmentRef, {
      ...payload,
      parcels,
      updatedBy: user.uid,
      updatedByEmail: user.email,
      updatedAt: serverTimestamp()
    });

    tx.update(weekRef, {
      totalPackages: Number(week.totalPackages || 0) + packageDelta,
      smallBoxes: Number(week.smallBoxes || 0) + smallDelta,
      mediumBoxes: Number(week.mediumBoxes || 0) + mediumDelta,
      largeBoxes: Number(week.largeBoxes || 0) + largeDelta,
      updatedAt: serverTimestamp()
    });

    tx.set(doc(collection(db, "auditLogs")), {
      action: "shipment_updated",
      documentId: shipmentId,
      visibleNumber,
      userId: user.uid,
      userEmail: user.email,
      timestamp: serverTimestamp()
    });
  });
}

export async function updateShipmentStatus(shipment, status, user) {
  const parcels = (shipment.parcels || []).map((p) => ({ ...p, status }));
  await updateDoc(doc(db, "shipments", shipment.id), {
    status,
    parcels,
    updatedBy: user.uid,
    updatedByEmail: user.email,
    updatedAt: serverTimestamp()
  });
}

export async function markAllLoaded(shipments, user) {
  const batch = writeBatch(db);
  shipments.forEach((shipment) => {
    const parcels = (shipment.parcels || []).map((p) => ({ ...p, status: "Cargado para Madrid" }));
    batch.update(doc(db, "shipments", shipment.id), {
      status: "Cargado para Madrid",
      parcels,
      updatedBy: user.uid,
      updatedByEmail: user.email,
      updatedAt: serverTimestamp()
    });
  });
  await batch.commit();
}

export async function closeWeek(activeWeek, shipments, madridDate, nextTrip, user) {
  if (!navigator.onLine) throw new Error("Necesitas conexión para cerrar la semana.");
  if (!shipments.length) throw new Error("No hay albaranes para cerrar.");
  const pending = shipments.filter((s) => !["Cargado para Madrid", "Descargado en Madrid"].includes(s.status));
  if (pending.length) throw new Error(`Quedan ${pending.length} albaranes sin marcar como cargados.`);

  const batch = writeBatch(db);
  shipments.forEach((shipment) => {
    const parcels = (shipment.parcels || []).map((p) => ({ ...p, status: "Descargado en Madrid" }));
    batch.update(doc(db, "shipments", shipment.id), {
      status: "Descargado en Madrid",
      parcels,
      updatedBy: user.uid,
      updatedByEmail: user.email,
      updatedAt: serverTimestamp()
    });
  });
  await batch.commit();

  const nextInfo = nextISOWeek(activeWeek.year, activeWeek.weekNumber);
  const nextId = weekIdFromInfo(nextInfo);
  const currentRef = doc(db, "weeks", activeWeek.id);
  const nextRef = doc(db, "weeks", nextId);

  await runTransaction(db, async (tx) => {
    const currentSnap = await tx.get(currentRef);
    if (!currentSnap.exists() || currentSnap.data().status !== "active") {
      throw new Error("La semana ya fue cerrada desde otro dispositivo.");
    }

    tx.update(currentRef, {
      status: "closed",
      madridDeliveryDate: madridDate,
      closedAt: serverTimestamp(),
      closedBy: user.uid,
      updatedAt: serverTimestamp()
    });

    tx.set(nextRef, {
      label: `Semana ${nextInfo.week} · ${nextInfo.year}`,
      year: nextInfo.year,
      weekNumber: nextInfo.week,
      status: "active",
      nextSequence: 1,
      totalShipments: 0,
      totalPackages: 0,
      smallBoxes: 0,
      mediumBoxes: 0,
      largeBoxes: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: false });

    tx.set(doc(db, "settings", "general"), {
      nextTrip,
      updatedAt: serverTimestamp()
    }, { merge: true });

    tx.set(doc(collection(db, "auditLogs")), {
      action: "week_closed",
      documentId: activeWeek.id,
      nextWeekId: nextId,
      userId: user.uid,
      userEmail: user.email,
      timestamp: serverTimestamp()
    });
  });
}

export async function getShipmentsForWeek(weekId) {
  const q = query(collection(db, "shipments"), where("weekId", "==", weekId));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => Number(a.clientCreatedAt || 0) - Number(b.clientCreatedAt || 0));
  return items;
}

export async function saveSettings(settings) {
  await setDoc(doc(db, "settings", "general"), {
    ...settings,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export async function saveUserRole({ uid, email, name, role }) {
  await setDoc(doc(db, "users", uid), {
    email,
    name,
    role,
    active: true,
    updatedAt: serverTimestamp()
  }, { merge: true });
}
