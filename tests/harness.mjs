/* 注入页面的测试探针：记录首屏时间、驱动搜索与翻页。
 * 顺序很重要：先挂 __h，再装观察器 —— 观察器在 document-start 阶段
 * 可能因为没有 documentElement 而抛错，不能让它带崩整个注入脚本。
 */
export const HARNESS = `
window.__h = {
  rows: function () {
    var l = document.getElementById('list');
    return l ? l.querySelectorAll('.row').length : 0;
  },
  hits: function () {
    var s = document.getElementById('stat');
    if (!s) return null;
    // 结果行的展示文案会变（有时只说更新时间），条数以 data-count 为准
    if (s.dataset && s.dataset.count) return Number(s.dataset.count);
    var m = (s.textContent || '').match(/[0-9][0-9,]*/);
    if (!m) return null;
    return Number(m[0].replace(/,/g, ''));
  },
  mem: function () {
    return performance.memory ? performance.memory.usedJSHeapSize : 0;
  },
  search: function (term) {
    var before = this.rows();
    var statBefore = (document.getElementById('stat') || {}).textContent || '';
    var q = document.getElementById('q');
    var t0 = performance.now();
    return new Promise(function (resolve) {
      var done = false;
      function settleIfReady() {
        if (done) return;
        var n = window.__h.rows();
        var statNow = (document.getElementById('stat') || {}).textContent || '';
        // 结果条数变化、或状态行文案变化，都说明这一轮筛选已经落地
        if ((n > 0 && n !== before) || statNow !== statBefore) {
          done = true;
          mo.disconnect();
          // 再等一帧，让列表和状态行都写稳
          requestAnimationFrame(function () {
            resolve({ ms: performance.now() - t0, rows: window.__h.rows() });
          });
        }
      }
      var mo = new MutationObserver(settleIfReady);
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      q.value = term;
      q.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(function () {
        if (done) return;
        done = true;
        mo.disconnect();
        resolve({ ms: performance.now() - t0, rows: window.__h.rows(), timeout: true });
      }, 15000);
    });
  },
  clearSearch: function () {
    var q = document.getElementById('q');
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
  },
  scrollMore: function () {
    var before = this.rows();
    var t0 = performance.now();
    return new Promise(function (resolve) {
      var done = false;
      var mo = new MutationObserver(function () {
        var n = window.__h.rows();
        if (!done && n > before) {
          done = true;
          mo.disconnect();
          resolve({ ms: performance.now() - t0, rows: n });
        }
      });
      mo.observe(document.getElementById('list'), { childList: true, subtree: true });
      window.scrollTo(0, document.body.scrollHeight);
      setTimeout(function () {
        if (done) return;
        done = true;
        mo.disconnect();
        resolve({ ms: performance.now() - t0, rows: window.__h.rows(), timeout: true });
      }, 30000);
    });
  },
  clickTab: function (kind) {
    var btn = document.querySelector('#tabs button[data-kind="' + kind + '"]');
    if (!btn) return false;
    btn.click();
    return true;
  },
  setSelect: function (id, value) {
    var el = document.getElementById(id);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  }
};

window.__marks = { firstRows: -1, rows: 0, rowsAtFirst: 0 };
(function () {
  function scan() {
    var l = document.getElementById('list');
    if (!l) return;
    var n = l.querySelectorAll('.row').length;
    if (n > 0 && window.__marks.firstRows < 0) {
      window.__marks.firstRows = performance.now();
      window.__marks.rowsAtFirst = n;
    }
    window.__marks.rows = n;
  }
  function attach() {
    try {
      var root = document.documentElement;
      if (!root) { setTimeout(attach, 5); return; }
      new MutationObserver(scan).observe(root, { childList: true, subtree: true });
      scan();
    } catch (e) {
      setTimeout(attach, 10);
    }
  }
  attach();
})();
`;
