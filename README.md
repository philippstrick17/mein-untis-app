# Mein Untis

Persönlicher Stundenplan mit eigenen Kursen, Freistunden, Sonderfrei („05A“)
und Hausaufgaben – aus WebUntis gelesen, ohne eigenen Server.

Es gibt **drei Wege**, die App zu nutzen:

| Weg | Plattform | Aufwand für Mitschüler |
| --- | --- | --- |
| **PWA** (Web-Version) | iPhone **und** Android | Link öffnen, „Zum Home-Bildschirm“ – kein Store, keine Installation |
| **Android-APK** | Android | APK aus dem Release installieren |
| **Native App** | Android/iOS | Selbst bauen (siehe unten) |

Die **PWA** ist der einfachste Weg für iPhone-Nutzer: Sie läuft in Safari,
benötigt keinen Mac und keinen Apple-Account. Im Hintergrund ruft ein kleiner
kostenloser **Cloudflare Worker** WebUntis ab und umgeht damit die
Browser-CORS-Sperre (siehe „CORS-Proxy“).

---

## Für Mitschüler: So nutzt du die App

### iPhone (PWA)

1. In **Safari** öffnen: **https://philippstrick17.github.io/mein-untis-app/**
2. Unten auf **Teilen** → **„Zum Home-Bildschirm“** → „Hinzufügen“.
3. Das neue Icon auf dem Home-Bildschirm öffnen.
4. Einmal anmelden (siehe unten).

> Benachrichtigungen laufen wie bei Android über die **ntfy**-App – die PWA
> selbst verschickt keine Web-Pushes.

### Android (APK)

1. Die Datei `mein-untis.apk` aus dem **Releases**-Bereich dieses Repos laden
   und öffnen. Android fragt nach der Erlaubnis, Apps aus dieser Quelle zu
   installieren – bestätigen.

### Einmal anmelden

Beim ersten Start sind WebUntis-URL, Schule und Benutzername bereits
eingetragen. Nur noch das **Passwort des EF-Kontos** eingeben und „Anmelden“
tippen. Das Passwort bleibt ausschließlich auf dem Gerät gespeichert (bzw. im
Browser-Speicher) – ab dann startet die App automatisch angemeldet.

### Bedienung

- **Stundenplan:** oben die Woche wechseln, „Heute“, ◐ fürs Design, ⟳ zum
  Aktualisieren. In den **Einstellungen** (⚙) unter „Meine Kurse“ auswählen,
  welche Kurse zu dir gehören – alles andere wird als „Freistunde“ angezeigt.
  Sonderfrei („05A“) wird automatisch berücksichtigt.
- **Hausaufgaben:** über das ✎-Symbol eintragen und abhaken.
- **Benachrichtigungen (optional):** die kostenlose **ntfy**-App
  ([ntfy.sh](https://ntfy.sh), App Store/Play Store) installieren und ein Topic
  abonnieren. In den App-Einstellungen unter „Benachrichtigungen“ denselben
  ntfy-Server und das Topic eintragen, aktivieren und **Test senden**. Die App
  prüft dann regelmäßig (Standard: alle 20 Minuten) auf Ausfälle/Vertretungen
  und schickt einen Push.

---

## CORS-Proxy (nur für die PWA nötig)

Damit die Web-Version funktioniert, wird die WebUntis-Adresse über einen
Cloudflare Worker geleitet (`worker/`). Der Worker ruft WebUntis serverseitig
auf und reicht die Antwort mit passenden CORS-Headern zurück. Cookies werden
dabei nicht über den Browser gehalten, sondern über den Header `X-MU-Cookie`
transportiert – so funktioniert es auch trotz Safari-ITP.

Sicherheit: Der Worker lässt **nur WebUntis-Hosts** als Ziel und **nur die
konfigurierte Seiten-Origin** als Aufrufer zu (`worker/wrangler.toml`).

### Einmalig einrichten

1. Kostenloses Cloudflare-Konto anlegen (falls noch nicht vorhanden).
2. Worker veröffentlichen:

   ```bash
   cd worker
   npx wrangler login    # öffnet den Browser
   npx wrangler deploy
   ```

   Die Ausgabe enthält die Worker-URL, z. B.
   `https://mein-untis-proxy.dein-name.workers.dev`.

3. Diese URL in **`www/config.js`** eintragen:

   ```js
   window.MU_CONFIG = { proxyBase: "https://mein-untis-proxy.dein-name.workers.dev" };
   ```

4. Committen und pushen. GitHub Actions veröffentlicht `www/` automatisch auf
   **GitHub Pages** (Workflow `pages.yml`).

Alternative ohne lokalem Wrangler: Im Repo die Secrets
`CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` hinterlegen; dann deployt
der Workflow `deploy-worker.yml` den Worker automatisch.

> GitHub Pages muss einmal unter **Settings → Pages → Source: GitHub Actions**
> aktiviert werden.

### Lokal testen (Browser)

```bash
cd worker && npx wrangler dev --port 8787     # Proxy läuft auf http://localhost:8787
```

`proxyBase` in `www/config.js` auf `http://localhost:8787` setzen und `www/`
z. B. mit `python3 -m http.server 8080` ausliefern. `localhost` ist als Origin
bereits erlaubt.

---

## Native App bauen (für den Maintainer)

Voraussetzungen: **Node.js 22+** und npm. Für die jeweilige Plattform:

- **Android:** Android Studio (JDK + Android SDK)
- **iOS:** macOS mit Xcode + Apple-ID

```bash
npm install
npx cap add android      # Android-Plattform anlegen
npx cap add ios          # nur auf macOS sinnvoll
npx cap sync
```

In der nativen App übernimmt **CapacitorHttp** den WebUntis-Zugriff; der
CORS-Proxy aus `www/config.js` wird dort ignoriert.

### Android-APK erzeugen

```bash
npx cap open android     # öffnet Android Studio
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Die
fertige Datei liegt unter
`android/app/build/outputs/apk/debug/app-debug.apk`. Für eine signierte
Release-APK: **Build → Generate Signed Bundle / APK**.

### iOS nativ (aufwendiger)

```bash
npx cap open ios         # öffnet Xcode (nur macOS)
```

- **Kostenlose Apple-ID:** App läuft 7 Tage, danach neu installieren; nur auf
  eigenen Geräten.
- **Apple Developer Program (99 €/Jahr):** Verteilung an Freunde per TestFlight
  (bis 10.000 Tester) oder App Store. Ein Mac ist dafür nicht zwingend nötig –
  bauen lässt sich auch auf einem macOS-Runner in der Cloud (GitHub Actions,
  Codemagic, Ionic Appflow).
- **Ohne Apple-Account und ohne Mac:** die PWA nutzen.

### Updates verteilen

- **PWA:** einfach pushen – GitHub Pages und Worker aktualisieren sich
  automatisch.
- **Android:** nach `npx cap sync` neu bauen und die APK im GitHub-Release
  ersetzen. Die App-Einstellungen bleiben beim Drüberinstallieren erhalten.

---

## Technischer Aufbau

- `www/webuntis.js` – WebUntis-Client (Port der Python-Logik): Login, JWT,
  `getTimetable`/REST-Fallback, `buildSchedule` (Freistunden, Sonderfrei,
  Filter). Nutzt `CapacitorHttp` (nativ) bzw. den CORS-Proxy (Browser).
- `www/storage.js` – lokale Speicherung via `localStorage` (Einstellungen,
  Zugangsdaten, Hausaufgaben, „bereits benachrichtigt“-Set).
- `www/localapi.js` – setzt die `/api/...`-Routen lokal um (Status, Login,
  Einstellungen, Stundenplan, Hausaufgaben, ntfy-Push).
- `www/app.js` – Oberfläche; nutzt `window.LocalAPI` statt eines Servers.
- `www/config.js` – Laufzeit-Konfiguration (Proxy-URL).
- `www/manifest.webmanifest`, `www/icon-*.png` – PWA-Manifest und -Icons.
- `worker/` – Cloudflare Worker als CORS-Proxy für den Browserbetrieb.
- `.github/workflows/` – Deploy von PWA (GitHub Pages) und Worker.

### Zugangsdaten

In `www/storage.js` sind nur URL, Schule und Benutzername vorbelegt. Das
**Passwort steht bewusst nicht im Repository** und wird beim ersten Start
einmalig eingegeben und lokal auf dem Gerät gespeichert.
