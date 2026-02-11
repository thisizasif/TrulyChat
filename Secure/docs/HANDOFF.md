# Handoff Checklist

## 1. Environment
- [ ] Firebase project exists and is accessible
- [ ] Auth providers enabled:
  - [ ] Email/Password
  - [ ] Google
- [ ] Firestore database created
- [ ] Realtime Database created
- [ ] `assets/js/config.js` populated from `assets/js/config.example.js`

## 2. Rules Deployment
- [ ] Deploy `firestore.rules`
- [ ] Deploy `database.rules.json`
- [ ] Verify rules correspond to current message features (edit/reaction/delete)

## 3. Smoke Test
- [ ] Sign up with email/password
- [ ] Sign in with Google (desktop + mobile browser)
- [ ] Create room and join room
- [ ] Chat send/edit/delete/reply/react
- [ ] Owner actions: password change, kick, ban, unban
- [ ] Invite flow:
  - [ ] Owner invite
  - [ ] Non-owner invite
  - [ ] Logged-out recipient redirect and return
- [ ] Presence updates and online count
- [ ] Empty room auto-deletion after 10+ minutes

## 4. Important Files
- `assets/js/auth.js`
- `assets/js/route-guard.js`
- `assets/js/rooms.js`
- `assets/js/rooms-page.js`
- `assets/js/chat-service.js`
- `assets/js/chat.js`
- `assets/js/ui.js`
- `firestore.rules`
- `database.rules.json`

## 5. Change Conventions
- Bump script query version (`?v=...`) when browser caching blocks updates.
- Keep shared styles in `assets/css/styles.css`.
- Keep landing-page-only styles in `assets/css/index.css`.
- Prefer service logic in `chat-service.js` and page orchestration in `chat.js`.
