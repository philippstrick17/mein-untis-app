# Mein Untis (App)

Persönlicher Stundenplan als **native App** für Android und iOS – ohne eigenen
Server. Die App spricht direkt mit WebUntis (JSON-RPC + REST) über die native
HTTP-Schicht von Capacitor (`CapacitorHttp`), die Browser-CORS umgeht.

Es ist ein **eigenständiges Projekt** und unabhängig von der Flask-Version.
Raspberry Pi, WLAN und Tailscale werden nicht benötigt.

---

## Für Mitschüler: So nutzt du die App

1. **APK installieren.** Die Datei `mein-untis.apk` vom Maintainer bekommen
   (z. B. über den „Releases“-Bereich dieses Repos) und auf dem Android-Handy
   öffnen. Android fragt nach der Erlaubnis, Apps aus dieser Quelle zu
   installieren – bestätigen.

   > iPhone: Eine native App braucht einen Mac + Apple-Account zum Installieren.
   > Alternativ die Web-Version in Safari öffnen und „Zum Home-Bildschirm“ wählen.

2. **Einmal anmelden.** Beim ersten Start sind WebUntis-URL, Schule und
   Benutzername bereits eingetragen. Nur noch das **Passwort des EF-Kontos**
   eingeben und „Anmelden“ tippen. Das Passwort bleibt ausschließlich auf dem
   Gerät gespeichert – ab dann startet die App automatisch angemeldet.

3. **Stundenplan ansehen.** Oben die Woche wechseln („Heute“, ◐ fürs Design,
   ⟳ zum Aktualisieren). In den **Einstellungen** (⚙) unter „Meine Kurse“
   auswählen, welche Kurse zu dir gehören – alles andere wird als
   „Freistunde“ angezeigt. Sonderfrei („05A“) wird automatisch berücksichtigt.

4. **Hausaufgaben** über das ✎-Symbol eintragen und abhaken.

5. **Benachrichtigungen (optional).** Die kostenlose **ntfy**-App
   ([ntfy.sh](https://ntfy.sh), App Store/Play Store) installieren und ein
   Topic abonnieren. In den App-Einstellungen unter
   „Benachrichtigungen“ denselben ntfy-Server und das Topic eintragen,
   aktivieren und **Test senden**. Die App prüft dann im Hintergrund
   (Standard: alle 20 Minuten) auf Ausfälle/Vertretungen und schickt einen Push.

---

## Bauen (für den Maintainer)

Voraussetzungen: **Node.js 22+** und npm. Für die jeweilige Plattform:

- **Android:** Android Studio (JDK + Android SDK)
- **iOS:** macOS mit Xcode + Apple-ID

```bash
npm install
npx cap add android      # Android-Plattform anlegen
npx cap add ios          # nur auf macOS sinnvoll
npx cap sync
```

### Android-APK erzeugen

```bash
npx cap open android     # öffnet Android Studio
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
Die fertige Datei liegt unter
`android/app/build/outputs/apk/debug/app-debug.apk` und lässt sich direkt auf
jedem Android-Handy installieren. Für eine signierte Release-APK:
**Build → Generate Signed Bundle / APK**.

### iOS

```bash
npx cap open ios         # öffnet Xcode (nur macOS)
```

In Xcode ein Signing-Team wählen und auf dem iPhone starten.

- **Kostenlose Apple-ID:** App läuft 7 Tage, danach neu installieren; nur auf
  eigenen Geräten.
- **Apple Developer Program (99 €/Jahr):** Verteilung an Freunde per TestFlight
  oder App Store.
- **Ohne Mac:** Eine native iOS-App lässt sich nicht bauen.

### Updates an Mitschüler verteilen

Nach Änderungen neu bauen und die APK im **GitHub-Release** ersetzen bzw. ein
neues Release anlegen. Mitschüler laden die neue APK herunter und installieren
sie darüber (Einstellungen bleiben erhalten).

### In der Entwicklung testen

Ein Test im normalen Browser scheitert an CORS (WebUntis sendet keine
CORS-Header). Zum Testen auf Gerät/Emulator:

```bash
npx cap run android
```

Nach Änderungen an `www/` immer `npx cap sync` ausführen.

---

## Technischer Aufbau

- `www/webuntis.js` – WebUntis-Client (Port der Python-Logik): Login, JWT,
  `getTimetable`/REST-Fallback, `buildSchedule` (Freistunden, Sonderfrei, Filter).
- `www/storage.js` – lokale Speicherung via `localStorage` (Einstellungen,
  Zugangsdaten, Hausaufgaben, „bereits benachrichtigt“-Set).
- `www/localapi.js` – setzt die `/api/...`-Routen lokal um (Status, Login,
  Einstellungen, Stundenplan, Hausaufgaben, ntfy-Push).
- `www/app.js` – Oberfläche; nutzt `window.LocalAPI` statt eines Servers.

### Zugangsdaten

In `www/storage.js` sind nur URL, Schule und Benutzername vorbelegt. Das
**Passwort steht bewusst nicht im Repository** und wird beim ersten Start
einmalig eingegeben und lokal auf dem Gerät gespeichert.
