/* ═══════════════════════════════════════════════════════════
   index.js — скрипты главной страницы (лендинг)
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ── INIT ── */
document.addEventListener('DOMContentLoaded', () => {
  initIndexPage();
});

function initIndexPage() {
  // Check if already logged in
  if (initAuth()) {
    updateNavForUser(getMe());
  }
  initNav();
  initAnimations();
  renderLiveRooms();
  setInterval(renderLiveRooms, 5000);
}

/* ── NAV SCROLL EFFECT ── */
function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });
}

/* ── SCROLL ANIMATIONS ── */
function initAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.step-card, .feature-card, .role-card, .disaster-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

/* ── AUTH STATE FOR NAV ── */
function updateNavForUser(username) {
  const guestNav  = document.getElementById('nav-guest');
  const userNav   = document.getElementById('nav-user');
  const navName   = document.getElementById('nav-username');
  const navAvatar = document.getElementById('nav-avatar');

  if (guestNav)  guestNav.style.display  = 'none';
  if (userNav)   userNav.style.display   = 'flex';
  if (navName)   navName.textContent     = username;
  if (navAvatar) {
    navAvatar.textContent = avatarLetter(username);
    navAvatar.style.background = avatarColor(username);
  }
}

function updateNavForGuest() {
  const guestNav = document.getElementById('nav-guest');
  const userNav  = document.getElementById('nav-user');
  if (guestNav) guestNav.style.display = 'flex';
  if (userNav)  userNav.style.display  = 'none';
}

/* ── AUTH TABS ── */
let _authMode = 'login';

function authTab(mode) {
  _authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && mode === 'login') || (i === 1 && mode === 'register'));
  });
  document.getElementById('login-form').classList.toggle('hidden', mode !== 'login');
  document.getElementById('reg-form').classList.toggle('hidden', mode !== 'register');
  document.getElementById('auth-hint').innerHTML = mode === 'login'
    ? `Нет аккаунта? <a href="#" onclick="authTab('register');return false">Зарегистрироваться</a>`
    : `Уже есть аккаунт? <a href="#" onclick="authTab('login');return false">Войти</a>`;
}

/* ── LOGIN ── */
function doLogin() {
  const username = document.getElementById('li-username').value.trim();
  const password = document.getElementById('li-password').value;
  if (!username || !password) return showToast('Заполни все поля', 'warn');
  const result = login(username, password);
  if (!result.ok) return showToast(result.msg, 'error');
  showToast(`Добро пожаловать, ${username}! 🎉`, 'success');
  closeModal('auth-modal');
  updateNavForUser(username);
  setTimeout(() => { window.location.href = 'game.html'; }, 800);
}

/* ── REGISTER ── */
function doRegister() {
  const username = document.getElementById('rg-username').value.trim();
  const password = document.getElementById('rg-password').value;
  const confirm  = document.getElementById('rg-confirm').value;
  if (!username || !password || !confirm) return showToast('Заполни все поля', 'warn');
  if (password !== confirm) return showToast('Пароли не совпадают', 'error');
  const result = register(username, password);
  if (!result.ok) return showToast(result.msg, 'error');
  showToast(`Аккаунт создан! Добро пожаловать, ${username} 🎉`, 'success', 4000);
  closeModal('auth-modal');
  updateNavForUser(username);
  setTimeout(() => { window.location.href = 'game.html'; }, 1000);
}

/* ── OPEN AUTH MODAL ── */
function openAuthModal(mode = 'login') {
  openModal('auth-modal');
  setTimeout(() => authTab(mode), 10);
}

/* ── LOGOUT ── */
function doLogout() {
  logout();
  updateNavForGuest();
  showToast('Вы вышли из аккаунта', 'info');
}

/* ── GO TO GAME ── */
function goToGame() {
  if (getMe()) {
    window.location.href = 'game.html';
  } else {
    openAuthModal('login');
  }
}

/* ── LIVE ROOMS COUNT ── */
function renderLiveRooms() {
  const rooms = Object.values(getRooms());
  const playing = rooms.filter(r => r.status === 'playing').length;
  const waiting = rooms.filter(r => r.status === 'waiting').length;
  const total   = rooms.reduce((s, r) => s + r.players.length, 0);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('stat-rooms',   rooms.length);
  setEl('stat-playing', playing);
  setEl('stat-players', total);
  setEl('stat-waiting', waiting);

  // Live rooms preview
  const preview = document.getElementById('live-rooms-preview');
  if (!preview) return;
  if (!rooms.length) {
    preview.innerHTML = `<div style="color:var(--muted);font-size:.85rem;text-align:center;padding:20px 0;">
      Нет активных игр — <a href="#" onclick="goToGame();return false" style="color:var(--accent)">создай первую!</a>
    </div>`;
    return;
  }
  preview.innerHTML = rooms.slice(0, 4).map(r => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg3);border-radius:8px;border:1px solid var(--border);">
      <div style="width:8px;height:8px;border-radius:50%;background:${r.status==='playing'?'var(--green)':'var(--yellow)'};flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtmlIndex(r.name)}</div>
        <div style="font-size:.7rem;color:var(--muted2);">Хост: ${escHtmlIndex(r.host)} · ${r.players.length}/${r.maxPlayers}</div>
      </div>
      <div class="badge ${r.status==='playing'?'badge-green':'badge-yellow'}" style="font-size:.62rem;">${r.status==='playing'?'▶ Игра':'⏳ Ждут'}</div>
    </div>
  `).join('');
}

function escHtmlIndex(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── ENTER KEY SUPPORT ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('li-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('rg-confirm')?.addEventListener('keydown',  e => { if (e.key === 'Enter') doRegister(); });
});
