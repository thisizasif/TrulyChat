class UI {
  constructor() {
    this.roomNameEls = document.querySelectorAll('[data-room-name]');
    this.memberBadges = document.querySelectorAll('[data-member-badge]');
    this.onlineBadges = document.querySelectorAll('[data-online-count]');
    this.messagesEl = document.querySelector('[data-messages]');
    this.messageForm = document.querySelector('[data-message-form]');
    this.deleteRoomBtn = document.querySelector('[data-delete-room]');
    this.leaveRoomBtn = document.querySelector('[data-leave-room]');
    this.shareRoomBtn = document.querySelector('[data-share-room]');
    this.onlineListEls = document.querySelectorAll('[data-online-list]');
    this.memberListEls = document.querySelectorAll('[data-member-list]');
    this.bannedListEls = document.querySelectorAll('[data-banned-list]');
    this.ownerOnlySections = document.querySelectorAll('[data-owner-only]');
    this.currentUserNameEl = document.querySelector('[data-current-user-name]');
    this.currentUserAvatarEl = document.querySelector('[data-current-user-avatar]');
    this.toastOverlay = document.querySelector('[data-toast-overlay]');
    this.toastConfirm = document.querySelector('[data-toast-confirm]');
    this.toastCancel = document.querySelector('[data-toast-cancel]');
    this.toastStatus = document.querySelector('[data-toast-status]');
    this.passwordBtn = document.querySelector('[data-room-password]');
    this.passwordOverlay = document.querySelector('[data-password-overlay]');
    this.passwordInput = document.querySelector('#roomPasswordInput');
    this.passwordCancel = document.querySelector('[data-password-cancel]');
    this.passwordSave = document.querySelector('[data-password-save]');
    this.passwordStatus = document.querySelector('[data-password-status]');
    this.passwordCheckOverlay = document.querySelector('[data-password-check-overlay]');
    this.passwordCheckInput = document.querySelector('#roomPasswordCheck');
    this.passwordCheckCancel = document.querySelector('[data-password-check-cancel]');
    this.passwordCheckConfirm = document.querySelector('[data-password-check-confirm]');
    this.passwordCheckStatus = document.querySelector('[data-password-check-status]');
  }

  initialsFromName(name) {
    if (!name) return 'U';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'U';
  }

  renderMessage(id, data, currentUser, options = {}) {
    if (!this.messagesEl) return;
    const isMe = data.uid === currentUser.uid;
    const isOwner = !!options.isOwner;
    const canDelete = isMe || isOwner;
    const shell = document.createElement('div');
    shell.className = `message-shell ${isMe ? 'me' : ''}`;
    shell.dataset.messageId = id;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    if (data.photoURL) {
      const img = document.createElement('img');
      img.src = data.photoURL;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      avatar.textContent = this.initialsFromName(data.displayName || 'Member');
    }

    const message = document.createElement('div');
    message.className = `message ${isMe ? 'me' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const author = document.createElement('strong');
    author.textContent = data.displayName || 'Member';
    const time = document.createElement('span');
    time.className = 'message-time';
    const date = data?.createdAt?.toDate?.();
    time.textContent = date
      ? date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
      : 'Now';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = data.text;

    const replyTo = data.replyTo && typeof data.replyTo === 'object' ? data.replyTo : null;
    if (replyTo && replyTo.text) {
      const reply = document.createElement('div');
      reply.className = 'message-reply-preview';
      reply.textContent = `Reply to ${replyTo.displayName || 'Member'}: ${replyTo.text}`;
      message.appendChild(reply);
    }

    meta.appendChild(author);
    meta.appendChild(time);
    message.appendChild(meta);
    message.appendChild(content);

    if (data.editedAt) {
      const edited = document.createElement('div');
      edited.className = 'message-edited';
      edited.textContent = 'Edited';
      message.appendChild(edited);
    }

    const reactions = data.reactions && typeof data.reactions === 'object' ? data.reactions : {};
    const reactionEntries = Object.values(reactions).filter(Boolean);
    if (reactionEntries.length) {
      const countByEmoji = reactionEntries.reduce((acc, emoji) => {
        acc[emoji] = (acc[emoji] || 0) + 1;
        return acc;
      }, {});
      const reactionBar = document.createElement('div');
      reactionBar.className = 'message-reactions';
      Object.entries(countByEmoji).forEach(([emoji, count]) => {
        const chip = document.createElement('span');
        chip.className = 'message-reaction-chip';
        chip.textContent = `${emoji} ${count}`;
        reactionBar.appendChild(chip);
      });
      message.appendChild(reactionBar);
    }

    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = `
      <button class="message-action-btn" type="button" data-msg-action="reply">Reply</button>
      <button class="message-action-btn" type="button" data-msg-action="react" data-emoji="👍">👍</button>
      <button class="message-action-btn" type="button" data-msg-action="react" data-emoji="❤️">❤️</button>
      <button class="message-action-btn" type="button" data-msg-action="react" data-emoji="😂">😂</button>
      ${isMe ? '<button class="message-action-btn" type="button" data-msg-action="edit">Edit</button>' : ''}
      ${canDelete ? '<button class="message-action-btn danger" type="button" data-msg-action="delete">Delete</button>' : ''}
    `;
    message.appendChild(actions);

    message.title = 'Double-click to copy';
    message.addEventListener('dblclick', async () => {
      try {
        await navigator.clipboard.writeText(data.text || '');
        this.showToast('Message copied');
      } catch (_) {
        this.showToast('Unable to copy message');
      }
    });
    if (isMe) {
      shell.appendChild(message);
      shell.appendChild(avatar);
    } else {
      shell.appendChild(avatar);
      shell.appendChild(message);
    }
    this.messagesEl.appendChild(shell);
  }

  renderMessages(messages, currentUser, options = {}) {
    if (!this.messagesEl) return;
    this.messagesEl.innerHTML = '';
    messages.forEach((doc) => {
      this.renderMessage(doc.id, doc.data(), currentUser, options);
    });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  showToast(message, duration = 2200) {
    const root = this.getToastRoot();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    root.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, duration);
  }

  showConfirm(message, confirmText = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'toast-overlay show';
      overlay.innerHTML = `
        <div class="toast-card">
          <h3>Confirm</h3>
          <p class="small">${message}</p>
          <div class="toast-actions">
            <button class="btn btn-ghost" type="button" data-confirm-cancel>Cancel</button>
            <button class="btn btn-primary" type="button" data-confirm-ok>${confirmText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('[data-confirm-cancel]').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      overlay.querySelector('[data-confirm-ok]').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
    });
  }

  getToastRoot() {
    let root = document.querySelector('.toast-stack');
    if (!root) {
      root = document.createElement('div');
      root.className = 'toast-stack';
      document.body.appendChild(root);
    }
    return root;
  }
}

export default new UI();
