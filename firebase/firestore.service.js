import { db } from "./firebase.config.js";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const COLLECTIONS = ["consoles", "games", "sessions", "dailyPlans"];

export function refFor(uid, collectionName, id) {
  return doc(db, "users", uid, collectionName, id);
}

export function colFor(uid, collectionName) {
  return collection(db, "users", uid, collectionName);
}

export function watchUserData(uid, callback, onError) {
  const state = {
    consoles: [],
    games: [],
    sessions: [],
    dailyPlans: []
  };

  const unsubscribers = COLLECTIONS.map((name) => onSnapshot(
    colFor(uid, name),
    (snapshot) => {
      state[name] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback({ ...state });
    },
    onError
  ));

  return () => unsubscribers.forEach((unsub) => unsub());
}

export async function upsertItem(uid, collectionName, item) {
  const id = item.id || crypto.randomUUID();
  const now = Date.now();
  await setDoc(refFor(uid, collectionName, id), {
    ...item,
    id,
    updatedAt: now,
    createdAt: item.createdAt || now
  }, { merge: true });
  return id;
}

export async function removeItem(uid, collectionName, id) {
  await deleteDoc(refFor(uid, collectionName, id));
}

export async function getCollection(uid, collectionName) {
  const snap = await getDocs(colFor(uid, collectionName));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function batchUpsert(uid, collectionName, items) {
  const batch = writeBatch(db);
  const now = Date.now();
  for (const item of items) {
    const id = item.id || crypto.randomUUID();
    batch.set(refFor(uid, collectionName, id), {
      ...item,
      id,
      updatedAt: now,
      createdAt: item.createdAt || now
    }, { merge: true });
  }
  await batch.commit();
}

export async function deleteAllUserData(uid) {
  for (const name of COLLECTIONS) {
    const docs = await getCollection(uid, name);
    const chunks = [];
    for (let i = 0; i < docs.length; i += 450) chunks.push(docs.slice(i, i + 450));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      for (const item of chunk) batch.delete(refFor(uid, name, item.id));
      await batch.commit();
    }
  }
}
