/* BlushChat — shared site chrome (navigation + theme) for all pages.
   Loaded on the chat app (index.html) and the static pages (about, privacy,
   terms, contact). On index.html the chat app's script.js owns the theme
   toggle; on the static pages this file provides a lightweight fallback. */
(function () {
  'use strict';

  /* ── Mobile navigation: hamburger → left sidebar ─────────────────── */
  function initNav() {
    const hamburger = document.getElementById('nav-hamburger');
    const mobileNav = document.getElementById('mobile-nav');
    const overlay = document.getElementById('nav-overlay');
    const closeBtn = document.getElementById('mobile-nav-close');
    if (!hamburger || !mobileNav) return;

    function openNav() {
      mobileNav.classList.add('open');
      hamburger.setAttribute('aria-expanded', 'true');
      hamburger.setAttribute('aria-label', 'Close menu');
      if (overlay) overlay.classList.remove('hidden');
      document.body.style.overflow = 'hidden'; // lock page scroll while the menu is open
    }

    function closeNav() {
      mobileNav.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      hamburger.setAttribute('aria-label', 'Open menu');
      if (overlay) overlay.classList.add('hidden');
      document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', openNav);
    if (closeBtn) closeBtn.addEventListener('click', closeNav);
    if (overlay) overlay.addEventListener('click', closeNav);
    mobileNav.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeNav));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeNav();
    });
  }

  /* ── Theme toggle for pages without the chat app's script.js ─────── */
  function initTheme() {
    if (typeof window.toggleTheme === 'function') return; // index.html handles it
    const buttons = document.querySelectorAll('.theme-toggle');
    if (!buttons.length) return;

    function sync() {
      const dark = document.documentElement.dataset.theme === 'dark';
      buttons.forEach((btn) => {
        const icon = btn.querySelector('.theme-toggle-icon');
        if (icon) icon.textContent = dark ? '☀️' : '🌙';
        btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
      });
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('blushchat-theme', next); } catch (e) {}
        sync();
      });
    });

    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initNav(); initTheme(); });
  } else {
    initNav();
    initTheme();
  }
})();
