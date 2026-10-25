/* ============================================================
   SELECTOR · app del móvil (solo lectura del escaneo diario).
   Pantallas: Hoy · Señales · Carteras · Posiciones · Ajustes.
   Los datos llegan de Firebase vía assets/cloud.js (window.SelCloud).
   Información, no recomendación: la app no opera.
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (d = 2) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v, d = 2) => v == null || isNaN(v) ? "—" : nf(d).format(v);
const usd = (v, d = 2) => v == null ? "—" : num(v, d) + " $";
const pct = (v, d = 1, signo = true) => v == null || isNaN(v) ? "—" : (signo && v > 0 ? "+" : v < 0 ? "−" : "") + nf(d).format(Math.abs(v)) + " %";
const cls = v => v == null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "";
const fecha = iso => { if (!iso) return "—"; const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const LS_CACHE = "sel:cache";

let EST = {};          // estado/{…} → { data, actualizado }
let PARTES = [];
let offline = false, status = "", account = null;
let filtroSenales = "operables";
const charts = {};

/* ---------------- utilidades de UI ---------------- */
function toast(t){ const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 2600); }
function chip(color, texto){ return `<span class="chip c-${color}">${esc(texto)}</span>`; }
const SEM = { verde: "verde", ambar: "ambar", rojo: "rojo" };
function semaforo(c){ return `<span class="dot d-${SEM[c] || "gris"}"></span>`; }
// HTML de los partes (el formato de los antiguos mensajes): solo b/i/u/s/code/pre/a.
function htmlParte(h){
  let t = esc(h);
  t = t.replace(/&lt;(\/?)(b|i|u|s|code|pre)&gt;/g, "<$1$2>");
  t = t.replace(/&lt;a href=&quot;(https?:\/\/[^&"]+)&quot;&gt;(.*?)&lt;\/a&gt;/g, '<a href="$1" target="_blank" rel="noopener">$2</a>');
  t = t.replace(/&amp;(lt|gt|amp|quot);/g, "&$1;");
  return t.replace(/\n/g, "<br>");
}
function d(n){ return EST[n] ? EST[n].data : null; }
function cardVacia(t){ return `<div class="card vacia">${t}</div>`; }

/* ---------------- cabecera / pestañas ---------------- */
const TITULOS = { hoy: "Hoy", senales: "Señales", carteras: "Carteras", posiciones: "Posiciones", ajustes: "Ajustes" };
function irA(tab){
  if (!TITULOS[tab]) tab = "hoy";
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("on", s.id === "s-" + tab));
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("#top-t").textContent = TITULOS[tab];
  pintarSub();
  window.scrollTo(0, 0);
  if (tab === "carteras") pintarCarteras();       // Chart.js necesita el lienzo visible
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => { history.replaceState(null, "", "#" + b.dataset.tab); irA(b.dataset.tab); });
function pintarSub(){
  const dash = d("dashboard");
  let s = dash ? `Cierre del ${fecha(dash.salud && dash.salud.fecha_mercado || dash.generado)} · escaneo ${esc(dash.generado_es || "")}` : "Sin datos todavía";
  if (offline) s = "📴 sin conexión · " + s;
  $("#top-s").innerHTML = s;
}

/* ============================================================
   LENGUAJE LLANO — traducciones de la jerga del Selector
   ============================================================ */
// precio sin decimales si es alto (283 $), con 2 si es bajo (14,45 $)
const px = v => v == null ? "—" : usd(v, Math.abs(v) >= 100 ? 0 : 2);
const pc0 = v => pct(v, 0);
const MERCADO = {
  verde: { t: "Buen momento", s: "El mercado acompaña: es buen momento para operar las oportunidades." },
  ambar: { t: "Con cuidado", s: "El mercado está mixto: se puede operar, pero con más prudencia." },
  rojo:  { t: "Mejor esperar", s: "El mercado está débil: la estrategia prefiere no comprar y quedarse en liquidez." },
};
function estadoLlano(s){
  if (!s) return { c: "gris", t: "—" };
  if (s.estado === "zona_compra") return s.operable === false
    ? { c: "ambar", t: "Buen precio, fuera de los 20 mejores" }
    : { c: "verde", t: "Buen momento para entrar" };
  if (s.estado === "extendido") return { c: "naranja", t: "Ha subido mucho: esperar" };
  return { c: "gris", t: "Vigilar" };
}
function estadoChip(s){ const e = estadoLlano(s); return chip(e.c, e.t); }
function resumenLlano(t){
  const s = t.senal || {}, p = t.plan || {};
  if (s.estado === "zona_compra" && s.operable !== false)
    return "Ha retrocedido a un buen punto de entrada dentro de una tendencia que sube. Es el tipo de oportunidad que busca la estrategia.";
  if (s.estado === "zona_compra")
    return "Está a buen precio, pero no está entre los 20 mejores del ranking: la estrategia solo opera esos.";
  if (s.estado === "extendido")
    return `Ha subido mucho en poco tiempo. Mejor esperar a que baje${p.entrada_desde ? ` hacia ${px(p.entrada_desde)}–${px(p.entrada_hasta)}` : ""} antes de entrar.`;
  return "Tiene buena tendencia, pero todavía no está en un buen punto de entrada. Toca vigilarla.";
}
// tamaño de la compra (posición por riesgo): corto + motivo
function tamanoLlano(c){
  if (c == null) return "—";
  return c >= 0.95 ? "normal" : `${Math.round(c * 100)} % de lo normal`;
}
function tamanoMotivo(c){ return c != null && c < 0.95 ? " (se mueve mucho: compra menos)" : ""; }
function riesgoLlano(rr){ return rr == null ? "—" : `Por cada 1 € que arriesgas, puedes ganar ${num(rr, 1)} €`; }
function resultadosLlano(e, mov){
  if (!e || !e.inminente) return "";
  return `<div class="aviso">📅 Presenta resultados el ${esc(e.fecha_es)}: el precio puede dar un salto brusco${mov ? ` (suele moverse ±${num(mov, 0)} %)` : ""}. Cuidado al entrar.</div>`;
}
// tarjeta de oportunidad en lenguaje llano (novedades del día)
function tarjetaOportunidad(n){
  const dStop = n.precio && n.stop ? (n.stop / n.precio - 1) * 100 : null;
  const dObj = n.precio && n.objetivo ? (n.objetivo / n.precio - 1) * 100 : null;
  return `<button class="card op" data-t="${esc(n.ticker)}">
    <div class="op-h"><span class="dot d-verde"></span><b class="tk">${esc(n.ticker)}</b><span class="muted">${esc(n.nombre)}</span></div>
    <div class="op-sub">Buen momento para entrar</div>
    <div class="plan3">
      <div><span>Comprar</span><b>cerca de ${px(n.precio)}</b></div>
      <div><span>Salir si baja a</span><b class="neg">${px(n.stop)} <small>(${pc0(dStop)})</small></b></div>
      <div><span>Objetivo</span><b class="pos">${px(n.objetivo)} <small>(${pc0(dObj)})</small></b></div>
    </div>
    <p class="op-txt">${riesgoLlano(n.rr)}.<br>Tamaño de la compra: ${tamanoLlano(n.coef)}${tamanoMotivo(n.coef)}.</p>
    <span class="mas">Ver ficha ›</span>
  </button>`;
}

/* ============================================================
   HOY
   ============================================================ */
function pintarHoy(){
  const dash = d("dashboard"), el = $("#s-hoy");
  if (!dash) { el.innerHTML = cardVacia("Aún no hay datos. Aparecerán tras el próximo escaneo diario."); return; }
  const r = dash.regimen || {}, a = dash.amplitud || {};
  const M = MERCADO[r.color] || { t: "—", s: "" };
  const parte = PARTES.find(p => !String(p.id).includes("formula")) || PARTES[0];
  const top = d("top") || [];
  const nov = dash.novedades || [];
  let h = `<div class="card mercado m-${SEM[r.color] || "gris"}">
      <div class="m-lab">El mercado hoy</div>
      <div class="m-t">${semaforo(r.color)} ${esc(M.t)}</div>
      <p>${esc(M.s)}</p>
      <details><summary>Ver detalles</summary>
        <p class="muted">${esc(r.texto || "")}</p>
        <div class="kpis">
          <div><span>Miedo (VIX)</span><b>${num(r.vix, 0)}</b></div>
          <div><span>S&amp;P 500 vs su media</span><b class="${cls(r.spy_dist_sma200_pct)}">${pc0(r.spy_dist_sma200_pct)}</b></div>
          <div><span>Empresas que suben</span><b>${num(r.amplitud_pct, 0)} %</b></div>
        </div>
        <p class="muted"><small>VIX: termómetro del miedo (bajo = calma). «Vs su media»: cuánto está el índice por encima de su media de 200 días. «Empresas que suben»: % del mercado en tendencia alcista.</small></p>
      </details>
    </div>`;
  if (nov.length) {
    h += `<h2>${nov.length === 1 ? "1 oportunidad nueva" : nov.length + " oportunidades nuevas"}</h2>` + nov.map(tarjetaOportunidad).join("");
  } else {
    const enZona = top.filter(t => t.senal && t.senal.estado === "zona_compra" && t.senal.operable !== false);
    h += `<h2>Oportunidades</h2>` + cardVacia(`Hoy no hay oportunidades nuevas.${enZona.length ? `<br>Siguen en buen momento: ${enZona.map(t => `<b>${esc(t.ticker)}</b>`).join(", ")}.` : ""}`);
  }
  const avisos = (parte ? parte.mensajes : []).filter(m => m.tipo === "cartera");
  if (avisos.length) h += `<h2>Movimientos en tus pruebas</h2>` + avisos.map(m => `<div class="card parte"><div class="parte-t">${esc(m.titulo)}</div><div class="parte-b">${htmlParte(m.html)}</div></div>`).join("");
  if (parte) {
    h += `<details class="card plegable"><summary>Ver el parte completo del ${fecha(parte.fecha)}</summary>` +
      parte.mensajes.map(m => `<div class="parte"><div class="parte-t">${esc(m.titulo || "")}</div><div class="parte-b">${htmlParte(m.html)}</div></div>`).join("") + `</details>`;
  }
  if (PARTES.length > 1) {
    h += `<details class="card plegable"><summary>Días anteriores</summary><div class="lista">` + PARTES.filter(p => p !== parte).slice(0, 30).map(p =>
      `<button class="li" data-parte="${esc(p.id)}"><span>${fecha(p.fecha)}</span><span class="muted">${esc(p.titulo || "")}</span></button>`).join("") + `</div></details>`;
  }
  h += `<p class="pie">Información, no recomendación. Cuando compres, deja puestas en el bróker la orden de salida y la de objetivo (OCO).</p>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-t]").forEach(b => b.onclick = () => abrirFicha(b.dataset.t));
  el.querySelectorAll("[data-parte]").forEach(b => b.onclick = () => abrirParte(b.dataset.parte));
}
function abrirParte(id){
  const p = PARTES.find(x => x.id === id); if (!p) return;
  abrirSheet(`<div class="sh-h"><b>Parte del ${fecha(p.fecha)}</b><div class="muted">${esc(p.titulo || "")}</div></div>` +
    p.mensajes.map(m => `<div class="card parte"><div class="parte-t">${esc(m.titulo || "")}</div><div class="parte-b">${htmlParte(m.html)}</div></div>`).join(""));
}

/* ============================================================
   SEÑALES (top del ranking)
   ============================================================ */
function pintarSenales(){
  const top = d("top"), el = $("#s-senales");
  if (!top) { el.innerHTML = cardVacia("Sin datos del ranking todavía."); return; }
  const F = {
    operables: t => t.senal && t.senal.estado === "zona_compra" && t.senal.operable !== false,
    todas: () => true,
  };
  const lista = top.filter(F[filtroSenales] || F.operables);
  let h = `<p class="intro">Las ${top.length} empresas con la subida más fuerte y ordenada del S&amp;P 500 y el NASDAQ-100. Toca una para ver su plan.</p>
    <div class="seg">${[["operables", "Para comprar"], ["todas", "Todas"]].map(([k, t]) =>
    `<button data-f="${k}" class="${filtroSenales === k ? "on" : ""}">${t}</button>`).join("")}</div>`;
  h += lista.length ? `<div class="card lista">` + lista.map(t => `<button class="li sen" data-t="${esc(t.ticker)}">
      <span class="pu">${t.puesto}</span>
      <span class="sen-m"><b class="tk">${esc(t.ticker)}</b><span class="muted">${esc(t.nombre)}</span></span>
      <span class="sen-r">${estadoChip(t.senal)}<span class="muted">${pc0(t.m12_1)} en un año</span></span>
    </button>`).join("") + `</div>` : cardVacia("Hoy ninguna está en buen momento para comprar. Mira «Todas» para ver cuáles vigilar.");
  el.innerHTML = h;
  el.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filtroSenales = b.dataset.f; pintarSenales(); });
  el.querySelectorAll("[data-t]").forEach(b => b.onclick = () => abrirFicha(b.dataset.t));
}

function abrirFicha(ticker){
  const t = (d("top") || []).find(x => x.ticker === ticker);
  const nov = ((d("dashboard") || {}).novedades || []).find(x => x.ticker === ticker);
  if (!t) {
    if (nov) abrirSheet(`<div class="sh-h"><b class="tk">${esc(nov.ticker)}</b><div class="muted">${esc(nov.nombre)}</div></div>${tarjetaOportunidad(nov)}`);
    return;
  }
  const p = t.plan || {}, s = t.senal || {}, e = t.earnings, tes = t.tesis || {}, est = t.estructura || {};
  const enZona = s.estado === "zona_compra";
  const comprarTxt = enZona ? `Comprar cerca de ${px(t.precio)}` : `Esperar a que baje a ${px(p.entrada_desde)}–${px(p.entrada_hasta)}`;
  const zonaIdeal = enZona && p.entrada_desde && t.precio > p.entrada_hasta
    ? `<div class="muted"><small>Precio actual. Si puedes esperar, la zona ideal es ${px(p.entrada_desde)}–${px(p.entrada_hasta)}.</small></div>` : "";
  let h = `<div class="sh-h"><b class="tk">${esc(t.ticker)}</b><div class="muted">${esc(t.nombre)} · ${esc(t.sector || "")} · nº ${t.puesto} del ranking</div></div>
    <div class="row precio"><b>${px(t.precio)}</b>${estadoChip(s)}</div>
    <p class="resumen">${esc(resumenLlano(t))}</p>
    ${resultadosLlano(e, t.mov_resultados && t.mov_resultados.pct)}
    <div class="chart-box"><canvas id="ficha-chart"></canvas></div>
    <div class="leyenda"><span><i style="background:#0d9488"></i>Precio</span><span><i class="dash" style="border-color:#fb7185"></i>Salir si baja</span><span><i class="dash" style="border-color:#2dd4bf"></i>Objetivo</span></div>`;
  if (p.disponible) {
    h += `<h3>El plan</h3><div class="card pasos">
      <div><span class="n">1</span><div><b>${comprarTxt}</b>${zonaIdeal}</div></div>
      <div><span class="n">2</span><div><b>Salir si baja a <span class="neg">${px(p.stop)}</span></b><small class="muted"> (${pc0(p.stop_dist_pct)})</small><div class="muted"><small>Pon esta orden en el bróker el mismo día de la compra.</small></div></div></div>
      <div><span class="n">3</span><div><b>Vender en <span class="pos">${px(p.objetivo_tecnico)}</span></b><small class="muted"> (${pc0(p.objetivo_tecnico_pct)})</small></div></div>
    </div>
    <div class="card kv">
      <div><span>Riesgo / premio</span><b>${p.rr == null ? "—" : `arriesgas 1 € para ganar ${num(p.rr, 1)} €`}</b></div>
      <div><span>Tamaño de la compra</span><b>${esc(tamanoLlano(p.coef_seguridad))}</b></div>
    </div>${p.coef_seguridad != null && p.coef_seguridad < 0.95 ? `<p class="muted"><small>Se mueve mucho, así que compra menos de lo habitual: si salta la salida, perderás lo mismo que en una compra normal.</small></p>` : ""}`;
  }
  h += `<details class="card plegable"><summary>Por qué está en la lista</summary>
      ${tes.resumen ? `<p>${esc(tes.resumen)}</p>` : ""}
      ${(tes.fuertes || []).length ? `<p class="muted">A favor</p><ul class="tes pos-l">${tes.fuertes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(tes.riesgos || []).length ? `<p class="muted">Riesgos</p><ul class="tes neg-l">${tes.riesgos.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </details>
    <details class="card plegable"><summary>Datos técnicos</summary><div class="kv">
      <div><span>Subida en 12 / 6 / 3 / 1 meses</span><b><span class="${cls(t.m12_1)}">${pc0(t.m12_1)}</span> · <span class="${cls(t.m6)}">${pc0(t.m6)}</span> · <span class="${cls(t.m3)}">${pc0(t.m3)}</span> · <span class="${cls(t.m1)}">${pc0(t.m1)}</span></b></div>
      <div><span>Puntuación (score)</span><b>${num(t.score, 0)}/100</b></div>
      <div><span>Forma del gráfico</span><b>${esc(est.etiqueta || "—")}</b></div>
      <div><span>RSI (sobrecompra &gt;70)</span><b>${num(t.rsi14, 0)}</b></div>
      <div><span>Volatilidad anual</span><b>${num(t.vol_anual, 0)} %</b></div>
      <div><span>Distancia a su máximo del año</span><b>${pc0(t.dist_max52_pct)}</b></div>
      ${t.calidad != null ? `<div><span>Calidad del negocio</span><b>${num(t.calidad, 0)}/100</b></div>` : ""}
      ${p.objetivo_analistas ? `<div><span>Objetivo de los analistas</span><b>${px(p.objetivo_analistas)}</b></div>` : ""}
      ${e ? `<div><span>Próximos resultados</span><b>${esc(e.fecha_es)}</b></div>` : ""}
      ${t.estacionalidad_mes ? `<div><span>Historial en ${esc(t.estacionalidad_mes.nombre)}</span><b>${pc0(t.estacionalidad_mes.media_pct)} de media</b></div>` : ""}
    </div>
    ${s.motivo ? `<p class="muted"><small>${esc(s.motivo)}</small></p>` : ""}
    ${p.situacion ? `<p class="muted"><small>${esc(p.situacion)}</small></p>` : ""}
    </details>
  <p class="pie">Información, no recomendación.</p>`;
  abrirSheet(h);
  pintarGraficoFicha(t);
}
function pintarGraficoFicha(t){
  const s = t.serie; const cv = $("#ficha-chart"); if (!s || !cv || !window.Chart) return;
  const p = t.plan || {};
  const linea = (v, color) => v ? { label: "", data: s.fechas.map(() => v), borderColor: color, borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0, fill: false } : null;
  const ds = [
    { label: "Precio", data: s.cierre, borderColor: "#0d9488", borderWidth: 2.2, pointRadius: 0, tension: .15,
      fill: { target: "origin" }, backgroundColor: "rgba(13,148,136,.08)" },
    linea(p.stop, "#fb7185"), linea(p.objetivo_tecnico, "#2dd4bf"),
  ].filter(Boolean);
  if (charts.ficha) charts.ficha.destroy();
  const o = baseOpts({ legend: false });
  o.plugins.tooltip = { filter: i => i.datasetIndex === 0, callbacks: { label: c => "Precio: " + px(c.parsed.y) } };
  charts.ficha = new Chart(cv, { type: "line", data: { labels: s.fechas.map(fecha), datasets: ds }, options: o });
}
function baseOpts({ legend = true, pctAxis = false } = {}){
  return { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: legend, labels: { color: "#d2cfc9", boxWidth: 10, font: { size: 11 } } },
      tooltip: { callbacks: pctAxis ? { label: c => `${c.dataset.label}: ${pct(c.parsed.y - 100)}` } : {} } },
    scales: { x: { ticks: { color: "#8f8b84", maxTicksLimit: 4, maxRotation: 0, font: { size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#8f8b84", font: { size: 10 }, callback: pctAxis ? v => (v - 100 > 0 ? "+" : "") + (v - 100) + "%" : undefined },
        grid: { color: "#222221" } } } };
}

/* ============================================================
   CARTERAS (comparativa + track + carteras en papel)
   ============================================================ */
function pintarCarteras(){
  const el = $("#s-carteras"), comp = d("comparativa"), tr = d("track"), car = d("carteras");
  if (!comp && !tr && !car) { el.innerHTML = cardVacia("Sin datos todavía."); return; }
  let h = "";
  if (comp && comp.tracks) {
    h += `<h2>¿Cómo van tus pruebas?</h2><p class="intro">Cada línea es una estrategia probada en papel (sin dinero real). La blanca discontinua es el S&amp;P 500: lo que está por encima, le gana.</p><div class="card"><div class="chart-box tall"><canvas id="comp-chart"></canvas></div>
      <p class="muted"><small>Índice base 100 · precios al ${esc(comp.precios_es || "")} · SPY ${pct(comp.spy && comp.spy.ret_pct)}</small></p></div>
      <div class="card lista">${comp.tracks.slice().sort((a, b) => (b.ret_pct ?? -1e9) - (a.ret_pct ?? -1e9)).map(x =>
        `<div class="li"><span><span class="sw" style="background:${esc(x.color)}"></span>${esc(x.nombre)}</span>
          <span class="r"><b class="${cls(x.ret_pct)}">${pct(x.ret_pct)}</b><small class="${cls(x.vs_spy_pct)}">${pct(x.vs_spy_pct)} vs SPY</small></span></div>`).join("")}</div>`;
  }
  if (tr && tr.resumen) {
    const r = tr.resumen;
    h += `<h2>Track de señales</h2><div class="card kv">
      <div><span>Señales</span><b>${r.n} · ${r.abiertas} abiertas</b></div>
      <div><span>Objetivo / stop</span><b><span class="pos">${r.objetivo}</span> / <span class="neg">${r.stop}</span> · ${num(r.aciertos_pct, 0)} % aciertos</b></div>
      <div><span>Media por señal</span><b class="${cls(r.media_pct)}">${pct(r.media_pct)}</b></div>
      <div><span>Media SPY mismo periodo</span><b class="${cls(r.media_spy_pct)}">${pct(r.media_spy_pct)}</b></div>
      <div><span>Baten al SPY</span><b>${num(r.baten_spy_pct, 0)} %</b></div>
    </div>
    ${r.significancia && r.significancia.texto ? `<p class="muted">${esc(r.significancia.texto)}</p>` : ""}
    ${tr.autopsia && tr.autopsia.texto ? `<details class="card"><summary>Autopsia (ganadoras vs perdedoras)</summary><p class="muted">${esc(tr.autopsia.texto)}</p></details>` : ""}
    <details class="card"><summary>Últimas señales</summary><div class="lista">${(tr.senales || []).slice(0, 25).map(s =>
      `<button class="li" data-t="${esc(s.ticker)}"><span><b class="tk">${esc(s.ticker)}</b> <small class="muted">${esc(s.fecha_es || fecha(s.fecha))}</small></span>
        <span class="r"><b class="${cls(s.rent_pct)}">${pct(s.rent_pct)}</b><small>${esc(s.estado || "")}</small></span></button>`).join("")}</div></details>`;
  }
  if (car && car.registro) {
    car.registro.forEach(defn => {
      const dd = (car.datos || {})[defn.clave]; if (!dd) return;
      const sg = dd.seguimiento || {};
      h += `<h2><span class="sw" style="background:${esc(defn.color)}"></span>${esc(defn.nombre)}</h2>
        <div class="card"><p class="muted"><small>${esc(defn.subtitulo || "")}</small></p>
        <div class="kpis">
          <div><span>Abiertas</span><b>${sg.n ?? 0}${sg.max ? "/" + sg.max : ""}</b></div>
          <div><span>Rentab.</span><b class="${cls(sg.ret_pct)}">${pct(sg.ret_pct)}</b></div>
          <div><span>vs SPY</span><b class="${cls(sg.vs_spy_pct)}">${pct(sg.vs_spy_pct)}</b></div>
          <div><span>Cerradas</span><b>${sg.cerradas_n ?? 0}</b></div>
          <div><span>Media cerradas</span><b class="${cls(sg.cerradas_media_pct)}">${pct(sg.cerradas_media_pct)}</b></div>
          <div><span>Positivas</span><b>${sg.cerradas_positivas ?? "—"}</b></div>
        </div>
        ${(sg.posiciones || []).length ? `<div class="lista">${sg.posiciones.map(x => `<div class="li"><span><b class="tk">${esc(x.ticker)}</b> <small class="muted">${esc(x.nombre || "")} · ${fecha(x.fecha_entrada)}</small></span><b class="${cls(x.ret_pct)}">${pct(x.ret_pct)}</b></div>`).join("")}</div>` : `<p class="muted">${esc(defn.sin_posiciones || "Sin posiciones abiertas.")}</p>`}
        ${(dd.candidatas_hoy || []).length ? `<p class="muted">Candidatas hoy: ${dd.candidatas_hoy.map(c => `<b>${esc(c.ticker)}</b>`).join(", ")}</p>` : ""}
        ${sg.significancia && sg.significancia.texto ? `<p class="muted"><small>${esc(sg.significancia.texto)}</small></p>` : ""}
        </div>`;
    });
  }
  h += `<p class="pie">Carteras en papel, sin dinero real. Información, no recomendación.</p>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-t]").forEach(b => b.onclick = () => abrirFicha(b.dataset.t));
  const cv = $("#comp-chart");
  if (cv && comp && window.Chart && $("#s-carteras").classList.contains("on")) {
    const ds = comp.tracks.map(x => ({ label: x.nombre, data: x.indice, borderColor: x.color, borderWidth: 1.6, pointRadius: 0, spanGaps: true }));
    ds.push({ label: "SPY", data: comp.spy.indice, borderColor: "#f5f5f4", borderWidth: 1.4, borderDash: [5, 4], pointRadius: 0 });
    if (charts.comp) charts.comp.destroy();
    charts.comp = new Chart(cv, { type: "line", data: { labels: comp.fechas.map(fecha), datasets: ds }, options: baseOpts({ pctAxis: true }) });
  }
}

/* ============================================================
   POSICIONES (reales, solo seguimiento)
   ============================================================ */
function pintarPosiciones(){
  const el = $("#s-posiciones"), ps = d("posiciones");
  if (!ps) { el.innerHTML = cardVacia("Sin datos de posiciones todavía."); return; }
  const r = ps.resumen;
  let h = "";
  if (r) h += `<div class="card kpis">
      <div><span>Abiertas</span><b>${r.n}</b></div><div><span>Invertido</span><b>${usd(r.invertido, 0)}</b></div>
      <div><span>Ganancia</span><b class="${cls(r.pl)}">${usd(r.pl, 0)}</b></div><div><span>Sin órdenes</span><b class="${r.sin_oco ? "neg" : ""}">${r.sin_oco}</b></div></div>
      ${r.aviso_concentracion ? `<p class="aviso">${esc(r.aviso_concentracion)}</p>` : ""}`;
  h += `<h2>Abiertas</h2>`;
  h += (ps.abiertas || []).length ? ps.abiertas.map(p => {
    const prog = p.progreso_pct ?? null;
    return `<div class="card pos-c">
      <div class="row"><b class="tk">${esc(p.ticker)}</b><b class="${cls(p.pl_pct)}">${pct(p.pl_pct)} · ${usd(p.pl, 0)}</b></div>
      <div class="muted">${fecha(p.fecha)} · ${p.dias} días · ${esc(p.sector || "")}${p.oco ? "" : ' · <b class="neg">⚠ sin órdenes en el bróker</b>'}</div>
      <div class="barra"><span class="b-stop">${usd(p.stop_ajustado || p.stop)}</span><div class="b-pista"><div class="b-pto" style="left:${prog == null ? 50 : prog}%"></div></div><span class="b-obj">${usd(p.objetivo_ajustado || p.objetivo)}</span></div>
      <div class="muted">Ahora ${px(p.precio_actual)} · a ${pc0(p.dist_stop_pct)} de la salida · a ${pc0(p.dist_objetivo_pct)} del objetivo</div>
      ${p.stop_tocado ? `<p class="aviso">Ha tocado el precio de salida: vende, no lo cambies.</p>` : p.objetivo_tocado ? `<p class="aviso ok">Ha llegado al objetivo: vende, no lo cambies.</p>` : ""}
      ${p.earnings && p.earnings.inminente ? `<p class="aviso">⚠ Resultados el ${esc(p.earnings.fecha_es)}</p>` : ""}
    </div>`; }).join("") : cardVacia("No tienes posiciones abiertas.");
  if ((ps.cerradas || []).length) h += `<h2>Cerradas</h2><div class="card lista">${ps.cerradas.slice(0, 30).map(p =>
    `<div class="li"><span><b class="tk">${esc(p.ticker)}</b> <small class="muted">${fecha(p.fecha)} → ${fecha(p.fecha_cierre)} · ${esc(p.motivo_cierre || "")}</small></span><b class="${cls(p.pl_pct)}">${pct(p.pl_pct)}</b></div>`).join("")}</div>`;
  h += `<p class="pie">Precios del último escaneo. Para abrir o cerrar posiciones, usa el dashboard del PC (en una próxima versión, desde aquí).</p>`;
  el.innerHTML = h;
}

/* ============================================================
   AJUSTES
   ============================================================ */
function pintarAjustes(){
  const C = window.SelCloud, i = C && C.pushInfo();
  let av;
  if (!i) av = `<p class="muted">Cargando…</p>`;
  else if (i.mine) av = `<p>🔔 <b>Avisos activos en este móvil.</b></p><p class="muted">Recibirás el parte diario (con las señales nuevas) y los movimientos de las carteras en papel.</p>
      <div class="btns"><button class="btn" id="av-test">Probar</button><button class="btn ghost" id="av-off">Desactivar</button></div>`;
  else if (!i.supported || !i.standalone) av = `<p class="muted">Para recibir avisos, abre Selector desde el <b>icono de la pantalla de inicio</b> (iPhone con iOS 16.4 o superior).</p>`;
  else av = `<p class="muted">Recibe el parte diario y las señales nuevas como notificación, en lugar de Telegram.</p><button class="btn" id="av-on">Activar avisos en este móvil</button>`;
  const ac = Object.entries(EST).map(([k, v]) => `<div><span>${esc(k)}</span><b>${v.actualizado ? new Date(v.actualizado).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—"}</b></div>`).join("");
  $("#s-ajustes").innerHTML = `<h2>Avisos</h2><div class="card">${av}<p class="msg" id="av-msg"></p></div>
    <h2>Cuenta</h2><div class="card"><p><b>${esc(account || "—")}</b></p><p class="muted" id="sync-msg">${esc(status)}</p>
      <button class="btn ghost" id="logout">Cerrar sesión</button></div>
    <h2>Datos publicados</h2><div class="card kv">${ac || "<div><span>—</span></div>"}</div>
    <p class="pie">Los datos los publica el escaneo diario en la nube (mar–sáb por la mañana). El backtest, el simulador y el análisis de un ticker cualquiera siguen en el dashboard del PC.</p>`;
  const msg = t => { const e = $("#av-msg"); if (e) e.textContent = t; };
  const on = $("#av-on"); if (on) on.onclick = async () => { on.disabled = true; msg("Activando…");
    try { await C.enablePush(); toast("Avisos activados"); msg(""); } catch (e) { msg(e.message || String(e)); } finally { on.disabled = false; } };
  const off = $("#av-off"); if (off) off.onclick = async () => { try { await C.disablePush(); toast("Avisos desactivados"); } catch (e) { msg(e.message); } };
  const t = $("#av-test"); if (t) t.onclick = async () => { try { await C.testLocal(); msg("Si ves la notificación, este móvil está listo."); } catch (e) { msg(e.message || String(e)); } };
  $("#logout").onclick = async () => { if (confirm("¿Cerrar sesión en este móvil?")) await C.logout(); };
}

/* ---------------- hoja inferior ---------------- */
function abrirSheet(html){
  const back = $("#sheet-back"), sh = $("#sheet");
  sh.innerHTML = `<div class="grip"></div><button class="sh-x" id="sh-x" aria-label="Cerrar">✕</button>` + html;
  back.classList.add("on"); sh.scrollTop = 0; document.body.classList.add("noscroll");
  $("#sh-x").onclick = cerrarSheet;
}
function cerrarSheet(){ $("#sheet-back").classList.remove("on"); document.body.classList.remove("noscroll"); if (charts.ficha) { charts.ficha.destroy(); charts.ficha = null; } }
$("#sheet-back").onclick = e => { if (e.target.id === "sheet-back") cerrarSheet(); };

/* ---------------- acceso ---------------- */
function showLogin(on){
  let el = $("#login");
  if (!on) { if (el) el.remove(); return; }
  if (el) return;
  el = document.createElement("div"); el.id = "login"; el.className = "login";
  el.innerHTML = `<div class="login-card"><img src="icons/icon-192.png" alt="" class="login-ic"><h1>Selector</h1>
    <p class="muted">Entra con tu correo para ver el parte, las señales y tus carteras.</p>
    <form id="lg-form"><input id="lg-email" type="email" placeholder="Correo" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    <input id="lg-pass" type="password" placeholder="Contraseña" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    <button class="btn" id="lg-btn" type="submit">Entrar</button></form>
    <button class="link" id="lg-reset">¿Olvidaste la contraseña?</button><p class="msg" id="lg-msg"></p></div>`;
  document.body.appendChild(el);
  const msg = t => { $("#lg-msg").textContent = t; };
  $("#lg-form").onsubmit = async e => { e.preventDefault();
    if (!window.SelCloud) { msg("Cargando… vuelve a intentarlo."); return; }
    $("#lg-btn").disabled = true; msg("Entrando…");
    try { await window.SelCloud.login($("#lg-email").value.trim(), $("#lg-pass").value); }
    catch (err) { msg(/invalid|wrong|not-found|credential/.test(err.code || "") ? "Correo o contraseña incorrectos. Si no la recuerdas, pulsa «¿Olvidaste la contraseña?»."
      : err.code === "auth/network-request-failed" ? "Sin conexión. Prueba de nuevo." : "No se pudo entrar (" + (err.code || err.message) + ")."); }
    finally { const b = $("#lg-btn"); if (b) b.disabled = false; } };
  $("#lg-reset").onclick = async () => { const em = $("#lg-email").value.trim();
    if (!em) { msg("Escribe tu correo arriba y vuelve a pulsar."); return; }
    try { await window.SelCloud.reset(em); msg("Te hemos enviado un correo para crear una contraseña nueva (mira también en spam)."); }
    catch (err) { msg("No se pudo enviar (" + (err.code || err.message) + ")."); } };
}

/* ---------------- puente con cloud.js ---------------- */
// (la gráfica de Carteras solo se dibuja si su pestaña está visible; al entrar se repinta)
function pintarTodo(){ pintarSub(); pintarHoy(); pintarSenales(); pintarCarteras(); pintarPosiciones(); pintarAjustes(); }
window.SelApp = {
  onEstado(est, meta){
    EST = est; offline = meta.offline;
    try { localStorage.setItem(LS_CACHE, JSON.stringify({ EST, PARTES })); } catch (e) {}
    status = offline ? "📴 sin conexión · mostrando lo guardado" : "✓ al día";
    pintarTodo();
  },
  onPartes(p){ PARTES = p; try { localStorage.setItem(LS_CACHE, JSON.stringify({ EST, PARTES })); } catch (e) {} pintarHoy(); },
  onPush(){ pintarAjustes(); },
  setStatus(s){ status = s; const e = $("#sync-msg"); if (e) e.textContent = s; },
  setAccount(e){ account = e; },
  showLogin,
  cloudReady(){ pintarAjustes(); },
};

/* ---------------- arranque ---------------- */
try { const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null"); if (c) { EST = c.EST || {}; PARTES = c.PARTES || []; } } catch (e) {}
pintarTodo();
irA((location.hash || "#hoy").slice(1));
if ("serviceWorker" in navigator) {
  const had = !!navigator.serviceWorker.controller; let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (had && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.open) irA(e.data.open); });
  navigator.serviceWorker.register("./sw.js").then(r => { r.update(); setInterval(() => r.update(), 3600e3); }).catch(() => {});
}
