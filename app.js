// app.js - FIXED: Messages in DB, UI clears when channel was empty
let currentChannel = null;
let userId = null;
let userName = null;
let userRef = null;
let messagesListener = null;
let onlineListener = null;
let lastOnlineCount = 0;
let joinTimestamp = null; // Track when user joined

// Generate random user ID and name
function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

function generateRandomName() {
    const adjectives = ['Ashu', 'Asba', 'Kashmir', 'Akii', 'Eager', 'Gentle', 'Happy', 'Jolly', 'Kind', 'Lucky'];
    const nouns = ['Tiger', 'Eagle', 'Dolphin', 'Wolf', 'Fox', 'Bear', 'Lion', 'Owl', 'Hawk', 'Shark'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return adj + noun + Math.floor(Math.random() * 100);
}

// Join a channel
function joinChannel(channelFromUrl = null) {
    let channel;

    if (channelFromUrl) {
        channel = channelFromUrl;
    } else {
        const channelInput = document.getElementById('channelInput');
        channel = channelInput.value.trim();
    }

    if (!channel || channel < 1 || channel > 9999) {
        if (!channelFromUrl) {
            alert('Please enter a valid channel number (1-9999)');
        }
        return;
    }

    currentChannel = channel;
    userId = generateUserId();
    userName = generateRandomName();
    joinTimestamp = Date.now(); // Set join time
    lastOnlineCount = 0;

    // Switch to chat screen
    document.getElementById('channelScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';
    document.getElementById('currentChannel').textContent = channel;

    // Clear previous messages from UI
    document.getElementById('messagesContainer').innerHTML = '';

    // Update URL with channel for sharing
    updateURLWithChannel(channel);

    // Setup Firebase listeners
    setupChannelListeners();

    // Add join message
    addSystemMessage(`You joined Channel ${channel} as ${userName}`);

    // Update online users count
    updateOnlineUsers();
}

// Setup Firebase database listeners
function setupChannelListeners() {
    // Remove any existing listeners first
    removeChannelListeners();

    // Listen for online users updates
    onlineListener = database.ref(`channels/${currentChannel}/online`).on('value', (snapshot) => {
        const onlineCount = snapshot.numChildren();
        updateOnlineCount(onlineCount);

        console.log(`Online count: ${onlineCount}, Last: ${lastOnlineCount}`);

        // Store the previous count
        lastOnlineCount = onlineCount;
    });

    // Listen for NEW messages - CRITICAL FIX
    messagesListener = database.ref(`channels/${currentChannel}/messages`).on('child_added', (snapshot) => {
        const message = snapshot.val();

        // Only display messages sent AFTER this user joined
        // This ensures new users don't see old messages
        if (message.timestamp >= joinTimestamp) {
            displayMessage(message);
        } else {
            console.log('Skipping old message:', message.text, 'Timestamp:', message.timestamp, 'Join time:', joinTimestamp);
        }
    });

    // Add current user to online list
    userRef = database.ref(`channels/${currentChannel}/online/${userId}`);
    userRef.set({
        name: userName,
        joinedAt: firebase.database.ServerValue.TIMESTAMP,
        timestamp: Date.now()
    });

    // Remove user when they disconnect
    userRef.onDisconnect().remove();
}

// Remove Firebase listeners
function removeChannelListeners() {
    if (messagesListener) {
        database.ref(`channels/${currentChannel}/messages`).off('child_added', messagesListener);
        messagesListener = null;
    }
    if (onlineListener) {
        database.ref(`channels/${currentChannel}/online`).off('value', onlineListener);
        onlineListener = null;
    }
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

    // Push message to Firebase (stays in database)
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

// Share channel link
function shareChannel() {
    if (!currentChannel) {
        alert('Please join a channel first');
        return;
    }

    const channelLink = `${window.location.origin}${window.location.pathname}?channel=${currentChannel}`;

    // Create modal for sharing
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2000;
    `;

    modal.innerHTML = `
        <div style="background: white; padding: 25px; border-radius: 10px; max-width: 500px; width: 90%;">
            <h3 style="margin: 0 0 15px 0; color: #333;">📤 Share Channel ${currentChannel}</h3>
            <p style="margin: 0 0 15px 0; color: #666;">Send this link to invite others:</p>
            <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 20px; word-break: break-all; font-family: monospace; font-size: 14px;">
                ${channelLink}
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                        style="flex: 1; padding: 10px; background: #666; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">
                    Close
                </button>
                <button id="copyBtn" 
                        style="flex: 1; padding: 10px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: 600;">
                    Copy Link
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add copy functionality
    document.getElementById('copyBtn').onclick = function () {
        copyToClipboard(channelLink, this);
    };

    // Close on background click
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// Helper function for copying to clipboard
function copyToClipboard(text, button) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            button.innerHTML = '✓ Copied!';
            button.style.background = '#2E7D32';

            setTimeout(() => {
                const modal = button.closest('div[style*="position: fixed"]');
                if (modal) {
                    document.body.removeChild(modal);
                }
            }, 1500);
        }).catch(() => {
            fallbackCopy(text, button);
        });
    } else {
        fallbackCopy(text, button);
    }
}

// Fallback copy method
function fallbackCopy(text, button) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    button.innerHTML = '✓ Copied!';
    button.style.background = '#2E7D32';

    setTimeout(() => {
        const modal = button.closest('div[style*="position: fixed"]');
        if (modal) {
            document.body.removeChild(modal);
        }
    }, 1500);
}

// Update URL with channel
function updateURLWithChannel(channel) {
    const url = new URL(window.location);
    url.searchParams.set('channel', channel);
    window.history.pushState({}, '', url);
}

// Check URL for channel on load
function checkURLForChannel() {
    const urlParams = new URLSearchParams(window.location.search);
    const channel = urlParams.get('channel');

    if (channel && channel >= 1 && channel <= 9999) {
        // Auto-join the channel
        joinChannel(channel);
        return true;
    }
    return false;
}

// Leave channel
function leaveChannel() {
    if (currentChannel && userId) {
        // Remove user from online list
        database.ref(`channels/${currentChannel}/online/${userId}`).remove();

        // Add leave message
        addSystemMessage(`You left Channel ${currentChannel}`);

        // Remove Firebase listeners
        removeChannelListeners();

        // Remove onDisconnect handler
        if (userRef) {
            userRef.onDisconnect().cancel();
        }
    }

    // Clear URL parameter
    const url = new URL(window.location);
    url.searchParams.delete('channel');
    window.history.pushState({}, '', url);

    // Return to channel screen
    document.getElementById('channelScreen').style.display = 'flex';
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('channelInput').value = '';

    // Reset variables
    currentChannel = null;
    userId = null;
    userName = null;
    userRef = null;
    messagesListener = null;
    onlineListener = null;
    lastOnlineCount = 0;
    joinTimestamp = null;
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
    // Check if URL has channel parameter
    if (!checkURLForChannel()) {
        // Show channel screen and focus input
        document.getElementById('channelScreen').style.display = 'flex';
        document.getElementById('channelInput').focus();
    }

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
