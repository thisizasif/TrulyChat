import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import { auth } from './firebase.js';
import { deriveNameFromEmail } from './name-utils.js';

class Auth {
  constructor() {
    this.auth = auth;
    this.googleProvider = new GoogleAuthProvider();
    this.onAuthStateChanged = onAuthStateChanged;
    this.googleRedirectResultPromise = null;
  }

  requiresEmailVerification(user) {
    if (!user) return false;
    const providers = Array.isArray(user.providerData) ? user.providerData : [];
    return providers.some((provider) => provider?.providerId === 'password');
  }

  async signUp(name, email, password) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      throw { code: 'auth/missing-name' };
    }
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(cred.user, { displayName: cleanName });
    await sendEmailVerification(cred.user);
    await signOut(this.auth);
    return { verificationSent: true };
  }

  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    if (this.requiresEmailVerification(cred.user) && !cred.user.emailVerified) {
      await sendEmailVerification(cred.user).catch(() => {});
      await signOut(this.auth);
      throw { code: 'auth/email-not-verified' };
    }
    return cred.user;
  }

  async signInWithGoogle() {
    try {
      const cred = await signInWithPopup(this.auth, this.googleProvider);
      await this.ensureGoogleProfileName(cred.user);
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
        .then(async (result) => {
          const user = result?.user || null;
          if (!user) return null;
          await this.ensureGoogleProfileName(user);
          return user;
        });
    }
    return this.googleRedirectResultPromise;
  }

  async ensureGoogleProfileName(user) {
    if (!user) return user;
    const current = String(user.displayName || '').trim();
    if (current) return user;
    const nextName = deriveNameFromEmail(user.email, 'Member');
    if (!nextName) return user;
    await updateProfile(user, { displayName: nextName });
    return user;
  }
  async resendVerification(email, password = '') {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) {
      throw { code: 'auth/missing-email' };
    }

    const cleanPassword = String(password || '');
    if (!cleanPassword) {
      throw { code: 'auth/missing-password' };
    }

    const cred = await signInWithEmailAndPassword(this.auth, cleanEmail, cleanPassword);
    if (!this.requiresEmailVerification(cred.user)) {
      await signOut(this.auth).catch(() => {});
      throw { code: 'auth/no-email-verification-needed' };
    }

    if (cred.user.emailVerified) {
      await signOut(this.auth).catch(() => {});
      throw { code: 'auth/already-verified' };
    }

    await sendEmailVerification(cred.user);
    await signOut(this.auth).catch(() => {});
    return true;
  }
  async sendPasswordReset(email) {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) {
      throw { code: 'auth/missing-email' };
    }
    await sendPasswordResetEmail(this.auth, cleanEmail);
    return true;
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
      case 'auth/missing-password':
        return 'Please enter your password.';
      case 'auth/no-email-verification-needed':
        return 'This account does not require email verification.';
      case 'auth/already-verified':
        return 'Your email is already verified. You can log in now.';
      case 'auth/missing-email':
        return 'Please enter your email first.';
      case 'auth/missing-name':
        return 'Full name is required.';
      case 'auth/email-not-verified':
        return 'Please verify your email first. We sent a verification email. Please open your inbox and then log in.';
      case 'auth/invalid-email':
        return 'Invalid email address.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
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
      this.onAuthStateChanged(this.auth, async (user) => {
        if (!user) {
          const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
          const currentWithQuery = `${currentPage}${window.location.search || ''}`;
          window.location.href = `login.html?redirect=${encodeURIComponent(currentWithQuery)}`;
          return;
        }

        if (this.requiresEmailVerification(user) && !user.emailVerified) {
          await signOut(this.auth).catch(() => {});
          const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
          const currentWithQuery = `${currentPage}${window.location.search || ''}`;
          window.location.href = `login.html?redirect=${encodeURIComponent(currentWithQuery)}&verify=required`;
          return;
        }

        resolve(user);
      });
    });
  }
}

export default new Auth();








