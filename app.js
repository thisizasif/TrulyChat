// app.js - FIXED: Messages in DB, UI clears when channel was empty
let currentChannel = null;
let userId = null;
let userName = null;
let userRef = null;
let messagesListener = null;
let messageChangesListener = null;
let onlineListener = null;
let typingListener = null;
let typingRef = null;
let typingTimeout = null;
let lastOnlineCount = 0;
let joinTimestamp = null; // Track when user joined
let serverTimeOffset = 0;
let serverTimeReady = null;
let currentUserKey = null;
let currentTheme = 'system';
let pendingReply = null;
let typingLastSent = 0;

const REACTIONS = {
    like: '&#x1F44D;',
    love: '&#x2764;&#xFE0F;',
    laugh: '&#x1F602;'
};

// Generate random user ID and name
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

function generateRandomName() {
    const adjectives = ['Ashu', 'Asba', 'Kashmir', 'Akii', 'Eager', 'Gentle', 'Happy', 'Jolly', 'Kind', 'Lucky'];
    const nouns = ['Tiger', 'Eagle', 'Dolphin', 'Wolf', 'Fox', 'Bear', 'Lion', 'Owl', 'Hawk', 'Shark'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return adj + noun + Math.floor(Math.random() * 100);
}

function getServerTime() {
    return Date.now() + serverTimeOffset;
}

function getMaxChannelNumber() {
    const raw = typeof window !== 'undefined' ? Number(window.TRULYCHAT_MAX_CHANNEL_NUMBER) : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : 9999;
}

function ensureServerTime() {
    if (serverTimeOffset !== 0) {
        return Promise.resolve();
    }
    if (serverTimeReady) {
        return serverTimeReady;
    }
    serverTimeReady = new Promise((resolve) => {
        const ref = database.ref('.info/serverTimeOffset');
        const handler = (snapshot) => {
            serverTimeOffset = snapshot.val() || 0;
            ref.off('value', handler);
            resolve();
        };
        ref.on('value', handler);
    });
    return serverTimeReady;
}

function sanitizeName(name) {
    return name
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 24);
}

function nameToKey(name) {
    return sanitizeName(name)
        .replace(/[.#$/\[\]]/g, '_')
        .replace(/\s+/g, '_')
        .toLowerCase();
}

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getInitials(name) {
    const clean = sanitizeName(name);
    if (!clean) return '?';
    const parts = clean.split(' ');
    const first = parts[0][0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
}

// Join a channel
async function joinChannel(channelFromUrl = null) {
    let channel;

    if (channelFromUrl) {
        channel = channelFromUrl;
    } else {
        const channelInput = document.getElementById('channelInput');
        channel = channelInput.value.trim();
    }

    const maxChannel = getMaxChannelNumber();
    if (!channel || channel < 1 || channel > maxChannel) {
        if (!channelFromUrl) {
            alert(`Please enter a valid channel number (1-${maxChannel})`);
        }
        return;
    }

    const nameInput = document.getElementById('nameInput');
    const storedName = localStorage.getItem('trulychat_name') || '';
    const providedName = sanitizeName((nameInput && nameInput.value) || storedName);

    if (!providedName) {
        alert('Please enter your name to join');
        if (nameInput) nameInput.focus();
        return;
    }

    if (nameInput) {
        nameInput.value = providedName;
    }

    localStorage.setItem('trulychat_name', providedName);

    await ensureServerTime();

    currentChannel = channel;
    userId = generateUserId();
    userName = providedName;
    currentUserKey = nameToKey(providedName);
    joinTimestamp = getServerTime(); // Set join time using server offset
    lastOnlineCount = 0;
    clearReply();

    // Switch to chat screen
    const channelScreenEl = document.getElementById('channelScreen');
    if (channelScreenEl) {
        channelScreenEl.style.display = 'none';
    }
    const chatScreenEl = document.getElementById('chatScreen');
    if (chatScreenEl) {
        chatScreenEl.style.display = 'flex';
    }
    document.getElementById('currentChannel').textContent = channel;
    document.getElementById('currentUserName').textContent = userName;
    document.getElementById('messageInput').focus();

    // Clear previous messages from UI
    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }
    showEmptyState();

    // Update URL with channel for sharing
    updateURLWithChannel(channel);

    // Setup Firebase listeners
    setupChannelListeners();

    // Add join message
    addSystemMessage(`You joined Channel ${channel} as ${userName}`);

    // Update online users count
    updateOnlineUsers();
}

// Setup Firebase database listeners
function setupChannelListeners() {
    // Remove any existing listeners first
    removeChannelListeners();

    // Listen for online users updates
    onlineListener = database.ref(`channels/${currentChannel}/online`).on('value', (snapshot) => {
        const onlineCount = snapshot.numChildren();
        updateOnlineCount(onlineCount);
        updateOnlineUsersList(snapshot);

        lastOnlineCount = onlineCount;
    });

    // Listen for NEW messages - CRITICAL FIX
    messagesListener = database.ref(`channels/${currentChannel}/messagesAll`)
        .orderByChild('timestamp')
        .startAt(joinTimestamp)
        .on('child_added', (snapshot) => {
        const message = snapshot.val();

        displayMessage(message, snapshot.key);
    });

    messageChangesListener = database.ref(`channels/${currentChannel}/messagesAll`).on('child_changed', (snapshot) => {
        const message = snapshot.val();
        updateMessage(message, snapshot.key);
    });

    // Add current user to online list
    userRef = database.ref(`channels/${currentChannel}/online/${userId}`);
    userRef.set({
        name: userName,
        joinedAt: firebase.database.ServerValue.TIMESTAMP,
        timestamp: Date.now()
    });

    // Remove user when they disconnect
    userRef.onDisconnect().remove();

    // Typing indicator setup
    typingRef = database.ref(`channels/${currentChannel}/typing/${userId}`);
    typingRef.onDisconnect().remove();
    typingListener = database.ref(`channels/${currentChannel}/typing`).on('value', (snapshot) => {
        updateTypingIndicator(snapshot);
    });
}

// Remove Firebase listeners
function removeChannelListeners() {
    if (messagesListener) {
        database.ref(`channels/${currentChannel}/messagesAll`)
            .orderByChild('timestamp')
            .startAt(joinTimestamp)
            .off('child_added', messagesListener);
        messagesListener = null;
    }
    if (messageChangesListener) {
        database.ref(`channels/${currentChannel}/messagesAll`).off('child_changed', messageChangesListener);
        messageChangesListener = null;
    }
    if (onlineListener) {
        database.ref(`channels/${currentChannel}/online`).off('value', onlineListener);
        onlineListener = null;
    }
    if (typingListener) {
        database.ref(`channels/${currentChannel}/typing`).off('value', typingListener);
        typingListener = null;
    }
}

// Send a message
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const messageText = messageInput.value.trim().slice(0, 500);

    if (!messageText) return;

    const message = {
        userId: userId,
        userName: userName,
        userKey: currentUserKey,
        text: messageText,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        type: 'user'
    };
    if (pendingReply && pendingReply.id) {
        message.replyTo = {
            id: pendingReply.id,
            userName: pendingReply.userName,
            text: pendingReply.text
        };
    }

    // Push message to Firebase (stays in database)
    const msgRef = database.ref(`channels/${currentChannel}/messagesAll`).push();
    msgRef.set(message);
    if (currentUserKey) {
        database.ref(`channels/${currentChannel}/messages/${currentUserKey}/${msgRef.key}`).set(message);
    }

    // Clear input
    messageInput.value = '';
    messageInput.focus();
    setTyping(false);
    clearReply();
}

function renderReactions(reactions) {
    if (!reactions) return '';
    const items = Object.keys(REACTIONS).map((key) => {
        const count = reactions[key] || 0;
        if (!count) return '';
        return `<span class="reaction-pill">${REACTIONS[key]} ${count}</span>`;
    }).join('');
    if (!items) return '';
    return `<div class="reaction-list">${items}</div>`;
}

// Display a message in the chat
function displayMessage(message, messageId) {
    const messagesContainer = document.getElementById('messagesContainer');
    const messageElement = document.createElement('div');
    removeEmptyState();

    const safeText = escapeHTML(message.text || '');
    const safeName = escapeHTML(message.userName || '');
    const isDeleted = message.deleted === true;
    const isEdited = message.editedAt && !isDeleted;
    const replyBlock = message.replyTo
        ? `<div class="message-reply"><strong>${escapeHTML(message.replyTo.userName || 'User')}:</strong> ${escapeHTML(message.replyTo.text || '')}</div>`
        : '';
    const reactionsBlock = renderReactions(message.reactions);

    if (message.type === 'system') {
        messageElement.className = 'message system-message';
        messageElement.innerHTML = `<span class="system-text">${safeText}</span>`;
    } else {
        messageElement.className = 'message ' + (message.userId === userId ? 'own-message' : 'other-message');

        const avatar = `<div class="message-avatar">${escapeHTML(getInitials(message.userName || ''))}</div>`;
        if (message.userId === userId) {
            messageElement.innerHTML = `
                <div class="message-row own-row">
                    ${avatar}
                    <div class="message-content">
                        ${replyBlock}
                        <div class="message-text">${isDeleted ? '<em>(deleted)</em>' : safeText}</div>
                        <div class="message-meta">
                            <span class="message-time">${formatTime(message.timestamp)}</span>
                            ${isEdited ? '<span class="edited-badge">edited</span>' : ''}
                        </div>
                        ${reactionsBlock}
                    </div>
                </div>
                <div class="message-sender">You</div>
                <div class="message-actions">
                    <button type="button" class="message-btn" data-action="reply">Reply</button>
                    <button type="button" class="message-btn" data-action="copy">Copy</button>
                    <div class="reaction-row">
                        <button type="button" class="reaction-btn" data-reaction="like">${REACTIONS.like}</button>
                        <button type="button" class="reaction-btn" data-reaction="love">${REACTIONS.love}</button>
                        <button type="button" class="reaction-btn" data-reaction="laugh">${REACTIONS.laugh}</button>
                    </div>
                    <button type="button" class="message-btn" data-action="edit">Edit</button>
                    <button type="button" class="message-btn danger" data-action="delete">Delete</button>
                </div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-row">
                    ${avatar}
                    <div>
                        <div class="message-sender">${safeName}</div>
                        <div class="message-content">
                            ${replyBlock}
                            <div class="message-text">${isDeleted ? '<em>(deleted)</em>' : safeText}</div>
                            <div class="message-meta">
                                <span class="message-time">${formatTime(message.timestamp)}</span>
                                ${isEdited ? '<span class="edited-badge">edited</span>' : ''}
                            </div>
                            ${reactionsBlock}
                        </div>
                        <div class="message-actions">
                            <button type="button" class="message-btn" data-action="reply">Reply</button>
                            <button type="button" class="message-btn" data-action="copy">Copy</button>
                            <div class="reaction-row">
                                <button type="button" class="reaction-btn" data-reaction="like">${REACTIONS.like}</button>
                                <button type="button" class="reaction-btn" data-reaction="love">${REACTIONS.love}</button>
                                <button type="button" class="reaction-btn" data-reaction="laugh">${REACTIONS.laugh}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    if (messageId) {
        messageElement.dataset.messageId = messageId;
    }
    messageElement.dataset.text = (message.text || '').toLowerCase();
    messageElement.dataset.rawText = message.text || '';
    messageElement.dataset.sender = (message.userName || '').toLowerCase();
    messageElement.dataset.senderName = message.userName || (message.userId === userId ? 'You' : 'User');
    messageElement.dataset.userId = message.userId || '';
    messageElement.dataset.userKey = message.userKey || nameToKey(message.userName || '');
    messageElement.dataset.rawText = message.text || '';

    const actionButtons = messageElement.querySelectorAll('.message-btn');
    actionButtons.forEach((button) => {
        button.addEventListener('click', handleMessageAction);
        button.addEventListener('touchstart', handleMessageAction, { passive: true });
    });

    const reactionButtons = messageElement.querySelectorAll('.reaction-btn');
    reactionButtons.forEach((button) => {
        button.addEventListener('click', handleReaction);
        button.addEventListener('touchstart', handleReaction, { passive: true });
    });

    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    filterMessages();
}

function filterMessages() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    const query = searchInput.value.trim().toLowerCase();
    const messages = document.querySelectorAll('#messagesContainer .message');
    messages.forEach((message) => {
        const text = message.dataset.text || '';
        const sender = message.dataset.sender || '';
        const matches = !query || text.includes(query) || sender.includes(query);
        message.classList.toggle('hidden', !matches);
    });
}

function updateMessage(message, messageId) {
    if (!messageId) return;
    const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
    if (!messageElement) return;

    const isDeleted = message.deleted === true;
    const isEdited = message.editedAt && !isDeleted;
    const textEl = messageElement.querySelector('.message-text');
    const timeEl = messageElement.querySelector('.message-time');
    const editedEl = messageElement.querySelector('.edited-badge');

    if (textEl) {
        textEl.innerHTML = isDeleted ? '<em>(deleted)</em>' : escapeHTML(message.text || '');
    }
    if (timeEl) {
        timeEl.textContent = formatTime(message.timestamp);
    }
    if (isEdited && !editedEl) {
        const meta = messageElement.querySelector('.message-meta');
        if (meta) {
            const badge = document.createElement('span');
            badge.className = 'edited-badge';
            badge.textContent = 'edited';
            meta.appendChild(badge);
        }
    }
    if (!isEdited && editedEl) {
        editedEl.remove();
    }

    const contentEl = messageElement.querySelector('.message-content');
    const existingReactions = messageElement.querySelector('.reaction-list');
    const reactionsBlock = renderReactions(message.reactions);
    if (reactionsBlock) {
        if (existingReactions) {
            existingReactions.outerHTML = reactionsBlock;
        } else if (contentEl) {
            contentEl.insertAdjacentHTML('beforeend', reactionsBlock);
        }
    } else if (existingReactions) {
        existingReactions.remove();
    }

    messageElement.dataset.text = (message.text || '').toLowerCase();
    messageElement.dataset.rawText = message.text || '';
    messageElement.dataset.userKey = message.userKey || nameToKey(message.userName || '');
    filterMessages();
}

function showEmptyState() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    if (container.querySelector('.empty-state-chat')) return;
    const empty = document.createElement('div');
    empty.className = 'empty-state-chat';
    empty.innerHTML = `
        <h3>No messages yet</h3>
        <p>Start the conversation or invite others to this channel.</p>
    `;
    container.appendChild(empty);
}

function removeEmptyState() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    const empty = container.querySelector('.empty-state-chat');
    if (empty) empty.remove();
}

// Add system message
function addSystemMessage(text) {
    const message = {
        text: text,
        timestamp: getServerTime(),
        type: 'system'
    };
    displayMessage(message);
}

// Update online users count
function updateOnlineCount(count) {
    const countEl = document.getElementById('onlineCount');
    if (countEl) {
        countEl.textContent = count;
    }
    const menuCount = document.getElementById('menuOnlineCount');
    if (menuCount) {
        menuCount.textContent = `${count} online`;
    }
}

// Update online users list
function updateOnlineUsers() {
    database.ref(`channels/${currentChannel}/online`).once('value')
        .then((snapshot) => {
            const onlineCount = snapshot.numChildren();
            updateOnlineCount(onlineCount);
            updateOnlineUsersList(snapshot);
        });
}

function updateOnlineUsersList(snapshot) {
    const container = document.getElementById('onlineUsers');
    const menuContainer = document.getElementById('menuOnlineUsers');
    if (!container) return;

    const users = [];
    snapshot.forEach((child) => {
        const data = child.val();
        if (data && data.name) {
            users.push({ id: child.key, name: data.name });
        }
    });

    if (users.length === 0) {
        container.innerHTML = '<div class="empty-online">No one is online</div>';
        if (menuContainer) {
            menuContainer.innerHTML = '<div class="empty-online">No one is online</div>';
        }
        return;
    }

    const listHtml = users.map((user) => {
        const safeName = escapeHTML(user.name);
        const initials = escapeHTML(getInitials(user.name));
        const isSelf = user.id === userId;
        return `
            <div class="online-user${isSelf ? ' self' : ''}">
                <span class="avatar">${initials}</span>
                <span class="name">${safeName}</span>
            </div>
        `;
    }).join('');

    container.innerHTML = listHtml;
    if (menuContainer) {
        menuContainer.innerHTML = listHtml;
    }
}

function updateTypingIndicator(snapshot) {
    const indicator = document.getElementById('typingIndicator');
    const mobileIndicator = document.getElementById('typingIndicatorMobile');

    let typingCount = 0;
    snapshot.forEach((child) => {
        if (child.key === userId) return;
        const data = child.val();
        if (!data || !data.typing) return;
        if (Date.now() - (data.timestamp || 0) > 5000) return;
        typingCount += 1;
    });

    const text = typingCount === 0 ? '' : 'Typing...';
    if (indicator) indicator.textContent = text;
    if (mobileIndicator) mobileIndicator.textContent = text;
}

function setTyping(isTyping) {
    if (!typingRef) return;
    if (!isTyping) {
        typingRef.remove();
        typingLastSent = 0;
        return;
    }
    const now = Date.now();
    if (now - typingLastSent < 800) return;
    typingLastSent = now;
    typingRef.set({
        name: userName,
        typing: true,
        timestamp: now
    });
}

function setReplyFromElement(messageElement) {
    if (!messageElement) return;
    const messageId = messageElement.dataset.messageId;
    const senderName = messageElement.dataset.senderName || 'User';
    const rawText = messageElement.dataset.rawText || '';
    pendingReply = {
        id: messageId,
        userName: senderName,
        text: rawText.slice(0, 120)
    };
    const preview = document.getElementById('replyPreview');
    const nameEl = document.getElementById('replyName');
    const textEl = document.getElementById('replyText');
    if (preview && nameEl && textEl) {
        nameEl.textContent = senderName;
        textEl.textContent = pendingReply.text;
        preview.style.display = 'flex';
    }
}

function clearReply() {
    pendingReply = null;
    const preview = document.getElementById('replyPreview');
    if (preview) {
        preview.style.display = 'none';
    }
}

function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        resolve();
    });
}

function ensureToastContainer() {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function showToast(message, type = 'info', duration = 2200) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function applyTheme(theme) {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark');
    if (theme === 'light') {
        body.classList.add('theme-light');
    } else if (theme === 'dark') {
        body.classList.add('theme-dark');
    }
    currentTheme = theme;
    localStorage.setItem('trulychat_theme', theme);
    updateThemeButton();
}

function updateThemeButton() {
    const btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    const label = currentTheme === 'system' ? 'System' : currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1);
    btn.textContent = `Theme: ${label}`;
}

function cycleTheme() {
    const next = currentTheme === 'system' ? 'light' : currentTheme === 'light' ? 'dark' : 'system';
    applyTheme(next);
    showToast(`Theme set to ${next}`, 'info');
}

function openHelpModal() {
    const existing = document.getElementById('helpModal');
    if (existing) return;

    const modal = document.createElement('div');
    modal.id = 'helpModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Help</h3>
            <ul class="help-list">
                <li>Join by entering your name and a channel number.</li>
                <li>Share the channel link to invite others.</li>
                <li>Long-press or right-click a message to see actions.</li>
                <li>Use Next to jump to a random channel.</li>
            </ul>
            <div class="modal-actions">
                <button type="button" class="modal-btn save">Got it</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });
    modal.querySelector('.save').addEventListener('click', close);
}

function clearChatLocal() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    container.innerHTML = '';
    showEmptyState();
    showToast('Chat cleared (local only)', 'info');
}

function startInlineEdit(messageElement) {
    const existing = messageElement.querySelector('.inline-editor');
    if (existing) return;
    const rawText = messageElement.dataset.rawText || '';
    const editor = document.createElement('div');
    editor.className = 'inline-editor';
    editor.innerHTML = `
        <textarea rows="2"></textarea>
        <div class="inline-editor-actions">
            <button type="button" class="editor-btn save">Save</button>
            <button type="button" class="editor-btn cancel">Cancel</button>
        </div>
    `;
    messageElement.appendChild(editor);
    const textarea = editor.querySelector('textarea');
    textarea.value = rawText;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    editor.querySelector('.cancel').addEventListener('click', () => {
        editor.remove();
    });

    editor.querySelector('.save').addEventListener('click', () => {
        const messageId = messageElement.dataset.messageId;
        if (!messageId) return;
        const next = textarea.value.trim().slice(0, 500);
        if (!next) return;
        const userKey = messageElement.dataset.userKey || currentUserKey;
        const updates = {
            text: next,
            editedAt: Date.now()
        };
        database.ref(`channels/${currentChannel}/messagesAll/${messageId}`).update(updates);
        if (userKey) {
            database.ref(`channels/${currentChannel}/messages/${userKey}/${messageId}`).update(updates);
        }
        editor.remove();
        showToast('Message updated', 'success');
    });
}

function handleReaction(event) {
    const directButton = event.currentTarget && event.currentTarget.classList && event.currentTarget.classList.contains('reaction-btn')
        ? event.currentTarget
        : null;
    const button = directButton || (event.target && event.target.closest ? event.target.closest('.reaction-btn') : null);
    if (!button) return;
    if (event && event.stopPropagation) {
        event.stopPropagation();
    }
    if (event && event.preventDefault && event.cancelable) {
        event.preventDefault();
    }
    const reaction = button.dataset.reaction;
    if (!reaction || !REACTIONS[reaction]) return;

    const messageElement = button.closest('.message');
    if (!messageElement) return;
    const messageId = messageElement.dataset.messageId;
    if (!messageId || !currentChannel) return;
    if (messageElement.querySelector('.message-text em')) return;

    const userKey = messageElement.dataset.userKey || currentUserKey;
    const paths = [
        `channels/${currentChannel}/messagesAll/${messageId}/reactions/${reaction}`
    ];
    if (userKey) {
        paths.push(`channels/${currentChannel}/messages/${userKey}/${messageId}/reactions/${reaction}`);
    }

    paths.forEach((path) => {
        database.ref(path).transaction((current) => (current || 0) + 1);
    });

    document.querySelectorAll('.message.show-actions').forEach((el) => el.classList.remove('show-actions'));
}

function handleMessageAction(event) {
    const directButton = event.currentTarget && event.currentTarget.classList && event.currentTarget.classList.contains('message-btn')
        ? event.currentTarget
        : null;
    const button = directButton || (event.target && event.target.closest ? event.target.closest('.message-btn') : null);
    if (!button) return;
    if (event && event.preventDefault) {
        event.preventDefault();
    }
    if (event && event.stopPropagation) {
        event.stopPropagation();
    }
    const action = button.dataset.action;
    const messageElement = button.closest('.message');
    if (!messageElement) return;

    const messageId = messageElement.dataset.messageId;
    const messageUserId = messageElement.dataset.userId;
    const rawText = messageElement.dataset.rawText || '';
    const isDeleted = messageElement.querySelector('.message-text em');

    if (!messageId) return;

    if (action === 'reply') {
        if (isDeleted) return;
        setReplyFromElement(messageElement);
        const input = document.getElementById('messageInput');
        if (input) input.focus();
        document.querySelectorAll('.message.show-actions').forEach((el) => el.classList.remove('show-actions'));
        return;
    }

    if (action === 'copy') {
        copyText(rawText || '').then(() => {
            showToast('Copied to clipboard', 'success');
        });
        document.querySelectorAll('.message.show-actions').forEach((el) => el.classList.remove('show-actions'));
        return;
    }

    if (messageUserId !== userId) {
        return;
    }

    if (action === 'edit') {
        if (isDeleted) return;
        startInlineEdit(messageElement);
        document.querySelectorAll('.message.show-actions').forEach((el) => el.classList.remove('show-actions'));
        return;
    }

    if (action === 'delete') {
        const userKey = messageElement.dataset.userKey || currentUserKey;
        const updates = {
            text: '',
            deleted: true,
            editedAt: Date.now()
        };
        database.ref(`channels/${currentChannel}/messagesAll/${messageId}`).update(updates);
        if (userKey) {
            database.ref(`channels/${currentChannel}/messages/${userKey}/${messageId}`).update(updates);
        }
        showToast('Message deleted', 'success');
        document.querySelectorAll('.message.show-actions').forEach((el) => el.classList.remove('show-actions'));
    }
}

function changeName() {
    openNameModal();
}

function openNameModal() {
    const existing = document.getElementById('nameModal');
    if (existing) return;

    const modal = document.createElement('div');
    modal.id = 'nameModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Change name</h3>
            <p>Update your display name for this session.</p>
            <input type="text" id="nameModalInput" maxlength="24" placeholder="Your name" />
            <div class="modal-actions">
                <button type="button" class="modal-btn cancel">Cancel</button>
                <button type="button" class="modal-btn save">Save</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    const input = document.getElementById('nameModalInput');
    if (input) {
        input.value = userName || '';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    const close = () => modal.remove();
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });
    modal.querySelector('.cancel').addEventListener('click', close);
    modal.querySelector('.save').addEventListener('click', () => {
        const next = sanitizeName(input.value);
        if (!next) {
            showToast('Enter a valid name', 'warning');
            return;
        }
        if (next === userName) {
            showToast('Name unchanged', 'info');
            close();
            return;
        }

        userName = next;
        currentUserKey = nameToKey(next);
        localStorage.setItem('trulychat_name', next);
        const nameInput = document.getElementById('nameInput');
        if (nameInput) nameInput.value = next;
        const currentUserName = document.getElementById('currentUserName');
        if (currentUserName) currentUserName.textContent = next;

        if (userRef) {
            userRef.update({ name: next, timestamp: Date.now() });
        }
        showToast('Name updated', 'success');
        close();
    });
}

function generateRandomChannel() {
    const maxChannel = getMaxChannelNumber();
    return Math.floor(Math.random() * maxChannel) + 1;
}

async function nextChannel() {
    if (!currentChannel) return;
    const next = generateRandomChannel();
    leaveChannel({ redirect: false });
    await joinChannel(String(next));
}

function openMenu() {
    const panel = document.getElementById('menuPanel');
    const backdrop = document.getElementById('menuBackdrop');
    const toggle = document.getElementById('menuToggle');
    if (!panel || !backdrop || !toggle) return;
    panel.classList.add('open');
    backdrop.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
    const panel = document.getElementById('menuPanel');
    const backdrop = document.getElementById('menuBackdrop');
    const toggle = document.getElementById('menuToggle');
    if (!panel || !backdrop || !toggle) return;
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
}

function setupLongPress() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    let pressTimer = null;
    let activeMessage = null;

    const hideAllMessageActions = () => {
        document.querySelectorAll('.message.show-actions').forEach((el) => {
            el.classList.remove('show-actions');
        });
    };

    const clearActive = () => {
        if (activeMessage) {
            activeMessage.classList.remove('show-actions');
            activeMessage = null;
        }
    };

    const startPress = (target) => {
        if (target.closest && target.closest('.message-actions')) {
            return;
        }
        const message = target.closest('.message');
        if (!message) return;
        if (activeMessage && activeMessage === message && message.classList.contains('show-actions')) {
            return;
        }
        clearActive();
        activeMessage = message;
        pressTimer = setTimeout(() => {
            if (activeMessage) {
                activeMessage.classList.add('show-actions');
            }
        }, 450);
    };

    const cancelPress = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    container.addEventListener('touchstart', (event) => startPress(event.target), { passive: true });
    container.addEventListener('touchend', cancelPress);
    container.addEventListener('touchmove', cancelPress);
    container.addEventListener('mousedown', (event) => startPress(event.target));
    container.addEventListener('mouseup', cancelPress);
    container.addEventListener('mouseleave', cancelPress);

    const handleOutsidePress = (event) => {
        const openActions = document.querySelector('.message.show-actions');
        if (!openActions) return;
        if (event.target && event.target.closest && event.target.closest('.message-actions')) {
            return;
        }
        hideAllMessageActions();
        activeMessage = null;
    };

    document.addEventListener('click', handleOutsidePress);
    document.addEventListener('touchstart', handleOutsidePress, { passive: true });

    container.addEventListener('contextmenu', (event) => {
        const message = event.target.closest('.message');
        if (!message) return;
        event.preventDefault();
        if (message.classList.contains('show-actions')) {
            hideAllMessageActions();
            activeMessage = null;
            return;
        }
        hideAllMessageActions();
        activeMessage = message;
        activeMessage.classList.add('show-actions');
    });

    document.addEventListener('contextmenu', (event) => {
        if (event.target && event.target.closest && event.target.closest('.message')) {
            return;
        }
        hideAllMessageActions();
        activeMessage = null;
    });
}

// Share channel link
function shareChannel() {
    if (!currentChannel) {
        alert('Please join a channel first');
        return;
    }

    const channelLink = `${window.location.origin}${window.location.pathname}?channel=${currentChannel}`;

    // Create modal for sharing
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2000;
    `;

    modal.innerHTML = `
        <div style="background: white; padding: 25px; border-radius: 10px; max-width: 500px; width: 90%;">
            <h3 style="margin: 0 0 15px 0; color: #333;">Share Channel ${currentChannel}</h3>
            <p style="margin: 0 0 15px 0; color: #666;">Send this link to invite others:</p>
            <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 20px; word-break: break-all; font-family: monospace; font-size: 14px;">
                ${channelLink}
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                        style="flex: 1; padding: 10px; background: #666; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">
                    Close
                </button>
                <button id="copyBtn" 
                        style="flex: 1; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">
                    Copy Link
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add copy functionality
    document.getElementById('copyBtn').onclick = function () {
        copyToClipboard(channelLink, this);
    };

    // Close on background click
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Helper function for copying to clipboard
function copyToClipboard(text, button) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            button.innerHTML = 'Copied!';
            button.style.background = '#2E7D32';

            setTimeout(() => {
                const modal = button.closest('div[style*="position: fixed"]');
                if (modal) {
                    document.body.removeChild(modal);
                }
            }, 1500);
        }).catch(() => {
            fallbackCopy(text, button);
        });
    } else {
        fallbackCopy(text, button);
    }
}

// Fallback copy method
function fallbackCopy(text, button) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    button.innerHTML = 'Copied!';
    button.style.background = '#2E7D32';

    setTimeout(() => {
        const modal = button.closest('div[style*="position: fixed"]');
        if (modal) {
            document.body.removeChild(modal);
        }
    }, 1500);
}

// Update URL with channel
function updateURLWithChannel(channel) {
    const url = new URL(window.location);
    url.searchParams.set('channel', channel);
    window.history.pushState({}, '', url);
}

// Check URL for channel on load
async function checkURLForChannel() {
    const urlParams = new URLSearchParams(window.location.search);
    const channel = urlParams.get('channel');
    const nameFromUrl = urlParams.get('name');

    if (nameFromUrl) {
        const decoded = decodeURIComponent(nameFromUrl);
        const safeName = sanitizeName(decoded);
        if (safeName) {
            localStorage.setItem('trulychat_name', safeName);
        }
    }

    const maxChannel = getMaxChannelNumber();
    if (channel && channel >= 1 && channel <= maxChannel) {
        const nameInput = document.getElementById('nameInput');
        const channelInput = document.getElementById('channelInput');
        const storedName = sanitizeName(localStorage.getItem('trulychat_name') || '');

        if (channelInput) {
            channelInput.value = channel;
        }
        if (nameInput && storedName) {
            nameInput.value = storedName;
        }

        if (storedName) {
            // Auto-join only if name is already known
            await joinChannel(channel);
            return true;
        }
    }
    return false;
}

// Leave channel
function leaveChannel(options = {}) {
    const { redirect = true } = options;
    if (currentChannel && userId) {
        // Remove user from online list
        database.ref(`channels/${currentChannel}/online/${userId}`).remove();

        // Add leave message
        addSystemMessage(`You left Channel ${currentChannel}`);

        // Remove Firebase listeners
        removeChannelListeners();

        // Remove onDisconnect handler
        if (userRef) {
            userRef.onDisconnect().cancel();
        }
        if (typingRef) {
            typingRef.remove();
            typingRef.onDisconnect().cancel();
        }
    }

    // Clear URL parameter
    const url = new URL(window.location);
    url.searchParams.delete('channel');
    window.history.pushState({}, '', url);

    // Return to channel screen (or redirect to join page if not present)
    const channelScreen = document.getElementById('channelScreen');
    const chatScreen = document.getElementById('chatScreen');
    if (channelScreen && chatScreen) {
        channelScreen.style.display = 'flex';
        chatScreen.style.display = 'none';
        const channelInput = document.getElementById('channelInput');
        if (channelInput) channelInput.value = '';
    } else if (redirect) {
        window.location.href = 'index.html';
        return;
    }
    const currentUserName = document.getElementById('currentUserName');
    if (currentUserName) currentUserName.textContent = '---';
    document.getElementById('messageInput').value = '';
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) typingIndicator.textContent = '';
    const onlineUsers = document.getElementById('onlineUsers');
    if (onlineUsers) onlineUsers.innerHTML = '';
    const menuUsers = document.getElementById('menuOnlineUsers');
    if (menuUsers) menuUsers.innerHTML = '';
    const menuCount = document.getElementById('menuOnlineCount');
    if (menuCount) menuCount.textContent = '0 online';
    closeMenu();
    clearReply();

    // Reset variables
    currentChannel = null;
    userId = null;
    userName = null;
    userRef = null;
    messagesListener = null;
    onlineListener = null;
    typingListener = null;
    typingRef = null;
    typingTimeout = null;
    currentUserKey = null;
    lastOnlineCount = 0;
    joinTimestamp = null;
}

// Handle Enter key press
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Format timestamp
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Cleanup old messages (optional - runs once)
function cleanupOldMessages() {
    database.ref('channels').once('value', (snapshot) => {
        snapshot.forEach((channelSnapshot) => {
            const messages = channelSnapshot.child('messagesAll');
            if (messages.numChildren() > 100) {
                const updates = {};
                let count = 0;
                messages.forEach((messageSnapshot) => {
                    if (count < messages.numChildren() - 100) {
                        updates[messageSnapshot.key] = null;
                    }
                    count++;
                });
                database.ref(`channels/${channelSnapshot.key}/messages`).update(updates);
            }
        });
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    database.ref('.info/serverTimeOffset').on('value', (snapshot) => {
        serverTimeOffset = snapshot.val() || 0;
    });

    const storedTheme = localStorage.getItem('trulychat_theme') || 'system';
    applyTheme(storedTheme);

    const nameInput = document.getElementById('nameInput');
    const storedName = localStorage.getItem('trulychat_name');
    if (nameInput && storedName) {
        nameInput.value = sanitizeName(storedName);
    }

    const channelInput = document.getElementById('channelInput');
    if (channelInput) {
        channelInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                joinChannel();
            }
        });
    }

    if (nameInput) {
        nameInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                joinChannel();
            }
        });
    }

    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (searchInput) {
        searchInput.addEventListener('input', filterMessages);
    }
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                filterMessages();
            }
        });
    }

    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('input', () => {
            setTyping(true);
            if (typingTimeout) {
                clearTimeout(typingTimeout);
            }
            typingTimeout = setTimeout(() => setTyping(false), 1500);
        });

        messageInput.addEventListener('blur', () => {
            setTyping(false);
        });
    }

    const cancelReplyBtn = document.getElementById('cancelReplyBtn');
    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', clearReply);
    }

    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) {
        messagesContainer.addEventListener('click', handleMessageAction);
    }

    const changeNameBtn = document.getElementById('changeNameBtn');
    if (changeNameBtn) {
        changeNameBtn.addEventListener('click', changeName);
    }
    const changeNameBtnDesktop = document.getElementById('changeNameBtnDesktop');
    if (changeNameBtnDesktop) {
        changeNameBtnDesktop.addEventListener('click', changeName);
    }

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', cycleTheme);
    }

    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) {
        helpBtn.addEventListener('click', openHelpModal);
    }

    const clearChatBtn = document.getElementById('clearChatBtn');
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChatLocal);
    }

    const nextChannelBtn = document.getElementById('nextChannelBtn');
    if (nextChannelBtn) {
        nextChannelBtn.addEventListener('click', nextChannel);
    }

    const menuToggle = document.getElementById('menuToggle');
    const menuClose = document.getElementById('menuClose');
    const menuBackdrop = document.getElementById('menuBackdrop');
    const menuPanel = document.getElementById('menuPanel');
    if (menuToggle) {
        menuToggle.addEventListener('click', openMenu);
    }
    if (menuClose) {
        menuClose.addEventListener('click', closeMenu);
    }
    if (menuBackdrop) {
        menuBackdrop.addEventListener('click', closeMenu);
    }
    if (menuPanel) {
        menuPanel.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('menu-item')) {
                closeMenu();
            }
        });
    }

    setupLongPress();

    // Check if URL has channel parameter
    if (!await checkURLForChannel()) {
        const channelScreen = document.getElementById('channelScreen');
        if (channelScreen) {
            // Show channel screen and focus input
            channelScreen.style.display = 'flex';
            if (nameInput) {
                nameInput.focus();
            } else {
                const channelInput = document.getElementById('channelInput');
                if (channelInput) channelInput.focus();
            }
        } else {
            // Chat-only page without channel join form
            const params = new URLSearchParams(window.location.search);
            const channel = params.get('channel');
            if (channel) {
                window.location.href = `index.html?channel=${encodeURIComponent(channel)}`;
            } else {
                window.location.href = 'index.html';
            }
        }
    }

    // Optional: Cleanup old messages every hour
    setInterval(cleanupOldMessages, 3600000);
});

// Detect keyboard on mobile and adjust viewport
let viewport = document.querySelector("meta[name=viewport]");
const originalViewport = viewport.content;

function setViewportForKeyboard() {
    if (window.innerWidth < 768) {
        viewport.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
    }
}

function resetViewport() {
    viewport.content = originalViewport;
}

// Listen for focus on input
document.getElementById('messageInput').addEventListener('focus', setViewportForKeyboard);
document.getElementById('messageInput').addEventListener('blur', resetViewport);
