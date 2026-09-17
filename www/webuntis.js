(function (global) {
  "use strict";

  var WEBUNTIS_DOMAINS = [
    "webuntis.com",
    "webuntis.de",
    "webuntis.at",
    "webuntis.ch",
    "webuntis.org",
    "webuntis.info",
  ];

  var JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  var ELEMENT_TYPES = { class: 1, teacher: 2, subject: 3, room: 4, student: 5 };
  var SPACE_RUNS = /[\s\u00a0\u202f\u2009\u200a\u3000]+/g;

  function WebUntisError(message, code) {
    var err = new Error(message);
    err.name = "WebUntisError";
    err.code = code;
    return err;
  }

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function formatTime(minutes) {
    if (minutes === null || minutes === undefined) return "--:--";
    minutes = Math.trunc(Number(minutes));
    if (!isFinite(minutes)) return "--:--";
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(((minutes % 60) + 60) % 60).padStart(2, "0");
  }

  function toMinutes(value) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) return 0;
    return Math.floor(n / 100) * 60 + (n % 100);
  }

  function normalizeShort(s) {
    return String(s === null || s === undefined ? "" : s).replace(SPACE_RUNS, " ").trim();
  }

  var SONDERFREI = new Set([normalizeShort("05A")]);

  function normalizeBaseUrl(url) {
    var value = String(url || "").trim().replace(/\/+$/, "");
    while (/^https?:\/\//i.test(value)) {
      value = /^https/i.test(value) ? value.slice(8) : value.slice(7);
      value = value.replace(/^\/+/, "").replace(/\/+$/, "");
    }
    if (!value) return "";
    return "https://" + value;
  }

  function isoDate(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function compactDate(d) {
    return (
      String(d.getFullYear()) +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function parseLesson(ev) {
    var dateVal = ev.date;
    if (!dateVal) return null;
    var text = String(dateVal);
    var year = parseInt(text.slice(0, 4), 10);
    var month = parseInt(text.slice(4, 6), 10);
    var day = parseInt(text.slice(6, 8), 10);
    if (!isFinite(year) || !isFinite(month) || !isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var date = new Date(year, month - 1, day);

    var subs = ev.subjects || [];
    var subject = subs.length
      ? {
          short: subs[0].name || "?",
          long: subs[0].longName || subs[0].long_name || "",
        }
      : { short: "?", long: "" };

    var etype = String(ev.type || "ls").toLowerCase();
    var code = String(ev.code || "").toLowerCase();
    var status;
    if (etype === "oh" || etype === "fh" || code.indexOf("cancel") >= 0) {
      status = "cancelled";
    } else if (
      etype === "sb" ||
      etype === "bs" ||
      ["substitution", "shifted", "irregular", "sb"].indexOf(code) >= 0
    ) {
      status = "substitution";
    } else {
      status = "normal";
    }

    var start = ev.startTime !== undefined ? ev.startTime : ev.starttime;
    var end = ev.endTime !== undefined ? ev.endTime : ev.endtime;

    function names(list) {
      return (list || []).map(function (x) {
        return x && x.name;
      });
    }

    return {
      id: ev.id,
      date: isoDate(date),
      day: (date.getDay() + 6) % 7,
      start_time: toMinutes(start),
      end_time: toMinutes(end),
      subject: subject,
      teachers: names(ev.teachers),
      rooms: names(ev.rooms),
      classes: names(ev.classes),
      groups: names(ev.studentGroups),
      status: status,
      text: ev.substText || ev.info || "",
    };
  }

  function subtractIntervals(freeStart, freeEnd, occupied) {
    var occ = (occupied || []).slice().sort(function (a, b) {
      return a[0] - b[0] || a[1] - b[1];
    });
    var result = [];
    var cursor = freeStart;
    for (var i = 0; i < occ.length; i++) {
      var start = occ[i][0];
      var end = occ[i][1];
      if (end <= cursor) continue;
      if (start >= freeEnd) break;
      if (start > cursor) result.push([cursor, Math.min(start, freeEnd)]);
      cursor = Math.max(cursor, end);
      if (cursor >= freeEnd) break;
    }
    if (cursor < freeEnd) result.push([cursor, freeEnd]);
    return result;
  }

  function statusRank(status) {
    return { cancelled: 3, substitution: 2, normal: 1 }[status] || 1;
  }

  function keepNewer(existing, newer) {
    return statusRank(newer.status) > statusRank(existing.status);
  }

  function buildSchedule(events, hidden, mine) {
    var hiddenSet = new Set((hidden || []).map(normalizeShort));
    var mineSet = new Set((mine || []).map(normalizeShort));
    var filterMine = mineSet.size > 0;

    var unique = new Map();
    for (var i = 0; i < events.length; i++) {
      var lesson = parseLesson(events[i]);
      if (!lesson) continue;
      var key = [lesson.date, lesson.start_time, lesson.end_time, lesson.subject.short].join("\u0001");
      var existing = unique.get(key);
      if (!existing || keepNewer(existing, lesson)) unique.set(key, lesson);
    }

    var sonderfreiSlots = new Set();
    unique.forEach(function (lesson) {
      if (SONDERFREI.has(normalizeShort(lesson.subject.short))) {
        sonderfreiSlots.add([lesson.date, lesson.start_time, lesson.end_time].join("\u0001"));
      }
    });

    var filtered = new Map();
    var subjects = new Map();
    var times = [];
    unique.forEach(function (lesson) {
      var slotKey = [lesson.date, lesson.start_time, lesson.end_time].join("\u0001");
      if (sonderfreiSlots.has(slotKey)) return;
      var short = lesson.subject.short;
      var normalized = normalizeShort(short);
      if (SONDERFREI.has(normalized)) return;
      if (hiddenSet.has(normalized)) return;
      lesson.mine = !filterMine || mineSet.has(normalized);
      filtered.set([slotKey, short].join("\u0001"), lesson);
      if (!subjects.has(short)) subjects.set(short, { short: short, long: lesson.subject.long, count: 0 });
      subjects.get(short).count += 1;
      times.push(lesson.start_time);
      times.push(lesson.end_time);
    });

    var meta = {
      min_start: times.length ? Math.min.apply(null, times) : 0,
      max_end: times.length ? Math.max.apply(null, times) : 0,
    };

    var days = {};
    filtered.forEach(function (lesson) {
      if (!lesson.mine) return;
      if (!days[lesson.date]) days[lesson.date] = [];
      days[lesson.date].push(lesson);
    });
    Object.keys(days).forEach(function (date) {
      days[date].sort(function (a, b) {
        return a.start_time - b.start_time || a.end_time - b.end_time;
      });
    });

    var freistunden = {};
    if (filterMine) {
      var bySlot = new Map();
      filtered.forEach(function (lesson) {
        var key = [lesson.date, lesson.start_time, lesson.end_time].join("\u0001");
        if (!bySlot.has(key)) {
          bySlot.set(key, { date: lesson.date, start: lesson.start_time, end: lesson.end_time, lessons: [] });
        }
        bySlot.get(key).lessons.push(lesson);
      });
      bySlot.forEach(function (slot) {
        var anyMine = slot.lessons.some(function (l) {
          return l.mine;
        });
        if (!anyMine) {
          if (!freistunden[slot.date]) freistunden[slot.date] = [];
          freistunden[slot.date].push({ start_time: slot.start, end_time: slot.end });
        }
      });
      sonderfreiSlots.forEach(function (key) {
        var parts = key.split("\u0001");
        var date = parts[0];
        if (!freistunden[date]) freistunden[date] = [];
        freistunden[date].push({ start_time: Number(parts[1]), end_time: Number(parts[2]), text: "Sonderfrei" });
      });

      Object.keys(freistunden).forEach(function (date) {
        var occupied = (days[date] || []).map(function (l) {
          return [l.start_time, l.end_time];
        });
        var cut = [];
        freistunden[date].forEach(function (entry) {
          var parts = subtractIntervals(entry.start_time, entry.end_time, occupied);
          parts.forEach(function (range) {
            var newEntry = { start_time: range[0], end_time: range[1] };
            if (entry.text) newEntry.text = entry.text;
            cut.push(newEntry);
          });
        });
        if (!cut.length) {
          delete freistunden[date];
          return;
        }
        var sonderfreiBlocks = cut.filter(function (e) {
          return e.text === "Sonderfrei";
        });
        var others = cut.filter(function (e) {
          return e.text !== "Sonderfrei";
        });
        var merged = sonderfreiBlocks.slice();
        others.forEach(function (other) {
          var blocks = sonderfreiBlocks.map(function (b) {
            return [b.start_time, b.end_time];
          });
          subtractIntervals(other.start_time, other.end_time, blocks).forEach(function (range) {
            merged.push({ start_time: range[0], end_time: range[1] });
          });
        });
        merged.sort(function (a, b) {
          return a.start_time - b.start_time || a.end_time - b.end_time;
        });
        var result = [];
        merged.forEach(function (entry) {
          var last = result.length ? result[result.length - 1] : null;
          if (!last) {
            result.push(Object.assign({}, entry));
            return;
          }
          var overlap = entry.start_time < last.end_time;
          var adjacent = entry.start_time === last.end_time;
          var sameKind = (last.text === "Sonderfrei") === (entry.text === "Sonderfrei");
          if (overlap || (adjacent && sameKind)) {
            if (entry.end_time > last.end_time) last.end_time = entry.end_time;
            if (entry.text === "Sonderfrei") last.text = "Sonderfrei";
          } else {
            result.push(Object.assign({}, entry));
          }
        });
        freistunden[date] = result;
      });
    }

    return {
      days: days,
      subjects: Array.from(subjects.values()).sort(function (a, b) {
        return b.count - a.count;
      }),
      freistunden: freistunden,
      meta: meta,
    };
  }

  // --- HTTP layer: uses native CapacitorHttp when available (bypasses CORS) ---
  function getCapacitorHttp() {
    var Cap = global.Capacitor;
    if (!Cap) return null;
    if (Cap.Plugins && Cap.Plugins.CapacitorHttp) return Cap.Plugins.CapacitorHttp;
    if (Cap.CapacitorHttp && typeof Cap.CapacitorHttp.request === "function") return Cap.CapacitorHttp;
    return null;
  }

  function CookieJar() {
    this.jar = {};
  }
  CookieJar.prototype.store = function (setCookie) {
    if (!setCookie) return;
    var list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (var i = 0; i < list.length; i++) {
      var first = String(list[i]).split(";")[0];
      var idx = first.indexOf("=");
      if (idx <= 0) continue;
      var name = first.slice(0, idx).trim();
      var value = first.slice(idx + 1).trim();
      if (value) this.jar[name] = value;
      else delete this.jar[name];
    }
  };
  CookieJar.prototype.load = function (raw) {
    if (!raw) return;
    var parts = String(raw).split(";");
    for (var i = 0; i < parts.length; i++) {
      var first = parts[i].trim();
      var idx = first.indexOf("=");
      if (idx <= 0) continue;
      var name = first.slice(0, idx).trim();
      var value = first.slice(idx + 1).trim();
      if (!name) continue;
      if (value) this.jar[name] = value;
      else delete this.jar[name];
    }
  };
  CookieJar.prototype.header = function () {
    var self = this;
    return Object.keys(this.jar)
      .map(function (k) {
        return k + "=" + self.jar[k];
      })
      .join("; ");
  };

  // CORS-Proxy (Cloudflare Worker) für den Browserbetrieb/PWA.
  function proxyBase() {
    var cfg = global.MU_CONFIG || {};
    return String(cfg.proxyBase || "").replace(/\/+$/, "");
  }

  function isWebUntisUrl(url) {
    try {
      var host = new URL(url, "https://example.invalid").hostname;
      return /(^|\.)webuntis\.(com|de|at|ch|org|info)$/i.test(host);
    } catch (e) {
      return false;
    }
  }

  function responseText(res) {
    if (res.data === null || res.data === undefined) return "";
    if (typeof res.data === "string") return res.data;
    try {
      return JSON.stringify(res.data);
    } catch (e) {
      return String(res.data);
    }
  }

  function parseResponseJson(res) {
    if (res.data && typeof res.data === "object") return res.data;
    return JSON.parse(responseText(res));
  }

  function httpRequest(options) {
    var url = options.url;
    var method = options.method || "GET";
    var headers = Object.assign({}, options.headers || {});
    var body = options.body;
    var jar = options.jar;
    var timeout = options.timeout || 20000;

    if (jar) {
      var cookie = jar.header();
      if (cookie) headers["Cookie"] = cookie;
    }

    var capHttp = getCapacitorHttp();
    if (capHttp) {
      var capOptions = {
        url: url,
        method: method,
        headers: headers,
        connectTimeout: timeout,
        readTimeout: timeout,
      };
      if (body !== undefined && body !== null) capOptions.data = body;
      return capHttp.request(capOptions).then(function (res) {
        if (jar && res.headers) jar.store(res.headers["set-cookie"] || res.headers["Set-Cookie"]);
        return { status: res.status, headers: res.headers || {}, data: res.data, text: responseText(res) };
      });
    }

    var base = proxyBase();
    if (base && isWebUntisUrl(url)) {
      delete headers["Cookie"];
      if (jar) {
        var jarCookie = jar.header();
        if (jarCookie) headers["X-MU-Cookie"] = jarCookie;
      }
      var proxyUrl = base + "/?url=" + encodeURIComponent(url);
      var proxyInit = { method: method, headers: headers };
      if (body !== undefined && body !== null) proxyInit.body = body;
      return fetch(proxyUrl, proxyInit).then(function (res) {
        if (jar) jar.load(res.headers.get("x-mu-cookie"));
        return res.text().then(function (text) {
          return { status: res.status, headers: {}, data: text, text: text };
        });
      });
    }

    var init = { method: method, headers: headers };
    if (body !== undefined && body !== null) init.body = body;
    return fetch(url, init).then(function (res) {
      if (jar) jar.store(res.headers.get("set-cookie"));
      return res.text().then(function (text) {
        return { status: res.status, headers: {}, data: text, text: text };
      });
    });
  }

  function WebUntisClient(baseUrl, school) {
    this.base_url = normalizeBaseUrl(baseUrl);
    this.school = school || null;
    this.info = {};
    this._jar = new CookieJar();
    this._credentials = null;
  }

  WebUntisClient.prototype.withConfig = function (baseUrl, school) {
    this.base_url = normalizeBaseUrl(baseUrl);
    this.school = school || null;
    this._jar = new CookieJar();
  };

  Object.defineProperty(WebUntisClient.prototype, "configured", {
    get: function () {
      return !!this.base_url;
    },
  });

  WebUntisClient.prototype._endpoint = function () {
    var url = this.base_url + "/WebUntis/jsonrpc.do";
    if (this.school) url += "?school=" + encodeURIComponent(this.school);
    return url;
  };

  WebUntisClient.prototype._call = function (method, params) {
    var self = this;
    function attempt(tries) {
      return self._do_call(method, params).catch(function (exc) {
        if (exc && exc.code === -8500 && tries > 0) {
          var guessed = self._guessSchool();
          if (guessed && self.school !== guessed) {
            self.school = guessed;
            return attempt(tries - 1);
          }
        }
        throw exc;
      });
    }
    return attempt(2);
  };

  WebUntisClient.prototype._guessSchool = function () {
    var host = "";
    try {
      host = new URL(this.base_url).hostname || "";
    } catch (e) {
      host = "";
    }
    for (var i = 0; i < WEBUNTIS_DOMAINS.length; i++) {
      var domain = WEBUNTIS_DOMAINS[i];
      if (host.length > domain.length && host.slice(-(domain.length + 1)) === "." + domain) {
        return host.slice(0, -(domain.length + 1));
      }
    }
    return null;
  };

  WebUntisClient.prototype._do_call = function (method, params) {
    var self = this;
    if (!this.configured) return Promise.reject(WebUntisError("WebUntis-URL ist nicht konfiguriert."));
    var payload = { id: uuid(), jsonrpc: "2.0", method: method, params: params };
    if (method !== "authenticate" && this.info.sessionId) {
      payload.params = Object.assign({}, params, { sessionId: this.info.sessionId });
    }
    return httpRequest({
      url: this._endpoint(),
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify(payload),
      jar: this._jar,
      timeout: 20000,
    }).catch(function (exc) {
      throw WebUntisError("Keine Verbindung zu " + self.base_url + " (" + (exc.name || "Fehler") + ")");
    }).then(function (res) {
      var data;
      try {
        data = parseResponseJson(res);
      } catch (e) {
        throw WebUntisError("Ungültige Antwort von " + self.base_url + " (HTTP " + res.status + ")");
      }
      if (data && data.error) {
        throw WebUntisError(data.error.message || "Unbekannter Fehler", data.error.code);
      }
      return data ? data.result : undefined;
    });
  };

  WebUntisClient.prototype.login = function (username, password) {
    var self = this;
    this._credentials = [username, password];
    return this._call("authenticate", { user: username, password: password, client: "MeinUntis" }).then(function (result) {
      self.info = result || {};
      return self._fetchJwt().then(function () {
        return self.info;
      });
    });
  };

  WebUntisClient.prototype._reauthenticate = function () {
    var self = this;
    if (!this._credentials) return this._fetchJwt();
    var username = this._credentials[0];
    var password = this._credentials[1];
    this._jar = new CookieJar();
    return this._call("authenticate", { user: username, password: password, client: "MeinUntis" })
      .then(function (result) {
        self.info = result || {};
      })
      .catch(function () {
        self.info = {};
      })
      .then(function () {
        return self._fetchJwt();
      });
  };

  WebUntisClient.prototype._fetchJwt = function () {
    var self = this;
    if (!this.base_url) return Promise.resolve();
    return httpRequest({
      url: this.base_url + "/WebUntis/api/token/new",
      method: "GET",
      jar: this._jar,
      timeout: 10000,
    })
      .then(function (res) {
        var token = "";
        if (res.status >= 200 && res.status < 300) token = (res.text || "").replace(/\s+/g, "");
        if (JWT_RE.test(token)) self.info.jwtToken = token;
        else if (!JWT_RE.test(self.info.jwtToken || "")) delete self.info.jwtToken;
      })
      .catch(function () {
        if (!JWT_RE.test(self.info.jwtToken || "")) delete self.info.jwtToken;
      });
  };

  WebUntisClient.prototype.logout = function () {
    var self = this;
    return this._call("logout", {})
      .catch(function () {})
      .then(function () {
        self._jar = new CookieJar();
        self.info = {};
      });
  };

  WebUntisClient.prototype._timetableTargets = function () {
    var targets = [["student", this.info.personId]];
    if (this.info.klasseId) targets.push(["class", this.info.klasseId]);
    targets = targets.filter(function (t) {
      return t[1] !== null && t[1] !== undefined && t[1] !== "";
    });
    if (!targets.length) {
      throw WebUntisError(
        "Eigene Person konnte nicht ermittelt werden. Bitte unter Einstellungen Quelltyp und ID manuell setzen."
      );
    }
    return targets;
  };

  WebUntisClient.prototype._getTimetable = function (elemType, ident, start, end) {
    var self = this;
    var params = {
      id: parseInt(ident, 10),
      type: elemType,
      startDate: compactDate(start),
      endDate: compactDate(end),
      showSubstitutions: true,
      showAbsences: true,
      showInfo: true,
      showTeacher: true,
    };
    return this._call("getTimetable", params)
      .then(function (result) {
        return result || [];
      })
      .catch(function () {
        var paramsNew = {
          elementType: ELEMENT_TYPES[elemType],
          elementId: parseInt(ident, 10),
          startDate: params.startDate,
          endDate: params.endDate,
          showSubstitutions: true,
          showAbsences: true,
          showInfo: true,
          showTeacher: true,
        };
        return self._call("getTimetableNew", paramsNew).then(function (result) {
          return result || [];
        });
      });
  };

  WebUntisClient.prototype.fetchTimetable = function (start, end, elementType, elementId) {
    var self = this;
    if (elementType && elementId !== undefined && elementId !== null && elementId !== "") {
      return this._getTimetable(elementType, elementId, start, end).then(function (events) {
        return [events, elementType];
      });
    }
    return this._fetchLegacyTimetable(start, end).catch(function () {
      return self._fetchRestTimetable(start, end).then(function (events) {
        return [events, "rest"];
      }).catch(function (exc) {
        throw WebUntisError(
          "Stundenplan weder über JSON-RPC noch über REST abrufbar. Letzter Fehler: " +
            (exc && exc.message ? exc.message : exc)
        );
      });
    });
  };

  WebUntisClient.prototype._fetchLegacyTimetable = function (start, end) {
    var self = this;
    var targets = this._timetableTargets();
    var results = [];
    function next(i) {
      if (i >= targets.length) {
        var allError = results.length > 0 && results.every(function (r) { return r[0] === "error"; });
        if (allError) throw WebUntisError(String(results[results.length - 1][1]));
        return [[], "student"];
      }
      var elemType = targets[i][0];
      var ident = targets[i][1];
      return self._getTimetable(elemType, ident, start, end).then(function (events) {
        if (events && events.length) return [events, elemType];
        results.push(["empty", elemType]);
        return next(i + 1);
      }).catch(function (exc) {
        results.push(["error", exc]);
        return next(i + 1);
      });
    }
    return Promise.resolve().then(function () {
      return next(0);
    });
  };

  WebUntisClient.prototype._restUrl = function (path) {
    return this.base_url + "/WebUntis/api" + path;
  };

  WebUntisClient.prototype._restGet = function (path, params, token, retried) {
    var self = this;
    var query = "";
    if (params && Object.keys(params).length) {
      query = "?" + Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      }).join("&");
    }
    return Promise.resolve().then(function () {
      if (token && !JWT_RE.test(token)) {
        return self._fetchJwt().then(function () {
          return self.info.jwtToken;
        });
      }
      return token;
    }).then(function (effectiveToken) {
      var headers = { Accept: "application/json" };
      if (effectiveToken) headers.Authorization = "Bearer " + effectiveToken;
      return httpRequest({
        url: self._restUrl(path) + query,
        method: "GET",
        headers: headers,
        jar: self._jar,
        timeout: 20000,
      }).catch(function (exc) {
        if (!retried) {
          return self._reauthenticate().then(function () {
            return self._restGet(path, params, self.info.jwtToken, true);
          });
        }
        throw WebUntisError("REST " + path + " nicht erreichbar (" + (exc.name || "Fehler") + ")");
      }).then(function (res) {
        if (res.status === 401 && !retried) {
          return self._reauthenticate().then(function () {
            return self._restGet(path, params, self.info.jwtToken, true);
          });
        }
        var contentType = "";
        var headers = res.headers || {};
        Object.keys(headers).forEach(function (k) {
          if (k.toLowerCase() === "content-type") contentType = String(headers[k]);
        });
        if (contentType && contentType.indexOf("json") < 0) {
          throw WebUntisError(
            "REST-Endpunkt " + path + " liefert kein JSON (HTTP " + res.status + ") – Server unterstützt offenbar keine REST-Schnittstelle."
          );
        }
        var result;
        try {
          result = parseResponseJson(res);
        } catch (e) {
          throw WebUntisError(
            "REST-Endpunkt " + path + " liefert kein JSON (HTTP " + res.status + ") – Server unterstützt offenbar keine REST-Schnittstelle."
          );
        }
        if (result && typeof result === "object" && result.errorCode) {
          throw WebUntisError("REST " + path + ": " + (result.errorMessage || result.errorCode));
        }
        return result;
      });
    });
  };

  WebUntisClient.prototype._fetchRestTimetable = function (start, end) {
    var self = this;
    var token = this.info.jwtToken;
    if (!token) return Promise.reject(WebUntisError("Kein JWT-Token vorhanden."));
    return this._restGet("/rest/view/v1/app/data", null, token, false).then(function (data) {
      var user = data.user || {};
      var roles = user.roles || [];
      var resourceType = null;
      var resourceId = null;
      var students = user.students || [];
      if (students.length) {
        resourceType = "STUDENT";
        resourceId = students[0].id;
      } else if (roles.indexOf("KLASSE") >= 0) {
        resourceType = "CLASS";
        resourceId = (user.person || {}).id;
      }
      if (resourceId === null || resourceId === undefined) {
        if (self.info.personId !== null && self.info.personId !== undefined) {
          if (!resourceType) resourceType = "STUDENT";
          resourceId = self.info.personId;
        }
      }
      if (!resourceType || resourceId === null || resourceId === undefined) {
        throw WebUntisError("REST-Anmeldung: keine gültige Ressource gefunden.");
      }
      var params = {
        start: isoDate(start),
        end: isoDate(end),
        format: 1,
        resourceType: resourceType,
        resources: resourceId,
        timetableType: "MY_TIMETABLE",
        layout: "START_TIME",
      };
      return self._restGet("/rest/view/v1/timetable/entries", params, token, false).then(function (payload) {
        return self._convertRestEntries(payload);
      });
    });
  };

  WebUntisClient.prototype._restPositions = function (entry, positionName) {
    var result = [];
    var list = entry[positionName] || [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var current = item && typeof item === "object" ? item.current : null;
      if (current && typeof current === "object" && current.shortName) {
        result.push({ name: current.shortName });
      }
    }
    return result;
  };

  WebUntisClient.prototype._restIsoToHhmm = function (isoText) {
    if (!isoText) return null;
    var hour = parseInt(String(isoText).slice(11, 13), 10);
    var minute = parseInt(String(isoText).slice(14, 16), 10);
    if (!isFinite(hour) || !isFinite(minute)) return null;
    return hour * 100 + minute;
  };

  WebUntisClient.prototype._convertRestEntries = function (payload) {
    var events = [];
    var days = payload.days || [];
    for (var d = 0; d < days.length; d++) {
      var day = days[d];
      var dateText = day.date;
      if (!dateText) continue;
      var dateInt = parseInt(String(dateText).replace(/-/g, ""), 10);
      if (!isFinite(dateInt)) continue;
      var entries = day.gridEntries || [];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var duration = entry.duration || {};
        var start = this._restIsoToHhmm(duration.start);
        var end = this._restIsoToHhmm(duration.end);
        if (!start || !end) continue;
        var status = String(entry.status || "REGULAR").toUpperCase();
        var ids = entry.ids || [];
        var event = {
          id: ids.length ? ids[0] : null,
          date: dateInt,
          startTime: start,
          endTime: end,
          type: "ls",
          code: null,
          teachers: this._restPositions(entry, "position1"),
          subjects: this._restPositions(entry, "position2"),
          rooms: this._restPositions(entry, "position3"),
          substText: entry.substitutionText || "",
          info: entry.lessonInfo || entry.lessonText || "",
        };
        if (status === "CANCELLED" || status === "CANCELLED_PERIOD" || status === "ABSENT") {
          event.type = "oh";
          event.code = "cancelled";
        } else if (event.substText || entry.moved) {
          event.type = "sb";
          event.code = "substitution";
        }
        events.push(event);
      }
    }
    return events;
  };

  global.WU = {
    WebUntisClient: WebUntisClient,
    WebUntisError: WebUntisError,
    CookieJar: CookieJar,
    httpRequest: httpRequest,
    parseLesson: parseLesson,
    buildSchedule: buildSchedule,
    formatTime: formatTime,
    toMinutes: toMinutes,
    normalizeBaseUrl: normalizeBaseUrl,
    normalizeShort: normalizeShort,
    parseResponseJson: parseResponseJson,
    isoDate: isoDate,
    compactDate: compactDate,
  };
})(window);
