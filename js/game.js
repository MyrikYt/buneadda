/* ═══════════════════════════════════════════════════════════
   game.js — основная игровая логика
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ══════════════════════════════
   STATE
══════════════════════════════ */
const G = {
  roomId:      null,
  localStream: null,
  micOn:       false,
  camOn:       false,
  myVote:      null,
  syncTimer:   null,
  lastChatLen: 0,
};

/* ══════════════════════════════
   ENTRY
══════════════════════════════ */
function initGamePage() {
  if (!initAuth()) { window.location.href = 'index.html'; return; }
  updateNavUser();
  renderLobbyView();
  autoRefreshLobby();
}

function updateNavUser() {
  const me = getMe();
  const avEl = document.getElementById('nav-avatar');
  const nmEl = document.getElementById('nav-username');
  if (avEl) { avEl.textContent = avatarLetter(me); avEl.style.background = avatarColor(me); }
  if (nmEl) nmEl.textContent = me;
}

/* ══════════════════════════════
   LOBBY VIEW
══════════════════════════════ */
function renderLobbyView() {
  showGameView('lobby-view');
  updateGTB({ roomName: '', phase: '', playerCount: '' });
  refreshRoomsList();
}

function refreshRoomsList() {
  const rooms = Object.values(getRooms()).sort((a, b) => b.created - a.created);
  const grid = document.getElementById('rooms-grid');
  const empty = document.getElementById('rooms-empty');
  if (!grid) return;

  if (!rooms.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = rooms.map(r => {
    const dots = Array.from({ length: r.maxPlayers }, (_, i) =>
      `<div class="rc-dot${i < r.players.length ? ' filled' : ''}"></div>`
    ).join('');
    const statusBadge = r.status === 'playing'
      ? '<span class="badge badge-red">▶ Идёт игра</span>'
      : '<span class="badge badge-yellow">⏳ Ожидание</span>';
    const lockBadge = r.password ? '<span class="badge badge-gray">🔒</span>' : '';
    const preset = r.preset === 'hard' ? '⚔️ Хардкор' : r.preset === 'fun' ? '😄 Весёлый' : '📖 Классика';

    return `<div class="room-card" onclick="tryJoinRoom('${r.id}')">
      <div class="rc-top">
        <div class="rc-name">${escHtml(r.name)}</div>
        <div class="rc-badges">${statusBadge}${lockBadge}</div>
      </div>
      <div class="rc-info">
        <div class="rc-players">
          <span>${r.players.length}/${r.maxPlayers}</span>
          <div class="rc-pdots">${dots}</div>
        </div>
        <div class="rc-meta">Хост: ${escHtml(r.host)} · ${preset}</div>
      </div>
    </div>`;
  }).join('');
}

function autoRefreshLobby() {
  setInterval(() => {
    const lv = document.getElementById('lobby-view');
    if (lv && lv.classList.contains('active')) refreshRoomsList();
  }, 4000);
}

/* ══════════════════════════════
   CREATE ROOM
══════════════════════════════ */
function openCreateModal() { openModal('create-modal'); }

function createRoom() {
  const name      = document.getElementById('cr-name').value.trim() || `Игра ${getMe()}`;
  const maxPlayers = parseInt(document.getElementById('cr-players').value) || 6;
  const preset    = document.getElementById('cr-preset').value;
  const password  = document.getElementById('cr-password').value.trim();
  const randD = arr => arr[Math.floor(Math.random() * arr.length)];

  const id = roomCode();
  const room = {
    id, name,
    host:       getMe(),
    maxPlayers,
    preset,
    password:   password || null,
    players:    [getMe()],
    status:     'waiting',
    phase:      'lobby',
    chat:       [],
    cards:      {},
    revealedFields: {},
    votes:      {},
    kicked:     [],
    created:    Date.now(),
    catastrophe: randD(BunkerData.catastrophes),
    bunker:      randD(BunkerData.bunkers),
    survivors:   null,
    roundInfo:   '',
  };
  room.cards[getMe()] = generateCard();

  saveRoom(room);
  closeModal('create-modal');
  showToast('Комната создана! Код: ' + id, 'success');
  enterRoom(id);
}

/* ══════════════════════════════
   JOIN ROOM
══════════════════════════════ */
let _pendingJoinId = null;

function openJoinModal() {
  document.getElementById('jn-code').value = '';
  openModal('join-modal');
}

function joinByCode() {
  const code = document.getElementById('jn-code').value.trim().toUpperCase();
  if (!code) return showToast('Введи код комнаты', 'warn');
  const room = getRoom(code);
  if (!room) return showToast('Комната не найдена', 'error');
  closeModal('join-modal');
  tryJoinRoom(code);
}

function tryJoinRoom(id) {
  const room = getRoom(id);
  if (!room) return showToast('Комната не найдена', 'error');
  if (room.players.includes(getMe())) { enterRoom(id); return; }
  if (room.status === 'playing') return showToast('Игра уже идёт', 'error');
  if (room.players.length >= room.maxPlayers) return showToast('Комната заполнена', 'error');
  if (room.kicked && room.kicked.includes(getMe())) return showToast('Вас выгнали из этой комнаты', 'error');

  if (room.password) {
    _pendingJoinId = id;
    document.getElementById('pm-pass').value = '';
    openModal('pass-modal');
  } else {
    joinRoom(id);
  }
}

function submitPass() {
  const pass = document.getElementById('pm-pass').value;
  const room = getRoom(_pendingJoinId);
  if (!room) return;
  if (room.password !== pass) return showToast('Неверный пароль', 'error');
  closeModal('pass-modal');
  joinRoom(_pendingJoinId);
}

function joinRoom(id) {
  const rooms = getRooms();
  const room  = rooms[id];
  if (!room) return showToast('Комната не найдена', 'error');
  if (!room.players.includes(getMe())) room.players.push(getMe());
  if (!room.cards[getMe()]) room.cards[getMe()] = generateCard();
  saveRooms(rooms);
  enterRoom(id);
}

/* ══════════════════════════════
   ENTER / LEAVE ROOM
══════════════════════════════ */
function enterRoom(id) {
  G.roomId = id;
  G.myVote = null;
  G.lastChatLen = 0;
  const room = getRoom(id);
  if (!room) return;

  showGameView('room-view');
  if (room.status === 'waiting') {
    renderWaitingView(room);
  } else {
    renderPlayingView(room);
  }
  startSync();
  requestMedia();
}

function leaveRoom() {
  stopSync();
  stopMedia();
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (room) {
    room.players = room.players.filter(p => p !== getMe());
    if (room.players.length === 0) {
      delete rooms[G.roomId];
    } else if (room.host === getMe()) {
      room.host = room.players[0];
    }
    saveRooms(rooms);
  }
  G.roomId = null;
  renderLobbyView();
  showToast('Вы покинули комнату', 'info');
}

/* ══════════════════════════════
   SYNC
══════════════════════════════ */
function startSync() {
  stopSync();
  G.syncTimer = setInterval(syncRoom, 1800);
}
function stopSync() {
  clearInterval(G.syncTimer);
  G.syncTimer = null;
}

function syncRoom() {
  const room = getRoom(G.roomId);
  if (!room) { stopSync(); renderLobbyView(); showToast('Комната закрыта', 'warn'); return; }
  if (room.kicked && room.kicked.includes(getMe())) {
    stopSync(); stopMedia(); G.roomId = null;
    renderLobbyView(); showToast('Вас выгнали из бункера! 🚪', 'error', 5000); return;
  }
  if (room.status === 'waiting') {
    renderWaitingView(room);
  } else {
    renderPlayingView(room);
  }
  // Chat notification
  const newLen = (room.chat || []).length;
  const chatTab = document.getElementById('rtab-chat');
  if (chatTab && !chatTab.classList.contains('active') && newLen > G.lastChatLen) {
    const dot = chatTab.querySelector('.notif-dot');
    if (dot) dot.classList.add('show');
  }
  G.lastChatLen = newLen;
}

/* ══════════════════════════════
   RENDER: WAITING VIEW
══════════════════════════════ */
function renderWaitingView(room) {
  const wv = document.getElementById('waiting-view');
  if (!wv || !wv.classList.contains('active')) {
    document.getElementById('playing-view')?.classList.remove('active');
    wv?.classList.add('active');
  }
  updateGTB({
    roomName: room.name,
    phase: 'Ожидание',
    phaseClass: 'phase-waiting',
    playerCount: `${room.players.length}/${room.maxPlayers}`
  });

  document.getElementById('wv-room-name').textContent = room.name;
  document.getElementById('wv-room-code').textContent = room.id;

  // Players chips
  document.getElementById('wv-players').innerHTML = room.players.map(p => `
    <div class="wp-chip ${p === getMe() ? 'me' : ''} ${p === room.host ? 'host-chip' : ''}">
      <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
      <span class="wp-name">${escHtml(p)}</span>
    </div>
  `).join('');

  // Meta info
  const c = room.catastrophe;
  const b = room.bunker;
  document.getElementById('wv-meta').innerHTML =
    `🌍 <strong>${c.title}</strong> · 🏚️ <strong>${b.name}</strong><br>
     ${room.preset === 'hard' ? '⚔️ Хардкор' : room.preset === 'fun' ? '😄 Весёлый' : '📖 Классика'} · 
     Мест в бункере: <strong>${Math.floor(room.maxPlayers / 2)}</strong>`;

  // Buttons
  const isHost = room.host === getMe();
  const canStart = isHost && room.players.length >= 2;
  const startBtn = document.getElementById('wv-start-btn');
  const topStart = document.getElementById('top-start-btn');
  if (startBtn) { startBtn.style.display = canStart ? '' : 'none'; }
  if (topStart) { topStart.style.display = canStart ? '' : 'none'; }

  updateMediaButtons();
}

/* ══════════════════════════════
   RENDER: PLAYING VIEW
══════════════════════════════ */
function renderPlayingView(room) {
  // Switch views
  const pv = document.getElementById('playing-view');
  document.getElementById('waiting-view')?.classList.remove('active');
  if (pv && !pv.classList.contains('active')) pv.classList.add('active');

  // GTB
  updateGTB({
    roomName: room.name,
    phase: room.phase === 'vote' ? 'Голосование' : 'Игра',
    phaseClass: room.phase === 'vote' ? 'phase-voting' : 'phase-playing',
    playerCount: `${room.players.length}/${room.maxPlayers}`
  });

  // Phase banner
  document.getElementById('phase-banner-text').innerHTML =
    `<strong>Знакомство</strong> — каждый игрок раскрывает свои карты по очереди`;

  const isHost = room.host === getMe();
  document.getElementById('vote-start-btn').style.display = isHost ? '' : 'none';

  // Render sub-parts
  renderPlayersList(room);
  renderVideoGrid(room);
  renderCharCard(room);
  renderBunkerPanel(room);
  renderChatMessages(room);

  // Check end game
  if (room.status === 'finished') {
    renderEndGame(room);
  }
}

/* ── Players list ── */
function renderPlayersList(room) {
  const el = document.getElementById('players-list');
  if (!el) return;
  const isHost = room.host === getMe();

  el.innerHTML = room.players.map(p => {
    const isKicked = room.kicked?.includes(p);
    const isMe = p === getMe();
    const isRoomHost = p === room.host;
    return `<div class="player-item ${isMe ? 'is-me' : ''} ${isRoomHost ? 'is-host' : ''} ${isKicked ? 'kicked' : ''}">
      <div class="pi-cam no-cam" id="pi-cam-${p}">📷</div>
      <div class="pi-info">
        <div class="pi-name">${escHtml(p)}${isMe ? ' <span style="color:var(--accent);font-size:.65rem;">(Я)</span>' : ''}</div>
        <div class="pi-status">${isKicked ? '🚫 Выгнан' : isRoomHost ? '👑 Хост' : '● Онлайн'}</div>
      </div>
      <div class="pi-icons">
        <span class="pi-icon" id="pi-mic-${p}">🎤</span>
      </div>
      ${isHost && !isMe && !isKicked
        ? `<div class="pi-kick" onclick="kickPlayer('${escHtml(p)}')" title="Выгнать">✕</div>` : ''}
    </div>`;
  }).join('');

  // attach local stream cam
  setTimeout(() => attachLocalCam(), 100);
}

/* ── Video grid ── */
function renderVideoGrid(room) {
  const grid = document.getElementById('video-grid');
  if (!grid) return;
  const n = Math.min(room.players.length, 10);
  grid.className = `video-grid vg-${n}`;

  // Only rebuild if players changed
  const existing = new Set([...grid.querySelectorAll('.video-tile')].map(t => t.dataset.pid));
  const current  = new Set(room.players);
  const toRemove = [...existing].filter(p => !current.has(p));
  const toAdd    = [...current].filter(p => !existing.has(p));

  toRemove.forEach(p => grid.querySelector(`[data-pid="${p}"]`)?.remove());

  toAdd.forEach(p => {
    const tile = document.createElement('div');
    tile.className = `video-tile ${p === getMe() ? 'is-me-tile' : ''}`;
    tile.dataset.pid = p;
    tile.innerHTML = `
      <video id="vtile-vid-${p}" autoplay muted playsinline></video>
      <div class="tile-no-cam" id="vtile-nocam-${p}">
        <div class="avatar avatar-lg" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
        <div style="font-size:.72rem;color:var(--muted2);margin-top:4px;">${escHtml(p)}</div>
      </div>
      <div class="tile-icons">
        <div class="tile-icon" id="vtile-mic-${p}">🎤</div>
      </div>
      <div class="tile-name">${escHtml(p)}${p === getMe() ? ' (Я)' : ''}</div>
    `;
    grid.appendChild(tile);
  });

  setTimeout(() => attachLocalCam(), 80);
}

function attachLocalCam() {
  if (!G.localStream || !G.roomId) return;
  const me = getMe();
  const vid = document.getElementById(`vtile-vid-${me}`);
  if (vid && vid.srcObject !== G.localStream) {
    vid.srcObject = G.localStream;
    vid.muted = true;
  }
  const hasVideo = G.camOn && G.localStream.getVideoTracks().some(t => t.readyState === 'live');
  const nocam = document.getElementById(`vtile-nocam-${me}`);
  if (nocam) nocam.style.display = hasVideo ? 'none' : 'flex';
}

/* ── Char card ── */
function renderCharCard(room) {
  const me = getMe();
  const card = room.cards?.[me];
  const el = document.getElementById('char-card-container');
  if (!el) return;
  if (!card) { el.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:.85rem;">Карточка не найдена</div>'; return; }

  const revealed = room.revealedFields?.[me] || [];
  const keys = ['gender','age','size','profession','hobby','health','trait','phobia','extra'];
  const isPlaying = room.status === 'playing';

  let html = `<div class="char-card">
    <div class="cc-header">
      <h4>🃏 Твоя карточка</h4>
      <span class="cc-progress">${revealed.length}/${keys.length}</span>
    </div>
    <div class="cc-body">`;
  keys.forEach(k => {
    const isRev = revealed.includes(k);
    const val   = fieldValue(card, k);
    html += `<div class="cc-row">
      <div class="cc-key">${fieldLabel(k)}</div>
      <div class="cc-val">
        ${isRev
          ? `<span>${escHtml(val)}</span>`
          : isPlaying
            ? `<span class="cc-hidden">Скрыто</span><button class="reveal-btn" onclick="revealField('${k}')">Раскрыть</button>`
            : `<span style="color:var(--muted2)">${escHtml(val)}</span>`
        }
      </div>
    </div>`;
  });
  html += `</div></div>`;

  // Others' revealed info
  const others = room.players.filter(p => p !== me && (room.revealedFields?.[p]?.length || 0) > 0);
  if (others.length) {
    html += `<div class="others-revealed">`;
    others.forEach(p => {
      const pRev = room.revealedFields?.[p] || [];
      const pCard = room.cards?.[p];
      if (!pCard || !pRev.length) return;
      html += `<div class="or-block">
        <div class="or-name">
          <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
          ${escHtml(p)}
          ${room.kicked?.includes(p) ? '<span style="color:var(--red);font-size:.7rem;">🚫</span>' : ''}
        </div>
        <div class="or-fields">`;
      pRev.forEach(k => {
        html += `<div class="or-field">${fieldLabel(k)}: <span>${escHtml(fieldValue(pCard, k))}</span></div>`;
      });
      html += `</div></div>`;
    });
    html += `</div>`;
  }

  el.innerHTML = html;
}

/* ── Bunker panel ── */
function renderBunkerPanel(room) {
  const el = document.getElementById('bunker-panel-content');
  if (!el) return;
  const c = room.catastrophe;
  const b = room.bunker;
  const alive = room.players.filter(p => !room.kicked?.includes(p));
  const spots = Math.floor(room.maxPlayers / 2);
  const toKick = Math.max(0, alive.length - spots);

  el.innerHTML = `
    <div class="info-block">
      <div class="info-block-title">🌍 Катастрофа</div>
      <div class="info-block-value highlight">${escHtml(c.title)}</div>
      <div style="font-size:.82rem;color:var(--muted2);margin-top:6px;line-height:1.6;">${escHtml(c.desc)}</div>
      <div style="display:flex;gap:12px;margin-top:8px;font-size:.78rem;">
        <span>☢️ Угроза: ${'🔴'.repeat(c.danger)}${'⬜'.repeat(5-c.danger)}</span>
        <span>⏱️ ${c.years} лет</span>
      </div>
    </div>
    <div class="bunker-card">
      <div class="bc-header">🏚️ ${escHtml(b.name)}</div>
      ${Object.entries(b).filter(([k])=>k!=='name').map(([k,v])=>`
        <div class="bc-row">
          <div class="bc-key">${escHtml(k)}</div>
          <div class="bc-val">${escHtml(v)}</div>
        </div>`).join('')}
    </div>
    <div class="info-block">
      <div class="info-block-title">📊 Расклад</div>
      <div style="font-size:.85rem;color:var(--text2);line-height:1.8;">
        Игроков: <strong style="color:var(--text)">${room.players.length}</strong><br>
        Мест в бункере: <strong style="color:var(--green)">${spots}</strong><br>
        Нужно выгнать: <strong style="color:var(--red)">${toKick}</strong><br>
        Выжило: <strong style="color:var(--text)">${alive.length}</strong>
      </div>
    </div>
  `;
}

/* ── Chat ── */
function renderChatMessages(room) {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const msgs = room.chat || [];
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;

  el.innerHTML = msgs.slice(-100).map(m => {
    const isMe = m.author === getMe();
    const isSystem = !!m.system;
    if (isSystem) return `<div class="chat-msg" style="justify-content:center;">
      <div class="cm-bubble system-msg">
        <span class="cm-author system">🔔 ${escHtml(m.text)}</span>
        <span class="cm-time">${m.time}</span>
      </div>
    </div>`;
    return `<div class="chat-msg ${isMe ? 'is-mine' : ''}">
      <div class="avatar avatar-sm" style="background:${avatarColor(m.author)};flex-shrink:0;">${avatarLetter(m.author)}</div>
      <div class="cm-bubble ${isMe ? 'mine' : ''}">
        <div class="cm-author" style="color:${avatarColor(m.author)}">${escHtml(m.author)}</div>
        <div class="cm-text">${escHtml(m.text)}</div>
        <span class="cm-time">${m.time}</span>
      </div>
    </div>`;
  }).join('');

  if (atBottom) el.scrollTop = el.scrollHeight;
}

/* ══════════════════════════════
   ACTIONS
══════════════════════════════ */
function startGame() {
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (!room || room.host !== getMe()) return;
  if (room.players.length < 2) return showToast('Нужно минимум 2 игрока', 'warn');
  room.status = 'playing';
  room.phase  = 'game';
  addSystemMsg(room, `🚀 Игра началась! Представьте свои карточки по кругу.`);
  saveRooms(rooms);
  document.getElementById('pb-reveal-all').style.display = '';
}

function revealField(key) {
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (!room) return;
  const me = getMe();
  if (!room.revealedFields[me]) room.revealedFields[me] = [];
  if (room.revealedFields[me].includes(key)) return;
  room.revealedFields[me].push(key);
  const val = fieldValue(room.cards[me], key);
  addSystemMsg(room, `${me} раскрыл ${fieldLabel(key)}: ${val}`);
  saveRooms(rooms);
}

function revealAllMyCard() {
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (!room) return;
  const me = getMe();
  const keys = ['gender','age','size','profession','hobby','health','trait','phobia','extra'];
  if (!room.revealedFields[me]) room.revealedFields[me] = [];
  const toReveal = keys.filter(k => !room.revealedFields[me].includes(k));
  if (!toReveal.length) { showToast('Всё уже раскрыто', 'info'); return; }
  room.revealedFields[me].push(...toReveal);
  addSystemMsg(room, `${me} раскрыл всю карточку!`);
  saveRooms(rooms);
}

function kickPlayer(player) {
  if (!confirm(`Выгнать "${player}" из бункера?`)) return;
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (!room || room.host !== getMe()) return;
  room.kicked = room.kicked || [];
  if (room.kicked.includes(player)) return;
  room.kicked.push(player);
  room.players = room.players.filter(p => p !== player);
  addSystemMsg(room, `⚠️ ${player} выгнан из бункера!`);

  // Check win condition
  const alive = room.players.filter(p => !room.kicked.includes(p));
  const spots = Math.floor(room.maxPlayers / 2);
  if (alive.length <= spots) {
    room.status   = 'finished';
    room.survivors = alive;
    addSystemMsg(room, `🏆 Игра окончена! Выжившие: ${alive.join(', ')}`);
  }

  saveRooms(rooms);
  showToast(`${player} выгнан из бункера`, 'info');
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input?.value.trim();
  if (!text) return;
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (!room) return;
  if (!room.chat) room.chat = [];
  room.chat.push({ author: getMe(), text, time: nowTime() });
  if (room.chat.length > 300) room.chat = room.chat.slice(-300);
  saveRooms(rooms);
  if (input) input.value = '';
  renderChatMessages(room);
}

function addSystemMsg(room, text) {
  if (!room.chat) room.chat = [];
  room.chat.push({ system: true, text, time: nowTime() });
  if (room.chat.length > 300) room.chat = room.chat.slice(-300);
}

/* ══════════════════════════════
   VOTING
══════════════════════════════ */
function openVote() {
  const room = getRoom(G.roomId);
  if (!room || room.status !== 'playing') return showToast('Игра не начата', 'warn');
  G.myVote = null;
  document.getElementById('vote-results-section').style.display = 'none';
  document.getElementById('confirm-vote-btn').disabled = true;
  renderVoteList(room);
  document.getElementById('vote-overlay').classList.add('open');
}
function closeVote() { document.getElementById('vote-overlay').classList.remove('open'); }

function renderVoteList(room) {
  const alive = room.players.filter(p => !room.kicked?.includes(p) && p !== getMe());
  const votes = room.votes || {};
  const total = Object.keys(votes).length;
  const counts = {};
  Object.values(votes).forEach(v => { counts[v] = (counts[v] || 0) + 1; });

  document.getElementById('vote-list').innerHTML = alive.map(p => {
    const vc  = counts[p] || 0;
    const pct = total ? Math.round(vc / total * 100) : 0;
    return `<div class="vote-item ${G.myVote === p ? 'selected' : ''}" onclick="selectVote('${escHtml(p)}',this)">
      <div class="vote-bar" style="width:${pct}%"></div>
      <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
      <div class="vote-pname">${escHtml(p)}</div>
      <div class="vote-count">${vc} гол.</div>
      <div class="vote-pct">${pct ? pct+'%' : ''}</div>
    </div>`;
  }).join('');
}

function selectVote(player, el) {
  G.myVote = player;
  document.querySelectorAll('.vote-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('confirm-vote-btn').disabled = false;
}

function confirmVote() {
  if (!G.myVote) return;
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (!room) return;
  room.votes = room.votes || {};
  room.votes[getMe()] = G.myVote;
  saveRooms(rooms);
  showToast(`Ты проголосовал за ${G.myVote}`, 'info');
  document.getElementById('confirm-vote-btn').disabled = true;

  // If host — tally when enough voted
  const isHost = room.host === getMe();
  const alive  = room.players.filter(p => !room.kicked?.includes(p));
  const voted  = Object.keys(room.votes).length;
  if (isHost && voted >= alive.length) {
    tallyVotes(room);
    saveRooms(rooms);
  }
}

function tallyVotes(room) {
  const counts = {};
  Object.values(room.votes || {}).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);

  // Show results
  const sec = document.getElementById('vote-results-section');
  sec.style.display = 'block';
  document.getElementById('vote-results-list').innerHTML = sorted.map(([name, cnt], i) => `
    <div class="vote-result-item ${i === 0 ? 'loser' : ''}">
      <div class="avatar avatar-sm" style="background:${avatarColor(name)}">${avatarLetter(name)}</div>
      <div class="vri-name">${escHtml(name)}</div>
      <div class="vri-count">${cnt} голос${cnt===1?'':'ов'}</div>
      ${i===0?'<div class="vri-label">🚫 Выгнан</div>':''}
    </div>`).join('');

  if (sorted.length) {
    const loser = sorted[0][0];
    setTimeout(() => kickPlayer(loser), 1400);
  }
  room.votes = {};
}

function hostTallyVotes() {
  const rooms = getRooms();
  const room  = rooms[G.roomId];
  if (!room || room.host !== getMe()) return showToast('Только хост может подвести итоги', 'warn');
  tallyVotes(room);
  saveRooms(rooms);
}

/* ══════════════════════════════
   END GAME
══════════════════════════════ */
function renderEndGame(room) {
  const overlay = document.getElementById('endgame-overlay');
  if (!overlay || overlay.classList.contains('open')) return;
  overlay.classList.add('open');

  const isAlive = room.survivors?.includes(getMe());
  document.getElementById('eg-emoji').textContent  = isAlive ? '🎉' : '☠️';
  document.getElementById('eg-title').className    = `eg-title ${isAlive ? 'win' : 'lose'}`;
  document.getElementById('eg-title').textContent  = isAlive ? 'Вы выжили!' : 'Вы выгнаны!';
  document.getElementById('eg-desc').textContent   = isAlive
    ? `Бункер выстоял. ${room.survivors.length} человек${room.survivors.length > 1 ? ' пережили' : ' пережил'} катастрофу.`
    : 'Группа приняла решение. Вам не хватило места в бункере.';

  document.getElementById('eg-survivors').innerHTML =
    (room.survivors || []).map(p => `
      <div class="eg-survivor">
        <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
        ${escHtml(p)}
      </div>`).join('');

  document.getElementById('eg-kicked').innerHTML =
    (room.kicked || []).map(p => `
      <div class="eg-kick-item">
        <div class="avatar avatar-sm" style="background:${avatarColor(p)}">${avatarLetter(p)}</div>
        <s>${escHtml(p)}</s>
      </div>`).join('');
}

/* ══════════════════════════════
   MEDIA
══════════════════════════════ */
async function requestMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    G.localStream = stream;
    G.micOn = true; G.camOn = true;
    updateMediaButtons();
    attachLocalCam();
    showToast('📹 Камера и микрофон подключены', 'success', 2500);
  } catch {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      G.localStream = stream;
      G.micOn = true; G.camOn = false;
      updateMediaButtons();
      showToast('🎤 Только микрофон', 'info', 2500);
    } catch {
      showToast('⚠️ Нет доступа к медиа — продолжаем без камеры', 'warn', 3500);
    }
  }
}

function stopMedia() {
  G.localStream?.getTracks().forEach(t => t.stop());
  G.localStream = null;
  G.micOn = false; G.camOn = false;
}

function toggleMic() {
  if (!G.localStream) { requestMedia(); return; }
  const tracks = G.localStream.getAudioTracks();
  G.micOn = !G.micOn;
  tracks.forEach(t => t.enabled = G.micOn);
  updateMediaButtons();
  showToast(G.micOn ? '🎤 Микрофон включён' : '🔇 Микрофон выключен', 'info', 1500);
}

function toggleCam() {
  if (!G.localStream) { requestMedia(); return; }
  const tracks = G.localStream.getVideoTracks();
  G.camOn = !G.camOn;
  tracks.forEach(t => t.enabled = G.camOn);
  attachLocalCam();
  updateMediaButtons();
  showToast(G.camOn ? '📹 Камера включена' : '🚫 Камера выключена', 'info', 1500);
}

function updateMediaButtons() {
  // Waiting screen
  const wMic = document.getElementById('wv-mic-btn');
  const wCam = document.getElementById('wv-cam-btn');
  if (wMic) { wMic.innerHTML = G.micOn ? '🎤 Мик вкл' : '🔇 Мик выкл'; wMic.style.color = G.micOn ? '' : 'var(--red)'; }
  if (wCam) { wCam.innerHTML = G.camOn ? '📹 Кам вкл' : '🚫 Кам выкл'; wCam.style.color = G.camOn ? '' : 'var(--red)'; }
  // Play controls
  const cMic = document.getElementById('ctrl-mic');
  const cCam = document.getElementById('ctrl-cam');
  if (cMic) { cMic.textContent = G.micOn ? '🎤' : '🔇'; cMic.classList.toggle('muted-btn', !G.micOn); }
  if (cCam) { cCam.textContent = G.camOn ? '📹' : '🚫'; cCam.classList.toggle('muted-btn', !G.camOn); }
  // Player list icons
  const me = getMe();
  const micIcon = document.getElementById(`pi-mic-${me}`);
  if (micIcon) { micIcon.textContent = G.micOn ? '🎤' : '🔇'; micIcon.className = `pi-icon ${G.micOn ? 'active' : 'muted'}`; }
}

/* ══════════════════════════════
   UI HELPERS
══════════════════════════════ */
function showGameView(id) {
  document.querySelectorAll('.game-view').forEach(el => el.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  // reset sub-views
  if (id === 'room-view') {
    document.getElementById('waiting-view')?.classList.remove('active');
    document.getElementById('playing-view')?.classList.remove('active');
  }
}

function updateGTB({ roomName, phase, phaseClass, playerCount }) {
  const rn = document.getElementById('gtb-room-name');
  const ph = document.getElementById('gtb-phase');
  const pc = document.getElementById('gtb-player-count');
  if (rn) rn.textContent = roomName || '';
  if (ph) { ph.textContent = phase || ''; ph.className = `gtb-phase-badge ${phaseClass || ''}`; }
  if (pc) pc.textContent = playerCount ? `👤 ${playerCount}` : '';
}

function switchRightTab(tab) {
  ['card','chat','bunker'].forEach(t => {
    document.getElementById(`rtab-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`rpanel-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'chat') {
    const dot = document.getElementById('rtab-chat')?.querySelector('.notif-dot');
    if (dot) dot.classList.remove('show');
    G.lastChatLen = (getRoom(G.roomId)?.chat || []).length;
  }
}

function copyRoomCode() {
  const code = document.getElementById('wv-room-code')?.textContent;
  if (code) copyText(code, 'Код скопирован');
}

/* ══════════════════════════════
   SECURITY
══════════════════════════════ */
function escHtml(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════
   KEYBOARD
══════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
});

/* ══════════════════════════════
   LOGOUT
══════════════════════════════ */
function doLogout() {
  if (G.roomId) leaveRoom();
  logout();
  window.location.href = 'index.html';
}
