/* =========================================================
   Ремонт квартир и частных домов — форма замеров и
   предварительный расчёт по рабочей смете
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

  var CITY_LABEL = { ekb: "Екатеринбург", pv: "Первоуральск", revda: "Ревда" };
  var OBJECT_LABEL = { flat: "Квартира", house: "Частный дом" };
  var PRESET_LABEL = { light: "Косметический", capital: "Капитальный", turnkey: "Под ключ" };

  function newRoom(n) {
    return {
      name: "Помещение " + n,
      len: 6.2, wid: 4.4, hgt: 2.7,
      doorCount: 1, doorWidth: 0.9, doorHeight: 2.1,
      winCount: 1, winWidth: 1.4, winHeight: 1.5
    };
  }

  var state = {
    city: "ekb",
    object: "flat",
    preset: "turnkey",
    step: 1,
    rooms: [newRoom(1)],
    selected: new Set(),
    volumes: {},
    derived: new Set()
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
  var r2 = function (x) { return Math.round(x * 100) / 100; };

  /* ---------- замер ---------- */
  function measure() {
    var m = { area: 0, perimeter: 0, walls: 0, plinth: 0, doors: 0, windows: 0, doorArea: 0, winArea: 0, doorWidthSum: 0 };
    state.rooms.forEach(function (r) {
      var len = Number(r.len) || 0, wid = Number(r.wid) || 0, h = Number(r.hgt) || 0;
      var per = 2 * (len + wid);
      var dc = Number(r.doorCount) || 0, dw = Number(r.doorWidth) || 0, dh = Number(r.doorHeight) || 0;
      var wc = Number(r.winCount) || 0, ww = Number(r.winWidth) || 0, wh = Number(r.winHeight) || 0;
      var dArea = dc * dw * dh;
      var wArea = wc * ww * wh;
      m.area += len * wid;
      m.perimeter += per;
      m.doorArea += dArea;
      m.winArea += wArea;
      m.walls += Math.max(0, per * h - dArea - wArea);
      m.doorWidthSum += dc * dw;
      m.plinth += Math.max(0, per - dc * dw);
      m.doors += dc;
      m.windows += wc;
    });
    ["area", "perimeter", "walls", "plinth", "doorArea", "winArea", "doorWidthSum"].forEach(function (k) { m[k] = r2(m[k]); });
    return m;
  }

  function autoVolume(work, m) {
    if (!work.auto) return null;
    if (work.auto === "G" || work.auto === "H") return m.area;
    if (work.auto === "I") return m.walls;
    if (work.auto === "N") return m.plinth;
    if (work.auto === "K") return m.doors;
    if (work.auto === "J") return m.perimeter;
    return null;
  }

  /* объём по умолчанию для работ без авто-объёма */
  function defaultVolume(work, m) {
    var u = work.unit;
    if (u === "м²" || u === "м² пола" || u === "м²/см") {
      var s = work.section || "";
      if (s.indexOf("Стены") === 0 || s.indexOf("Потолки") === 0) return m.walls;
      if (s.indexOf("Плиточные") === 0) return /стен/i.test(work.name) ? m.walls : m.area;
      return m.area;
    }
    if (u === "пог. м") return m.perimeter;
    if (u === "м³") return r2(m.area * 0.02);
    if (u === "шт.") {
      if (/створк|окон|окн/i.test(work.name)) return m.windows;
      if (/двер/i.test(work.name)) return m.doors;
    }
    return 1;
  }

  function volumeOf(work, m) {
    var v = state.volumes[work.code];
    if (v !== undefined && v !== "" && isFinite(Number(v))) return Number(v);
    if (work.auto) return autoVolume(work, m) || 0;
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
      if (w) state.volumes[code] = defaultVolume(w, m);
    });
  }

  function priceOf(work) {
    // для Ревды используем прайс Первоуральска
    return (state.city === "ekb") ? (Number(work.ekb) || 0) : (Number(work.pv) || 0);
  }

  function selectedWorks() {
    return WORKS.filter(function (w) { return state.selected.has(w.code); });
  }

  function worksTotal(m) {
    return selectedWorks().reduce(function (s, w) { return s + volumeOf(w, m) * priceOf(w); }, 0);
  }

  /* материалы — нужны только для письма менеджеру */
  function materialsCalc(m) {
    var out = [];
    MATERIALS.forEach(function (mat) {
      var trig = (mat.triggers || []).filter(function (c) { return state.selected.has(c); });
      if (!trig.length) return;
      var vols = trig.map(function (c) { return volumeOf(WORK_BY_CODE[c], m); });
      var agg = mat.agg === "MAX" ? Math.max.apply(null, vols) : vols.reduce(function (a, b) { return a + b; }, 0);
      if (!(agg > 0)) return;
      var need = agg * (Number(mat.norm) || 0) * (Number(mat.layers) || 1) * (1 + (Number(mat.stock) || 0));
      var pack = Number(mat.pack) || 1;
      out.push({ name: mat.name, unit: mat.unit, need: need, packs: Math.ceil(need / pack), pack: pack, buy: Math.ceil(need / pack) * pack });
    });
    return out;
  }

  /* ---------- рендер: замер ---------- */
  function renderRooms() {
    var host = $("#rooms");
    if (!host) return;
    host.innerHTML = state.rooms.map(function (r, i) {
      return '' +
        '<div class="room" data-room="' + i + '">' +
          '<div class="room__head">' +
            '<strong>Помещение ' + (i + 1) + '</strong>' +
            (state.rooms.length > 1 ? '<button type="button" class="room__del" data-del-room="' + i + '">Удалить</button>' : '') +
          '</div>' +
          '<div class="room__grid room__grid--place">' +
            field("Название", "name", r.name, "text", "Кухня") +
            field("Длина, м", "len", r.len, "number", "6,2") +
            field("Ширина, м", "wid", r.wid, "number", "4,4") +
            field("Высота, м", "hgt", r.hgt, "number", "2,7") +
          '</div>' +
          '<div class="room__group">' +
            '<span class="room__group-title">Двери</span>' +
            '<div class="room__grid room__grid--3">' +
              field("Количество, шт.", "doorCount", r.doorCount, "number", "1") +
              field("Ширина, м", "doorWidth", r.doorWidth, "number", "0,9") +
              field("Высота, м", "doorHeight", r.doorHeight, "number", "2,1") +
            '</div>' +
          '</div>' +
          '<div class="room__group">' +
            '<span class="room__group-title">Окна</span>' +
            '<div class="room__grid room__grid--3">' +
              field("Количество, шт.", "winCount", r.winCount, "number", "1") +
              field("Ширина, м", "winWidth", r.winWidth, "number", "1,4") +
              field("Высота, м", "winHeight", r.winHeight, "number", "1,5") +
            '</div>' +
          '</div>' +
        '</div>';
    }).join("");
    renderMeasureTotals();
  }

  function field(label, key, value, type, ph) {
    return '<label class="field-inline"><span>' + esc(label) + '</span>' +
      '<input type="' + type + '" data-room-field="' + key + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '"' +
      (type === "number" ? ' step="0.1" min="0" inputmode="decimal"' : '') + '></label>';
  }

  function renderMeasureTotals() {
    var host = $("#measureTotals");
    if (!host) return;
    var m = measure();
    host.innerHTML =
      '<div><dt>Площадь пола / потолка</dt><dd>' + num(m.area) + ' м²</dd></div>' +
      '<div><dt>Площадь стен</dt><dd>' + num(m.walls) + ' м²</dd></div>' +
      '<div><dt>Периметр</dt><dd>' + num(m.perimeter) + ' пог. м</dd></div>' +
      '<div><dt>Плинтус</dt><dd>' + num(m.plinth) + ' пог. м</dd></div>' +
      '<div><dt>Двери</dt><dd>' + num(m.doors) + ' шт. · ' + num(m.doorArea) + ' м²</dd></div>' +
      '<div><dt>Окна</dt><dd>' + num(m.windows) + ' шт. · ' + num(m.winArea) + ' м²</dd></div>';
  }

  /* ---------- рендер: итог ---------- */
  function renderTotal() {
    var m = measure();
    var total = worksTotal(m);
    var set = function (id, txt) { var e = $(id); if (e) e.textContent = txt; };

    set("#totalSum", money(total));
    set("#totalMeta", CITY_LABEL[state.city] + " · " + (OBJECT_LABEL[state.object] || "").toLowerCase() + " · " + (PRESET_LABEL[state.preset] || "").toLowerCase());

    var chips = $("#totalSections");
    if (chips) {
      var bySec = {};
      selectedWorks().forEach(function (w) { bySec[w.section] = (bySec[w.section] || 0) + 1; });
      var html = "";
      SECTIONS.forEach(function (sec) {
        if (bySec[sec]) html += '<li>' + esc(sec) + ' <span>' + bySec[sec] + '</span></li>';
      });
      chips.innerHTML = html;
    }
  }

  /* ---------- рендер: сводка ---------- */
  function renderSummary() {
    var m = measure();
    var total = worksTotal(m);
    var set = function (id, txt) { var e = $(id); if (e) e.textContent = txt; };

    set("#sumTotal", money(total));
    set("#sumSub", "работы, без материалов");
    set("#sumCity", CITY_LABEL[state.city]);
    set("#sumObject", OBJECT_LABEL[state.object] || "Квартира");
    set("#sumArea", num(m.area) + " м²");
    set("#sumPreset", PRESET_LABEL[state.preset] || "—");
    set("#factArea", num(m.area) + " м²");
    set("#factCost", money(total));
    set("#factWorks", String(state.selected.size));
  }

  function updateDependents() {
    renderMeasureTotals();
    renderSummary();
    renderTotal();
  }

  function updateAll() {
    refreshDerived(measure());
    updateDependents();
  }

  /* ---------- шаги ---------- */
  function goStep(n) {
    state.step = Math.max(1, Math.min(3, n));
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
    if (next) next.textContent = state.step === 3 ? "К форме заявки" : "Далее";
    renderSummary();
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
    if (note) note.textContent = "Набор «" + (PRESET_LABEL[key] || key) + "»: " + state.selected.size + " видов работ. Состав — в предварительном расчёте.";
    updateAll();
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
    lines.push("Объект: " + (OBJECT_LABEL[state.object] || "") + ", " + CITY_LABEL[state.city] + ".");
    lines.push("Тип ремонта: " + (PRESET_LABEL[state.preset] || "") + " (" + state.selected.size + " видов работ).");
    lines.push("Замер: площадь " + num(m.area) + " м², стены " + num(m.walls) + " м², периметр " + num(m.perimeter) + " пог. м, плинтус " + num(m.plinth) + " пог. м.");
    lines.push("Проёмы: двери " + m.doors + " шт. (" + num(m.doorArea) + " м²), окна " + m.windows + " шт. (" + num(m.winArea) + " м²).");
    state.rooms.forEach(function (r, i) {
      lines.push("  " + (i + 1) + ". " + (r.name || "помещение") + ": " + num(r.len) + "×" + num(r.wid) + "×" + num(r.hgt) + " м; двери " + r.doorCount + "×" + num(r.doorWidth) + "×" + num(r.doorHeight) + "; окна " + r.winCount + "×" + num(r.winWidth) + "×" + num(r.winHeight) + ".");
    });
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
    lines.push("Работы (предварительно): " + money(worksTotal(m)));
    var mats = materialsCalc(m);
    if (mats.length) {
      lines.push("Материалы (количество, без цен):");
      mats.forEach(function (x) { lines.push("  " + x.name + " — " + num(x.buy) + " " + x.unit); });
    }
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
    if (statusEl) { statusEl.textContent = "Отправляем замер…"; statusEl.className = "form-status"; }

    fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json().then(function (j) {
        if (!(j && (j.success === "true" || j.success === true))) throw new Error((j && j.message) || "endpoint");
        return j;
      });
    }).then(function () {
      if (statusEl) { statusEl.textContent = "Замер отправлен. Свяжемся с вами в рабочее время."; statusEl.className = "form-status is-ok"; }
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

    $$(".calc__steps li").forEach(function (li) {
      li.addEventListener("click", function () { goStep(Number(li.getAttribute("data-step"))); });
    });
    var next = $("#nextStep");
    if (next) next.addEventListener("click", function () {
      if (state.step === 3) {
        var lead = $("#calculator .calc__lead");
        if (lead) lead.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      goStep(state.step + 1);
    });
    var prev = $("#prevStep");
    if (prev) prev.addEventListener("click", function () { goStep(state.step - 1); });

    $$('input[name="city"]').forEach(function (r) {
      r.addEventListener("change", function () { state.city = r.value; updateDependents(); });
    });
    $$('input[name="object"]').forEach(function (r) {
      r.addEventListener("change", function () { state.object = r.value; updateDependents(); });
    });
    $$(".preset").forEach(function (b) {
      b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); });
    });

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
        updateDependents();
      });
      rooms.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-del-room]");
        if (!btn || state.rooms.length <= 1) return;
        state.rooms.splice(Number(btn.getAttribute("data-del-room")), 1);
        renderRooms();
        refreshDerived(measure());
        updateDependents();
      });
    }
    var addRoom = $("#addRoom");
    if (addRoom) addRoom.addEventListener("click", function () {
      var r = newRoom(state.rooms.length + 1);
      r.len = 3; r.wid = 3; r.winWidth = 1.2; r.winHeight = 1.4;
      state.rooms.push(r);
      renderRooms();
      refreshDerived(measure());
      updateDependents();
    });

    var leadForm = $("#leadForm");
    if (leadForm) leadForm.addEventListener("submit", function (e) {
      e.preventDefault();
      submitForm(leadForm, $("#leadStatus"), { "Замер": estimateText() });
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

    $$('input[type="tel"]').forEach(function (inp) {
      inp.addEventListener("input", function () { inp.value = formatPhone(inp.value); });
      inp.addEventListener("focus", function () { if (!inp.value) inp.value = "+7 ("; });
    });

    $$("[data-open-modal]").forEach(function (b) {
      b.addEventListener("click", function () { openModal(b.getAttribute("data-open-modal") === "callback" ? "Заказать звонок" : "Бесплатный замер"); });
    });
    $$("[data-close-modal]").forEach(function (b) { b.addEventListener("click", closeModal); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    var toLead = $("#toLead");
    if (toLead) toLead.addEventListener("click", function () { goStep(3); });

    var burger = $("#burger");
    var nav = $("#nav");
    if (burger && nav) {
      var setNav = function (open) {
        nav.classList.toggle("is-open", open);
        burger.setAttribute("aria-expanded", open ? "true" : "false");
      };
      burger.addEventListener("click", function () { setNav(!nav.classList.contains("is-open")); });
      nav.addEventListener("click", function (e) { if (e.target.closest("a")) setNav(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("is-open")) setNav(false); });
      window.addEventListener("resize", function () { if (window.innerWidth > 980 && nav.classList.contains("is-open")) setNav(false); });
    }

    var header = $("#header");
    if (header) {
      var onScroll = function () { header.classList.toggle("is-stuck", window.scrollY > 8); };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    goStep(1);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
