import { db, rtdb } from './firebase.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  deleteField,
  Timestamp,
  writeBatch,
  setDoc,
  onSnapshot,
  orderBy,
  query,
  deleteDoc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import {
  ref,
  onValue,
  get,
  set,
  onDisconnect,
  serverTimestamp as rtdbServerTimestamp,
  remove
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js';
import Store from './store.js';
import UI from './ui.js';

class ChatService {
  constructor(roomId, user) {
    this.roomId = roomId;
    this.user = user;
    this.roomRef = doc(db, 'rooms', this.roomId);
    this.messagesRef = collection(db, 'rooms', this.roomId, 'messages');
    this.membersRef = collection(db, 'rooms', this.roomId, 'members');
    this.bansRef = collection(db, 'rooms', this.roomId, 'bans');
    this.presenceRef = ref(rtdb, `status/${this.roomId}/${this.user.uid}`);
    this.roomStatusRef = ref(rtdb, `roomStatus/${this.roomId}`);
  }

  async init() {
    try {
      const roomSnap = await getDocFromServer(this.roomRef);
      if (!roomSnap.exists()) {
        window.location.href = 'rooms.html';
        return;
      }

      const banSnap = await getDoc(doc(this.bansRef, this.user.uid));
      if (banSnap.exists()) {
        UI.showToast('You are banned from this room.');
        window.location.href = 'rooms.html';
        return;
      }

      Store.setState({ room: roomSnap.data() });
      await setDoc(doc(this.membersRef, this.user.uid), {
        uid: this.user.uid,
        displayName: this.user.displayName || this.user.email || 'Member',
        joinedAt: serverTimestamp()
      }, { merge: true });
      const room = roomSnap.data();
      this.listenForMessages();
      this.listenForMembers();
      this.listenForBans(room);
      this.listenForPresence();
      this.listenForRoomUpdates();
      this.setupPresence();
    } catch (err) {
      const message = err?.message || '';
      if (/permission|insufficient/i.test(message)) {
        UI.showToast('Missing permissions for this room.');
      } else {
        UI.showToast('Unable to open this room.');
      }
      window.location.href = 'rooms.html';
    }
  }

  listenForMessages() {
    const messagesQuery = query(this.messagesRef, orderBy('createdAt', 'asc'));
    onSnapshot(messagesQuery, (snapshot) => {
      Store.setState({ messages: snapshot.docs });
      const room = Store.getState().room || {};
      UI.renderMessages(Store.getState().messages, this.user, {
        isOwner: room.ownerUid === this.user.uid
      });
    }, () => {
      UI.showToast('You no longer have access to room messages.');
      window.location.href = 'rooms.html';
    });
  }

  listenForMembers() {
    onSnapshot(this.membersRef, (snapshot) => {
      const members = new Map();
      snapshot.forEach((doc) => {
        members.set(doc.id, doc.data());
      });
      Store.setState({ members });
    }, () => {
      UI.showToast('You no longer have access to room members.');
      window.location.href = 'rooms.html';
    });
  }

  listenForBans(room) {
    const isOwner = room?.ownerUid === this.user.uid;
    if (isOwner) {
      onSnapshot(this.bansRef, (snapshot) => {
        const banned = new Map();
        snapshot.forEach((doc) => {
          banned.set(doc.id, doc.data());
        });
        Store.setState({ banned });
      }, () => {
        Store.setState({ banned: new Map() });
      });
      return;
    }

    const myBanRef = doc(this.bansRef, this.user.uid);
    onSnapshot(myBanRef, (snap) => {
      if (snap.exists()) {
        UI.showToast('You were removed from this room.');
        window.location.href = 'rooms.html';
      } else {
        Store.setState({ banned: new Map() });
      }
    }, () => {
      Store.setState({ banned: new Map() });
    });
  }

  listenForPresence() {
    const roomPresenceRef = ref(rtdb, `status/${this.roomId}`);
    onValue(roomPresenceRef, (snapshot) => {
      const presence = snapshot.val() || {};
      Store.setState({ presence });
    });
  }

  listenForRoomUpdates() {
    onSnapshot(this.roomRef, (snap) => {
      if (!snap.exists()) {
        UI.showToast('Room deleted by owner.');
        window.location.href = 'rooms.html';
        return;
      }
      Store.setState({ room: snap.data() });
    });

    onValue(this.roomStatusRef, async (snapshot) => {
      const data = snapshot.val();
      if (data && data.deleted) {
        const freshRoom = await getDocFromServer(this.roomRef);
        if (!freshRoom.exists()) {
          UI.showToast('Room deleted by owner.');
          window.location.href = 'rooms.html';
          return;
        }
        await remove(this.roomStatusRef).catch(() => {});
      }
    });
  }

  async setupPresence() {
    await set(this.presenceRef, {
      state: 'online',
      typing: false,
      lastChanged: rtdbServerTimestamp(),
      displayName: this.user.displayName || this.user.email || 'Member'
    });
    onDisconnect(this.presenceRef).remove();
    await this.clearRoomExpiryWindow();
  }

  async clearRoomExpiryWindow() {
    await updateDoc(this.roomRef, {
      emptySince: deleteField(),
      expiresAt: deleteField()
    }).catch(() => {});
  }

  async refreshRoomExpiryWindow() {
    const roomSnap = await getDocFromServer(this.roomRef).catch(() => null);
    if (!roomSnap || !roomSnap.exists()) return;

    const statusSnap = await get(ref(rtdb, `status/${this.roomId}`)).catch(() => null);
    const presenceMap = statusSnap?.val?.() || {};
    const onlineCount = Object.values(presenceMap).filter((entry) => entry?.state === 'online').length;

    if (onlineCount > 0) {
      await this.clearRoomExpiryWindow();
      return;
    }

    await updateDoc(this.roomRef, {
      emptySince: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + (10 * 60 * 1000))
    }).catch(() => {});
  }

  async setTyping(isTyping) {
    await set(this.presenceRef, {
      state: 'online',
      typing: !!isTyping,
      lastChanged: rtdbServerTimestamp(),
      displayName: this.user.displayName || this.user.email || 'Member'
    }).catch(() => {});
  }

  async setOffline() {
    await set(this.presenceRef, {
      state: 'offline',
      typing: false,
      lastChanged: rtdbServerTimestamp(),
      displayName: this.user.displayName || this.user.email || 'Member'
    }).catch(() => {});
  }

  async sendMessage(text, options = {}) {
    if (!text) return;
    const replyTo = options.replyTo || null;
    try {
      await addDoc(this.messagesRef, {
        text,
        uid: this.user.uid,
        displayName: this.user.displayName || this.user.email,
        photoURL: this.user.photoURL || '',
        replyTo: replyTo || null,
        reactions: {},
        createdAt: serverTimestamp()
      });
    } catch (err) {
      UI.showToast('Failed to send message.');
    }
  }

  async editMessage(messageId, nextText) {
    const messageRef = doc(this.messagesRef, messageId);
    const messageSnap = await getDocFromServer(messageRef);
    if (!messageSnap.exists()) {
      throw new Error('Message no longer exists.');
    }
    const message = messageSnap.data() || {};
    if (message.uid !== this.user.uid) {
      throw new Error('You can only edit your own messages.');
    }
    await updateDoc(messageRef, {
      text: nextText,
      editedAt: serverTimestamp()
    });
  }

  async deleteMessage(messageId) {
    const messageRef = doc(this.messagesRef, messageId);
    const messageSnap = await getDocFromServer(messageRef);
    if (!messageSnap.exists()) return;

    const message = messageSnap.data() || {};
    const room = Store.getState().room || {};
    const isOwner = room.ownerUid === this.user.uid;
    if (!isOwner && message.uid !== this.user.uid) {
      throw new Error('You can only delete your own messages.');
    }
    await deleteDoc(messageRef);
  }

  async toggleReaction(messageId, emoji) {
    const messageRef = doc(this.messagesRef, messageId);
    const messageSnap = await getDocFromServer(messageRef);
    if (!messageSnap.exists()) {
      throw new Error('Message no longer exists.');
    }
    const message = messageSnap.data() || {};
    const nextReactions = { ...(message.reactions || {}) };
    if (nextReactions[this.user.uid] === emoji) {
      delete nextReactions[this.user.uid];
    } else {
      nextReactions[this.user.uid] = emoji;
    }

    await updateDoc(messageRef, {
      reactions: nextReactions
    });
  }

  getSharePayload() {
    const room = Store.getState().room || {};
    const roomName = room.name || 'TrulyChat Room';
    const hasPassword = !!room.password;
    return {
      roomId: this.roomId,
      roomName,
      hasPassword,
      inviteText: hasPassword
        ? `Join "${roomName}" on TrulyChat. Room ID: ${this.roomId}. Password is required.`
        : `Join "${roomName}" on TrulyChat. Room ID: ${this.roomId}.`
    };
  }

  getInvitePayload() {
    const room = Store.getState().room || {};
    const roomName = room.name || 'TrulyChat Room';
    const isOwner = room.ownerUid === this.user.uid;
    const base = `${window.location.origin}/pages/chat.html?roomId=${encodeURIComponent(this.roomId)}`;
    const passwordToken = room.password
      ? encodeURIComponent(
        btoa(
          Array.from(new TextEncoder().encode(room.password), (byte) => String.fromCharCode(byte)).join('')
        )
      )
      : '';
    const inviteUrl = isOwner && passwordToken
      ? `${base}&invite=owner&ip=${passwordToken}`
      : `${base}&invite=member`;

    return {
      roomId: this.roomId,
      roomName,
      isOwner,
      inviteUrl,
      inviteText: isOwner
        ? `Owner invite: ${inviteUrl}`
        : `Invite: ${inviteUrl}`
    };
  }

  async leaveRoom() {
    const roomSnap = await getDocFromServer(this.roomRef);
    if (!roomSnap.exists()) return;
    await this.setOffline();
    await this.refreshRoomExpiryWindow();
    await deleteDoc(doc(db, 'users', this.user.uid, 'rooms', this.roomId)).catch(() => {});
    await deleteDoc(doc(this.membersRef, this.user.uid)).catch(() => {});
    await remove(this.presenceRef).catch(() => {});
    await this.refreshRoomExpiryWindow();
  }

  async leaveRoomSilently() {
    const room = Store.getState().room || {};
    if (!room || room.ownerUid === this.user.uid) {
      await this.setOffline();
      await remove(this.presenceRef).catch(() => {});
      await this.refreshRoomExpiryWindow();
      return;
    }

    await this.setOffline();
    await this.refreshRoomExpiryWindow();
    await deleteDoc(doc(db, 'users', this.user.uid, 'rooms', this.roomId)).catch(() => {});
    await deleteDoc(doc(this.membersRef, this.user.uid)).catch(() => {});
    await remove(this.presenceRef).catch(() => {});
    await this.refreshRoomExpiryWindow();
  }

  async deleteRoom() {
    const roomSnap = await getDocFromServer(this.roomRef);
    if (!roomSnap.exists()) return;
    const room = roomSnap.data();
    if (room.ownerUid !== this.user.uid) {
      throw new Error('Only the room owner can delete this room.');
    }

    await set(this.roomStatusRef, {
      deleted: true,
      at: Date.now()
    });

    const deleteCollectionDocs = async (refCollection) => {
      const snap = await getDocs(refCollection);
      if (snap.empty) return;
      const batch = writeBatch(db);
      snap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
      return snap.docs.map((docSnap) => docSnap.id);
    };

    await deleteCollectionDocs(this.messagesRef);
    const memberUids = await deleteCollectionDocs(this.membersRef) || [];
    await deleteCollectionDocs(this.bansRef);

    const ownerRoomRef = doc(db, 'users', this.user.uid, 'rooms', this.roomId);
    await deleteDoc(ownerRoomRef).catch(() => {});
    await Promise.all(memberUids.map((uid) => (
      deleteDoc(doc(db, 'users', uid, 'rooms', this.roomId)).catch(() => {})
    )));

    await deleteDoc(this.roomRef);
    await remove(ref(rtdb, `status/${this.roomId}`)).catch(() => {});
    await remove(this.roomStatusRef).catch(() => {});
  }

  async setRoomPassword(nextPassword) {
    const roomSnap = await getDocFromServer(this.roomRef);
    if (!roomSnap.exists()) {
      throw new Error('Room not found.');
    }
    const room = roomSnap.data();
    if (room.ownerUid !== this.user.uid) {
      throw new Error('Only the room owner can update password.');
    }
    await updateDoc(this.roomRef, {
      password: nextPassword || ''
    });
  }

  async kickUser(targetUid) {
    const roomSnap = await getDocFromServer(this.roomRef);
    if (!roomSnap.exists()) throw new Error('Room not found.');
    const room = roomSnap.data();
    if (room.ownerUid !== this.user.uid) {
      throw new Error('Only owner can manage members.');
    }
    if (targetUid === room.ownerUid) {
      throw new Error('Owner cannot be kicked.');
    }

    await updateDoc(this.roomRef, {
      [`members.${targetUid}`]: deleteField()
    }).catch(() => {});
    await deleteDoc(doc(this.membersRef, targetUid)).catch(() => {});
    await deleteDoc(doc(db, 'users', targetUid, 'rooms', this.roomId)).catch(() => {});
    await remove(ref(rtdb, `status/${this.roomId}/${targetUid}`)).catch(() => {});
  }

  async banUser(targetUid, displayName = '') {
    const roomSnap = await getDocFromServer(this.roomRef);
    if (!roomSnap.exists()) throw new Error('Room not found.');
    const room = roomSnap.data();
    if (room.ownerUid !== this.user.uid) {
      throw new Error('Only owner can ban users.');
    }
    if (targetUid === room.ownerUid) {
      throw new Error('Owner cannot be banned.');
    }

    await setDoc(doc(this.bansRef, targetUid), {
      uid: targetUid,
      displayName: displayName || targetUid,
      bannedBy: this.user.uid,
      bannedAt: serverTimestamp()
    }, { merge: true });

    await this.kickUser(targetUid);
  }

  async unbanUser(targetUid) {
    const roomSnap = await getDocFromServer(this.roomRef);
    if (!roomSnap.exists()) throw new Error('Room not found.');
    const room = roomSnap.data();
    if (room.ownerUid !== this.user.uid) {
      throw new Error('Only owner can unban users.');
    }
    await deleteDoc(doc(this.bansRef, targetUid));
  }
}

export default ChatService;
