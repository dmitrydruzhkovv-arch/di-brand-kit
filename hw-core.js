/* hw-core.js — ОБЩИЙ ДВИЖОК ОТЧЁТНОСТИ И РАЗБОРА веб-домашек.
   Мастер живёт здесь (`💻 Веб-проекты/_hw-core.js`), на прод уезжает скриптом
   ./deploy_brand_kit.sh → https://dmitrydruzhkovv-arch.github.io/di-brand-kit/hw-core.js
   Подключается по URL, как бренд-кит: копию в папку домашки НЕ класть.

   Зачем: отчёт (#38) и разбор `?r=` были СКОПИРОВАНЫ в app.js каждой домашки —
   поэтому разбор оказался только у тестов, а домашки годами слали итог без detail
   (Ди: «а как ей показывать ошибку?»). Теперь это одно место на всех.

   Что даёт домашке:
     HwCore.token()                     — ник ученика из ?u=  (без него ничего не шлём)
     HwCore.reviewCode()                — код разбора из ?r=  (режим просмотра попытки)
     HwCore.report({...})               — POST итога ВМЕСТЕ с detail (сам разбор)
     HwCore.revItemsHtml(items, helpers)— карточки разбора (тот же вид на финале и в ?r=)
     HwCore.bindToggles(root)           — раскрытие ошибочных шагов
     HwCore.showReview({...})           — экран «Разбор попытки» по ссылке ?r=ник.id

   Контракт домашки: массив results[] с элементами
     { label, diff, correct, wrong: [...], feedback }
   (ровно то, что уже пишут все app.js — движок подстроен под них, не наоборот).
*/
(function () {
  'use strict';

  var ENDPOINT = 'https://194-87-110-53.nip.io/hw-result';

  function qs(name, max) {
    var p = new URLSearchParams(location.search);
    return (p.get(name) || '').slice(0, max || 40);
  }

  /** Ник ученика (?u=). Пусто → ничего не отправляем (аноним/превью — старые ссылки безопасны). */
  function token() {
    var p = new URLSearchParams(location.search);
    return (p.get('u') || p.get('id') || '').slice(0, 40);
  }

  /** Код разбора (?r=ник.id) — Ди открывает конкретную попытку ученика. */
  function reviewCode() { return qs('r', 60); }

  /** detail — сам разбор: по нему ?r= воссоздаёт, что ученик сделал на каждом шаге.
      Без detail у Ди нет ссылки на разбор — показывать нечего. */
  function buildDetail(results) {
    return (results || []).map(function (r, i) {
      return {
        n: i + 1,
        label: r ? r.label : 'Шаг ' + (i + 1),
        diff: r ? r.diff : '',
        ok: !!(r && r.correct),
        wrong: (r && r.wrong) || [],
        feedback: r ? r.feedback : null,
      };
    });
  }

  /** Отправка итога репетитору (#38). Возвращает true, если реально ушло. */
  function report(o) {
    var tok = token();
    if (!tok) return false;                       // без ?u= не шлём никогда
    if (o.devMode && !o.allowSend) return false;  // dev-прогон не засоряет отчёты
    var errors = [];
    (o.results || []).forEach(function (r, i) {
      if (r && !r.correct) errors.push('№' + (i + 1) + ' ' + r.label);
    });
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: tok,
          hw: o.hw,
          hw_id: o.hw_id,
          score: o.score,
          total: o.total,
          errors: errors,
          detail: buildDetail(o.results),
          started_at: o.startedAt || null,
          duration_sec: o.durationSec != null ? o.durationSec : null,
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) { return false; }
    return true;
  }

  /** Карточки разбора. helpers: { fmtInline, renderFeedback } — у каждой домашки свои
      (математика рисуется по-разному), поэтому движок их не выдумывает, а принимает. */
  function revItemsHtml(items, helpers) {
    var fmt = (helpers && helpers.fmtInline) || function (s) { return s; };
    var fb = (helpers && helpers.renderFeedback) || function () { return ''; };
    return (items || []).map(function (r, i) {
      var ok = !!(r.correct !== undefined ? r.correct : r.ok);
      var wrong = r.wrong || [];
      var wrongLines = wrong.length
        ? '<div class="rev-wrong-line" style="padding:9px 12px;margin-bottom:10px;border-radius:12px;'
          + 'background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);font-size:13px;line-height:1.7">'
          + wrong.map(function (w) { return fmt(w); }).join('<br>') + '</div>'
        : '';
      var razbor = '<div class="rev-razbor-label">Разбор</div>' + fb(r.feedback);
      return ''
        + '<div class="rev-item ' + (ok ? 'ok' : 'bad') + '" data-i="' + i + '">'
        +   '<div class="rev-head">'
        +     '<span class="rev-mark">' + (ok ? '✅' : '❌') + '</span>'
        +     '<span class="rev-title">' + (r.label || ('Шаг ' + (i + 1))) + '</span>'
        +     '<span class="rev-diff">' + (r.diff || '') + '</span>'
        +     (ok ? '' : '<span class="rev-toggle">показать ▾</span>')
        +   '</div>'
        +   '<div class="rev-body">' + wrongLines + razbor + '</div>'
        + '</div>';
    }).join('');
  }

  function bindToggles(root) {
    root.querySelectorAll('.rev-item.bad .rev-head').forEach(function (head) {
      head.addEventListener('click', function () {
        var item = head.closest('.rev-item');
        var open = item.classList.toggle('open');
        var tg = item.querySelector('.rev-toggle');
        if (tg) tg.textContent = open ? 'скрыть ▴' : 'показать ▾';
      });
    });
  }

  /** Экран «Разбор попытки» по ссылке ?r=ник.id — тот же вид, что видел ученик.
      opts: { mount, helpers, hide: [элементы, которые прячем], title } */
  function showReview(code, opts) {
    opts = opts || {};
    (opts.hide || []).forEach(function (el) { if (el) el.hidden = true; });
    var el = opts.mount;
    if (!el) return;
    el.classList.add('show');
    el.innerHTML = '<p style="padding:30px;text-align:center;opacity:.7">Загружаю разбор…</p>';

    var fail = function (msg) {
      el.innerHTML = '<div class="lk-card" style="padding:22px"><p style="font-size:15px;line-height:1.6">'
        + msg + '</p></div>';
    };

    fetch(ENDPOINT + '?r=' + encodeURIComponent(code))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (res) {
        if (!res.ok || !Array.isArray(res.detail) || !res.detail.length) return Promise.reject('empty');
        var total = res.total || res.detail.length;
        var score = res.score != null ? res.score : res.detail.filter(function (d) { return d.ok; }).length;
        el.innerHTML = ''
          + '<div class="lk-card" style="padding:22px 18px">'
          +   '<div class="fin-theme">🔍 Разбор попытки</div>'
          +   '<div class="fin-tier">С первого раза: ' + score + ' из ' + total + '</div>'
          +   revItemsHtml(res.detail, opts.helpers)
          + '</div>'
          + '<div class="lk-sign" style="margin-top:22px">'
          +   '<span class="lk-badge lk-badge-l">Λ</span><span class="lk-badge lk-badge-d">D.</span>'
          + '</div><div style="height:32px"></div>';
        bindToggles(el);
        window.scrollTo(0, 0);
      })
      .catch(function (err) {
        fail(err === 404
          ? 'По этой ссылке результата пока нет — ученик ещё не дошёл до конца.'
          : err === 'empty'
            ? 'Разбор для этой попытки не сохранён (заход до появления разборов). Следующее прохождение будет с полным разбором.'
            : 'Не удалось загрузить разбор. Попробуй обновить страницу.');
      });
  }

  /* ── ЗВУК ───────────────────────────────────────────────────────────────────
     Браузер (особенно встроенный в ВК) не даёт играть звук, пока человек не
     коснулся страницы. Домашки «будили» звук так: при первом касании запускали
     все мелодии и тут же ставили на паузу. Пауза приходит ПОСЛЕ старта
     воспроизведения — поэтому на первом же тапе ученик слышал победу, проигрыш и
     финал разом (Ди, 13.07). Правильный приём: будим НА ЗАГЛУШЁННОМ звуке
     (muted) и только потом возвращаем громкость — слышно ничего не будет. */
  var _unlocked = false;
  function unlockAudio(ids) {
    if (_unlocked) return;
    _unlocked = true;
    (ids || []).forEach(function (id) {
      var a = document.getElementById(id);
      if (!a) return;
      var back = a.muted;
      a.muted = true;                       // ← ключ: будим молча
      var done = function () {
        try { a.pause(); a.currentTime = 0; } catch (e) {}
        a.muted = back;                     // громкость вернули — играть будет когда надо
      };
      try {
        var p = a.play();
        if (p && p.then) p.then(done).catch(done);
        else done();
      } catch (e) { done(); }
    });
  }

  /** Проиграть звук по id (<audio>). Тихо игнорирует запрет автоплея. */
  function playSound(id) {
    var a = document.getElementById(id);
    if (!a) return;
    try { a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () {}); }
    catch (e) {}
  }

  window.HwCore = {
    ENDPOINT: ENDPOINT,
    token: token,
    reviewCode: reviewCode,
    report: report,
    revItemsHtml: revItemsHtml,
    bindToggles: bindToggles,
    showReview: showReview,
    unlockAudio: unlockAudio,
    playSound: playSound,
  };
})();
