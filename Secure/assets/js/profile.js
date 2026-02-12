import Auth from './auth.js';
import { auth, db, rtdb } from './firebase.js';
import { resolveUserDisplayName } from './name-utils.js';
import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import {
  get,
  ref as rtdbRef,
  set as rtdbSet
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js';

const profileForm = document.querySelector('[data-profile-form]');
const passwordForm = document.querySelector('[data-password-form]');
const avatarEl = document.querySelector('[data-profile-avatar]');
const avatarInput = document.querySelector('[data-avatar-input]');
const avatarRemoveBtn = document.querySelector('[data-avatar-remove]');
const verifyStatusEl = document.querySelector('[data-verify-status]');
const deleteBtn = document.querySelector('[data-delete-account]');

const deleteOverlay = document.querySelector('[data-delete-overlay]');
const deleteCancel = document.querySelector('[data-delete-cancel]');
const deleteConfirm = document.querySelector('[data-delete-confirm]');
const deleteStatus = document.querySelector('[data-delete-status]');
const confirmDeleteText = document.querySelector('#confirmDeleteText');
const confirmDeletePassword = document.querySelector('#confirmDeletePassword');

let userRef = null;
let pendingPhotoURL = null;
let removePhoto = false;
let persistedPhotoURL = '';

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
  window.setTimeout(() => toast.remove(), duration);
}

function initialsFromName(name) {
  if (!name) return 'U';
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';
}

function usesPasswordProvider(user) {
  return (user?.providerData || []).some((provider) => provider?.providerId === 'password');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function renderAvatar(photoURL, name) {
  if (!avatarEl) return;
  avatarEl.innerHTML = '';
  if (photoURL) {
    const img = document.createElement('img');
    img.src = photoURL;
    img.alt = '';
    avatarEl.appendChild(img);
    return;
  }
  avatarEl.textContent = initialsFromName(name);
}

function renderVerifyStatus(user) {
  if (!verifyStatusEl) return;
  const verified = !!user?.emailVerified;
  if (verified) {
    verifyStatusEl.textContent = 'Email verified.';
    return;
  }
  if (usesPasswordProvider(user)) {
    verifyStatusEl.textContent = 'Email not verified. Please verify from your inbox.';
    return;
  }
  verifyStatusEl.textContent = 'Google account.';
}

async function fileToDataUrl(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image file.'));
    el.src = dataUrl;
  });

  const size = Math.min(img.width, img.height);
  const sx = Math.floor((img.width - size) / 2);
  const sy = Math.floor((img.height - size) / 2);
  const canvas = document.createElement('canvas');
  const outSize = 256;
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to process image.');
  ctx.drawImage(img, sx, sy, size, size, 0, 0, outSize, outSize);
  return canvas.toDataURL('image/jpeg', 0.86);
}

async function syncProfileAcrossRooms(uid, displayName, photoURL) {
  const roomRefsSnap = await getDocs(collection(db, 'users', uid, 'rooms')).catch(() => null);
  if (!roomRefsSnap || roomRefsSnap.empty) return;

  const tasks = roomRefsSnap.docs.map(async (roomDoc) => {
    const roomId = roomDoc.id;

    await setDoc(doc(db, 'rooms', roomId, 'members', uid), {
      uid,
      displayName,
      photoURL,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch(() => {});

    const statusPath = rtdbRef(rtdb, `status/${roomId}/${uid}`);
    const statusSnap = await get(statusPath).catch(() => null);
    if (!statusSnap || !statusSnap.exists()) return;
    const prev = statusSnap.val() || {};

    await rtdbSet(statusPath, {
      ...prev,
      displayName,
      photoURL
    }).catch(() => {});
  });

  await Promise.all(tasks);
}

async function initProfile() {
  const user = await Auth.requireAuth();
  userRef = auth.currentUser || user;

  const nameInput = document.querySelector('#profileName');
  const emailInput = document.querySelector('#profileEmail');

  const userDocRef = doc(db, 'users', userRef.uid);
  const userDocSnap = await getDoc(userDocRef).catch(() => null);
  const userDoc = userDocSnap?.exists() ? userDocSnap.data() : {};

  const displayName = String(userDoc?.displayName || '').trim() || resolveUserDisplayName(userRef);
  persistedPhotoURL = String(userDoc?.photoURL || '').trim() || String(userRef.photoURL || '').trim();

  if (nameInput) nameInput.value = displayName;
  if (emailInput) emailInput.value = userRef.email || '';

  renderAvatar(persistedPhotoURL, displayName);
  renderVerifyStatus(userRef);

  if (!usesPasswordProvider(userRef) && passwordForm) {
    const currentInput = passwordForm.querySelector('#currentPassword');
    if (currentInput) {
      currentInput.disabled = true;
      currentInput.placeholder = 'Not required for Google account';
    }
  }
}

if (avatarInput) {
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file.');
      return;
    }

    try {
      const photo = await fileToDataUrl(file);
      pendingPhotoURL = photo;
      removePhoto = false;
      const nameInput = document.querySelector('#profileName');
      renderAvatar(photo, nameInput?.value || 'User');
      showToast('Photo ready. Save profile to apply.');
    } catch (err) {
      showToast(err?.message || 'Unable to process image.');
    } finally {
      avatarInput.value = '';
    }
  });
}

if (avatarRemoveBtn) {
  avatarRemoveBtn.addEventListener('click', () => {
    removePhoto = true;
    pendingPhotoURL = '';
    const nameInput = document.querySelector('#profileName');
    renderAvatar('', nameInput?.value || 'User');
    showToast('Photo removed. Save profile to apply.');
  });
}

if (profileForm) {
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!userRef) return;

    const nameInput = profileForm.querySelector('#profileName');
    const name = String(nameInput?.value || '').trim();

    if (!name) {
      showToast('Full name is required.');
      return;
    }

    const finalPhoto = removePhoto
      ? ''
      : (pendingPhotoURL || persistedPhotoURL || String(userRef.photoURL || ''));

    try {
      const authUpdates = { displayName: name };
      if (removePhoto) {
        authUpdates.photoURL = '';
      } else if (isHttpUrl(finalPhoto)) {
        authUpdates.photoURL = finalPhoto;
      }
      await updateProfile(userRef, authUpdates);

      await setDoc(doc(db, 'users', userRef.uid), {
        uid: userRef.uid,
        displayName: name,
        photoURL: finalPhoto,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await syncProfileAcrossRooms(userRef.uid, name, finalPhoto);

      persistedPhotoURL = finalPhoto;
      pendingPhotoURL = null;
      removePhoto = false;

      renderAvatar(finalPhoto, name);
      showToast('Profile updated everywhere.');
    } catch (err) {
      const code = err?.code || '';
      if (code) {
        showToast(`Unable to save profile changes (${code}).`);
      } else {
        showToast('Unable to save profile changes.');
      }
    }
  });
}

if (passwordForm) {
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!userRef) return;

    if (!usesPasswordProvider(userRef)) {
      showToast('Password change is only available for email/password accounts.');
      return;
    }

    const currentPassword = String(passwordForm.currentPassword?.value || '');
    const newPassword = String(passwordForm.newPassword?.value || '');
    const confirmPassword = String(passwordForm.confirmPassword?.value || '');

    if (!currentPassword) {
      showToast('Enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      showToast('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('New password and confirm password do not match.');
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(userRef.email || '', currentPassword);
      await reauthenticateWithCredential(userRef, credential);
      await updatePassword(userRef, newPassword);
      passwordForm.reset();
      showToast('Password updated successfully.');
    } catch (err) {
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        showToast('Current password is incorrect.');
        return;
      }
      if (code === 'auth/requires-recent-login') {
        showToast('Please log in again, then retry password update.');
        return;
      }
      showToast('Unable to update password.');
    }
  });
}

function openDeleteOverlay() {
  if (!deleteOverlay) return;
  deleteOverlay.classList.add('show');
  if (deleteStatus) deleteStatus.textContent = '';
  if (confirmDeleteText) confirmDeleteText.value = '';
  if (confirmDeletePassword) confirmDeletePassword.value = '';
  confirmDeleteText?.focus();
}

function closeDeleteOverlay() {
  deleteOverlay?.classList.remove('show');
}

if (deleteBtn) {
  deleteBtn.addEventListener('click', openDeleteOverlay);
}

deleteCancel?.addEventListener('click', closeDeleteOverlay);
deleteOverlay?.addEventListener('click', (event) => {
  if (event.target === deleteOverlay) closeDeleteOverlay();
});

deleteConfirm?.addEventListener('click', async () => {
  if (!userRef) return;
  const confirmation = String(confirmDeleteText?.value || '').trim().toUpperCase();

  if (confirmation !== 'DELETE') {
    if (deleteStatus) deleteStatus.textContent = 'Type DELETE to continue.';
    return;
  }

  try {
    if (usesPasswordProvider(userRef)) {
      const password = String(confirmDeletePassword?.value || '');
      if (!password) {
        if (deleteStatus) deleteStatus.textContent = 'Current password is required.';
        return;
      }
      const credential = EmailAuthProvider.credential(userRef.email || '', password);
      await reauthenticateWithCredential(userRef, credential);
    }

    await deleteUser(userRef);
    showToast('Account deleted.');
    window.setTimeout(() => {
      window.location.href = 'login.html';
    }, 650);
  } catch (err) {
    const code = err?.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      if (deleteStatus) deleteStatus.textContent = 'Current password is incorrect.';
      return;
    }
    if (code === 'auth/requires-recent-login') {
      if (deleteStatus) deleteStatus.textContent = 'Please log in again before deleting your account.';
      return;
    }
    if (deleteStatus) deleteStatus.textContent = 'Unable to delete account right now.';
  }
});

initProfile().catch(() => {
  showToast('Unable to load profile.');
});
