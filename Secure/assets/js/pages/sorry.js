// Page entry script: sorry
import "../app.js";
import "../route-guard.js";

const loginLink = document.querySelector('[data-login-link]');
if (loginLink) {
  const redirect = new URLSearchParams(window.location.search).get('redirect');
  if (redirect) {
    loginLink.href = `login.html?redirect=${encodeURIComponent(redirect)}`;
  }
}
