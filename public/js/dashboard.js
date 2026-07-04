/* ============================================================
   dashboard.js — Dashboard logic: stats, workout list, add/delete
   ============================================================ */

const API = '';

// ── Auth guard ────────────────────────────────────────────────
const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/';
}

// ── State ─────────────────────────────────────────────────────
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let workouts    = [];
let stats       = {};

// ── DOM refs ──────────────────────────────────────────────────
const loadingOverlay = document.getElementById('loading-overlay');
const toastContainer = document.getElementById('toast-container');

// Topbar & sidebar
const userAvatarEl  = document.getElementById('user-avatar');
const userNameEl    = document.getElementById('user-name');
const userEmailEl   = document.getElementById('user-email');
const sidebarAvEl   = document.getElementById('sidebar-avatar');
const sidebarNameEl = document.getElementById('sidebar-name');
const sidebarMailEl = document.getElementById('sidebar-email');

// Stats
const statTotal    = document.getElementById('stat-total');
const statDuration = document.getElementById('stat-duration');
const statCalories = document.getElementById('stat-calories');
const statWeek     = document.getElementById('stat-week');

// Workout list
const workoutList  = document.getElementById('workout-list');

// Add workout form
const addForm      = document.getElementById('add-workout-form');

// ── API helper ────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.clear();
    window.location.href = '/';
    return null;
  }
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const icon = type === 'success' ? '✓' : '✕';
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ── Workout type icons ────────────────────────────────────────
const TYPE_ICONS = {
  'Koşu':       '🏃',
  'Yürüyüş':    '🚶',
  'Bisiklet':   '🚴',
  'Yüzme':      '🏊',
  'Ağırlık':    '🏋️',
  'Yoga':       '🧘',
  'HIIT':       '⚡',
  'Futbol':     '⚽',
  'Basketbol':  '🏀',
  'Tenis':      '🎾',
  'Dans':       '💃',
  'Pilates':    '🤸',
  'Diğer':      '💪'
};

function getIcon(type) {
  return TYPE_ICONS[type] || '💪';
}

// ── Format date ───────────────────────────────────────────────
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Populate user info ────────────────────────────────────────
function populateUser(user) {
  const initial = (user.username || '?')[0].toUpperCase();
  if (userAvatarEl)  userAvatarEl.textContent  = initial;
  if (sidebarAvEl)   sidebarAvEl.textContent   = initial;
  if (userNameEl)    userNameEl.textContent    = user.full_name || user.username;
  if (userEmailEl)   userEmailEl.textContent   = user.email;
  if (sidebarNameEl) sidebarNameEl.textContent = user.full_name || user.username;
  if (sidebarMailEl) sidebarMailEl.textContent = user.email;
}

// ── Render stats ──────────────────────────────────────────────
function renderStats(s) {
  if (statTotal)    statTotal.textContent    = s.total_workouts || 0;
  if (statDuration) statDuration.textContent = s.total_duration
    ? (s.total_duration >= 60 ? Math.round(s.total_duration / 60) + ' sa' : s.total_duration + ' dk')
    : '0 dk';
  if (statCalories) statCalories.textContent = (s.total_calories || 0).toLocaleString('tr-TR');
  if (statWeek)     statWeek.textContent     = s.workouts_this_week || 0;
}

// ── Render workout list ───────────────────────────────────────
function renderWorkouts(list) {
  if (!workoutList) return;

  if (!list || list.length === 0) {
    workoutList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏋️</div>
        <div class="empty-title">Henüz antrenman yok</div>
        <div class="empty-desc">Sağ taraftaki formu kullanarak ilk antrenmanını ekle!</div>
      </div>`;
    return;
  }

  workoutList.innerHTML = list.map(w => `
    <div class="workout-item" id="workout-${w.id}">
      <div class="workout-type-icon">${getIcon(w.type)}</div>
      <div class="workout-info">
        <div class="workout-type-name">${w.type}</div>
        <div class="workout-meta">
          <span>⏱ ${w.duration} dakika</span>
          ${w.calories ? `<span>🔥 ${w.calories} kcal</span>` : ''}
          ${w.notes ? `<span title="${w.notes}">📝 Not var</span>` : ''}
        </div>
      </div>
      <div class="workout-date">${formatDate(w.date)}</div>
      <button class="btn-delete" onclick="deleteWorkout(${w.id})" title="Sil">✕</button>
    </div>
  `).join('');
}

// ── Delete workout ────────────────────────────────────────────
async function deleteWorkout(id) {
  if (!confirm('Bu antrenmanı silmek istediğine emin misin?')) return;

  const data = await apiFetch(`/api/fitness/workouts/${id}`, { method: 'DELETE' });
  if (!data) return;

  showToast('Antrenman silindi.', 'success');
  await loadDashboardData();
}

window.deleteWorkout = deleteWorkout; // expose globally for inline onclick

// ── Add workout form ──────────────────────────────────────────
if (addForm) {
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = addForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Ekleniyor...';

    const payload = {
      type:     document.getElementById('w-type').value,
      duration: parseInt(document.getElementById('w-duration').value),
      calories: document.getElementById('w-calories').value ? parseInt(document.getElementById('w-calories').value) : null,
      notes:    document.getElementById('w-notes').value || null,
      date:     document.getElementById('w-date').value || null
    };

    const data = await apiFetch('/api/fitness/workouts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    btn.disabled = false;
    btn.textContent = 'Antrenman Ekle';

    if (!data) return;
    if (data.error) { showToast(data.error, 'error'); return; }

    showToast('Antrenman başarıyla eklendi! 💪', 'success');
    addForm.reset();
    // Reset date to today
    document.getElementById('w-date').value = new Date().toISOString().split('T')[0];
    await loadDashboardData();
  });
}

// ── Logout ────────────────────────────────────────────────────
document.querySelectorAll('[data-logout]').forEach(btn => {
  btn.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = '/';
  });
});

// ── Load data ─────────────────────────────────────────────────
async function loadDashboardData() {
  try {
    const [statsData, workoutsData] = await Promise.all([
      apiFetch('/api/fitness/stats'),
      apiFetch('/api/fitness/workouts')
    ]);

    if (statsData && statsData.stats) {
      stats = statsData.stats;
      renderStats(stats);
    }
    if (workoutsData && workoutsData.workouts) {
      workouts = workoutsData.workouts;
      renderWorkouts(workouts);
    }
  } catch (err) {
    console.error('Load error:', err);
    showToast('Veriler yüklenemedi.', 'error');
  }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  // Set today's date as default for workout date
  const dateInput = document.getElementById('w-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Get up-to-date user info from server
  try {
    const meData = await apiFetch('/api/auth/me');
    if (meData && meData.user) {
      currentUser = meData.user;
      localStorage.setItem('user', JSON.stringify(currentUser));
    }
  } catch {}

  populateUser(currentUser);
  await loadDashboardData();

  // Hide loading
  if (loadingOverlay) {
    loadingOverlay.style.opacity = '0';
    setTimeout(() => loadingOverlay.remove(), 300);
  }
}

init();
