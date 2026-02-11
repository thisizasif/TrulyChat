import { db, rtdb } from './firebase.js';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  Timestamp,
  updateDoc,
  runTransaction,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import {
  get,
  onValue,
  ref as rtdbRef,
  remove as rtdbRemove
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js';
import Auth from './auth.js';

class Rooms {
  constructor() {
    this.roomsRef = collection(db, 'rooms');
    this.roomEmptyTtlMs = 10 * 60 * 1000;
    this.dashboardState = {
      user: null,
      userRoomIds: new Set(),
      allRooms: [],
      myRooms: [],
      availableRooms: [],
      memberCountsByRoom: {},
      onlineCountsByRoom: {},
      memberHasUserByRoom: {},
      filter: 'all',
      selectedRoomIds: new Set(),
      isManagePage: false
    };
    this.dashboardDom = null;
    this.stopDashboardRoomsSync = null;
    this.stopDashboardUserRoomsSync = null;
    this.roomMembersUnsubs = new Map();
    this.roomPresenceUnsubs = new Map();
    this.roomSweepTimer = null;
    this.lastRoomSweepAt = 0;
    this.pendingRoomsForSweep = [];
    this.roomSweepRunning = false;
    this.roomExpiryWatcherStarted = false;
    this.stopRoomExpiryWatcher = null;
  }

  toRoomIdBase(name) {
    const normalized = (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
    return normalized || 'room';
  }

  async createRoomDocumentWithCustomId(baseId, payload) {
    const maxAttempts = 5000;
    for (let index = 0; index < maxAttempts; index += 1) {
      const candidateId = index === 0 ? baseId : `${baseId}${index}`;
      const candidateRef = doc(db, 'rooms', candidateId);
      try {
        const createdId = await runTransaction(db, async (tx) => {
          const snap = await tx.get(candidateRef);
          if (snap.exists()) {
            throw new Error('room-id-taken');
          }
          tx.set(candidateRef, payload);
          return candidateId;
        });
        return createdId;
      } catch (err) {
        if (err?.message === 'room-id-taken') {
          continue;
        }
        throw err;
      }
    }
    throw new Error('Unable to allocate room ID right now. Please try a different room name.');
  }

  async createRoom(name, password) {
    const user = await Auth.requireAuth();
    const roomPayload = {
      name,
      password: password || '',
      ownerUid: user.uid,
      createdAt: serverTimestamp(),
      members: {
        [user.uid]: {
          displayName: user.displayName || user.email,
          uid: user.uid
        }
      }
    };
    const baseId = this.toRoomIdBase(name);
    const roomId = await this.createRoomDocumentWithCustomId(baseId, roomPayload);

    await setDoc(doc(db, 'users', user.uid, 'rooms', roomId), {
      roomId,
      name,
      joinedAt: serverTimestamp()
    });
    await setDoc(doc(db, 'rooms', roomId, 'members', user.uid), {
      uid: user.uid,
      displayName: user.displayName || user.email,
      joinedAt: serverTimestamp()
    });
    return roomId;
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

  showProgressToast(message) {
    const root = this.getToastRoot();
    const toast = document.createElement('div');
    toast.className = 'toast loading';
    const spinner = document.createElement('span');
    spinner.className = 'toast-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'toast-label';
    label.textContent = message;
    toast.appendChild(spinner);
    toast.appendChild(label);
    root.appendChild(toast);
    return {
      close: () => toast.remove(),
      update: (nextMessage) => {
        label.textContent = nextMessage;
      }
    };
  }

  showNotice(message, title = 'Notice') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'toast-overlay show';
      overlay.innerHTML = `
        <div class="toast-card">
          <h3>${title}</h3>
          <p class="small">${message}</p>
          <div class="toast-actions">
            <button class="btn btn-primary" type="button" data-notice-ok>OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const okBtn = overlay.querySelector('[data-notice-ok]');
      okBtn?.addEventListener('click', () => {
        overlay.remove();
        resolve();
      });
    });
  }

  showConfirm(message, title = 'Confirm action', confirmLabel = 'Confirm', cancelLabel = 'Cancel') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'toast-overlay show';
      overlay.innerHTML = `
        <div class="toast-card">
          <h3>${title}</h3>
          <p class="small">${message}</p>
          <div class="toast-actions">
            <button class="btn btn-ghost" type="button" data-confirm-cancel>${cancelLabel}</button>
            <button class="btn btn-primary" type="button" data-confirm-ok>${confirmLabel}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      const cancelBtn = overlay.querySelector('[data-confirm-cancel]');
      const okBtn = overlay.querySelector('[data-confirm-ok]');

      cancelBtn?.addEventListener('click', () => close(false));
      okBtn?.addEventListener('click', () => close(true));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(false);
      });
    });
  }

  showPasswordPrompt(title, message, confirmLabel = 'Save') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'toast-overlay show';
      overlay.innerHTML = `
        <div class="toast-card">
          <h3>${title}</h3>
          <p class="small">${message}</p>
          <div>
            <label for="toastPasswordInput">Password</label>
            <input id="toastPasswordInput" type="password" autocomplete="new-password" placeholder="Enter password" />
            <p class="small" data-toast-error style="margin-top:8px; color:#b42318;"></p>
          </div>
          <div class="toast-actions">
            <button class="btn btn-ghost" type="button" data-prompt-cancel>Cancel</button>
            <button class="btn btn-primary" type="button" data-prompt-ok>${confirmLabel}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector('#toastPasswordInput');
      const errorEl = overlay.querySelector('[data-toast-error]');
      const cancelBtn = overlay.querySelector('[data-prompt-cancel]');
      const okBtn = overlay.querySelector('[data-prompt-ok]');

      const close = (value) => {
        overlay.remove();
        resolve(value);
      };

      const submit = () => {
        const password = (input?.value || '').trim();
        if (!password) {
          if (errorEl) errorEl.textContent = 'Password cannot be empty.';
          return;
        }
        close(password);
      };

      cancelBtn?.addEventListener('click', () => close(null));
      okBtn?.addEventListener('click', submit);
      input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });
      input?.focus();
    });
  }

  async joinRoom(roomId, password) {
    const user = await Auth.requireAuth();
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      throw new Error('Room not found.');
    }
    const banSnap = await getDoc(doc(db, 'rooms', roomId, 'bans', user.uid));
    if (banSnap.exists()) {
      throw new Error('You are banned from this room.');
    }
    const roomData = roomSnap.data();
    if (roomData.password && roomData.password !== password) {
      throw new Error('Incorrect password.');
    }
    await setDoc(doc(db, 'users', user.uid, 'rooms', roomId), {
      roomId,
      name: roomData.name,
      joinedAt: serverTimestamp()
    });
    await setDoc(doc(db, 'rooms', roomId, 'members', user.uid), {
      uid: user.uid,
      displayName: user.displayName || user.email,
      joinedAt: serverTimestamp()
    });
    try {
      sessionStorage.setItem(`trulychat-room-password:${roomId}`, password || '');
    } catch (_) {
    }
  }

  getMemberCount(room) {
    const watchedCount = this.dashboardState.memberCountsByRoom?.[room?.id];
    if (typeof watchedCount === 'number') {
      return watchedCount;
    }
    const embeddedMembers = room?.members && typeof room.members === 'object'
      ? Object.keys(room.members).length
      : 0;
    return embeddedMembers;
  }

  getOnlineCount(room) {
    const onlineCount = this.dashboardState.onlineCountsByRoom?.[room?.id];
    if (typeof onlineCount === 'number') {
      return onlineCount;
    }
    return 0;
  }

  getLiveMemberCount(room) {
    const onlineCount = this.dashboardState.onlineCountsByRoom?.[room?.id];
    if (typeof onlineCount === 'number') {
      return onlineCount;
    }
    return this.getMemberCount(room);
  }

  passesMyRoomFilter(room, user, filter) {
    if (filter === 'owner') return room.ownerUid === user.uid;
    if (filter === 'member') return room.ownerUid !== user.uid;
    return true;
  }

  sortRoomsByCreatedAt(rooms) {
    return [...rooms].sort((a, b) => {
      const aSec = a?.createdAt?.seconds || 0;
      const bSec = b?.createdAt?.seconds || 0;
      if (aSec !== bSec) return bSec - aSec;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  buildRoomCard(room, user, type = 'mine') {
    const card = document.createElement('article');
    card.className = 'card';

    const title = document.createElement('h3');
    title.textContent = room.name || 'Untitled room';

    const meta = document.createElement('p');
    meta.className = 'small';
    const memberCount = this.getLiveMemberCount(room);
    const ownerFlag = room.ownerUid === user.uid ? 'Owner' : 'Member';
    const lockFlag = room.password ? 'Password required' : 'Open room';
    if (type === 'mine') {
      meta.textContent = `${ownerFlag} | Members: ${memberCount} | ${lockFlag}`;
    } else {
      meta.textContent = `Members: ${memberCount} | ${lockFlag}`;
    }

    const idRow = document.createElement('div');
    idRow.className = 'dash-room-id-row';

    const idBadge = document.createElement('span');
    idBadge.className = 'badge dash-room-id';
    idBadge.textContent = `ID: ${room.id}`;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-ghost dash-copy-btn';
    copyBtn.dataset.copyRoomId = room.id;
    copyBtn.textContent = 'Copy ID';

    idRow.appendChild(idBadge);
    idRow.appendChild(copyBtn);

    const actions = document.createElement('div');
    actions.className = 'dash-card-actions';

    if (type === 'mine') {
      if (this.dashboardState.isManagePage) {
        const selectLabel = document.createElement('label');
        selectLabel.className = 'manage-room-select';

        const select = document.createElement('input');
        select.type = 'checkbox';
        select.dataset.roomSelect = room.id;
        select.checked = this.dashboardState.selectedRoomIds.has(room.id);

        const selectText = document.createElement('span');
        selectText.textContent = 'Select';

        selectLabel.appendChild(select);
        selectLabel.appendChild(selectText);
        actions.appendChild(selectLabel);
      }

      const openBtn = document.createElement('a');
      openBtn.className = 'btn btn-primary';
      openBtn.href = `chat.html?roomId=${room.id}`;
      openBtn.textContent = 'Open room';
      actions.appendChild(openBtn);

      if (this.dashboardState.isManagePage) {
        const changePassBtn = document.createElement('button');
        changePassBtn.type = 'button';
        changePassBtn.className = 'btn btn-secondary';
        changePassBtn.dataset.manageAction = 'set-password';
        changePassBtn.dataset.manageRoomId = room.id;
        changePassBtn.textContent = 'Change password';
        actions.appendChild(changePassBtn);

        const removePassBtn = document.createElement('button');
        removePassBtn.type = 'button';
        removePassBtn.className = 'btn btn-ghost';
        removePassBtn.dataset.manageAction = 'remove-password';
        removePassBtn.dataset.manageRoomId = room.id;
        removePassBtn.textContent = 'Remove password';
        actions.appendChild(removePassBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-ghost';
        deleteBtn.dataset.manageAction = 'delete';
        deleteBtn.dataset.manageRoomId = room.id;
        deleteBtn.textContent = 'Delete room';
        actions.appendChild(deleteBtn);
      }
    } else {
      const joinBtn = document.createElement('button');
      joinBtn.type = 'button';
      joinBtn.className = 'btn btn-secondary';
      joinBtn.dataset.joinRoomId = room.id;
      joinBtn.dataset.joinRoomName = room.name || 'Room';
      joinBtn.dataset.joinRequiresPassword = room.password ? '1' : '0';
      joinBtn.textContent = room.password ? 'Join with password' : 'Join room';
      actions.appendChild(joinBtn);
    }

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(idRow);
    card.appendChild(actions);
    return card;
  }

  renderEmptyState(container, title, message, actionHref = 'rooms.html', actionLabel = 'Go to rooms') {
    container.innerHTML = '';
    const card = document.createElement('article');
    card.className = 'card';

    const h3 = document.createElement('h3');
    h3.textContent = title;
    const p = document.createElement('p');
    p.className = 'small';
    p.textContent = message;
    const a = document.createElement('a');
    a.className = 'btn btn-ghost';
    a.href = actionHref;
    a.textContent = actionLabel;

    card.appendChild(h3);
    card.appendChild(p);
    card.appendChild(a);
    container.appendChild(card);
  }

  renderDashboardLists() {
    if (!this.dashboardDom || !this.dashboardState.user) return;

    const { myRoomsEl, availableRoomsEl, feedbackEl } = this.dashboardDom;
    const { user, myRooms, availableRooms, filter } = this.dashboardState;
    const filteredMyRooms = this.sortRoomsByCreatedAt(
      myRooms.filter((room) => this.passesMyRoomFilter(room, user, filter))
    );
    const filteredAvailableRooms = this.sortRoomsByCreatedAt(availableRooms);
    const currentRoomIds = new Set(myRooms.map((room) => room.id));
    this.dashboardState.selectedRoomIds.forEach((roomId) => {
      if (!currentRoomIds.has(roomId)) {
        this.dashboardState.selectedRoomIds.delete(roomId);
      }
    });

    myRoomsEl.innerHTML = '';
    if (availableRoomsEl) {
      availableRoomsEl.innerHTML = '';
    }

    if (!filteredMyRooms.length) {
      this.renderEmptyState(
        myRoomsEl,
        'No rooms match this filter',
        'Try changing the filter, or create a new room.',
        'rooms.html',
        'Create a room'
      );
    } else {
      filteredMyRooms.forEach((room) => myRoomsEl.appendChild(this.buildRoomCard(room, user, 'mine')));
    }

    if (availableRoomsEl) {
      if (!filteredAvailableRooms.length) {
        this.renderEmptyState(
          availableRoomsEl,
          'No available matches',
          'Check back for newly shared rooms.',
          'rooms.html',
          'View room options'
        );
      } else {
        filteredAvailableRooms.forEach((room) => availableRoomsEl.appendChild(this.buildRoomCard(room, user, 'available')));
      }
    }

    if (feedbackEl) {
      if (availableRoomsEl) {
        feedbackEl.textContent = `Showing ${filteredMyRooms.length} of ${myRooms.length} your rooms and ${filteredAvailableRooms.length} of ${availableRooms.length} available rooms.`;
      } else {
        feedbackEl.textContent = `Showing ${filteredMyRooms.length} of ${myRooms.length} your rooms.`;
      }
    }

    this.updateManageSelectionUi();
  }

  setupRoomMembersWatchers(allRooms, user) {
    const currentIds = new Set(allRooms.map((room) => room.id));

    this.roomMembersUnsubs.forEach((unsub, roomId) => {
      if (!currentIds.has(roomId)) {
        unsub();
        this.roomMembersUnsubs.delete(roomId);
        delete this.dashboardState.memberCountsByRoom[roomId];
        delete this.dashboardState.memberHasUserByRoom[roomId];
      }
    });

    allRooms.forEach((room) => {
      const canReadMembers = room.ownerUid === user.uid || this.dashboardState.userRoomIds.has(room.id);
      if (!canReadMembers) {
        if (this.roomMembersUnsubs.has(room.id)) {
          const unsub = this.roomMembersUnsubs.get(room.id);
          if (typeof unsub === 'function') unsub();
          this.roomMembersUnsubs.delete(room.id);
        }
        return;
      }

      if (this.roomMembersUnsubs.has(room.id)) return;
      const membersRef = collection(db, 'rooms', room.id, 'members');
      const unsub = onSnapshot(membersRef, (snapshot) => {
        this.dashboardState.memberCountsByRoom[room.id] = snapshot.size;
        this.dashboardState.memberHasUserByRoom[room.id] = snapshot.docs.some((docSnap) => docSnap.id === user.uid);
        this.recomputeDashboardFromState();
      }, () => {
        this.dashboardState.memberCountsByRoom[room.id] = this.getMemberCount(room);
        this.recomputeDashboardFromState();
      });
      this.roomMembersUnsubs.set(room.id, unsub);
    });
  }

  setupRoomPresenceWatchers(allRooms) {
    const currentIds = new Set(allRooms.map((room) => room.id));

    this.roomPresenceUnsubs.forEach((unsub, roomId) => {
      if (!currentIds.has(roomId)) {
        unsub();
        this.roomPresenceUnsubs.delete(roomId);
        delete this.dashboardState.onlineCountsByRoom[roomId];
      }
    });

    allRooms.forEach((room) => {
      if (this.roomPresenceUnsubs.has(room.id)) return;
      const statusRef = rtdbRef(rtdb, `status/${room.id}`);
      const unsub = onValue(statusRef, (snapshot) => {
        const presenceMap = snapshot.val() || {};
        const onlineCount = Object.values(presenceMap).filter((entry) => entry?.state === 'online').length;
        this.dashboardState.onlineCountsByRoom[room.id] = onlineCount;
        this.recomputeDashboardFromState();
      });
      this.roomPresenceUnsubs.set(room.id, unsub);
    });
  }


  recomputeDashboardFromState() {
    const user = this.dashboardState.user;
    if (!user) return;
    const allRooms = this.dashboardState.allRooms || [];
    const myRooms = allRooms.filter((room) => room.ownerUid === user.uid);
    const availableRooms = allRooms.filter((room) => room.ownerUid !== user.uid);
    const totalMembers = myRooms.reduce((sum, room) => sum + this.getLiveMemberCount(room), 0);

    this.dashboardState.myRooms = myRooms;
    this.dashboardState.availableRooms = availableRooms;

    const { statMyRooms, statAvailable, statMembers } = this.dashboardDom || {};
    if (statMyRooms) statMyRooms.textContent = String(myRooms.length);
    if (statAvailable) statAvailable.textContent = String(availableRooms.length);
    if (statMembers) statMembers.textContent = String(totalMembers);

    this.renderDashboardLists();
  }

  setupDashboardControls() {
    if (!this.dashboardDom) return;
    const { filterButtons } = this.dashboardDom;
    if (!filterButtons || !filterButtons.length) return;

    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextFilter = button.getAttribute('data-dashboard-filter') || 'all';
        this.dashboardState.filter = nextFilter;
        filterButtons.forEach((item) => {
          const active = item === button;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', String(active));
        });
        this.renderDashboardLists();
      });
    });
  }

  updateManageSelectionUi() {
    if (!this.dashboardState.isManagePage || !this.dashboardDom) return;
    const { manageSelectAllEl, manageSelectedCountEl } = this.dashboardDom;
    if (!manageSelectedCountEl) return;

    const selectedCount = this.dashboardState.selectedRoomIds.size;
    manageSelectedCountEl.textContent = `${selectedCount} selected`;

    if (manageSelectAllEl) {
      const myCount = this.dashboardState.myRooms.length;
      manageSelectAllEl.checked = myCount > 0 && selectedCount === myCount;
      manageSelectAllEl.indeterminate = selectedCount > 0 && selectedCount < myCount;
    }
  }

  async setRoomPassword(roomId, nextPassword) {
    await updateDoc(doc(db, 'rooms', roomId), {
      password: nextPassword || ''
    });
  }

  async verifyOwnerAccess(roomId) {
    const user = this.dashboardState.user;
    if (!user?.uid) return false;
    const roomSnap = await getDoc(doc(db, 'rooms', roomId));
    if (!roomSnap.exists()) return false;
    const room = roomSnap.data() || {};
    return room.ownerUid === user.uid;
  }

  async deleteRoomByOwner(roomId) {
    await this.deleteRoomCollections(roomId);
    await deleteDoc(doc(db, 'rooms', roomId)).catch(() => {});
    await rtdbRemove(rtdbRef(rtdb, `status/${roomId}`)).catch(() => {});
    await rtdbRemove(rtdbRef(rtdb, `roomStatus/${roomId}`)).catch(() => {});
  }

  formatActionError(error) {
    const code = error?.code || '';
    if (code === 'permission-denied') return 'Missing or insufficient permissions.';
    if (code === 'not-found') return 'Room no longer exists.';
    return error?.message || 'Unknown error';
  }

  async applyBulkManageAction(action, roomIds) {
    if (!action || !roomIds.length) return;
    const targetIds = [];
    const skipped = [];
    for (const roomId of roomIds) {
      try {
        const canManage = await this.verifyOwnerAccess(roomId);
        if (canManage) {
          targetIds.push(roomId);
        } else {
          skipped.push(roomId);
        }
      } catch (_) {
        skipped.push(roomId);
      }
    }
    const failed = [];
    let succeeded = 0;

    if (!targetIds.length) {
      return { succeeded: 0, failed: roomIds.length, skipped: roomIds.length, errors: ['No owner-managed rooms selected.'] };
    }

    if (action === 'set-password') {
      const password = await this.showPasswordPrompt(
        'Set password',
        `Enter new password for ${targetIds.length} selected room(s).`,
        'Apply password'
      );
      if (!password) return;
      const progress = this.showProgressToast(`Updating ${targetIds.length} room(s)...`);
      try {
        for (const roomId of targetIds) {
          try {
            await this.setRoomPassword(roomId, password);
            succeeded += 1;
          } catch (error) {
            failed.push(`${roomId}: ${this.formatActionError(error)}`);
          }
        }
      } finally {
        progress.close();
      }
      return { succeeded, failed: failed.length, skipped: skipped.length, errors: failed };
    }

    if (action === 'remove-password') {
      const proceed = await this.showConfirm(
        `Remove password from ${targetIds.length} room(s)?`,
        'Confirm remove password',
        'Remove',
        'Cancel'
      );
      if (!proceed) return;
      const progress = this.showProgressToast(`Removing password from ${targetIds.length} room(s)...`);
      try {
        for (const roomId of targetIds) {
          try {
            await this.setRoomPassword(roomId, '');
            succeeded += 1;
          } catch (error) {
            failed.push(`${roomId}: ${this.formatActionError(error)}`);
          }
        }
      } finally {
        progress.close();
      }
      return { succeeded, failed: failed.length, skipped: skipped.length, errors: failed };
    }

    if (action === 'delete') {
      const proceed = await this.showConfirm(
        `Delete ${targetIds.length} room(s)? This cannot be undone.`,
        'Confirm delete',
        'Delete rooms',
        'Cancel'
      );
      if (!proceed) return;
      const progress = this.showProgressToast(`Deleting ${targetIds.length} room(s)...`);
      try {
        for (const roomId of targetIds) {
          try {
            await this.deleteRoomByOwner(roomId);
            succeeded += 1;
          } catch (error) {
            failed.push(`${roomId}: ${this.formatActionError(error)}`);
          }
        }
      } finally {
        progress.close();
      }
      return { succeeded, failed: failed.length, skipped: skipped.length, errors: failed };
    }
  }

  setupManageRoomActions() {
    if (!this.dashboardState.isManagePage || !this.dashboardDom) return;
    const {
      myRoomsEl,
      manageSelectAllEl,
      manageBulkActionButtons,
      feedbackEl
    } = this.dashboardDom;
    if (!myRoomsEl) return;

    myRoomsEl.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const roomId = target.getAttribute('data-room-select');
      if (!roomId) return;
      if (target.checked) {
        this.dashboardState.selectedRoomIds.add(roomId);
      } else {
        this.dashboardState.selectedRoomIds.delete(roomId);
      }
      this.updateManageSelectionUi();
    });

    myRoomsEl.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const actionBtn = target.closest('[data-manage-action]');
      if (!actionBtn) return;
      const action = actionBtn.getAttribute('data-manage-action') || '';
      const roomId = actionBtn.getAttribute('data-manage-room-id') || '';
      if (!action || !roomId) return;

      try {
        if (action === 'set-password') {
          const canManage = await this.verifyOwnerAccess(roomId);
          if (!canManage) {
            await this.showNotice(`You are not allowed to manage room ${roomId}.`, 'Permission denied');
            return;
          }
          const password = await this.showPasswordPrompt(
            'Change room password',
            `Set a new password for room ${roomId}.`,
            'Save password'
          );
          if (!password) return;
          const progress = this.showProgressToast('Updating room password...');
          try {
            await this.setRoomPassword(roomId, password);
          } finally {
            progress.close();
          }
          if (feedbackEl) feedbackEl.textContent = `Password updated for room ${roomId}.`;
          await this.showNotice(`Password updated for room ${roomId}.`, 'Updated');
          return;
        }

        if (action === 'remove-password') {
          const canManage = await this.verifyOwnerAccess(roomId);
          if (!canManage) {
            await this.showNotice(`You are not allowed to manage room ${roomId}.`, 'Permission denied');
            return;
          }
          const proceed = await this.showConfirm(
            `Remove password from room ${roomId}?`,
            'Confirm remove password',
            'Remove',
            'Cancel'
          );
          if (!proceed) return;
          const progress = this.showProgressToast('Removing room password...');
          try {
            await this.setRoomPassword(roomId, '');
          } finally {
            progress.close();
          }
          if (feedbackEl) feedbackEl.textContent = `Password removed for room ${roomId}.`;
          await this.showNotice(`Password removed for room ${roomId}.`, 'Updated');
          return;
        }

        if (action === 'delete') {
          const canManage = await this.verifyOwnerAccess(roomId);
          if (!canManage) {
            await this.showNotice(`You are not allowed to manage room ${roomId}.`, 'Permission denied');
            return;
          }
          const proceed = await this.showConfirm(
            `Delete room ${roomId}? This cannot be undone.`,
            'Confirm delete',
            'Delete room',
            'Cancel'
          );
          if (!proceed) return;
          const progress = this.showProgressToast('Deleting room...');
          try {
            await this.deleteRoomByOwner(roomId);
          } finally {
            progress.close();
          }
          this.dashboardState.selectedRoomIds.delete(roomId);
          this.updateManageSelectionUi();
          if (feedbackEl) feedbackEl.textContent = `Room ${roomId} deleted.`;
          await this.showNotice(`Room ${roomId} deleted.`, 'Deleted');
        }
      } catch (err) {
        const message = this.formatActionError(err) || 'Action failed. Please try again.';
        if (feedbackEl) feedbackEl.textContent = message;
        await this.showNotice(message, 'Action failed');
      }
    });

    if (manageSelectAllEl) {
      manageSelectAllEl.addEventListener('change', () => {
        if (manageSelectAllEl.checked) {
          this.dashboardState.myRooms.forEach((room) => this.dashboardState.selectedRoomIds.add(room.id));
        } else {
          this.dashboardState.selectedRoomIds.clear();
        }
        this.renderDashboardLists();
      });
    }

    if (manageBulkActionButtons && manageBulkActionButtons.length) {
      manageBulkActionButtons.forEach((actionBtn) => {
        actionBtn.addEventListener('click', async () => {
          const action = actionBtn.getAttribute('data-manage-bulk-action') || '';
          const selectedIds = Array.from(this.dashboardState.selectedRoomIds);
          if (!selectedIds.length) {
            await this.showNotice('Select at least one room first.', 'Nothing selected');
            return;
          }
          if (!action) return;
          try {
            const result = await this.applyBulkManageAction(action, selectedIds);
            if (!result) return;
            this.dashboardState.selectedRoomIds.clear();
            this.updateManageSelectionUi();
            const summary = `Done: ${result.succeeded}, Failed: ${result.failed}, Skipped: ${result.skipped}`;
            if (feedbackEl) feedbackEl.textContent = summary;
            if (result.failed > 0) {
              const detail = result.errors?.[0] ? `\nFirst error: ${result.errors[0]}` : '';
              await this.showNotice(`${summary}${detail}`, 'Bulk action partially completed');
            } else {
              await this.showNotice(summary, 'Bulk action completed');
            }
          } catch (err) {
            const message = this.formatActionError(err) || 'Bulk action failed.';
            if (feedbackEl) feedbackEl.textContent = message;
            await this.showNotice(message, 'Bulk action failed');
          }
        });
      });
    }
  }

  setupJoinOverlay() {
    const overlay = document.querySelector('[data-room-join-overlay]');
    const nameEl = document.querySelector('[data-room-join-name]');
    const input = document.querySelector('#roomJoinPassword');
    const errorEl = document.querySelector('[data-room-join-error]');
    const cancelBtn = document.querySelector('[data-room-join-cancel]');
    const confirmBtn = document.querySelector('[data-room-join-confirm]');
    const availableContainer = document.querySelector('[data-available-rooms]');
    const myRoomsContainer = document.querySelector('[data-rooms-list]');
    const feedbackEl = document.querySelector('[data-dashboard-feedback]');

    const handleCopyClick = async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const copyBtn = target.closest('[data-copy-room-id]');
      if (!copyBtn) return;
      const roomId = copyBtn.getAttribute('data-copy-room-id');
      if (!roomId) return;
      try {
        await navigator.clipboard.writeText(roomId);
        if (feedbackEl) feedbackEl.textContent = `Copied room ID: ${roomId}`;
      } catch (_) {
        if (feedbackEl) feedbackEl.textContent = `Could not copy automatically. Room ID: ${roomId}`;
      }
    };

    if (availableContainer) {
      availableContainer.addEventListener('click', handleCopyClick);
    }
    if (myRoomsContainer) {
      myRoomsContainer.addEventListener('click', handleCopyClick);
    }

    if (!overlay || !nameEl || !input || !errorEl || !cancelBtn || !confirmBtn || !availableContainer) return;

    let pendingRoomId = '';
    let pendingRoomName = '';

    const close = () => {
      overlay.classList.remove('show');
      pendingRoomId = '';
      pendingRoomName = '';
      input.value = '';
      errorEl.textContent = '';
    };

    availableContainer.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('[data-join-room-id]');
      if (!button) return;
      const roomId = button.getAttribute('data-join-room-id') || '';
      const roomName = button.getAttribute('data-join-room-name') || 'this room';
      const requiresPassword = button.getAttribute('data-join-requires-password') === '1';
      if (!roomId) return;

      if (!requiresPassword) {
        button.setAttribute('disabled', 'true');
        errorEl.textContent = '';
        const progress = this.showProgressToast('Joining room...');
        try {
          await this.joinRoom(roomId, '');
          window.location.href = `chat.html?roomId=${roomId}`;
        } catch (err) {
          const message = err?.message || 'Failed to join room.';
          if (/banned/i.test(message)) {
            await this.showNotice('You are banned from this room.', 'Join blocked');
          } else if (feedbackEl) {
            feedbackEl.textContent = message;
          }
        } finally {
          progress.close();
          button.removeAttribute('disabled');
        }
        return;
      }

      pendingRoomId = roomId;
      pendingRoomName = roomName;
      nameEl.textContent = `Enter the password for ${pendingRoomName} (leave blank if not required).`;
      overlay.classList.add('show');
      input.focus();
    });

    cancelBtn.addEventListener('click', close);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('show')) {
        close();
      }
    });

    confirmBtn.addEventListener('click', async () => {
      if (!pendingRoomId) return;
      confirmBtn.disabled = true;
      errorEl.textContent = '';
      const progress = this.showProgressToast('Joining room...');
      try {
        await this.joinRoom(pendingRoomId, input.value.trim());
        window.location.href = `chat.html?roomId=${pendingRoomId}`;
      } catch (err) {
        const message = err?.message || 'Failed to join room.';
        if (/banned/i.test(message)) {
          await this.showNotice('You are banned from this room.', 'Join blocked');
        } else {
          errorEl.textContent = message;
        }
      } finally {
        progress.close();
        confirmBtn.disabled = false;
      }
    });

  }

  syncDashboardFromRoomsSnapshot(snapshot, user) {
    const allRooms = [];
    snapshot.forEach((snap) => {
      allRooms.push({ id: snap.id, ...snap.data() });
    });

    this.dashboardState.user = user;
    this.dashboardState.allRooms = allRooms;
    this.setupRoomMembersWatchers(allRooms, user);
    this.setupRoomPresenceWatchers(allRooms);
    this.recomputeDashboardFromState();
    this.scheduleRoomExpirySweep(allRooms);
  }

  async getRoomOnlineCount(roomId) {
    const statusSnap = await get(rtdbRef(rtdb, `status/${roomId}`));
    const statusMap = statusSnap.val() || {};
    return Object.values(statusMap).filter((entry) => entry?.state === 'online').length;
  }

  async deleteRoomCollections(roomId) {
    const membersRef = collection(db, 'rooms', roomId, 'members');
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const bansRef = collection(db, 'rooms', roomId, 'bans');
    const roomSnap = await getDoc(doc(db, 'rooms', roomId)).catch(() => null);
    const ownerUid = roomSnap?.exists?.() ? roomSnap.data()?.ownerUid : '';

    const membersSnap = await getDocs(membersRef);
    const memberUids = membersSnap.docs.map((docSnap) => docSnap.id);
    if (ownerUid && !memberUids.includes(ownerUid)) {
      memberUids.push(ownerUid);
    }
    await Promise.all(memberUids.map((uid) => (
      deleteDoc(doc(db, 'users', uid, 'rooms', roomId)).catch(() => {})
    )));

    const deleteAllDocs = async (colRef) => {
      const snap = await getDocs(colRef);
      if (snap.empty) return;
      const batch = writeBatch(db);
      snap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
    };

    await deleteAllDocs(messagesRef);
    await deleteAllDocs(membersRef);
    await deleteAllDocs(bansRef);
  }

  async deleteExpiredRoom(roomId) {
    await this.deleteRoomCollections(roomId);
    await deleteDoc(doc(db, 'rooms', roomId)).catch(() => {});
    await rtdbRemove(rtdbRef(rtdb, `status/${roomId}`)).catch(() => {});
    await rtdbRemove(rtdbRef(rtdb, `roomStatus/${roomId}`)).catch(() => {});
  }

  async runRoomExpirySweep(rooms) {
    if (this.roomSweepRunning) return;
    this.roomSweepRunning = true;
    const nowMs = Date.now();

    try {
      for (const room of rooms) {
        const roomRef = doc(db, 'rooms', room.id);
        let onlineCount = 0;
        try {
          onlineCount = await this.getRoomOnlineCount(room.id);
        } catch (_) {
          continue;
        }

        const expiresAtMs = room?.expiresAt?.toMillis?.() || 0;
        const hasExpiryWindow = !!(room?.emptySince || room?.expiresAt);

        if (onlineCount > 0) {
          if (hasExpiryWindow) {
            await updateDoc(roomRef, {
              emptySince: deleteField(),
              expiresAt: deleteField()
            }).catch(() => {});
          }
          continue;
        }

        if (!hasExpiryWindow) {
          await updateDoc(roomRef, {
            emptySince: serverTimestamp(),
            expiresAt: Timestamp.fromMillis(nowMs + this.roomEmptyTtlMs)
          }).catch(() => {});
          continue;
        }

        if (expiresAtMs && expiresAtMs <= nowMs) {
          await this.deleteExpiredRoom(room.id);
        }
      }
    } finally {
      this.roomSweepRunning = false;
      this.lastRoomSweepAt = Date.now();
    }
  }

  scheduleRoomExpirySweep(rooms) {
    this.pendingRoomsForSweep = rooms;
    if (this.roomSweepTimer) return;

    const elapsed = Date.now() - this.lastRoomSweepAt;
    const waitMs = this.lastRoomSweepAt === 0 ? 2500 : Math.max(2500, 60000 - elapsed);

    this.roomSweepTimer = window.setTimeout(async () => {
      this.roomSweepTimer = null;
      const roomsToSweep = this.pendingRoomsForSweep || [];
      await this.runRoomExpirySweep(roomsToSweep);
      if (this.pendingRoomsForSweep !== roomsToSweep) {
        this.scheduleRoomExpirySweep(this.pendingRoomsForSweep || []);
      }
    }, waitMs);
  }

  ensureRoomExpiryWatcher() {
    if (this.roomExpiryWatcherStarted) return;
    this.roomExpiryWatcherStarted = true;
    Auth.requireAuth().then(() => {
      if (typeof this.stopRoomExpiryWatcher === 'function') {
        this.stopRoomExpiryWatcher();
      }
      this.stopRoomExpiryWatcher = onSnapshot(this.roomsRef, (snapshot) => {
        const rooms = [];
        snapshot.forEach((snap) => {
          rooms.push({ id: snap.id, ...snap.data() });
        });
        this.scheduleRoomExpirySweep(rooms);
      });
    }).catch(() => {
    });
  }

  async initDashboard() {
    const userEl = document.querySelector('[data-user]');
    const myRoomsEl = document.querySelector('[data-rooms-list]');
    const availableRoomsEl = document.querySelector('[data-available-rooms]');
    const statMyRooms = document.querySelector('[data-stat-my-rooms]');
    const statAvailable = document.querySelector('[data-stat-available]');
    const statMembers = document.querySelector('[data-stat-members]');
    const filterButtons = document.querySelectorAll('[data-dashboard-filter]');
    const feedbackEl = document.querySelector('[data-dashboard-feedback]');
    const manageSelectAllEl = document.querySelector('[data-manage-select-all]');
    const manageBulkActionButtons = document.querySelectorAll('[data-manage-bulk-action]');
    const manageSelectedCountEl = document.querySelector('[data-manage-selected-count]');

    if (!myRoomsEl) return;

    this.dashboardDom = {
      userEl,
      myRoomsEl,
      availableRoomsEl,
      statMyRooms,
      statAvailable,
      statMembers,
      filterButtons,
      feedbackEl,
      manageSelectAllEl,
      manageBulkActionButtons,
      manageSelectedCountEl
    };
    this.dashboardState.isManagePage = !!manageSelectAllEl;

    const user = await Auth.requireAuth();
    if (userEl) {
      userEl.textContent = `Signed in as ${user.displayName || user.email || 'Member'}`;
    }

    this.setupDashboardControls();
    this.setupJoinOverlay();
    this.setupManageRoomActions();

    if (typeof this.stopDashboardUserRoomsSync === 'function') {
      this.stopDashboardUserRoomsSync();
    }

    const userRoomsRef = collection(db, 'users', user.uid, 'rooms');
    this.stopDashboardUserRoomsSync = onSnapshot(userRoomsRef, (snapshot) => {
      const ids = new Set();
      snapshot.forEach((docSnap) => ids.add(docSnap.id));

      this.dashboardState.userRoomIds = ids;
      this.setupRoomMembersWatchers(this.dashboardState.allRooms || [], user);
      this.recomputeDashboardFromState();
    }, () => {
      if (feedbackEl) feedbackEl.textContent = 'Unable to sync your room list right now.';
    });

    if (typeof this.stopDashboardRoomsSync === 'function') {
      this.stopDashboardRoomsSync();
    }

    this.stopDashboardRoomsSync = onSnapshot(this.roomsRef, (snapshot) => {
      this.syncDashboardFromRoomsSnapshot(snapshot, user);
    }, () => {
      if (feedbackEl) feedbackEl.textContent = 'Unable to sync rooms in real time right now.';
    });
  }
}

const rooms = new Rooms();
rooms.ensureRoomExpiryWatcher();
rooms.initDashboard().catch(() => {
  const feedbackEl = document.querySelector('[data-dashboard-feedback]');
  if (feedbackEl) {
    feedbackEl.textContent = 'Unable to load dashboard right now.';
  }
});

export default rooms;
