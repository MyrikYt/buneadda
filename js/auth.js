/* ═══════════════════════════════════════════════════════════
   auth.js — авторизация, хранение, утилиты
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ── STORAGE KEYS ── */
const SK = {
  users:    'bk_users',
  passes:   'bk_passes',
  rooms:    'bk_rooms',
  session:  'bk_session',
};

/* ── STORAGE HELPERS ── */
const Store = {
  get:  (k, def={}) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set:  (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del:  (k) => localStorage.removeItem(k),

  getUsers:  () => Store.get(SK.users, {}),
  getPasses: () => Store.get(SK.passes, {}),
  getRooms:  () => Store.get(SK.rooms, {}),
  setRooms:  (r) => Store.set(SK.rooms, r),

  getSession: () => Store.get(SK.session, null),
  setSession: (name) => Store.set(SK.session, name),
  clearSession: () => Store.del(SK.session),
};

/* ── AUTH STATE ── */
let currentUser = null;

function getMe() { return currentUser; }

function initAuth() {
  const sess = Store.getSession();
  if (sess && Store.getPasses()[sess]) {
    currentUser = sess;
    return true; // already logged in
  }
  return false;
}

function login(username, password) {
  const passes = Store.getPasses();
  if (!passes[username]) return { ok: false, msg: 'Пользователь не найден' };
  if (passes[username] !== password) return { ok: false, msg: 'Неверный пароль' };
  currentUser = username;
  Store.setSession(username);
  return { ok: true };
}

function register(username, password) {
  if (!username || username.length < 2) return { ok: false, msg: 'Логин слишком короткий (мин. 2 символа)' };
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\-\.]+$/.test(username)) return { ok: false, msg: 'Логин: только буквы, цифры, _ - .' };
  if (!password || password.length < 4) return { ok: false, msg: 'Пароль минимум 4 символа' };
  const passes = Store.getPasses();
  if (passes[username]) return { ok: false, msg: 'Этот логин уже занят' };
  passes[username] = password;
  Store.set(SK.passes, passes);
  currentUser = username;
  Store.setSession(username);
  return { ok: true };
}

function logout() {
  currentUser = null;
  Store.clearSession();
}

/* ── ROOM STORAGE ── */
function getRooms() {
  const rooms = Store.getRooms();
  const now = Date.now();
  let changed = false;
  // Clean stale rooms (>12h)
  for (const k of Object.keys(rooms)) {
    if (!rooms[k].created || now - rooms[k].created > 12 * 3600 * 1000) {
      delete rooms[k]; changed = true;
    }
  }
  if (changed) Store.setRooms(rooms);
  return rooms;
}
function saveRooms(rooms) { Store.setRooms(rooms); }
function getRoom(id) { return getRooms()[id] || null; }
function saveRoom(room) {
  const rooms = getRooms();
  rooms[room.id] = room;
  saveRooms(rooms);
}
function deleteRoom(id) {
  const rooms = getRooms();
  delete rooms[id];
  saveRooms(rooms);
}

/* ── TOAST ── */
function showToast(msg, type = 'info', dur = 3200) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, dur - 400);
  setTimeout(() => el.remove(), dur);
}

/* ── MODAL HELPERS ── */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
function closeAllModals() {
  document.querySelectorAll('.overlay.open').forEach(el => el.classList.remove('open'));
}

/* ── COPY TO CLIPBOARD ── */
function copyText(text, label = 'Скопировано') {
  navigator.clipboard.writeText(text)
    .then(() => showToast(label + ': ' + text, 'success', 2000))
    .catch(() => showToast(text, 'info'));
}

/* ── KEYBOARD SHORTCUT ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllModals();
});
