(function () {
    const theme = localStorage.getItem('trulychat_theme') || 'system';
    if (theme === 'dark') document.body.classList.add('theme-dark');
    if (theme === 'light') document.body.classList.add('theme-light');
})();

(function () {
    const btn = document.getElementById('enterCodeBtn');
    if (!btn) return;

    const sanitize = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const maxChannel = () => {
        const raw = Number(window.TRULYCHAT_MAX_CHANNEL_NUMBER);
        return Number.isFinite(raw) && raw > 0 ? raw : 9999;
    };
    const maxUsersPerChannel = () => {
        const raw = Number(window.TRULYCHAT_MAX_USERS_PER_CHANNEL);
        return Number.isFinite(raw) && raw > 0 ? raw : Infinity;
    };
    const isNameTaken = async (channel, name) => {
        const snap = await database.ref(`channels/${channel}/online`).once('value');
        let taken = false;
        snap.forEach((child) => {
            const data = child.val();
            if (!data || !data.name) return;
            if (sanitize(data.name).toLowerCase() === sanitize(name).toLowerCase()) {
                taken = true;
            }
        });
        return taken;
    };
    const findAvailableName = async (channel) => {
        const base = 'iLOveSky';
        if (!await isNameTaken(channel, base)) return base;
        for (let i = 1; i <= 99; i += 1) {
            const candidate = `${base}${i}`;
            if (!await isNameTaken(channel, candidate)) return candidate;
        }
        return `${base}${Math.floor(Math.random() * 1000)}`;
    };

    const openModal = () => {
        const existing = document.getElementById('enterCodeModal');
        if (existing) return;
        const modal = document.createElement('div');
        modal.id = 'enterCodeModal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Enter channel code</h3>
                <p>Type a channel number to join instantly.</p>
                <input type="number" id="enterCodeInput" min="1" max="${maxChannel()}" placeholder="1-${maxChannel()}" />
                <div class="modal-error" id="enterCodeError"></div>
                <div class="modal-actions">
                    <button type="button" class="modal-btn cancel">Cancel</button>
                    <button type="button" class="modal-btn save">Join</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const input = modal.querySelector('#enterCodeInput');
        const errorEl = modal.querySelector('#enterCodeError');
        if (input) input.focus();

        const close = () => modal.remove();
        modal.addEventListener('click', (event) => {
            if (event.target === modal) close();
        });
        modal.querySelector('.cancel').addEventListener('click', close);
                modal.querySelector('.save').addEventListener('click', async () => {
                    const raw = String(input.value || '').trim();
                    const channelNumber = parseInt(raw, 10);
                    if (!raw || Number.isNaN(channelNumber) || channelNumber < 1 || channelNumber > maxChannel()) {
                        if (errorEl) {
                            errorEl.textContent = `Please enter a valid channel number (1-${maxChannel()}).`;
                        }
                        return;
                    }
                    if (typeof database !== 'undefined') {
                        const limit = maxUsersPerChannel();
                        if (Number.isFinite(limit) && limit !== Infinity) {
                            try {
                                const snapshot = await database.ref(`channels/${channelNumber}/online`).once('value');
                                if (snapshot.numChildren() >= limit) {
                                    if (errorEl) {
                                        errorEl.textContent = `This channel is full. Maximum ${limit} users allowed.`;
                                    }
                                    return;
                                }
                            } catch (error) {
                                if (errorEl) {
                                    errorEl.textContent = 'Unable to verify channel capacity. Please try again.';
                                }
                                return;
                            }
                        }
                    }
                    const name = await findAvailableName(channelNumber);
                    const params = new URLSearchParams();
                    params.set('channel', String(channelNumber));
                    params.set('name', name);
                    window.location.href = `chat.html?${params.toString()}`;
        });
    };

    btn.addEventListener('click', (event) => {
        event.preventDefault();
        if (typeof database === 'undefined') {
            window.location.href = 'join.html';
            return;
        }
        openModal();
    });
})();
