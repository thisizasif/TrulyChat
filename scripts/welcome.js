(function () {
    const btn = document.getElementById('enterCodeBtn');
    if (!btn) return;

    const BUSIEST_STALE_MS = 10 * 60 * 1000;

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
        if (typeof database === 'undefined') return false;
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

    const updateBusiestUI = (result) => {
        const channelEl = document.getElementById('welcomeBusiestChannel');
        const countEl = document.getElementById('welcomeBusiestCount');
        const joinBtn = document.getElementById('welcomeJoinBusiest');
        const navJoinBtn = document.getElementById('navJoinBusiest');
        if (!navJoinBtn && (!channelEl || !countEl || !joinBtn)) return;
        if (!result) {
            if (channelEl) channelEl.textContent = '---';
            if (countEl) countEl.textContent = 'No active channels';
            if (joinBtn) {
                joinBtn.disabled = true;
                joinBtn.dataset.channel = '';
            }
            if (navJoinBtn) {
                navJoinBtn.disabled = true;
                navJoinBtn.dataset.channel = '';
            }
            return;
        }
        if (channelEl) channelEl.textContent = String(result.channel);
        if (countEl) countEl.textContent = `${result.count} online`;
        if (joinBtn) {
            joinBtn.disabled = false;
            joinBtn.dataset.channel = String(result.channel);
        }
        if (navJoinBtn) {
            navJoinBtn.disabled = false;
            navJoinBtn.dataset.channel = String(result.channel);
        }
    };

    const getBusiestFromMeta = (snapshot) => {
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
    };

    const getBusiestFromChannels = (snapshot) => {
        let busiest = null;
        let count = 0;
        snapshot.forEach((channelSnap) => {
            const channelId = channelSnap.key;
            if (!channelId) return;
            const onlineSnap = channelSnap.child('online');
            const onlineCount = onlineSnap.exists() ? onlineSnap.numChildren() : 0;
            if (onlineCount > count) {
                count = onlineCount;
                busiest = channelId;
            }
        });
        return busiest ? { channel: busiest, count } : null;
    };

    const startBusiestListener = () => {
        if (typeof database === 'undefined') {
            updateBusiestUI(null);
            return;
        }
        database.ref('channelsMeta').on('value', (snapshot) => {
            const result = getBusiestFromMeta(snapshot);
            if (result) {
                updateBusiestUI(result);
                return;
            }
            database.ref('channels').once('value').then((channelsSnap) => {
                updateBusiestUI(getBusiestFromChannels(channelsSnap));
            }).catch(() => updateBusiestUI(null));
        }, () => {
            updateBusiestUI(null);
        });
    };

    const initBusiestJoin = () => {
        const joinBtn = document.getElementById('welcomeJoinBusiest');
        const navJoinBtn = document.getElementById('navJoinBusiest');
        if (!joinBtn && !navJoinBtn) return;
        const handler = async (button) => {
            const target = button.dataset.channel;
            if (!target) return;
            const channelNumber = parseInt(target, 10);
            if (!Number.isFinite(channelNumber)) return;
            const name = await findAvailableName(channelNumber);
            const params = new URLSearchParams();
            params.set('channel', String(channelNumber));
            params.set('name', name);
            window.location.href = `chat.html?${params.toString()}`;
        };
        if (joinBtn) {
            joinBtn.addEventListener('click', () => handler(joinBtn));
        }
        if (navJoinBtn) {
            navJoinBtn.addEventListener('click', () => handler(navJoinBtn));
        }
    };

    const startVisitorCount = () => {
        const label = document.getElementById('visitorCount');
        if (!label) return;

        const useRealtimeDb = () => {
            if (typeof database === 'undefined') return;
            const ref = database.ref('visitors/total');
            ref.on('value', (snap) => {
                const value = Number(snap.val() || 0);
                label.textContent = value.toLocaleString();
            });
        };

        if (!window.firestore) {
            useRealtimeDb();
            return;
        }

        const ref = window.firestore.collection('visitors').doc('total');
        ref.onSnapshot((doc) => {
            const data = doc.data() || {};
            const value = typeof data.count === 'number' ? data.count : 0;
            label.textContent = value.toLocaleString();
        }, (error) => {
            console.warn('Visitor count (Firestore) failed, falling back to RTDB.', error);
            useRealtimeDb();
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

    startBusiestListener();
    initBusiestJoin();
    startVisitorCount();
})();
