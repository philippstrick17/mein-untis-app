// Laufzeit-Konfiguration für "Mein Untis".
//
// proxyBase: Adresse des CORS-Proxys (Cloudflare Worker), siehe worker/.
//   Wird nur im Browser-/PWA-Betrieb gebraucht, weil WebUntis keine direkten
//   Browser-Anfragen erlaubt. In der nativen App (Capacitor) übernimmt
//   CapacitorHttp und dieser Wert wird ignoriert.
//
// Nach dem Worker-Deploy hier die eigene URL eintragen, z. B.:
//   proxyBase: "https://mein-untis-proxy.dein-name.workers.dev"
window.MU_CONFIG = {
  proxyBase: "",
};
