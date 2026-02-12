import Auth from './auth.js';

const NAV_OPEN_CLASS = 'open';
const THEME_KEY = 'trulychat-theme';

const loginForm = document.querySelector('[data-login-form]');
const signupForm = document.querySelector('[data-signup-form]');
const googleButtons = document.querySelectorAll('[data-google-auth]');
const logoutButtons = document.querySelectorAll('[data-logout]');
const navToggle = document.querySelector('[data-nav-toggle]');
const navMenu = document.querySelector('[data-nav-menu]');
const navLinks = document.querySelectorAll('[data-nav]');
const themeButtons = document.querySelectorAll('[data-theme-toggle]');
const yearEls = document.querySelectorAll('[data-year]');
const authToggles = document.querySelectorAll('[data-auth-toggle]');
const authPanes = document.querySelectorAll('[data-auth-pane]');
const authEntryLinks = document.querySelectorAll(
  '[data-auth-entry], a[href="pages/login.html"], a[href="login.html"], a[href$="/login.html"], a[href="pages/login.html#signup"], a[href="login.html#signup"], a[href$="/login.html#signup"]'
);

function normalizePageName(pathname) {
  const page = (pathname.split('/').pop() || 'index.html').toLowerCase();
  return page || 'index.html';
}

function normalizeLinkPage(href) {
  try {
    const url = new URL(href, window.location.href);
    return normalizePageName(url.pathname);
  } catch (_) {
    return '';
  }
}

function markPageState() {
  const page = normalizePageName(window.location.pathname).replace('.html', '');
  document.body.setAttribute('data-page', page);

  if (loginForm || signupForm) {
    document.body.classList.add('auth-page');
  }
}

function ensureBrandMark() {
  const brands = document.querySelectorAll('.brand');
  brands.forEach((brand) => {
    if (brand.querySelector('.brand-mark')) return;
    const mark = document.createElement('span');
    mark.className = 'brand-mark';
    mark.textContent = 'TC';
    brand.prepend(mark);
  });
}

function setAuthView(view) {
  if (!authPanes.length || !authToggles.length) return;
  authPanes.forEach((pane) => {
    const isActive = pane.getAttribute('data-auth-pane') === view;
    pane.hidden = !isActive;
  });

  authToggles.forEach((toggle) => {
    const isActive = toggle.getAttribute('data-auth-toggle') === view;
    toggle.classList.toggle('active', isActive);
    toggle.setAttribute('aria-selected', String(isActive));
  });

  const nextHash = view === 'signup' ? '#signup' : '#login';
  if (window.location.hash !== nextHash) {
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${nextHash}`);
  }
}

function initAuthToggle() {
  if (!authPanes.length || !authToggles.length) return;
  const currentHash = window.location.hash.toLowerCase();
  const initialView = currentHash === '#signup' ? 'signup' : 'login';
  setAuthView(initialView);

  authToggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const view = toggle.getAttribute('data-auth-toggle');
      if (!view) return;
      setAuthView(view);
    });
  });
}

function setCurrentYear() {
  if (!yearEls.length) return;
  const year = String(new Date().getFullYear());
  yearEls.forEach((el) => {
    el.textContent = year;
  });
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
  } else {
    document.body.removeAttribute('data-theme');
  }

  themeButtons.forEach((button) => {
    button.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  });
}

function initTheme() {
  if (!themeButtons.length) return;
  const savedTheme = localStorage.getItem(THEME_KEY);
  const initialTheme = savedTheme === 'dark' ? 'dark' : 'light';
  applyTheme(initialTheme);

  themeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const isDark = document.body.getAttribute('data-theme') === 'dark';
      const nextTheme = isDark ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, nextTheme);
      applyTheme(nextTheme);
    });
  });
}

function closeNavMenu() {
  if (!navMenu || !navToggle) return;
  navMenu.classList.remove(NAV_OPEN_CLASS);
  navToggle.setAttribute('aria-expanded', 'false');
}

function initActiveNav() {
  const currentPage = normalizePageName(window.location.pathname);
  const links = document.querySelectorAll('.nav-links a[href]');
  links.forEach((link) => {
    const linkPage = normalizeLinkPage(link.getAttribute('href') || '');
    if (!linkPage) return;
    if (linkPage === currentPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}


function showToast(message, duration = 2800) {
  let root = document.querySelector('.toast-stack');
  if (!root) {
    root = document.createElement('div');
    root.className = 'toast-stack';
    document.body.appendChild(root);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  root.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, duration);
}


function showNoticeOverlay(title, message, actionText = 'OK') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'toast-overlay show';
    overlay.innerHTML = `
      <div class="toast-card">
        <h3>${title}</h3>
        <p class="small">${message}</p>
        <div class="toast-actions">
          <button class="btn btn-primary" type="button" data-notice-ok>${actionText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      resolve(true);
    };

    overlay.querySelector('[data-notice-ok]')?.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
  });
}
function getInboxUrl(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value.includes('@')) return 'https://mail.google.com';
  const domain = value.split('@')[1] || '';
  if (domain.includes('gmail.com')) return 'https://mail.google.com';
  if (domain.includes('outlook.') || domain.includes('hotmail.') || domain.includes('live.')) {
    return 'https://outlook.live.com/mail';
  }
  if (domain.includes('yahoo.')) return 'https://mail.yahoo.com';
  if (domain.includes('icloud.') || domain.includes('me.com')) return 'https://www.icloud.com/mail';
  return 'https://mail.google.com';
}
function showVerificationOverlay(email = '', mode = 'sent') {
  return new Promise((resolve) => {
    const safeEmail = String(email || '').trim() || 'your inbox';
    const isUnverified = mode === 'unverified';
    const message = isUnverified
      ? 'Your email is not verified yet. Please verify your email to continue. We sent a verification link to <strong>' + safeEmail + '</strong>.'
      : 'We sent a verification link to <strong>' + safeEmail + '</strong>. Open your email, verify your account, then come back and log in.';
    const overlay = document.createElement('div');
    overlay.className = 'toast-overlay show';
    overlay.innerHTML =
      '<div class="toast-card toast-card-verify">' +
        '<h3>Verify your email</h3>' +
        '<p class="small">' + message + '</p>' +
        '<div class="verify-steps">' +
          '<div>1. Open inbox</div>' +
          '<div>2. Click verification link</div>' +
          '<div>3. Return and log in</div>' +
        '</div>' +
        '<div class="toast-actions">' +
          '<button class="btn btn-secondary" type="button" data-open-inbox>Open inbox</button>' +
          '<button class="btn btn-primary" type="button" data-notice-ok>I understood</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.querySelector('[data-open-inbox]')?.addEventListener('click', () => {
      window.open(getInboxUrl(email), '_blank', 'noopener,noreferrer');
    });
    overlay.querySelector('[data-notice-ok]')?.addEventListener('click', close);
  });
}

function promptForEmail(title, message, initialEmail = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'toast-overlay show';
    overlay.innerHTML = `
      <div class="toast-card">
        <h3>${title}</h3>
        <p class="small">${message}</p>
        <div class="form-group" style="margin:0;">
          <label for="toastEmailInput">Email</label>
          <input id="toastEmailInput" type="email" autocomplete="email" placeholder="you@company.com" />
          <p class="small" data-toast-error></p>
        </div>
        <div class="toast-actions">
          <button class="btn btn-ghost" type="button" data-toast-cancel>Cancel</button>
          <button class="btn btn-primary" type="button" data-toast-confirm>Continue</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#toastEmailInput');
    const cancelBtn = overlay.querySelector('[data-toast-cancel]');
    const okBtn = overlay.querySelector('[data-toast-confirm]');
    const errorEl = overlay.querySelector('[data-toast-error]');

    if (input) {
      input.value = initialEmail || '';
      input.focus();
      input.select();
    }

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    const submit = () => {
      const email = String(input?.value || '').trim();
      if (!email) {
        if (errorEl) errorEl.textContent = 'Please enter your email.';
        return;
      }
      close(email);
    };

    cancelBtn?.addEventListener('click', () => close(null));
    okBtn?.addEventListener('click', submit);
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });
  });
}

function initAuthLoadingState() {
  const authForms = [loginForm, signupForm].filter(Boolean);
  authForms.forEach((form) => {
    form.addEventListener('submit', (event) => {
      const submitButton = event.submitter || form.querySelector('button[type="submit"]');
      if (!submitButton) return;
      const originalText = submitButton.textContent || '';
      submitButton.disabled = true;
      submitButton.textContent = 'Please wait...';
      window.setTimeout(() => {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }, 6000);
    });
  });

  googleButtons.forEach((button) => {
    const originalText = button.textContent || '';
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Please wait...';
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
      }, 6000);
    });
  });
}

async function initGoogleRedirectFlow() {
  if (!googleButtons.length) return;
  try {
    const redirectedUser = await Auth.consumeGoogleRedirectResult();
    if (redirectedUser) {
      Auth.goToPostAuthDefault();
    }
  } catch (err) {
    const errorEls = document.querySelectorAll('[data-google-error]');
    errorEls.forEach((el) => {
      el.textContent = Auth.getAuthErrorMessage(err);
    });
  }
}

function initNavigation() {
  if (!navMenu || !navToggle) return;
  navMenu.classList.add('js-collapsible-nav');

  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle(NAV_OPEN_CLASS);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.forEach((link) => {
    link.addEventListener('click', closeNavMenu);
  });

  document.addEventListener('click', (event) => {
    if (!navMenu.classList.contains(NAV_OPEN_CLASS)) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (navMenu.contains(target) || navToggle.contains(target)) return;
    closeNavMenu();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      closeNavMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeNavMenu();
    }
  });
}

function ensureFavicon() {
  const inPages = window.location.pathname.toLowerCase().includes('/pages/');
  const href = inPages ? '../assets/favicon.svg' : 'assets/favicon.svg';
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.setAttribute('rel', 'icon');
    document.head.appendChild(favicon);
  }
  favicon.setAttribute('type', 'image/svg+xml');
  favicon.setAttribute('href', href);
}

function setAuthEntryVisibility(isLoggedIn) {
  if (!authEntryLinks.length) return;
  authEntryLinks.forEach((link) => {
    link.hidden = !!isLoggedIn;
    link.style.display = isLoggedIn ? 'none' : '';
  });
}

function initAuthEntryVisibility() {
  // Hide auth-entry links immediately to avoid showing them during auth restore.
  setAuthEntryVisibility(true);
  Auth.onAuthStateChanged(Auth.auth, (user) => {
    setAuthEntryVisibility(!!user);
  });
}

markPageState();
ensureFavicon();
ensureBrandMark();
setCurrentYear();
initTheme();
initActiveNav();
initNavigation();
initAuthEntryVisibility();
initAuthLoadingState();
initAuthToggle();
initGoogleRedirectFlow();
(function showVerificationNoticeFromQuery() {
  if (!loginForm) return;

  const url = new URL(window.location.href);
  if (url.searchParams.get('verify') !== 'required') return;

  const errorEl = loginForm.querySelector('[data-error]');
  if (errorEl) {
    errorEl.textContent = 'Your email is not verified yet. Please verify your email to continue.';
  }

  // Consume this one-time flag so refresh/open does not show repeatedly.
  url.searchParams.delete('verify');
  const nextQuery = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextQuery ? `?${nextQuery}` : ''}${url.hash || ''}`;
  window.history.replaceState({}, '', nextUrl);
})();

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value;
    const errorEl = loginForm.querySelector('[data-error]');
    errorEl.textContent = '';

    try {
      await Auth.signIn(email, password);
      Auth.goToPostAuthDefault();
    } catch (err) {
      const message = Auth.getAuthErrorMessage(err);
      errorEl.textContent = message;
      if (err?.code === 'auth/email-not-verified') {
        errorEl.textContent = 'Your email is not verified yet. Please verify your email to continue.';
      }
    }
  });
}

if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = signupForm.name.value.trim();
    const email = signupForm.email.value.trim();
    const password = signupForm.password.value;
    const errorEl = signupForm.querySelector('[data-error]');
    errorEl.textContent = '';

    if (!name) {
      errorEl.textContent = 'Full name is required.';
      return;
    }

    if (password.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters long.';
      return;
    }

    try {
      await Auth.signUp(name, email, password);
      errorEl.textContent = '';
      await showVerificationOverlay(email);
      signupForm.reset();
      setAuthView('login');
    } catch (err) {
      const message = Auth.getAuthErrorMessage(err);
      errorEl.textContent = message;
      if (err?.code === 'auth/email-not-verified') {
        errorEl.textContent = 'Your email is not verified yet. Please verify your email to continue.';
      }
    }
  });
}

if (googleButtons.length) {
  googleButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const errorEl = button.closest('[data-auth-pane]')?.querySelector('[data-google-error]')
        || document.querySelector('[data-google-error]');
      if (errorEl) errorEl.textContent = '';
      try {
        const result = await Auth.signInWithGoogle();
        if (result === 'redirecting') {
          return;
        }
        Auth.goToPostAuthDefault();
      } catch (err) {
        if (errorEl) errorEl.textContent = Auth.getAuthErrorMessage(err);
      }
    });
  });
}

if (logoutButtons.length) {
  logoutButtons.forEach((logoutBtn) => {
    logoutBtn.addEventListener('click', async () => {
      try {
        await Auth.signOut();
      } finally {
        window.location.href = '../index.html';
      }
    });
  });
}





if (loginForm) {
  const resetBtn = loginForm.querySelector('[data-reset-password]');

  resetBtn?.addEventListener('click', async () => {
    const errorEl = loginForm.querySelector('[data-error]');
    if (errorEl) errorEl.textContent = '';

    const email = await promptForEmail(
      'Reset password',
      'Enter your email to receive a password reset link.',
      loginForm.email.value.trim()
    );
    if (!email) return;

    try {
      await Auth.sendPasswordReset(email);
      showToast('Password reset link sent. Please check your email inbox.');
    } catch (err) {
      const message = Auth.getAuthErrorMessage(err);
      if (errorEl) {
        errorEl.textContent = message;
      }
      showToast(message);
    }
  });
}





