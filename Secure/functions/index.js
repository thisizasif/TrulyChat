const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const rtdb = admin.database();

const ROOM_TTL_MINUTES = 10;
const MAX_ROOMS_PER_RUN = 200;
const BATCH_DELETE_SIZE = 400;

async function deleteCollectionDocs(collectionRef) {
  while (true) {
    const snap = await collectionRef.limit(BATCH_DELETE_SIZE).get();
    if (snap.empty) return;

    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();

    if (snap.size < BATCH_DELETE_SIZE) return;
  }
}

async function getOnlineCount(roomId) {
  const statusSnap = await rtdb.ref(`status/${roomId}`).get();
  const statusMap = statusSnap.val() || {};
  return Object.values(statusMap).filter((entry) => entry && entry.state === 'online').length;
}

async function clearExpiryWindow(roomRef) {
  await roomRef.update({
    emptySince: admin.firestore.FieldValue.delete(),
    expiresAt: admin.firestore.FieldValue.delete()
  });
}

async function markExpiryWindow(roomRef, nowMs) {
  await roomRef.update({
    emptySince: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(nowMs + ROOM_TTL_MINUTES * 60 * 1000)
  });
}

async function deleteRoomEverywhere(roomId, roomData) {
  const roomRef = db.collection('rooms').doc(roomId);
  const membersRef = roomRef.collection('members');
  const messagesRef = roomRef.collection('messages');
  const bansRef = roomRef.collection('bans');

  const membersSnap = await membersRef.get();
  const memberUids = new Set(membersSnap.docs.map((docSnap) => docSnap.id));
  if (roomData.ownerUid) {
    memberUids.add(roomData.ownerUid);
  }

  await Promise.all(Array.from(memberUids).map(async (uid) => {
    try {
      await db.doc(`users/${uid}/rooms/${roomId}`).delete();
    } catch (_) {
      // best effort cleanup
    }
  }));

  await deleteCollectionDocs(messagesRef);
  await deleteCollectionDocs(membersRef);
  await deleteCollectionDocs(bansRef);

  await roomRef.delete().catch(() => {});
  await rtdb.ref(`status/${roomId}`).remove().catch(() => {});
  await rtdb.ref(`roomStatus/${roomId}`).remove().catch(() => {});
}

exports.cleanupInactiveRooms = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'UTC',
    region: 'us-central1'
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const nowMs = Date.now();

    const expiredRoomsSnap = await db
      .collection('rooms')
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt', 'asc')
      .limit(MAX_ROOMS_PER_RUN)
      .get();

    let deleted = 0;
    let reset = 0;
    let kept = 0;
    let failed = 0;

    for (const roomDoc of expiredRoomsSnap.docs) {
      const roomId = roomDoc.id;
      const roomData = roomDoc.data() || {};
      try {
        const onlineCount = await getOnlineCount(roomId);
        if (onlineCount > 0) {
          await clearExpiryWindow(roomDoc.ref);
          reset += 1;
          continue;
        }

        await deleteRoomEverywhere(roomId, roomData);
        deleted += 1;
      } catch (error) {
        failed += 1;
        logger.error('cleanupInactiveRooms failed for room', { roomId, error: error?.message || String(error) });
      }
    }

    const noExpirySnap = await db
      .collection('rooms')
      .where('expiresAt', '==', null)
      .limit(MAX_ROOMS_PER_RUN)
      .get();

    for (const roomDoc of noExpirySnap.docs) {
      const roomId = roomDoc.id;
      try {
        const onlineCount = await getOnlineCount(roomId);
        if (onlineCount > 0) {
          kept += 1;
          continue;
        }
        await markExpiryWindow(roomDoc.ref, nowMs);
      } catch (error) {
        failed += 1;
        logger.error('cleanupInactiveRooms mark-expiry failed', { roomId, error: error?.message || String(error) });
      }
    }

    logger.info('cleanupInactiveRooms summary', {
      scannedExpired: expiredRoomsSnap.size,
      scannedNoExpiry: noExpirySnap.size,
      deleted,
      reset,
      kept,
      failed
    });
  }
);
