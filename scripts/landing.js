function getMaxChannelNumber() {
    const raw = typeof window !== 'undefined' ? Number(window.TRULYCHAT_MAX_CHANNEL_NUMBER) : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : 9999;
}

function getMaxUsersPerChannel() {
    const raw = typeof window !== 'undefined' ? Number(window.TRULYCHAT_MAX_USERS_PER_CHANNEL) : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : Infinity;
}

function sanitizeJoinName(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 24);
}

function showJoinError(message) {
    const error = document.getElementById('joinError');
    if (!error) return;
    error.textContent = message;
    error.style.display = message ? 'block' : 'none';
}

const LAST_SESSION_KEY = 'trulychat_last_session';
const LAST_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const BUSIEST_STALE_MS = 10 * 60 * 1000;

function getLastSession() {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function getBusiestFromMeta(snapshot) {
    let busiest = null;
    let count = 0;
    const now = Date.now();
    snapshot.forEach((child) => {
        const key = String(child.key || '').trim();
        const channelNumber = parseInt(key, 10);
        if (!Number.isFinite(channelNumber)) return;
        const data = child.val() || {};
        const onlineCount = Number(data.onlineCount || 0);
        const updatedAt = Number(data.updatedAt || 0);
        if (!onlineCount || now - updatedAt > BUSIEST_STALE_MS) return;
        if (onlineCount > count) {
            count = onlineCount;
            busiest = channelNumber;
        }
    });
    return busiest ? { channel: busiest, count } : null;
}

function updateBusiestUI(result) {
    const channelEl = document.getElementById('busiestChannel');
    const countEl = document.getElementById('busiestCount');
    const joinBtn = document.getElementById('joinBusiestBtnLanding');
    if (!channelEl || !countEl || !joinBtn) return;
    if (!result) {
        channelEl.textContent = '---';
        countEl.textContent = 'No active channels';
        joinBtn.disabled = true;
        return;
    }
    channelEl.textContent = String(result.channel);
    countEl.textContent = `${result.count} online`;
    joinBtn.disabled = false;
    joinBtn.dataset.channel = String(result.channel);
}

function startBusiestListener() {
    if (typeof database === 'undefined') {
        updateBusiestUI(null);
        return;
    }
    database.ref('channelsMeta').on('value', (snapshot) => {
        const result = getBusiestFromMeta(snapshot);
        updateBusiestUI(result);
    }, () => {
        updateBusiestUI(null);
    });
}

async function startChat() {
    const nameInput = document.getElementById('nameInput');
    const channelInput = document.getElementById('channelInput');
    const name = sanitizeJoinName(nameInput ? nameInput.value : '');
    const channel = channelInput ? channelInput.value.trim() : '';
    const maxChannel = getMaxChannelNumber();

    if (!name) {
        showJoinError('Please enter your name.');
        if (nameInput) nameInput.focus();
        return;
    }

    const channelNumber = parseInt(channel, 10);
    if (!channel || Number.isNaN(channelNumber) || channelNumber < 1 || channelNumber > maxChannel) {
        showJoinError(`Please enter a valid channel number (1-${maxChannel}).`);
        if (channelInput) channelInput.focus();
        return;
    }

    if (typeof database !== 'undefined') {
        const maxUsers = getMaxUsersPerChannel();
        if (Number.isFinite(maxUsers) && maxUsers !== Infinity) {
            try {
                const snapshot = await database.ref(`channels/${channelNumber}/online`).once('value');
                if (snapshot.numChildren() >= maxUsers) {
                    showJoinError(`This channel is full. Maximum ${maxUsers} users allowed.`);
                    return;
                }
            } catch (error) {
                showJoinError('Unable to verify channel capacity. Please try again.');
                return;
            }
        }
    }

    showJoinError('');
    localStorage.setItem('trulychat_name', name);
    const params = new URLSearchParams();
    params.set('channel', String(channelNumber));
    params.set('name', name);
    window.location.href = `chat.html?${params.toString()}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    const channelParam = params.get('channel');
    const nameParam = params.get('name');

    // Auto-join disabled: always stay on join page

    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            startChat();
        });
    }

    const nameInput = document.getElementById('nameInput');
    const channelInput = document.getElementById('channelInput');
    const quickJoinBtn = document.getElementById('quickJoin111Btn');
    const joinBusiestBtn = document.getElementById('joinBusiestBtnLanding');
    const maxChannel = getMaxChannelNumber();
    if (nameInput) {
        nameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') startChat();
        });
    }
    if (channelInput) {
        channelInput.max = String(maxChannel);
        channelInput.placeholder = `1-${maxChannel}`;
        channelInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') startChat();
        });
    }
    if (quickJoinBtn) {
        quickJoinBtn.addEventListener('click', () => {
            if (channelInput) {
                channelInput.value = '111';
            }
            startChat();
        });
    }
    if (joinBusiestBtn) {
        joinBusiestBtn.addEventListener('click', () => {
            const target = joinBusiestBtn.dataset.channel;
            if (!target || !channelInput) return;
            channelInput.value = target;
            startChat();
        });
    }

    const storedName = localStorage.getItem('trulychat_name');
    if (storedName && nameInput) {
        nameInput.value = sanitizeJoinName(storedName);
    }

    const themeBtn = document.getElementById('landingThemeToggle');
    const applyTheme = (theme) => {
        document.body.classList.remove('theme-light', 'theme-dark');
        if (theme === 'light') document.body.classList.add('theme-light');
        if (theme === 'dark') document.body.classList.add('theme-dark');
        localStorage.setItem('trulychat_theme', theme);
        if (themeBtn) {
            const label = theme === 'system' ? 'System' : theme.charAt(0).toUpperCase() + theme.slice(1);
            themeBtn.textContent = `Theme: ${label}`;
        }
    };
    const cycleTheme = () => {
        const current = localStorage.getItem('trulychat_theme') || 'dark';
        const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
        applyTheme(next);
    };
    if (themeBtn) {
        themeBtn.addEventListener('click', cycleTheme);
        const current = localStorage.getItem('trulychat_theme') || 'dark';
        applyTheme(current);
    }

    if (channelParam && channelInput) {
        channelInput.value = channelParam;
    }
    if (nameParam && nameInput) {
        nameInput.value = sanitizeJoinName(nameParam);
    }
    if (errorParam === 'name_taken') {
        showJoinError('That name is already in use in this channel. Please choose another.');
    }
    if (errorParam === 'channel_full') {
        const maxUsers = getMaxUsersPerChannel();
        showJoinError(`This channel is full. Maximum ${Number.isFinite(maxUsers) && maxUsers !== Infinity ? maxUsers : 'limited'} users allowed.`);
    }

    startBusiestListener();
});
