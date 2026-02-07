<div align="center">
  <img src="trulychat.png" alt="TrulyChat" width="120" height="120" />
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
  <a href="https://thisizasif.github.io/TrulyChat/">Live Demo</a>
  ·
  <a href="help.html">Help</a>
  ·
  <a href="faq.html">FAQ</a>
  ·
  <a href="privacy.html">Privacy</a>
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
- `index.html` — landing and join page
- `chat.html` — chat experience
- `help.html` — quick help guide
- `faq.html` — FAQs with structured data
- `about.html` — product overview
- `privacy.html` — privacy notes

**Configuration**
- `config.js` — set the max channel number:

```js
window.TRULYCHAT_MAX_CHANNEL_NUMBER = 100;
```

- `firebase-config.js` — your Firebase project config

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
- Keep `firebase-config.js` credentials in sync with your Firebase project.
- Update the canonical URLs in `index.html`, `sitemap.xml`, and page heads if your domain changes.
