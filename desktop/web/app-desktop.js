// Desktop chrome. Runs inside the same page the site serves, so it must not
// depend on anything the page does not already expose.
(() => {
  if (!window.__TAURI__) return;

  const call = (command, args) => window.__TAURI__.core.invoke(command, args);
  const STORE = "script-library-desktop";

  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}") || {};
    } catch {
      return {};
    }
  };
  const write = change => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...read(), ...change }));
    } catch {
      /* Settings are a convenience, not a requirement. */
    }
  };

  const sendSystemNotification = async (title, body, askPermission) => {
    if (read().notifications === false) return false;
    const api = window.__TAURI__.notification;
    if (!api?.isPermissionGranted || !api?.sendNotification) return false;
    try {
      let granted = await api.isPermissionGranted();
      if (!granted && askPermission && api.requestPermission) {
        granted = (await api.requestPermission()) === "granted";
      }
      if (!granted) return false;
      api.sendNotification({ title, body });
      return true;
    } catch {
      return false;
    }
  };

  call("sl_set_close_to_tray", { enabled: read().closeToTray !== false }).catch(() => {});

  if (window.__TAURI__.window?.getCurrentWindow?.().label === "main") {
    setTimeout(async () => {
      if (read().notifications === false) return;
      try {
        const update = await call("sl_check_update");
        if (update?.available) {
          await sendSystemNotification("Доступно обновление Script Library", `Версия ${update.latest} уже вышла.`, true);
        }
      } catch {
        /* A failed update check should not interrupt app startup. */
      }
    }, 8000);
  }

  const compact = read().compact === true;
  if (compact) document.body.classList.add("sl-compact");

  const icons = {
    minimize: '<svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg>',
    maximize: '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg>',
    restore: '<svg viewBox="0 0 10 10"><rect x="1" y="3" width="6" height="6"/><path d="M3 3V1h6v6H7"/></svg>',
    close: '<svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>',
  };

  const bar = document.createElement("div");
  bar.className = "sl-titlebar";
  bar.innerHTML = [
    '<div class="sl-titlebar-drag" data-tauri-drag-region></div>',
    '<button class="sl-icon-button" id="sl-sidebar-toggle" type="button" title="Свернуть панель (Ctrl+B)" aria-label="Свернуть панель">',
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4h12M2 8h12M2 12h12"/></svg>',
    "</button>",
    '<button class="sl-download-toggle" id="sl-downloads-toggle" type="button" title="Загрузки" aria-label="Открыть менеджер загрузок" aria-expanded="false"><span aria-hidden="true">↓</span><span class="sl-download-count" hidden></span></button>',
    '<span class="sl-titlebar-title" data-tauri-drag-region>Script Library</span>',
    '<div class="sl-window-buttons">',
    `<button class="sl-window-button" data-window="minimize" type="button" title="Свернуть">${icons.minimize}</button>`,
    `<button class="sl-window-button" data-window="maximize" type="button" title="Развернуть">${icons.maximize}</button>`,
    `<button class="sl-window-button close" data-window="close" type="button" title="Закрыть">${icons.close}</button>`,
    "</div>",
  ].join("");

  document.body.prepend(bar);

  /* ----------------------------------------------------- downloads */

  const downloadTasks = [];
  const pendingDownloads = [];
  let downloadBusy = false;
  let downloadPanel = null;
  const downloadButton = bar.querySelector("#sl-downloads-toggle");
  const downloadStatusLabel = status => ({
    queued: "В очереди",
    choosing: "Выбери место сохранения…",
    saving: "Сохраняю…",
    saved: "Сохранено",
    canceled: "Отменено",
    failed: "Ошибка",
  })[status] || status;

  const renderDownloads = () => {
    const active = downloadTasks.filter(task => task.status === "queued" || task.status === "choosing" || task.status === "saving").length;
    const badge = downloadButton?.querySelector(".sl-download-count");
    if (badge) {
      badge.hidden = active === 0;
      badge.textContent = active > 9 ? "9+" : String(active);
    }
    if (!downloadPanel) return;
    const list = downloadPanel.querySelector(".sl-download-list");
    list.replaceChildren();
    if (!downloadTasks.length) {
      const empty = document.createElement("p");
      empty.className = "sl-download-empty";
      empty.textContent = "Здесь появятся скачиваемые Lua-файлы.";
      list.append(empty);
      return;
    }
    for (const task of downloadTasks.slice(0, 40)) {
      const row = document.createElement("div");
      row.className = "sl-download-row";
      const name = document.createElement("strong");
      name.textContent = task.name;
      const state = document.createElement("span");
      state.className = "sl-download-status" + (task.status === "failed" ? " error" : "");
      state.textContent = task.error ? `${downloadStatusLabel(task.status)}: ${task.error}` : downloadStatusLabel(task.status);
      if (task.path && task.status === "saved") {
        const path = document.createElement("small");
        path.textContent = task.path;
        row.append(name, state, path);
      } else {
        row.append(name, state);
      }
      list.append(row);
    }
  };

  const closeDownloadManager = () => {
    downloadPanel?.remove();
    downloadPanel = null;
    if (downloadButton) downloadButton.setAttribute("aria-expanded", "false");
  };

  const openDownloadManager = () => {
    if (downloadPanel) return;
    const root = document.createElement("section");
    root.className = "sl-download-manager";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Менеджер загрузок");
    root.innerHTML = '<header><strong>Загрузки</strong><button type="button" data-download-close aria-label="Закрыть">✕</button></header><div class="sl-download-list" aria-live="polite"></div><footer><span>Lua сохраняются в выбранное место</span><button type="button" data-download-clear>Очистить завершённые</button></footer>';
    root.querySelector("[data-download-close]").onclick = closeDownloadManager;
    root.querySelector("[data-download-clear]").onclick = () => {
      for (let index = downloadTasks.length - 1; index >= 0; index -= 1) {
        if (["saved", "canceled", "failed"].includes(downloadTasks[index].status)) downloadTasks.splice(index, 1);
      }
      renderDownloads();
    };
    document.body.append(root);
    downloadPanel = root;
    if (downloadButton) downloadButton.setAttribute("aria-expanded", "true");
    renderDownloads();
  };

  downloadButton?.addEventListener("click", () => downloadPanel ? closeDownloadManager() : openDownloadManager());

  const safeDownloadName = name => {
    const stem = String(name || "script")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\.(?:lua|luau|txt)$/i, "")
      .trim() || "script";
    return `${stem}.lua`;
  };

  const processDownloads = async () => {
    if (downloadBusy) return;
    downloadBusy = true;
    while (pendingDownloads.length) {
      const task = pendingDownloads.shift();
      task.status = "choosing";
      renderDownloads();
      try {
        const path = await window.__TAURI__.dialog.save({
          defaultPath: task.name,
          filters: [{ name: "Lua", extensions: ["lua", "luau"] }],
        });
        if (!path) {
          task.status = "canceled";
          continue;
        }
        task.status = "saving";
        renderDownloads();
        task.path = await call("sl_save_download", { path, content: task.content });
        task.status = "saved";
        if (read().notifications !== false) void sendSystemNotification("Файл сохранён", task.name, false);
      } catch (error) {
        task.status = "failed";
        task.error = String(error?.message || error || "Не удалось сохранить файл.").replace(/\\s+/g, " ").slice(0, 140);
      } finally {
        task.content = "";
        task.resolve();
        renderDownloads();
      }
    }
    downloadBusy = false;
  };

  window.__SL_DESKTOP_DOWNLOAD__ = ({ name, content }) => new Promise(resolve => {
    const task = { name: safeDownloadName(name), content: String(content ?? ""), status: "queued", resolve };
    downloadTasks.unshift(task);
    if (downloadTasks.length > 100) downloadTasks.length = 100;
    pendingDownloads.push(task);
    renderDownloads();
    void processDownloads();
  });

  const toggle = document.getElementById("sl-sidebar-toggle");
  toggle?.addEventListener("click", () => {
    const next = !document.body.classList.contains("sl-compact");
    document.body.classList.toggle("sl-compact", next);
    write({ compact: next });
  });

  bar.addEventListener("click", event => {
    const button = event.target.closest("[data-window]");
    if (!button) return;
    call("sl_window", { action: button.dataset.window }).catch(() => {});
  });

  // The maximised button has a different glyph and meaning.
  const maximizeButton = bar.querySelector('[data-window="maximize"]');
  const syncMaximized = async () => {
    try {
      const maximized = await call("sl_window_state");
      if (!maximizeButton) return;
      maximizeButton.innerHTML = maximized ? icons.restore : icons.maximize;
      maximizeButton.title = maximized ? "Восстановить" : "Развернуть";
      maximizeButton.dataset.window = "maximize";
    } catch {
      /* Older builds without the command simply keep one glyph. */
    }
  };
  void syncMaximized();
  setInterval(syncMaximized, 1200);

  document.addEventListener("keydown", event => {
    if (event.key.toLowerCase() === "b" && (event.ctrlKey || event.metaKey) && !event.altKey) {
      event.preventDefault();
      toggle?.click();
    }
  });

  // Mica is applied by the window layer when Windows 11 supports it; the class
  // only relaxes the page background so the material is visible.
  call("sl_window_material").then(active => {
    if (active) document.body.classList.add("sl-mica");
  }).catch(() => {});

  /* ---------------------------------------------------------------- palette */

  let palette = null;

  const closePalette = () => {
    palette?.remove();
    palette = null;
  };

  const inMini = () => document.body.classList.contains("sl-mini");

  const go = route => {
    if (inMini()) call("sl_main_navigate", { route }).catch(() => {});
    else location.hash = "#" + route;
    closePalette();
  };

  const openWindow = (route, mini = false) => {
    call("sl_window_open", { route: route ?? "", mini }).catch(() => {});
    closePalette();
  };

  const openMini = () => {
    call("sl_window_open", { route: "", mini: true }).catch(() => {});
    closePalette();
  };

  // The catalogue the page already downloaded is the palette's index.
  const catalogue = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("script-library-catalog") || "null");
      if (!saved || saved.expires <= Date.now()) return { authors: [], scripts: [] };
      return {
        authors: Array.isArray(saved.data?.authors) ? saved.data.authors : [],
        scripts: Array.isArray(saved.data?.scripts) ? saved.data.scripts : [],
      };
    } catch {
      return { authors: [], scripts: [] };
    }
  };

  const entries = () => {
    const { authors, scripts } = catalogue();
    const list = [
      { title: "Библиотека", hint: "раздел", route: "/" },
      { title: "Авторы", hint: "раздел", route: "/authors" },
      { title: "Карты", hint: "раздел", route: "/maps" },
      { title: "Мои скрипты", hint: "раздел", route: "/mine" },
      { title: "Избранное", hint: "раздел", route: "/favorites" },
      { title: "Аккаунт", hint: "раздел", route: "/account" },
      { title: "Мини-поиск", hint: "окно", action: openMini },
      { title: "Новое окно", hint: "окно", action: () => openWindow("") },
      { title: "Настройки приложения", hint: "Ctrl+,", action: () => openSettings() },
      { title: "Новое окно поиска поверх всех", hint: "мини", action: () => openWindow("", true) },
    ];
    for (const author of authors) {
      list.push({
        title: author.name || author.username || "Автор",
        hint: "@" + (author.username || author.uuid || ""),
        route: "/authors/" + encodeURIComponent(author.username || author.uuid || ""),
      });
    }
    for (const script of scripts) {
      list.push({
        title: script.name || "Без названия",
        hint: "@" + (script.author_username || script.author_name || ""),
        route: "/scripts/" + (script.uuid || ""),
      });
    }
    return list;
  };

  const openPalette = () => {
    if (palette) return;
    const all = entries();
    const root = document.createElement("div");
    root.className = "sl-palette";
    root.innerHTML = [
      '<div class="sl-palette-box">',
      '<input class="sl-palette-input" type="text" spellcheck="false" placeholder="Скрипт, автор или раздел…" aria-label="Командная палитра">',
      '<div class="sl-palette-list" role="listbox"></div>',
      '<div class="sl-palette-hint"><span>↑ ↓ выбрать</span><span>Enter открыть</span><span>Ctrl+Enter новое окно</span><span>Esc закрыть</span></div>',
      "</div>",
    ].join("");
    document.body.append(root);
    palette = root;

    const input = root.querySelector(".sl-palette-input");
    const list = root.querySelector(".sl-palette-list");
    let visible = [];
    let active = 0;

    const render = () => {
      const query = input.value.trim().toLowerCase();
      visible = (query
        ? all.filter(item => (item.title + " " + item.hint + " " + (item.route || "")).toLowerCase().includes(query))
        : all
      ).slice(0, 60);
      active = 0;
      list.replaceChildren();
      if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "sl-palette-empty";
        empty.textContent = "Ничего не найдено";
        list.append(empty);
        return;
      }
      visible.forEach((item, index) => {
        const button = document.createElement("button");
        button.className = `sl-palette-item${index === 0 ? " active" : ""}`;
        button.dataset.index = String(index);
        button.type = "button";
        const title = document.createElement("span");
        title.className = "sl-palette-title";
        title.textContent = item.title;
        const hint = document.createElement("span");
        hint.className = "sl-palette-hint-text";
        hint.textContent = item.hint;
        button.append(title, hint);
        list.append(button);
      });
    };

    const highlight = index => {
      const buttons = [...list.querySelectorAll(".sl-palette-item")];
      buttons.forEach((button, position) => button.classList.toggle("active", position === index));
      buttons[index]?.scrollIntoView({ block: "nearest" });
    };

    const run = (item, newWindow) => {
      if (!item) return;
      if (item.action) return item.action();
      return newWindow ? openWindow(item.route) : go(item.route);
    };

    input.addEventListener("input", render);
    input.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "ArrowDown") {
        active = Math.min(active + 1, visible.length - 1);
        highlight(active);
        event.preventDefault();
      } else if (event.key === "ArrowUp") {
        active = Math.max(active - 1, 0);
        highlight(active);
        event.preventDefault();
      } else if (event.key === "Enter") {
        event.preventDefault();
        run(visible[active], event.ctrlKey || event.metaKey);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
      }
    });
    list.addEventListener("click", event => {
      const button = event.target.closest("[data-index]");
      if (!button) return;
      run(visible[Number(button.dataset.index)], event.ctrlKey);
    });
    root.addEventListener("mousedown", event => {
      if (event.target === root) closePalette();
    });

    render();
    input.focus();
  };

  document.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    if (key === "k" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      palette ? closePalette() : openPalette();
    } else if (key === "m" && (event.ctrlKey || event.metaKey) && event.shiftKey) {
      event.preventDefault();
      openMini();
    } else if (key === "n" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
      event.preventDefault();
      openWindow("");
    }
  }, true);

  // The mini window is a small search over everything else.
  document.addEventListener("sl-mini", () => {
    document.body.classList.add("sl-mini");
    openPalette();
  });
  if (new URLSearchParams(location.search).has("mini")) document.body.classList.add("sl-mini");

  /* ------------------------------------------------------- appearance */

  const ACCENTS = [
    ["", "По умолчанию"],
    ["#4265dc", "Синий"],
    ["#0f7b6c", "Зелёный"],
    ["#b35b35", "Терракота"],
    ["#7a4fd3", "Фиолетовый"],
    ["#c2417a", "Малиновый"],
    ["#c8952b", "Янтарный"],
    ["#3b8ea5", "Бирюзовый"],
    ["#5a6472", "Графит"],
  ];

  const normalizeAccent = value => typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : "";

  const appearance = () => ({
    theme: localStorage.getItem("theme") || "system",
    accent: normalizeAccent(localStorage.getItem("accent") || ""),
    density: localStorage.getItem("density") || "comfortable",
  });

  const applyAppearance = () => {
    const value = appearance();
    document.documentElement.dataset.theme = value.theme;
    document.documentElement.style.colorScheme = value.theme === "system" ? "light dark" : value.theme;
    if (value.accent) document.documentElement.style.setProperty("--accent", value.accent);
    else document.documentElement.style.removeProperty("--accent");
    document.body.classList.toggle("sl-dense", value.density === "compact");
    document.body.classList.toggle("sl-spacious", value.density === "spacious");
    document.body.classList.toggle("sl-transparent", read().transparent === true);
  };
  const refreshAppearanceSettings = () => {
    const root = document.querySelector(".sl-settings");
    if (!root) return;
    const value = appearance();
    root.querySelectorAll("[data-segment]").forEach(segment => {
      const selected = value[segment.dataset.segment];
      segment.querySelectorAll("[data-value]").forEach(button => button.classList.toggle("active", button.dataset.value === selected));
    });
    root.querySelectorAll("[data-accent]").forEach(button => button.classList.toggle("active", button.dataset.accent === value.accent));
  };
  window.addEventListener("script-library-preferences-updated", () => { applyAppearance(); refreshAppearanceSettings(); });
  applyAppearance();

  /* ----------------------------------------------------- context menu */

  const entriesFor = event => {
    const entries = [];
    const card = event.target.closest(".script-card");
    const link = event.target.closest("a[href]");
    const field = event.target.closest("input, textarea, [contenteditable='true']");
    const selection = String(window.getSelection() || "").trim();

    if (card) {
      const href = card.getAttribute("href") || "";
      const title = (card.querySelector(".script-title")?.textContent || "Скрипт").trim();
      entries.push({ id: "open:" + href, label: "Открыть: " + title.slice(0, 48) });
      entries.push({ id: "window:" + href, label: "Открыть в новом окне" });
      entries.push({ id: "copy:" + new URL(href, location.href).href, label: "Скопировать ссылку" });
      entries.push({ id: "sep-card", label: "", role: "separator" });
    }

    if (link && !card) {
      entries.push({ id: "browser:" + link.href, label: "Открыть в браузере" });
      entries.push({ id: "copy:" + link.href, label: "Скопировать ссылку" });
      entries.push({ id: "sep-link", label: "", role: "separator" });
    }

    if (field) {
      const readonly = field.readOnly || field.disabled;
      entries.push({ id: "cut", label: "Вырезать", role: "cut", enabled: !readonly });
      entries.push({ id: "copy", label: "Копировать", role: "copy" });
      entries.push({ id: "paste", label: "Вставить", role: "paste", enabled: !readonly });
      entries.push({ id: "select-all", label: "Выделить всё", role: "select-all" });
      entries.push({ id: "sep-field", label: "", role: "separator" });
    } else if (selection) {
      entries.push({ id: "copy", label: "Копировать", role: "copy" });
      entries.push({ id: "sep-selection", label: "", role: "separator" });
    }

    entries.push({ id: "palette", label: "Командная палитра\tCtrl+K" });
    entries.push({ id: "window-new", label: "Новое окно\tCtrl+N" });
    entries.push({ id: "settings", label: "Настройки приложения\tCtrl+," });
    entries.push({ id: "sep-tail", label: "", role: "separator" });
    entries.push({ id: "reload", label: "Обновить страницу" });
    return entries;
  };

  document.addEventListener(
    "contextmenu",
    event => {
      if (event.target.closest(".sl-palette, .sl-settings")) return;
      event.preventDefault();
      call("sl_context_menu", { entries: entriesFor(event) }).catch(() => {});
    },
    true
  );

  const follow = route => {
    const target = route.startsWith("http") ? route : new URL(route, location.href).href;
    location.href = target;
  };

  const handleMenu = action => {
    if (action.startsWith("open:")) return follow(action.slice(5));
    if (action.startsWith("window:")) return openWindow(action.slice(7).replace(/^#?\//, ""));
    if (action.startsWith("browser:")) return call("sl_open", { url: action.slice(8) });
    if (action.startsWith("copy:")) return navigator.clipboard?.writeText(action.slice(5));
    if (action === "palette") return openPalette();
    if (action === "window-new") return openWindow("");
    if (action === "settings") return openSettings();
    if (action === "reload") return location.reload();
    return undefined;
  };

  window.__TAURI__.event.listen("sl-menu", event => {
    Promise.resolve(handleMenu(String(event.payload || ""))).catch(() => {});
  });

  /* -------------------------------------------------------- open file */

  const showFile = file => {
    const root = document.createElement("div");
    root.className = "sl-settings";
    root.innerHTML = [
      '<div class="sl-settings-box" role="dialog" aria-label="Открытый файл">',
      '<header><div><h2 class="sl-settings-title"></h2><p class="sl-settings-path"></p></div>',
      '<button class="sl-settings-close" type="button" title="Закрыть">✕</button></header>',
      '<div class="sl-settings-body"><pre class="sl-file-content"></pre></div>',
      '<footer class="sl-settings-foot">',
      '<button type="button" data-file="code">Открыть в VS Code</button>',
      '<button type="button" data-file="reveal">Показать в проводнике</button>',
      '<button type="button" data-file="copy">Скопировать код</button>',
      '</footer>',
      "</div>",
    ].join("");
    root.querySelector(".sl-settings-title").textContent = file.name;
    root.querySelector(".sl-settings-path").textContent = file.path;
    root.querySelector(".sl-file-content").textContent = file.content;
    root.querySelector(".sl-settings-close").onclick = () => root.remove();
    root.addEventListener("click", event => {
      if (event.target === root) root.remove();
      const button = event.target.closest("[data-file]");
      if (!button) return;
      const action = button.dataset.file;
      if (action === "copy") navigator.clipboard?.writeText(file.content);
      if (action === "reveal") call("sl_reveal", { path: file.path }).catch(() => {});
      if (action === "code") call("sl_open_in_code", { path: file.path }).catch(() => {});
    });
    document.body.append(root);
  };

  const takeFile = () =>
    call("sl_take_opened_file")
      .then(file => (file ? showFile(file) : null))
      .catch(() => null);

  setTimeout(takeFile, 600);
  window.__TAURI__.event.listen("sl-open-file", () => setTimeout(takeFile, 200));

  /* --------------------------------------------------------- settings */

  const segment = (name, options, current) =>
    `<div class="sl-segment" data-segment="${name}">${options
      .map(
        ([value, label]) =>
          `<button type="button" data-value="${value}" class="${value === current ? "active" : ""}">${label}</button>`
      )
      .join("")}</div>`;

  let settings = null;
  const closeSettings = () => {
    settings?.remove();
    settings = null;
  };

  const openSettings = () => {
    if (settings) return;
    const value = appearance();
    const extra = read();
    const root = document.createElement("div");
    root.className = "sl-settings";
    root.innerHTML = [
      '<div class="sl-settings-box" role="dialog" aria-label="Настройки приложения">',
      '<header><div><h2 class="sl-settings-title">Настройки приложения</h2>',
      '<p class="sl-settings-path">Оформление, окно, интеграции и синхронизация</p></div>',
      '<button class="sl-settings-close" type="button" title="Закрыть">✕</button></header>',
      '<div class="sl-settings-body">',
      '<section><h3>Тема</h3>',
      segment("theme", [["system", "Системная"], ["light", "Светлая"], ["dark", "Тёмная"]], value.theme),
      "</section>",
      '<section><h3>Акцент</h3><div class="sl-swatches">',
      ACCENTS.map(
        ([color, label]) =>
          `<button type="button" data-accent="${color}" title="${label}" class="${
            color === value.accent ? "active" : ""
          }" style="--swatch:${color || "transparent"}"><span>${label}</span></button>`
      ).join(""),
      '</div><div class="sl-accent-editor"><label>Цвет <input type="color" data-accent-picker value="${value.accent || "#b35b35"}"></label><label>HEX <input type="text" data-accent-hex value="${value.accent}" maxlength="7" placeholder="#rrggbb" pattern="^#[0-9a-fA-F]{6}$" spellcheck="false"></label><div class="sl-accent-rgb"><label>R <input type="number" data-accent-rgb="0" min="0" max="255" value="${value.accent ? parseInt(value.accent.slice(1,3),16) : 179}"></label><label>G <input type="number" data-accent-rgb="1" min="0" max="255" value="${value.accent ? parseInt(value.accent.slice(3,5),16) : 91}"></label><label>B <input type="number" data-accent-rgb="2" min="0" max="255" value="${value.accent ? parseInt(value.accent.slice(5,7),16) : 53}"></label></div><button type="button" data-accent-reset>Сбросить</button></div><p class="sl-note" data-accent-error aria-live="polite"></p></section>',
      '<section><h3>Плотность</h3>',
      segment("density", [["compact", "Компактно"], ["comfortable", "Обычно"], ["spacious", "Просторно"]], value.density),
      "</section>",
      '<section><h3>Окно</h3>',
      `<label class="sl-check"><input type="checkbox" data-flag="transparent" ${extra.transparent ? "checked" : ""}> Прозрачные поверхности (Mica/Fluent)</label>`,
      `<label class="sl-check"><input type="checkbox" data-flag="closeToTray" ${extra.closeToTray === false ? "" : "checked"}> При закрытии сворачивать приложение в трей</label>`,
      "</section>",
      '<section><h3>Уведомления</h3>',
      `<label class="sl-check"><input type="checkbox" data-flag="notifications" ${extra.notifications === false ? "" : "checked"}> Системные уведомления</label>`,
      '<p class="sl-note" data-notification-status aria-live="polite">Уведомления об обновлениях и завершении загрузок.</p>',
      "</section>",
      '<section><h3>Интеграции</h3>',
      '<p class="sl-note" data-code-status>Проверяю Visual Studio Code…</p>',
      '<div class="sl-actions"><button type="button" data-native="open-script">Открыть файл Lua/Luau…</button></div>',
      '<p class="sl-note" data-open-status aria-live="polite"></p>',
      '<div class="sl-actions"><button type="button" data-native="downloads">Менеджер загрузок</button></div>',
      '<div class="sl-actions"><button type="button" data-native="account">Открыть настройки аккаунта</button>',
      '<button type="button" data-native="updates">Проверить обновления</button></div>',
      '<p class="sl-note" data-update-status aria-live="polite"></p>',
      '<p class="sl-note">Файлы .lua и .luau открываются в Script Library по двойному щелчку.</p>',
      "</section>",
      '<section><h3>Синхронизация</h3>',
      '<p class="sl-note" data-sync-status>Состояние подтягивается из аккаунта.</p>',
      '<div class="sl-actions"><button type="button" data-native="sync">Синхронизировать сейчас</button></div>',
      "</section>",
      '<section><h3>Горячие клавиши</h3><ul class="sl-keys">',
      '<li><kbd>Ctrl</kbd>+<kbd>K</kbd> командная палитра</li>',
      '<li><kbd>Ctrl</kbd>+<kbd>N</kbd> новое окно</li>',
      '<li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> мини-окно поиска</li>',
      '<li><kbd>Ctrl</kbd>+<kbd>B</kbd> свернуть панель</li>',
      '<li><kbd>Ctrl</kbd>+<kbd>,</kbd> эти настройки</li>',
      "</ul></section>",
      "</div></div>",
    ].join("");
    root.querySelector(".sl-settings-close").onclick = () => closeSettings();
    const syncAccentInputs = color => {
      const normalized = normalizeAccent(color);
      if (!normalized) return;
      root.querySelector("[data-accent-picker]").value = normalized;
      root.querySelector("[data-accent-hex]").value = normalized;
      [1, 3, 5].forEach((offset, index) => { root.querySelector(`[data-accent-rgb="${index}"]`).value = String(parseInt(normalized.slice(offset, offset + 2), 16)); });
      root.querySelector("[data-accent-error]").textContent = "";
      root.querySelectorAll("[data-accent]").forEach(button => button.classList.toggle("active", normalizeAccent(button.dataset.accent) === normalized));
    };
    root.addEventListener("input", event => {
      const rgbField = event.target.closest("[data-accent-rgb]");
      let raw;
      if (rgbField) {
        const channels = [...root.querySelectorAll("[data-accent-rgb]")].map(input => Number(input.value));
        if (channels.length !== 3 || channels.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
          root.querySelector("[data-accent-error]").textContent = "Значения RGB должны быть целыми числами от 0 до 255.";
          return;
        }
        raw = "#" + channels.map(value => value.toString(16).padStart(2, "0")).join("");
      } else {
        const field = event.target.closest("[data-accent-picker], [data-accent-hex]");
        if (!field) return;
        raw = field.value;
      }
      const color = normalizeAccent(raw);
      if (!color) {
        root.querySelector("[data-accent-error]").textContent = "Введите цвет в формате #RRGGBB.";
        return;
      }
      localStorage.setItem("accent", color);
      window.dispatchEvent(new CustomEvent("script-library-preference-change", { detail: { key: "accent", value: color } }));
      syncAccentInputs(color);
      applyAppearance();
    });
    root.addEventListener("click", event => {
      if (event.target === root) closeSettings();

      const choice = event.target.closest("[data-segment] [data-value]");
      if (choice) {
        const kind = choice.closest("[data-segment]").dataset.segment;
        localStorage.setItem(kind, choice.dataset.value);
        window.dispatchEvent(new CustomEvent("script-library-preference-change", { detail: { key: kind, value: choice.dataset.value } }));
        choice.closest("[data-segment]").querySelectorAll("button").forEach(button => button.classList.toggle("active", button === choice));
        applyAppearance();
        return;
      }

      const accent = event.target.closest("[data-accent]");
      if (accent) {
        const color = normalizeAccent(accent.dataset.accent);
        if (color) localStorage.setItem("accent", color);
        else localStorage.removeItem("accent");
        window.dispatchEvent(new CustomEvent("script-library-preference-change", { detail: { key: "accent", value: color } }));
        root.querySelectorAll("[data-accent]").forEach(button => button.classList.toggle("active", button === accent));
        if (color) syncAccentInputs(color);
        else {
          root.querySelector("[data-accent-picker]").value = "#b35b35";
          root.querySelector("[data-accent-hex]").value = "";
          root.querySelectorAll("[data-accent-rgb]").forEach((input, index) => input.value = [179, 91, 53][index]);
        }
        applyAppearance();
        return;
      }
      if (event.target.closest("[data-accent-reset]")) {
        localStorage.removeItem("accent");
        window.dispatchEvent(new CustomEvent("script-library-preference-change", { detail: { key: "accent", value: "" } }));
        root.querySelectorAll("[data-accent]").forEach(button => button.classList.toggle("active", !button.dataset.accent));
        root.querySelector("[data-accent-picker]").value = "#b35b35";
        root.querySelector("[data-accent-hex]").value = "";
        root.querySelectorAll("[data-accent-rgb]").forEach((input, index) => input.value = [179, 91, 53][index]);
        root.querySelector("[data-accent-error]").textContent = "";
        applyAppearance();
        return;
      }

      const native = event.target.closest("[data-native]");
      if (!native) return;
      const action = native.dataset.native;
      if (action === "open-script") {
        const status = root.querySelector("[data-open-status]");
        native.disabled = true;
        if (status) status.textContent = "Выбери файл скрипта…";
        Promise.resolve()
          .then(() => window.__TAURI__.dialog.open({
            multiple: false,
            filters: [{ name: "Lua", extensions: ["lua", "luau"] }],
          }))
          .then(path => {
            if (!path) {
              if (status) status.textContent = "";
              return null;
            }
            if (typeof path !== "string") throw new Error("Не удалось определить путь к файлу.");
            if (status) status.textContent = "Открываю файл…";
            return call("sl_read_script", { path }).then(file => {
              if (!file || typeof file.content !== "string") throw new Error("Не удалось прочитать файл скрипта.");
              if (root.isConnected) showFile(file);
              if (status) status.textContent = "";
            });
          })
          .catch(error => {
            const message = String(error?.message || error || "Не удалось открыть файл.").replace(/\s+/g, " ").trim();
            if (status) status.textContent = message.slice(0, 180);
          })
          .finally(() => { native.disabled = false; });
      }
      if (action === "updates") {
        const status = root.querySelector("[data-update-status]");
        native.disabled = true;
        if (status) status.textContent = "Проверяю обновления…";
        call("sl_check_update")
          .then(update => {
            if (!status) return;
            if (!update?.available || !update.url) {
              status.textContent = `Установлена последняя версия (${update?.current || "неизвестно"}).`;
              return;
            }
            status.textContent = `Доступна версия ${update.latest}.`;
            const install = document.createElement("button");
            install.type = "button";
            install.dataset.native = "install-update";
            install.dataset.url = update.url;
            install.textContent = "Скачать и установить";
            status.after(install);
          })
          .catch(error => {
            if (status) status.textContent = error?.toString() || "Не удалось проверить обновления.";
          })
          .finally(() => { native.disabled = false; });
      }
      if (action === "install-update") {
        native.disabled = true;
        const status = root.querySelector("[data-update-status]");
        if (status) status.textContent = "Скачиваю установщик… Приложение закроется после запуска обновления.";
        call("sl_install_update", { url: native.dataset.url })
          .catch(error => {
            if (status) status.textContent = error?.toString() || "Не удалось установить обновление.";
            native.disabled = false;
          });
      }
      if (action === "account") call("sl_open", { url: "https://scripting.nulls.gg/settings" }).catch(() => {});
      if (action === "sync") {
        const button = document.querySelector("[data-action='sync-now'], [data-sync-now]");
        if (button) button.click();
        const status = root.querySelector("[data-sync-status]");
        if (status) status.textContent = button ? "Синхронизация запущена…" : "Сначала войдите в аккаунт на сайте.";
        if (button) {
          let attempts = 0;
          const refresh = () => {
            const source = document.getElementById("sync-status");
            if (!status?.isConnected) return;
            if (source?.textContent) status.textContent = source.textContent;
            else if (attempts < 10) {
              attempts += 1;
              setTimeout(refresh, 300);
            }
          };
          setTimeout(refresh, 300);
        }
      }
    });

    root.addEventListener("change", event => {
      const flag = event.target.closest("[data-flag]");
      if (!flag) return;
      write({ [flag.dataset.flag]: flag.checked });
      if (flag.dataset.flag === "closeToTray") {
        call("sl_set_close_to_tray", { enabled: flag.checked }).catch(() => {});
      }
      if (flag.dataset.flag === "notifications") {
        const status = root.querySelector("[data-notification-status]");
        if (!flag.checked) {
          if (status) status.textContent = "Системные уведомления отключены.";
        } else {
          if (status) status.textContent = "Запрашиваю разрешение…";
          sendSystemNotification("Уведомления включены", "Настройка применена.", true).then(granted => {
            if (status) status.textContent = granted ? "Системные уведомления включены." : "Разрешение Windows не выдано.";
          });
        }
      }
      applyAppearance();
    });

    document.body.append(root);
    settings = root;

    call("sl_code_ready")
      .then(ready => {
        const status = root.querySelector("[data-code-status]");
        if (status) status.textContent = ready ? "Visual Studio Code найден: файлы открываются в нём." : "Visual Studio Code не найден в PATH.";
      })
      .catch(() => {});

    setTimeout(() => {
      const status = root.querySelector("[data-sync-status]");
      const source = document.getElementById("sync-status");
      if (status && source?.textContent) status.textContent = source.textContent;
    }, 800);
  };

  document.addEventListener(
    "keydown",
    event => {
      if (event.key === "," && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        openSettings();
      }
      if (event.key === "Escape" && settings) closeSettings();
    },
    true
  );
})();
