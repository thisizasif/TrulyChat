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
let explicitLeave = false;
let currentOnlineIds = new Set();
let onlineHeartbeatTimer = null;
let isReloading = false;
let messagesUserRef = null;
let connectedListener = null;
let isWindowFocused = true;
const MAX_MESSAGE_LENGTH = 5000;
let onlineUsersCache = [];
const SESSION_PREFIX = 'trulychat_session_';
// Defaults when opening chat.html directly without a channel
const DEFAULT_DIRECT_CHANNEL = '111';
const DEFAULT_DIRECT_NAME = 'iLOveSky';
let unreadCount = 0;
let soundEnabled = false;
let audioContext = null;
const SOUND_TOGGLE_KEY = 'trulychat_sound_enabled';
const LAST_SESSION_KEY = 'trulychat_last_session';
const LAST_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
let busiestChannelListener = null;
const COMMANDS = [
    { cmd: '/invite', label: 'Invite others' },
    { cmd: '/clear', label: 'Clear chat locally' },
    { cmd: '/leave', label: 'Leave channel' },
    { cmd: '/next', label: 'Next random channel' },
    { cmd: '/theme dark', label: 'Theme dark' },
    { cmd: '/theme light', label: 'Theme light' },
    { cmd: '/theme system', label: 'Theme system' },
    { cmd: '/help', label: 'Show commands' }
];

const REACTIONS = {
    like: '&#x1F44D;',
    love: '&#x2764;&#xFE0F;',
    laugh: '&#x1F602;'
};

// Generate random user ID and name
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

function getLastSession() {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function setLastSession(data) {
    if (!data) return;
    const payload = {
        channel: String(data.channel || '').trim(),
        name: sanitizeName(data.name || ''),
        active: Boolean(data.active),
        updatedAt: Date.now()
    };
    if (!payload.channel || !payload.name) return;
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(payload));
}

function getServerTime() {
    return Date.now() + serverTimeOffset;
}

function getSessionKey(channel, name) {
    const safeChannel = String(channel || '').trim();
    const safeName = sanitizeName(name || '');
    if (!safeChannel || !safeName) return null;
    return `${SESSION_PREFIX}${safeChannel}_${nameToKey(safeName)}`;
}

function loadSession(channel, name) {
    const key = getSessionKey(channel, name);
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function saveSession(channel, name, joinTs, id) {
    const key = getSessionKey(channel, name);
    if (!key) return;
    const payload = {
        channel: String(channel),
        name: sanitizeName(name),
        joinTimestamp: Number(joinTs) || getServerTime(),
        userId: id || null,
        updatedAt: Date.now()
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
}

function clearSession(channel, name) {
    const key = getSessionKey(channel, name);
    if (!key) return;
    sessionStorage.removeItem(key);
}

function normalizeTimestamp(value) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
    return getServerTime();
}

function getMaxChannelNumber() {
    const raw = typeof window !== 'undefined' ? Number(window.TRULYCHAT_MAX_CHANNEL_NUMBER) : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : 9999;
}

function getMaxUsersPerChannel() {
    const raw = typeof window !== 'undefined' ? Number(window.TRULYCHAT_MAX_USERS_PER_CHANNEL) : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : Infinity;
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

function getAvatarColor(seed) {
    const palette = ['#0ea5a4', '#2563eb', '#7c3aed', '#f97316', '#ef4444', '#22c55e', '#eab308', '#ec4899'];
    const value = String(seed || '').toLowerCase();
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    const index = Math.abs(hash) % palette.length;
    return palette[index];
}

function isNearBottom(container, threshold = 100) {
    if (!container) return true;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distance <= threshold;
}

function updateUnreadIndicator() {
    const button = document.getElementById('scrollToLatestBtn');
    const badge = document.getElementById('scrollUnreadCount');
    if (!button || !badge) return;
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    if (unreadCount > 0) {
        button.classList.add('show');
        button.classList.add('has-unread');
    } else {
        button.classList.remove('has-unread');
    }
}

function showScrollToLatestButton() {
    const button = document.getElementById('scrollToLatestBtn');
    if (!button) return;
    button.classList.add('show');
}

function hideScrollToLatestButton() {
    const button = document.getElementById('scrollToLatestBtn');
    if (!button) return;
    button.classList.remove('show');
    button.classList.remove('has-unread');
}

function resetUnreadIndicator() {
    unreadCount = 0;
    updateUnreadIndicator();
}

function scrollToBottom(behavior = 'smooth') {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
}

function ensureAudioContext() {
    if (audioContext) return audioContext;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (error) {
        audioContext = null;
    }
    return audioContext;
}

function playNotificationSound() {
    if (!soundEnabled || localStorage.getItem(SOUND_TOGGLE_KEY) !== '1') return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const playBeep = () => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 760;
        gain.gain.value = 0.04;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.08);
    };
    if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
            playBeep();
        }).catch(() => {});
        return;
    }
    playBeep();
}

function setSoundEnabled(enabled) {
    soundEnabled = Boolean(enabled);
    localStorage.setItem(SOUND_TOGGLE_KEY, soundEnabled ? '1' : '0');
    const button = document.getElementById('soundToggleBtn');
    if (button) {
        button.textContent = `Sound: ${soundEnabled ? 'On' : 'Off'}`;
    }
    if (soundEnabled) {
        const ctx = ensureAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
    } else {
        if (audioContext && audioContext.state === 'running') {
            audioContext.suspend().catch(() => {});
        }
    }
}

function initSoundToggle() {
    const stored = localStorage.getItem(SOUND_TOGGLE_KEY);
    if (stored === null) {
        const mobileDefaultOff = window.matchMedia('(max-width: 768px)').matches;
        setSoundEnabled(!mobileDefaultOff);
    } else {
        setSoundEnabled(stored === '1');
    }
}

async function isNameTaken(channel, name, excludeUserId = null) {
    if (!channel || !name) return false;
    const snapshot = await database.ref(`channels/${channel}/online`).once('value');
    let taken = false;
    const now = Date.now();
    const staleLimit = 45000;
    snapshot.forEach((child) => {
        if (excludeUserId && child.key === excludeUserId) return;
        const data = child.val();
        if (!data || !data.name) return;
        const lastSeen = data.timestamp || data.joinedAt || 0;
        if (lastSeen && now - lastSeen > staleLimit) {
            database.ref(`channels/${channel}/online/${child.key}`).remove();
            return;
        }
        const existing = sanitizeName(data.name).toLowerCase();
        if (existing === sanitizeName(name).toLowerCase()) {
            taken = true;
        }
    });
    return taken;
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

    const maxUsers = getMaxUsersPerChannel();
    if (Number.isFinite(maxUsers) && maxUsers !== Infinity) {
        try {
            const snapshot = await database.ref(`channels/${channel}/online`).once('value');
            if (snapshot.numChildren() >= maxUsers) {
                showToast(`This channel is full. Only ${maxUsers} users allowed.`, 'warning');
                const params = new URLSearchParams();
                params.set('error', 'channel_full');
                params.set('channel', String(channel));
                params.set('name', providedName);
                window.location.href = `join.html?${params.toString()}`;
                return;
            }
        } catch (error) {
            showToast('Unable to verify channel capacity.', 'warning');
            return;
        }
    }

    const nameTaken = await isNameTaken(channel, providedName);
    if (nameTaken) {
        showToast('Name already in use. Choose another.', 'warning');
        if (nameInput) {
            nameInput.focus();
            return;
        }
        const params = new URLSearchParams();
        params.set('error', 'name_taken');
        params.set('channel', String(channel));
        params.set('name', providedName);
        window.location.href = `join.html?${params.toString()}`;
        return;
    }

    await ensureServerTime();

    currentChannel = channel;
    const existingSession = loadSession(channel, providedName);
    userId = existingSession && existingSession.userId
        ? existingSession.userId
        : generateUserId();
    userName = providedName;
    currentUserKey = nameToKey(providedName);
    joinTimestamp = existingSession && existingSession.joinTimestamp
        ? existingSession.joinTimestamp
        : getServerTime(); // Fresh unless reloading
    lastOnlineCount = 0;
    explicitLeave = false;
    clearReply();
    setLastSession({ channel, name: userName, active: true });
    saveSession(channel, userName, joinTimestamp, userId);

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
    resetUnreadIndicator();
    hideScrollToLatestButton();

    // Update URL with channel for sharing
    updateURLWithChannel(channel);

    // Setup Firebase listeners
    setupChannelListeners();

    // Add join message
    addSystemMessage(`You joined Channel ${channel} as ${userName}`);

    // Update online users count
    updateOnlineUsers();

    // Increment visitor count once a user successfully joins a channel
    if (window.firestore && typeof firebase !== 'undefined' && firebase.firestore) {
        try {
            const inc = firebase.firestore.FieldValue.increment(1);
            window.firestore.collection('visitors').doc('total').set({ count: inc }, { merge: true });
        } catch (error) {
            // Ignore visitor count errors to avoid blocking join.
        }
    }
    if (typeof database !== 'undefined') {
        try {
            database.ref('visitors/total').transaction((value) => (Number(value) || 0) + 1);
        } catch (error) {
            // Ignore RTDB visitor count errors.
        }
    }
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
        currentOnlineIds = new Set();
        snapshot.forEach((child) => {
            if (child.key) currentOnlineIds.add(child.key);
        });
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
    if (currentUserKey) {
        messagesUserRef = database.ref(`channels/${currentChannel}/messages/${currentUserKey}`);
        messagesUserRef.onDisconnect().remove();
    }
    if (connectedListener) {
        database.ref('.info/connected').off('value', connectedListener);
    }
    connectedListener = (snap) => {
        if (snap.val() === true && userRef) {
            userRef.onDisconnect().remove();
            userRef.update({ name: userName, timestamp: Date.now() });
        }
    };
    database.ref('.info/connected').on('value', connectedListener);
    if (onlineHeartbeatTimer) {
        clearInterval(onlineHeartbeatTimer);
    }
    onlineHeartbeatTimer = setInterval(() => {
        if (userRef) {
            userRef.update({ timestamp: Date.now(), name: userName });
        }
    }, 5000);

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
    if (connectedListener) {
        database.ref('.info/connected').off('value', connectedListener);
        connectedListener = null;
    }
    if (onlineHeartbeatTimer) {
        clearInterval(onlineHeartbeatTimer);
        onlineHeartbeatTimer = null;
    }
    if (messagesUserRef) {
        messagesUserRef.onDisconnect().cancel();
        messagesUserRef = null;
    }
}

function cleanupUserData(removeMessagesAll = false) {
    if (!currentChannel || !userId) return;
    database.ref(`channels/${currentChannel}/online/${userId}`).remove();
    if (currentUserKey) {
        database.ref(`channels/${currentChannel}/messages/${currentUserKey}`).remove();
    }
    if (typingRef) {
        typingRef.remove();
    }
    if (removeMessagesAll) {
        database.ref(`channels/${currentChannel}/messagesAll`)
            .orderByChild('userId')
            .equalTo(userId)
            .once('value')
            .then((snapshot) => {
                const updates = {};
                snapshot.forEach((child) => {
                    updates[child.key] = null;
                });
                if (Object.keys(updates).length > 0) {
                    database.ref(`channels/${currentChannel}/messagesAll`).update(updates);
                }
            })
            .catch(() => {});
    }
}

function cleanupChannelIfEmpty(channel) {
    if (!channel) return;
    const onlineRef = database.ref(`channels/${channel}/online`);
    onlineRef.once('value').then((snapshot) => {
        if (snapshot.numChildren() === 0) {
            database.ref(`channels/${channel}`).remove();
            database.ref(`channelsMeta/${channel}`).remove();
        }
    }).catch(() => {});
}

// Send a message
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const messageText = messageInput.value.trim().slice(0, MAX_MESSAGE_LENGTH);

    if (!messageText) return;

    if (messageText.startsWith('/')) {
        const handled = handleSlashCommand(messageText);
        if (handled) {
            messageInput.value = '';
            messageInput.focus();
            setTyping(false);
            return;
        }
    }

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
    const wasNearBottom = isNearBottom(messagesContainer);

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

        const avatarColor = getAvatarColor(message.userId || message.userName || '');
        const avatar = `<div class="message-avatar" style="background: ${avatarColor};">${escapeHTML(getInitials(message.userName || ''))}</div>`;
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
    const isOwnMessage = message.userId === userId;
    const isSystemMessage = message.type === 'system';
    if (isOwnMessage && messageId) {
        lastOwnMessageId = messageId;
        lastOwnMessageTimestamp = normalizeTimestamp(message.timestamp);
    }
    if (!isOwnMessage && !isSystemMessage) {
        updateReadReceipt();
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    resetUnreadIndicator();
    hideScrollToLatestButton();
    if (!isOwnMessage && !isSystemMessage) {
        if (!isWindowFocused) {
            playNotificationSound();
        }
    }
    filterMessages();
}

function showCommandSuggestions(matches) {
    const container = document.getElementById('commandSuggestions');
    if (!container) return;
    if (!matches.length) {
        container.classList.remove('show');
        container.setAttribute('aria-hidden', 'true');
        container.innerHTML = '';
        return;
    }
    container.innerHTML = matches.map((item, index) => `
        <div class="command-item${index === 0 ? ' active' : ''}" data-command="${item.cmd}">
            <strong>${item.cmd}</strong>
            <span>${item.label}</span>
        </div>
    `).join('');
    container.classList.add('show');
    container.setAttribute('aria-hidden', 'false');
}

function hideCommandSuggestions() {
    const container = document.getElementById('commandSuggestions');
    if (!container) return;
    container.classList.remove('show');
    container.setAttribute('aria-hidden', 'true');
    container.innerHTML = '';
}

function filterCommands(query) {
    const needle = query.toLowerCase();
    return COMMANDS.filter((item) => item.cmd.toLowerCase().startsWith(needle));
}

function insertCommand(command) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    input.value = command + ' ';
    input.focus();
    hideCommandSuggestions();
}

function handleSlashCommand(rawText) {
    const parts = rawText.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (command) {
        case '/invite':
            shareChannel();
            showToast('Invite link opened', 'success');
            return true;
        case '/clear':
            clearChatLocal();
            showToast('Chat cleared locally', 'info');
            return true;
        case '/leave':
            leaveChannel();
            return true;
        case '/next':
            nextChannel();
            return true;
        case '/theme': {
            const next = arg.toLowerCase();
            if (!next) {
                cycleTheme();
                showToast('Theme updated', 'success');
                return true;
            }
            if (!['dark', 'light', 'system'].includes(next)) {
                showToast('Theme options: dark, light, system', 'warning');
                return true;
            }
            applyTheme(next);
            showToast(`Theme set to ${next}`, 'success');
            return true;
        }
        case '/help':
        case '/?':
            window.open('pages/help.html', '_blank');
            return true;
        default:
            return false;
    }
}

function filterMessages() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    const query = searchInput.value.trim().toLowerCase();
    const messages = document.querySelectorAll('#messagesContainer .message');
    const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlightMatch = (text, needle) => {
        if (!needle) return escapeHTML(text);
        const regex = new RegExp(escapeRegExp(needle), 'gi');
        return escapeHTML(text).replace(regex, (match) => `<mark class="search-highlight">${match}</mark>`);
    };
    messages.forEach((message) => {
        const text = message.dataset.text || '';
        const sender = message.dataset.sender || '';
        const matches = !query || text.includes(query) || sender.includes(query);
        message.classList.toggle('hidden', !matches);

        const textEl = message.querySelector('.message-text');
        if (textEl) {
            if (textEl.querySelector('em')) {
                if (!query) {
                    textEl.innerHTML = '<em>(deleted)</em>';
                }
            } else {
                const rawText = message.dataset.rawText || textEl.textContent || '';
                textEl.innerHTML = highlightMatch(rawText, query);
            }
        }

        const senderEl = message.querySelector('.message-sender');
        if (senderEl) {
            const rawSender = message.dataset.senderName || senderEl.textContent || '';
            senderEl.innerHTML = highlightMatch(rawSender, query);
        }
    });
}

function mentionMatch(search, name) {
    if (!search) return true;
    return name.toLowerCase().startsWith(search.toLowerCase());
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
        <button type="button" class="empty-state-btn">Invite others</button>
    `;
    const inviteBtn = empty.querySelector('.empty-state-btn');
    if (inviteBtn) {
        inviteBtn.addEventListener('click', shareChannel);
    }
    container.appendChild(empty);
}

function removeEmptyState() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    const empty = container.querySelector('.empty-state-chat');
    if (empty) empty.remove();
}

function hasUserMessages() {
    const container = document.getElementById('messagesContainer');
    if (!container) return false;
    return Boolean(container.querySelector('.message:not(.system-message)'));
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
    const inlineCount = document.getElementById('onlineCountInline');
    if (inlineCount) {
        inlineCount.textContent = count;
    }
    const menuCount = document.getElementById('menuOnlineCount');
    if (menuCount) {
        menuCount.textContent = `${count} online`;
    }
    if (currentChannel) {
        database.ref(`channelsMeta/${currentChannel}`).update({
            onlineCount: count,
            updatedAt: Date.now()
        }).catch(() => {});
    }
    if (lastReadReceiptsSnapshot) {
        updateSeenStatus(lastReadReceiptsSnapshot);
    }
    if (count <= 1 && !hasUserMessages()) {
        showEmptyState();
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
    let menuContainer = document.getElementById('menuOnlineUsers');
    if (!menuContainer) {
        const onlineSection = document.querySelector('.menu-section .menu-online');
        if (onlineSection && onlineSection.parentElement) {
            menuContainer = document.createElement('div');
            menuContainer.id = 'menuOnlineUsers';
            menuContainer.className = 'menu-users';
            onlineSection.parentElement.appendChild(menuContainer);
        }
    }
    const raw = snapshot && snapshot.val ? (snapshot.val() || {}) : {};
    const users = Object.entries(raw).map(([id, data]) => {
        const name = data && data.name ? data.name : 'User';
        return { id, name };
    });
    if (users.length === 0 && snapshot) {
        snapshot.forEach((child) => {
            const data = child.val();
            const name = data && data.name ? data.name : 'User';
            users.push({ id: child.key, name });
        });
    }

    if (users.length === 0) {
        if (container) {
            container.innerHTML = '<div class="empty-online">No one is online</div>';
            container.style.display = 'flex';
        }
        if (menuContainer) {
            menuContainer.innerHTML = '<div class="empty-online">No one is online</div>';
            menuContainer.style.display = 'grid';
        }
        onlineUsersCache = [];
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

    if (container) {
        container.innerHTML = listHtml;
        container.style.display = 'flex';
    }
    if (menuContainer) {
        const menuHtml = users.map((user) => {
            const safeName = escapeHTML(user.name);
            const initials = escapeHTML(getInitials(user.name));
            const isSelf = user.id === userId;
            const avatarColor = getAvatarColor(user.id || user.name || '');
            return `
                <div class="menu-user${isSelf ? ' self' : ''}">
                    <span class="menu-avatar" style="background: ${avatarColor};">${initials}</span>
                    <span class="menu-name">${safeName}</span>
                </div>
            `;
        }).join('');
        menuContainer.innerHTML = menuHtml;
        menuContainer.style.display = 'grid';
    }
    onlineUsersCache = users;
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

    const text = typingCount === 0 ? '' : 'Typing';
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
    resetUnreadIndicator();
    hideScrollToLatestButton();
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
        const next = textarea.value.trim().slice(0, MAX_MESSAGE_LENGTH);
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
    modal.querySelector('.save').addEventListener('click', async () => {
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
        if (currentChannel) {
            const taken = await isNameTaken(currentChannel, next, userId);
            if (taken) {
                showToast('Name already in use. Choose another.', 'warning');
                return;
            }
        }

        const oldName = userName;
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
        if (currentChannel) {
            setLastSession({ channel: currentChannel, name: next, active: true });
            clearSession(currentChannel, oldName);
            saveSession(currentChannel, next, joinTimestamp || getServerTime(), userId);
        }
        showToast('Name updated', 'success');
        close();
    });
}

function changeChannelPrompt() {
    if (!currentChannel) return;
    const existing = document.getElementById('channelModal');
    if (existing) return;
    const maxChannel = getMaxChannelNumber();

    const modal = document.createElement('div');
    modal.id = 'channelModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Change channel</h3>
            <p>Enter a channel number to join with the same name.</p>
            <input type="number" id="channelModalInput" min="1" max="${maxChannel}" placeholder="1-${maxChannel}" />
            <div class="modal-actions">
                <button type="button" class="modal-btn cancel">Cancel</button>
                <button type="button" class="modal-btn save">Join</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    const input = document.getElementById('channelModalInput');
    if (input) {
        input.value = String(currentChannel || '');
        input.focus();
        input.select();
    }

    const close = () => modal.remove();
    modal.addEventListener('click', (event) => {
        if (event.target === modal) close();
    });
    modal.querySelector('.cancel').addEventListener('click', close);
    modal.querySelector('.save').addEventListener('click', () => {
        const next = String(input.value || '').trim();
        const channelNumber = parseInt(next, 10);
        if (!next || Number.isNaN(channelNumber) || channelNumber < 1 || channelNumber > maxChannel) {
            showToast(`Please enter a valid channel number (1-${maxChannel})`, 'warning');
            return;
        }
        close();
        leaveChannel({ redirect: false });
        joinChannel(String(channelNumber));
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
    if (currentChannel) {
        database.ref(`channels/${currentChannel}/online`).once('value')
            .then(updateOnlineUsersList)
            .catch(() => {});
    }
    refreshBusiestChannelButton();
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

function stopBusiestChannelListener() {
    if (busiestChannelListener) {
        database.ref('channelsMeta').off('value', busiestChannelListener);
        busiestChannelListener = null;
    }
}

function startBusiestChannelListener() {
    if (busiestChannelListener) return;
    busiestChannelListener = () => {
        refreshBusiestChannelButton();
    };
    database.ref('channelsMeta').on('value', busiestChannelListener);
}

async function getBusiestChannel() {
    const metaSnap = await database.ref('channelsMeta').once('value');
    let busiest = null;
    let busiestCount = 0;
    const now = Date.now();
    const staleLimit = 10 * 60 * 1000;
    metaSnap.forEach((channelSnap) => {
        const key = String(channelSnap.key || '').trim();
        const channelNumber = parseInt(key, 10);
        if (!Number.isFinite(channelNumber)) return;
        const data = channelSnap.val() || {};
        const onlineCount = Number(data.onlineCount || 0);
        const updatedAt = Number(data.updatedAt || 0);
        if (!onlineCount || now - updatedAt > staleLimit) return;
        if (onlineCount > busiestCount) {
            busiestCount = onlineCount;
            busiest = channelNumber;
        }
    });
    return busiest !== null ? { channel: busiest, count: busiestCount } : null;
}

async function refreshBusiestChannelButton() {
    const button = document.getElementById('joinBusiestBtn');
    const info = document.getElementById('busiestChannelInfo');
    if (!button || !info) return;
    button.disabled = true;
    if (navigator.onLine === false) {
        info.textContent = 'You are offline.';
        button.textContent = 'Join busiest channel';
        return;
    }
    info.textContent = 'Finding busiest channel...';
    try {
        const result = await getBusiestChannel();
        if (!result || result.count < 1) {
            button.disabled = true;
            info.textContent = 'No active channels yet.';
            button.textContent = 'Join busiest channel';
            return;
        }
        const maxChannel = getMaxChannelNumber();
        if (result.channel < 1 || result.channel > maxChannel) {
            button.disabled = true;
            info.textContent = 'Busiest channel is out of range.';
            button.textContent = 'Join busiest channel';
            return;
        }
        button.disabled = false;
        button.textContent = `Join channel ${result.channel}`;
        info.textContent = `${result.count} online`;
        button.dataset.channel = String(result.channel);
    } catch (error) {
        button.disabled = true;
        info.textContent = 'Unable to load channels.';
        button.textContent = 'Join busiest channel';
    }
}

async function joinBusiestChannel() {
    const button = document.getElementById('joinBusiestBtn');
    const target = button ? button.dataset.channel : null;
    if (!target) return;
    if (currentChannel && String(currentChannel) === String(target)) {
        showToast('You are already in the busiest channel.', 'info');
        return;
    }
    leaveChannel({ redirect: false });
    await joinChannel(String(target));
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
    const encodedLink = encodeURIComponent(channelLink);
    const shareText = encodeURIComponent(`Join my TrulyChat channel ${currentChannel}: ${channelLink}`);

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
        <div style="background: white; padding: 25px; border-radius: 12px; max-width: 520px; width: 92%;">
            <h3 style="margin: 0 0 15px 0; color: #333;">Share Channel ${currentChannel}</h3>
            <p style="margin: 0 0 15px 0; color: #666;">Send this link to invite others:</p>
            <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 20px; word-break: break-all; font-family: monospace; font-size: 14px; color: #111;">
                ${channelLink}
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;">
                <button id="waShareBtn"
                        style="flex: 1 1 160px; padding: 10px; background: #25D366; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    WhatsApp
                </button>
                <button id="tgShareBtn"
                        style="flex: 1 1 160px; padding: 10px; background: #229ED9; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Telegram
                </button>
                <button id="copyBtn"
                        style="flex: 1 1 160px; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    Copy Link
                </button>
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                        style="flex: 1; padding: 10px; background: #666; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add copy functionality
    document.getElementById('copyBtn').onclick = function () {
        copyToClipboard(channelLink, this);
    };

    const waBtn = document.getElementById('waShareBtn');
    if (waBtn) {
        waBtn.onclick = function () {
            window.open(`https://wa.me/?text=${shareText}`, '_blank', 'noopener,noreferrer');
        };
    }

    const tgBtn = document.getElementById('tgShareBtn');
    if (tgBtn) {
        tgBtn.onclick = function () {
            window.open(`https://t.me/share/url?url=${encodedLink}&text=${shareText}`, '_blank', 'noopener,noreferrer');
        };
    }

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
    explicitLeave = true;
    if (currentChannel && userId) {
        cleanupUserData(true);
        cleanupChannelIfEmpty(currentChannel);

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

    const lastSession = getLastSession();
    if (lastSession && lastSession.channel) {
        setLastSession({ channel: lastSession.channel, name: lastSession.name || '', active: false });
    }

    // Return to channel screen (or redirect to join page if not present)
    const channelScreen = document.getElementById('channelScreen');
    const chatScreen = document.getElementById('chatScreen');
    if (channelScreen && chatScreen) {
        channelScreen.style.display = 'flex';
        chatScreen.style.display = 'none';
        const channelInput = document.getElementById('channelInput');
        if (channelInput) channelInput.value = '';
    } else if (redirect) {
        window.location.href = 'join.html';
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
    resetUnreadIndicator();
    hideScrollToLatestButton();

    // Reset variables
    const prevChannel = currentChannel;
    const prevName = userName;
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
    clearSession(prevChannel, prevName);
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
    isWindowFocused = !document.hidden;
    document.addEventListener('visibilitychange', () => {
        isWindowFocused = !document.hidden;
    });
    const navEntry = performance.getEntriesByType('navigation')[0];
    const legacyNav = performance.navigation ? performance.navigation.type : null;
    isReloading = (navEntry && navEntry.type === 'reload') || legacyNav === 1;
    database.ref('.info/serverTimeOffset').on('value', (snapshot) => {
        serverTimeOffset = snapshot.val() || 0;
    });

    const storedTheme = localStorage.getItem('trulychat_theme') || 'dark';
    applyTheme(storedTheme);
    initSoundToggle();

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

            const value = messageInput.value.trimStart();
            if (value.startsWith('/')) {
                const matches = filterCommands(value);
                showCommandSuggestions(matches);
            } else {
                hideCommandSuggestions();
            }

            const atIndex = value.lastIndexOf('@');
            const mentionList = document.getElementById('mentionList');
            if (mentionList && atIndex >= 0) {
                const search = value.slice(atIndex + 1);
                const names = onlineUsersCache.map((user) => user.name).filter(Boolean);
                const unique = Array.from(new Set(names)).filter((name) => mentionMatch(search, name));
                if (unique.length) {
                    mentionList.innerHTML = unique.map((name) => `<div class="mention-item">${escapeHTML(name)}</div>`).join('');
                    mentionList.classList.add('show');
                } else {
                    mentionList.classList.remove('show');
                    mentionList.innerHTML = '';
                }
            } else if (mentionList) {
                mentionList.classList.remove('show');
                mentionList.innerHTML = '';
            }
        });

        messageInput.addEventListener('blur', () => {
            setTyping(false);
            setTimeout(hideCommandSuggestions, 120);
        });
    }


    const cancelReplyBtn = document.getElementById('cancelReplyBtn');
    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', clearReply);
    }

    const messagesContainer = document.getElementById('messagesContainer');
    if (messagesContainer) {
        messagesContainer.addEventListener('click', handleMessageAction);
        messagesContainer.addEventListener('scroll', () => {
            if (isNearBottom(messagesContainer)) {
                resetUnreadIndicator();
                hideScrollToLatestButton();
            } else {
                showScrollToLatestButton();
            }
        });
    }

    const scrollToLatestBtn = document.getElementById('scrollToLatestBtn');
    if (scrollToLatestBtn) {
        scrollToLatestBtn.addEventListener('click', () => {
            scrollToBottom();
            resetUnreadIndicator();
            hideScrollToLatestButton();
        });
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

    const soundToggleBtn = document.getElementById('soundToggleBtn');
    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            setSoundEnabled(!soundEnabled);
        });
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

    const changeChannelBtn = document.getElementById('changeChannelBtn');
    if (changeChannelBtn) {
        changeChannelBtn.addEventListener('click', changeChannelPrompt);
    }

    const menuToggle = document.getElementById('menuToggle');
    const menuClose = document.getElementById('menuClose');
    const menuBackdrop = document.getElementById('menuBackdrop');
    const menuPanel = document.getElementById('menuPanel');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            openMenu();
            startBusiestChannelListener();
        });
    }
    if (menuClose) {
        menuClose.addEventListener('click', () => {
            closeMenu();
            stopBusiestChannelListener();
        });
    }
    if (menuBackdrop) {
        menuBackdrop.addEventListener('click', () => {
            closeMenu();
            stopBusiestChannelListener();
        });
    }
    if (menuPanel) {
        menuPanel.addEventListener('click', (event) => {
            if (event.target && event.target.classList.contains('menu-item')) {
                closeMenu();
                stopBusiestChannelListener();
            }
        });
    }


    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'l') {
            event.preventDefault();
            leaveChannel();
        }
    });


    const joinBusiestBtn = document.getElementById('joinBusiestBtn');
    if (joinBusiestBtn) {
        joinBusiestBtn.addEventListener('click', joinBusiestChannel);
    }

    const commandSuggestions = document.getElementById('commandSuggestions');
    if (commandSuggestions) {
        commandSuggestions.addEventListener('click', (event) => {
            const item = event.target.closest('.command-item');
            if (!item) return;
            const cmd = item.getAttribute('data-command');
            if (cmd) {
                insertCommand(cmd);
            }
        });
    }

    const mentionList = document.getElementById('mentionList');
    if (mentionList && messageInput) {
        mentionList.addEventListener('click', (event) => {
            const item = event.target.closest('.mention-item');
            if (!item) return;
            const name = item.textContent.trim();
            const value = messageInput.value;
            const atIndex = value.lastIndexOf('@');
            if (atIndex >= 0) {
                messageInput.value = value.slice(0, atIndex + 1) + name + ' ';
                mentionList.classList.remove('show');
                mentionList.innerHTML = '';
                messageInput.focus();
            }
        });
    }

    setupLongPress();

    window.addEventListener('beforeunload', () => {
        if (!currentChannel || !userName) return;
        if (explicitLeave) return;
        if (isReloading) {
            saveSession(currentChannel, userName, joinTimestamp || getServerTime(), userId);
            return;
        }
        const lastSession = getLastSession();
        if (lastSession && lastSession.updatedAt && Date.now() - lastSession.updatedAt > LAST_SESSION_TTL_MS) {
            return;
        }
        setLastSession({ channel: currentChannel, name: userName, active: true });
        cleanupUserData(true);
        cleanupChannelIfEmpty(currentChannel);
    });

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
            const maxChannel = getMaxChannelNumber();
            if (!channel) {
                localStorage.setItem('trulychat_name', DEFAULT_DIRECT_NAME);
                await joinChannel(DEFAULT_DIRECT_CHANNEL);
            } else if (channel >= 1 && channel <= maxChannel) {
                localStorage.setItem('trulychat_name', DEFAULT_DIRECT_NAME);
                await joinChannel(channel);
            } else {
                window.location.href = 'join.html';
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
