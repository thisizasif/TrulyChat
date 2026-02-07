function getMaxChannelNumber() {
    const raw = typeof window !== 'undefined' ? Number(window.TRULYCHAT_MAX_CHANNEL_NUMBER) : NaN;
    return Number.isFinite(raw) && raw > 0 ? raw : 9999;
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

function startChat() {
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

    showJoinError('');
    localStorage.setItem('trulychat_name', name);
    const params = new URLSearchParams();
    params.set('channel', String(channelNumber));
    params.set('name', name);
    window.location.href = `chat.html?${params.toString()}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) {
        joinBtn.addEventListener('click', startChat);
    }

    const nameInput = document.getElementById('nameInput');
    const channelInput = document.getElementById('channelInput');
    const quickJoinBtn = document.getElementById('quickJoin111Btn');
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

    const storedName = localStorage.getItem('trulychat_name');
    if (storedName && nameInput) {
        nameInput.value = sanitizeJoinName(storedName);
    }

    const params = new URLSearchParams(window.location.search);
    const channelParam = params.get('channel');
    if (channelParam && channelInput) {
        channelInput.value = channelParam;
    }
});
