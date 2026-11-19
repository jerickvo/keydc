// Classic (non-module) script: if the app has not started after 20 seconds
// (for example a file failed to load), show a Reload screen instead of
// leaving guests looking at a frozen page.
(function () {
  function showFail() {
    if (window.__pbBooted) return;
    var el = document.getElementById('boot-fail');
    if (el) el.hidden = false;
  }
  setTimeout(showFail, 20000);
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('boot-reload');
    if (btn) {
      btn.addEventListener('click', function () {
        location.reload();
      });
    }
  });
})();
