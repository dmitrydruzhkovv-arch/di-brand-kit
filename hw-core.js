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
     HwCore.snap(el)                    — СНИМОК задания (см. ниже) для разбора
     HwCore.revItemsHtml(items, helpers)— карточки разбора (тот же вид на финале и в ?r=)
     HwCore.bindToggles(root)           — раскрытие ошибочных шагов
     HwCore.showReview({...})           — экран «Разбор попытки» по ссылке ?r=ник.id

   Контракт домашки: массив results[] с элементами
     { label, diff, correct, wrong: [...], feedback }
   (ровно то, что уже пишут все app.js — движок подстроен под них, не наоборот).

   ── СНИМОК ЗАДАНИЯ (стандарт разбора, D 04.08) ───────────────────────────────
   Разбор был СПЛОШНЫМ ТЕКСТОМ: условие + строка «твой/правильный» + простыня
   разбора. D: «дети такое не читают. Хочу видеть ЭКРАН, каким он был в задаче —
   как ученик ответил, зелёный/красный. Разбор — кратко внизу».
   Поэтому в момент проверки домашка снимает живой DOM задания (он УЖЕ покрашен
   check()-ом в зелёное/красное) и кладёт в `snap`. Разбор рисует этот снимок
   картинкой сверху, а текст разбора сворачивает до пары строк («ещё ▾»).
   Механику это не трогает: HwCore.snap() работает с любым заданием, потому что
   снимает то, что нарисовала сама механика.
*/
(function () {
  'use strict';

  var ENDPOINT = 'https://194-87-110-53.nip.io/hw-result';

  function qs(name, max) {
    var p = new URLSearchParams(location.search);
    return (p.get(name) || '').slice(0, max || 40);
  }

  /* ── ВХОД С САЙТА КЛАССА (?k=g9, D 23.09.2026) ────────────────────────────
     Ссылка с сайта класса одна на всех, личного ?u= в ней нет. Поэтому домашка
     один раз спрашивает имя и помнит его в этом телефоне. Токен = «класс-имя»:
     сервер по префиксу понимает, откуда ученик. Точку из имени выкидываем —
     она разделитель в коде разбора ?r=ник.id. */
  var KLASSY = { g9: '9 класс' };
  var klass = (function () {
    var k = qs('k', 8);
    return KLASSY[k] ? k : '';
  })();
  var klassName = '';

  function cleanName(s) {
    return String(s || '').replace(/[^A-Za-zА-Яа-яЁё \-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  }
  function nameKey() { return 'hw-core-name-' + klass; }
  function loadName() {
    try { return cleanName(localStorage.getItem(nameKey())); } catch (e) { return ''; }
  }
  function saveName(n) {
    try { localStorage.setItem(nameKey(), n); } catch (e) { /* без хранилища — спросим снова в следующий раз */ }
  }

  function askName() {
    var box = document.createElement('div');
    box.setAttribute('style', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(15,15,25,.72);padding:16px;font-family:system-ui,sans-serif');
    box.innerHTML =
      '<form style="background:#fff;color:#1c1917;border-radius:16px;padding:22px 20px;width:100%;max-width:340px;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.35)">' +
      '<div style="font-size:19px;font-weight:800;margin-bottom:6px">Как тебя зовут?</div>' +
      '<div style="font-size:14px;color:#57534e;margin-bottom:14px">Только имя — чтобы учитель увидел, что домашку решил ты.</div>' +
      '<input name="n" autocomplete="given-name" placeholder="Имя" style="width:100%;box-sizing:border-box;font-size:17px;' +
      'padding:11px 12px;border:2px solid #c7d2fe;border-radius:10px;outline:none">' +
      '<button type="submit" style="margin-top:12px;width:100%;font-size:17px;font-weight:700;padding:12px;border:0;' +
      'border-radius:10px;background:#4f46e5;color:#fff">Начать</button></form>';
    var form = box.querySelector('form'), input = box.querySelector('input');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = cleanName(input.value);
      if (n.length < 2) { input.style.borderColor = '#dc2626'; input.focus(); return; }
      klassName = n; saveName(n);
      box.remove();
    });
    document.body.appendChild(box);
    setTimeout(function () { input.focus(); }, 50);
  }

  if (klass && !qs('u') && !qs('id') && !qs('r')) {
    klassName = loadName();
    if (!klassName) {
      if (document.body) askName();
      else document.addEventListener('DOMContentLoaded', askName);
    }
  }

  /** Ник ученика (?u=), а со ссылки класса — «класс-имя». Пусто → ничего не отправляем
      (аноним/превью — старые ссылки безопасны). */
  function token() {
    var p = new URLSearchParams(location.search);
    var u = (p.get('u') || p.get('id') || '').slice(0, 40);
    if (u) return u;
    return klass && klassName ? (klass + '-' + klassName).slice(0, 40) : '';
  }

  /** Код разбора (?r=ник.id) — Ди открывает конкретную попытку ученика. */
  function reviewCode() { return qs('r', 60); }

  /* ── СНИМОК ЗАДАНИЯ ───────────────────────────────────────────────────────
     Клонируем узел механики уже ПОСЛЕ проверки (значит, с зелёным/красным),
     обезвреживаем и отдаём HTML. Обезвредить обязательно: снимок живёт рядом с
     настоящим заданием на одной странице, и его id/инпуты иначе конфликтуют. */
  var SNAP_MAX = 24000;   // на одно задание; чертёж-SVG обычно 1–4 КБ
  var SNAP_BUDGET = 140000; // на всю попытку — чтобы отчёт не разбухал в БД

  function snap(el) {
    if (!el) return '';
    var c;
    try { c = el.cloneNode(true); } catch (e) { return ''; }
    // id — прочь (дубли на странице), обработчики не клонируются сами.
    c.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    if (c.removeAttribute) c.removeAttribute('id');
    // Поля ввода — в статичный текст: снимок не должен выглядеть кликабельным.
    c.querySelectorAll('input, textarea').forEach(function (n) {
      var v = document.createElement('span');
      v.className = 'snap-val';
      v.textContent = n.value || '';
      n.parentNode.replaceChild(v, n);
    });
    c.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    var html = c.outerHTML || '';
    return html.length > SNAP_MAX ? '' : html;   // слишком тяжёлый — падаем на текст
  }

  /** detail — сам разбор: по нему ?r= воссоздаёт, что ученик сделал на каждом шаге.
      Без detail у Ди нет ссылки на разбор — показывать нечего. */
  function buildDetail(results) {
    var spent = 0;
    return (results || []).map(function (r, i) {
      var s = (r && r.snap) || '';
      if (spent + s.length > SNAP_BUDGET) s = '';   // бюджет вышел — дальше без снимков
      else spent += s.length;
      return {
        n: i + 1,
        label: r ? r.label : 'Шаг ' + (i + 1),
        diff: r ? r.diff : '',
        ok: !!(r && r.correct),
        wrong: (r && r.wrong) || [],
        feedback: r ? r.feedback : null,
        cond: (r && r.cond) || '',
        image: (r && r.image) || '',
        pick: r ? r.pick : undefined,
        answer: r ? r.answer : undefined,
        snap: s,
      };
    });
  }

  /* ── ДОСТАВКА ОТЧЁТА (починено 23.09.2026) ─────────────────────────────────
     Было: fetch с keepalive и молчаливым .catch. У keepalive потолок 64 КБ, а отчёт
     со снимками графиков весит ~140 КБ — браузер отказывал сразу, ошибку глотали,
     экран писал «✅ отправлено». Домашки по графикам не доходили с августа.
     Стало: keepalive только для маленьких отчётов; отчёт лежит в очереди
     (localStorage), пока сервер не ответит 200; ученик видит честный статус и
     кнопку «Отправить ещё раз»; недошедшее досылается при следующем открытии. */
  var PENDING_KEY = 'hw-core-pending';
  var KEEPALIVE_MAX = 30000;   // символов; кириллица в UTF-8 вдвое тяжелее — запас до 64 КБ

  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function savePending(list) {
    try {
      if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-3)));
      else localStorage.removeItem(PENDING_KEY);
    } catch (e) { /* хранилище полное/закрыто — отчёт живёт только в этой вкладке */ }
  }

  function post(body) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: body.length < KEEPALIVE_MAX,
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  // Плашка статуса внизу экрана. Пока отчёт не подтверждён сервером, прячем
  // «✅ Результат уже отправлен» из app.js (.send-note) — он не должен врать.
  function setStatus(state) {
    var root = document.documentElement;
    root.classList.toggle('hw-send-wait', state !== 'ok' && state !== 'none');
    if (!document.getElementById('hw-send-css')) {
      var st = document.createElement('style');
      st.id = 'hw-send-css';
      st.textContent = '.hw-send-wait .send-note{display:none!important}';
      document.head.appendChild(st);
    }
    var bar = document.getElementById('hw-send-bar');
    if (state === 'none') { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'hw-send-bar';
      bar.setAttribute('style', 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99998;max-width:460px;' +
        'margin:0 auto;padding:12px 14px;border-radius:14px;font:15px/1.45 system-ui,sans-serif;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.3);color:#1c1917');
      document.body.appendChild(bar);
    }
    if (state === 'sending') {
      bar.style.background = '#e0e7ff';
      bar.innerHTML = '⏳ Отправляю результат учителю…';
    } else if (state === 'ok') {
      bar.style.background = '#dcfce7';
      bar.innerHTML = '✅ Результат у учителя';
      setTimeout(function () { if (bar.parentNode) bar.remove(); }, 4000);
    } else {
      bar.style.background = '#fee2e2';
      bar.innerHTML = '<div style="margin-bottom:8px">⚠️ <b>Результат не дошёл до учителя.</b> ' +
        'Проверь интернет, выключи VPN и нажми кнопку.</div>' +
        '<button type="button" style="width:100%;padding:11px;border:0;border-radius:10px;' +
        'background:#dc2626;color:#fff;font:600 15px system-ui,sans-serif">🔁 Отправить ещё раз</button>';
      bar.querySelector('button').onclick = function () { flush(true); };
    }
  }

  var flushing = false, again = false, againShow = false;
  // Досылаем всю очередь. show — рисовать ли плашку (на этой странице есть свой отчёт).
  function flush(show) {
    if (flushing) { again = true; againShow = againShow || show; return; }
    var list = loadPending();
    if (!list.length) { if (show) setStatus('none'); return; }
    flushing = true;
    if (show) setStatus('sending');
    var sent = [];
    var chain = Promise.resolve();
    list.forEach(function (body) {
      chain = chain.then(function () {
        return post(body).then(function (ok) { if (ok) sent.push(body); });
      });
    });
    chain.then(function () {
      flushing = false;
      // Перечитываем очередь: пока слали, могли добавить новый отчёт — его не теряем.
      var left = loadPending().filter(function (b) { return sent.indexOf(b) < 0; });
      savePending(left);
      if (again) { var s = againShow || show; again = againShow = false; flush(s); return; }
      if (show) setStatus(left.length ? 'fail' : 'ok');
    });
  }

  /** Отправка итога репетитору (#38). true = отчёт принят в доставку (очередь). */
  function report(o) {
    var tok = token();
    if (!tok) return false;                       // без ?u= не шлём никогда
    if (o.devMode && !o.allowSend) return false;  // dev-прогон не засоряет отчёты
    var errors = [];
    (o.results || []).forEach(function (r, i) {
      if (r && !r.correct) errors.push('№' + (i + 1) + ' ' + r.label);
    });
    var body;
    try {
      body = JSON.stringify({
        token: tok,
        hw: o.hw,
        hw_id: o.hw_id,
        // Свой адрес — чтобы ссылку на разбор не приходилось прописывать руками
        // на сервере под каждую новую домашку (D, 06.08: «надо это всегда вшивать»).
        // Сервер этому не верит на слово: пускает только свой github.io-домен.
        hw_url: location.origin + location.pathname,
        score: o.score,
        total: o.total,
        errors: errors,
        detail: buildDetail(o.results),
        started_at: o.startedAt || null,
        duration_sec: o.durationSec != null ? o.durationSec : null,
      });
    } catch (e) { return false; }
    var list = loadPending();
    list.push(body);
    savePending(list);
    if (!loadPending().length) {
      // хранилище недоступно — шлём напрямую, без очереди
      setStatus('sending');
      post(body).then(function (ok) { setStatus(ok ? 'ok' : 'fail'); });
      return true;
    }
    flush(true);
    return true;
  }

  // Открыли любую домашку — досылаем то, что не дошло в прошлый раз.
  // Плашку показываем, только если недошедший отчёт — от этой самой страницы.
  (function resendOnOpen() {
    if (reviewCode()) return;
    var here = location.origin + location.pathname;
    var mine = loadPending().some(function (b) {
      try { return JSON.parse(b).hw_url === here; } catch (e) { return false; }
    });
    var go = function () { flush(mine); };
    if (document.body) setTimeout(go, 800);
    else document.addEventListener('DOMContentLoaded', function () { setTimeout(go, 800); });
  })();

  /* Строка ответа в разборе — «твой выбор» / «правильный». Формат взят из входного
     теста ОГЭ (rvRow), где Ди его и видел; теперь он общий для домашек и тестов. */
  function ansRow(text, kind) {
    var mk = kind === 'right' ? '✅' : kind === 'yours-ok' ? '✅' : '✖';
    var cls = kind === 'yours-bad' ? 'bad' : 'ok';
    var tag = kind === 'right' ? 'правильный'
            : kind === 'yours-ok' ? 'твой · верно' : 'твой ответ';
    return '<div class="rev-ans ' + cls + '" style="display:flex;align-items:center;gap:8px;'
      + 'padding:8px 11px;margin-bottom:6px;border-radius:10px;font-size:13px;line-height:1.5;'
      + 'background:' + (cls === 'bad' ? 'rgba(244,63,94,.08)' : 'rgba(74,222,128,.09)') + ';'
      + 'border:1px solid ' + (cls === 'bad' ? 'rgba(244,63,94,.22)' : 'rgba(74,222,128,.22)') + '">'
      + '<span>' + mk + '</span><span style="flex:1">' + text + '</span>'
      + '<span style="font-size:10.5px;opacity:.65;white-space:nowrap">' + tag + '</span></div>';
  }

  /** Карточки разбора — ЕДИНЫЙ формат для всех веб-ДЗ и тестов:
        СНИМОК задания (как ученик видел, с зелёным/красным) → твой ответ /
        правильный → короткий разбор (полный — по «ещё ▾»).
      Раскрывается по тапу (не только ошибки — верные тоже, Ди смотрит любое задание).
      helpers: { fmtInline, renderFeedback } — как рисовать математику, у каждой ДЗ своё.
      Поля задачи: { label, diff, ok/correct, snap, cond, image, pick, answer, wrong[], feedback } */
  function revItemsHtml(items, helpers) {
    var fmt = (helpers && helpers.fmtInline) || function (s) { return s; };
    var fb = (helpers && helpers.renderFeedback) || function () { return ''; };
    return (items || []).map(function (r, i) {
      var ok = !!(r.correct !== undefined ? r.correct : r.ok);

      // Условие — одной приглушённой строкой над снимком: напомнить, о чём шла речь.
      var cond = r.cond ? '<p class="rev-cond">' + fmt(r.cond) + '</p>' : '';
      // Снимок — главное. Он уже несёт и чертёж, и выбор ученика в цвете.
      var snapHtml = r.snap ? '<div class="rev-snap">' + r.snap + '</div>' : '';
      // Файл-картинка (старые задания без снимка) — как было.
      var image = (!r.snap && r.image) ? '<div class="rev-fig" style="margin:0 0 10px"><img src="'
        + r.image + '" alt="чертёж" style="max-width:100%;border-radius:10px"></div>' : '';

      // Ответы: что дал ученик и что верно. Если механика их не отдала — падаем на
      // строки wrong[] (старый вид), чтобы разбор не пустовал.
      var ans = '';
      // Со снимком строка «твой ответ» на ВЕРНОМ задании — дубль: на картинке уже
      // видно, что выбрано, и заголовок зелёный. На ошибке оставляем обе строки.
      var skipPick = !!r.snap && ok;
      if (!skipPick && r.pick !== undefined && r.pick !== null && r.pick !== '') {
        ans += ansRow(fmt(String(r.pick)), ok ? 'yours-ok' : 'yours-bad');
      }
      if (!ok && r.answer !== undefined && r.answer !== null && r.answer !== '') {
        ans += ansRow(fmt(String(r.answer)), 'right');
      }
      if (!ans && (r.wrong || []).length) {
        ans = '<div class="rev-wrong-line" style="padding:9px 12px;margin-bottom:10px;'
          + 'border-radius:12px;background:rgba(244,63,94,.08);border:1px solid rgba(244,63,94,.2);'
          + 'font-size:13px;line-height:1.7">'
          + r.wrong.map(function (w) { return fmt(w); }).join('<br>') + '</div>';
      }

      // Разбор — свёрнут до пары строк. Простыня текста внутри разбора и была
      // жалобой D: смысл сохраняем, но она больше не встречает ученика стеной.
      var razbor = fb(r.feedback);
      razbor = razbor
        ? '<div class="rev-razbor">'
          + '<div class="rev-razbor-label">Разбор</div>'
          + '<div class="rev-fb clamp">' + razbor + '</div>'
          + '<button type="button" class="rev-more">ещё ▾</button>'
          + '</div>'
        : '';

      return ''
        + '<div class="rev-item ' + (ok ? 'ok' : 'bad') + '" data-i="' + i + '">'
        +   '<div class="rev-head">'
        +     '<span class="rev-mark">' + (ok ? '✅' : '❌') + '</span>'
        +     '<span class="rev-title">' + (r.label || ('Шаг ' + (i + 1))) + '</span>'
        +     '<span class="rev-diff">' + (r.diff || '') + '</span>'
        +     '<span class="rev-toggle">показать ▾</span>'
        +   '</div>'
        +   '<div class="rev-body">' + cond + snapHtml + image + ans + razbor + '</div>'
        + '</div>';
    }).join('');
  }

  /* Раскрываем ЛЮБОЕ задание, не только ошибочное: Ди смотрит и верные («что она
     ответила?»). В CSS домашек у верных тоглер спрятан (`.rev-item.ok .rev-toggle`)
     — стиль доносим из движка, чтобы не править index.html каждой домашки. */
  var _cssDone = false;
  function ensureCss() {
    if (_cssDone) return;
    _cssDone = true;
    var s = document.createElement('style');
    s.textContent = [
      '.rev-head{cursor:pointer!important}',
      '.rev-item.ok .rev-toggle{display:inline!important}',
      /* Условие — тихая подпись над снимком, а не абзац для чтения. */
      '.rev-cond{font-size:12.5px;line-height:1.55;margin:0 0 9px;opacity:.62}',
      /* Снимок задания. Смотреть можно, трогать нечего — он мёртвый. */
      '.rev-snap{position:relative;margin:0 0 10px;padding:10px;border-radius:12px;',
      'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);',
      'pointer-events:none;user-select:none}',
      '.rev-snap *{pointer-events:none!important;cursor:default!important}',
      '.rev-snap svg{max-width:100%;height:auto}',
      '.rev-snap img{max-width:100%;height:auto}',
      '.rev-snap .snap-val{font-family:var(--lk-mono,monospace);font-weight:700}',
      /* Разбор свёрнут до ~3 строк, полный — по «ещё». */
      '.rev-razbor{margin-top:10px}',
      '.rev-fb.clamp{max-height:78px;overflow:hidden;',
      '-webkit-mask-image:linear-gradient(#000 46px,transparent);mask-image:linear-gradient(#000 46px,transparent)}',
      '.rev-more{margin-top:4px;padding:0;background:none;border:0;cursor:pointer;',
      'font-family:var(--lk-mono,monospace);font-size:11px;color:var(--lk-accent,#7C6CF0);opacity:.85}',
      '.rev-razbor.open .rev-fb.clamp{max-height:none;-webkit-mask-image:none;mask-image:none}',
    ].join('');
    document.head.appendChild(s);
  }

  /* Короткий разбор не прячем, если он и так короткий: кнопка «ещё» появляется
     только когда текст реально обрезан. Иначе на каждом задании висит пустышка. */
  function tuneRazbor(root) {
    root.querySelectorAll('.rev-razbor').forEach(function (rz) {
      var fbEl = rz.querySelector('.rev-fb');
      var btn = rz.querySelector('.rev-more');
      if (!fbEl || !btn) return;
      if (fbEl.scrollHeight <= fbEl.clientHeight + 4) {
        fbEl.classList.remove('clamp');
        btn.remove();
        return;
      }
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = rz.classList.toggle('open');
        btn.textContent = open ? 'свернуть ▴' : 'ещё ▾';
      });
    });
  }

  function bindToggles(root) {
    ensureCss();
    root.querySelectorAll('.rev-item .rev-head').forEach(function (head) {
      head.addEventListener('click', function () {
        var item = head.closest('.rev-item');
        var open = item.classList.toggle('open');
        var tg = item.querySelector('.rev-toggle');
        if (tg) tg.textContent = open ? 'скрыть ▴' : 'показать ▾';
        // Обрезку меряем после раскрытия: в скрытом блоке высоты нулевые.
        if (open) tuneRazbor(item);
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

  /* ── ТАП-ОТКЛИК: живой отклик на КАЖДОЕ нажатие (D, 05.08) ──────────────────
     До этого домашка отвечала только на «Проверить»: выбрал вариант — тишина,
     ткнул фишку — тишина. D: «хочу, чтобы анимация была на всё, что можно нажать».
     Поэтому отклик живёт в движке, а не в каждой домашке: подключил hw-core —
     получил отклик на всех кнопках, полях и фишках, включая старые ДЗ.

     Как звучит: короткий мягкий блип, синтезируется WebAudio (файл не нужен —
     ноль веса, работает офлайн). Подряд идущие тапы идут ВВЕРХ по пентатонике —
     набираешь «лесенку», пауза сбрасывает. Победа/ошибка остаются мелодиями-
     файлами: блип их не перебивает (он в 6 раз тише и в 10 раз короче).

     Отдельно `soft`: кнопки-вердикты («Проверить») получают только звук и
     подсветку самой кнопки — полноэкранная вспышка не нужна, через миг придёт
     своя, зелёная или красная. Выключить всё: window.HW_NO_TAPFX = true. */

  var TAP_STEPS = [0, 2, 4, 7, 9, 12, 14, 16];   // пентатоника от C5 — не бывает фальши
  var _ac = null, _pitchStep = 0, _pitchAt = 0, _lastTapAt = 0;

  function actx() {
    if (_ac) return _ac;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { _ac = new AC(); } catch (e) { _ac = null; }
    return _ac;
  }

  /** Короткий блип. kind: 'tap' (обычный) · 'soft' (тише, для вердикт-кнопок). */
  function blip(kind) {
    var ctx = actx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }

    var now = ctx.currentTime;
    // Лесенка: тапы в пределах 2.5 с идут вверх, дальше — с начала.
    if (now - _pitchAt > 2.5) _pitchStep = 0;
    _pitchAt = now;
    var semi = TAP_STEPS[_pitchStep % TAP_STEPS.length];
    _pitchStep++;

    var soft = kind === 'soft';
    var freq = 523.25 * Math.pow(2, semi / 12);
    var dur = soft ? 0.05 : 0.085;
    var vol = soft ? 0.045 : 0.075;

    function voice(f, v, type) {
      var osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.97, now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(v, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(now); osc.stop(now + dur + 0.02);
    }
    voice(freq, vol, 'triangle');
    voice(freq * 2, vol * 0.28, 'sine');      // октавой выше, еле слышно — «стеклянность»
  }

  var _fxCss = false;
  function ensureFxCss() {
    if (_fxCss) return;
    _fxCss = true;
    var s = document.createElement('style');
    s.textContent = [
      /* Слой вспышки тапа. Тот же приём, что у .lk-flash-*, но короче и мягче:
         это «дыхание» интерфейса, а не вердикт. */
      '.lk-flash-tap{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:0;',
      'background:radial-gradient(120% 78% at 50% 100%,rgba(168,85,247,.30),transparent 68%)}',
      '.lk-flash-tap.is-on{animation:lk-tap-fx .26s ease-out}',
      '@keyframes lk-tap-fx{0%{opacity:0}20%{opacity:.85}100%{opacity:0}}',
      /* Сам элемент тоже отвечает — микро-нажатие под пальцем. */
      '.lk-tapped{animation:lk-tap-press .17s ease-out}',
      '@keyframes lk-tap-press{0%{transform:scale(1)}42%{transform:scale(.955)}100%{transform:scale(1)}}',
      '@media (prefers-reduced-motion:reduce){.lk-flash-tap.is-on,.lk-tapped{animation:none}}',
    ].join('');
    document.head.appendChild(s);
  }

  function tapLayer() {
    var el = document.getElementById('lk-fx-tap');
    if (el) return el;
    ensureFxCss();
    el = document.createElement('div');
    el.id = 'lk-fx-tap';
    el.className = 'lk-flash lk-flash-tap';
    document.body.appendChild(el);
    return el;
  }

  function tapFlash() {
    var el = tapLayer();
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  function pressPulse(el) {
    if (!el || !el.classList) return;
    if (el.ownerSVGElement) return;   // линию чертежа не «вжимаем» — scale в SVG едет от угла

    ensureFxCss();
    el.classList.remove('lk-tapped');
    void el.offsetWidth;
    el.classList.add('lk-tapped');
    el.addEventListener('animationend', function () { el.classList.remove('lk-tapped'); }, { once: true });
  }

  /** Отклик на нажатие: вспышка фона + блип + микро-нажатие элемента.
      opts: { soft: true } — без полноэкранной вспышки (кнопки-вердикты). */
  function tap(el, opts) {
    if (fx.enabled === false) return;
    opts = opts || {};
    var now = Date.now();
    if (now - _lastTapAt < 45) return;        // защита от дубля pointerdown+click
    _lastTapAt = now;
    if (!opts.soft) tapFlash();
    pressPulse(el);
    blip(opts.soft ? 'soft' : 'tap');
  }

  /* Что считаем «нажимаемым». Кнопки, поля, фишки-корзины, ручки чертежа.
     Явно выключить на элементе: data-notap. Явно включить: data-tap. */
  var TAP_SEL = 'button,[role="button"],input,select,textarea,label,summary,'
    + '[data-tap],[data-handle],[data-bin],.bn-bin,.lk-btn,.lk-hint-btn';

  function tapTarget(node) {
    if (!node || !node.closest) return null;
    if (node.closest('.rev-snap')) return null;           // снимок в разборе — мёртвый
    if (node.closest('[data-notap]')) return null;
    var el = node.closest(TAP_SEL);
    if (!el || el.disabled) return null;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return null;
    return el;
  }

  function isSoft(el) {
    return !!(el.dataset && el.dataset.tap === 'soft')
      || /(^|\s)(check-btn|reset-btn|rd-yes|rd-no)(\s|$)/.test(el.className || '');
  }

  function onDown(e) {
    var el = tapTarget(e.target);
    if (!el) return;
    tap(el, { soft: isSoft(el) });
  }

  // Печать цифры в поле — тоже нажатие (D: «когда вводишь какую-то цифру»).
  function onKey(e) {
    var t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) return;
    if (e.key && e.key.length === 1) blip('soft');
  }

  var _bound = false;
  function bindTaps(root) {
    if (_bound) return;
    _bound = true;
    fx.bound = true;                 // видно снаружи: движок ведёт отклик сам
    var r = root || document;
    r.addEventListener('pointerdown', onDown, true);
    r.addEventListener('keydown', onKey, true);
  }

  var fx = {
    enabled: true,
    bound: false,
    tap: tap,
    blip: blip,
    flash: tapFlash,
    bindTaps: bindTaps,
    resetPitch: function () { _pitchStep = 0; },
  };

  // Автоподключение: любая страница с hw-core получает отклик без правок app.js.
  // Кроме тех, где отклик УЖЕ сделан своими руками (ДЗ П2 «Счёт углов» — своя
  // функция `tapFx` и свой слушатель на document): иначе на каждый тап звучало бы
  // два щелчка разом. Своё всегда главнее — движок молча уступает.
  // Проверяем ПОСЛЕ загрузки app.js (иначе своей tapFx на этот момент ещё нет).
  function maybeBind() {
    if (window.HW_NO_TAPFX) return;
    if (typeof window.tapFx === 'function') return;
    bindTaps();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', maybeBind);
  else maybeBind();

  window.HwCore = {
    ENDPOINT: ENDPOINT,
    token: token,
    reviewCode: reviewCode,
    report: report,
    snap: snap,
    revItemsHtml: revItemsHtml,
    bindToggles: bindToggles,
    showReview: showReview,
    unlockAudio: unlockAudio,
    playSound: playSound,
    fx: fx,
  };
})();
