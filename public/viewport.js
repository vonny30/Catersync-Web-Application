// Tablets get the same screen as the desktop.
//
// A tablet normally reports its own narrow width (about 768-1200 px), so the
// app would show the phone-style cards and a squeezed layout. Instead, on a
// touch device whose short side is 700 px or more, lay the page out at a
// desktop width and let the browser scale it to fit the screen: every table
// and column is there, nothing scrolls sideways, and pinch-zoom still works.
// Phones (short side under 700 px) keep the mobile layout with cards.
// Desktop browsers ignore this tag, so desktops are unaffected.
//
// A plain file, not an inline script, so the Content-Security-Policy in
// vercel.json (script-src 'self') allows it. It runs before the app does.
(function () {
  var DESKTOP_WIDTH = 1280;
  var shortSide = Math.min(window.screen.width, window.screen.height);
  var isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  if (!isTouch || shortSide < 700) return;
  var meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.setAttribute('content', 'width=' + DESKTOP_WIDTH);
})();
