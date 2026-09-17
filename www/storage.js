(function (global) {
  "use strict";

  var KEY_SETTINGS = "mu-settings";
  var KEY_HOMEWORK = "mu-homework";
  var KEY_NOTIFIED = "mu-notified";

  // Vorbelegte Zugangsdaten. URL, Schule und Benutzername sind gesetzt, damit
  // beim ersten Start nur noch das Passwort eingegeben werden muss. Das
  // Passwort wird danach lokal auf dem Gerät gespeichert (nicht im Repo!).
  var DEFAULT_SETTINGS = {
    webuntis: {
      url: "https://anno-gym-siegburg.webuntis.com",
      school: "anno-gym-siegburg",
    },
    credentials: {
      username: "EF",
      password: "",
    },
    timetable: {
      type: "auto",
      element_type: "student",
      element_id: "",
    },
    filter: {
      hidden_subjects: [],
      my_subjects: [
        "D  g1",
        "E  g5",
        "MU g2",
        "GE g1",
        "SW g1",
        "M  g4",
        "PH g3",
        "BI g1",
        "IF g1",
        "KR g2",
        "SP g5",
        "05A",
      ],
    },
    ntfy: {
      host: "",
      topic: "",
      enabled: false,
    },
    poller: {
      interval_minutes: 20,
    },
    mock: false,
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function readJson(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function mergeSection(target, source) {
    if (!source || typeof source !== "object") return;
    Object.keys(source).forEach(function (k) {
      target[k] = source[k];
    });
  }

  function loadSettings() {
    var stored = readJson(KEY_SETTINGS, null);
    var settings = clone(DEFAULT_SETTINGS);
    if (stored && typeof stored === "object") {
      ["webuntis", "credentials", "timetable", "filter", "ntfy", "poller"].forEach(function (section) {
        if (stored[section] && typeof stored[section] === "object") {
          mergeSection(settings[section], stored[section]);
        }
      });
    }
    return settings;
  }

  function saveSettings(settings) {
    writeJson(KEY_SETTINGS, settings);
  }

  function loadHomework() {
    var items = readJson(KEY_HOMEWORK, []);
    if (!Array.isArray(items)) return [];
    return items.filter(function (i) {
      return i && typeof i === "object";
    });
  }

  function saveHomework(items) {
    writeJson(KEY_HOMEWORK, items);
  }

  function sortHomework(items) {
    function key(item) {
      var done = !!item.done;
      var due = item.due || "";
      var ident = item.id || "";
      var created = item.created || "";
      if (done) return [1, 1, created, ident];
      if (due) return [0, 0, due, ident];
      return [0, 1, created, ident];
    }
    return items.slice().sort(function (a, b) {
      var ka = key(a);
      var kb = key(b);
      for (var i = 0; i < 4; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  }

  function loadNotified() {
    var arr = readJson(KEY_NOTIFIED, []);
    return new Set(Array.isArray(arr) ? arr : []);
  }

  function saveNotified(set) {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 10);
    var cutoffText =
      cutoff.getFullYear() +
      "-" +
      String(cutoff.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(cutoff.getDate()).padStart(2, "0");
    var keep = [];
    set.forEach(function (key) {
      if (String(key).split(":")[0] >= cutoffText) keep.push(key);
    });
    keep.sort();
    writeJson(KEY_NOTIFIED, keep);
  }

  global.MUStorage = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadHomework: loadHomework,
    saveHomework: saveHomework,
    sortHomework: sortHomework,
    loadNotified: loadNotified,
    saveNotified: saveNotified,
  };
})(window);
