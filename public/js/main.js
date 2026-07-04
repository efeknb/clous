/* ============================================================
   main.js — Landing page JS: Auth modal, login/register logic
   ============================================================ */

const API = '';

// ── DOM ──────────────────────────────────────────────────────
const modalOverlay   = document.getElementById('auth-modal');
const tabLogin       = document.getElementById('tab-login');
const tabRegister    = document.getElementById('tab-register');
const loginForm      = document.getElementById('login-form');
const registerForm   = document.getElementById('register-form');
const loginError     = document.getElementById('login-error');
const registerError  = document.getElementById('register-error');
const toastContainer = document.getElementById('toast-container');
const navbar         = document.querySelector('.navbar');

// ── Redirect if already logged in ────────────────────────────
if (localStorage.getItem('token')) {
  window.location.href = '/dashboard.html';
}

// ── Navbar scroll effect ──────────────────────────────────────
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
});

// ── Modal open / close ────────────────────────────────────────
function openModal(tab = 'login') {
  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  switchTab(tab);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
  clearErrors();
}

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.querySelectorAll('[data-open-modal]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.openModal || 'login'));
});

document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', closeModal);
});

// ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ── Tab switching ─────────────────────────────────────────────
function switchTab(tab) {
  tabLogin.classList.toggle('active', tab === 'login');
  tabRegister.classList.toggle('active', tab === 'register');
  loginForm.style.display  = tab === 'login'    ? 'block' : 'none';
  registerForm.style.display = tab === 'register' ? 'block' : 'none';
  clearErrors();
}

tabLogin.addEventListener('click', () => switchTab('login'));
tabRegister.addEventListener('click', () => switchTab('register'));

// ── Errors ────────────────────────────────────────────────────
function clearErrors() {
  loginError.classList.remove('show');
  registerError.classList.remove('show');
  loginError.textContent = '';
  registerError.textContent = '';
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('show');
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const icon = type === 'success' ? '✓' : '✕';
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Login ─────────────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const submitBtn = loginForm.querySelector('button[type="submit"]');
  const origText  = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Giriş yapılıyor...';

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res  = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(loginError, data.error || 'Giriş başarısız.');
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    showToast('Hoş geldiniz, ' + data.user.username + '!');
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 600);
  } catch {
    showError(loginError, 'Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = origText;
  }
});

// ── Register ──────────────────────────────────────────────────
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const submitBtn = registerForm.querySelector('button[type="submit"]');
  const origText  = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Kaydediliyor...';

  const full_name = document.getElementById('reg-fullname').value.trim();
  const username  = document.getElementById('reg-username').value.trim();
  const email     = document.getElementById('reg-email').value.trim();
  const password  = document.getElementById('reg-password').value;
  const confirm   = document.getElementById('reg-confirm').value;

  if (password !== confirm) {
    showError(registerError, 'Şifreler eşleşmiyor.');
    submitBtn.disabled = false;
    submitBtn.textContent = origText;
    return;
  }

  try {
    const res  = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, username, email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showError(registerError, data.error || 'Kayıt başarısız.');
      return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    showToast('Hesabınız oluşturuldu! Hoş geldiniz 🎉');
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 700);
  } catch {
    showError(registerError, 'Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = origText;
  }
});

// ── Animate progress bars on scroll ──────────────────────────
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.progress-bar-fill').forEach(bar => {
        bar.style.width = bar.getAttribute('data-width') + '%';
      });
    }
  });
}, { threshold: 0.3 });

document.querySelectorAll('.float-card').forEach(card => observer.observe(card));
document.querySelectorAll('.progress-bar-fill').forEach(bar => {
  const w = bar.style.width;
  bar.setAttribute('data-width', parseInt(w));
  bar.style.width = '0%';
});
