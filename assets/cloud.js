/* ============================================================
   SELECTOR · conexión con Firebase (solo lectura de datos + avisos).
   Los datos los escribe el escaneo diario (GitHub Actions, core/nube.py):
     estado/{dashboard,top,track,posiciones,value,comparativa,carteras}
       → { json: "<objeto>", actualizado }
     partes/{fecha} → { fecha, titulo, mensajes: "<json>", novedades }
   La app escribe solo su suscripción a notificaciones: push/{uid}.
   ============================================================ */
import { initializeApp } from "./vendor/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
         sendPasswordResetEmail } from "./vendor/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
         collection, doc, onSnapshot, query, orderBy, limit, setDoc, deleteDoc, getDoc }
  from "./vendor/firebase-firestore.js";

// No es secreto: identifica el proyecto. Lo que protege los datos son las reglas.
const firebaseConfig = {
  apiKey: "AIzaSyDfnFYmg6xTNIWGeVCuNVRRykIT6kPMW_g",
  authDomain: "selector-app-fc715.firebaseapp.com",
  projectId: "selector-app-fc715",
  storageBucket: "selector-app-fc715.firebasestorage.app",
  messagingSenderId: "429934047083",
  appId: "1:429934047083:web:21447d8ba6e004650f662e"
};
const VAPID_PUBLIC = "BL6F-IXYuWhH2GNhEdO3gBuBHO_4uDJ39lc5ghLKDkx-YM3fwYkvjIPOhZHl7Pg6BITq4IclJW2OOSalQY6IiEU";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
let db;
try {
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(fbApp, {});
}

const App = window.SelApp;
let unsubs = [];
let miPush = null;

function listen(){
  unsubs.forEach(u => u()); unsubs = [];
  unsubs.push(onSnapshot(collection(db, "estado"), { includeMetadataChanges: true }, snap => {
    const est = {};
    snap.forEach(d => {
      const f = d.data();
      try { est[d.id] = { data: JSON.parse(f.json), actualizado: f.actualizado }; }
      catch (e) { console.error("estado/" + d.id, e); }
    });
    App.onEstado(est, { offline: snap.metadata.fromCache });
  }, onError));
  unsubs.push(onSnapshot(query(collection(db, "partes"), orderBy("fecha", "desc"), limit(40)), snap => {
    const partes = snap.docs.map(d => {
      const f = d.data(); let mensajes = [];
      try { mensajes = JSON.parse(f.mensajes || "[]"); } catch (e) {}
      return { id: d.id, fecha: f.fecha, titulo: f.titulo, generado: f.generado, novedades: f.novedades || [], mensajes };
    });
    App.onPartes(partes);
  }, onError));
  unsubs.push(onSnapshot(doc(db, "push/" + auth.currentUser.uid), d => {
    miPush = d.exists() ? d.data() : null; App.onPush();
  }, () => {}));
}
function onError(err){
  console.error(err);
  App.setStatus(err.code === "permission-denied" ? "⛔ esta cuenta no tiene acceso" : "⚠ " + (err.code || err.message));
}

/* ---------------- notificaciones ---------------- */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function enablePush(){
  if (!pushSupported()) throw new Error(isStandalone()
    ? "Este móvil no admite avisos (hace falta iOS 16.4 o superior)."
    : "Abre Selector desde el icono de la pantalla de inicio para activar los avisos.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Has denegado los avisos. Actívalos en Ajustes del iPhone → Notificaciones → Selector.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC });
  await setDoc(doc(db, "push/" + auth.currentUser.uid), {
    sub: JSON.stringify(sub), dispositivo: navigator.userAgent.slice(0, 120), actualizado: new Date().toISOString() });
}
async function disablePush(){
  try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (e) {}
  await deleteDoc(doc(db, "push/" + auth.currentUser.uid));
}
async function testLocal(){
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification("Selector", { body: "✅ Los avisos funcionan en este móvil.", icon: "./icons/icon-192.png", tag: "sel-local" });
}
// Al abrir: si iOS renovó la suscripción, se actualiza en la nube.
async function refreshPush(){
  try {
    if (!miPush || !pushSupported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription();
    if (s && JSON.stringify(s) !== miPush.sub) await setDoc(doc(db, "push/" + auth.currentUser.uid),
      { sub: JSON.stringify(s), dispositivo: navigator.userAgent.slice(0, 120), actualizado: new Date().toISOString() });
  } catch (e) {}
}

onAuthStateChanged(auth, user => {
  if (!user) { unsubs.forEach(u => u()); unsubs = []; App.showLogin(true); return; }
  App.showLogin(false);
  App.setAccount(user.email);
  App.setStatus("↻ conectando…");
  listen();
  setTimeout(refreshPush, 4000);
});

window.SelCloud = {
  async login(email, pass){ await signInWithEmailAndPassword(auth, email, pass); },
  async reset(email){ await sendPasswordResetEmail(auth, email); },
  async logout(){ await signOut(auth); },
  enablePush, disablePush, testLocal,
  pushInfo(){ return { supported: pushSupported(), standalone: isStandalone(), mine: !!miPush }; },
};
App.cloudReady();
