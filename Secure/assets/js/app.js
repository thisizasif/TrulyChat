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

markPageState();
ensureBrandMark();
setCurrentYear();
initTheme();
initActiveNav();
initNavigation();
initAuthLoadingState();
initAuthToggle();
initGoogleRedirectFlow();

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value.trim();
    const errorEl = loginForm.querySelector('[data-error]');
    errorEl.textContent = '';

    try {
      await Auth.signIn(email, password);
      Auth.goToPostAuthDefault();
    } catch (err) {
      errorEl.textContent = Auth.getAuthErrorMessage(err);
    }
  });
}

if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = signupForm.name.value.trim();
    const email = signupForm.email.value.trim();
    const password = signupForm.password.value.trim();
    const errorEl = signupForm.querySelector('[data-error]');
    errorEl.textContent = '';

    if (password.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters long.';
      return;
    }

    try {
      await Auth.signUp(name, email, password);
      Auth.goToPostAuthDefault();
    } catch (err) {
      errorEl.textContent = Auth.getAuthErrorMessage(err);
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
