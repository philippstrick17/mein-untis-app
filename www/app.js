(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const WEEKDAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

  const state = {
    loggedIn: false,
    status: null,
    settings: null,
    weekStart: null,
    selected: null,
    schedule: null,
    mySubjects: new Set(),
    courseQuery: "",
    homework: [],
    hwOpen: false,
    mobile: window.matchMedia("(max-width: 860px)").matches,
  };

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);

  const fmtMin = (min) => {
    min = Number(min);
    if (!Number.isFinite(min)) return "--:--";
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const parseISODate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const toISO = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const todayISO = () => toISO(new Date());

  const addDays = (d, n) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  const isoWeekLabel = () => {
    const base = new Date(state.weekStart);
    base.setDate(base.getDate() + 3);
    const jan1 = new Date(base.getFullYear(), 0, 1);
    const week = Math.ceil((((base - jan1) / 86400000) + jan1.getDay() + 1) / 7);
    const end = addDays(state.weekStart, 6);
    const p2 = (n) => String(n).padStart(2, "0");
    return `KW ${week} · Heute, ${p2(state.weekStart.getDate())}.${p2(state.weekStart.getMonth() + 1)}. – ${p2(end.getDate())}.${p2(end.getMonth() + 1)}.${end.getFullYear()}`;
  };

  const subjectHue = (name) => {
    let hash = 0;
    for (const ch of String(name)) hash = (hash + ch.charCodeAt(0)) * 31;
    return Math.abs(hash) % 360;
  };

  const api = window.LocalAPI;

  let toastTimer = null;
  function toast(message, kind) {
    const el = $("#toast");
    el.textContent = message;
    el.dataset.kind = kind || "";
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), kind ? 6000 : 3200);
  }

  function loginError(message) {
    const el = $("#loginError");
    el.textContent = message;
    el.hidden = false;
  }

  async function loadStatus() {
    state.status = await api.get("/api/status");
    state.loggedIn = state.status.logged_in;
    updateDots();
  }

  async function loadTimetable() {
    if (!state.loggedIn || !state.weekStart) return;
    $("#view").innerHTML = '<div class="empty">Lade Stundenplan…</div>';
    try {
      const data = await api.get(`/api/timetable?date=${toISO(state.weekStart)}&days=7`);
      state.schedule = data;
      const hasData = (iso) =>
        (data.days[iso] || []).length > 0 || ((data.freistunden || {})[iso] || []).length > 0;
      if (!state.selected || !hasData(state.selected)) {
        const t = todayISO();
        if (hasData(t)) {
          state.selected = t;
        } else {
          state.selected =
            Object.keys(data.days)
              .concat(Object.keys(data.freistunden || {}))
              .sort()
              .find(hasData) || t;
        }
      }
      renderView();
      $("#weekLabel").textContent = isoWeekLabel();
    } catch (err) {
      errorView(err.message);
      throw err;
    }
  }

  async function refresh() {
    try {
      await loadStatus();
      await loadTimetable();
      await loadHomework().catch(() => {});
    } catch (err) {
      toast(err.message, "err");
      errorView(err.message);
    }
  }

  function bindViewActions() {
    $$("#view [data-action]").forEach((el) =>
      el.addEventListener("click", () => {
        if (el.dataset.action === "retry") refresh().catch(() => {});
      })
    );
  }

  function errorView(message) {
    $("#view").innerHTML =
      `<div class="empty">Laden fehlgeschlagen: ${esc(message)}<br><br>` +
      `<button class="btn primary" data-action="retry">Erneut probieren</button></div>`;
    bindViewActions();
  }

  function updateDots() {
    const apiDot = $("#apiDot");
    const ntfyDot = $("#ntfyDot");
    if (!state.status) {
      apiDot.className = "status-dot err";
      ntfyDot.className = "status-dot";
      return;
    }
    apiDot.className = "status-dot " + (state.status.logged_in ? "ok" : "warn");
    const ntfy = state.status.ntfy;
    if (!ntfy.enabled || !ntfy.configured) {
      ntfyDot.className = "status-dot";
      ntfyDot.title = "Benachrichtigungen nicht konfiguriert";
      $("#ntfyDot").classList.add("warn");
    } else if (state.status.last_error) {
      ntfyDot.className = "status-dot err";
      ntfyDot.title = "Benachrichtigung: letzte Prüfung fehlgeschlagen";
    } else if (state.status.last_check) {
      ntfyDot.className = "status-dot ok";
      ntfyDot.title = "Benachrichtigungen aktiv – zuletzt geprüft: " + state.status.last_check;
    } else {
      ntfyDot.className = "status-dot ok";
      ntfyDot.title = "Benachrichtigungen aktiv";
    }
    if (state.status && state.status.school) $("#schoolName").textContent = state.status.school;
  }

  function lessonCard(l, top, height, mobile) {
    const hue = subjectHue(l.subject.short);
    const statusCls =
      l.status === "cancelled" ? "les--cancelled" : l.status === "substitution" ? "les--subst" : "les--normal";
    const badge =
      l.status === "cancelled" ? "entfällt" : l.status === "substitution" ? "Vertretung" : "";
    const meta = [];
    if (l.rooms && l.rooms.length) meta.push(l.rooms.join(", "));
    if (l.teachers && l.teachers.length) meta.push(l.teachers.join(", "));
    const hasHw = state.homework.some((h) => h.done === false && h.subject === l.subject.short);
    const style = mobile ? `--hue:${hue}` : `top:${top}px;height:${height}px;--hue:${hue}`;
    let html = `<div class="les ${statusCls}${mobile ? " mobile" : ""}" data-iso="${esc(l.date)}" data-sub="${esc(l.subject.short)}" data-open="1" style="${style}">`;
    html += `<div class="les-time">${fmtMin(l.start_time)}–${fmtMin(l.end_time)}</div>`;
    html += `<div class="les-sub">${esc(l.subject.short)}</div>`;
    if (l.subject.long) html += `<div class="les-name">${esc(l.subject.long)}</div>`;
    if (meta.length) html += `<div class="les-meta">${esc(meta.join(" · "))}</div>`;
    if (l.text) html += `<div class="les-text">${esc(l.text)}</div>`;
    else if (l.status === "substitution") html += `<div class="les-text">Verlegt auf ${fmtMin(l.start_time)}–${fmtMin(l.end_time)}</div>`;
    if (badge) html += `<div class="les-badge">${badge}</div>`;
    if (hasHw) html += `<div class="les-hw">✎ Hausaufgaben offen</div>`;
    html += `</div>`;
    return html;
  }

  function renderView() {
    const view = $("#view");
    if (!state.schedule) {
      view.innerHTML = `<div class="empty">Lade Stundenplan…</div>`;
      return;
    }
    if (state.hwOpen) renderHomework();
    else if (state.mobile) renderDayList();
    else renderGrid();
    bindViewActions();
  }

  function renderGrid() {
    const view = $("#view");
    const sched = state.schedule;
    const days = sched.days || {};
    const meta = sched.meta || {};
    let start = Math.min(480, meta.min_start || 480);
    let end = Math.max(1020, meta.max_end || 1020);
    const hph = 88;
    const bodyH = ((end - start) / 60) * hph;
    const hours = [];
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (let m = Math.floor(start / 60); m <= Math.floor(end / 60); m++) hours.push(m * 60);

    let html = `<div class="week-grid">`;
    html += `<div class="col col--time" style="--body-h:${bodyH}px"><div class="dayhead time-head"></div><div class="time-body">`;
    for (const m of hours) {
      html += `<div class="hour-label" style="top:${((m - start) / 60) * hph}px">${fmtMin(m)}</div>`;
    }
    html += `</div></div>`;

    for (let i = 0; i < 7; i++) {
      const date = addDays(state.weekStart, i);
      const iso = toISO(date);
      const lessons = days[iso] || [];
      const isToday = iso === todayISO();
      html += `<div class="col" style="--body-h:${bodyH}px">`;
      html += `<div class="dayhead${isToday ? " today" : ""}">${WEEKDAYS[date.getDay()]}<span>${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.</span></div>`;
      html += `<div class="daybody" style="height:${bodyH}px">`;
      for (const l of lessons) {
        const top = ((l.start_time - start) / 60) * hph;
        const height = Math.max(18, ((l.end_time - l.start_time) / 60) * hph - 3);
        html += lessonCard(l, top, height, false);
      }
      const freeSlots = (sched.freistunden || {})[iso] || [];
      for (const f of freeSlots) {
        const top = ((f.start_time - start) / 60) * hph;
        const height = Math.max(18, ((f.end_time - f.start_time) / 60) * hph - 3);
        html += `<div class="les les--free" style="top:${top}px;height:${height}px"><div class="les-time">${fmtMin(f.start_time)}–${fmtMin(f.end_time)}</div><div class="les-sub">${esc(f.text || "Freistunde")}</div></div>`;
      }
      if (isToday && nowMin >= start && nowMin < end) {
        html += `<div class="hour-label" style="top:${((nowMin - start) / 60) * hph}px;color:var(--accent);font-weight:800">» jetzt «</div>`;
      }
      if (!lessons.length && !freeSlots.length) html += `<div class="empty" style="padding-top:26px">–</div>`;
      html += `</div></div>`;
    }
    html += `</div>`;
    view.innerHTML = html;
  }

  function renderDayList() {
    const view = $("#view");
    const sched = state.schedule;
    const days = sched.days || {};
    const freistunden = sched.freistunden || {};

    const chips = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(state.weekStart, i);
      const iso = toISO(date);
      const has = (days[iso] || []).length > 0 || (freistunden[iso] || []).length > 0;
      chips.push(
        `<button class="chip ${iso === state.selected ? "active" : ""}${has ? " has" : ""}" data-iso="${iso}">${
          WEEKDAYS_LONG[date.getDay()].slice(0, 2)
        }<span>${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.</span></button>`
      );
    }

    let html = `<div class="daychips">${chips.join("")}</div>`;
    const lessons = days[state.selected] || [];
    const freeSlots = freistunden[state.selected] || [];
    const allItems = [
      ...lessons.map((l) => ({ ...l, _type: "lesson", _start: l.start_time })),
      ...freeSlots.map((f) => ({ _type: "free", start_time: f.start_time, end_time: f.end_time, text: f.text, _start: f.start_time })),
    ].sort((a, b) => a._start - b._start);
    if (!allItems.length) {
      html += `<div class="empty">Kein Unterricht – vermutlich schulfrei.</div>`;
    } else {
      html += `<div class="daylist">`;
      for (const item of allItems) {
        if (item._type === "free") {
          html += `<div class="les les--free mobile"><div class="les-time">${fmtMin(item.start_time)}–${fmtMin(item.end_time)}</div><div class="les-sub">${esc(item.text || "Freistunde")}</div></div>`;
        } else {
          html += lessonCard(item, 0, 0, true);
        }
      }
      html += `</div>`;
    }
    view.innerHTML = html;

    $$(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        state.selected = c.dataset.iso;
        renderView();
      })
    );
  }

  async function loadHomework() {
    if (!state.loggedIn) return;
    const data = await api.get("/api/homework");
    state.homework = data.homework || [];
  }

  function orderedSubjects() {
    const subjects = (state.schedule && state.schedule.subjects) || [];
    const mine = [];
    const other = [];
    for (const s of subjects) (state.mySubjects.has(s.short) ? mine : other).push(s);
    mine.sort((a, b) => String(a.short).localeCompare(String(b.short)));
    other.sort((a, b) => String(a.short).localeCompare(String(b.short)));
    return mine.concat(other);
  }

  function hwRow(h) {
    return `<div class="hw-row${h.done ? " done" : ""}">
      <input type="checkbox" class="hw-check" data-hw-id="${esc(h.id)}"${h.done ? " checked" : ""}>
      <div class="hw-body">
        <div class="hw-text">${esc(h.text)}</div>
        ${h.due ? `<div class="hw-due">Fällig: ${esc(h.due)}</div>` : ""}
      </div>
      <button class="hw-del" type="button" data-hw-del="${esc(h.id)}" aria-label="Löschen">✕</button>
    </div>`;
  }

  function courseSection(sub, items) {
    const open = items.filter((h) => h.done === false).length;
    let html = `<div class="hw-course"><div class="hw-course-head">`;
    html += `<div class="hw-course-title"><span class="hw-course-sub">${esc(sub.short)}</span>${sub.long ? `<span class="hw-course-name">${esc(sub.long)}</span>` : ""}</div>`;
    html += `<span class="hw-course-count">${open} offen</span>`;
    html += `</div><div class="hw-course-body">`;
    for (const h of items) html += hwRow(h);
    html += `</div></div>`;
    return html;
  }

  function renderHomework() {
    const view = $("#view");
    const ordered = orderedSubjects();
    let html = `<div class="hw-page">`;
    html += `<div class="hw-head"><h2>Hausaufgaben</h2><button class="btn ghost" type="button" data-action="back">Zurück zum Stundenplan</button></div>`;
    html += `<form id="hwForm" class="hw-form">`;
    if (state.mySubjects.size) {
      html += `<select id="hwSubject" aria-label="Fach">${
        ordered
          .filter((s) => state.mySubjects.has(s.short))
          .map((s) => `<option value="${esc(s.short)}">${esc(s.short)}</option>`)
          .join("")
      }</select><input id="hwText" placeholder="Aufgabe…" aria-label="Aufgabentext"><input id="hwDue" type="date" aria-label="Fälligkeitsdatum"><button class="btn primary" id="hwAdd" type="submit">Hinzufügen</button>`;
    } else {
      html += `<p class="hint">Wähle zuerst in den Einstellungen unter „Meine Kurse“ deine Kurse aus.</p>`;
    }
    html += `</form>`;
    html += `<div class="hw-list">`;
    const bySub = new Map();
    for (const h of state.homework) {
      if (!bySub.has(h.subject)) bySub.set(h.subject, []);
      bySub.get(h.subject).push(h);
    }
    if (!bySub.size) {
      html += `<div class="empty">Keine Hausaufgaben. Füge oben eine neue Aufgabe hinzu.</div>`;
    } else {
      const seen = new Set();
      for (const s of ordered) {
        const items = bySub.get(s.short);
        if (!items) continue;
        seen.add(s.short);
        html += courseSection(s, items);
      }
      for (const [sub, items] of bySub) {
        if (seen.has(sub)) continue;
        html += courseSection({ short: sub, long: "" }, items);
      }
    }
    html += `</div></div>`;
    view.innerHTML = html;
  }

  async function addHomework() {
    const sel = $("#hwSubject");
    if (!sel) return;
    const subject = sel.value;
    const text = $("#hwText").value.trim();
    if (!subject || !text) return;
    const due = $("#hwDue").value || undefined;
    try {
      await api.post("/api/homework", { subject, text, due });
      toast("Hausaufgabe hinzugefügt");
    } catch (err) {
      toast(err.message, "err");
      return;
    }
    await loadHomework();
    renderView();
  }

  async function toggleHomework(id, done) {
    try {
      await api.put(`/api/homework/${id}`, { done });
    } catch (err) {
      toast(err.message, "err");
      return;
    }
    await loadHomework();
    renderView();
  }

  async function deleteHomework(id) {
    try {
      await api.del(`/api/homework/${id}`);
    } catch (err) {
      toast(err.message, "err");
      return;
    }
    await loadHomework();
    renderView();
  }

  let overlaySubject = null;

  function closeLessonOverlay() {
    $("#lessonOverlay").hidden = true;
  }

  function openLessonDetail(subjectShort) {
    const sched = state.schedule;
    const days = (sched && sched.days) || {};
    const today = todayISO();
    let todayBest = null;
    let weekBest = null;
    for (const iso of Object.keys(days)) {
      for (const l of days[iso] || []) {
        if (l.subject.short !== subjectShort) continue;
        if (iso === today && (!todayBest || l.start_time < todayBest.start_time)) todayBest = l;
        if (!weekBest || l.start_time < weekBest.start_time) weekBest = l;
      }
    }
    const rep = todayBest || weekBest;
    const fallback = rep ? null : ((sched && sched.subjects) || []).find((s) => s.short === subjectShort);
    const longName = (rep && rep.subject.long) || (fallback && fallback.long) || "";
    overlaySubject = subjectShort;
    let html = `<div class="ov-title"><span class="ov-sub">${esc(subjectShort)}</span>${longName ? `<span class="ov-lang">${esc(longName)}</span>` : ""}</div>`;
    const info = [];
    if (rep) {
      info.push(["Zeit", `${fmtMin(rep.start_time)}–${fmtMin(rep.end_time)}`]);
      if (rep.rooms && rep.rooms.length) info.push(["Räume", rep.rooms.join(", ")]);
      if (rep.teachers && rep.teachers.length) info.push(["Lehrer", rep.teachers.join(", ")]);
    }
    if (info.length) {
      html += `<dl class="ov-info">`;
      for (const [k, v] of info) html += `<div class="ov-info-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
      html += `</dl>`;
    }
    html += `<h4>Hausaufgaben</h4>`;
    const items = state.homework.filter((h) => h.subject === subjectShort);
    if (!items.length) {
      html += `<div class="ov-empty">Keine Hausaufgaben für dieses Fach.</div>`;
    } else {
      html += `<div class="ov-list">`;
      for (const h of items) {
        html += `<div class="ov-row${h.done ? " done" : ""}"><input type="checkbox" data-ov-id="${esc(h.id)}"${h.done ? " checked" : ""}><div class="ov-body"><div class="ov-text">${esc(h.text)}</div>${h.due ? `<div class="ov-due">Fällig: ${esc(h.due)}</div>` : ""}</div><button class="hw-del" type="button" data-ov-del="${esc(h.id)}" aria-label="Löschen">✕</button></div>`;
      }
      html += `</div>`;
    }
    html += `<div class="ov-add"><input id="ovHwText" placeholder="Neue Aufgabe…" aria-label="Neue Aufgabe"><input id="ovHwDue" type="date" aria-label="Fälligkeitsdatum"><button class="btn primary" id="ovAdd" type="button">Hinzufügen</button></div>`;
    html += `<button class="btn ghost block" id="ovDone" type="button">Fertig</button>`;
    $("#overlayBody").innerHTML = html;
    $("#lessonOverlay").hidden = false;
    const txt = document.getElementById("ovHwText");
    if (txt) txt.focus({ preventScroll: true });
  }

  async function addOverlayHw() {
    const text = $("#ovHwText").value.trim();
    if (!text) return;
    const due = $("#ovHwDue").value || undefined;
    try {
      await api.post("/api/homework", { subject: overlaySubject, text, due });
      toast("Hausaufgabe hinzugefügt");
    } catch (err) {
      toast(err.message, "err");
      return;
    }
    await loadHomework();
    renderView();
    openLessonDetail(overlaySubject);
  }

  async function toggleOverlayHw(id, done) {
    try {
      await api.put(`/api/homework/${id}`, { done });
    } catch (err) {
      toast(err.message, "err");
      return;
    }
    await loadHomework();
    renderView();
    openLessonDetail(overlaySubject);
  }

  async function deleteOverlayHw(id) {
    try {
      await api.del(`/api/homework/${id}`);
    } catch (err) {
      toast(err.message, "err");
      return;
    }
    await loadHomework();
    renderView();
    openLessonDetail(overlaySubject);
  }

  async function saveMySubjects() {
    await api.post("/api/settings", { filter: { my_subjects: Array.from(state.mySubjects) } });
  }

  function renderCourseSelect() {
    const el = $("#courseSelect");
    const subjects = (state.schedule && state.schedule.subjects) || [];
    if (!subjects.length) {
      el.innerHTML = `<p class="hint">Noch keine Fächer geladen.</p>`;
      return;
    }
    const q = String(state.courseQuery || "").trim().toLowerCase();
    const filtered = q ? subjects.filter((s) => String(s.short).toLowerCase().includes(q) || String(s.long || "").toLowerCase().includes(q)) : subjects;
    let html = filtered
      .map(
        (s) =>
          `<label class="toggle-row${state.mySubjects.has(s.short) ? " on" : ""}"><input type="checkbox" data-sub="${esc(s.short)}" ${
            state.mySubjects.has(s.short) ? "checked" : ""
          }><span class="sub-name">${esc(s.short)}</span><span class="sub-long">${esc(s.long || "")} · ${
            s.count
          }×</span></label>`
      )
      .join("");
    if (q) {
      if (filtered.length) html += `<p class="hint">${filtered.length} von ${subjects.length} Kursen</p>`;
      else html += `<p class="hint">Keine Kurse gefunden.</p>`;
    }
    el.innerHTML = html;
    $$("#courseSelect input").forEach((inp) =>
      inp.addEventListener("change", async (e) => {
        const sub = e.target.dataset.sub;
        if (e.target.checked) state.mySubjects.add(sub);
        else state.mySubjects.delete(sub);
        e.target.closest(".toggle-row").classList.toggle("on", e.target.checked);
        try {
          await saveMySubjects();
          await loadTimetable();
        } catch (err) {
          toast(err.message, "err");
        }
      })
    );
  }

  function fillSettingsForm() {
    const s = state.settings;
    $("#setUrl").value = s.webuntis.url || "";
    $("#setSchool").value = s.webuntis.school || "";
    $("#setUsername").value = s.username || "";
    $("#setTType").value = s.timetable.type || "auto";
    $("#setEType").value = s.timetable.element_type || "student";
    $("#setEId").value = s.timetable.element_id || "";
    $("#setEnabled").checked = !!s.ntfy.enabled;
    $("#setHost").value = s.ntfy.host || "https://ntfy.sh";
    $("#setTopic").value = s.ntfy.topic || "";
    $("#setInterval").value = s.ntfy.interval_minutes || 20;
    $("#topicLink").innerHTML = "Abo im Handy: " + (s.ntfy.topic ? `<a href="${esc(s.ntfy.host)}/${esc(s.ntfy.topic)}" target="_blank" rel="noopener">${esc(s.ntfy.host)}/${esc(s.ntfy.topic)}</a>` : "–");
    renderCourseSelect();
    renderNtfyStatus();
  }

  function renderNtfyStatus() {
    const st = state.status || {};
    const el = $("#ntfyStatus");
    let text = "";
    if (st.last_report) {
      const r = st.last_report;
      if (r.deactivated) text = "Benachrichtigungen derzeit deaktiviert.";
      else if (!r.ok) text = "Letzte Prüfung fehlgeschlagen: " + (r.error || "unbekannt");
      else
        text = `Letzte Prüfung: ${r.checked_at ? r.checked_at.replace("T", " ").slice(0, 16) : "–"} · Gefunden: ${r.found.cancelled} Entfall, ${r.found.substituted} Vertretung · Gesendet: ${r.sent}`;
    } else if (st.last_check) {
      text = "Noch keine Benachrichtigung gesendet.";
    } else {
      text = "";
    }
    el.textContent = text;
  }

  function applyTheme(theme) {
    const dark =
      theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }

  function applyStoredTheme() {
    const theme = localStorage.getItem("mu-theme") || "auto";
    applyTheme(theme);
    const sel = $("#setTheme");
    if (sel) sel.value = theme;
  }

  function openSettings() {
    $("#scrim").hidden = false;
    $("#settingsDrawer").hidden = false;
  }

  function closeSettings() {
    $("#scrim").hidden = true;
    $("#settingsDrawer").hidden = true;
  }

  function bindEvents() {
    $("#settingsBtn").addEventListener("click", openSettings);
    $("#closeSettings").addEventListener("click", closeSettings);
    $("#scrim").addEventListener("click", closeSettings);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#settingsDrawer").hidden) closeSettings();
      else if (!$("#lessonOverlay").hidden) closeLessonOverlay();
    });

    $("#view").addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]");
      if (open) {
        openLessonDetail(open.dataset.sub);
        return;
      }
      const back = e.target.closest('[data-action="back"]');
      if (back) {
        state.hwOpen = false;
        renderView();
        return;
      }
      const del = e.target.closest("[data-hw-del]");
      if (del) deleteHomework(del.dataset.hwDel);
    });

    $("#view").addEventListener("change", (e) => {
      const check = e.target.closest("[data-hw-id]");
      if (check) toggleHomework(check.dataset.hwId, check.checked);
    });

    $("#view").addEventListener("submit", (e) => {
      if (e.target.closest("#hwForm")) {
        e.preventDefault();
        addHomework();
      }
    });

    $("#overlayClose").addEventListener("click", closeLessonOverlay);
    $("#lessonOverlay").addEventListener("click", (e) => {
      if (e.target.id === "lessonOverlay") closeLessonOverlay();
    });
    $("#overlayBody").addEventListener("click", (e) => {
      const del = e.target.closest("[data-ov-del]");
      if (del) {
        deleteOverlayHw(del.dataset.ovDel);
        return;
      }
      if (e.target.closest("#ovAdd")) addOverlayHw();
      if (e.target.closest("#ovDone")) closeLessonOverlay();
    });
    $("#overlayBody").addEventListener("change", (e) => {
      const check = e.target.closest("[data-ov-id]");
      if (check) toggleOverlayHw(check.dataset.ovId, check.checked);
    });
    $("#overlayBody").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.id === "ovHwText") {
        e.preventDefault();
        addOverlayHw();
      }
    });

    $("#hwBtn").addEventListener("click", async () => {
      state.hwOpen = !state.hwOpen;
      if (state.hwOpen) {
        try {
          await loadHomework();
        } catch (err) {
          toast(err.message, "err");
        }
      }
      renderView();
    });

    $("#refreshBtn").addEventListener("click", () => refresh().then(() => toast("Aktualisiert")));

    $("#todayBtn").addEventListener("click", () => {
      state.weekStart = new Date();
      state.selected = todayISO();
      loadTimetable().catch((e) => toast(e.message, "err"));
    });

    $("#themeBtn").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === "dark" ? "light" : "dark";
      localStorage.setItem("mu-theme", next);
      applyTheme(next);
      const sel = $("#setTheme");
      if (sel) sel.value = next;
    });
    $("#setTheme").addEventListener("change", (e) => {
      localStorage.setItem("mu-theme", e.target.value);
      applyTheme(e.target.value);
    });

    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("#loginError").hidden = true;
      const fd = new FormData(e.target);
      const btn = $("#loginBtn");
      btn.disabled = true;
      btn.textContent = "Anmelden…";
      try {
        await api.post("/api/login", {
          url: fd.get("url").trim(),
          school: fd.get("school").trim(),
          username: fd.get("username").trim(),
          password: fd.get("password"),
          remember: fd.get("remember") === "on",
        });
        state.loggedIn = true;
        state.weekStart = new Date();
        state.selected = todayISO();
        await loadStatus();
        state.settings = await api.get("/api/settings");
        state.mySubjects = new Set(state.settings.filter.my_subjects || []);
        await loadTimetable();
        await loadHomework();
        renderView();
        $("#loginScreen").hidden = true;
        $("#app").hidden = false;
        toast("Angemeldet");
      } catch (err) {
        loginError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "Anmelden";
      }
    });

    $("#courseSearch").addEventListener("input", (e) => {
      state.courseQuery = e.target.value;
      renderCourseSelect();
    });

    $("#selectAllCourses").addEventListener("click", async () => {
      const subjects = (state.schedule && state.schedule.subjects) || [];
      state.mySubjects = new Set(subjects.map((s) => s.short));
      await saveMySubjects().catch((err) => toast(err.message, "err"));
      await loadTimetable().catch((err) => toast(err.message, "err"));
      renderCourseSelect();
    });

    $("#selectNoneCourses").addEventListener("click", async () => {
      state.mySubjects = new Set();
      await saveMySubjects().catch((err) => toast(err.message, "err"));
      await loadTimetable().catch((err) => toast(err.message, "err"));
      renderCourseSelect();
    });

    $("#saveSettingsBtn").addEventListener("click", async () => {
      try {
        await api.post("/api/settings", {
          webuntis: { url: $("#setUrl").value.trim(), school: $("#setSchool").value.trim() },
          timetable: {
            type: $("#setTType").value,
            element_type: $("#setEType").value,
            element_id: $("#setEId").value.trim(),
          },
          ntfy: {
            host: $("#setHost").value.trim(),
            topic: $("#setTopic").value.trim(),
            enabled: $("#setEnabled").checked,
            interval_minutes: Number($("#setInterval").value || 20),
          },
        });
        state.settings = await api.get("/api/settings");
        toast("Einstellungen gespeichert");
      } catch (err) {
        toast(err.message, "err");
      }
    });

    $("#reloginBtn").addEventListener("click", async () => {
      try {
        await api.post("/api/login", {
          url: $("#setUrl").value.trim(),
          school: $("#setSchool").value.trim(),
          username: $("#setUsername").value.trim(),
          password: $("#setPassword").value,
          remember: true,
        });
        state.loggedIn = true;
        state.weekStart = new Date();
        state.selected = todayISO();
        await loadTimetable();
        await loadHomework();
        renderView();
        $("#loginScreen").hidden = true;
        $("#app").hidden = false;
        toast("Neu angemeldet");
        closeSettings();
      } catch (err) {
        toast("Anmeldung fehlgeschlagen: " + err.message, "err");
      }
    });

    $("#ntfyTestBtn").addEventListener("click", async () => {
      try {
        await api.post("/api/ntfy/test", {
          host: $("#setHost").value.trim(),
          topic: $("#setTopic").value.trim(),
        });
        toast("Test-Benachrichtigung gesendet");
      } catch (err) {
        toast(err.message, "err");
      }
    });

    $("#ntfyCheckBtn").addEventListener("click", async () => {
      try {
        await api.post("/api/ntfy/check");
        await loadStatus();
        renderNtfyStatus();
        toast("Prüfung abgeschlossen");
      } catch (err) {
        toast(err.message, "err");
      }
    });

    window.matchMedia("(max-width: 860px)").addEventListener("change", (e) => {
      state.mobile = e.matches;
      if (!e.matches || (topbar && window.scrollY <= 2)) {
        if (topbar) topbar.classList.remove("topbar--compact");
      }
      renderView();
    });

    const topbar = $("#app").querySelector(".topbar");
    let headerLastY = window.scrollY;
    let headerAcc = 0;
    let headerTicking = false;
    function updateHeader() {
      if (window.matchMedia("(max-width: 860px)").matches && topbar) {
        const y = window.scrollY;
        const atTop = y <= 2;
        if (atTop) {
          topbar.classList.remove("topbar--compact");
          headerAcc = 0;
        } else {
          const d = y - headerLastY;
          if (d === 0) { headerTicking = false; return; }
          headerLastY = y;
          headerAcc = Math.sign(d) === Math.sign(headerAcc) || headerAcc === 0
            ? headerAcc + d
            : d;
          if (headerAcc >= 20) {
            topbar.classList.add("topbar--compact");
          }
        }
      }
      headerTicking = false;
    }
    updateHeader();
    window.addEventListener("scroll", () => {
      if (!headerTicking) {
        headerTicking = true;
        requestAnimationFrame(updateHeader);
      }
    }, { passive: true });

    window.setInterval(() => {
      if (!state.loggedIn) return;
      refresh().catch(() => {});
    }, 120000);
  }

  async function init() {
    applyStoredTheme();
    bindEvents();
    let fatal = null;
    try {
      await loadStatus();
    } catch (err) {
      fatal = err.message;
    }
    if (!fatal && state.loggedIn) {
      try {
        state.settings = await api.get("/api/settings");
        state.mySubjects = new Set(state.settings.filter.my_subjects || []);
        state.weekStart = new Date();
        state.selected = todayISO();
        await loadTimetable();
        await loadHomework();
        renderView();
      } catch (err) {
        fatal = err.message;
      }
    }
    if (fatal) {
      toast("Laden fehlgeschlagen: " + fatal, "err");
    }

    if (state.loggedIn) {
      $("#loginScreen").hidden = true;
      $("#app").hidden = false;
    } else {
      $("#app").hidden = true;
      $("#loginScreen").hidden = false;
      if (!fatal) {
        try {
          state.settings = await api.get("/api/settings");
        } catch (err) {}
      }
      if (state.settings) {
        const pf = $("#loginForm");
        pf.url.value = state.settings.webuntis.url || "";
        pf.school.value = state.settings.webuntis.school || "";
        pf.username.value = state.settings.username || "";
      }
    }
    updateDots();
  }

  init();
})();