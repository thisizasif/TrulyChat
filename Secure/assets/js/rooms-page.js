import Rooms from './rooms.js?v=20260211y';
import { db } from './firebase.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const createRoomForm = document.querySelector('[data-create-room]');
const joinRoomForm = document.querySelector('[data-join-room]');
const globalErrorEl = document.querySelector('[data-global-error]');
const topRoomsEl = document.querySelector('[data-top-rooms]');
const totalRoomsEl = document.querySelector('[data-rooms-total]');
const privateRoomsEl = document.querySelector('[data-rooms-private]');
const openRoomsEl = document.querySelector('[data-rooms-open]');
const createRoomPanel = document.querySelector('#create-room');
const joinRoomPanel = document.querySelector('#join-room');

function setSubmitBusy(form, busy, idleText, busyText) {
  const submit = form?.querySelector('button[type="submit"]');
  if (!submit) return;
  submit.disabled = busy;
  submit.textContent = busy ? busyText : idleText;
}

function flashPanelFocus(panel) {
  if (!panel) return;
  panel.classList.add('room-focus');
  window.setTimeout(() => panel.classList.remove('room-focus'), 900);
}

function parseRoomMemberCount(room) {
  if (room && room.members && typeof room.members === 'object') {
    return Object.keys(room.members).length;
  }
  return 0;
}

function renderTopRooms(rooms) {
  if (!topRoomsEl) return;
  topRoomsEl.innerHTML = '';

  if (!rooms.length) {
    const empty = document.createElement('p');
    empty.className = 'small';
    empty.textContent = 'No rooms available yet. Create the first room.';
    topRoomsEl.appendChild(empty);
    return;
  }

  rooms.slice(0, 6).forEach((room) => {
    const item = document.createElement('article');
    item.className = 'room-item';

    const title = document.createElement('strong');
    title.textContent = room.name || 'Untitled room';

    const meta = document.createElement('div');
    meta.className = 'room-meta';

    const id = document.createElement('span');
    id.textContent = `ID: ${room.id}`;
    const members = document.createElement('span');
    members.textContent = `${room.memberCount} member${room.memberCount === 1 ? '' : 's'}`;
    const access = document.createElement('span');
    access.textContent = room.password ? 'Password required' : 'Open';

    meta.appendChild(id);
    meta.appendChild(members);
    meta.appendChild(access);
    item.appendChild(title);
    item.appendChild(meta);
    topRoomsEl.appendChild(item);
  });
}

function initRoomsInsights() {
  const roomsRef = collection(db, 'rooms');
  onSnapshot(roomsRef, (snapshot) => {
    const rooms = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      rooms.push({
        id: docSnap.id,
        ...data,
        memberCount: parseRoomMemberCount(data)
      });
    });

    const total = rooms.length;
    const privateCount = rooms.filter((room) => !!room.password).length;
    const openCount = total - privateCount;
    if (totalRoomsEl) totalRoomsEl.textContent = String(total);
    if (privateRoomsEl) privateRoomsEl.textContent = String(privateCount);
    if (openRoomsEl) openRoomsEl.textContent = String(openCount);

    const ranked = [...rooms].sort((a, b) => {
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      const aSec = a?.createdAt?.seconds || 0;
      const bSec = b?.createdAt?.seconds || 0;
      return bSec - aSec;
    });
    renderTopRooms(ranked);
  }, () => {
    if (topRoomsEl) {
      topRoomsEl.innerHTML = '<p class="small">Unable to load room feed right now.</p>';
    }
  });
}

function initJoinPrefill() {
  if (!joinRoomForm) return;
  const params = new URLSearchParams(window.location.search);
  const roomId = (params.get('roomId') || '').trim();
  if (!roomId) return;
  joinRoomForm.roomId.value = roomId;
  window.location.hash = '#join-room';
  flashPanelFocus(joinRoomPanel);
}

function initHashFocus() {
  const focusByHash = () => {
    const hash = (window.location.hash || '').toLowerCase();
    if (hash === '#create-room') flashPanelFocus(createRoomPanel);
    if (hash === '#join-room') flashPanelFocus(joinRoomPanel);
  };
  window.addEventListener('hashchange', focusByHash);
  focusByHash();
}

if (createRoomForm) {
  createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = createRoomForm.name.value.trim();
    const password = createRoomForm.roomPassword.value.trim();
    const errorEl = createRoomForm.querySelector('[data-error]');
    errorEl.textContent = '';
    if (globalErrorEl) globalErrorEl.textContent = '';

    if (!name || name.length < 2) {
      errorEl.textContent = 'Room name must be at least 2 characters.';
      return;
    }

    let progress = null;
    try {
      setSubmitBusy(createRoomForm, true, 'Create room', 'Creating...');
      progress = Rooms.showProgressToast('Creating room...');
      const roomId = await Rooms.createRoom(name, password);
      window.location.href = `chat.html?roomId=${roomId}`;
    } catch (err) {
      const message = err?.message || 'Unable to create room right now.';
      errorEl.textContent = message;
      if (globalErrorEl) globalErrorEl.textContent = message;
    } finally {
      progress?.close();
      setSubmitBusy(createRoomForm, false, 'Create room', 'Creating...');
    }
  });
}

if (joinRoomForm) {
  joinRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const roomId = joinRoomForm.roomId.value.trim().toLowerCase();
    const password = joinRoomForm.roomPassword.value.trim();
    joinRoomForm.roomId.value = roomId;
    const errorEl = joinRoomForm.querySelector('[data-error]');
    errorEl.textContent = '';
    if (globalErrorEl) globalErrorEl.textContent = '';

    const validRoomId = /^[a-z0-9]{3,64}$/.test(roomId);
    if (!validRoomId) {
      errorEl.textContent = 'Enter a valid room ID (letters and numbers only).';
      return;
    }

    let progress = null;
    try {
      setSubmitBusy(joinRoomForm, true, 'Join room', 'Joining...');
      progress = Rooms.showProgressToast('Joining room...');
      await Rooms.joinRoom(roomId, password);
      window.location.href = `chat.html?roomId=${roomId}`;
    } catch (err) {
      const message = err?.message || 'Unable to join room right now.';
      if (/banned/i.test(message)) {
        await Rooms.showNotice('You are banned from this room.', 'Join blocked');
      } else {
        errorEl.textContent = message;
        if (globalErrorEl) globalErrorEl.textContent = message;
      }
    } finally {
      progress?.close();
      setSubmitBusy(joinRoomForm, false, 'Join room', 'Joining...');
    }
  });
}

initRoomsInsights();
initJoinPrefill();
initHashFocus();
