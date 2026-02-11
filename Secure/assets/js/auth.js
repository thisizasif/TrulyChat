import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { auth } from './firebase.js';

class Auth {
  constructor() {
    this.auth = auth;
    this.googleProvider = new GoogleAuthProvider();
    this.onAuthStateChanged = onAuthStateChanged;
    this.googleRedirectResultPromise = null;
  }

  async signUp(name, email, password) {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    if (name) {
      await updateProfile(cred.user, { displayName: name });
    }
    return cred.user;
  }

  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }

  async signInWithGoogle() {
    try {
      const cred = await signInWithPopup(this.auth, this.googleProvider);
      return cred.user;
    } catch (err) {
      const code = err?.code || '';
      const shouldFallbackToRedirect = new Set([
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment',
        'auth/web-storage-unsupported'
      ]);
      if (!shouldFallbackToRedirect.has(code)) {
        throw err;
      }

      await signInWithRedirect(this.auth, this.googleProvider);
      return 'redirecting';
    }
  }

  async consumeGoogleRedirectResult() {
    if (!this.googleRedirectResultPromise) {
      this.googleRedirectResultPromise = getRedirectResult(this.auth)
        .then((result) => result?.user || null);
    }
    return this.googleRedirectResultPromise;
  }

  async signOut() {
    await signOut(this.auth);
  }

  getRedirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('redirect');
    if (!target) {
      return null;
    }

    const url = new URL(target, window.location.origin);
    if (url.hostname !== window.location.hostname) {
      return null;
    }
    return target;
  }

  getAuthErrorMessage(errorOrCode) {
    const code = typeof errorOrCode === 'string'
      ? errorOrCode
      : errorOrCode?.code;
    switch (code) {
      case 'auth/invalid-email':
        return 'Invalid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Invalid email or password.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists.';
      case 'auth/popup-blocked':
        return 'Popup was blocked by the browser. Trying redirect sign-in.';
      case 'auth/popup-closed-by-user':
        return 'Sign-in popup was closed before completing. Please try again.';
      case 'auth/cancelled-popup-request':
        return 'Another sign-in popup is already open. Please complete it first.';
      case 'auth/operation-not-supported-in-this-environment':
        return 'Google popup sign-in is not supported on this device/browser.';
      case 'auth/web-storage-unsupported':
        return 'This browser does not support required storage for Google sign-in.';
      case 'auth/network-request-failed':
        return 'Network error. Check your internet connection and try again.';
      case 'auth/operation-not-allowed':
        return 'Google sign-in is not enabled in Firebase Authentication settings.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorized in Firebase Auth settings.';
      case 'auth/account-exists-with-different-credential':
        return 'An account already exists with the same email using a different sign-in method.';
      default:
        if (code) {
          return `Authentication failed (${code}). Please try again.`;
        }
        return 'An unknown error occurred. Please try again.';
    }
  }

  goToPostAuthDefault() {
    window.location.href = 'dashboard.html';
  }

  requireAuth() {
    return new Promise((resolve) => {
      this.onAuthStateChanged(this.auth, (user) => {
        if (!user) {
          const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
          const currentWithQuery = `${currentPage}${window.location.search || ''}`;
          window.location.href = `login.html?redirect=${encodeURIComponent(currentWithQuery)}`;
          return;
        }
        resolve(user);
      });
    });
  }
}

export default new Auth();
