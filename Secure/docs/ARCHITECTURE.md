# Architecture

## Runtime Model
- This project is static-site style (no Node backend in repo).
- Business logic is split across page-specific JS modules under `assets/js`.
- Firebase provides all backend behavior:
  - Auth
  - Firestore
  - Realtime Database presence

## Main Flows

### Auth Flow
- `assets/js/auth.js`
  - Sign up/sign in/sign out
  - Google popup with redirect fallback
  - Post-auth routing (`redirect` query param or default dashboard)
- `assets/js/route-guard.js`
  - Redirect unauthenticated users from protected pages
  - Redirect authenticated users away from auth entry pages

### Rooms Flow
- `assets/js/rooms-page.js`
  - Create room form
  - Join room form
  - Rooms insights rendering
- `assets/js/rooms.js`
  - Dashboard room listings and filters
  - Presence/member watchers
  - Empty-room expiry scheduling and deletion

### Chat Flow
- `assets/js/chat-service.js`
  - Membership and ban checks
  - Realtime listeners: messages, members, bans, room, presence
  - Message operations: send/edit/delete/react
  - Room operations: password update, kick/ban/unban, delete
- `assets/js/chat.js`
  - Page orchestration
  - Composer state (send/reply/edit)
  - Message action interactions
  - Invite/share/change-room UI behaviors
- `assets/js/ui.js`
  - Message rendering and reusable toast/confirm UI

## Data + Presence

### Firestore
- Room metadata in `rooms/{roomId}`
- Members/messages/bans as room subcollections
- User membership index in `users/{uid}/rooms/{roomId}`

### Realtime Database
- Presence per room/user in `status/{roomId}/{uid}`
- Room lifecycle signal in `roomStatus/{roomId}`

## Styling Layout
- `assets/css/styles.css`: shared app styling
- `assets/css/index.css`: landing page only

## Security Boundaries
- `firestore.rules` enforces room/member ownership constraints
- `database.rules.json` controls presence path read/write access

## Known Constraints
- Firestore document size limits still apply to long messages.
- Some features depend on both Firestore and RTDB consistency (presence + sweep timing).
