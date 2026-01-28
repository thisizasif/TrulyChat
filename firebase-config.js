// Your Firebase configuration
const firebaseConfig = {
    // REPLACE WITH YOUR FIREBASE CONFIG
    apiKey: "AIzaSyAI6FIucMNrMZxq2zNEYn00rJbPKI10RBQ",
    authDomain: "trulychat.firebaseapp.com",
    databaseURL: "https://trulychat-default-rtdb.firebaseio.com",
    projectId: "trulychat",
    storageBucket: "trulychat.firebasestorage.app",
    messagingSenderId: "158285691632",
    appId: "1:158285691632:web:6d9b9c80df46b939456035"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();