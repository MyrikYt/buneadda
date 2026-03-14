// ═══════════════════════════════════════════════════════════
// game.js  —  Вся игровая логика с Firebase realtime sync
// ═══════════════════════════════════════════════════════════
'use strict';

// ══════════════════════════════
// STATE
// ══════════════════════════════
const G = {
  me: null,
  roomId: null,
  listener: null,
  room: null,
  localStream: null,
  micOn: false,
  camOn: false,
  myVote: null,
  lastChatLen: 0,
};

// ══════════════════════════════
// INIT
// ══════════════════════════════
async function initApp() {
  const session = AuthDB.getSession();
  if (session && AuthDB.getPasses()[session]) {
    G.me = session;
  }

  // Setup nav
  updateNavUI();

  // Determine which page
  const isGame = document.body.dataset.page === 'game';
  if (isGame) {
    if (!G.me) { window.location.href = 'index.html'; return; }
    renderLobbyView();
    pollRoomsForLobby();
  } else {
    // index page
    initLandingPage();
  }
}

// ══════════════════════════════
// AUTH
// ══════════════════════════════
function doLogin() {
  const u = q('#li-user').value.trim();
  const p = q('#li-pass').value;
  if (!u || !p) return toast('Заполни все поля', 'warn');
  const passes = AuthDB.getPasses();
  if (!passes[u]) return toast('Пользователь не найден', 'error');
  if (passes[u] !== p) return toast('Неверный пароль', 'error');
  AuthDB.setSession(u);
  G.me = u;
  toast(`Добро пожаловать, ${u}! 🎉`, 'success');
  closeModal('auth-modal');
  updateNavUI();
  setTimeout(() => { window.location.href = 'game.html'; }, 600);
}

function doRegister() {
  const u = q('#rg-user').value.trim();
  const p = q('#rg-pass').value;
  const p2 = q('#rg-pass2').value;
  if (!u || !p || !p2) return toast('Заполни все поля', 'warn');
  if (u.length < 2) return toast('Логин минимум 2 символа', 'error');
  if (!/^[a-zA-Zа-яА-ЯёЁ0-9_\-\.]+$/.test(u)) return toast('Логин: только буквы, цифры, _ - .', 'error');
  if (p.length < 4) return toast('Пароль минимум 4 символа', 'error');
  if (p !== p2) return toast('Пароли не совпадают', 'error');
  const passes = AuthDB.getPasses();
  if (passes[u]) return toast('Логин занят', 'error');
  passes[u] = p;
  AuthDB.savePasses(passes);
  AuthDB.setSession(u);
  G.me = u;
  toast(`Аккаунт создан! Добро пожаловать, ${u} 🎉`, 'success', 4000);
  closeModal('auth-modal');
  updateNavUI();
  setTimeout(() => { window.location.href = 'game.html'; }, 700);
}

function doLogout() {
  if (G.roomId) leaveRoomCleanup();
  AuthDB.clearSession();
  G.me = null;
  window.location.href = 'index.html';
}

function updateNavUI() {
  const me = G.me;
  // Guest elements
  qAll('.nav-guest').forEach(el => el.style.display = me ? 'none' : '');
  qAll('.nav-user').forEach(el => el.style.display = me ? 'flex' : 'none');
  qAll('.nav-username').forEach(el => { el.textContent = me || ''; });
  qAll('.nav-avatar').forEach(el => {
    el.textContent = me ? avatarLetter(me) : '?';
    el.style.background = me ? avatarColor(me) : 'var(--accent)';
  });
}

// ══════════════════════════════
// LOBBY
// ══════════════════════════════
let _lobbyPollTimer = null;

function renderLobbyView() {
  showView('lobby-view');
  setTopbar('', '', '');
  q('#top-start-btn') && (q('#top-start-btn').style.display = 'none');
  q('#vote-btn') && (q('#vote-btn').style.display = 'none');
  refreshRoomsList();
}

async function refreshRoomsList() {
  const rooms = await RoomsDB.getAll();
  const list  = Object.values(rooms).sort((a, b) => b.created - a.created);
  const grid  = q('#rooms-grid');
  const empty = q('#rooms-empty');
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML = '';
    empty && (empty.style.display = 'flex');
    return;
  }
  empty && (empty.style.display = 'none');

  grid.innerHTML = list.map(r => {
    const dots = Array.from({length: r.maxPlayers}, (_, i) =>
      `<div class="rc-dot${i < (r.players||[]).length ? ' filled' : ''}"></div>`
    ).join('');
    const statusBadge = r.status === 'playing'
      ? '<span class="badge badge-red">▶ Игра идёт</span>'
      : '<span class="badge badge-yellow">⏳ Ожидание</span>';
    const lock = r.password ? '<span class="badge badge-gray">🔒</span>' : '';
    const preset = r.preset === 'hard' ? '⚔️ Хардкор' : r.preset === 'fun' ? '😄 Весёлый' : '📖 Классика';
    return `<div class="room-card" onclick="tryJoinRoom('${esc(r.id)}')">
      <div class="rc-top">
        <div class="rc-name">${esc(r.name)}</div>
        <div class="rc-badges">${statusBadge}${lock}</div>
      </div>
      <div class="rc-info">
        <div class="rc-players"><span>${(r.players||[]).length}/${r.maxPlayers}</span>
          <div class="rc-pdots">${dots}</div></div>
        <div class="rc-meta">Хост: ${esc(r.host)} · ${preset}</div>
      </div>
    </div>`;
  }).join('');
}

function pollRoomsForLobby() {
  clearInterval(_lobbyPollTimer);
  _lobbyPollTimer = setInterval(() => {
    if (q('#lobby-view')?.classList.contains('active')) refreshRoomsList();
  }, 5000);
}

// ══════════════════════════════
// CREATE ROOM
// ══════════════════════════════
function openCreateModal() { openModal('create-modal'); }

async function createRoom() {
  const name       = q('#cr-name').value.trim() || `Игра ${G.me}`;
  const maxPlayers = parseInt(q('#cr-players').value) || 6;
  const preset     = q('#cr-preset').value;
  const password   = q('#cr-password').value.trim();
  const id         = roomCode();

  const room = {
    id, name,
    host:           G.me,
    maxPlayers,
    preset,
    password:       password || null,
    players:        [G.me],
    status:         'waiting',
    phase:          'game',
    chat:           [],
    cards:          { [G.me]: generateCard() },
    revealedFields: {},
    votes:          {},
    kicked:         [],
    created:        Date.now(),
    catastrophe:    rand(BD.catastrophes),
    bunker:         rand(BD.bunkers),
    survivors:      null,
  };

  const btn = q('#create-room-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Создаём…'; }

  const ok = await RoomsDB.save(room);
  if (btn) { btn.disabled = false; btn.textContent = '🚀 Создать'; }

  if (!ok) return toast('Ошибка создания — проверь интернет', 'error');
  closeModal('create-modal');
  toast('Комната создана! Код: ' + id, 'success');
  enterRoom(id, room);
}

// ══════════════════════════════
// JOIN ROOM
// ══════════════════════════════
let _pendingId = null;

function openJoinModal() {
  q('#jn-code').value = '';
  openModal('join-modal');
}

async function joinByCode() {
  const code = q('#jn-code').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Введи 4-символьный код', 'warn');
  const room = await RoomsDB.get(code);
  if (!room) return toast('Комната не найдена', 'error');
  closeModal('join-modal');
  tryJoinRoom(code, room);
}

async function tryJoinRoom(id, cachedRoom) {
  const room = cachedRoom || await RoomsDB.get(id);
  if (!room) return toast('Комната не найдена', 'error');

  if ((room.players||[]).includes(G.me)) { enterRoom(id, room); return; }
  if (room.status === 'playing') return toast('Игра уже идёт', 'error');
  if ((room.players||[]).length >= room.maxPlayers) return toast('Комната заполнена', 'error');
  if ((room.kicked||[]).includes(G.me)) return toast('Вас выгнали из этой комнаты', 'error');

  if (room.password) {
    _pendingId = id;
    q('#pm-pass').value = '';
    openModal('pass-modal');
  } else {
    joinRoom(id, room);
  }
}

async function submitPass() {
  const pass = q('#pm-pass').value;
  const room = await RoomsDB.get(_pendingId);
  if (!room) return;
  if (room.password !== pass) return toast('Неверный пароль', 'error');
  closeModal('pass-modal');
  joinRoom(_pendingId, room);
}

async function joinRoom(id, room) {
  const newPlayers = [...new Set([...(room.players||[]), G.me])];
  const newCards   = room.cards || {};
  if (!newCards[G.me]) newCards[G.me] = generateCard();

  await RoomsDB.update(id, { players: newPlayers, cards: newCards });
  const updated = await RoomsDB.get(id);
  enterRoom(id, updated || room);
}

// ══════════════════════════════
// ENTER / LEAVE
// ══════════════════════════════
function enterRoom(id, room) {
  G.roomId  = id;
  G.room    = room;
  G.myVote  = null;
  G.lastChatLen = (room.chat||[]).length;

  showView('room-view');
  renderRoom(room);
  startListener(id);
  requestMedia();
}

async function leaveRoom() {
  await leaveRoomCleanup();
  stopMedia();
  renderLobbyView();
  toast('Вы покинули комнату', 'info');
}

async function leaveRoomCleanup() {
  if (G.listener) { G.listener.stop(); G.listener = null; }
  if (!G.roomId) return;
  const room = await RoomsDB.get(G.roomId);
  if (!room) { G.roomId = null; return; }

  const newPlayers = (room.players||[]).filter(p => p !== G.me);
  if (newPlayers.length === 0) {
    await RoomsDB.delete(G.roomId);
  } else {
    const update = { players: newPlayers };
    if (room.host === G.me) update.host = newPlayers[0];
    await RoomsDB.update(G.roomId, update);
  }
  G.roomId = null;
  G.room   = null;
}

// ══════════════════════════════
// REALTIME LISTENER
// ══════════════════════════════
function startListener(id) {
  if (G.listener) G.listener.stop();
  G.listener = RoomsDB.listen(id, (room) => {
    if (!room) {
      // Room was deleted
      stopMedia();
      G.roomId = null;
      renderLobbyView();
      toast('Комната была закрыта', 'warn');
      return;
    }
    G.room = room;

    // Check if kicked
    if ((room.kicked||[]).includes(G.me)) {
      G.listener?.stop(); G.listener = null;
      stopMedia(); G.roomId = null;
      renderLobbyView();
      toast('Вас выгнали из бункера! 🚪', 'error', 5000);
      return;
    }

    renderRoom(room);
  });
}

// ══════════════════════════════
// RENDER ROOM
// ══════════════════════════════
function renderRoom(room) {
  if (!room) return;
  const isHost = room.host === G.me;

  // Topbar
  setTopbar(room.name,
    room.status === 'waiting' ? 'Ожидание' : room.phase === 'vote' ? 'Голосование' : 'Игра',
    room.status === 'waiting' ? 'phase-waiting' : room.phase === 'vote' ? 'phase-voting' : 'phase-playing'
  );
  q('#gtb-count') && (q('#gtb-count').textContent = `👤 ${(room.players||[]).length}/${room.maxPlayers}`);

  if (q('#top-start-btn')) q('#top-start-btn').style.display = isHost && room.status === 'waiting' ? '' : 'none';
  if (q('#vote-btn'))      q('#vote-btn').style.display      = isHost && room.status === 'playing'  ? '' : 'none';

  if (room.status === 'waiting') {
    renderWaiting(room);
  } else {
    renderPlaying(room);
  }
}

// ── WAITING ──
function renderWaiting(room) {
  const wv = q('#waiting-view');
  const pv = q('#playing-view');
  if (pv) pv.classList.remove('active');
  if (wv) wv.classList.add('active');

  setText('#wv-name', room.name);
  setText('#wv-code', room.id);

  q('#wv-players').innerHTML = (room.players||[]).map(p => `
    <div class="wp-chip ${p === G.me ? 'me' : ''} ${p === room.host ? 'host-chip' : ''}">
      <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
      <span>${esc(p)}</span>
    </div>`).join('');

  const spots = Math.floor(room.maxPlayers / 2);
  q('#wv-meta').innerHTML = `🌍 <strong>${esc(room.catastrophe?.title||'')}</strong> &nbsp;·&nbsp; 
    🏚️ <strong>${esc(room.bunker?.name||'')}</strong><br>
    ${room.preset === 'hard' ? '⚔️ Хардкор' : room.preset === 'fun' ? '😄 Весёлый' : '📖 Классика'}
    &nbsp;·&nbsp; Мест в бункере: <strong>${spots}</strong>`;

  const isHost = room.host === G.me;
  const canStart = isHost && (room.players||[]).length >= 2;
  if (q('#wv-start-btn')) q('#wv-start-btn').style.display = canStart ? '' : 'none';

  updateMediaButtons();
}

// ── PLAYING ──
function renderPlaying(room) {
  const wv = q('#waiting-view');
  const pv = q('#playing-view');
  if (wv) wv.classList.remove('active');
  if (pv) pv.classList.add('active');

  renderPlayersList(room);
  renderVideoGrid(room);
  renderCharCard(room);
  renderBunkerPanel(room);
  renderChat(room);

  if (q('#pb-reveal-all')) q('#pb-reveal-all').style.display = room.status === 'playing' ? '' : 'none';
  if (q('#pb-host-tally')) q('#pb-host-tally').style.display = room.host === G.me && room.phase === 'vote' ? '' : 'none';

  if (room.status === 'finished' && !q('#endgame-overlay')?.classList.contains('open')) {
    renderEndGame(room);
  }
}

// ── Players List ──
function renderPlayersList(room) {
  const el = q('#players-list');
  if (!el) return;
  const isHost = room.host === G.me;
  el.innerHTML = (room.players||[]).map(p => {
    const kicked  = (room.kicked||[]).includes(p);
    const isMe    = p === G.me;
    const isRHost = p === room.host;
    return `<div class="player-item ${isMe?'is-me':''} ${isRHost?'is-host':''} ${kicked?'kicked':''}">
      <div class="pi-cam no-cam" id="pi-cam-${p}">📷</div>
      <div class="pi-info">
        <div class="pi-name">${esc(p)}${isMe?' <span style="color:var(--accent);font-size:.6rem;">(Я)</span>':''}</div>
        <div class="pi-status">${kicked?'🚫 Выгнан':isRHost?'👑 Хост':'● Онлайн'}</div>
      </div>
      ${isHost && !isMe && !kicked
        ? `<div class="pi-kick" onclick="kickPlayer('${esc(p)}')" title="Выгнать">✕</div>` : ''}
    </div>`;
  }).join('');
  setTimeout(attachLocalCam, 60);
}

// ── Video Grid ──
function renderVideoGrid(room) {
  const grid = q('#video-grid');
  if (!grid) return;
  const n = Math.min((room.players||[]).length, 10);
  grid.className = `video-grid vg-${n}`;

  const current  = new Set(room.players||[]);
  const existing = new Set([...grid.querySelectorAll('.video-tile')].map(t => t.dataset.pid));
  existing.forEach(p => { if (!current.has(p)) q(`[data-pid="${p}"]`)?.remove(); });

  (room.players||[]).forEach(p => {
    if (q(`[data-pid="${p}"]`)) return;
    const tile = document.createElement('div');
    tile.className = `video-tile${p === G.me ? ' is-me-tile' : ''}`;
    tile.dataset.pid = p;
    tile.innerHTML = `
      <video id="vtile-${p}" autoplay muted playsinline></video>
      <div class="tile-no-cam" id="nocam-${p}">
        <div class="avatar avatar-lg" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
        <div style="font-size:.7rem;color:var(--muted2);margin-top:4px">${esc(p)}</div>
      </div>
      <div class="tile-icons"><div class="tile-icon" id="vmic-${p}">🎤</div></div>
      <div class="tile-name">${esc(p)}${p===G.me?' (Я)':''}</div>`;
    grid.appendChild(tile);
  });
  setTimeout(attachLocalCam, 60);
}

function attachLocalCam() {
  if (!G.localStream || !G.me) return;
  const vid = q(`#vtile-${G.me}`);
  if (vid && vid.srcObject !== G.localStream) { vid.srcObject = G.localStream; vid.muted = true; }
  const hasVideo = G.camOn && G.localStream.getVideoTracks().some(t => t.readyState === 'live');
  const nocam = q(`#nocam-${G.me}`);
  if (nocam) nocam.style.display = hasVideo ? 'none' : 'flex';
}

// ── Char Card ──
function renderCharCard(room) {
  const el = q('#char-card-container');
  if (!el) return;
  const card = room.cards?.[G.me];
  if (!card) { el.innerHTML = '<div style="padding:16px;color:var(--muted)">Карточка недоступна</div>'; return; }

  const revealed  = room.revealedFields?.[G.me] || [];
  const isPlaying = room.status === 'playing';

  let html = `<div class="char-card">
    <div class="cc-header">
      <h4>🃏 Моя карточка</h4>
      <span class="cc-progress">${revealed.length}/${CARD_KEYS.length}</span>
    </div><div class="cc-body">`;

  CARD_KEYS.forEach(k => {
    const rev = revealed.includes(k);
    const val = fieldVal(card, k);
    html += `<div class="cc-row">
      <div class="cc-key">${fieldLabel(k)}</div>
      <div class="cc-val">
        ${rev ? `<span>${esc(val)}</span>`
              : isPlaying
                ? `<span class="cc-hidden">Скрыто</span><button class="reveal-btn" onclick="revealField('${k}')">Раскрыть</button>`
                : `<span style="color:var(--muted2)">${esc(val)}</span>`}
      </div></div>`;
  });
  html += `</div></div>`;

  // Others
  const others = (room.players||[]).filter(p => p !== G.me && (room.revealedFields?.[p]?.length||0) > 0);
  if (others.length) {
    html += `<div class="others-revealed">`;
    others.forEach(p => {
      const pr = room.revealedFields[p] || [];
      const pc = room.cards?.[p];
      if (!pc || !pr.length) return;
      html += `<div class="or-block">
        <div class="or-name">
          <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
          ${esc(p)} ${(room.kicked||[]).includes(p) ? '<span style="color:var(--red);font-size:.7rem;">🚫</span>' : ''}
        </div>
        <div class="or-fields">
          ${pr.map(k => `<div class="or-field">${fieldLabel(k)}: <span>${esc(fieldVal(pc,k))}</span></div>`).join('')}
        </div></div>`;
    });
    html += `</div>`;
  }
  el.innerHTML = html;
}

// ── Bunker Panel ──
function renderBunkerPanel(room) {
  const el = q('#bunker-panel-content');
  if (!el) return;
  const c = room.catastrophe || {};
  const b = room.bunker || {};
  const alive = (room.players||[]).filter(p => !(room.kicked||[]).includes(p));
  const spots = Math.floor(room.maxPlayers / 2);

  el.innerHTML = `
    <div class="info-block">
      <div class="info-block-title">🌍 Катастрофа</div>
      <div class="info-block-value highlight">${esc(c.title||'')}</div>
      <div style="font-size:.8rem;color:var(--muted2);margin-top:6px;line-height:1.6">${esc(c.desc||'')}</div>
      <div style="display:flex;gap:12px;margin-top:8px;font-size:.76rem;">
        <span>☢️ ${'🔴'.repeat(c.danger||0)}${'⬜'.repeat(5-(c.danger||0))}</span>
        <span>⏱️ ${c.years||0} лет</span>
      </div>
    </div>
    <div class="bunker-card">
      <div class="bc-header">🏚️ ${esc(b.name||'')}</div>
      ${Object.entries(b).filter(([k])=>k!=='name').map(([k,v])=>`
        <div class="bc-row"><div class="bc-key">${esc(k)}</div><div class="bc-val">${esc(v)}</div></div>`).join('')}
    </div>
    <div class="info-block">
      <div class="info-block-title">📊 Расклад</div>
      <div style="font-size:.85rem;color:var(--text2);line-height:1.9">
        Игроков: <strong style="color:var(--text)">${(room.players||[]).length}</strong><br>
        Мест в бункере: <strong style="color:var(--green)">${spots}</strong><br>
        Нужно выгнать: <strong style="color:var(--red)">${Math.max(0,alive.length-spots)}</strong><br>
        Живых: <strong style="color:var(--text)">${alive.length}</strong>
      </div>
    </div>`;
}

// ── Chat ──
function renderChat(room) {
  const el = q('#chat-messages');
  if (!el) return;
  const msgs = room.chat || [];
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

  // Chat notification
  if (msgs.length > G.lastChatLen) {
    const dot = q('#rtab-chat .notif-dot');
    if (dot && !q('#rtab-chat')?.classList.contains('active')) dot.classList.add('show');
  }
  G.lastChatLen = msgs.length;

  el.innerHTML = msgs.slice(-120).map(m => {
    if (m.system) return `<div class="chat-msg system-line">
      <span class="cm-sys">🔔 ${esc(m.text)}</span>
      <span class="cm-time">${m.time}</span></div>`;
    const isMe = m.author === G.me;
    return `<div class="chat-msg ${isMe?'is-mine':''}">
      <div class="avatar avatar-sm" style="background:${avatarColor(m.author)};flex-shrink:0">${avatarLetter(m.author)}</div>
      <div class="cm-bubble ${isMe?'mine':''}">
        <div class="cm-author" style="color:${avatarColor(m.author)}">${esc(m.author)}</div>
        <div class="cm-text">${esc(m.text)}</div>
        <span class="cm-time">${m.time}</span>
      </div></div>`;
  }).join('');
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ── End Game ──
function renderEndGame(room) {
  const ov = q('#endgame-overlay');
  if (!ov || ov.classList.contains('open')) return;
  ov.classList.add('open');
  const isAlive = (room.survivors||[]).includes(G.me);
  setText('#eg-emoji', isAlive ? '🎉' : '☠️');
  q('#eg-title').className = `eg-title ${isAlive ? 'win' : 'lose'}`;
  setText('#eg-title', isAlive ? 'Вы выжили!' : 'Вы выгнаны!');
  setText('#eg-desc', isAlive
    ? `Бункер выстоял! ${(room.survivors||[]).length} человек пережили катастрофу.`
    : 'Не хватило места в бункере.');
  q('#eg-survivors').innerHTML = (room.survivors||[]).map(p => `
    <div class="eg-survivor">
      <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>${esc(p)}
    </div>`).join('');
  q('#eg-kicked').innerHTML = (room.kicked||[]).map(p => `
    <div class="eg-kick-item">
      <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div><s>${esc(p)}</s>
    </div>`).join('');
}

// ══════════════════════════════
// GAME ACTIONS
// ══════════════════════════════
async function startGame() {
  const room = G.room;
  if (!room || room.host !== G.me) return;
  if ((room.players||[]).length < 2) return toast('Нужно минимум 2 игрока', 'warn');
  await pushChatMsg(G.roomId, { system: true, text: '🚀 Игра началась! Представьте свои карточки по кругу.', time: nowTime() });
  await RoomsDB.update(G.roomId, { status: 'playing', phase: 'game' });
}

async function revealField(key) {
  const room = G.room;
  if (!room || room.status !== 'playing') return;
  const revealed = room.revealedFields?.[G.me] || [];
  if (revealed.includes(key)) return;
  const newRevealed = [...revealed, key];
  const val = fieldVal(room.cards[G.me], key);
  await pushChatMsg(G.roomId, { system: true, text: `${G.me} раскрыл ${fieldLabel(key)}: ${val}`, time: nowTime() });
  await RoomsDB.update(G.roomId, { [`revealedFields/${G.me}`]: newRevealed });
}

async function revealAllMyCard() {
  const room = G.room;
  if (!room || room.status !== 'playing') return;
  const existing = room.revealedFields?.[G.me] || [];
  const all = CARD_KEYS.filter(k => !existing.includes(k));
  if (!all.length) { toast('Всё уже раскрыто', 'info'); return; }
  await pushChatMsg(G.roomId, { system: true, text: `${G.me} раскрыл всю карточку!`, time: nowTime() });
  await RoomsDB.update(G.roomId, { [`revealedFields/${G.me}`]: CARD_KEYS });
}

async function kickPlayer(player) {
  if (!confirm(`Выгнать "${player}" из бункера?`)) return;
  const room = await RoomsDB.get(G.roomId);
  if (!room || room.host !== G.me) return;
  const kicked  = [...(room.kicked||[]), player];
  const players = (room.players||[]).filter(p => p !== player);
  await pushChatMsg(G.roomId, { system: true, text: `⚠️ ${player} выгнан из бункера!`, time: nowTime() });

  const alive  = players.filter(p => !kicked.includes(p));
  const spots  = Math.floor(room.maxPlayers / 2);
  const update = { kicked, players };

  if (alive.length <= spots) {
    update.status    = 'finished';
    update.survivors = alive;
    await pushChatMsg(G.roomId, { system: true, text: `🏆 Конец игры! Выжившие: ${alive.join(', ')}`, time: nowTime() });
  }
  await RoomsDB.update(G.roomId, update);
  toast(`${player} выгнан!`, 'info');
}

async function sendChat() {
  const input = q('#chat-input');
  const text  = input?.value.trim();
  if (!text || text.length > 300) return;
  input.value = '';
  await pushChatMsg(G.roomId, { author: G.me, text, time: nowTime() });
}

async function pushChatMsg(id, msg) {
  const room = await RoomsDB.get(id);
  if (!room) return;
  const chat = [...(room.chat||[]), msg].slice(-200);
  await RoomsDB.update(id, { chat });
}

// ══════════════════════════════
// VOTING
// ══════════════════════════════
function openVote() {
  const room = G.room;
  if (!room || room.status !== 'playing') return toast('Игра не началась', 'warn');
  G.myVote = null;
  q('#vote-results-section').style.display = 'none';
  q('#confirm-vote-btn').disabled = true;
  renderVoteList(room);
  openModal('vote-overlay');
}
function closeVote() { closeModal('vote-overlay'); }

function renderVoteList(room) {
  const alive  = (room.players||[]).filter(p => !(room.kicked||[]).includes(p) && p !== G.me);
  const votes  = room.votes || {};
  const total  = Object.keys(votes).length;
  const counts = {};
  Object.values(votes).forEach(v => { counts[v] = (counts[v]||0) + 1; });

  q('#vote-list').innerHTML = alive.map(p => {
    const vc  = counts[p] || 0;
    const pct = total ? Math.round(vc/total*100) : 0;
    return `<div class="vote-item ${G.myVote===p?'selected':''}" onclick="selectVote('${esc(p)}',this)">
      <div class="vote-bar" style="width:${pct}%"></div>
      <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
      <div class="vote-pname">${esc(p)}</div>
      <div class="vote-count">${vc} гол.</div>
      <div class="vote-pct">${pct?pct+'%':''}</div>
    </div>`;
  }).join('');
}

function selectVote(player, el) {
  G.myVote = player;
  qAll('.vote-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  q('#confirm-vote-btn').disabled = false;
}

async function confirmVote() {
  if (!G.myVote) return;
  const room = await RoomsDB.get(G.roomId);
  if (!room) return;
  const votes = { ...(room.votes||{}), [G.me]: G.myVote };
  await RoomsDB.update(G.roomId, { votes });
  q('#confirm-vote-btn').disabled = true;
  toast(`Ты проголосовал за ${G.myVote}`, 'info');

  // Auto-tally when all voted
  const alive  = (room.players||[]).filter(p => !(room.kicked||[]).includes(p));
  const voted  = Object.keys(votes).length;
  if (room.host === G.me && voted >= alive.length) {
    await tallyVotes(votes);
  }
}

async function hostTallyVotes() {
  const room = G.room;
  if (!room || room.host !== G.me) return toast('Только хост', 'warn');
  await tallyVotes(room.votes || {});
}

async function tallyVotes(votes) {
  const counts = {};
  Object.values(votes).forEach(v => { counts[v] = (counts[v]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);

  q('#vote-results-section').style.display = 'block';
  q('#vote-results-list').innerHTML = sorted.map(([name,cnt],i) => `
    <div class="vote-result-item ${i===0?'loser':''}">
      <div class="avatar avatar-sm" style="background:${avatarColor(name)}">${avatarLetter(name)}</div>
      <div class="vri-name">${esc(name)}</div>
      <div class="vri-count">${cnt} гол.</div>
      ${i===0?'<div class="vri-label">🚫 Выгнан</div>':''}
    </div>`).join('');

  // Reset votes
  await RoomsDB.update(G.roomId, { votes: {} });

  if (sorted.length) {
    const loser = sorted[0][0];
    toast(`${loser} будет выгнан...`, 'error', 2000);
    setTimeout(async () => {
      closeVote();
      await kickPlayer(loser);
    }, 1600);
  }
}

// ══════════════════════════════
// MEDIA
// ══════════════════════════════
async function requestMedia() {
  try {
    G.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    G.micOn = true; G.camOn = true;
    updateMediaButtons(); attachLocalCam();
    toast('📹 Камера и микрофон подключены', 'success', 2500);
  } catch {
    try {
      G.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      G.micOn = true; G.camOn = false;
      updateMediaButtons();
      toast('🎤 Только микрофон', 'info', 2000);
    } catch {
      toast('⚠️ Нет доступа к камере/микрофону', 'warn', 3000);
    }
  }
}

function stopMedia() {
  G.localStream?.getTracks().forEach(t => t.stop());
  G.localStream = null; G.micOn = false; G.camOn = false;
}

function toggleMic() {
  if (!G.localStream) { requestMedia(); return; }
  G.micOn = !G.micOn;
  G.localStream.getAudioTracks().forEach(t => t.enabled = G.micOn);
  updateMediaButtons();
  toast(G.micOn ? '🎤 Микрофон включён' : '🔇 Микрофон выключен', 'info', 1500);
}

function toggleCam() {
  if (!G.localStream) { requestMedia(); return; }
  G.camOn = !G.camOn;
  G.localStream.getVideoTracks().forEach(t => t.enabled = G.camOn);
  attachLocalCam(); updateMediaButtons();
  toast(G.camOn ? '📹 Камера включена' : '🚫 Камера выключена', 'info', 1500);
}

function updateMediaButtons() {
  const set = (id, on, onTxt, offTxt) => {
    const el = q(id);
    if (!el) return;
    el.textContent = on ? onTxt : offTxt;
    el.classList.toggle('muted-btn', !on);
  };
  set('#ctrl-mic', G.micOn, '🎤', '🔇');
  set('#ctrl-cam', G.camOn, '📹', '🚫');
  const wm = q('#wv-mic-btn'); if (wm) { wm.innerHTML = G.micOn ? '🎤 Мик вкл' : '🔇 Мик выкл'; wm.style.color = G.micOn ? '' : 'var(--red)'; }
  const wc = q('#wv-cam-btn'); if (wc) { wc.innerHTML = G.camOn ? '📹 Кам вкл' : '🚫 Кам выкл'; wc.style.color = G.camOn ? '' : 'var(--red)'; }
}

// ══════════════════════════════
// UI HELPERS
// ══════════════════════════════
function showView(id) {
  qAll('.game-view').forEach(el => el.classList.remove('active'));
  q('#' + id)?.classList.add('active');
  if (id === 'room-view') {
    q('#waiting-view')?.classList.remove('active');
    q('#playing-view')?.classList.remove('active');
  }
}

function setTopbar(name, phase, cls) {
  setText('#gtb-room-name', name);
  const ph = q('#gtb-phase');
  if (ph) { ph.textContent = phase; ph.className = `gtb-phase-badge ${cls}`; }
}

function switchRightTab(tab) {
  ['card','chat','bunker'].forEach(t => {
    q(`#rtab-${t}`)?.classList.toggle('active', t === tab);
    q(`#rpanel-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'chat') {
    q('#rtab-chat .notif-dot')?.classList.remove('show');
  }
}

function copyRoomCode() {
  const code = q('#wv-code')?.textContent;
  if (code) { navigator.clipboard.writeText(code).catch(()=>{}); toast('Код скопирован: ' + code, 'success', 2000); }
}

// ══════════════════════════════
// DOM UTILS
// ══════════════════════════════
const q    = sel => document.querySelector(sel);
const qAll = sel => document.querySelectorAll(sel);
const setText = (sel, val) => { const el = q(sel); if (el) el.textContent = val; };

function openModal(id)  { q('#'+id)?.classList.add('open');    }
function closeModal(id) { q('#'+id)?.classList.remove('open'); }

function toast(msg, type = 'info', dur = 3200) {
  const icons = { success:'✅', error:'❌', info:'ℹ️', warn:'⚠️' };
  const container = q('#toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity='0'; el.style.transform='translateX(120%)'; }, dur - 400);
  setTimeout(() => el.remove(), dur);
}

// ══════════════════════════════
// LANDING PAGE (index.js logic)
// ══════════════════════════════
let _authMode = 'login';
function authTab(mode) {
  _authMode = mode;
  qAll('.auth-tab').forEach((t,i) => t.classList.toggle('active',(i===0&&mode==='login')||(i===1&&mode==='register')));
  q('#login-form')?.classList.toggle('hidden', mode !== 'login');
  q('#reg-form')?.classList.toggle('hidden',   mode !== 'register');
  if (q('#auth-hint')) q('#auth-hint').innerHTML = mode === 'login'
    ? `Нет аккаунта? <a href="#" onclick="authTab('register');return false">Зарегистрироваться</a>`
    : `Есть аккаунт? <a href="#" onclick="authTab('login');return false">Войти</a>`;
}

function openAuthModal(mode) { openModal('auth-modal'); setTimeout(() => authTab(mode||'login'), 10); }

function goToGame() {
  if (G.me) window.location.href = 'game.html';
  else openAuthModal('login');
}

async function initLandingPage() {
  updateNavUI();
  // nav scroll
  const nav = q('.nav');
  window.addEventListener('scroll', () => nav?.classList.toggle('scrolled', scrollY > 20), { passive: true });
  // scroll animations
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.style.opacity='1'; e.target.style.transform='translateY(0)'; } });
  }, { threshold: 0.1 });
  qAll('.step-card,.feature-card,.role-card,.disaster-card').forEach(el => {
    el.style.cssText += 'opacity:0;transform:translateY(20px);transition:opacity .5s,transform .5s';
    io.observe(el);
  });
  // live rooms
  await updateLandingStats();
  setInterval(updateLandingStats, 6000);
}

async function updateLandingStats() {
  const rooms   = await RoomsDB.getAll();
  const list    = Object.values(rooms);
  const playing = list.filter(r => r.status === 'playing').length;
  const waiting = list.filter(r => r.status === 'waiting').length;
  const players = list.reduce((s, r) => s + (r.players||[]).length, 0);

  setText('#stat-rooms',   list.length);
  setText('#stat-playing', playing);
  setText('#stat-waiting', waiting);
  setText('#stat-players', players);

  const preview = q('#live-rooms-preview');
  if (!preview) return;
  if (!list.length) {
    preview.innerHTML = `<div style="color:var(--muted);font-size:.85rem;text-align:center;padding:16px 0">
      Нет активных игр — <a href="#" onclick="goToGame();return false" style="color:var(--accent)">создай первую!</a></div>`;
    return;
  }
  preview.innerHTML = list.slice(0,4).map(r => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);margin-bottom:6px">
      <div style="width:8px;height:8px;border-radius:50%;background:${r.status==='playing'?'var(--green)':'var(--yellow)'};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</div>
        <div style="font-size:.7rem;color:var(--muted2)">Хост: ${esc(r.host)} · ${(r.players||[]).length}/${r.maxPlayers}</div>
      </div>
      <span class="badge ${r.status==='playing'?'badge-green':'badge-yellow'}" style="font-size:.62rem">${r.status==='playing'?'▶ Игра':'⏳ Ждут'}</span>
    </div>`).join('');
}

// ══════════════════════════════
// KEYBOARD
// ══════════════════════════════
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') qAll('.overlay.open').forEach(el => el.classList.remove('open'));
});
document.addEventListener('DOMContentLoaded', () => {
  q('#chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }});
  q('#jn-code')?.addEventListener('input',   e => { e.target.value = e.target.value.toUpperCase(); });
  q('#jn-code')?.addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode(); });
  q('#pm-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitPass(); });
  q('#li-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  q('#rg-pass2')?.addEventListener('keydown',e => { if (e.key === 'Enter') doRegister(); });
  q('#cr-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
  initApp();
});
