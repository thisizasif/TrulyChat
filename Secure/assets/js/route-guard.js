import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { auth } from './firebase.js';

const AUTH_ENTRY_PAGES = new Set(['login.html', 'signup.html']);

function getPageName(pathname) {
  const page = (pathname.split('/').pop() || 'index.html').toLowerCase();
  return page || 'index.html';
}

function isInPagesDirectory(pathname) {
  return pathname.toLowerCase().includes('/pages/');
}

function buildLoginRedirect(pathname, search, hash) {
  const inPages = isInPagesDirectory(pathname);
  const loginPath = inPages ? 'login.html' : 'pages/login.html';
  const page = getPageName(pathname);
  const target = `${page}${search || ''}${hash || ''}`;
  return `${loginPath}?redirect=${encodeURIComponent(target)}`;
}

function getSafeRedirectPath(rawTarget) {
  if (!rawTarget) return null;
  const target = rawTarget.trim();
  if (!target) return null;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(target) || target.startsWith('//')) {
    return null;
  }
  return target;
}

const page = getPageName(window.location.pathname);
onAuthStateChanged(auth, (user) => {
  const isPagesPath = isInPagesDirectory(window.location.pathname);
  const isProtectedPage = isPagesPath && !AUTH_ENTRY_PAGES.has(page);

  if (isProtectedPage) {
    if (user) return;
    const loginUrl = buildLoginRedirect(window.location.pathname, window.location.search, window.location.hash);
    window.location.replace(loginUrl);
    return;
  }

  if (AUTH_ENTRY_PAGES.has(page) && user) {
    const defaultDashboardPath = isInPagesDirectory(window.location.pathname)
      ? 'dashboard.html'
      : 'pages/dashboard.html';
    window.location.replace(defaultDashboardPath);
  }
});
