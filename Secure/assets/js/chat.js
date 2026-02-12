import Auth from './auth.js';
import ChatService from './chat-service.js?v=20260211w';
import UI from './ui.js';
import Store from './store.js';
import { resolveUserDisplayName } from './name-utils.js';
import { db } from './firebase.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const params = new URLSearchParams(window.location.search);
const roomId = (params.get('roomId') || '').trim();
const inviteType = (params.get('invite') || '').trim().toLowerCase();
const invitePasswordToken = (params.get('ip') || '').trim();
const roomPasswordKey = `trulychat-room-password:${roomId}`;
const roomDraftKey = `trulychat-room-draft:${roomId}`;
let composeMode = {
  type: 'send',
  messageId: '',
  replyTo: null
};
let passwordGateOpen = false;

if (!roomId) {
  window.location.href = 'rooms.html';
  throw new Error('Missing roomId');
}

function initialsFromName(name) {
  if (!name) return 'U';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';
}

function setTextAll(elements, value) {
  elements.forEach((el) => {
    el.textContent = value;
  });
}

function createAvatarNode(className, label, photoURL) {
  const avatar = document.createElement('div');
  avatar.className = className;
  if (photoURL) {
    const img = document.createElement('img');
    img.src = photoURL;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    avatar.textContent = initialsFromName(label);
  }
  return avatar;
}


function renderOnlineUsers(containers, rows) {
  containers.forEach((container) => {
    container.innerHTML = '';
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'No users found.';
      container.appendChild(p);
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'nav-online-item';

      const avatar = createAvatarNode('nav-online-avatar', row.label, row.photoURL);

      const info = document.createElement('div');
      info.className = 'nav-member-info';

      const name = document.createElement('span');
      name.textContent = row.label;

      info.appendChild(name);
      if (row.isOwner) {
        const badge = document.createElement('span');
        badge.className = 'nav-member-badge';
        badge.textContent = 'Owner';
        info.appendChild(badge);
      }
      if (row.isBanned) {
        const badge = document.createElement('span');
        badge.className = 'nav-member-badge';
        badge.textContent = 'Banned';
        info.appendChild(badge);
      }

      item.appendChild(avatar);
      item.appendChild(info);

      if (row.isOnline && !row.isBanned) {
        const dot = document.createElement('span');
        dot.className = 'nav-online-dot';
        dot.setAttribute('aria-hidden', 'true');
        item.appendChild(dot);
      }

      container.appendChild(item);
    });
  });
}

function renderManageUsers(containers, rows, onAction) {
  containers.forEach((container) => {
    container.innerHTML = '';
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'No online users to manage.';
      container.appendChild(p);
      return;
    }

    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'nav-member-item';

      const info = document.createElement('div');
      info.className = 'nav-member-info';

      const avatar = createAvatarNode('nav-online-avatar', row.label, row.photoURL);

      const name = document.createElement('span');
      name.textContent = row.label;
      info.appendChild(avatar);
      info.appendChild(name);

      if (row.isOwner) {
        const badge = document.createElement('span');
        badge.className = 'nav-member-badge';
        badge.textContent = 'Owner';
        info.appendChild(badge);
      }

      item.appendChild(info);

      if (!row.isOwner && !row.isMe) {
        const actions = document.createElement('div');
        actions.className = 'nav-member-actions';

        const kickBtn = document.createElement('button');
        kickBtn.type = 'button';
        kickBtn.className = 'nav-mini-btn';
        kickBtn.textContent = 'Kick';
        kickBtn.addEventListener('click', () => onAction('kick', row.uid, row.label, row.photoURL || '', kickBtn));

        const banBtn = document.createElement('button');
        banBtn.type = 'button';
        banBtn.className = 'nav-mini-btn danger';
        banBtn.textContent = 'Ban';
        banBtn.addEventListener('click', () => onAction('ban', row.uid, row.label, row.photoURL || '', banBtn));

        actions.appendChild(kickBtn);
        actions.appendChild(banBtn);
        item.appendChild(actions);
      }

      container.appendChild(item);
    });
  });
}

function renderBannedUsers(containers, rows, onUnban) {
  containers.forEach((container) => {
    container.innerHTML = '';
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'No banned users.';
      container.appendChild(p);
      return;
    }

    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'nav-member-item';

      const info = document.createElement('div');
      info.className = 'nav-member-info';

      const avatar = createAvatarNode('nav-online-avatar', row.label, row.photoURL);

      const name = document.createElement('span');
      name.textContent = row.label;

      const badge = document.createElement('span');
      badge.className = 'nav-member-badge';
      badge.textContent = 'Banned';

      info.appendChild(avatar);
      info.appendChild(name);
      info.appendChild(badge);

      const unbanBtn = document.createElement('button');
      unbanBtn.type = 'button';
      unbanBtn.className = 'nav-mini-btn';
      unbanBtn.textContent = 'Unban';
      unbanBtn.addEventListener('click', () => onUnban(row.uid, row.label, unbanBtn));

      item.appendChild(info);
      item.appendChild(unbanBtn);
      container.appendChild(item);
    });
  });
}

function bindComposerState(chatService) {
  if (!UI.messageForm) return;
  const input = UI.messageForm.message;
  const sendBtn = UI.messageForm.querySelector('button[type="submit"]');
  const typingIndicator = document.querySelector('[data-typing-indicator]');
  const contextWrap = document.querySelector('[data-compose-context]');
  const contextText = document.querySelector('[data-compose-context-text]');
  if (!input || !sendBtn) return;
  let stopTypingTimer = null;
  let typingSent = false;

  const refreshComposeContext = () => {
    if (!contextWrap || !contextText) return;
    if (composeMode.type === 'reply' && composeMode.replyTo) {
      contextWrap.hidden = false;
      contextText.textContent = `Replying to ${composeMode.replyTo.displayName || 'Member'}: ${composeMode.replyTo.text}`;
      sendBtn.textContent = 'Reply';
      return;
    }
    if (composeMode.type === 'edit' && composeMode.messageId) {
      contextWrap.hidden = false;
      contextText.textContent = 'Editing message';
      sendBtn.textContent = 'Save';
      return;
    }
    contextWrap.hidden = true;
    contextText.textContent = '';
    sendBtn.textContent = 'Send';
  };

  const clearComposeMode = () => {
    composeMode = {
      type: 'send',
      messageId: '',
      replyTo: null
    };
    refreshComposeContext();
  };

  const sync = () => {
    const text = input.value.trim();
    sendBtn.disabled = !text;
    try {
      sessionStorage.setItem(roomDraftKey, input.value);
    } catch (_) {
    }

    const shouldType = text.length > 0;
    if (shouldType && !typingSent) {
      typingSent = true;
      chatService.setTyping(true);
    }
    if (stopTypingTimer) {
      clearTimeout(stopTypingTimer);
    }
    stopTypingTimer = window.setTimeout(() => {
      typingSent = false;
      chatService.setTyping(false);
    }, 1200);
  };

  try {
    const savedDraft = sessionStorage.getItem(roomDraftKey);
    if (savedDraft) {
      input.value = savedDraft;
    }
  } catch (_) {
  }

  UI.messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      if (composeMode.type === 'edit' && composeMode.messageId) {
        await chatService.editMessage(composeMode.messageId, text);
      } else {
        await chatService.sendMessage(text, {
          replyTo: composeMode.type === 'reply' ? composeMode.replyTo : null
        });
      }
    } catch (err) {
      UI.showToast(err?.message || 'Failed to send message.');
      return;
    }
    UI.messageForm.reset();
    try {
      sessionStorage.removeItem(roomDraftKey);
    } catch (_) {
    }
    clearComposeMode();
    typingSent = false;
    chatService.setTyping(false);
    sync();
  });

  input.addEventListener('input', sync);
  window.addEventListener('beforeunload', () => {
    chatService.setTyping(false);
  });
  sync();
  refreshComposeContext();

  Store.subscribe(() => {
    if (!typingIndicator) return;
    const state = Store.getState();
    const presence = state.presence || {};
    const user = state.user;
    const members = state.members || new Map();
    const typingUsers = Object.keys(presence).filter((uid) => (
      uid !== user?.uid && presence[uid]?.typing
    ));
    if (!typingUsers.length) {
      typingIndicator.textContent = '';
      return;
    }
    const names = typingUsers
      .map((uid) => members.get(uid)?.displayName || presence[uid]?.displayName || 'Someone')
      .slice(0, 2);
    typingIndicator.textContent = names.length > 1 ? `${names.join(', ')} are typing...` : `${names[0]} is typing...`;
  });

  return {
    setReplyMode(message) {
      composeMode = {
        type: 'reply',
        messageId: message.id,
        replyTo: {
          id: message.id,
          uid: message.uid,
          displayName: message.displayName || 'Member',
          text: String(message.text || '').slice(0, 140)
        }
      };
      refreshComposeContext();
      input.focus();
    },
    setEditMode(message) {
      composeMode = {
        type: 'edit',
        messageId: message.id,
        replyTo: null
      };
      input.value = message.text || '';
      refreshComposeContext();
      sync();
      input.focus();
    },
    clearComposeMode
  };
}

function bindMessageActionReveal() {
  const messagesEl = UI.messagesEl;
  if (!messagesEl) return;

  let activeShell = null;
  let longPressTimer = null;

  const hide = () => {
    if (activeShell) {
      activeShell.classList.remove('show-actions');
      activeShell = null;
    }
  };

  const show = (shell) => {
    if (!shell) return;
    if (activeShell && activeShell !== shell) {
      activeShell.classList.remove('show-actions');
    }
    activeShell = shell;
    activeShell.classList.add('show-actions');
  };

  messagesEl.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const shell = target.closest('[data-message-id]');
    if (!shell) return;
    event.preventDefault();
    show(shell);
  });

  messagesEl.addEventListener('touchstart', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const shell = target.closest('[data-message-id]');
    if (!shell) return;
    clearTimeout(longPressTimer);
    longPressTimer = window.setTimeout(() => {
      show(shell);
    }, 450);
  }, { passive: true });

  const clearLongPress = () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  };
  messagesEl.addEventListener('touchend', clearLongPress, { passive: true });
  messagesEl.addEventListener('touchmove', clearLongPress, { passive: true });
  messagesEl.addEventListener('touchcancel', clearLongPress, { passive: true });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      hide();
      return;
    }
    if (target.closest('[data-msg-action]')) return;
    hide();
  }, true);

  document.addEventListener('contextmenu', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      hide();
      return;
    }
    if (!target.closest('[data-message-id]')) {
      hide();
    }
  }, true);

  return { hide };
}

function bindMessageActions(chatService, currentUser, composerApi, actionMenuApi) {
  const messagesEl = UI.messagesEl;
  if (!messagesEl) return;

  messagesEl.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const actionBtn = target.closest('[data-msg-action]');
    if (!actionBtn) return;

    const action = actionBtn.getAttribute('data-msg-action') || '';
    const shell = actionBtn.closest('[data-message-id]');
    const messageId = shell?.getAttribute('data-message-id') || '';
    if (!messageId) return;

    const messageDoc = (Store.getState().messages || []).find((docSnap) => docSnap.id === messageId);
    const message = messageDoc?.data?.();
    if (!message) return;

    if (action === 'reply') {
      composerApi?.setReplyMode({ id: messageId, ...message });
      actionMenuApi?.hide();
      return;
    }

    if (action === 'edit') {
      if (message.uid !== currentUser.uid) {
        UI.showToast('You can only edit your own messages.');
        return;
      }
      composerApi?.setEditMode({ id: messageId, ...message });
      actionMenuApi?.hide();
      return;
    }

    if (action === 'delete') {
      const confirmed = await UI.showConfirm('Delete this message?', 'Delete');
      if (!confirmed) return;
      try {
        await chatService.deleteMessage(messageId);
        composerApi?.clearComposeMode();
        actionMenuApi?.hide();
      } catch (err) {
        UI.showToast(err?.message || 'Unable to delete message.');
      }
      return;
    }

    if (action === 'react') {
      const emoji = actionBtn.getAttribute('data-emoji') || '👍';
      try {
        await chatService.toggleReaction(messageId, emoji);
        actionMenuApi?.hide();
      } catch (err) {
        UI.showToast(err?.message || 'Unable to react to message.');
      }
    }
  });
}

function bindShare(chatService) {
  const buttons = document.querySelectorAll('[data-share-room]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const payload = chatService.getSharePayload();
      try {
        await navigator.clipboard.writeText(payload.roomId);
        UI.showToast(`Room ID copied: ${payload.roomId}`);
      } catch (_) {
        UI.showToast(payload.inviteText);
      }
    });
  });
}

function decodeInvitePassword(token) {
  if (!token) return '';
  try {
    const raw = atob(token);
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (_) {
    try {
      return atob(token);
    } catch (_) {
      return '';
    }
  }
}

function clearInviteParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  url.searchParams.delete('ip');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function openInviteShareFallback(payload) {
  const title = `Join ${payload.roomName}`;
  const text = payload.isOwner
    ? `Join ${payload.roomName} on TrulyChat (owner invite).`
    : `Join ${payload.roomName} on TrulyChat.`;
  const encodedUrl = encodeURIComponent(payload.inviteUrl);
  const encodedText = encodeURIComponent(`${text} ${payload.inviteUrl}`);
  const encodedTitle = encodeURIComponent(title);

  const channels = [
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodedText}` },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(text)}` },
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodedText}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { label: 'Email', href: `mailto:?subject=${encodedTitle}&body=${encodedText}` }
  ];

  const overlay = document.createElement('div');
  overlay.className = 'toast-overlay show';
  const buttonsHtml = channels
    .map((item) => `<a class="btn btn-ghost" href="${item.href}" target="_blank" rel="noopener noreferrer">${item.label}</a>`)
    .join('');

  overlay.innerHTML = `
    <div class="toast-card">
      <h3>Share invite</h3>
      <p class="small">Choose where to share this room invite link.</p>
      <div class="toast-actions" style="justify-content: flex-start; flex-wrap: wrap;">
        ${buttonsHtml}
      </div>
      <div class="toast-actions">
        <button class="btn btn-ghost" type="button" data-share-copy>Copy link</button>
        <button class="btn btn-primary" type="button" data-share-close>Close</button>
      </div>
      <p class="small" data-share-status></p>
    </div>
  `;

  const close = () => overlay.remove();
  const copyBtn = overlay.querySelector('[data-share-copy]');
  const closeBtn = overlay.querySelector('[data-share-close]');
  const statusEl = overlay.querySelector('[data-share-status]');

  closeBtn?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', function onEsc(event) {
    if (event.key !== 'Escape') return;
    document.removeEventListener('keydown', onEsc);
    close();
  }, { once: true });

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(payload.inviteUrl);
      if (statusEl) statusEl.textContent = 'Invite link copied.';
    } catch (_) {
      if (statusEl) statusEl.textContent = payload.inviteUrl;
    }
  });

  document.body.appendChild(overlay);
}

function bindInvite(chatService) {
  const buttons = document.querySelectorAll('[data-invite-room]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const payload = chatService.getInvitePayload();
      try {
        if (navigator.share) {
          await navigator.share({
            title: `Join ${payload.roomName}`,
            text: payload.isOwner
              ? `Join ${payload.roomName} on TrulyChat (owner invite).`
              : `Join ${payload.roomName} on TrulyChat.`,
            url: payload.inviteUrl
          });
          UI.showToast('Invite shared.');
          return;
        }
        openInviteShareFallback(payload);
      } catch (_) {
        openInviteShareFallback(payload);
      }
    });
  });
}

function bindLeave(chatService) {
  const buttons = document.querySelectorAll('[data-leave-room]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const confirmed = await UI.showConfirm('Leave this room now?', 'Leave');
      if (!confirmed) return;
      try {
        await chatService.leaveRoom();
        window.location.href = 'rooms.html';
      } catch (err) {
        UI.showToast(err?.message || 'Unable to leave room.');
      }
    });
  });
}

async function findOpenRoomForSwitch(currentUser) {
  const roomsSnap = await getDocs(collection(db, 'rooms'));
  const candidates = [];
  roomsSnap.forEach((snap) => {
    if (snap.id === roomId) return;
    const room = snap.data() || {};
    if (room.password) return;
    candidates.push({
      id: snap.id,
      ...room
    });
  });

  candidates.sort((a, b) => {
    const aSec = a?.createdAt?.seconds || 0;
    const bSec = b?.createdAt?.seconds || 0;
    return bSec - aSec;
  });

  for (const candidate of candidates) {
    const banRef = doc(db, 'rooms', candidate.id, 'bans', currentUser.uid);
    const banSnap = await getDoc(banRef);
    if (banSnap.exists()) continue;
    return candidate;
  }
  return null;
}

async function joinOpenRoom(candidate, currentUser) {
  await setDoc(doc(db, 'users', currentUser.uid, 'rooms', candidate.id), {
    roomId: candidate.id,
    name: candidate.name || 'Room',
    joinedAt: serverTimestamp()
  }, { merge: true });

  await setDoc(doc(db, 'rooms', candidate.id, 'members', currentUser.uid), {
    uid: currentUser.uid,
    displayName: resolveUserDisplayName(currentUser),
    photoURL: currentUser.photoURL || '',
    joinedAt: serverTimestamp()
  }, { merge: true });

  try {
    sessionStorage.setItem(`trulychat-room-password:${candidate.id}`, '');
  } catch (_) {
  }
}

function bindChangeRoom(chatService, currentUser) {
  const buttons = document.querySelectorAll('[data-change-room]');
  if (!buttons.length) return;

  buttons.forEach((button) => {
    const baseText = button.textContent || 'Change room';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Switching...';

      try {
        const candidate = await findOpenRoomForSwitch(currentUser);
        if (!candidate) {
          UI.showToast('No other open rooms are available right now.');
          return;
        }

        await joinOpenRoom(candidate, currentUser);
        await chatService.leaveRoomSilently().catch(() => {});
        window.location.href = `chat.html?roomId=${encodeURIComponent(candidate.id)}`;
      } catch (err) {
        UI.showToast(err?.message || 'Unable to change room right now.');
      } finally {
        button.disabled = false;
        button.textContent = baseText;
      }
    });
  });
}

function bindLogoutCleanup(chatService) {
  const buttons = document.querySelectorAll('[data-logout]');
  buttons.forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button instanceof HTMLButtonElement) {
        button.disabled = true;
        button.textContent = 'Logging out...';
      }

      await Promise.race([
        chatService.setOffline(),
        new Promise((resolve) => window.setTimeout(resolve, 450))
      ]).catch(() => {});

      const cleanupWithTimeout = Promise.race([
        chatService.leaveRoomSilently(),
        new Promise((resolve) => window.setTimeout(resolve, 1200))
      ]);

      await cleanupWithTimeout.catch(() => {});
      await Auth.signOut().catch(() => {});
      window.location.replace('../index.html');
    });
  });
}

function bindDelete(chatService, currentUser) {
  const buttons = document.querySelectorAll('[data-delete-room]');
  const overlay = UI.toastOverlay;
  const confirmBtn = UI.toastConfirm;
  const cancelBtn = UI.toastCancel;
  const statusEl = UI.toastStatus;
  if (!overlay || !confirmBtn || !cancelBtn) return;

  const open = () => {
    const room = Store.getState().room;
    if (!room || room.ownerUid !== currentUser.uid) {
      UI.showToast('Only the room owner can delete this room.');
      return;
    }
    if (statusEl) statusEl.textContent = '';
    overlay.classList.add('show');
  };

  const close = () => {
    overlay.classList.remove('show');
    if (statusEl) statusEl.textContent = '';
  };

  buttons.forEach((btn) => btn.addEventListener('click', open));
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Deleting room...';
    try {
      await chatService.deleteRoom();
      window.location.href = 'rooms.html';
    } catch (err) {
      if (statusEl) statusEl.textContent = err?.message || 'Failed to delete room.';
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

function bindPassword(chatService, currentUser) {
  const buttons = document.querySelectorAll('[data-room-password]');
  const overlay = UI.passwordOverlay;
  const input = UI.passwordInput;
  const saveBtn = UI.passwordSave;
  const cancelBtn = UI.passwordCancel;
  const statusEl = UI.passwordStatus;
  if (!overlay || !input || !saveBtn || !cancelBtn) return;

  const open = () => {
    const room = Store.getState().room;
    if (!room || room.ownerUid !== currentUser.uid) {
      UI.showToast('Only owner can manage room password.');
      return;
    }
    statusEl.textContent = '';
    input.value = room.password || '';
    overlay.classList.add('show');
    input.focus();
  };

  const close = () => {
    overlay.classList.remove('show');
    statusEl.textContent = '';
    input.value = '';
  };

  buttons.forEach((btn) => btn.addEventListener('click', open));
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    statusEl.textContent = 'Saving...';
    try {
      await chatService.setRoomPassword(input.value.trim());
      statusEl.textContent = 'Password updated.';
      window.setTimeout(close, 600);
    } catch (err) {
      statusEl.textContent = err?.message || 'Unable to update password.';
    } finally {
      saveBtn.disabled = false;
    }
  });

  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveBtn.click();
    });
  }
}

function bindPasswordCheckOverlay() {
  const overlay = UI.passwordCheckOverlay;
  const cancelBtn = UI.passwordCheckCancel;
  const confirmBtn = UI.passwordCheckConfirm;
  const input = UI.passwordCheckInput;
  const statusEl = UI.passwordCheckStatus;
  if (!overlay || !cancelBtn || !confirmBtn) return;

  const openGate = () => {
    passwordGateOpen = true;
    if (statusEl) statusEl.textContent = 'Room password changed. Enter the new password to continue.';
    if (input) {
      input.value = '';
      input.focus();
    }
    overlay.classList.add('show');
  };

  const closeGate = () => {
    passwordGateOpen = false;
    if (statusEl) statusEl.textContent = '';
    if (input) input.value = '';
    overlay.classList.remove('show');
  };

  const requirePasswordIfNeeded = () => {
    const state = Store.getState();
    const room = state.room || {};
    const user = state.user;
    if (!user || !room) return;
    if (room.ownerUid === user.uid) {
      closeGate();
      return;
    }

    const expected = room.password || '';
    if (inviteType === 'owner' && invitePasswordToken && expected) {
      const decodedPassword = decodeInvitePassword(invitePasswordToken);
      if (decodedPassword && decodedPassword === expected) {
        try {
          sessionStorage.setItem(roomPasswordKey, expected);
        } catch (_) {
        }
        clearInviteParamsFromUrl();
      }
    }

    const accepted = (() => {
      try {
        return sessionStorage.getItem(roomPasswordKey) || '';
      } catch (_) {
        return '';
      }
    })();

    if (!expected) {
      closeGate();
      return;
    }

    if (accepted !== expected) {
      openGate();
    } else if (passwordGateOpen) {
      closeGate();
    }
  };

  cancelBtn.addEventListener('click', () => {
    window.location.href = 'rooms.html';
  });
  confirmBtn.addEventListener('click', () => {
    const room = Store.getState().room || {};
    const expected = room.password || '';
    const entered = (input?.value || '').trim();
    if (!expected || entered === expected) {
      try {
        sessionStorage.setItem(roomPasswordKey, entered);
      } catch (_) {
      }
      closeGate();
      return;
    }
    if (statusEl) statusEl.textContent = 'Incorrect password. Try again or go back.';
    if (input) {
      input.value = '';
      input.focus();
    }
  });

  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      confirmBtn.click();
    });
  }

  Store.subscribe(() => {
    requirePasswordIfNeeded();
  });
  requirePasswordIfNeeded();
}

function initPasswordToggleButtons() {
  const toggles = document.querySelectorAll('[data-password-toggle]');
  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.getAttribute('data-target');
      if (!targetId) return;
      const input = document.getElementById(targetId);
      if (!(input instanceof HTMLInputElement)) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      toggle.textContent = reveal ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', reveal ? 'true' : 'false');
      toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      input.focus();
    });
  });
}

function syncChatUI(currentUser) {
  const state = Store.getState();
  const room = state.room || {};
  const members = state.members || new Map();
  const presence = state.presence || {};
  const banned = state.banned || new Map();
  const roomTitle = room.name || 'Room';
  const onlineUids = Object.keys(presence).filter((uid) => presence[uid]?.state === 'online');

  setTextAll(UI.roomNameEls, roomTitle);
  setTextAll(UI.memberBadges, `ID: ${roomId}`);
  setTextAll(UI.onlineBadges, `${onlineUids.length} online`);

  const meMember = members.get(currentUser.uid) || null;
  const mePresence = presence[currentUser.uid] || null;
  const meName = meMember?.displayName || mePresence?.displayName || resolveUserDisplayName(currentUser);
  const mePhoto = meMember?.photoURL || mePresence?.photoURL || currentUser.photoURL || '';

  if (UI.currentUserNameEl) {
    UI.currentUserNameEl.textContent = meName;
  }
  if (UI.currentUserAvatarEl) {
    UI.currentUserAvatarEl.innerHTML = '';
    if (mePhoto) {
      const img = document.createElement('img');
      img.src = mePhoto;
      img.alt = '';
      UI.currentUserAvatarEl.appendChild(img);
    } else {
      UI.currentUserAvatarEl.textContent = initialsFromName(meName || 'User');
    }
  }

  const isOwner = room.ownerUid === currentUser.uid;
  UI.ownerOnlySections.forEach((section) => {
    section.hidden = !isOwner;
    section.style.display = isOwner ? '' : 'none';
  });
  document.querySelectorAll('[data-delete-room], [data-room-password]').forEach((button) => {
    button.hidden = !isOwner;
  });

  const onlineRows = onlineUids.map((uid) => {
    const member = members.get(uid);
    const presenceName = presence[uid]?.displayName;
    const label = member?.displayName || presenceName || uid;
    return {
      uid,
      label,
      photoURL: member?.photoURL || presence[uid]?.photoURL || '',
      isOwner: uid === room.ownerUid,
      isOnline: true,
      isBanned: false
    };
  });

  const bannedRowsForOnline = Array.from(banned.entries()).map(([uid, member]) => {
    const label = member?.displayName || uid;
    return {
      uid,
      label,
      photoURL: member?.photoURL || '',
      isOwner: uid === room.ownerUid,
      isOnline: false,
      isBanned: true
    };
  });

  const combinedOnlineRows = [...onlineRows];
  bannedRowsForOnline.forEach((row) => {
    if (!combinedOnlineRows.some((item) => item.uid === row.uid)) {
      combinedOnlineRows.push(row);
    }
  });

  renderOnlineUsers(UI.onlineListEls, combinedOnlineRows);

  const memberRows = onlineUids.map((uid) => {
    const member = members.get(uid);
    const presenceName = presence[uid]?.displayName;
    const label = member?.displayName || presenceName || uid;
    return {
      uid,
      label,
      photoURL: member?.photoURL || presence[uid]?.photoURL || '',
      isOwner: uid === room.ownerUid,
      isMe: uid === currentUser.uid
    };
  });
  renderManageUsers(UI.memberListEls, isOwner ? memberRows : [], async (action, uid, label, photoURL, btn) => {
    btn.disabled = true;
    try {
      if (action === 'kick') {
        await chatServiceRef?.kickUser(uid);
        UI.showToast(`${label} was removed from room.`);
      } else {
        await chatServiceRef?.banUser(uid, label, photoURL || '');
        UI.showToast(`${label} was banned.`);
      }
    } catch (err) {
      UI.showToast(err?.message || 'Failed to update member.');
    } finally {
      btn.disabled = false;
    }
  });

  const bannedRows = isOwner
    ? Array.from(banned.entries()).map(([uid, member]) => ({
      uid,
      label: member?.displayName || uid,
      photoURL: member?.photoURL || ''
    }))
    : [];
  renderBannedUsers(UI.bannedListEls, bannedRows, async (uid, label, btn) => {
    btn.disabled = true;
    try {
      await chatServiceRef?.unbanUser(uid);
      UI.showToast(`${label} was unbanned.`);
    } catch (err) {
      UI.showToast(err?.message || 'Failed to unban user.');
    } finally {
      btn.disabled = false;
    }
  });
}

let chatServiceRef = null;

Auth.requireAuth().then(async (user) => {
  Store.setState({ user });
  const chatService = new ChatService(roomId, user);
  chatServiceRef = chatService;
  await chatService.init();

  const composerApi = bindComposerState(chatService);
  const actionMenuApi = bindMessageActionReveal();
  bindInvite(chatService);
  bindShare(chatService);
  bindChangeRoom(chatService, user);
  bindMessageActions(chatService, user, composerApi, actionMenuApi);
  bindLeave(chatService);
  bindLogoutCleanup(chatService);
  bindDelete(chatService, user);
  bindPassword(chatService, user);
  bindPasswordCheckOverlay();
  initPasswordToggleButtons();

  window.addEventListener('pagehide', () => {
    chatService.leaveRoomSilently();
  });
  window.addEventListener('beforeunload', () => {
    chatService.leaveRoomSilently();
  });

  Store.subscribe(() => syncChatUI(user));
  syncChatUI(user);
}).catch(() => {
  const redirectTarget = `chat.html${window.location.search || ''}${window.location.hash || ''}`;
  window.location.href = `login.html?redirect=${encodeURIComponent(redirectTarget)}`;
});

















