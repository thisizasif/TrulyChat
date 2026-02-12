import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { auth } from './firebase.js';

const AUTH_ENTRY_PAGES = new Set(['login.html', 'signup.html', 'sorry.html']);

function getPageName(pathname) {
  const page = (pathname.split('/').pop() || 'index.html').toLowerCase();
  return page || 'index.html';
}

function isInPagesDirectory(pathname) {
  return pathname.toLowerCase().includes('/pages/');
}

function buildLoginRedirect(pathname, search, hash) {
  const inPages = isInPagesDirectory(pathname);
  const sorryPath = inPages ? 'sorry.html' : 'pages/sorry.html';
  const page = getPageName(pathname);
  const target = `${page}${search || ''}${hash || ''}`;
  return `${sorryPath}?redirect=${encodeURIComponent(target)}`;
}

function requiresEmailVerification(user) {
  if (!user) return false;
  const providers = Array.isArray(user.providerData) ? user.providerData : [];
  const hasPassword = providers.some((provider) => provider?.providerId === 'password');
  const hasGoogle = providers.some((provider) => provider?.providerId === 'google.com');
  return hasPassword && !hasGoogle;
}

function isAuthorizedSession(user) {
  if (!user) return false;
  if (requiresEmailVerification(user) && !user.emailVerified) return false;
  return true;
}

const page = getPageName(window.location.pathname);
onAuthStateChanged(auth, (user) => {
  const isPagesPath = isInPagesDirectory(window.location.pathname);
  const isProtectedPage = isPagesPath && !AUTH_ENTRY_PAGES.has(page);

  if (isProtectedPage) {
    if (isAuthorizedSession(user)) return;
    const loginUrl = buildLoginRedirect(window.location.pathname, window.location.search, window.location.hash);
    window.location.replace(loginUrl);
    return;
  }

  if (AUTH_ENTRY_PAGES.has(page) && isAuthorizedSession(user)) {
    const defaultDashboardPath = isInPagesDirectory(window.location.pathname)
      ? 'dashboard.html'
      : 'pages/dashboard.html';
    window.location.replace(defaultDashboardPath);
  }
});