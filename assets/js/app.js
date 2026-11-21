/* =========================================================
   Ремонт квартир под ключ — калькулятор сметы и формы
   Данные: assets/js/data.js (из рабочей таблицы заказчика)
   ========================================================= */
(function () {
  "use strict";

  var DATA = window.SITE_DATA;
  if (!DATA) { console.error("SITE_DATA не загружены"); return; }

  var WORKS = DATA.works;
  var MATERIALS = DATA.materials;
  var SECTIONS = DATA.sections;
  var PRESETS = DATA.presets;

  var WORK_BY_CODE = {};
  WORKS.forEach(function (w) { WORK_BY_CODE[w.code] = w; });

  var CITY_LABEL = { ekb: "Екатеринбург", pv: "Первоуральск" };
  var AUTO_LABEL = { G: "площадь пола", H: "площадь потолка", I: "площадь стен", N: "плинтус", K: "двери", J: "периметр" };

  var state = {
    city: "ekb",
    preset: "turnkey",
    step: 1,
    rooms: [
      { name: "Гостиная", len: 6.2, wid: 4.4, hgt: 2.7, doorArea: 1.6, winArea: 2.4, doorCount: 1, doorWidth: 0.9, winCount: 1 }
    ],
    selected: new Set(),
    volumes: {},      // объёмы ручных работ (заполняются автоматически, правятся вручную)
    derived: new Set(), // объёмы, рассчитанные из замера (пересчитываются при изменении замера)
    matPrices: {}
  };

  /* ---------- утилиты ---------- */
  var nf = new Intl.NumberFormat("ru-RU");
  function money(v) { return nf.format(Math.round(v || 0)) + " ₽"; }
  function num(v, d) {
    var n = Number(v);
    if (!isFinite(n)) return "0";
    return n.toLocaleString("ru-RU", { maximumFractionDigits: d == null ? 2 : d });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- замер ---------- */
  function measure() {
    var m = { area: 0, perimeter: 0, walls: 0, plinth: 0, doors: 0, windows: 0 };
    state.rooms.forEach(function (r) {
      var len = Number(r.len) || 0, wid = Number(r.wid) || 0, h = Number(r.hgt) || 0;
      var per = 2 * (len + wid);
      m.area += len * wid;
      m.perimeter += per;
      m.walls += Math.max(0, per * h - (Number(r.doorArea) || 0) - (Number(r.winArea) || 0));
      m.plinth += Math.max(0, per - (Number(r.doorWidth) || 0));
      m.doors += Number(r.doorCount) || 0;
      m.windows += Number(r.winCount) || 0;
    });
    m.area = Math.round(m.area * 100) / 100;
    m.perimeter = Math.round(m.perimeter * 100) / 100;
    m.walls = Math.round(m.walls * 100) / 100;
    m.plinth = Math.round(m.plinth * 100) / 100;
    return m;
  }

  function autoVolume(work, m) {
    if (!work.auto) return null;
    if (work.auto === "G") return m.area;
    if (work.auto === "H") return m.area;
    if (work.auto === "I") return m.walls;
    if (work.auto === "N") return m.plinth;
    if (work.auto === "K") return m.doors;
    if (work.auto === "J") return m.perimeter;
    return null;
  }

  /* объём по умолчанию для ручных работ: подставляется по единице измерения */
  function defaultVolume(work, m) {
    var u = work.unit;
    if (u === "м²" || u === "м² пола" || u === "м²/см") {
      var s = work.section || "";
      if (s.indexOf("Стены") === 0 || s.indexOf("Потолки") === 0) return m.walls;
      if (s.indexOf("Плиточные") === 0) return /стен/i.test(work.name) ? m.walls : m.area;
      return m.area;
    }
    if (u === "пог. м") return m.perimeter;
    if (u === "м³") return Math.round(m.area * 0.02 * 100) / 100;
    if (u === "шт.") {
      if (/створк|окон|окн/i.test(work.name)) return m.windows;
      if (/двер/i.test(work.name)) return m.doors;
    }
    return 1;
  }

  function volumeOf(work, m) {
    if (work.auto) {
      var v = state.volumes[work.code];
      if (v !== undefined && v !== "" && isFinite(Number(v))) return Number(v);
      return autoVolume(work, m) || 0;
    }
    var manual = state.volumes[work.code];
    if (manual !== undefined && manual !== "" && isFinite(Number(manual))) return Number(manual);
    return defaultVolume(work, m);
  }

  function ensureVolume(work, m) {
    if (work.auto) return;
    if (state.volumes[work.code] === undefined) {
      state.volumes[work.code] = defaultVolume(work, m);
      state.derived.add(work.code);
    }
  }

  function refreshDerived(m) {
    state.derived.forEach(function (code) {
      var w = WORK_BY_CODE[code];
      if (!w) return;
      state.volumes[code] = defaultVolume(w, m);
    });
  }

  function priceOf(work) {
    return state.city === "pv" ? Number(work.pv) || 0 : Number(work.ekb) || 0;
  }

  function selectedWorks() {
    return WORKS.filter(function (w) { return state.selected.has(w.code); });
  }

  function worksTotal(m) {
    return selectedWorks().reduce(function (s, w) { return s + volumeOf(w, m) * priceOf(w); }, 0);
  }

  /* ---------- материалы ---------- */
  function materialsCalc(m) {
    var out = [];
    MATERIALS.forEach(function (mat) {
      var trig = (mat.triggers || []).filter(function (c) { return state.selected.has(c); });
      if (!trig.length) return;
      var vols = trig.map(function (c) { return volumeOf(WORK_BY_CODE[c], m); });
      var agg = mat.agg === "MAX" ? Math.max.apply(null, vols) : vols.reduce(function (a, b) { return a + b; }, 0);
      if (!(agg > 0)) return;
      var layers = Number(mat.layers) || 1;
      var stock = Number(mat.stock) || 0;
      var pack = Number(mat.pack) || 1;
      var need = agg * (Number(mat.norm) || 0) * layers * (1 + stock);
      var packs = Math.ceil(need / pack);
      var price = Number(state.matPrices[mat.code]) || 0;
      out.push({
        code: mat.code, name: mat.name, section: mat.section, unit: mat.unit,
        agg: agg, need: need, pack: pack, packs: packs, buy: packs * pack,
        price: price, cost: packs * price, hasPrice: !!price
      });
    });
    return out;
  }

  function materialsTotal(mats) {
    return mats.reduce(function (s, x) { return s + x.cost; }, 0);
  }

  /* ---------- рендер: замер ---------- */
  function renderMeasureTotals() {
    var host = $("#measureTotals");
    if (!host) return;
    var m = measure();
    host.innerHTML =
      '<div><dt>Площадь пола</dt><dd>' + num(m.area) + ' м²</dd></div>' +
      '<div><dt>Площадь стен</dt><dd>' + num(m.walls) + ' м²</dd></div>' +
      '<div><dt>Периметр</dt><dd>' + num(m.perimeter) + ' пог. м</dd></div>' +
      '<div><dt>Плинтус</dt><dd>' + num(m.plinth) + ' пог. м</dd></div>' +
      '<div><dt>Двери / окна</dt><dd>' + num(m.doors) + ' / ' + num(m.windows) + ' шт.</dd></div>';
  }

  function renderRooms() {
    var host = $("#rooms");
    if (!host) return;
    host.innerHTML = state.rooms.map(function (r, i) {
      return '' +
        '<div class="room" data-room="' + i + '">' +
          '<div class="room__head">' +
            '<strong>Помещение ' + (i + 1) + '</strong>' +
            '<button type="button" class="room__del" data-del-room="' + i + '">Удалить</button>' +
          '</div>' +
          '<div class="room__grid">' +
            roomField("Название", "name", r.name, "text", "напр. Кухня") +
            roomField("Длина, м", "len", r.len, "number", "6,2") +
            roomField("Ширина, м", "wid", r.wid, "number", "4,4") +
            roomField("Высота, м", "hgt", r.hgt, "number", "2,7") +
            roomField("Двери, м²", "doorArea", r.doorArea, "number", "1,6") +
            roomField("Окна, м²", "winArea", r.winArea, "number", "2,4") +
            roomField("Дверей, шт.", "doorCount", r.doorCount, "number", "1") +
            roomField("Окон, шт.", "winCount", r.winCount, "number", "1") +
            roomField("Ширина проёмов, м", "doorWidth", r.doorWidth, "number", "0,9") +
          '</div>' +
        '</div>';
    }).join("");
    renderMeasureTotals();
  }

  function roomField(label, key, value, type, ph) {
    return '<label class="field-inline"><span>' + esc(label) + '</span>' +
      '<input type="' + type + '" data-room-field="' + key + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '"' +
      (type === "number" ? ' step="0.1" min="0" inputmode="decimal"' : '') + '></label>';
  }

  /* ---------- рендер: работы ---------- */
  var workFilter = "";

  function renderWorks() {
    var host = $("#works");
    if (!host) return;
    var scrollTop = host.scrollTop;
    var m = measure();
    var f = workFilter.trim().toLowerCase();

    var html = "";
    SECTIONS.forEach(function (sec) {
      var list = WORKS.filter(function (w) { return w.section === sec; });
      var visible = f ? list.filter(function (w) {
        return (w.name + " " + w.code).toLowerCase().indexOf(f) !== -1;
      }) : list;
      if (!visible.length) return;
      var selCount = list.filter(function (w) { return state.selected.has(w.code); }).length;
      html += '<div class="work-group' + (selCount ? " is-open" : "") + '">' +
        '<button type="button" class="work-group__head" data-toggle-group>' +
          '<span class="work-group__name">' + esc(sec) + '</span>' +
          '<span class="work-group__meta">' + list.length + ' работ' + (selCount ? ' · выбрано ' + selCount : '') + '</span>' +
          '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="work-group__body">' + visible.map(function (w) { return workRow(w, m); }).join("") + '</div>' +
      '</div>';
    });
    host.innerHTML = html || '<p class="mat-empty">Ничего не найдено. Измените запрос.</p>';
    host.scrollTop = scrollTop;
    updateWorksCount();
  }

  function workRow(w, m) {
    var checked = state.selected.has(w.code);
    var price = priceOf(w);
    var auto = autoVolume(w, m);
    var val = state.volumes[w.code];
    var inputVal = val !== undefined && val !== "" ? val : (auto != null ? auto : defaultVolume(w, m));
    return '<div class="work" data-code="' + esc(w.code) + '">' +
      '<label class="work__check"><input type="checkbox"' + (checked ? " checked" : "") + ' aria-label="' + esc(w.name) + '"></label>' +
      '<div class="work__body">' +
        '<div class="work__name">' + esc(w.name) + ' <span class="work__code">' + esc(w.code) + '</span></div>' +
        '<div class="work__meta">' + money(price) + ' / ' + esc(w.unit) + (w.auto ? ' · объём по замеру' : '') + '</div>' +
        (checked ? '<div class="work__vol"><input type="number" min="0" step="0.1" data-vol="' + esc(w.code) + '" value="' + esc(inputVal) + '" aria-label="Объём: ' + esc(w.name) + '"><span>' + esc(w.unit) + '</span></div>' : '') +
      '</div>' +
      '<div class="work__sum">' + (checked ? money(volumeOf(w, m) * price) : '') + '</div>' +
    '</div>';
  }

  function updateWorksCount() {
    var el = $("#worksCount");
    if (el) el.textContent = "Выбрано " + state.selected.size + " из " + WORKS.length;
  }

  /* ---------- рендер: материалы ---------- */
  function renderMaterials() {
    var host = $("#materials");
    if (!host) return;
    var m = measure();
    var mats = materialsCalc(m);
    var note = $("#matNote");
    if (!mats.length) {
      host.innerHTML = '<p class="mat-empty">Материалы появятся, когда на шаге 3 будут выбраны работы, к которым они привязаны.</p>';
      if (note) note.style.display = "none";
      return;
    }
    if (note) note.style.display = "";
    host.innerHTML = '<table class="mat-table"><thead><tr>' +
      '<th>Материал</th><th class="num">К закупке</th><th class="num">Цена упаковки, ₽</th><th class="num">Стоимость</th>' +
      '</tr></thead><tbody>' +
      mats.map(function (x) {
        return '<tr>' +
          '<td><strong>' + esc(x.name) + '</strong><br><small>' + esc(x.section) + ' · ' + num(x.need, 1) + ' ' + esc(x.unit) + ' по норме</small></td>' +
          '<td class="num">' + num(x.buy) + ' ' + esc(x.unit) + '<br><small>' + x.packs + ' × ' + num(x.pack) + ' ' + esc(x.unit) + '</small></td>' +
          '<td class="num"><input type="number" min="0" step="1" data-mat="' + esc(x.code) + '" value="' + (x.price || "") + '" placeholder="0"></td>' +
          '<td class="num" data-cost="' + esc(x.code) + '">' + (x.hasPrice ? money(x.cost) : '<span class="mat-noprice">—</span>') + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody></table>';
  }

  /* ---------- рендер: смета ---------- */
  function renderEstimate() {
    var host = $("#estimate");
    if (!host) return;
    var m = measure();
    var sel = selectedWorks();
    if (!sel.length) {
      host.innerHTML = '<p class="mat-empty">Работы не выбраны. Вернитесь на шаг 3 или выберите готовый набор на шаге 1.</p>';
      return;
    }
    var bySec = {};
    sel.forEach(function (w) { (bySec[w.section] = bySec[w.section] || []).push(w); });

    var html = "";
    SECTIONS.forEach(function (sec) {
      var list = bySec[sec];
      if (!list) return;
      var sub = list.reduce(function (s, w) { return s + volumeOf(w, m) * priceOf(w); }, 0);
      html += '<div class="est-group">' +
        '<div class="est-group__head"><span>' + esc(sec) + '</span><span>' + money(sub) + '</span></div>' +
        list.map(function (w) {
          return '<div class="est-row">' +
            '<span>' + esc(w.name) + '<br><small>' + esc(w.code) + ' · ' + num(volumeOf(w, m)) + ' ' + esc(w.unit) + ' × ' + money(priceOf(w)) + '</small></span>' +
            '<span class="num">' + money(volumeOf(w, m) * priceOf(w)) + '</span>' +
          '</div>';
        }).join("") +
      '</div>';
    });

    var mats = materialsCalc(m);
    var mTotal = materialsTotal(mats);
    var mKnown = mats.some(function (x) { return x.hasPrice; });
    var wTotal = worksTotal(m);

    html += '<div class="est-total"><span>Работы по смете</span><span>' + money(wTotal) + '</span></div>';
    html += '<div class="est-total est-total--mat"><span>Материалы<small>' + (mKnown ? "по введённым ценам" : "цены не заданы — считаются только объёмы") + '</small></span><span>' + (mKnown ? money(mTotal) : "—") + '</span></div>';
    if (mKnown) {
      html += '<div class="est-total est-total--grand"><span>Итого<small>работы + материалы</small></span><span>' + money(wTotal + mTotal) + '</span></div>';
    }
    host.innerHTML = html;
  }

  /* ---------- рендер: сводка ---------- */
  function renderSummary() {
    var m = measure();
    var mats = materialsCalc(m);
    var wTotal = worksTotal(m);
    var mTotal = materialsTotal(mats);
    var mKnown = mats.some(function (x) { return x.hasPrice; });
    var total = wTotal + (mKnown ? mTotal : 0);

    setText("#factArea", num(m.area) + " м²");
    setText("#factCost", money(wTotal));
    setText("#factWorks", String(state.selected.size));
    setText("#sumCity", CITY_LABEL[state.city]);
    setText("#sumArea", num(m.area) + " м²");
    setText("#sumWorks", money(wTotal));
    setText("#sumMaterials", mKnown ? money(mTotal) : "—");
    setText("#sumTotal", money(total));
    setText("#sumSub", mKnown ? "работы + материалы" : "работы, без материалов");

    var bar = $("#summaryBar");
    if (bar) bar.style.width = Math.round(state.step / 5 * 100) + "%";
    var stepLabel = $("#summaryStep");
    if (stepLabel) stepLabel.textContent = "Шаг " + state.step + " из 5";
  }

  function setText(sel, txt) {
    var el = $(sel);
    if (el) el.textContent = txt;
  }

  function updateDependents() {
    renderMeasureTotals();
    renderMaterials();
    renderEstimate();
    renderSummary();
  }

  function updateAll() {
    refreshDerived(measure());
    renderWorks();
    updateDependents();
  }

  /* ---------- шаги ---------- */
  function goStep(n) {
    state.step = Math.max(1, Math.min(5, n));
    $$(".calc__panel").forEach(function (p) {
      p.classList.toggle("is-active", Number(p.getAttribute("data-panel")) === state.step);
    });
    $$(".calc__steps li").forEach(function (li) {
      var i = Number(li.getAttribute("data-step"));
      li.classList.toggle("is-active", i === state.step);
      li.classList.toggle("is-done", i < state.step);
    });
    var prev = $("#prevStep");
    if (prev) prev.style.visibility = state.step === 1 ? "hidden" : "visible";
    var next = $("#nextStep");
    if (next) next.textContent = state.step === 5 ? "К форме заявки" : "Далее";
    renderSummary();
    var top = $("#calculator");
    if (top && state.step > 1) {
      var y = top.getBoundingClientRect().top + window.pageYOffset - 20;
      if (window.pageYOffset > y + 200) window.scrollTo({ top: y, behavior: "smooth" });
    }
  }

  /* ---------- пресеты ---------- */
  function applyPreset(key) {
    state.preset = key;
    state.selected = new Set(PRESETS[key] || []);
    state.volumes = {};
    state.derived = new Set();
    var m = measure();
    state.selected.forEach(function (code) {
      var w = WORK_BY_CODE[code];
      if (w) ensureVolume(w, m);
    });
    $$(".preset").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-preset") === key);
    });
    var note = $("#presetNote");
    if (note) note.textContent = "Набор «" + presetName(key) + "»: " + state.selected.size + " видов работ. Объёмы подставлены по замеру, их можно поправить на шаге 3.";
    updateAll();
  }

  function presetName(key) {
    return { light: "Косметический", capital: "Капитальный", turnkey: "Под ключ" }[key] || key;
  }

  /* ---------- формы ---------- */
  var FORM_ENDPOINT = "https://formsubmit.co/ajax/proremontekb@gmail.com";

  function phoneDigits(v) { return String(v || "").replace(/\D/g, ""); }

  function formatPhone(v) {
    var d = phoneDigits(v);
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] !== "7") d = "7" + d;
    d = d.slice(0, 11);
    var out = "+7";
    if (d.length > 1) out += " (" + d.slice(1, 4);
    if (d.length >= 4) out += ")";
    if (d.length > 4) out += " " + d.slice(4, 7);
    if (d.length > 7) out += "-" + d.slice(7, 9);
    if (d.length > 9) out += "-" + d.slice(9, 11);
    return out;
  }

  function collect(form) {
    var o = {};
    $$("input,select,textarea", form).forEach(function (el) {
      if (!el.name) return;
      o[el.name] = el.type === "checkbox" ? (el.checked ? "да" : "нет") : el.value;
    });
    return o;
  }

  function estimateText() {
    var m = measure();
    var lines = [];
    lines.push("Замер: площадь " + num(m.area) + " м², стены " + num(m.walls) + " м², периметр " + num(m.perimeter) + " пог. м.");
    lines.push("Город: " + CITY_LABEL[state.city] + ". Работ в смете: " + state.selected.size + ".");
    lines.push("");
    var bySec = {};
    selectedWorks().forEach(function (w) { (bySec[w.section] = bySec[w.section] || []).push(w); });
    SECTIONS.forEach(function (sec) {
      var list = bySec[sec];
      if (!list) return;
      lines.push("[" + sec + "]");
      list.forEach(function (w) {
        lines.push("  " + w.code + " " + w.name + " — " + num(volumeOf(w, m)) + " " + w.unit + " × " + money(priceOf(w)) + " = " + money(volumeOf(w, m) * priceOf(w)));
      });
    });
    lines.push("");
    lines.push("Работы: " + money(worksTotal(m)));
    var mats = materialsCalc(m);
    var mKnown = mats.some(function (x) { return x.hasPrice; });
    if (mKnown) lines.push("Материалы: " + money(materialsTotal(mats)));
    lines.push("Материалы (количество):");
    mats.forEach(function (x) { lines.push("  " + x.name + " — " + num(x.buy) + " " + x.unit); });
    return lines.join("\n");
  }

  function submitForm(form, statusEl, extra) {
    var nameEl = form.querySelector('[name="name"]');
    var phoneEl = form.querySelector('[name="phone"]');
    var ok = true;
    [nameEl, phoneEl].forEach(function (el) {
      if (!el) return;
      var wrap = el.closest(".field-inline");
      var bad = el === nameEl ? el.value.trim().length < 2 : phoneDigits(el.value).length < 11;
      if (wrap) wrap.classList.toggle("is-error", bad);
      if (bad) ok = false;
    });
    if (!ok) {
      if (statusEl) { statusEl.textContent = "Проверьте имя и телефон — телефон нужен полностью."; statusEl.className = "form-status is-error"; }
      return;
    }
    var data = collect(form);
    if (extra) Object.keys(extra).forEach(function (k) { data[k] = extra[k]; });
    var btn = form.querySelector('button[type="submit"]');
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Отправляем…"; }
    if (statusEl) { statusEl.textContent = "Отправляем заявку…"; statusEl.className = "form-status"; }

    fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json().then(function (j) {
        var ok = j && (j.success === "true" || j.success === true);
        if (!ok) throw new Error((j && j.message) || "endpoint");
        return j;
      });
    }).then(function () {
      if (statusEl) { statusEl.textContent = "Заявка отправлена. Свяжемся с вами в рабочее время."; statusEl.className = "form-status is-ok"; }
      form.reset();
      var consent = form.querySelector('[name="consent"]');
      if (consent) consent.checked = true;
    }).catch(function () {
      if (statusEl) {
        statusEl.innerHTML = 'Не удалось отправить автоматически. Напишите нам: <a href="mailto:proremontekb@gmail.com">proremontekb@gmail.com</a> или позвоните <a href="tel:+79028783111">+7 (902) 878-31-11</a>.';
        statusEl.className = "form-status is-error";
      }
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = old; }
    });
  }

  /* ---------- модальное окно ---------- */
  function openModal(title) {
    var modal = $("#modal");
    if (!modal) return;
    var t = $("#modalTitle");
    if (t) t.textContent = title || "Заказать звонок";
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    var first = modal.querySelector("input");
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function closeModal() {
    var modal = $("#modal");
    if (!modal) return;
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  /* ---------- инициализация ---------- */
  function init() {
    renderRooms();
    applyPreset("turnkey");

    // шаги
    $$(".calc__steps li").forEach(function (li) {
      li.addEventListener("click", function () { goStep(Number(li.getAttribute("data-step"))); });
    });
    var next = $("#nextStep");
    if (next) next.addEventListener("click", function () {
      if (state.step === 5) {
        var lead = $("#calculator .calc__lead");
        if (lead) lead.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      goStep(state.step + 1);
    });
    var prev = $("#prevStep");
    if (prev) prev.addEventListener("click", function () { goStep(state.step - 1); });

    // город
    $$('input[name="city"]').forEach(function (r) {
      r.addEventListener("change", function () {
        state.city = r.value;
        updateDependents();
        renderWorks();
      });
    });

    // пресеты
    $$(".preset").forEach(function (b) {
      b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); });
    });

    // замер
    var rooms = $("#rooms");
    if (rooms) {
      rooms.addEventListener("input", function (e) {
        var el = e.target.closest("[data-room-field]");
        if (!el) return;
        var card = el.closest("[data-room]");
        var idx = Number(card.getAttribute("data-room"));
        var key = el.getAttribute("data-room-field");
        state.rooms[idx][key] = key === "name" ? el.value : (el.value === "" ? "" : Number(el.value));
        refreshDerived(measure());
        renderWorks();
        updateDependents();
      });
      rooms.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-del-room]");
        if (!btn) return;
        if (state.rooms.length <= 1) return;
        state.rooms.splice(Number(btn.getAttribute("data-del-room")), 1);
        renderRooms();
        refreshDerived(measure());
        renderWorks();
        updateDependents();
      });
    }
    var addRoom = $("#addRoom");
    if (addRoom) addRoom.addEventListener("click", function () {
      state.rooms.push({ name: "Помещение " + (state.rooms.length + 1), len: 3, wid: 3, hgt: 2.7, doorArea: 1.6, winArea: 1.5, doorCount: 1, doorWidth: 0.9, winCount: 1 });
      renderRooms();
      refreshDerived(measure());
      renderWorks();
      updateDependents();
    });

    // работы
    var works = $("#works");
    if (works) {
      works.addEventListener("click", function (e) {
        var head = e.target.closest("[data-toggle-group]");
        if (!head) return;
        var group = head.closest(".work-group");
        if (group) group.classList.toggle("is-open");
      });
      works.addEventListener("change", function (e) {
        var cb = e.target.closest('input[type="checkbox"]');
        if (!cb) return;
        var row = cb.closest(".work");
        var code = row.getAttribute("data-code");
        var w = WORK_BY_CODE[code];
        if (cb.checked) {
          state.selected.add(code);
          ensureVolume(w, measure());
        } else {
          state.selected.delete(code);
        }
        renderWorks();
        updateDependents();
      });
      works.addEventListener("input", function (e) {
        var inp = e.target.closest("[data-vol]");
        if (!inp) return;
        var code = inp.getAttribute("data-vol");
        var v = inp.value === "" ? "" : Number(inp.value);
        state.volumes[code] = v;
        state.derived.delete(code);
        var row = inp.closest(".work");
        var sum = row ? row.querySelector(".work__sum") : null;
        if (sum) sum.textContent = money(Number(v) * priceOf(WORK_BY_CODE[code]));
        renderMaterials();
        renderEstimate();
        renderSummary();
      });
    }
    var search = $("#workSearch");
    if (search) search.addEventListener("input", function () {
      workFilter = search.value;
      renderWorks();
    });
    var clear = $("#clearWorks");
    if (clear) clear.addEventListener("click", function () {
      state.selected.clear();
      state.volumes = {};
      state.derived = new Set();
      $$(".preset").forEach(function (b) { b.classList.remove("is-active"); });
      renderWorks();
      updateDependents();
    });

    // материалы — цены
    var mats = $("#materials");
    if (mats) mats.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-mat]");
      if (!inp) return;
      var code = inp.getAttribute("data-mat");
      state.matPrices[code] = inp.value === "" ? 0 : Number(inp.value);
      var cell = mats.querySelector('[data-cost="' + code + '"]');
      if (cell) {
        var m = measure();
        var row = materialsCalc(m).filter(function (x) { return x.code === code; })[0];
        cell.innerHTML = row && row.hasPrice ? money(row.cost) : '<span class="mat-noprice">—</span>';
      }
      renderEstimate();
      renderSummary();
    });

    // формы
    var leadForm = $("#leadForm");
    if (leadForm) leadForm.addEventListener("submit", function (e) {
      e.preventDefault();
      submitForm(leadForm, $("#leadStatus"), { "Смета": estimateText() });
    });
    var measureForm = $("#measureForm");
    if (measureForm) measureForm.addEventListener("submit", function (e) {
      e.preventDefault();
      submitForm(measureForm, $("#measureStatus"));
    });
    var callbackForm = $("#callbackForm");
    if (callbackForm) callbackForm.addEventListener("submit", function (e) {
      e.preventDefault();
      submitForm(callbackForm, $("#callbackStatus"));
    });

    // маска телефона
    $$('input[type="tel"]').forEach(function (inp) {
      inp.addEventListener("input", function () { inp.value = formatPhone(inp.value); });
      inp.addEventListener("focus", function () { if (!inp.value) inp.value = "+7 ("; });
    });

    // модалка
    $$("[data-open-modal]").forEach(function (b) {
      b.addEventListener("click", function () { openModal(b.getAttribute("data-open-modal") === "callback" ? "Заказать звонок" : "Бесплатный замер"); });
    });
    $$("[data-close-modal]").forEach(function (b) { b.addEventListener("click", closeModal); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    // кнопка в сводке
    var toLead = $("#toLead");
    if (toLead) toLead.addEventListener("click", function () { goStep(5); });

    // мобильное меню
    var burger = $("#burger");
    var nav = $("#nav");
    if (burger && nav) {
      var setNav = function (open) {
        nav.classList.toggle("is-open", open);
        burger.setAttribute("aria-expanded", open ? "true" : "false");
      };
      burger.addEventListener("click", function () {
        setNav(!nav.classList.contains("is-open"));
      });
      nav.addEventListener("click", function (e) {
        if (e.target.closest("a")) setNav(false);
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && nav.classList.contains("is-open")) setNav(false);
      });
      window.addEventListener("resize", function () {
        if (window.innerWidth > 980 && nav.classList.contains("is-open")) setNav(false);
      });
    }

    // «залипающий» хедер
    var header = $("#header");
    if (header) {
      var onScroll = function () {
        header.classList.toggle("is-stuck", window.scrollY > 8);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    goStep(1);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
