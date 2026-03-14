// ═══════════════════════════════════════════════════════════
// firebase-config.js  —  Firebase + Database wrapper
// ═══════════════════════════════════════════════════════════
// Используем Firebase Realtime Database через REST API
// Не нужен npm, работает в браузере как есть.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── FIREBASE CONFIG ──
// Это дефолтная публичная Firebase для демо.
// Для своей игры: создай проект на https://console.firebase.google.com
// и замени эти значения.
const FB_CONFIG = {
  databaseURL: 'https://bunker-a5745-default-rtdb.europe-west1.firebasedatabase.app',
};

// ── REST API HELPER ──
const FB = {
  _base: () => FB_CONFIG.databaseURL,

  // Читать один раз
  async get(path) {
    try {
      const r = await fetch(`${FB._base()}/${path}.json`);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  },

  // Записать (PUT — перезаписывает)
  async set(path, data) {
    try {
      const r = await fetch(`${FB._base()}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return r.ok;
    } catch { return false; }
  },

  // Обновить (PATCH — мержит)
  async update(path, data) {
    try {
      const r = await fetch(`${FB._base()}/${path}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return r.ok;
    } catch { return false; }
  },

  // Удалить
  async del(path) {
    try {
      await fetch(`${FB._base()}/${path}.json`, { method: 'DELETE' });
      return true;
    } catch { return false; }
  },

  // Realtime listener через SSE (Server-Sent Events)
  listen(path, callback) {
    const url = `${FB._base()}/${path}.json`;
    let es;
    const connect = () => {
      es = new EventSource(url);
      es.addEventListener('put', e => {
        try { const d = JSON.parse(e.data); callback(d.data); } catch {}
      });
      es.addEventListener('patch', e => {
        try { const d = JSON.parse(e.data); callback(null, d.data); } catch {}
      });
      es.onerror = () => {
        es.close();
        setTimeout(connect, 3000); // reconnect
      };
    };
    connect();
    return { stop: () => es && es.close() };
  },
};

// ── ROOMS API ──
const RoomsDB = {

  async getAll() {
    const data = await FB.get('rooms');
    if (!data) return {};
    // Очищаем устаревшие (>12ч)
    const now = Date.now();
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && v.created && now - v.created < 12 * 3600 * 1000) {
        clean[k] = v;
      }
    }
    return clean;
  },

  async get(id) {
    return await FB.get(`rooms/${id}`);
  },

  async save(room) {
    return await FB.set(`rooms/${room.id}`, room);
  },

  async update(id, fields) {
    return await FB.update(`rooms/${id}`, fields);
  },

  async delete(id) {
    return await FB.del(`rooms/${id}`);
  },

  listen(id, cb) {
    return FB.listen(`rooms/${id}`, cb);
  },
};

// ── AUTH (localStorage — только пароли, не комнаты) ──
const AuthDB = {
  getPasses: () => { try { return JSON.parse(localStorage.getItem('bk_passes') || '{}'); } catch { return {}; } },
  savePasses: (p) => localStorage.setItem('bk_passes', JSON.stringify(p)),
  getSession: () => { try { return JSON.parse(localStorage.getItem('bk_session')); } catch { return null; } },
  setSession: (name) => localStorage.setItem('bk_session', JSON.stringify(name)),
  clearSession: () => localStorage.removeItem('bk_session'),
};
