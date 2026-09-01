/* Dark / light toggle. The <head> of every page sets the theme before paint;
   this file only draws the button and handles switching. */
(function () {
  'use strict';
  var KEY = 'cp_theme';

  function current() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e1620' : '#eef2f5');
    var btn = document.querySelector('.themebtn');
    if (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', btn.getAttribute('aria-label'));
    }
  }

  function mount() {
    var bar = document.querySelector('.topbar');
    if (!bar || bar.querySelector('.themebtn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'themebtn';
    btn.innerHTML =
      '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
      '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next);
    });

    var pill = bar.querySelector('.pill');
    if (pill) bar.insertBefore(btn, pill);
    else bar.appendChild(btn);
    apply(current());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
