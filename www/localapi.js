(function (global) {
  "use strict";

  var WU = global.WU;
  var store = global.MUStorage;

  var state = {
    settings: store.loadSettings(),
    client: new WU.WebUntisClient(),
    lastCheck: null,
    lastError: null,
    lastReport: null,
    initPromise: null,
    cache: { key: null, data: null, ts: 0 },
    homework: store.loadHomework(),
    notified: store.loadNotified(),
  };

  var pollTimer = null;
  var CACHE_TTL = 120;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function isoDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function nowIso() {
    var d = new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    var hh = pad(Math.floor(Math.abs(off) / 60));
    var mm = pad(Math.abs(off) % 60);
    return (
      isoDate(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + sign + hh + ":" + mm
    );
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    var x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function uniqueSorted(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (v) {
      var s = String(v);
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    out.sort();
    return out;
  }

  function loggedIn() {
    var info = state.client.info || {};
    return Object.keys(info).length > 0 && !!(state.settings.credentials || {}).username;
  }

  function doLogin() {
    var creds = state.settings.credentials || {};
    var web = state.settings.webuntis || {};
    var url = WU.normalizeBaseUrl(web.url);
    var username = String(creds.username || "").trim();
    var password = creds.password || "";
    if (!url || !username || !password) return Promise.resolve(false);
    state.client.withConfig(url, web.school || null);
    return state.client
      .login(username, password)
      .then(function () {
        return true;
      })
      .catch(function (exc) {
        state.lastError = exc && exc.message ? exc.message : String(exc);
        return false;
      });
  }

  function ensureLogin() {
    if (loggedIn()) return Promise.resolve(true);
    if (state.initPromise) return state.initPromise;
    var p = doLogin().then(
      function (ok) {
        if (!ok || !loggedIn()) state.initPromise = null;
        return ok;
      },
      function () {
        state.initPromise = null;
        return false;
      }
    );
    state.initPromise = p;
    return p;
  }

  function publicSettings() {
    var web = state.settings.webuntis || {};
    var tt = state.settings.timetable || {};
    var filt = state.settings.filter || {};
    var ntfy = state.settings.ntfy || {};
    return {
      webuntis: { url: WU.normalizeBaseUrl(web.url), school: web.school || "" },
      timetable: {
        type: tt.type || "auto",
        element_type: tt.element_type || "student",
        element_id: tt.element_id || "",
      },
      filter: {
        hidden_subjects: filt.hidden_subjects || [],
        my_subjects: filt.my_subjects || [],
      },
      ntfy: {
        host: ntfy.host || "https://ntfy.sh",
        topic: ntfy.topic || "",
        enabled: !!ntfy.enabled,
        interval_minutes: parseInt((state.settings.poller || {}).interval_minutes, 10) || 20,
      },
      username: (state.settings.credentials || {}).username || "",
      mock: false,
    };
  }

  function statusPayload() {
    var web = state.settings.webuntis || {};
    var schoolName = state.client.info.schoolName || web.url || "";
    var ntfy = state.settings.ntfy || {};
    return {
      logged_in: loggedIn(),
      username: (state.settings.credentials || {}).username || "",
      school: schoolName,
      server: web.url,
      ntfy: {
        enabled: !!ntfy.enabled,
        topic: ntfy.topic || "",
        configured: !!(ntfy.topic || "").trim() && !!(ntfy.host || "").trim(),
      },
      poller: { interval_minutes: parseInt((state.settings.poller || {}).interval_minutes, 10) || 20 },
      last_check: state.lastCheck,
      last_error: state.lastError,
      last_report: state.lastReport,
      now: nowIso(),
      mock: false,
    };
  }

  function saveSettings(patch) {
    var update = {};
    ["webuntis", "timetable", "filter", "ntfy"].forEach(function (section) {
      if (patch[section] && typeof patch[section] === "object") update[section] = patch[section];
    });
    if (update.ntfy) {
      var nt = update.ntfy;
      if (nt.interval_minutes !== undefined) {
        var interval = parseInt(nt.interval_minutes, 10);
        if (!isFinite(interval)) interval = (state.settings.poller || {}).interval_minutes || 20;
        state.settings.poller = state.settings.poller || {};
        state.settings.poller.interval_minutes = Math.max(5, Math.min(1440, interval));
        delete nt.interval_minutes;
      }
      ["topic", "host"].forEach(function (key) {
        if (key in nt) nt[key] = String(nt[key] || "").trim();
      });
      if ("enabled" in nt) nt.enabled = !!nt.enabled;
    }
    if (update.timetable) {
      var tt = update.timetable;
      if (["auto", "manual"].indexOf(tt.type) < 0) delete tt.type;
      if (["class", "teacher", "subject", "room", "student"].indexOf(tt.element_type) < 0) delete tt.element_type;
      if ("element_id" in tt) tt.element_id = String(tt.element_id || "").trim();
    }
    Object.keys(update).forEach(function (section) {
      var data = update[section];
      if (!data || typeof data !== "object") return;
      state.settings[section] = state.settings[section] || {};
      Object.keys(data).forEach(function (key) {
        var value = data[key];
        if (key === "my_subjects") {
          if (Array.isArray(value)) {
            state.settings[section][key] = value
              .map(function (v) {
                return String(v).trim();
              })
              .filter(Boolean);
          }
          return;
        }
        state.settings[section][key] = value;
      });
    });
    if (state.settings.ntfy) delete state.settings.ntfy.interval_minutes;
    store.saveSettings(state.settings);
    state.cache.key = null;
    restartPoller();
    return { ok: true, settings: publicSettings() };
  }

  function configuredLogin(payload) {
    var url = WU.normalizeBaseUrl(payload.url);
    var school = String(payload.school || "").trim();
    var username = String(payload.username || "").trim();
    var password = payload.password || "";
    var remember = payload.remember !== false;

    if (!url) return Promise.reject(new Error("WebUntis-URL fehlt."));
    if (!username || !password) return Promise.reject(new Error("Benutzername und Passwort fehlen."));

    state.settings.webuntis.url = url;
    state.settings.webuntis.school = school;
    state.settings.credentials.username = username;
    state.settings.credentials.password = remember ? password : "";
    store.saveSettings(state.settings);

    state.client.withConfig(url, school || null);
    state.initPromise = null;
    return state.client
      .login(username, password)
      .then(function () {
        if (state.client.school && !state.settings.webuntis.school) {
          state.settings.webuntis.school = state.client.school;
          store.saveSettings(state.settings);
        }
        state.cache.key = null;
        state.lastError = null;
        return { ok: true, status: statusPayload() };
      })
      .catch(function (exc) {
        throw new Error(exc && exc.message ? exc.message : String(exc));
      });
  }

  function loadTimetable(query) {
    return ensureLogin().then(function () {
      if (!loggedIn()) throw new Error("Nicht angemeldet.");
      var start = startOfDay(new Date());
      var days = parseInt(query.days || "7", 10) || 7;
      days = Math.max(1, Math.min(days, 21));
      var end = addDays(start, days - 1);
      var hidden = uniqueSorted((state.settings.filter || {}).hidden_subjects || []);
      var mine = uniqueSorted((state.settings.filter || {}).my_subjects || []);
      var sid = (state.client.info || {}).sessionId || "";
      var key = isoDate(start) + "|" + days + "|" + JSON.stringify(hidden) + "|" + JSON.stringify(mine) + "|" + sid;
      var now = Date.now() / 1000;
      if (state.cache.key === key && now - state.cache.ts < CACHE_TTL) {
        return Object.assign({ ok: true }, state.cache.data);
      }

      var ttype = state.settings.timetable || {};
      var promise;
      if (ttype.type === "manual" && ttype.element_id) {
        promise = state.client.fetchTimetable(start, end, ttype.element_type || "student", ttype.element_id);
      } else {
        promise = state.client.fetchTimetable(start, end);
      }
      return promise
        .then(function (res) {
          var built = WU.buildSchedule(res[0], hidden, mine);
          var data = {
            start: isoDate(start),
            end: isoDate(end),
            context: res[1],
            days: built.days,
            subjects: built.subjects,
            freistunden: built.freistunden,
            my_subjects: mine,
            meta: built.meta,
          };
          state.cache.key = key;
          state.cache.data = data;
          state.cache.ts = now;
          state.lastError = null;
          return Object.assign({ ok: true }, data);
        })
        .catch(function (exc) {
          throw new Error(exc && exc.message ? exc.message : String(exc));
        });
    });
  }

  function randomId() {
    return (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)).slice(0, 12);
  }

  function createHomework(payload) {
    var subject = String(payload.subject || "").trim();
    var text = String(payload.text || "").trim();
    if (!subject || !text) throw new Error("Fach und Text sind erforderlich.");
    var due = payload.due !== undefined && payload.due !== null ? String(payload.due).trim() || null : null;
    var item = {
      id: randomId(),
      subject: subject,
      text: text,
      due: due,
      done: false,
      created: nowIso(),
    };
    state.homework.push(item);
    store.saveHomework(state.homework);
    return { ok: true, homework: item };
  }

  function updateHomework(id, payload) {
    var item = state.homework.find(function (i) {
      return i.id === id;
    });
    if (!item) throw new Error("Nicht gefunden.");
    if ("text" in payload) item.text = String(payload.text || "").trim();
    if ("due" in payload) item.due = payload.due ? String(payload.due).trim() : null;
    if ("done" in payload) item.done = !!payload.done;
    store.saveHomework(state.homework);
    return { ok: true, homework: item };
  }

  function deleteHomework(id) {
    state.homework = state.homework.filter(function (i) {
      return i.id !== id;
    });
    store.saveHomework(state.homework);
    return { ok: true };
  }

  function publishNtfy(ntfy, title, body, priority) {
    var host = (ntfy.host || "https://ntfy.sh").replace(/\/+$/, "");
    var topic = (ntfy.topic || "").trim();
    if (!topic) throw new Error("Kein ntfy-Topic eingestellt.");
    var url =
      host +
      "/" +
      encodeURIComponent(topic) +
      "?title=" +
      encodeURIComponent(title) +
      "&priority=" +
      encodeURIComponent(priority || "default");
    return WU.httpRequest({
      url: url,
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: body,
      timeout: 12000,
    }).then(function (res) {
      if (res.status < 200 || res.status >= 300) throw new Error("ntfy HTTP " + res.status);
      return true;
    });
  }

  function ntfyTest(payload) {
    var topic = String(payload.topic || (state.settings.ntfy || {}).topic || "").trim();
    var host = String(payload.host || (state.settings.ntfy || {}).host || "https://ntfy.sh").trim();
    if (!topic) return Promise.reject(new Error("Kein ntfy-Topic eingestellt."));
    return publishNtfy(
      { host: host, topic: topic },
      "Mein Untis",
      "Test-Benachrichtigung erfolgreich – deine Benachrichtigungen sind aktiv."
    )
      .then(function () {
        return { ok: true };
      })
      .catch(function (exc) {
        throw new Error("ntfy nicht erreichbar: " + (exc && exc.message ? exc.message : exc));
      });
  }

  function lessonKey(lesson) {
    if (lesson.id) return lesson.date + ":" + lesson.id;
    return lesson.date + ":" + lesson.start_time + ":" + lesson.subject.short;
  }

  var WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

  function dayLabel(dateText) {
    var parts = dateText.split("-");
    var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var today = startOfDay(new Date());
    var diff = Math.round((d - today) / 86400000);
    if (diff === 0) return "Heute";
    if (diff === 1) return "Morgen";
    return WEEKDAYS[(d.getDay() + 6) % 7] + ", " + pad(d.getDate()) + "." + pad(d.getMonth() + 1) + ".";
  }

  function describeLesson(lesson) {
    var time = WU.formatTime(lesson.start_time) + "–" + WU.formatTime(lesson.end_time);
    var line = "• " + time + " " + lesson.subject.short;
    if (lesson.status === "cancelled") {
      line += " – entfällt";
      if (lesson.text) line += " (" + lesson.text + ")";
    } else {
      if (lesson.teachers.length) line += " · " + lesson.teachers.join(", ");
      if (lesson.rooms.length) line += " · " + lesson.rooms.join(", ");
      if (lesson.text) line += " (" + lesson.text + ")";
    }
    return line;
  }

  function checkNow() {
    var now = nowIso();
    state.lastCheck = now;
    var ntfy = state.settings.ntfy || {};
    var deactivated = !ntfy.enabled || !(ntfy.topic || "").trim();
    if (deactivated) {
      var report = {
        ok: true,
        checked_at: now,
        deactivated: true,
        found: { cancelled: 0, substituted: 0 },
        sent: 0,
      };
      state.lastReport = report;
      return Promise.resolve(report);
    }

    var today = startOfDay(new Date());
    var end = addDays(today, 5);
    return ensureLogin()
      .then(function () {
        if (!loggedIn()) throw new Error("Nicht angemeldet.");
        var tt = state.settings.timetable || {};
        if (tt.type === "manual" && tt.element_id) {
          return state.client.fetchTimetable(today, end, tt.element_type || "student", tt.element_id);
        }
        return state.client.fetchTimetable(today, end);
      })
      .then(function (res) {
        state.lastError = null;
        var mine = new Set((state.settings.filter || {}).my_subjects || []);
        var newCancel = [];
        var newSubst = [];
        (res[0] || []).forEach(function (ev) {
          var lesson = WU.parseLesson(ev);
          if (!lesson) return;
          if (mine.size && !mine.has(lesson.subject.short)) return;
          var key = lessonKey(lesson);
          if (lesson.status === "cancelled" && !state.notified.has(key)) newCancel.push(lesson);
          else if (lesson.status === "substitution" && !state.notified.has(key)) newSubst.push(lesson);
        });

        var sent = 0;
        var chain = Promise.resolve();
        var groups = {};
        newCancel
          .concat(newSubst)
          .sort(function (a, b) {
            return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start_time - b.start_time;
          })
          .forEach(function (l) {
            if (!groups[l.date]) groups[l.date] = [];
            groups[l.date].push(l);
          });

        Object.keys(groups)
          .sort()
          .forEach(function (date) {
            var lessons = groups[date];
            var cancels = lessons.filter(function (l) {
              return l.status === "cancelled";
            }).length;
            var title = dayLabel(date);
            if (cancels) title += ": " + cancels + " Unterricht" + (cancels === 1 ? "" : "e") + " entfallen";
            else title += ": Stundenplan-Änderungen";
            var body = lessons.map(describeLesson).join("\n");
            chain = chain
              .then(function () {
                return publishNtfy(ntfy, title, body, cancels ? "high" : "default");
              })
              .then(function () {
                sent += 1;
                lessons.forEach(function (l) {
                  state.notified.add(lessonKey(l));
                });
              })
              .catch(function (exc) {
                state.lastError = "ntfy fehlgeschlagen: " + (exc && exc.message ? exc.message : exc);
              });
          });

        return chain.then(function () {
          store.saveNotified(state.notified);
          var report = {
            ok: true,
            checked_at: now,
            deactivated: false,
            found: { cancelled: newCancel.length, substituted: newSubst.length },
            sent: sent,
            scope: { from: isoDate(today), to: isoDate(end) },
          };
          state.lastReport = report;
          return report;
        });
      })
      .catch(function (exc) {
        state.lastError = exc && exc.message ? exc.message : String(exc);
        var report = {
          ok: false,
          checked_at: now,
          error: state.lastError,
          found: { cancelled: 0, substituted: 0 },
          sent: 0,
        };
        state.lastReport = report;
        return report;
      });
  }

  function restartPoller() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    var interval = parseInt((state.settings.poller || {}).interval_minutes, 10);
    if (!isFinite(interval)) interval = 20;
    interval = Math.max(5, Math.min(1440, interval));
    pollTimer = setInterval(function () {
      checkNow().catch(function () {});
    }, interval * 60 * 1000);
  }

  function splitPath(path) {
    var idx = path.indexOf("?");
    var pathname = idx < 0 ? path : path.slice(0, idx);
    var query = {};
    if (idx >= 0) {
      path.slice(idx + 1)
        .split("&")
        .forEach(function (kv) {
          if (!kv) return;
          var p = kv.split("=");
          query[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join("=") || "");
        });
    }
    return { pathname: pathname, query: query };
  }

  function invoke(method, path, body) {
    var sp = splitPath(path);
    var p = sp.pathname;
    var q = sp.query;
    try {
      if (method === "GET") {
        if (p === "/api/health") return Promise.resolve({ ok: true, version: "1.0.0" });
        if (p === "/api/status")
          return ensureLogin().then(function () {
            return statusPayload();
          });
        if (p === "/api/settings") return Promise.resolve(publicSettings());
        if (p === "/api/timetable") return loadTimetable(q);
        if (p === "/api/homework") return Promise.resolve({ ok: true, homework: store.sortHomework(state.homework) });
      } else if (method === "POST") {
        if (p === "/api/login") return configuredLogin(body || {});
        if (p === "/api/logout")
          return state.client.logout().then(function () {
            state.initPromise = null;
            return { ok: true };
          });
        if (p === "/api/settings") return Promise.resolve(saveSettings(body || {}));
        if (p === "/api/homework") return Promise.resolve(createHomework(body || {}));
        if (p === "/api/ntfy/test") return ntfyTest(body || {});
        if (p === "/api/ntfy/check") return checkNow();
      } else if (method === "PUT") {
        var m = p.match(/^\/api\/homework\/([^/]+)$/);
        if (m) return Promise.resolve(updateHomework(decodeURIComponent(m[1]), body || {}));
      } else if (method === "DELETE") {
        var md = p.match(/^\/api\/homework\/([^/]+)$/);
        if (md) return Promise.resolve(deleteHomework(decodeURIComponent(md[1])));
      }
    } catch (exc) {
      return Promise.reject(exc);
    }
    return Promise.reject(new Error("Unbekannter Endpunkt: " + method + " " + p));
  }

  global.LocalAPI = {
    get: function (path) {
      return invoke("GET", path);
    },
    post: function (path, body) {
      return invoke("POST", path, body);
    },
    put: function (path, body) {
      return invoke("PUT", path, body);
    },
    del: function (path) {
      return invoke("DELETE", path);
    },
  };

  global.MUBackend = {
    state: state,
    statusPayload: statusPayload,
    publicSettings: publicSettings,
    ensureLogin: ensureLogin,
    checkNow: checkNow,
    restartPoller: restartPoller,
  };

  restartPoller();
  setTimeout(function () {
    ensureLogin().catch(function () {});
  }, 300);
})(window);
