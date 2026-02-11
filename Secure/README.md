# TrulyChat

TrulyChat is a Firebase-powered, multi-page web app for private team rooms with realtime chat, presence, room membership management, and invite flows.

## Stack
- Frontend: vanilla HTML, CSS, JavaScript modules
- Auth: Firebase Authentication (email/password + Google)
- Database: Firestore (rooms/messages/members/bans/users)
- Presence: Firebase Realtime Database

## Core Features
- Room lifecycle:
  - Create room with custom ID (slug + numeric suffix fallback)
  - Join room by ID and optional password
  - Owner controls: set/remove room password, kick/ban/unban, delete room
- Realtime chat:
  - Send/edit/delete message
  - Message reactions
  - Reply-to message flow
  - Presence + typing indicators
- Invites:
  - Owner invite can bypass password gate for recipients
  - Non-owner invite still requires room password
  - Redirect-to-login then return-to-room is supported
- Auto-cleanup:
  - Empty rooms are marked and removed after 10 minutes (ID becomes reusable)
  - Optional backend scheduler can enforce this even when no clients are online

## Project Structure
- `index.html`:
  - Landing page (uses `assets/css/index.css`)
- `pages/*.html`:
  - App pages (`login`, `dashboard`, `rooms`, `chat`, etc.)
- `assets/js/app.js`:
  - Shared UI behavior (nav, theme, auth forms)
- `assets/js/route-guard.js`:
  - Public/protected page guard + redirect handling
- `assets/js/auth.js`:
  - Auth service + Google popup/redirect fallback
- `assets/js/rooms.js`:
  - Dashboard room listing + room sweeper logic
- `assets/js/rooms-page.js`:
  - Create/join room page behavior
- `assets/js/chat-service.js`:
  - Chat data operations (messages, reactions, edits, presence, member controls)
- `assets/js/chat.js`:
  - Chat page orchestration + UI interaction logic
- `assets/js/ui.js`:
  - Message and toast rendering helpers
- `firestore.rules`:
  - Firestore security rules
- `database.rules.json`:
  - Realtime Database security rules

## Local Setup
1. Create a Firebase project.
2. Enable Authentication providers:
   - Email/Password
   - Google
3. Create Firestore and Realtime Database.
4. Add Firebase web app credentials:
   - create `assets/js/config.js` from `assets/js/config.example.js`
5. Deploy rules:
   - Firestore: `firestore.rules`
   - Realtime DB: `database.rules.json`
6. Optional but recommended for reliable cleanup:
   - install Firebase Functions deps:
     - `cd functions && npm install`
   - deploy scheduler:
     - `firebase deploy --only functions`
7. Run static server from project root:
   - any local static server is fine (Live Server, etc.)

## Backend Cleanup Scheduler (Recommended)
- Function: `cleanupInactiveRooms` in `functions/index.js`
- Schedule: runs every 1 minute
- Behavior:
  - Deletes rooms where `expiresAt <= now` and no users are online in `status/{roomId}`
  - Clears stale expiry window if room becomes active again
  - Marks expiry window for inactive rooms that do not yet have `expiresAt`
  - Cleans related data:
    - `rooms/{roomId}/messages/*`
    - `rooms/{roomId}/members/*`
    - `rooms/{roomId}/bans/*`
    - `users/{uid}/rooms/{roomId}`
    - RTDB `status/{roomId}` and `roomStatus/{roomId}`

## Configuration
Create `assets/js/config.js`:

```js
export const firebaseConfig = {
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  storageBucket: '...',
  messagingSenderId: '...',
  appId: '...',
  measurementId: '...'
};
```

`assets/js/config.js` is gitignored by default.

## Data Model (Current)
- `rooms/{roomId}`
  - `name`, `password`, `ownerUid`, `createdAt`
  - `emptySince`, `expiresAt` (sweeper lifecycle)
- `rooms/{roomId}/members/{uid}`
  - `uid`, `displayName`, `joinedAt`
- `rooms/{roomId}/messages/{messageId}`
  - `text`, `uid`, `displayName`, `photoURL`
  - `replyTo`, `reactions`, `createdAt`, `editedAt`
- `rooms/{roomId}/bans/{uid}`
  - `uid`, `displayName`, `bannedBy`, `bannedAt`
- `users/{uid}/rooms/{roomId}`
  - `roomId`, `name`, `joinedAt`
- RTDB:
  - `status/{roomId}/{uid}` for presence + typing
  - `roomStatus/{roomId}` transient deletion signal

## Dev Notes
- Query-string cache busting (`?v=...`) is used on many script includes; bump when needed.
- Keep auth redirects relative (`chat.html?...`) because pages run under `/pages`.
- If message features fail (`edit/reaction/delete`), verify Firestore rules are deployed.

## Recommended Handoff Docs
- `docs/ARCHITECTURE.md`
- `docs/HANDOFF.md`
