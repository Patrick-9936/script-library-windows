// Builds the desktop window UI.
//
// The website is already shipped as one self-contained HTML file, so the desktop
// app reuses it instead of keeping a second copy of the interface. Only the parts
// that talk to the network are patched: inside the desktop shell every request
// goes through Rust, which avoids CORS entirely and lets the app keep its session
// in the same place the phone app keeps it.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

// dirname three times: desktop/scripts/build-ui.mjs -> repository root.
// A URL pathname would keep the leading slash and break on Windows (`D:\D:\a\...`).
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = path => readFileSync(join(root, path), "utf8");

for (const path of ["web/app.js", "web/script-source.js", "web/settings-sync.js", "web/battle-rules.js"]) {
  new Script(read(path), { filename: path });
}

let app = read("web/app.js");

// Every patch is anchored on an exact line. If the site changes and a line moves,
// the build stops instead of silently shipping an app that cannot reach the API.
const patches = [
  {
    name: "сохранение загрузок в native manager",
    from: '    const blob = new Blob([sourceForUse(content)], {type:"application/octet-stream"});',
    to: [
      '    if (desktop && typeof window.__SL_DESKTOP_DOWNLOAD__ === "function") {',
      '      const name = (script.name || "script").replace(/[\\\\/:*?"<>|]/g, "_").replace(/(?:\\.lua)?(?:\\.txt)?$/i, "") + ".lua";',
      '      await window.__SL_DESKTOP_DOWNLOAD__({ name, content: sourceForUse(content) });',
      '      return;',
      '    }',
      '    const blob = new Blob([sourceForUse(content)], {type:"application/octet-stream"});',
    ].join("\n"),
  },
  {
    name: "desktop режим",
    from: '  const bundled = location.hostname === "patrick-9936.github.io";',
    to: [
      '  const desktop = Boolean(window.__TAURI__);',
      '  const bundled = desktop || location.hostname === "patrick-9936.github.io";',
    ].join("\n"),
  },
  {
    name: "мост к Rust",
    from: '  const publicOrigin = location.origin;',
    to: [
      '  const publicOrigin = location.origin;',
      '  // Desktop shell: one command in, one plain object out.',
      '  const desktopCall = (command, args) => window.__TAURI__.core.invoke(command, args);',
      '  const desktopOpen = link => {',
      '    const value = String(link ?? "");',
      '    if (!/^(https?:|nullsbrawl:)/i.test(value)) return;',
      '    desktopCall("sl_open", { url: value }).catch(() => {});',
      '  };',
      '  const desktopRequest = async (path, options, headers) => {',
      '    const result = await desktopCall("sl_api", {',
      '      path,',
      '      method: (options.method || "GET").toUpperCase(),',
      '      body: typeof options.body === "string" ? options.body : null,',
      '      headers: Object.fromEntries(headers.entries()),',
      '    });',
      '    const lower = {};',
      '    for (const [key, value] of Object.entries(result.headers || {})) lower[String(key).toLowerCase()] = value;',
      '    return {',
      '      ok: result.status >= 200 && result.status < 300,',
      '      status: result.status,',
      '      headers: { get: name => lower[String(name).toLowerCase()] ?? null },',
      '      json: async () => result.json,',
      '    };',
      '  };',
      '  // A link to the catalogue site is a link inside the app, not away from it.',
      '  const desktopRoute = href => {',
      '    let url;',
      '    try { url = new URL(href, location.href); } catch { return null; }',
      '    const hostname = url.hostname.toLowerCase();',
      '    const host = (hostname === "scripting.nulls.gg" || hostname === "scripting.donutquine.dev") ? "catalogue" : hostname === "patrick-9936.github.io" ? "site" : null;',
      '    if (!host) return null;',
      '    const parts = url.pathname.split("/").filter(Boolean);',
      '    if (host === "site") return "/" + parts.join("/");',
      '    if (parts[0] === "scripts" && /^[0-9a-f-]{36}$/i.test(parts[1] || "")) return "/scripts/" + parts[1];',
      '    if ((parts[0] === "users" || parts[0] === "authors") && parts[1]) return "/authors/" + encodeURIComponent(parts[1].replace(/^@/, ""));',
      '    if (parts[0] === "maps") return "/maps";',
      '    if (parts[0] === "favorites") return "/favorites";',
      '    return parts.length ? null : "/";',
      '  };',
      '  if (desktop) {',
      '    // Links to the game and battle rooms belong to the system, not to the',
      '    // window: navigating the webview away would lose the session.',
      '    document.addEventListener("click", event => {',
      '      const anchor = event.target?.closest?.("a[href]");',
      '      if (!anchor) return;',
      '      const href = anchor.getAttribute("href") || "";',
      '      if (!/^(https?:|nullsbrawl:)/i.test(href)) return;',
      '      event.preventDefault();',
      '      const route = desktopRoute(href);',
      '      if (route) location.hash = "#" + route;',
      '      else desktopOpen(href);',
      '    }, true);',
      '  }',
    ].join("\n"),
  },
  {
    name: "запросы через Rust",
    from: '    const response = await fetch(apiOrigin + path, { credentials: bundled ? "omit" : "same-origin", ...options, signal:options.signal||AbortSignal.timeout(25000), headers });',
    to: '    const response = desktop ? await desktopRequest(path, options, headers) : await fetch(apiOrigin + path, { credentials: bundled ? "omit" : "same-origin", ...options, signal:options.signal||AbortSignal.timeout(25000), headers });',
  },
  {
    name: "запуск игры",
    from: '      location.href = link;',
    to: '      if (desktop) desktopOpen(link); else location.href = link;',
  },
];

for (const patch of patches) {
  if (!app.includes(patch.from)) throw new Error(`Desktop patch "${patch.name}" больше не совпадает с исходником`);
  app = app.split(patch.from).join(patch.to);
}

// A broken replacement must fail the build here, not in the window.
new Script(app, { filename: "web/app.js (desktop)" });

const locales = {};
for (const code of ["ru", "en", "kk", "uk", "be", "pl", "sr", "hu", "zh-Hans", "ja", "pt-BR", "es", "it", "de", "nl"]) {
  locales[code] = JSON.parse(read("i18n/" + code + ".json"));
}

const brawlerIcons = {};
for (const file of readdirSync(join(root, "web/brawler-icons"))) {
  const type = file.endsWith(".png") ? "image/png" : file.endsWith(".svg") ? "image/svg+xml" : "image/webp";
  brawlerIcons[file.split(".")[0]] = "data:" + type + ";base64," + readFileSync(join(root, "web/brawler-icons", file)).toString("base64");
}

const escape = source => source.replace(/<\/script/gi, "<\\/script");
const page = read("web/index.html")
  .replace("__STYLE__", () => read("web/style.css").replace(/<\/style/gi, "<\\/style"))
  .replace("__SCRIPT_SOURCE__", () => escape(read("web/script-source.js")))
  .replace("__SETTINGS_SYNC__", () => escape(read("web/settings-sync.js")))
  .replace("__SCRIPT__", () => escape(app))
  .replace("__BATTLE_RULES__", () => escape(read("web/battle-rules.js")))
  .replace("__I18N__", () => JSON.stringify(locales))
  .replace("__BATTLE__", () => JSON.stringify(JSON.parse(read("web/battle-config.json"))))
  .replace("__BRAWLERS__", () => read("web/brawlers.json"))
  .replace("__BRAWLER_ICONS__", () => JSON.stringify(brawlerIcons));

if (/__STYLE__|__SCRIPT__|__BATTLE__|__I18N__|__BRAWLERS__|__BRAWLER_ICONS__|__SCRIPT_SOURCE__|__SETTINGS_SYNC__|__BATTLE_RULES__/.test(page)) {
  throw new Error("Не подставился один из ресурсов страницы");
}

// Desktop-only chrome lives in its own files so the shared page stays untouched.
const chrome = page
  .replace("</head>", () => `<style>${read("desktop/web/app-desktop.css")}</style></head>`)
  .replace("</body>", () => `<script>${escape(read("desktop/web/app-desktop.js"))}</script></body>`);
if (chrome === page || !chrome.includes("sl-titlebar")) {
  throw new Error("Не удалось встроить оболочку рабочего стола");
}

mkdirSync(join(root, "desktop/ui"), { recursive: true });
writeFileSync(join(root, "desktop/ui/index.html"), chrome);
cpSync(join(root, "web/validator"), join(root, "desktop/ui/validator"), { recursive: true });
console.log("UI для десктопа собран:", Buffer.byteLength(page), "байт");
