let currentChannel = null;
let userId = null;
let userName = null;

// Generate random user ID and name
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

function generateRandomName() {
    const adjectives = ['Swift', 'Clever', 'Brave', 'Calm', 'Eager', 'Gentle', 'Happy', 'Jolly', 'Kind', 'Lucky'];
    const nouns = ['Tiger', 'Eagle', 'Dolphin', 'Wolf', 'Fox', 'Bear', 'Lion', 'Owl', 'Hawk', 'Shark'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return adj + noun + Math.floor(Math.random() * 100);
}

// Join a channel
function joinChannel() {
    const channelInput = document.getElementById('channelInput');
    const channel = channelInput.value.trim();

    if (!channel || channel < 1 || channel > 9999) {
        alert('Please enter a valid channel number (1-9999)');
        return;
    }

    currentChannel = channel;
    userId = generateUserId();
    userName = generateRandomName();

    // Switch to chat screen
    document.getElementById('channelScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';
    document.getElementById('currentChannel').textContent = channel;

    // Clear previous messages
    document.getElementById('messagesContainer').innerHTML = '';

    // Setup Firebase listeners
    setupChannelListeners();

    // Add join message
    addSystemMessage(`You joined Channel ${channel} as ${userName}`);

    // Update online users count
    updateOnlineUsers();
}

// Setup Firebase database listeners
function setupChannelListeners() {
    // Listen for new messages
    database.ref(`channels/${currentChannel}/messages`).limitToLast(50).on('child_added', (snapshot) => {
        const message = snapshot.val();
        displayMessage(message);
    });

    // Listen for online users updates
    database.ref(`channels/${currentChannel}/online`).on('value', (snapshot) => {
        updateOnlineCount(snapshot.numChildren());
    });

    // Add current user to online list
    const userRef = database.ref(`channels/${currentChannel}/online/${userId}`);
    userRef.set({
        name: userName,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
    });

    // Remove user from online list when they disconnect
    userRef.onDisconnect().remove();
}

// Send a message
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const messageText = messageInput.value.trim();

    if (!messageText) return;

    const message = {
        userId: userId,
        userName: userName,
        text: messageText,
        timestamp: Date.now(),
        type: 'user'
    };

    // Push message to Firebase
    database.ref(`channels/${currentChannel}/messages`).push(message);

    // Clear input
    messageInput.value = '';
    messageInput.focus();
}

// Display a message in the chat
function displayMessage(message) {
    const messagesContainer = document.getElementById('messagesContainer');
    const messageElement = document.createElement('div');

    if (message.type === 'system') {
        messageElement.className = 'message system-message';
        messageElement.innerHTML = `<span class="system-text">${message.text}</span>`;
    } else {
        messageElement.className = 'message ' + (message.userId === userId ? 'own-message' : 'other-message');

        if (message.userId === userId) {
            messageElement.innerHTML = `
                <div class="message-content">
                    <div class="message-text">${message.text}</div>
                    <div class="message-time">${formatTime(message.timestamp)}</div>
                </div>
                <div class="message-sender">You</div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-sender">${message.userName}</div>
                <div class="message-content">
                    <div class="message-text">${message.text}</div>
                    <div class="message-time">${formatTime(message.timestamp)}</div>
                </div>
            `;
        }
    }

    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add system message
function addSystemMessage(text) {
    const message = {
        text: text,
        timestamp: Date.now(),
        type: 'system'
    };
    displayMessage(message);
}

// Update online users count
function updateOnlineCount(count) {
    document.getElementById('onlineCount').textContent = count;
}

// Update online users list
function updateOnlineUsers() {
    database.ref(`channels/${currentChannel}/online`).once('value')
        .then((snapshot) => {
            const onlineCount = snapshot.numChildren();
            updateOnlineCount(onlineCount);
        });
}

// Leave channel
function leaveChannel() {
    if (currentChannel && userId) {
        // Remove user from online list
        database.ref(`channels/${currentChannel}/online/${userId}`).remove();

        // Add leave message
        addSystemMessage(`You left Channel ${currentChannel}`);

        // Turn off Firebase listeners
        database.ref(`channels/${currentChannel}/messages`).off();
        database.ref(`channels/${currentChannel}/online`).off();
    }

    // Return to channel screen
    document.getElementById('channelScreen').style.display = 'flex';
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('channelInput').value = '';

    currentChannel = null;
    userId = null;
    userName = null;
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
    // Keep only last 100 messages in each channel
    database.ref('channels').once('value', (snapshot) => {
        snapshot.forEach((channelSnapshot) => {
            const messages = channelSnapshot.child('messages');
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
document.addEventListener('DOMContentLoaded', function () {
    // Focus on channel input
    document.getElementById('channelInput').focus();

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