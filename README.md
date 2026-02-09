<div align="center">
  <img src="assets/trulychat.png" alt="TrulyChat" width="120" height="120" />
  <h1>TrulyChat</h1>
  <p>Instant private channel chat. No sign-up. Share a number, start talking.</p>
</div>

<div align="center">
  <img alt="GitHub Pages" src="https://img.shields.io/badge/GitHub%20Pages-Ready-0ea5a4?style=for-the-badge&logo=github" />
  <img alt="Firebase" src="https://img.shields.io/badge/Firebase-Realtime_DB-ffca28?style=for-the-badge&logo=firebase" />
  <img alt="HTML5" src="https://img.shields.io/badge/HTML5-Structure-e34f26?style=for-the-badge&logo=html5" />
  <img alt="CSS3" src="https://img.shields.io/badge/CSS3-Styling-1572b6?style=for-the-badge&logo=css3" />
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-Logic-f7df1e?style=for-the-badge&logo=javascript&logoColor=000000" />
  <img alt="Responsive UI" src="https://img.shields.io/badge/Responsive-UI-22c55e?style=for-the-badge" />
</div>

<div align="center">
  <a href="https://thisizasif.github.io/TrulyChat/">
    <img alt="Live Demo" src="https://img.shields.io/badge/Live%20Demo-Visit-22c55e?style=for-the-badge" />
  </a>
  <a href="pages/help.html">
    <img alt="Help" src="https://img.shields.io/badge/Help-Read-0ea5a4?style=for-the-badge" />
  </a>
  <a href="pages/faq.html">
    <img alt="FAQ" src="https://img.shields.io/badge/FAQ-Answers-3b82f6?style=for-the-badge" />
  </a>
  <a href="pages/privacy.html">
    <img alt="Privacy" src="https://img.shields.io/badge/Privacy-Details-6366f1?style=for-the-badge" />
  </a>
</div>

**What is TrulyChat**
TrulyChat lets anyone create a private chat room using a channel number. Share the number, chat live, and move on whenever you want. No accounts, no friction.

**Highlights**
- Channel-based chat with shareable room numbers
- Real-time messaging using Firebase Realtime Database
- Typing indicator, reply preview, edit, delete, copy, reactions
- Mobile-first UI with a consistent hamburger menu
- SEO-ready landing + help/about/privacy pages

**Pages**
- `index.html` — welcome page
- `join.html` — join a channel
- `chat.html` — chat experience
- `pages/help.html` — help guide
- `pages/faq.html` — FAQs with structured data
- `pages/about.html` — product overview
- `pages/privacy.html` — privacy notes

**Configuration**
- `scripts/limits.js` — set the max channel number and max users per channel:

```js
window.TRULYCHAT_MAX_CHANNEL_NUMBER = 100;
window.TRULYCHAT_MAX_USERS_PER_CHANNEL = 50;
```

- `scripts/firebase-config.js` — your Firebase project config

**Local Development**
1. Open the folder in VS Code.
2. Use Live Server or run a static server:

```bash
python -m http.server 5500
```

3. Visit `http://localhost:5500/index.html`.

**SEO Assets**
- `sitemap.xml`
- `robots.txt`

**Deployment**
This project is designed for GitHub Pages. Push to the `TrulyChat` repo and enable Pages on the `main` branch.

**Notes**
- Keep `scripts/firebase-config.js` credentials in sync with your Firebase project.
- Update the canonical URLs in `index.html`, `join.html`, `sitemap.xml`, and page heads if your domain changes.
