/* Shared UI helpers: modal + copy buttons. */
(function () {
  'use strict';
  var ovl;
  function ensure() {
    if (ovl) return ovl;
    ovl = document.createElement('div');
    ovl.className = 'ovl';
    ovl.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">' +
      '<div class="modal-head"><div><b id="mTitle"></b><small id="mSub"></small></div>' +
      '<button class="modal-x" id="mClose" aria-label="Close">&times;</button></div>' +
      '<div class="modal-body" id="mBody"></div></div>';
    document.body.appendChild(ovl);
    ovl.addEventListener('click', function (e) { if (e.target === ovl) close(); });
    document.getElementById('mClose').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    return ovl;
  }
  function open(title, sub, html) {
    ensure();
    document.getElementById('mTitle').textContent = title;
    document.getElementById('mSub').textContent = sub;
    document.getElementById('mBody').innerHTML = html;
    ovl.classList.add('on');
    document.getElementById('mClose').focus();
  }
  function close() { if (ovl) ovl.classList.remove('on'); }

  function initCopy() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
      btn.addEventListener('click', function () {
        var src = document.getElementById(btn.getAttribute('data-copy'));
        if (!src) return;
        var done = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(src.innerText).then(done, done);
        else done();
      });
    });
  }

  /* Buttons that have no backend yet say so instead of doing nothing. */
  function initNotWired() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-notwired]'), function (btn) {
      btn.addEventListener('click', function () {
        open(btn.getAttribute('data-notwired-title') || btn.textContent.trim(),
             'Not wired up yet',
             '<p class="empty-soft">' + (btn.getAttribute('data-notwired') || '') + '</p>');
      });
    });
  }

  window.DGUI = { open: open, close: close };
  initCopy(); initNotWired();
})();
