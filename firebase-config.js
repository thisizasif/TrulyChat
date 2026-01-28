// firebase-config.js - IMPROVED CLEANUP
const firebaseConfig = {
    apiKey: "AIzaSyAI6FIucMNrMZxq2zNEYn00rJbPKI10RBQ",
    authDomain: "trulychat.firebaseapp.com",
    databaseURL: "https://trulychat-default-rtdb.firebaseio.com",
    projectId: "trulychat",
    storageBucket: "trulychat.firebasestorage.app",
    messagingSenderId: "158285691632",
    appId: "1:158285691632:web:6d9b9c80df46b939456035"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

const database = firebase.database();

// Function to cleanup stale online users (users who didn't disconnect properly)
function cleanupStaleUsers() {
    const now = Date.now();
    const threeMinutesAgo = now - 180000; // 3 minutes
    
    database.ref('channels').once('value', (snapshot) => {
        snapshot.forEach((channelSnapshot) => {
            const channelKey = channelSnapshot.key;
            const onlineUsers = channelSnapshot.child('online');
            
            const updates = {};
            
            onlineUsers.forEach((userSnapshot) => {
                const userData = userSnapshot.val();
                const lastActive = userData.timestamp || userData.joinedAt || 0;
                
                // Remove users who haven't been active for 3 minutes
                if (lastActive < threeMinutesAgo) {
                    updates[userSnapshot.key] = null;
                    console.log(`Removing stale user ${userSnapshot.key} from channel ${channelKey}`);
                }
            });
            
            if (Object.keys(updates).length > 0) {
                database.ref(`channels/${channelKey}/online`).update(updates);
            }
        });
    });
}

// Test Firebase connection
const connectedRef = database.ref(".info/connected");
connectedRef.on("value", function(snap) {
    if (snap.val() === true) {
        console.log("Firebase connection: ONLINE");
    } else {
        console.log("Firebase connection: OFFLINE");
    }
});

// Run cleanup every 2 minutes
setInterval(cleanupStaleUsers, 2 * 60 * 1000);

// Initial cleanup after 10 seconds
setTimeout(cleanupStaleUsers, 10000);