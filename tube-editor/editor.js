/* TUBE visuaalne redaktor (v2)
 *
 * Laaditakse index.html-ist ainult ?edit=1 korral.
 * Muudetavad elemendid on HTML-is märgitud atribuudiga data-tube-id. Need ID-d on
 * külmutatud (sama nimi, mida vana redaktor kasutas), et varasemad mustandid ja
 * pilvemustandid jääksid kehtima. Uuele muudetavale elemendile lisa lihtsalt
 * unikaalne data-tube-id.
 *
 * Mustandi vorming on endine: { text:{id:string}, images:{id:url}, comments:{id:[string]} }
 * (+ valikuline meta). Kohalik koopia: localStorage 'tube-editor-draft-v1'.
 */

const KEY = 'tube-editor-draft-v1';
const VERSION_KEY = 'tube-cloud-base-version-v1';
const BASE_KEY = 'tube-cloud-base-content-v2';
const DIRTY_KEY = 'tube-cloud-dirty-v2';
const EMAIL_KEY = 'tube-editor-email';
const FILTER_KEY = 'tube-editor-filter';
const HINT_KEY = 'tube-editor-hint-dismissed';
const SUPABASE_URL = 'https://xlhtavzsanlikmxrddrb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_qIgkHTONrtkXj1CjDUofWw_erFDQGo3';
const DRAFT_ROW = 'tube-main';
const EMAIL_DOMAIN = '@sportsport.ee';
const CLOUD_AUTOSAVE_MS = 4000;

const coarse = matchMedia('(pointer:coarse)').matches;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Mac');
const MOD = isMac ? '⌘' : 'Ctrl';

/* ------------------------------------------------------------------ helpers */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const ICONS = {
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  library: '<rect x="7" y="3" width="14" height="14" rx="2"/><path d="M17 21H5a2 2 0 0 1-2-2V7"/><path d="m21 13-4-4-6 6"/>',
  notes: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 7 19z"/>',
  publish: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="m5 12 5 5L20 7"/>', logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', key: '<rect x="2" y="7" width="20" height="12" rx="2"/><path d="M6 11h.01M10 11h.01M14 11h.01M18 11h.01M7 15h10"/>',
};
const icon = name => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name]; return s; };
const btn = (label, iconName, attrs = {}, showLabel = true) =>
  h('button', { type: 'button', class: 'te-btn', title: label, 'aria-label': label, ...attrs }, iconName && icon(iconName), showLabel && h('span', { class: 'te-lbl' }, label));
const add = (el, ...kids) => { el.append(...kids.flat().filter(k => k != null && k !== false)); return el; };
const clone = o => JSON.parse(JSON.stringify(o));
const emptyDraft = () => ({ text: {}, images: {}, comments: {} });
function normalize(d) {
  const out = emptyDraft();
  if (d && typeof d === 'object') {
    for (const k of ['text', 'images', 'comments']) if (d[k] && typeof d[k] === 'object') out[k] = { ...d[k] };
    if (d.meta && typeof d.meta === 'object') out.meta = { ...d.meta };
  }
  return out;
}
const isEmptyDraft = d => !Object.keys(d.text).length && !Object.keys(d.images).length && !Object.values(d.comments).some(a => a?.length);
const sameDraft = (a, b) => JSON.stringify(stripMeta(a)) === JSON.stringify(stripMeta(b));
function stripMeta(d) { const { text, images, comments } = normalize(d); const c = {}; for (const [k, v] of Object.entries(comments)) if (v?.length) c[k] = v; return { text: sortObj(text), images: sortObj(images), comments: sortObj(c) }; }
const sortObj = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const ls = {
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v == null ? fb : v; } catch { return fb; } },
  set(k, v) { localStorage.setItem(k, v); },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const fmtTime = iso => { try { return new Date(iso).toLocaleString('et-EE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
function downloadJSON(draft, name) {
  const blob = new Blob([JSON.stringify({ version: 1, source: location.pathname, exportedAt: new Date().toISOString(), changes: draft }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name || `TUBE-muudatused-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json` });
  (ui.root || document.body).append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* Teksti lugemine/kirjutamine nii, et <br> reavahetused säilivad. */
function readText(el) {
  let s = '';
  for (const n of el.childNodes) s += n.nodeType === 3 ? n.data : n.nodeName === 'BR' ? '\n' : n.nodeType === 1 ? readText(n) : '';
  return s;
}
function writeText(el, value) {
  const parts = String(value).split('\n');
  el.replaceChildren(...parts.flatMap((p, i) => (i ? [document.createElement('br'), p] : [p])));
}

/* ------------------------------------------------------------------ state */
let draft = normalize(safeParse(ls.get(KEY)));
const items = new Map(); // id -> { el, kind, original, label, section }
let selectedId = null;
let editing = null; // { id, start }
let filter = ls.get(FILTER_KEY, 'all');
let preview = false;
const undoStack = [], redoStack = [];
function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/* ------------------------------------------------------------------ element registry */
const SECTION_NAMES = { hero: 'Esileht', built: 'Valminud majad', story: 'Kliendilugu', position: 'Miks TUBE', models: 'Majad', process: 'Kuidas töötab', offer: 'Pakkumine', final: 'Lõpp' };
const FIXED_LABELS = {
  'hero-image': 'Suur esipilt', 'hero-title': 'Pealkiri', 'hero-subtitle': 'Alapealkiri', 'hero-body': 'Sissejuhatus',
  'nomme-image': 'Suur foto', 'proof-2': 'Foto 2', 'proof-3': 'Foto 3', 'proof-4': 'Foto 4', 'proof-5': 'Foto 5',
  'story-image': 'Foto', 'promise-note': 'Lubaduse lisarida',
};
const TAG_LABELS = { H1: 'Pealkiri', H2: 'Pealkiri', H3: 'Alapealkiri', P: 'Tekstilõik', A: 'Link / nupp', BUTTON: 'Nupp', LABEL: 'Välja nimi', SMALL: 'Väike tekst', STRONG: 'Esiletõstetud tekst', B: 'Nimi', IMG: 'Foto' };
function sectionOf(el) {
  const s = el.closest('section');
  if (!s) return 'Leht';
  for (const c of s.classList) if (SECTION_NAMES[c]) return SECTION_NAMES[c];
  return SECTION_NAMES[s.id] || 'Leht';
}
function labelOf(id, el) {
  if (FIXED_LABELS[id]) return FIXED_LABELS[id];
  if (el.classList.contains('caption')) return 'Fotoallkiri';
  if (el.classList.contains('eyebrow')) return 'Väike pealkiri';
  const m = id.match(/^model-(\d)-(image|title)$/); if (m) return `TUBE 0${m[1]} ${m[2] === 'image' ? 'foto' : 'nimi'}`;
  const st = id.match(/^process-step-(\d)$/); if (st) return `Samm ${st[1]} kirjeldus`;
  if (id.endsWith('-title')) return 'Pealkiri';
  if (id.endsWith('-description')) return 'Kirjeldus';
  return TAG_LABELS[el.tagName] || 'Tekst';
}
function registerItems() {
  document.querySelectorAll('[data-tube-id]').forEach(el => {
    const id = el.dataset.tubeId;
    if (items.has(id)) { console.warn('TUBE redaktor: korduv data-tube-id', id); return; }
    const kind = el.tagName === 'IMG' ? 'image' : 'text';
    items.set(id, { el, kind, original: kind === 'image' ? el.getAttribute('src') : readText(el), label: labelOf(id, el), section: sectionOf(el) });
  });
}
function currentValue(id) { const it = items.get(id); return it.kind === 'image' ? it.el.getAttribute('src') : readText(it.el); }
function setValue(id, value) {
  const it = items.get(id); if (!it) return;
  if (it.kind === 'image') {
    if (it.el.getAttribute('src') !== value) it.el.setAttribute('src', value);
    it.el.removeAttribute('srcset');
    if (value === it.original) delete draft.images[id]; else draft.images[id] = value;
  } else {
    if (readText(it.el) !== value) writeText(it.el, value);
    if (value === it.original) delete draft.text[id]; else draft.text[id] = value;
  }
}
function applyDraftToDom() {
  for (const [id, it] of items) {
    const v = it.kind === 'image' ? draft.images[id] : draft.text[id];
    const target = v ?? it.original;
    if (it.kind === 'image') { if (it.el.getAttribute('src') !== target) it.el.setAttribute('src', target); }
    else if (readText(it.el) !== target) writeText(it.el, target);
  }
  refreshNoteMarks();
}
function refreshNoteMarks() {
  for (const [id, it] of items) it.el.classList.toggle('te-has-note', !!draft.comments[id]?.length);
  const n = Object.values(draft.comments).reduce((a, c) => a + (c?.length || 0), 0);
  ui.notesBadges.forEach(b => { b.textContent = n; b.hidden = !n; });
}
const changeCount = () => Object.keys(draft.text).length + Object.keys(draft.images).length;

/* ------------------------------------------------------------------ persistence (local) */
function persistLocal() {
  try { ls.set(KEY, JSON.stringify(draft)); return true; }
  catch (e) {
    toast('Seadme mälu on täis — mustandit ei saanud salvestada. Ekspordi muudatused failina.', { bad: true, action: ['Ekspordi', () => downloadJSON(draft)] });
    return false;
  }
}
function markChanged() {
  persistLocal();
  ls.set(DIRTY_KEY, '1');
  refreshNoteMarks();
  cloud.onLocalChange();
  updateHistoryButtons();
}

/* ------------------------------------------------------------------ history (undo/redo) */
function commit(op) {
  // op: { id, kind:'text'|'image'|'comments', before, after, label }
  if (JSON.stringify(op.before) === JSON.stringify(op.after)) return;
  undoStack.push(op); if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
  markChanged();
}
function applyOp(op, which) {
  const v = op[which];
  if (op.kind === 'comments') { if (v?.length) draft.comments[op.id] = clone(v); else delete draft.comments[op.id]; }
  else setValue(op.id, v);
}
function undo() {
  finishEditing();
  const op = undoStack.pop(); if (!op) return;
  applyOp(op, 'before'); redoStack.push(op); markChanged();
  select(op.id, { scroll: true, quiet: true });
  toast(`Tagasi võetud: ${op.label}`, { action: ['Taasta', redo], ms: 3500 });
}
function redo() {
  finishEditing();
  const op = redoStack.pop(); if (!op) return;
  applyOp(op, 'after'); undoStack.push(op); markChanged();
  select(op.id, { scroll: true, quiet: true });
}
function updateHistoryButtons() {
  ui.undo.disabled = !undoStack.length; ui.redo.disabled = !redoStack.length;
  ui.undo.title = undoStack.length ? `Võta tagasi: ${undoStack.at(-1).label} (${MOD}+Z)` : 'Võta tagasi';
  ui.redo.title = redoStack.length ? `Taasta: ${redoStack.at(-1).label} (${MOD}+Shift+Z)` : 'Taasta';
}

/* ------------------------------------------------------------------ UI skeleton */
const ui = {};
function buildUI() {
  const root = h('div', { id: 'teRoot' });

  // Toolbar
  ui.filterText = btn('Tekst', 'text', { 'aria-pressed': 'false', title: 'Näita ainult muudetavaid tekste' });
  ui.filterImage = btn('Foto', 'image', { 'aria-pressed': 'false', title: 'Näita ainult vahetatavaid fotosid' });
  ui.libraryBtn = btn('Fotopank', 'library', { class: 'te-btn te-hide-m' });
  ui.notesBtn = btn('Märkmed', 'notes', { class: 'te-btn te-hide-m' });
  const nb1 = h('span', { class: 'te-badge', hidden: true }); ui.notesBtn.append(nb1);
  ui.previewBtn = btn('Eelvaade', 'eye', { class: 'te-btn te-hide-m' });
  ui.undo = btn('Võta tagasi', 'undo', { class: 'te-btn te-undo' }, false);
  ui.redo = btn('Taasta', 'redo', { class: 'te-btn te-undo' }, false);
  ui.status = h('button', { type: 'button', class: 'te-status', 'data-state': 'local', 'aria-haspopup': 'dialog', title: 'Pilvesalvestus' }, h('span', { class: 'te-dot' }), h('span', { class: 'te-status-text' }, 'Salvestatud selles seadmes'));
  ui.saveBtn = btn('Salvesta mustand pilve', 'cloud', { class: 'te-btn te-outline te-hide-l', title: `Salvesta mustand pilve (${MOD}+S)` }, false);
  ui.publishBtn = btn('Avalda…', 'publish', { class: 'te-btn te-primary' });
  ui.moreBtn = btn('Veel', 'more', { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, false);
  ui.closeBtn = btn('Sulge redaktor', 'close', {}, false);

  ui.bar = h('header', { class: 'te-bar', role: 'toolbar', 'aria-label': 'TUBE redaktor' },
    h('div', { class: 'te-group te-left' }, h('div', { class: 'te-brand' }, h('b', {}, 'TUBE'), h('span', {}, 'Redaktor · Avaleht'))),
    h('div', { class: 'te-group te-center', role: 'group', 'aria-label': 'Muutmise tööriistad' }, ui.filterText, ui.filterImage, ui.libraryBtn, ui.notesBtn, ui.previewBtn),
    h('div', { class: 'te-group te-right' }, ui.undo, ui.redo, h('span', { class: 'te-sep te-hide-s' }), ui.status, ui.saveBtn, ui.publishBtn, ui.moreBtn, ui.closeBtn),
  );

  // "Veel" menu
  const nb2 = h('span', { class: 'te-badge', hidden: true });
  ui.notesBadges = [nb1, nb2];
  const item = (label, iconName, onclick, cls = '', extra) => h('button', { type: 'button', class: 'te-item ' + cls, role: 'menuitem', onclick: () => { closePops(); onclick(); } }, icon(iconName), label, extra);
  ui.menu = h('div', { class: 'te-pop', role: 'menu', hidden: true },
    item('Ainult tekstid', 'text', () => setFilter(filter === 'text' ? 'all' : 'text'), 'te-menu-only te-show-s'),
    item('Ainult fotod', 'image', () => setFilter(filter === 'image' ? 'all' : 'image'), 'te-menu-only te-show-s'),
    item('Fotopank', 'library', () => library.open(), 'te-menu-only te-show-m'),
    item('Märkmed', 'notes', () => notes.open(), 'te-menu-only te-show-m', nb2),
    item('Eelvaade', 'eye', () => setPreview(true), 'te-menu-only te-show-m'),
    item('Salvesta mustand pilve', 'cloud', () => cloud.save({ manual: true }), 'te-menu-only te-show-l', h('small', {}, `${MOD}+S`)),
    h('hr', { class: 'te-menu-only te-show-m' }),
    item('Ekspordi muudatused (JSON)', 'download', () => downloadJSON(draft)),
    item('Impordi muudatused…', 'upload', () => ui.importInput.click()),
    item('Laadi mustand pilvest', 'cloud', () => cloud.loadInteractive()),
    h('hr'),
    item('Kiirklahvid', 'key', () => showShortcuts()),
    item('Tühjenda selle seadme mustand…', 'trash', () => resetLocal(), 'te-danger'),
  );
  ui.importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: onImport });

  // Cloud popover
  ui.cloudPop = h('div', { class: 'te-pop', role: 'dialog', 'aria-label': 'Pilvesalvestus', hidden: true });

  // Context panel
  ui.panel = h('aside', { class: 'te-panel', hidden: true, 'aria-label': 'Valitud element' });

  // Hint
  ui.hint = h('div', { class: 'te-hintchip', hidden: true, role: 'note' },
    h('span', {}, coarse ? 'Puuduta teksti või fotot, et seda muuta.' : 'Klõpsa tekstil või fotol, et seda muuta.'),
    h('button', { type: 'button', class: 'te-btn', 'aria-label': 'Peida vihje', onclick: () => { ls.set(HINT_KEY, '1'); ui.hint.hidden = true; } }, icon('close')));

  ui.toasts = h('div', { class: 'te-toasts', 'aria-live': 'polite' });
  ui.previewPill = h('div', { class: 'te-preview-pill' }, 'Eelvaade', h('button', { type: 'button', class: 'te-btn', onclick: () => setPreview(false) }, 'Tagasi muutma'));

  root.append(ui.bar, ui.menu, ui.cloudPop, ui.panel, ui.hint, ui.toasts, ui.previewPill, ui.importInput);
  document.body.append(root);
  ui.root = root;

  // Wiring
  ui.filterText.onclick = () => setFilter(filter === 'text' ? 'all' : 'text');
  ui.filterImage.onclick = () => setFilter(filter === 'image' ? 'all' : 'image');
  ui.libraryBtn.onclick = () => library.open();
  ui.notesBtn.onclick = () => notes.open();
  ui.previewBtn.onclick = () => setPreview(true);
  ui.undo.onclick = undo; ui.redo.onclick = redo;
  ui.status.onclick = e => togglePop(ui.cloudPop, ui.status, cloud.renderPop);
  ui.saveBtn.onclick = () => cloud.save({ manual: true });
  ui.publishBtn.onclick = () => publish.open();
  ui.moreBtn.onclick = () => togglePop(ui.menu, ui.moreBtn);
  ui.closeBtn.onclick = exitEditor;
}

/* Popovers */
function togglePop(pop, anchor, render) {
  const open = pop.hidden;
  closePops();
  if (!open) return;
  render?.();
  pop.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.top = r.bottom + 6 + 'px';
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  pop.querySelector('input,button')?.focus({ preventScroll: true });
}
function closePops() {
  for (const p of [ui.menu, ui.cloudPop]) p.hidden = true;
  ui.moreBtn.setAttribute('aria-expanded', 'false');
}

/* Toasts */
function toast(msg, { action, bad, ms = 3200 } = {}) {
  const t = h('div', { class: 'te-toast' + (bad ? ' te-bad' : ''), role: bad ? 'alert' : 'status' }, h('span', {}, msg));
  if (action) t.append(h('button', { type: 'button', class: 'te-btn te-outline', onclick: () => { t.remove(); action[1](); } }, action[0]));
  for (const o of [...ui.toasts.children]) if (o.firstChild.textContent === msg) o.remove();
  ui.toasts.append(t);
  while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
  setTimeout(() => t.remove(), bad ? Math.max(ms, 7000) : ms);
}

/* Generic modal */
function modal({ title, body, actions = [], cls = '', onClose }) {
  const dlg = h('dialog', { class: 'te-dialog ' + cls, 'aria-label': title });
  const close = () => dlg.close();
  const foot = actions.length ? h('div', { class: 'te-dlg-foot' }, actions.map(([label, fn, kind]) =>
    h('button', { type: 'button', class: 'te-btn ' + (kind === 'primary' ? 'te-primary' : kind === 'danger' ? 'te-outline te-danger' : 'te-outline'), onclick: async () => { const keep = await fn?.(); if (keep !== true) close(); } }, label))) : null;
  add(dlg,
    h('div', { class: 'te-dlg-head' }, h('h3', {}, title), h('button', { type: 'button', class: 'te-btn', 'aria-label': 'Sulge', onclick: close }, icon('close'))),
    h('div', { class: 'te-dlg-body' }, body), foot);
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  ui.root.append(dlg);
  dlg.showModal();
  return dlg;
}
function confirmDialog(title, text, okLabel = 'Jätka', kind = 'primary') {
  return new Promise(resolve => {
    let ok = false;
    modal({ title, body: h('p', {}, text), actions: [['Tühista', () => {}], [okLabel, () => { ok = true; }, kind]], onClose: () => resolve(ok) });
  });
}

/* ------------------------------------------------------------------ filter & preview */
function setFilter(f) {
  filter = f; ls.set(FILTER_KEY, f);
  document.body.classList.toggle('te-filter-text', f === 'text');
  document.body.classList.toggle('te-filter-image', f === 'image');
  ui.filterText.setAttribute('aria-pressed', String(f === 'text'));
  ui.filterImage.setAttribute('aria-pressed', String(f === 'image'));
  if (selectedId && !allowed(items.get(selectedId))) deselect();
}
const allowed = it => it && (filter === 'all' || filter === it.kind);
function setPreview(on) {
  finishEditing(); closePops();
  preview = on;
  document.body.classList.toggle('te-preview', on);
  if (on) { deselect(); toast('Eelvaade: leht käitub nagu külastajale. Muutmiseks vajuta „Tagasi muutma”.'); }
  else updateHint();
}

/* ------------------------------------------------------------------ selection */
function select(id, { scroll = false, quiet = false, caretPoint = null } = {}) {
  const it = items.get(id); if (!it) return;
  if (selectedId !== id) {
    finishEditing();
    if (selectedId) items.get(selectedId)?.el.classList.remove('te-selected');
    selectedId = id;
    it.el.classList.add('te-selected');
  }
  renderPanel();
  if (it.kind === 'text' && !quiet) startEditing(id, caretPoint);
  if (scroll || sheetMode()) requestAnimationFrame(() => ensureVisible(it.el));
  updateHint();
}
function deselect() {
  finishEditing();
  if (selectedId) items.get(selectedId)?.el.classList.remove('te-selected');
  selectedId = null;
  ui.panel.hidden = true;
  document.body.classList.remove('te-sheet-open');
  document.documentElement.style.setProperty('--te-sheet-h', '0px');
  updateHint();
}
function updateHint() { ui.hint.hidden = !!selectedId || preview || ls.get(HINT_KEY) === '1'; }
function ensureVisible(el) {
  const r = el.getBoundingClientRect();
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--te-bar')) || 52;
  const sheet = sheetMode() ? ui.panel.offsetHeight : 0;
  const bottomLimit = innerHeight - sheet - 12;
  if (r.top < top + 12 || r.bottom > bottomLimit) {
    const target = r.top - top - Math.max(16, (bottomLimit - top - r.height) / 2);
    scrollBy({ top: target, behavior: 'smooth' });
  }
}
const sheetMode = () => innerWidth <= 1023;

/* ------------------------------------------------------------------ inline text editing */
const supportsPlainEdit = (() => { const d = document.createElement('div'); try { d.contentEditable = 'plaintext-only'; } catch { return false; } return d.contentEditable === 'plaintext-only'; })();
function startEditing(id, caretPoint) {
  if (editing?.id === id) return;
  finishEditing();
  const it = items.get(id);
  editing = { id, start: readText(it.el) };
  it.el.contentEditable = supportsPlainEdit ? 'plaintext-only' : 'true';
  it.el.spellcheck = true;
  it.el.classList.add('te-editing');
  it.el.addEventListener('keydown', onEditKey);
  it.el.addEventListener('input', onEditInput);
  it.el.addEventListener('blur', onEditBlur);
  if (!supportsPlainEdit) it.el.addEventListener('paste', onPastePlain);
  it.el.focus({ preventScroll: true });
  placeCaret(it.el, caretPoint);
  if (selectedId === id) renderPanel({ mainOnly: true });
  if (coarse && sheetMode()) ui.panel.classList.add('te-compact'), syncSheetHeight();
}
function placeCaret(el, pt) {
  const sel = getSelection(); let range = null;
  if (pt) {
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(pt.x, pt.y);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(pt.x, pt.y); if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); } }
    if (range && !el.contains(range.startContainer)) range = null;
  }
  if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
  sel.removeAllRanges(); sel.addRange(range);
}
let inputTimer;
function onEditInput() {
  clearTimeout(inputTimer);
  // Kirjuta mustandisse jooksvalt (ilma ajaloo kirjeta), et midagi ei kaoks ka siis, kui leht suletakse kirjutamise ajal.
  inputTimer = setTimeout(() => { if (!editing) return; const v = readText(items.get(editing.id).el); setValue(editing.id, v); persistLocal(); ls.set(DIRTY_KEY, '1'); cloud.onLocalChange(); }, 400);
}
function onEditKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEditing(); toast(`Salvestatud. Uus rida: Shift+Enter.`, { ms: 2200 }); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
}
function onEditBlur() { setTimeout(() => { if (editing && document.activeElement !== items.get(editing.id)?.el) finishEditing(); }, 0); }
function onPastePlain(e) { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); }
function teardownEditing(el) {
  el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck');
  el.classList.remove('te-editing');
  el.removeEventListener('keydown', onEditKey); el.removeEventListener('input', onEditInput); el.removeEventListener('blur', onEditBlur); el.removeEventListener('paste', onPastePlain);
  ui.panel.classList.remove('te-compact'); syncSheetHeight();
}
function finishEditing() {
  if (!editing) return;
  clearTimeout(inputTimer);
  const { id, start } = editing; editing = null;
  const it = items.get(id);
  teardownEditing(it.el);
  let v = readText(it.el).replace(/ /g, ' ');
  if (!v.trim()) { v = start; writeText(it.el, start); toast('Tühja teksti ei salvestatud.'); }
  // Puhasta brauseri lisatud lõpu-reavahetus
  v = v.replace(/\n+$/, '');
  if (readText(it.el) !== v) writeText(it.el, v);
  setValue(id, v);
  commit({ id, kind: 'text', before: start, after: v, label: `${it.label} (${it.section})` });
  persistLocal();
  if (selectedId === id) renderPanel({ mainOnly: true });
}
function cancelEditing() {
  if (!editing) return;
  const { id, start } = editing; editing = null;
  const it = items.get(id);
  teardownEditing(it.el);
  writeText(it.el, start); setValue(id, start); persistLocal();
  renderPanel({ mainOnly: true });
}

/* ------------------------------------------------------------------ page interaction (one place) */
function pickTarget(e) {
  let el = e.target.closest?.('[data-tube-id]');
  if (!el || !allowed(items.get(el.dataset.tubeId))) {
    // Elemendid võivad olla kattekihi all (nt esipilt gradiendi all): otsi punkti alt.
    el = null;
    if (e.clientX != null) for (const c of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (c.closest('#teRoot')) continue;
      const cand = c.closest('[data-tube-id]');
      if (cand && allowed(items.get(cand.dataset.tubeId))) { el = cand; break; }
    }
  }
  return el;
}
function onPageClick(e) {
  if (preview || !e.isTrusted) return; // programmilised klõpsud (nt allalaadimine) lasta läbi
  if (e.target.closest?.('#teRoot')) { if (!e.target.closest('.te-pop') && !e.target.closest('[aria-haspopup]')) closePops(); return; }
  // Redaktoris ei navigeeri lingid ega saadeta vorme: kõik klõpsud lähevad valimisele.
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  closePops();
  if (editing && items.get(editing.id).el.contains(e.target)) return; // kursori liigutamine teksti sees
  const el = pickTarget(e);
  if (!el) { deselect(); return; }
  select(el.dataset.tubeId, { caretPoint: { x: e.clientX, y: e.clientY } });
}
function blockPageEvent(e) {
  if (preview || e.target.closest?.('#teRoot')) return;
  if (e.type === 'submit') { e.preventDefault(); e.stopPropagation(); return; }
  if (e.type === 'keydown' && (e.key === 'Enter' || e.key === ' ') && !e.target.isContentEditable && e.target.closest?.('.model,a,button')) { e.preventDefault(); e.stopPropagation(); }
}
function onKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  const inField = e.target.closest?.('input,textarea,select') || e.target.isContentEditable;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); finishEditing(); cloud.save({ manual: true }); return; }
  if (mod && !inField && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && !inField && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Escape' && !inField && !document.querySelector('.te-dialog[open]')) {
    if (!ui.menu.hidden || !ui.cloudPop.hidden) closePops();
    else if (preview) setPreview(false);
    else deselect();
  }
}

/* ------------------------------------------------------------------ context panel */
function renderPanel({ mainOnly = false } = {}) {
  const it = items.get(selectedId); if (!it) return;
  const changed = it.kind === 'image' ? draft.images[selectedId] != null : draft.text[selectedId] != null;
  const head = h('div', { class: 'te-panel-head' },
    h('div', {}, h('div', { class: 'te-kind' }, `${it.section} · ${it.kind === 'image' ? 'Foto' : 'Tekst'}`), h('div', { class: 'te-name' }, it.label)),
    h('button', { type: 'button', class: 'te-btn', 'aria-label': 'Sulge paneel', title: 'Sulge (Esc)', onclick: deselect }, icon('close')));
  const main = h('section');
  if (it.kind === 'text') {
    if (changed) main.append(h('div', { class: 'te-changed' }, 'Muudetud'));
    add(main,
      h('p', { class: 'te-hint', style: 'margin-top:0' }, editing?.id === selectedId
        ? (coarse ? 'Kirjuta otse lehel. Valmis olles puuduta mujale.' : 'Kirjuta otse lehel. ') : 'Muutmiseks klõpsa tekstil lehel.'),
      !coarse && h('p', { class: 'te-hint' }, h('span', { class: 'te-kbd' }, 'Enter'), ' valmis · ', h('span', { class: 'te-kbd' }, 'Shift+Enter'), ' uus rida · ', h('span', { class: 'te-kbd' }, 'Esc'), ' tühista'),
      h('div', { class: 'te-actions te-two' },
        editing?.id === selectedId
          ? h('button', { type: 'button', class: 'te-btn te-primary te-block', onclick: () => { finishEditing(); } }, icon('check'), 'Valmis')
          : h('button', { type: 'button', class: 'te-btn te-primary te-block', onclick: () => startEditing(selectedId) }, icon('text'), 'Muuda teksti'),
        h('button', { type: 'button', class: 'te-btn te-outline te-block', disabled: !changed && editing?.id !== selectedId, onclick: () => resetItem(selectedId) }, icon('reset'), 'Taasta algne')),
    );
    if (changed) add(main, h('p', { class: 'te-hint' }, 'Algne: ', h('i', {}, `„${it.original.replace(/\n/g, ' ')}”`)));
  } else {
    const photo = library.byPath(it.el.getAttribute('src'));
    add(main,
      changed ? h('div', { class: 'te-changed' }, 'Vahetatud') : null,
      h('img', { class: 'te-thumb', src: it.el.currentSrc || it.el.src, alt: '' }),
      photo && h('p', { class: 'te-hint' }, `${photo.group} · ${photo.name}`),
      h('div', { class: 'te-actions' },
        h('button', { type: 'button', class: 'te-btn te-primary te-block', onclick: () => library.open() }, icon('library'), 'Vali fotopangast'),
        h('div', { class: 'te-actions te-two', style: 'margin:0' },
          h('label', { class: 'te-btn te-outline te-block te-file' }, icon('upload'), 'Laadi seadmest', h('input', { type: 'file', accept: 'image/*', onchange: e => uploadImage(e.target) })),
          h('button', { type: 'button', class: 'te-btn te-outline te-block', disabled: !changed, onclick: () => resetItem(selectedId) }, icon('reset'), 'Taasta algne'))),
      photo?.dropbox && h('a', { class: 'te-hint', style: 'display:inline-flex;gap:6px;align-items:center;color:inherit', href: photo.dropbox, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Ava originaal Dropboxis'),
    );
  }
  main.classList.add('te-main');
  const oldMain = ui.panel.querySelector('.te-main');
  if (mainOnly && oldMain && ui.panel.dataset.for === selectedId) { oldMain.replaceWith(main); syncSheetHeight(); return; }
  const notesSec = h('section', {}, h('span', { class: 'te-label' }, 'Märkmed'), notes.renderFor(selectedId));
  const bodyEl = h('div', { class: 'te-panel-body te-split' }, main, notesSec);
  // Säilita poolelioleva märkme tekst ja fookus, kui paneel uuesti joonistatakse.
  const oldTa = ui.panel.querySelector('textarea'), draftNote = oldTa?.value || '', hadFocus = oldTa && document.activeElement === oldTa;
  const keepScroll = ui.panel.querySelector('.te-panel-body')?.scrollTop || 0;
  ui.panel.replaceChildren(head, bodyEl);
  bodyEl.scrollTop = keepScroll;
  const ta = bodyEl.querySelector('textarea');
  if (ta && draftNote && ui.panel.dataset.for === selectedId) { ta.value = draftNote; if (hadFocus) ta.focus({ preventScroll: true }); }
  ui.panel.dataset.for = selectedId;
  ui.panel.hidden = false;
  syncSheetHeight();
}
function syncSheetHeight() {
  const on = !ui.panel.hidden && sheetMode();
  document.body.classList.toggle('te-sheet-open', on);
  document.documentElement.style.setProperty('--te-sheet-h', on ? ui.panel.offsetHeight + 'px' : '0px');
}
function resetItem(id) {
  const it = items.get(id);
  if (editing?.id === id) cancelEditing();
  const before = currentValue(id);
  setValue(id, it.original);
  commit({ id, kind: it.kind, before, after: it.original, label: `${it.label} (${it.section})` });
  renderPanel();
  toast(it.kind === 'image' ? 'Algne foto taastatud.' : 'Algne tekst taastatud.', { action: ['Võta tagasi', undo] });
}
function replaceImage(id, src, label) {
  const it = items.get(id);
  const before = currentValue(id);
  setValue(id, src);
  commit({ id, kind: 'image', before, after: src, label: `${it.label} (${it.section})` });
  if (selectedId === id) renderPanel();
  toast(label || 'Foto vahetatud.', { action: ['Võta tagasi', undo] });
}
async function uploadImage(input) {
  const file = input.files?.[0]; input.value = '';
  if (!file || !selectedId) return;
  if (!file.type.startsWith('image/')) return toast('See fail ei ole pilt.', { bad: true });
  const id = selectedId;
  toast('Valmistan foto ette…', { ms: 1500 });
  try {
    const bmp = await loadBitmap(file);
    const max = 1800, ratio = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * ratio); c.height = Math.round(bmp.height * ratio);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    let data = c.toDataURL('image/webp', .82);
    if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', .8);
    replaceImage(id, data, 'Foto laaditud seadmest.');
    if (data.length > 900_000) toast('Foto on suur — avaldamisel tõstame selle eraldi failiks.', { ms: 5000 });
  } catch (err) { console.error(err); toast('Fotot ei õnnestunud avada. Proovi JPG- või PNG-faili.', { bad: true }); }
}
function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => viaImg());
  return viaImg();
  function viaImg() { return new Promise((res, rej) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = e => { URL.revokeObjectURL(url); rej(e); }; img.src = url; }); }
}

/* ------------------------------------------------------------------ notes (comments) */
const notes = {
  renderFor(id) {
    const list = h('div', { class: 'te-notes' });
    (draft.comments[id] || []).forEach((n, i) => list.append(h('div', { class: 'te-note' }, n,
      h('button', { type: 'button', class: 'te-btn', 'aria-label': 'Kustuta märge', title: 'Kustuta märge', onclick: () => notes.remove(id, i) }, icon('close')))));
    const ta = h('textarea', { class: 'te-textarea', placeholder: 'Näiteks: foto aiapoolsemaks, pealkiri lühemaks…', rows: 2 });
    const add = h('button', { type: 'button', class: 'te-btn te-outline te-block', style: 'margin-top:8px', onclick: () => notes.add(id, ta.value) }, icon('notes'), 'Lisa märge');
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) notes.add(id, ta.value); });
    return h('div', {}, list, h('div', { style: 'margin-top:8px' }, ta, add));
  },
  add(id, text) {
    const v = text.trim(); if (!v) return;
    const before = clone(draft.comments[id] || []);
    draft.comments[id] = [...before, v];
    commit({ id, kind: 'comments', before, after: draft.comments[id], label: 'märge' });
    const ta = ui.panel.querySelector('textarea'); if (ta) ta.value = '';
    renderPanel();
  },
  remove(id, i) {
    const before = clone(draft.comments[id] || []);
    const after = before.filter((_, j) => j !== i);
    if (after.length) draft.comments[id] = after; else delete draft.comments[id];
    commit({ id, kind: 'comments', before, after, label: 'märke kustutamine' });
    if (selectedId === id) renderPanel();
    toast('Märge kustutatud.', { action: ['Võta tagasi', undo] });
  },
  open() {
    const entries = Object.entries(draft.comments).filter(([, v]) => v?.length);
    const body = entries.length ? h('div', { class: 'te-notes' }, entries.map(([id, list]) => {
      const it = items.get(id);
      return h('div', {}, h('div', { style: 'display:flex;align-items:center;gap:8px;margin:12px 0 6px' },
        h('b', {}, it ? `${it.section} · ${it.label}` : `${id} (elementi enam pole lehel)`),
        it && h('button', { type: 'button', class: 'te-btn te-outline', style: 'margin-left:auto', onclick: () => { dlg.close(); select(id, { scroll: true, quiet: true }); } }, 'Näita lehel')),
        list.map(n => h('div', { class: 'te-note', style: 'padding-right:12px' }, n)));
    })) : h('div', { class: 'te-empty' }, 'Märkmeid pole. Märkme lisamiseks vali lehelt element.');
    const dlg = modal({ title: `Märkmed (${entries.reduce((a, [, l]) => a + l.length, 0)})`, body });
  },
};

/* ------------------------------------------------------------------ photo library */
const library = {
  photos: null, loading: null, group: 'all', index: -1, dlg: null,
  byPath(src) { if (!this.photos || !src) return null; const clean = src.replace(location.origin, '.').replace(/^\.\/\.\//, './'); return this.photos.find(p => p.src === clean || src.endsWith(p.src.slice(1))) || null; },
  load() {
    if (this.photos) return Promise.resolve(this.photos);
    return this.loading ||= fetch('./tube-assets/photo-library/manifest.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(list => { this.photos = list; return list; })
      .finally(() => { this.loading = null; });
  },
  target() { const it = items.get(selectedId); return it?.kind === 'image' ? selectedId : null; },
  open() {
    finishEditing(); closePops();
    const dlg = this.dlg = modal({ title: 'Fotopank', body: h('div'), cls: 'te-library', onClose: () => { this.dlg = null; } });
    const bodyEl = dlg.querySelector('.te-dlg-body'); bodyEl.remove();
    const head = dlg.querySelector('.te-dlg-head');
    const up = h('label', { class: 'te-btn te-outline te-file', title: 'Laadi foto oma seadmest' }, icon('upload'), h('span', { class: 'te-lbl' }, 'Laadi seadmest'),
      h('input', { type: 'file', accept: 'image/*', onchange: e => { if (!this.target()) { e.target.value = ''; toast('Vali enne lehelt foto, mida asendada.', { bad: true }); return; } dlg.close(); uploadImage(e.target); } }));
    head.insertBefore(up, head.lastChild);
    this.tools = h('div', { class: 'te-lib-tools' });
    this.grid = h('div', { class: 'te-lib-body' });
    this.viewer = h('div', { class: 'te-viewer', hidden: true });
    dlg.append(this.tools, this.grid, this.viewer);
    dlg.addEventListener('keydown', e => {
      if (this.viewer.hidden) return;
      if (e.key === 'ArrowLeft') this.step(-1); else if (e.key === 'ArrowRight') this.step(1);
      else if (e.key === 'Escape') { e.preventDefault(); this.closeViewer(); }
    });
    this.renderGrid();
  },
  renderTools() {
    const counts = {}; (this.photos || []).forEach(p => counts[p.group] = (counts[p.group] || 0) + 1);
    const chip = (g, label, n) => h('button', { type: 'button', class: 'te-chip', 'aria-pressed': String(this.group === g), onclick: () => { this.group = g; this.renderGrid(); } }, label, h('small', {}, n));
    const tgt = this.target(), t = tgt && items.get(tgt);
    this.tools.replaceChildren(
      chip('all', 'Kõik', this.photos?.length || 0),
      ...Object.keys(counts).map(g => chip(g, g, counts[g])),
      h('div', { class: 'te-lib-target' }, t ? [h('img', { src: t.el.currentSrc || t.el.src, alt: '' }), h('span', {}, `Asendad: ${t.label} (${t.section})`)] : 'Sirvimine — foto kasutamiseks vali enne lehelt pilt'));
  },
  async renderGrid() {
    if (!this.photos) {
      this.grid.replaceChildren(h('div', { class: 'te-grid' }, Array.from({ length: 12 }, () => h('div', { class: 'te-skel' }))));
      this.renderTools();
      try { await this.load(); }
      catch (err) {
        this.grid.replaceChildren(h('div', { class: 'te-empty' }, h('p', {}, 'Fotopanka ei õnnestunud laadida. Kontrolli internetiühendust.'), h('button', { type: 'button', class: 'te-btn te-outline', onclick: () => this.renderGrid() }, 'Proovi uuesti')));
        return;
      }
      if (!this.dlg) return;
    }
    this.renderTools();
    const list = this.list();
    if (!list.length) { this.grid.replaceChildren(h('div', { class: 'te-empty' }, 'Selles rühmas fotosid pole.')); return; }
    const curSrc = this.target() && items.get(this.target()).el.getAttribute('src');
    this.grid.replaceChildren(h('div', { class: 'te-grid' }, list.map((p, i) => h('button', {
      type: 'button', class: 'te-tile' + (curSrc && curSrc === p.src ? ' te-current' : ''), title: `${p.group} · ${p.name}`, onclick: () => this.openViewer(i),
    }, h('img', { src: p.src, alt: `${p.group} · ${p.name}`, loading: 'lazy', decoding: 'async' }), h('span', {}, p.group)))));
  },
  list() { return (this.photos || []).filter(p => this.group === 'all' || p.group === this.group); },
  openViewer(i) { this.index = i; this.renderViewer(); this.viewer.hidden = false; this.viewer.querySelector('.te-primary,.te-btn')?.focus({ preventScroll: true }); },
  closeViewer() { this.viewer.hidden = true; },
  step(d) { const n = this.list().length; this.index = (this.index + d + n) % n; this.renderViewer(); },
  renderViewer() {
    const list = this.list(), p = list[this.index]; if (!p) return;
    const tgt = this.target();
    const img = h('img', { src: p.src, alt: `${p.group} · ${p.name}` });
    let sx = null;
    const area = h('div', { class: 'te-viewer-img', onpointerdown: e => { sx = e.clientX; }, onpointerup: e => { if (sx != null && Math.abs(e.clientX - sx) > 50) this.step(e.clientX < sx ? 1 : -1); sx = null; } },
      img,
      list.length > 1 && h('button', { type: 'button', class: 'te-btn te-nav te-prev', 'aria-label': 'Eelmine', onclick: () => this.step(-1) }, icon('left')),
      list.length > 1 && h('button', { type: 'button', class: 'te-btn te-nav te-next', 'aria-label': 'Järgmine', onclick: () => this.step(1) }, icon('right')));
    const use = h('button', { type: 'button', class: 'te-btn te-primary', disabled: !tgt, onclick: () => { const t = this.target(); this.dlg?.close(); replaceImage(t, p.src, `Foto vahetatud: ${p.group} · ${p.name}`); } }, icon('check'), 'Kasuta seda fotot');
    this.viewer.replaceChildren(area, h('div', { class: 'te-viewer-bar' },
      h('span', { class: 'te-meta' }, `${p.group} · ${p.name} · ${this.index + 1}/${list.length}${p.width ? ` · ${p.width}×${p.height}` : ''}`),
      p.dropbox && h('a', { class: 'te-btn te-outline', href: p.dropbox, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), h('span', { class: 'te-lbl' }, 'Ava Dropboxis')),
      h('button', { type: 'button', class: 'te-btn te-outline', onclick: () => this.closeViewer() }, 'Tagasi'),
      tgt ? use : h('span', { class: 'te-meta', style: 'margin:0' }, 'Vali enne lehelt foto, mida asendada')));
  },
};

/* ------------------------------------------------------------------ cloud (Supabase) */
const cloud = {
  sb: null, user: null, state: 'local', version: Number(ls.get(VERSION_KEY)) || null, lastSaved: null, error: '', remote: null, timer: null, busy: false, ready: false,
  set(state, error = '') {
    this.state = state; this.error = error;
    const text = {
      local: this.ready ? 'Ainult selles seadmes' : 'Salvestatud seadmes',
      offline: 'Pilv pole saadaval',
      dirty: 'Salvestamata muudatused',
      saving: 'Salvestamine…',
      saved: 'Pilve salvestatud',
      error: 'Salvestamine ebaõnnestus',
      conflict: 'Teises seadmes uuem versioon',
    }[state];
    ui.status.dataset.state = state;
    ui.status.querySelector('.te-status-text').textContent = text;
    ui.status.title = text + (error ? ` — ${error}` : '');
    ui.saveBtn.disabled = state === 'saving';
    if (!ui.cloudPop.hidden) this.renderPop();
  },
  dirty() { return ls.get(DIRTY_KEY) === '1'; },
  base() { return normalize(safeParse(ls.get(BASE_KEY)) || {}); },
  setBase(content, version) { this.version = version; ls.set(VERSION_KEY, String(version)); try { ls.set(BASE_KEY, JSON.stringify(content)); } catch {} },
  async init() {
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.10');
      this.sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) { console.warn(e); this.set('offline', 'Pilveteenust ei õnnestunud laadida'); return; }
    this.ready = true;
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    this.sb.auth.onAuthStateChange((_e, session) => { const was = this.user; this.user = session?.user || null; if (!was && this.user) this.sync(); else if (!this.user) this.set('local'); });
    if (this.user) await this.sync(); else this.set('local');
  },
  async fetchRow(cols = 'content,version,updated_at') {
    const { data, error } = await this.sb.from('tube_editor_drafts').select(cols).eq('id', DRAFT_ROW).maybeSingle();
    if (error) throw error;
    return data;
  },
  /* Käivitamisel ja pärast sisselogimist: võrdle pilve ja kohalikku mustandit. */
  async sync() {
    if (!this.user) return;
    try {
      this.set('saving');
      const row = await this.fetchRow();
      if (!row) { this.set('error', 'Pilvemustandi rida puudub'); return; }
      const remote = normalize(row.content);
      if (sameDraft(remote, draft)) { this.setBase(remote, row.version); ls.del(DIRTY_KEY); this.lastSaved = row.updated_at; this.set('saved'); return; }
      if (this.version === row.version) { ls.set(DIRTY_KEY, '1'); this.set('dirty'); this.schedule(); return; } // kohalikud muudatused viimasest pilveseisust
      // Pilves on teine versioon.
      if (!this.dirty() || isEmptyDraft(draft)) { this.adopt(remote, row, 'Laadisin pilvest uusima mustandi.'); return; }
      if (isEmptyDraft(remote)) { this.version = row.version; this.setBase(remote, row.version); this.set('dirty'); this.schedule(); return; }
      this.remote = row; this.set('conflict'); conflictDialog(row);
    } catch (e) { this.set('error', e.message); }
  },
  adopt(remote, row, msg) {
    finishEditing();
    draft = normalize(remote); persistLocal();
    this.setBase(remote, row.version); ls.del(DIRTY_KEY);
    undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
    applyDraftToDom(); if (selectedId) renderPanel();
    this.lastSaved = row.updated_at; this.remote = null;
    this.set('saved');
    if (msg) toast(msg);
  },
  onLocalChange() {
    if (this.state === 'conflict') return;
    if (!this.user) { if (this.state !== 'offline') this.set('local'); return; }
    this.set('dirty'); this.schedule();
  },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), CLOUD_AUTOSAVE_MS); },
  async save({ manual = false, force = false } = {}) {
    clearTimeout(this.timer);
    finishEditing();
    if (!this.ready) { if (manual) toast(this.state === 'offline' ? 'Pilveteenus pole praegu kättesaadav. Muudatused on selles seadmes alles.' : 'Pilv laadib veel…', { bad: this.state === 'offline' }); return false; }
    if (!this.user) { if (manual) togglePop(ui.cloudPop, ui.status, () => this.renderPop()); return false; }
    if (this.state === 'conflict' && !force) { if (manual) conflictDialog(this.remote); return false; }
    if (this.busy) { this.schedule(); return false; }
    this.busy = true; this.set('saving');
    try {
      const latest = await this.fetchRow('version,content,updated_at');
      if (!latest) throw new Error('Pilvemustandi rida puudub');
      if (!force && this.version !== null && latest.version !== this.version && !sameDraft(latest.content, this.base())) {
        this.remote = latest; this.set('conflict'); conflictDialog(latest); return false;
      }
      if (!force && this.version === null && !isEmptyDraft(normalize(latest.content)) && !sameDraft(latest.content, draft)) {
        this.remote = latest; this.set('conflict'); conflictDialog(latest); return false;
      }
      const content = clone(draft);
      const { data, error } = await this.sb.from('tube_editor_drafts')
        .update({ content, version: latest.version + 1, updated_at: new Date().toISOString(), updated_by: this.user.id })
        .eq('id', DRAFT_ROW).eq('version', latest.version).select('version,updated_at').maybeSingle();
      if (error) throw error;
      if (!data) { // keegi salvestas vahepeal
        const row = await this.fetchRow(); this.remote = row; this.set('conflict'); conflictDialog(row); return false;
      }
      this.setBase(content, data.version); this.lastSaved = data.updated_at;
      if (sameDraft(content, draft)) ls.del(DIRTY_KEY);
      this.set(this.dirty() ? 'dirty' : 'saved');
      if (manual) toast('Mustand salvestatud pilve.');
      return true;
    } catch (e) {
      console.error(e);
      this.set('error', e.message || String(e));
      toast('Pilve salvestamine ebaõnnestus. Muudatused on selles seadmes alles.', { bad: true, action: ['Proovi uuesti', () => this.save({ manual: true })] });
      return false;
    } finally { this.busy = false; }
  },
  async loadInteractive() {
    if (!this.user) { togglePop(ui.cloudPop, ui.status, () => this.renderPop()); return; }
    try {
      const row = await this.fetchRow();
      const remote = normalize(row.content);
      if (sameDraft(remote, draft)) { this.setBase(remote, row.version); ls.del(DIRTY_KEY); this.set('saved'); toast('See seade on juba pilvega samas seisus.'); return; }
      if (await confirmDialog('Laadi mustand pilvest?', `Pilvemustand (versioon ${row.version}, ${fmtTime(row.updated_at)}) asendab selle seadme mustandi. Enne asendamist laaditakse sinu praegune mustand varukoopiana alla.`, 'Laadi pilvest')) {
        downloadJSON(draft, 'TUBE-varukoopia-enne-pilvest-laadimist.json');
        this.adopt(remote, row, 'Pilvemustand laaditud.');
      }
    } catch (e) { toast('Pilvest lugemine ebaõnnestus: ' + e.message, { bad: true }); }
  },
  renderPop() {
    const pop = ui.cloudPop, s = this;
    const stateText = ui.status.querySelector('.te-status-text').textContent;
    let content;
    if (!s.ready) content = [h('h4', {}, stateText), h('p', {}, s.state === 'offline' ? 'Muudatused salvestuvad selles brauseris. Proovi hiljem uuesti.' : 'Ühendan pilveteenusega…')];
    else if (!s.user) {
      const email = h('input', { type: 'email', placeholder: 'nimi' + EMAIL_DOMAIN, value: ls.get(EMAIL_KEY, ''), autocomplete: 'email', inputmode: 'email' });
      const sendBtn = h('button', { type: 'button', class: 'te-btn te-primary te-block' }, 'Saada sisselogimislink');
      const send = async () => {
        const v = email.value.trim().toLowerCase();
        if (!v.endsWith(EMAIL_DOMAIN)) { toast(`Kasuta oma ${EMAIL_DOMAIN} aadressi.`, { bad: true }); email.focus(); return; }
        ls.set(EMAIL_KEY, v); sendBtn.disabled = true; sendBtn.textContent = 'Saadan…';
        const { error } = await s.sb.auth.signInWithOtp({ email: v, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname + '?edit=1' } });
        sendBtn.disabled = false; sendBtn.textContent = 'Saada sisselogimislink';
        if (error) toast('Lingi saatmine ebaõnnestus: ' + error.message, { bad: true });
        else { closePops(); toast(`Link saadetud aadressile ${v}. Ava see samas brauseris.`, { ms: 7000 }); }
      };
      sendBtn.onclick = send; email.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      content = [h('h4', {}, 'Pilvesalvestus'), h('p', {}, 'Logi sisse, et mustand oleks kõigis seadmetes. Seni salvestub see ainult selles brauseris.'), email, sendBtn];
    } else {
      content = [
        h('h4', {}, stateText),
        h('p', {}, [s.user.email, s.version ? ` · versioon ${s.version}` : '', s.lastSaved ? ` · ${fmtTime(s.lastSaved)}` : ''].join('')),
        s.error && h('p', { style: 'color:var(--te-bad)' }, s.error),
        h('div', { class: 'te-row' },
          s.state === 'conflict'
            ? h('button', { type: 'button', class: 'te-btn te-primary', onclick: () => { closePops(); conflictDialog(s.remote); } }, 'Lahenda konflikt')
            : h('button', { type: 'button', class: 'te-btn te-primary', disabled: s.state === 'saving', onclick: () => { closePops(); s.save({ manual: true }); } }, icon('cloud'), 'Salvesta kohe'),
          h('button', { type: 'button', class: 'te-btn te-outline', onclick: () => { closePops(); s.loadInteractive(); } }, 'Laadi pilvest'),
          h('button', { type: 'button', class: 'te-btn', onclick: async () => { closePops(); await s.sb.auth.signOut(); toast('Välja logitud. Mustand jääb sellesse seadmesse alles.'); } }, icon('logout'), 'Logi välja')),
      ];
    }
    pop.replaceChildren(h('div', { class: 'te-pop-pad' }, content));
  },
};

/* Kolmepoolne ühendamine: base = viimane ühine pilveseis, local = see seade, remote = pilv. */
function mergeDrafts(base, local, remote) {
  const out = emptyDraft(), conflicts = [];
  for (const cat of ['text', 'images', 'comments']) {
    const keys = new Set([...Object.keys(base[cat]), ...Object.keys(local[cat]), ...Object.keys(remote[cat])]);
    for (const k of keys) {
      const b = JSON.stringify(base[cat][k] ?? null), l = JSON.stringify(local[cat][k] ?? null), r = JSON.stringify(remote[cat][k] ?? null);
      let v;
      if (l === r || r === b) v = local[cat][k];
      else if (l === b) v = remote[cat][k];
      else if (cat === 'comments') v = [...new Set([...(remote[cat][k] || []), ...(local[cat][k] || [])])];
      else { conflicts.push({ cat, id: k, local: local[cat][k], remote: remote[cat][k] }); v = local[cat][k]; }
      if (v != null && !(Array.isArray(v) && !v.length)) out[cat][k] = clone(v);
    }
  }
  return { merged: out, conflicts };
}
function conflictDialog(row) {
  if (!row || document.querySelector('.te-conflict[open]')) return;
  const remote = normalize(row.content);
  const { merged, conflicts } = mergeDrafts(cloud.base(), draft, remote);
  const describe = c => { const it = items.get(c.id); return `${it ? `${it.section} · ${it.label}` : c.id}${c.cat === 'images' ? ' (foto)' : ''}`; };
  const body = h('div', {},
    h('div', { class: 'te-callout te-bad' }, `Mustandit on vahepeal muudetud teises seadmes (versioon ${row.version}, ${fmtTime(row.updated_at)}). Midagi ei kirjutatud üle.`),
    conflicts.length
      ? h('div', {}, h('p', {}, 'Mõlemas seadmes on muudetud samu kohti:'), h('ul', { class: 'te-list' }, conflicts.slice(0, 8).map(c => h('li', {}, describe(c)))), conflicts.length > 8 && h('p', {}, `…ja veel ${conflicts.length - 8}.`), h('p', {}, '„Ühenda” jätab nendes kohtades selle seadme versiooni ja võtab kõik muu teisest seadmest.'))
      : h('p', {}, 'Muudatused ei kattu, seega saab need ohutult ühendada.'),
    h('p', { class: 'te-hint' }, 'Enne iga valikut laaditakse selle seadme mustand varukoopiana alla.'));
  const backup = () => downloadJSON(draft, 'TUBE-varukoopia-konflikt.json');
  modal({
    title: 'Teises seadmes on uuem versioon', body, cls: 'te-conflict',
    actions: [
      ['Hiljem', () => {}],
      ['Kasuta teise seadme versiooni', () => { backup(); cloud.adopt(remote, row, 'Teise seadme versioon laaditud.'); }],
      ['Ühenda muudatused', async () => {
        backup(); finishEditing();
        draft = merged; persistLocal(); ls.set(DIRTY_KEY, '1');
        cloud.version = row.version; cloud.setBase(remote, row.version); cloud.set('dirty');
        undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
        applyDraftToDom(); if (selectedId) renderPanel();
        await cloud.save({ manual: true });
      }, 'primary'],
    ],
  });
}

/* ------------------------------------------------------------------ publish */
const publish = {
  async open() {
    finishEditing(); closePops();
    const changed = [
      ...Object.keys(draft.text).map(id => ['Tekst', id]),
      ...Object.keys(draft.images).map(id => ['Foto', id]),
    ];
    const noteCount = Object.values(draft.comments).reduce((a, c) => a + (c?.length || 0), 0);
    const list = changed.length ? h('ul', { class: 'te-list' }, changed.map(([k, id]) => { const it = items.get(id); return h('li', {}, `${k}: ${it ? `${it.section} · ${it.label}` : id}`); })) : h('p', {}, 'Avaliku lehega võrreldes muudatusi pole.');
    const body = h('div', {},
      h('div', { class: 'te-callout' }, h('b', {}, 'Mustand ≠ avaldatud. '), 'Salvestatud mustandit näed ainult sina ja teised redaktorid. Avalik leht muutub alles pärast avaldamist.'),
      h('p', {}, `Avaldamisele lähevad ${changed.length} muudatust${noteCount ? ` ja ${noteCount} märget arendajale` : ''}:`),
      list,
      h('p', { class: 'te-hint', style: 'margin-top:12px' }, 'Avaldamise taotlus salvestatakse pilve ja sinu seadmesse laaditakse muudatuste fail. Arendaja (või Claude) vaatab muudatused üle ja viib need veebi; avalik leht jääb seni muutmata.'));
    modal({
      title: 'Avalda veebis', body,
      actions: [
        ['Tühista', () => {}],
        ['Saada avaldamiseks', async () => {
          draft.meta = { ...(draft.meta || {}), publishRequest: { at: new Date().toISOString(), by: cloud.user?.email || null, changes: changed.length, notes: noteCount } };
          persistLocal(); ls.set(DIRTY_KEY, '1');
          const ok = cloud.user ? await cloud.save({ manual: false }) : false;
          downloadJSON(draft, 'TUBE-avaldamiseks.json');
          toast(ok ? 'Avaldamise taotlus salvestatud pilve ja fail alla laaditud.' : 'Muudatuste fail alla laaditud. Saada see arendajale.', { ms: 6000 });
        }, 'primary'],
      ],
    });
  },
};

/* ------------------------------------------------------------------ misc actions */
async function onImport(e) {
  const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const ch = data.changes || data;
    if (!ch || typeof ch !== 'object' || !('text' in ch || 'images' in ch || 'comments' in ch)) throw new Error('vorming');
    const incoming = normalize(ch);
    const unknown = [...Object.keys(incoming.text), ...Object.keys(incoming.images)].filter(id => !items.has(id));
    if (!await confirmDialog('Impordi muudatused?', `Failis on ${Object.keys(incoming.text).length} teksti-, ${Object.keys(incoming.images).length} foto- ja ${Object.values(incoming.comments).reduce((a, c) => a + (c?.length || 0), 0)} märkmekirjet${unknown.length ? ` (${unknown.length} neist ei vasta enam lehe elementidele)` : ''}. Need asendavad selle seadme mustandi; praegune mustand laaditakse enne varukoopiana alla.`, 'Impordi')) return;
    downloadJSON(draft, 'TUBE-varukoopia-enne-importi.json');
    finishEditing();
    draft = incoming; persistLocal(); ls.set(DIRTY_KEY, '1');
    undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
    applyDraftToDom(); if (selectedId) renderPanel();
    cloud.onLocalChange();
    toast('Muudatused imporditud.');
  } catch { toast('See ei ole TUBE muudatuste fail.', { bad: true }); }
}
async function resetLocal() {
  if (!await confirmDialog('Tühjenda selle seadme mustand?', 'Kõik selles brauseris tehtud muudatused ja märkmed eemaldatakse lehelt. Enne seda laaditakse varukoopia alla. Pilves olevat mustandit see ei muuda.', 'Tühjenda', 'danger')) return;
  downloadJSON(draft, 'TUBE-varukoopia-enne-tuhjendamist.json');
  finishEditing();
  draft = emptyDraft(); persistLocal(); ls.del(DIRTY_KEY);
  undoStack.length = 0; redoStack.length = 0; updateHistoryButtons();
  applyDraftToDom(); deselect();
  toast('Selle seadme mustand tühjendatud.');
}
function showShortcuts() {
  const row = (k, t) => h('li', {}, h('span', { class: 'te-kbd' }, k), ' ', t);
  modal({ title: 'Kiirklahvid', body: h('ul', { class: 'te-list', style: 'list-style:none;padding:0' },
    row(`${MOD}+Z`, 'võta tagasi'), row(`${MOD}+Shift+Z`, 'taasta'), row(`${MOD}+S`, 'salvesta mustand pilve'),
    row('Enter', 'lõpeta teksti muutmine'), row('Shift+Enter', 'uus rida tekstis'), row('Esc', 'tühista muutmine / sulge'), row('← →', 'fotopangas eelmine/järgmine')) });
}
async function exitEditor() {
  finishEditing();
  if (cloud.user && cloud.dirty() && cloud.state !== 'saved') {
    const saved = await cloud.save({ manual: false });
    if (!saved && !await confirmDialog('Sulgeda redaktor?', 'Viimased muudatused ei jõudnud pilve. Need on alles selles brauseris ja jõuavad pilve järgmisel avamisel.', 'Sulge')) return;
  }
  const u = new URL(location.href); u.searchParams.delete('edit'); location.href = u.toString();
}

/* ------------------------------------------------------------------ boot */
/* Vanade mustandite korrastus: eemalda kirjed, mis on juba avalikul lehel, ja
   asenda aeguvad Dropboxi lingid püsivate kohalike fotodega. */
const PUBLISHED_2026_10_31 = { 'proof-2': v => v.startsWith('data:') && v.length === 280859, 'hero-image': v => v.includes('IMG_0949-1.jpg') };
function migrateDraft() {
  let changed = false;
  for (const [id, v] of Object.entries(draft.text)) {
    const it = items.get(id); if (!it) continue;
    const t = String(v).trim();
    if (t === it.original.trim() || t + '.' === it.original.trim()) { delete draft.text[id]; changed = true; }
  }
  for (const [id, v] of Object.entries(draft.images)) {
    const it = items.get(id); if (!it || typeof v !== 'string') continue;
    if (PUBLISHED_2026_10_31[id]?.(v) || v === it.original) { delete draft.images[id]; changed = true; continue; }
    const m = v.match(/dropbox(?:usercontent)?\.com\/.*\/([^/?#]+\.(?:jpe?g|png|webp))/i);
    const photo = m && library.photos?.find(p => p.name.toLowerCase() === decodeURIComponent(m[1]).toLowerCase());
    if (photo) { draft.images[id] = photo.src; changed = true; }
  }
  if (changed) persistLocal();
}

async function boot() {
  registerItems();
  buildUI();
  document.body.classList.add('te-on');
  await library.load().catch(() => {});
  migrateDraft();
  applyDraftToDom();
  setFilter(['all', 'text', 'image'].includes(filter) ? filter : 'all');
  updateHistoryButtons();
  updateHint();

  // Üks sündmuste kiht kogu lehe jaoks (capture), et vanad/lehe enda kuularid ei konkureeriks.
  window.addEventListener('click', onPageClick, true);
  window.addEventListener('submit', blockPageEvent, true);
  window.addEventListener('keydown', blockPageEvent, true);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { closePops(); syncSheetHeight(); });
  window.addEventListener('beforeunload', e => { finishEditing(); persistLocal(); if (cloud.user && cloud.dirty() && cloud.state !== 'saved') { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { finishEditing(); persistLocal(); } else if (cloud.user && cloud.state !== 'saving') cloud.sync(); });

  // Supabase'i tagastatud magic-link räsi koristamine aadressiribalt pärast sisselogimist.
  cloud.init().finally(() => { if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname + location.search); });
  window.tubeEditor = { draft: () => draft, items, cloud, undo, redo, select }; // silumiseks
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
