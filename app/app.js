(() => {
  'use strict';
  const APP_VERSION = 'web-0.1';
  const PALETTE = ['#4f7cff','#f2994a','#27ae60','#eb5757','#9b51e0','#2d9cdb','#e0b400','#e056a0','#00a99d','#8d6e63'];
  const MAX = 10;
  const LS_KEY = 'nprojects-data-v1';
  const LS_PREFS = 'nprojects-prefs-v1';
  const LS_METRICS = 'nprojects-metrics-v1';
  const CFG = window.NPROJECTS_CONFIG || {};

  // Migración desde el nombre anterior de la app (claves malabar-*)
  try {
    [['malabar-data-v1', LS_KEY], ['malabar-prefs-v1', LS_PREFS], ['malabar-metrics-v1', LS_METRICS]].forEach(([oldK, newK]) => {
      const v = localStorage.getItem(oldK);
      if (v !== null && localStorage.getItem(newK) === null) localStorage.setItem(newK, v);
      if (v !== null) localStorage.removeItem(oldK);
    });
  } catch (e) {}

  const app = document.getElementById('app');
  const $ = s => app.querySelector(s);

  // ---------- Estado ----------
  // S.projects: [{id,name,color,archived?}]   S.active: {p, s} | null  (s = inicio en ms)
  // S.days[YYYY-MM-DD]: [{p, s, e}]  tramos cerrados de ese día
  let S = { projects: [], active: null, days: {} };
  let view = 'main';
  let viewDate = null;
  let busy = false;
  let pipWin = null;
  let prefs = { compact: false, stats: true, fit: true, invite: null, pipBig: false };
  let installEvt = null;
  let dismissedForgot = null;
  let copyText = null;
  let feedbackSent = false;

  // ---------- Utilidades ----------
  const pad = n => String(n).padStart(2, '0');
  const dk = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const todayKey = () => dk(Date.now());
  const nextMidnight = ms => { const d = new Date(ms); d.setHours(24, 0, 0, 0); return d.getTime(); };
  const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const shiftKey = (k, n) => { const d = keyToDate(k); d.setDate(d.getDate() + n); return dk(d.getTime()); };
  const hms = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
  const hm = ms => { const m = Math.round(Math.max(0, ms) / 60000); const h = Math.floor(m / 60); return h ? h + ' h ' + pad(m % 60) + ' min' : m + ' min'; };
  const clock = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const newId = () => Math.random().toString(36).slice(2, 10);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const proj = id => S.projects.find(p => p.id === id);
  const live = () => S.projects.filter(p => !p.archived);
  const pname = id => { const p = proj(id); return p ? p.name : '(proyecto eliminado)'; };
  const pcolor = id => { const p = proj(id); return p ? p.color : '#999'; };
  const day = k => (S.days[k] = S.days[k] || []);
  function dateLabel(k) {
    if (k === todayKey()) return 'Hoy';
    if (k === shiftKey(todayKey(), -1)) return 'Ayer';
    return keyToDate(k).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function timeOn(k, hhmm) { const [h, m] = hhmm.split(':').map(Number); const d = keyToDate(k); d.setHours(h, m, 0, 0); return d.getTime(); }

  // Divide un tramo en trozos por día (por si cruza la medianoche)
  function split(p, s, e) {
    const out = [];
    while (s < e) { const end = Math.min(nextMidnight(s), e); out.push({ key: dk(s), seg: { p, s, e: end } }); s = end; }
    return out;
  }
  function totals(k) {
    const t = {}; let sum = 0;
    const add = g => { const d = g.e - g.s; t[g.p] = (t[g.p] || 0) + d; sum += d; };
    (S.days[k] || []).forEach(add);
    if (S.active) split(S.active.p, S.active.s, Date.now()).forEach(x => { if (x.key === k) add(x.seg); });
    return { t, sum };
  }

  // ---------- Guardado (solo en este navegador) ----------
  function normalize(o) {
    const out = { projects: [], active: null, days: {} };
    if (!o || typeof o !== 'object') return out;
    if (Array.isArray(o.projects)) out.projects = o.projects
      .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string')
      .map(p => ({ id: p.id.slice(0, 20), name: p.name.slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PALETTE[0], ...(p.archived ? { archived: true } : {}) }));
    if (o.active && typeof o.active.p === 'string' && Number.isFinite(o.active.s)) out.active = { p: o.active.p, s: o.active.s };
    if (o.days && typeof o.days === 'object') for (const k of Object.keys(o.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(o.days[k])) continue;
      out.days[k] = o.days[k].filter(g => g && typeof g.p === 'string' && Number.isFinite(g.s) && Number.isFinite(g.e) && g.e > g.s)
        .map(g => ({ p: g.p, s: g.s, e: g.e })).sort((a, b) => a.s - b.s);
    }
    return out;
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); }
    catch (e) { toast('No se pudo guardar en este navegador.'); }
  }
  function load() {
    try { S = normalize(JSON.parse(localStorage.getItem(LS_KEY) || 'null')); } catch (e) {}
    try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(LS_PREFS) || '{}')); } catch (e) {}
  }
  function prefsSave() { try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) {} }

  // Código de invitación del enlace (?i=amigos): se guarda la primera vez y se quita de la URL
  function readInvite() {
    try {
      const u = new URL(location.href);
      const raw = (u.searchParams.get('i') || '').toLowerCase().trim();
      if (raw) {
        if (/^[a-z0-9_-]{1,30}$/.test(raw) && !prefs.invite) { prefs.invite = raw; prefsSave(); }
        u.searchParams.delete('i');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      }
    } catch (e) {}
  }

  // Otra pestaña con nprojects abierta cambió los datos: nos ponemos al día
  window.addEventListener('storage', e => {
    if (e.key === LS_KEY) { try { S = normalize(JSON.parse(e.newValue || 'null')); } catch (_) {} softRender(); }
  });

  // ---------- Supabase (solo inserción) ----------
  const sbOn = () => !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  function sbInsert(table, row, keepalive) {
    if (!sbOn()) return Promise.reject(new Error('sin configurar'));
    const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Prefer: 'return=minimal' };
    if (CFG.supabaseAnonKey.indexOf('sb_') !== 0) headers.Authorization = 'Bearer ' + CFG.supabaseAnonKey;
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + table, {
      method: 'POST', headers, body: JSON.stringify(row), keepalive: !!keepalive
    }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); });
  }

  // ---------- Medición de uso anónima ----------
  // Solo cuenta días de uso, cambios de proyecto, nº de proyectos y qué funciones se usan.
  // Nunca nombres de proyectos ni tiempos.
  let M = null;
  function mLoad() {
    try { M = JSON.parse(localStorage.getItem(LS_METRICS) || 'null'); } catch (e) {}
    if (!M || !M.anonId) M = { anonId: uuid() };
    if (M.day !== todayKey()) { mFlush(false); M.day = todayKey(); M.switches = 0; M.features = []; M.sent = ''; }
    mSave();
  }
  function mSave() { try { localStorage.setItem(LS_METRICS, JSON.stringify(M)); } catch (e) {} }
  function track(feature) {
    if (!M) return;
    try { const fresh = JSON.parse(localStorage.getItem(LS_METRICS) || 'null'); if (fresh && fresh.anonId === M.anonId && fresh.day === M.day) M = fresh; } catch (e) {}
    if (M.day !== todayKey()) mLoad();
    if (feature === 'switch') M.switches = (M.switches || 0) + 1;
    else if (M.features.indexOf(feature) < 0) M.features.push(feature);
    mSave();
  }
  function mFlush(keepalive) {
    if (!M || !M.day || !prefs.stats || !sbOn()) return;
    const row = { anon_id: M.anonId, day: M.day, switches: M.switches || 0, projects: live().length, features: (M.features || []).slice(0, 30), app_version: APP_VERSION, invite: prefs.invite || null };
    const sig = JSON.stringify(row);
    if (sig === M.sent) return;
    M.sent = sig; mSave();
    sbInsert('usage_daily', row, keepalive).catch(() => { M.sent = ''; mSave(); });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') mFlush(true); });

  // ---------- Acciones principales ----------
  // Cierra el tramo en curso en `end` y deja `next` como nuevo tramo activo (o pausa)
  function closeActive(end, next = null) {
    const a = S.active;
    if (a) {
      end = Math.max(end, a.s);
      split(a.p, a.s, end).filter(x => x.seg.e - x.seg.s >= 1000).forEach(x => day(x.key).push(x.seg));
      for (const k in S.days) S.days[k].sort((x, y) => x.s - y.s);
    }
    S.active = next;
    save();
  }
  function switchTo(pid) {
    if (busy) return; busy = true;
    try {
      const now = Date.now();
      const same = S.active && S.active.p === pid;
      closeActive(now, (!same && pid) ? { p: pid, s: now } : null);
      track(!same && pid ? 'switch' : 'pause');
      render();
    } finally { busy = false; }
  }
  const pause = () => S.active && switchTo(null);

  // ---------- Ventana ajustada al contenido (solo como app instalada) ----------
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: window-controls-overlay)').matches;
  let fitSig = '';
  function fitWindow(force) {
    if (!prefs.fit || pipWin || !standalone() || typeof window.resizeTo !== 'function') return;
    requestAnimationFrame(() => {
      const w = (prefs.compact && view === 'main') ? 320 : 420;
      app.style.minHeight = '0';
      const h = Math.ceil(app.getBoundingClientRect().height);
      const sig = w + 'x' + h;
      if (!force && sig === fitSig) return;
      fitSig = sig;
      const frameW = Math.max(0, window.outerWidth - window.innerWidth);
      const frameH = Math.max(0, window.outerHeight - window.innerHeight);
      const maxH = (screen.availHeight || 900) - 20;
      try { window.resizeTo(w + frameW, Math.min(h + frameH, maxH)); } catch (e) {}
    });
  }

  // ---------- Pintado ----------
  function render() {
    renderBanner();
    const v = $('#view');
    v.innerHTML = ({ main: mainHTML, summary: summaryHTML, segments: segmentsHTML, projects: projectsHTML, settings: settingsHTML, feedback: feedbackHTML }[view] || mainHTML)();
    app.classList.toggle('compact', !!prefs.compact && view === 'main');
    tick();
    fitWindow(false);
  }
  function softRender() {
    const a = (pipWin ? pipWin.document : document).activeElement;
    if (a && app.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
    render();
  }

  const ICON_PAUSE = '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1" width="2.5" height="8" rx=".6"/><rect x="6" y="1" width="2.5" height="8" rx=".6"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>';
  const ICON_GROW = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 4.2V1h3.2M9 5.8V9H5.8M1 1l3 3M9 9 6 6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const ICON_SHRINK = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M4 1v3H1M6 9V6h3M1 1l3 3M9 9 6 6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const LOGO = '<svg width="18" height="18" viewBox="0 0 28 28" aria-hidden="true"><circle cx="8" cy="18" r="5" fill="#2F6BFF"/><circle cx="20" cy="18" r="5" fill="#C2410C"/><circle cx="14" cy="8" r="5" fill="#1F9D55"/></svg>';

  function mainHTML() {
    const ps = live();
    const a = S.active;
    const top = `
      <div class="topbar">
        <a class="logo" href="../" title="Web de nprojects">${LOGO}nprojects <span class="beta">beta</span></a>
        ${installEvt && !standalone() ? '<button class="install" data-act="install">Instalar app</button>' : ''}
      </div>`;
    const head = `
      <section class="cur ${a ? '' : 'paused'}" style="--c:${a ? pcolor(a.p) : 'var(--line)'}">
        <div class="cur-name">${a ? `<span class="live-dot"></span>${esc(pname(a.p))}` : '<span class="state">En pausa</span>'}</div>
        <div class="cur-time num" id="curTotal">00:00:00</div>
        <div class="ctrls">
          ${pipWin ? `<button class="ico" data-act="pipsize" title="${prefs.pipBig ? 'Vista compacta' : 'Vista amplia'}" aria-label="${prefs.pipBig ? 'Vista compacta' : 'Vista amplia'}">${prefs.pipBig ? ICON_SHRINK : ICON_GROW}</button>` : ''}
          <button class="ico" data-act="pause" ${a ? '' : 'disabled'} title="Pausa" aria-label="Pausa">${ICON_PAUSE}</button>
          <button class="ico stop" data-act="end" title="Terminar jornada" aria-label="Terminar jornada">${ICON_STOP}</button>
        </div>
        <div class="cur-sub num">${a ? `Este tramo <span id="curSeg"></span> · ` : ''}Hoy en total <span id="dayTotal"></span></div>
      </section>`;
    if (!ps.length) {
      return top + head + `
        <div class="empty">
          <div><strong>Empieza añadiendo tus proyectos</strong><br><span class="muted small">Hasta ${MAX}. Luego, un clic en uno para empezar a contar.</span></div>
          <form class="addrow" data-form="add"><input name="name" placeholder="Nombre del proyecto" maxlength="40" autocomplete="off" aria-label="Nombre del proyecto"><button class="primary">Añadir</button></form>
          <p class="welcome">Tus datos se guardan solo en este navegador. Puedes cerrar la pestaña cuando quieras: el contador sigue contando y lo verás al volver.</p>
        </div>
      <nav class="links">
        <button data-act="go" data-v="settings">Ajustes</button>
        <button data-act="go" data-v="feedback">Comentarios</button>
      </nav>`;
    }
    const btns = ps.map((p, i) => `
      <button class="pbtn ${a && a.p === p.id ? 'on' : ''}" data-act="switch" data-pid="${p.id}" style="--c:${p.color}" title="${a && a.p === p.id ? 'Clic para pausar' : 'Clic para empezar a contar'}">
        <span class="dot"></span>
        <span class="pname">${esc(p.name)}</span><span class="ptime num" data-ptime="${p.id}"></span>
      </button>`).join('');
    const pipOk = 'documentPictureInPicture' in window && !pipWin;
    return top + head + `
      <div class="grid">${btns}</div>
      <div class="actions">
        <button data-act="pause" ${a ? '' : 'disabled'}>Pausa</button>
        <button class="primary" data-act="end">Terminar jornada</button>
      </div>
      <div class="hint">Clic en un proyecto para cambiar · clic en el activo para pausar</div>
      <nav class="links">
        <button data-act="go" data-v="summary">Resumen</button>
        <button data-act="go" data-v="segments">Tramos</button>
        <button data-act="go" data-v="projects">Proyectos</button>
        <button data-act="compact">${prefs.compact ? 'Vista normal' : 'Compacto'}</button>
        ${pipOk ? '<button data-act="pip">Ventana flotante</button>' : ''}
        <button data-act="go" data-v="settings">Ajustes</button>
        <button data-act="go" data-v="feedback">Comentarios</button>
      </nav>`;
  }

  function backHead(title) { return `<div class="bar-head"><button data-act="back">‹ Volver</button><h2>${title}</h2></div>`; }
  function dayHeader(title) {
    const k = viewDate;
    return backHead(title) + `
      <div class="datenav"><button data-act="prev" aria-label="Día anterior">‹</button><span>${esc(dateLabel(k))}</span>
        <button data-act="next" aria-label="Día siguiente" ${k >= todayKey() ? 'disabled' : ''}>›</button></div>`;
  }

  function summaryHTML() {
    const k = viewDate;
    const { t, sum } = totals(k);
    const ids = Object.keys(t).sort((a, b) => t[b] - t[a]);
    if (!sum) return dayHeader('Resumen') + '<div class="panel muted">Sin tiempo registrado este día.</div>';
    const max = Math.max(...ids.map(id => t[id]));
    const rows = ids.map(id => `
      <div class="row" style="--c:${pcolor(id)}"><span class="dot"></span><span>${esc(pname(id))}</span>
        <span class="num">${hm(t[id])}</span><span class="pct num">${Math.round(t[id] / sum * 100)}%</span>
        <div class="bar"><i style="width:${(t[id] / max * 100).toFixed(1)}%"></i></div></div>`).join('');
    const segs = (S.days[k] || []).slice();
    if (S.active) split(S.active.p, S.active.s, Date.now()).forEach(x => x.key === k && segs.push(x.seg));
    const t0 = Math.min(...segs.map(g => g.s)), t1 = Math.max(...segs.map(g => g.e)), span = Math.max(1, t1 - t0);
    const tl = segs.map(g => `<i style="--c:${pcolor(g.p)};left:${((g.s - t0) / span * 100).toFixed(2)}%;width:${Math.max(.3, (g.e - g.s) / span * 100).toFixed(2)}%" title="${esc(pname(g.p))} ${clock(g.s)}–${clock(g.e)}"></i>`).join('');
    return dayHeader('Resumen') + `
      <div class="panel">
        <div><div class="muted small">Total del día</div><div class="total num">${hm(sum)}</div></div>
        ${rows}
      </div>
      <div class="panel">
        <div class="muted small">Cómo se repartió el día</div>
        <div class="timeline">${tl}</div>
        <div class="tl-labels num"><span>${clock(t0)}</span><span>${clock(t1)}</span></div>
      </div>
      <div class="btnrow"><button data-act="copy" data-what="text">Copiar resumen</button><button data-act="copy" data-what="csv">Copiar CSV</button></div>
      ${copyText ? `<textarea class="copybox" readonly aria-label="Texto para copiar">${esc(copyText)}</textarea>` : ''}`;
  }

  function segmentsHTML() {
    const k = viewDate;
    const list = S.days[k] || [];
    const opts = sel => S.projects.filter(p => !p.archived || p.id === sel)
      .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')
      + (proj(sel) ? '' : `<option selected>(eliminado)</option>`);
    const rows = list.map((g, i) => `
      <div class="seg">
        <select data-edit="p" data-i="${i}" aria-label="Proyecto">${opts(g.p)}</select>
        <input type="time" data-edit="s" data-i="${i}" value="${clock(g.s)}" aria-label="Inicio">
        <input type="time" data-edit="e" data-i="${i}" value="${clock(g.e)}" aria-label="Fin">
        <button class="x" data-act="delseg" data-i="${i}" aria-label="Borrar tramo">×</button>
      </div>`).join('');
    const a = S.active;
    const running = a && dk(a.s) === k ? `
      <div class="seg">
        <select disabled aria-label="Proyecto en curso"><option>${esc(pname(a.p))}</option></select>
        <input type="time" data-edit="as" value="${clock(a.s)}" aria-label="Inicio del tramo en curso">
        <span class="running">en curso</span><span></span>
      </div>` : '';
    return dayHeader('Tramos') + `
      <div class="panel">
        <div class="seg seg-head"><span>Proyecto</span><span>Inicio</span><span>Fin</span><span></span></div>
        ${rows || (running ? '' : '<div class="muted">No hay tramos este día.</div>')}
        ${running}
        <button data-act="addseg" ${live().length ? '' : 'disabled'}>+ Añadir tramo a mano</button>
      </div>
      <div class="hint">Corrige aquí los olvidos: cambia horas, proyecto o borra tramos.</div>`;
  }

  function projectsHTML() {
    const ps = live(), arch = S.projects.filter(p => p.archived);
    const rows = ps.map(p => `
      <div class="prow">
        <button class="swatch" style="--c:${p.color}" data-act="color" data-pid="${p.id}" aria-label="Cambiar color de ${esc(p.name)}"></button>
        <input value="${esc(p.name)}" data-edit="name" data-pid="${p.id}" maxlength="40" aria-label="Nombre del proyecto">
        <button data-act="archive" data-pid="${p.id}">Quitar</button>
      </div>`).join('');
    const archRows = arch.length ? `
      <div class="panel"><div class="muted small">Proyectos quitados (su historial se conserva)</div>
        ${arch.map(p => `<div class="prow"><span class="swatch" style="--c:${p.color};opacity:.5"></span><span class="muted">${esc(p.name)}</span>
          <button data-act="restore" data-pid="${p.id}" ${ps.length >= MAX ? 'disabled' : ''}>Recuperar</button></div>`).join('')}
      </div>` : '';
    return backHead(`Proyectos (${ps.length}/${MAX})`) + `
      <div class="panel">
        ${rows || '<div class="muted">Aún no hay proyectos.</div>'}
        ${ps.length < MAX ? `<form class="addrow" data-form="add"><input name="name" placeholder="Nuevo proyecto" maxlength="40" autocomplete="off" aria-label="Nuevo proyecto"><button class="primary">Añadir</button></form>`
          : `<div class="muted small">Has llegado al máximo de ${MAX}. Quita uno para añadir otro.</div>`}
      </div>
      ${archRows}`;
  }

  function settingsHTML() {
    return backHead('Ajustes') + `
      <div class="panel">
        <h3>Tus datos</h3>
        <p class="small muted">Se guardan solo en este navegador. Haz una copia de vez en cuando: si borras los datos del navegador, se pierden. También te servirá para pasarlos a la app de escritorio.</p>
        <div class="btnrow">
          <button data-act="export">Descargar copia</button>
          <button data-act="import">Importar copia</button>
        </div>
        <input type="file" accept="application/json,.json" class="file-hidden" id="importFile">
      </div>
      <div class="panel">
        <h3>Estadísticas anónimas</h3>
        <label class="check"><input type="checkbox" data-pref="stats" ${prefs.stats ? 'checked' : ''}>
          <span>Compartir estadísticas anónimas de uso para mejorar la beta. Solo se envía qué días usas nprojects, cuántas veces cambias de proyecto, cuántos proyectos tienes, qué funciones usas y, si entraste con un enlace de invitación, su código de grupo. Nunca los nombres de tus proyectos ni tus tiempos.</span></label>
      </div>
      ${!standalone() ? `<div class="panel">
        <h3>Instalar como app</h3>
        ${installEvt ? `<p class="small muted">Tendrás nprojects con su icono y su propia ventana, sin pestañas del navegador.</p><button class="primary" data-act="install">Instalar nprojects</button>`
          : isSafari() ? `<p class="small muted">En Safari: menú Archivo → «Añadir al Dock». Ojo: Safari no permite la ventana flotante; para usarla, abre nprojects en Chrome o Edge.</p>`
          : `<p class="small muted">En Chrome o Edge: menú ⋮ → «Enviar, guardar y compartir» → «Instalar página como aplicación». Si ya la tienes instalada, ábrela desde su icono.</p>`}
      </div>` : ''}
      ${standalone() ? `<div class="panel">
        <h3>Ventana</h3>
        <label class="check"><input type="checkbox" data-pref="fit" ${prefs.fit ? 'checked' : ''}>
          <span>Ajustar el tamaño de la ventana al contenido automáticamente.</span></label>
      </div>` : ''}
      <div class="panel">
        <h3>Borrar todo</h3>
        <p class="small muted">Elimina proyectos, tramos e historial de este navegador. No se puede deshacer.</p>
        <button class="danger" data-act="wipe">Borrar todos los datos</button>
      </div>
      <div class="hint">nprojects ${APP_VERSION} · beta gratuita</div>`;
  }

  function feedbackHTML() {
    if (feedbackSent) return backHead('Comentarios') + `<div class="ok-msg">¡Gracias! Lo leemos todo.</div><button data-act="fb-again">Enviar otro comentario</button>`;
    return backHead('Comentarios') + `
      <form class="panel" data-form="feedback">
        <p class="small muted">¿Qué te falta, qué te sobra, qué te molesta? Cualquier comentario nos ayuda a mejorar la beta.</p>
        <div class="field"><label class="lbl" for="fb-msg">Tu comentario</label><textarea id="fb-msg" name="message" maxlength="4000" required></textarea></div>
        <div class="field"><label class="lbl" for="fb-email">Tu email (opcional, si quieres respuesta)</label><input id="fb-email" name="email" type="email" maxlength="254" autocomplete="email"></div>
        <button class="primary" type="submit">Enviar</button>
      </form>`;
  }

  // Aviso de contador olvidado (sigue en marcha desde otro día o más de 10 h)
  function renderBanner() {
    const b = $('#banner'); const a = S.active;
    const forgot = a && dismissedForgot !== a.s && (dk(a.s) !== todayKey() || Date.now() - a.s > 10 * 3600e3);
    if (!forgot) { b.innerHTML = ''; b.dataset.for = ''; return; }
    if (b.dataset.for === String(a.s) && b.innerHTML) return;
    const when = dk(a.s) === todayKey() ? 'hoy a las ' + clock(a.s) : dateLabel(dk(a.s)).toLowerCase() + ' a las ' + clock(a.s);
    b.dataset.for = String(a.s);
    b.innerHTML = `
      <div class="banner">
        <div>El contador de <strong>${esc(pname(a.p))}</strong> sigue en marcha desde ${esc(when)}. ¿A qué hora paraste de verdad?</div>
        <form class="btnrow" data-form="forgot"><input type="time" name="t" value="${clock(Math.min(Date.now(), a.s + 3600e3))}" required aria-label="Hora a la que paraste">
          <button class="primary">Guardar</button><button type="button" data-act="keep">Sigo con él</button></form>
      </div>`;
  }

  // Actualiza solo los números, cada segundo
  let lastDay = todayKey();
  function tick() {
    const k = todayKey();
    if (k !== lastDay) { lastDay = k; mLoad(); render(); return; }
    const { t, sum } = totals(k);
    const a = S.active;
    const ct = $('#curTotal'); if (ct) ct.textContent = hms(a ? (t[a.p] || 0) : sum);
    const cs = $('#curSeg'); if (cs && a) cs.textContent = hms(Date.now() - a.s);
    const dt = $('#dayTotal'); if (dt) dt.textContent = hm(sum);
    app.querySelectorAll('[data-ptime]').forEach(el => el.textContent = hms(t[el.dataset.ptime] || 0));
    document.title = a ? `● ${hms(t[a.p] || 0)} · ${pname(a.p)}` : 'nprojects · beta';
  }

  // ---------- Copiar y exportar ----------
  function buildCopy(what) {
    const k = viewDate, { t, sum } = totals(k);
    const fecha = keyToDate(k).toLocaleDateString('es-ES');
    if (what === 'text') {
      const ids = Object.keys(t).sort((a, b) => t[b] - t[a]);
      return `Resumen ${fecha}\n` + ids.map(id => `${pname(id)}: ${hm(t[id])} (${Math.round(t[id] / sum * 100)}%)`).join('\n') + `\nTotal: ${hm(sum)}`;
    }
    const segs = (S.days[k] || []).slice();
    if (S.active) split(S.active.p, S.active.s, Date.now()).forEach(x => x.key === k && segs.push(x.seg));
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    return 'fecha,proyecto,inicio,fin,minutos\n' + segs.map(g => [k, q(pname(g.p)), clock(g.s), clock(g.e), Math.round((g.e - g.s) / 60000)].join(',')).join('\n');
  }
  async function doCopy(what) {
    const txt = buildCopy(what);
    track(what === 'text' ? 'copy_text' : 'copy_csv');
    try { await navigator.clipboard.writeText(txt); copyText = null; toast('Copiado'); render(); }
    catch (e) { copyText = txt; render(); toast('Selecciona el texto de abajo y cópialo'); }
  }
  function doExport() {
    const data = { app: 'nprojects', format: 1, exportedAt: new Date().toISOString(), data: S };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nprojects-copia-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    track('export'); toast('Copia descargada');
  }
  function doImport(file) {
    const r = new FileReader();
    r.onload = () => {
      let o; try { o = JSON.parse(r.result); } catch (e) { return toast('Ese archivo no es una copia de nprojects.'); }
      const d = normalize(o && (o.app === 'nprojects' || o.app === 'malabar') ? o.data : null);
      if (!d.projects.length) return toast('Ese archivo no es una copia de nprojects.');
      if (!confirm('Esto sustituye todos los datos de este navegador por los de la copia. ¿Continuar?')) return;
      S = d; save(); track('import'); view = 'main'; render(); toast('Copia importada');
    };
    r.readAsText(file);
  }

  // ---------- Ventana flotante (Chrome / Edge) ----------
  // Tamaño de la ventana flotante: compacta o amplia
  const pipSize = big => { const n = Math.max(1, live().length); return big ? { width: 320, height: 100 + n * 42 } : { width: 270, height: 50 + n * 27 }; };
  const pipNote = document.getElementById('pipnote');
  function fitPip() {
    if (!pipWin) return;
    requestAnimationFrame(() => {
      const w = pipSize(prefs.pipBig).width;
      const h = Math.ceil(app.getBoundingClientRect().height);
      try { pipWin.resizeTo(w + (pipWin.outerWidth - pipWin.innerWidth), h + (pipWin.outerHeight - pipWin.innerHeight)); } catch (e) {}
    });
  }
  async function openPip() {
    try {
      const w = await window.documentPictureInPicture.requestWindow(pipSize(prefs.pipBig));
      view = 'main';
      [...document.styleSheets].forEach(ss => {
        try { const st = w.document.createElement('style'); st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n'); w.document.head.appendChild(st); }
        catch (e) { if (ss.href) { const l = w.document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; w.document.head.appendChild(l); } }
      });
      w.document.title = 'nprojects';
      w.document.body.appendChild(app);
      app.classList.add('in-pip');
      app.classList.toggle('pip-big', !!prefs.pipBig);
      if (pipNote) pipNote.hidden = false;
      w.document.addEventListener('keydown', onKey);
      pipWin = w;
      track('pip');
      w.addEventListener('pagehide', () => { document.body.insertBefore(app, document.body.firstChild); app.classList.remove('in-pip', 'pip-big'); if (pipNote) pipNote.hidden = true; pipWin = null; render(); });
      render();
    } catch (e) { toast('Tu navegador no permite abrir la ventana flotante.'); }
  }

  let toastT;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }

  const pipBack = document.getElementById('pipback');
  if (pipBack) pipBack.addEventListener('click', () => { if (pipWin) pipWin.close(); });

  // ---------- Eventos ----------
  app.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
    const act = b.dataset.act, pid = b.dataset.pid;
    if (act === 'switch') return switchTo(pid);
    if (act === 'pause') return pause();
    if (act === 'end') {
      if (S.active) closeActive(Date.now(), null);
      track('end_day'); view = 'summary'; viewDate = todayKey(); copyText = null;
      if (pipWin) { pipWin.close(); return; }
      return render();
    }
    if (act === 'go') { view = b.dataset.v; viewDate = todayKey(); copyText = null; if (view !== 'feedback') track(view); return render(); }
    if (act === 'back') { view = 'main'; return render(); }
    if (act === 'prev') { viewDate = shiftKey(viewDate, -1); copyText = null; return render(); }
    if (act === 'next') { viewDate = shiftKey(viewDate, 1); copyText = null; return render(); }
    if (act === 'compact') { prefs.compact = !prefs.compact; prefsSave(); if (prefs.compact) track('compact'); return render(); }
    if (act === 'pip') return openPip();
    if (act === 'pipsize') { prefs.pipBig = !prefs.pipBig; prefsSave(); app.classList.toggle('pip-big', prefs.pipBig); track(prefs.pipBig ? 'pip_big' : 'pip_small'); render(); return fitPip(); }
    if (act === 'copy') return doCopy(b.dataset.what);
    if (act === 'keep') { dismissedForgot = S.active && S.active.s; return render(); }
    if (act === 'color') { const p = proj(pid); p.color = PALETTE[(PALETTE.indexOf(p.color) + 1) % PALETTE.length]; save(); return render(); }
    if (act === 'archive') {
      if (S.active && S.active.p === pid) closeActive(Date.now(), null);
      proj(pid).archived = true; save(); return render();
    }
    if (act === 'restore') { if (live().length < MAX) { delete proj(pid).archived; save(); } return render(); }
    if (act === 'delseg') { day(viewDate).splice(+b.dataset.i, 1); save(); track('segments_edit'); return render(); }
    if (act === 'addseg') {
      const k = viewDate, list = day(k);
      let s = list.length ? list[list.length - 1].e : timeOn(k, '09:00');
      if (S.active && dk(S.active.s) === k) s = Math.min(s, S.active.s - 30 * 60e3);
      const e = Math.min(s + 30 * 60e3, nextMidnight(s) - 60e3);
      list.push({ p: live()[0].id, s, e }); list.sort((a, b) => a.s - b.s); save(); track('segment_add'); return render();
    }
    if (act === 'export') return doExport();
    if (act === 'import') { const f = $('#importFile'); f.value = ''; f.click(); return; }
    if (act === 'wipe') {
      if (!confirm('¿Seguro? Se borrarán todos tus proyectos y su historial de este navegador.')) return;
      S = { projects: [], active: null, days: {} }; save(); view = 'main'; render(); toast('Datos borrados'); return;
    }
    if (act === 'fb-again') { feedbackSent = false; return render(); }
    if (act === 'install') return doInstall();
  });

  app.addEventListener('submit', ev => {
    ev.preventDefault();
    const f = ev.target;
    if (f.dataset.form === 'add') {
      const name = f.name.value.trim(); if (!name) return;
      if (live().length >= MAX) return toast(`Máximo ${MAX} proyectos`);
      const used = new Set(live().map(p => p.color));
      S.projects.push({ id: newId(), name, color: PALETTE.find(c => !used.has(c)) || PALETTE[S.projects.length % PALETTE.length] });
      save(); track('project_add'); render();
      const inp = $('form[data-form="add"] input'); if (inp) inp.focus();
    }
    if (f.dataset.form === 'forgot' && S.active) {
      let end = timeOn(dk(S.active.s), f.t.value);
      if (end <= S.active.s) end += 86400e3;
      end = Math.min(end, Date.now());
      closeActive(end, null); track('forgot_fix'); render(); toast('Guardado. El contador queda en pausa.');
    }
    if (f.dataset.form === 'feedback') {
      const message = f.message.value.trim(), email = f.email.value.trim();
      if (!message) return toast('Escribe tu comentario');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast('Revisa el email');
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      sbInsert('feedback', { anon_id: M ? M.anonId : null, message: message.slice(0, 4000), email: email || null, app_version: APP_VERSION, invite: prefs.invite || null })
        .then(() => { feedbackSent = true; render(); })
        .catch(() => { btn.disabled = false; toast('No se pudo enviar. Inténtalo de nuevo.'); });
    }
  });

  app.addEventListener('change', ev => {
    const el = ev.target;
    if (el.id === 'importFile') { if (el.files && el.files[0]) doImport(el.files[0]); return; }
    if (el.dataset.pref === 'fit') { prefs.fit = el.checked; prefsSave(); if (el.checked) fitWindow(true); return; }
    if (el.dataset.pref === 'stats') { prefs.stats = el.checked; prefsSave(); toast(el.checked ? 'Gracias por ayudarnos' : 'No se enviarán estadísticas'); return; }
    const f = el.dataset.edit; if (!f) return;
    if (f === 'name') { const p = proj(el.dataset.pid), v = el.value.trim(); if (p && v) { p.name = v; save(); } else if (p) el.value = p.name; return; }
    const k = viewDate;
    if (f === 'as' && S.active) {
      const s = timeOn(k, el.value);
      if (s > Date.now()) { toast('El inicio no puede ser futuro'); return render(); }
      const prevEnd = Math.max(0, ...(S.days[k] || []).map(g => g.e).filter(e => e <= S.active.s));
      S.active.s = Math.max(s, prevEnd); save(); track('segments_edit'); return render();
    }
    const g = (S.days[k] || [])[+el.dataset.i]; if (!g) return;
    if (f === 'p') g.p = el.value;
    else {
      let v = timeOn(k, el.value);
      if (f === 'e' && el.value === '00:00') v = nextMidnight(timeOn(k, '00:00'));
      const s = f === 's' ? v : g.s, e = f === 'e' ? v : g.e;
      if (e <= s) { toast('La hora de fin debe ser posterior al inicio'); return render(); }
      g.s = s; g.e = e; S.days[k].sort((a, b) => a.s - b.s);
    }
    save(); track('segments_edit'); render();
  });

  function onKey(ev) {
    const t = ev.target;
    if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || view !== 'main') return;
    if (ev.key === ' ') { ev.preventDefault(); pause(); return; }
    if (/^[0-9]$/.test(ev.key)) {
      const i = ev.key === '0' ? 9 : +ev.key - 1;
      const p = live()[i]; if (p) { ev.preventDefault(); switchTo(p.id); }
    }
  }
  document.addEventListener('keydown', onKey);

  // ---------- Instalar como app ----------
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; softRender(); });
  window.addEventListener('appinstalled', () => { installEvt = null; track('installed'); toast('nprojects instalada. Ya la tienes como app.'); softRender(); });
  async function doInstall() {
    if (!installEvt) return;
    const e = installEvt; installEvt = null;
    try { await e.prompt(); const r = await e.userChoice; if (r && r.outcome !== 'accepted') installEvt = e; } catch (_) {}
    render();
  }
  const isSafari = () => /^((?!chrome|chromium|android|edg).)*safari/i.test(navigator.userAgent);

  // ---------- Arranque ----------
  load();
  readInvite();
  mLoad();
  if (standalone()) track('standalone');
  render();
  setInterval(tick, 1000);
  setInterval(() => mFlush(false), 30 * 60e3);
})();
