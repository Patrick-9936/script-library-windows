(() => {
  const main = document.getElementById("main");
  let activeCodeDialog = null,bindingPreferences=false,recentVisible=25,authorPageIndex=0;
  const state = { catalog: null, user: null, restoring: true, own: [], ownLoaded: false, maps: [], mapsLoaded: false, mapsLoading: false, favorites: new Set(), codes: new Map(), codeVersions: new Map(), query: "", scope: "all", sort: "random", seed: Math.random(), visible: 60, detail: null, author: null, authorScripts: null, params: [], indexing: false, editor: null, permissions:null, permissionOwner:"", catalogError:"" };
  const languages = ["system", "en", "ru", "kk", "uk", "be", "pl", "sr", "hu", "zh-Hans", "ja", "pt-BR", "es", "it", "de", "nl"];
  const bundled = location.hostname === "patrick-9936.github.io";
  const apiOrigin = bundled ? "https://sl.3-107-57-112.sslip.io" : "";
  const publicOrigin = location.origin;
  const routePath = () => bundled && location.hash.startsWith("#/") ? location.hash.slice(1) : location.pathname;
  const routeHref = path => bundled ? "#" + path : path;
  const sessionStore = {
    get: () => { try { const saved = JSON.parse(localStorage.getItem("script-library-remembered") || "null"); if (saved?.expires > Date.now()) return saved.token; localStorage.removeItem("script-library-remembered"); return sessionStorage.getItem("script-library-session") || ""; } catch { return ""; } },
    set: (value, remember) => { try { sessionStorage.removeItem("script-library-session"); localStorage.removeItem("script-library-remembered"); if (remember) localStorage.setItem("script-library-remembered", JSON.stringify({ token: value, expires: Date.now() + 604800000 })); else sessionStorage.setItem("script-library-session", value); } catch { /* Memory-only session. */ } },
    clear: () => { try { sessionStorage.removeItem("script-library-session"); localStorage.removeItem("script-library-remembered"); } catch { /* Memory-only session. */ } }
  };
  const catalogStore = {
    get: () => { try { const saved = JSON.parse(localStorage.getItem("script-library-catalog") || "null"); return saved?.expires > Date.now() && Array.isArray(saved.data?.authors) && Array.isArray(saved.data?.scripts) ? saved.data : null; } catch { return null; } },
    set: data => { try { localStorage.setItem("script-library-catalog", JSON.stringify({ expires: Date.now() + 86400000, data })); } catch { /* Cache is optional. */ } }
  };
  const blockStore = {
    load: () => { try { const value = JSON.parse(localStorage.getItem("script-library-blocks") || "{}"); return { authors: new Set(Array.isArray(value.authors) ? value.authors : []), scripts: new Set(Array.isArray(value.scripts) ? value.scripts : []), randomAuthors:new Set(),hideD2Random: false }; } catch { return { authors: new Set(), scripts: new Set(),randomAuthors:new Set(), hideD2Random: false }; } },
    save: value => { try { localStorage.setItem("script-library-blocks", JSON.stringify({ authors: [...value.authors], scripts: [...value.scripts],randomAuthors:[...value.randomAuthors], hideD2Random: value.hideD2Random })); return true; } catch { return false; } }
  };
  const blocks = blockStore.load();blockStore.save(blocks);
  function preferenceSnapshot() {
    const values={theme:localStorage.getItem("theme")||"system",language:localStorage.getItem("language")||"system",stripWrapper:localStorage.getItem("strip-service-wrapper")==="true",hideD2Random:blocks.hideD2Random,density:localStorage.getItem("density")||"comfortable",accent:localStorage.getItem("accent")||""};
    for(const id of blocks.randomAuthors)values["randomAuthor:"+id]=true;
    for(const id of blocks.authors)values["author:"+id]=true;
    for(const id of blocks.scripts)values["script:"+id]=true;
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith("battle-settings:")||key?.startsWith("battle-brawlers:")||key?.startsWith("battle-preset:")){try{values[(key.startsWith("battle-settings:")?"battle:":key.startsWith("battle-preset:")?"preset:":"brawlers:")+key.slice(key.indexOf(":")+1)]=JSON.parse(localStorage.getItem(key));}catch{}}}
    return values;
  }
  function replacePreferences(values) {
    const before=JSON.stringify(preferenceSnapshot());
    blocks.authors.clear();blocks.scripts.clear();blocks.randomAuthors.clear();blocks.hideD2Random=false;
    localStorage.setItem("theme",values.theme||localStorage.getItem("theme")||"system");localStorage.setItem("language",values.language||localStorage.getItem("language")||"system");localStorage.setItem("strip-service-wrapper",String(values.stripWrapper===true));localStorage.setItem("density",values.density||"comfortable");const accent=normalizeAccent(values.accent||"");if(accent)localStorage.setItem("accent",accent);else localStorage.removeItem("accent");applyTheme();
    const remove=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith("battle-settings:")||key?.startsWith("battle-brawlers:")||key?.startsWith("battle-preset:"))remove.push(key);}remove.forEach(key=>localStorage.removeItem(key));
    for(const [key,value] of Object.entries(values)){const [kind,id]=key.split(":");if(kind==="author"&&value===true)blocks.authors.add(id);if(kind==="script"&&value===true)blocks.scripts.add(id);if(kind==="preset"&&value&&typeof value==="object"&&!Array.isArray(value))localStorage.setItem("battle-preset:"+id,JSON.stringify(value));if(kind==="battle"&&Array.isArray(value))localStorage.setItem("battle-settings:"+id,JSON.stringify(value));if(kind==="brawlers"&&Array.isArray(value))localStorage.setItem("battle-brawlers:"+id,JSON.stringify(value));}
    // Direct storage write avoids sending received cloud values back as local edits.
    localStorage.setItem("script-library-blocks",JSON.stringify({authors:[...blocks.authors],scripts:[...blocks.scripts],randomAuthors:[...blocks.randomAuthors],hideD2Random:blocks.hideD2Random}));
    window.dispatchEvent(new Event("script-library-preferences-updated"));
    if(before!==JSON.stringify(preferenceSnapshot())&&!state.restoring&&!bindingPreferences){if(document.getElementById("battle-form"))refreshPresets();else renderRoute();}
  }
  const preferenceSync = new PreferenceSync(localStorage,{snapshot:preferenceSnapshot,replace:replacePreferences},payload=>js("/api/library/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)}),()=>{const node=document.getElementById("sync-status");if(node)node.textContent=tr(preferenceSync.status);});
  const queuePreference=(key,value)=>preferenceSync.queue(key,value);
  window.addEventListener("script-library-preference-change",event=>{const detail=event.detail;if(detail&&["density","accent"].includes(detail.key))queuePreference(detail.key,detail.value);});
  const battleKey = id => "battle-settings:" + id;
  function battleLimits(i) { const config = window.BATTLE_CONFIG; return { min: config.min[i], max: config.max[i], defaultValue: config.defaults[i] }; }
  function initialBattleValues(id, parameters) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(battleKey(id)) || "null"); } catch { /* Ignore invalid preset. */ }
    return window.BATTLE_RULES.initial(window.BATTLE_CONFIG, parameters, saved);
  }
  function readBattleValues(form) {
    const config = window.BATTLE_CONFIG;
    const values = config.ids.map((_, i) => {
      const field = form.elements.namedItem("p" + i);
      return field.type === "checkbox" ? (field.checked ? 1 : i === 23 ? -1 : 0) : field.value.trim() === "" ? NaN : Number(field.value);
    });
    try { return window.BATTLE_RULES.validate(config, values); }
    catch (error) {
      const i = error.index;
      if (i >= 0) { form.elements.namedItem("p" + i).focus(); throw Error(tr(config.names[i]) + ": " + config.min[i] + " … " + config.max[i]); }
      throw error;
    }
  }
  function storeBattleValues(id, values) { try { localStorage.setItem(battleKey(id), JSON.stringify(values)); queuePreference("battle:"+id,values); return true; } catch { return false; } }
  let localSession = bundled ? sessionStore.get() : "";
  const languageNames = ["Системный", "English", "Русский", "Қазақша", "Українська", "Беларуская", "Polski", "Српски", "Magyar", "中文", "日本語", "Português (Brasil)", "Español", "Italiano", "Deutsch", "Nederlands"];
  const locale = () => { const saved = localStorage.getItem("language") || "system"; const code = saved === "system" ? navigator.language : saved; return code.startsWith("zh") ? "zh-Hans" : code.startsWith("pt") ? "pt-BR" : code.split("-")[0]; };
  const tr = value => (window.APP_TRANSLATIONS[locale()] || window.APP_TRANSLATIONS.en || {})[value] || (locale() === "ru" ? value : window.APP_TRANSLATIONS.en?.[value] || value);
  const e = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const metadataCache=new Map(),metadataPending=new Map();let metadataGeneration=0;
  const fetchJson = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (bundled && localSession) headers.set("x-script-library-session", localSession);
    const response = await fetch(apiOrigin + path, { credentials: bundled ? "omit" : "same-origin", ...options, signal:options.signal||AbortSignal.timeout(25000), headers });
    if(response.ok&&bundled){const refreshed=response.headers.get("x-script-library-session");if(refreshed){localSession=refreshed;sessionStore.set(refreshed,!!localStorage.getItem("script-library-remembered"));}}
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) { const error = new Error(tr(body.error || "Не удалось выполнить")); error.status = response.status; throw error; }
    return body;
  };
  async function js(path,options={}){
    const method=options.method||"GET";
    const cacheable=method==="GET"&&/^\/api\/(?:scripts\/[0-9a-f-]+(?:\/(?:parameters|releases))?|users\/(?!me$)[^/]+(?:\/scripts)?)$/i.test(path);
    if(method!=="GET"){metadataGeneration++;metadataCache.clear();}
    if(!cacheable||options.fresh)return fetchJson(path,options);
    const key=(state.user?.uuid||"public")+":"+path,cached=metadataCache.get(key);if(cached&&cached.until>Date.now())return cached.data;
    if(metadataPending.has(key))return metadataPending.get(key);
    const generation=metadataGeneration;const job=fetchJson(path,options).then(data=>{if(generation===metadataGeneration)metadataCache.set(key,{data,until:Date.now()+30000});return data;}).finally(()=>metadataPending.delete(key));metadataPending.set(key,job);return job;
  }
  const normalizeAccent=value=>typeof value==="string"&&/^#[\da-f]{6}$/i.test(value)?value.toLowerCase():"";
  function applyTheme(){const root=document.documentElement,mode=localStorage.getItem("theme")||"system";root.dataset.theme=mode;root.style.colorScheme=mode==="system"?"light dark":mode;const accent=normalizeAccent(localStorage.getItem("accent")||"");for(const name of ["--accent","--accent-ink","--dark"]){if(root.style.removeProperty)root.style.removeProperty(name);else delete root.style[name];}if(!accent)return;const channel=offset=>parseInt(accent.slice(offset,offset+2),16)/255,linear=value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4,luminance=.2126*linear(channel(1))+.7152*linear(channel(3))+.0722*linear(channel(5)),ink=luminance>.179?"#171b27":"#ffffff";if(root.style.setProperty){root.style.setProperty("--accent",accent);root.style.setProperty("--accent-ink",ink);root.style.setProperty("--dark",accent);}else{root.style["--accent"]=accent;root.style["--accent-ink"]=ink;root.style["--dark"]=accent;}}
  applyTheme();
  const date = raw => raw ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(raw)) : tr("Без даты");
  const randomRank = id => { let hash = 2166136261; for (const c of id + state.seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return hash >>> 0; };
  const label = (text, value) => `<div><span>${e(tr(text))}</span>${e(value)}</div>`;
  const actionIcons = { battle:"play", code:"code", "download-code":"download", "share-script":"share", "share-author":"share", favorite:"heart",favorites:"heart",mine:"file",maps:"map",new:"plus",logout:"logout","delete-script":"trash","account-settings":"settings","stats":"stats", "clear-recent":"trash", "retry-session":"refresh", "block-script":"block", "block-author":"block","toggle-random-author":"shuffle", edit:"edit", publish:"upload", index:"code", shuffle:"shuffle", "script-releases":"history", "close-code":"close", "ban-brawlers":"block", "unban-brawlers":"check", "create-preset":"plus", "save-preset":"save", "rename-preset":"edit", "delete-preset":"trash", "save-battle":"save", "reset-battle":"refresh", "import-battle":"upload", "import-map":"upload", "open-map":"play", "rename-map":"edit", "delete-map":"trash", "recent":"history", "open-query":"code", "sync-now":"refresh", "site-changes":"history", "open-reference":"connect", "register-account":"plus", "nulls-connect":"connect", "quick-favorite":"heart", "quick-share":"share", "quick-download":"download" };
  const compactActions = new Set(["download-code", "share-script", "share-author", "favorite", "block-script", "block-author", "close-code","delete-script","quick-favorite","quick-share","quick-download"]);
  const icon = name => `<svg class="action-icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const button = (text, action, cls = "") => { const compact = compactActions.has(action), title = tr(text); return `<button type="button" class="button ${cls} ${compact ? "compact-action" : ""}" data-action="${action}" ${["favorite", "block-script", "block-author"].includes(action) ? `aria-pressed="${cls.includes("is-active")}"` : ""} title="${e(title)}" aria-label="${e(title)}">${actionIcons[action] ? icon(actionIcons[action]) : ""}<span${compact ? ' class="sr-only"' : ""}>${e(title)}</span></button>`; };
  const link = (path, text, cls = "") => `<a href="${e(routeHref(path))}" data-route="${e(path)}" class="${cls}">${e(text)}</a>`;
  function toast(message) { const node = document.getElementById("toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 3200); }
  function heading(title, description = "", count = "") { return `<div class="page-head"><div><p class="eyebrow">Script Library</p><h1>${e(title)}</h1>${description ? `<p class="sub">${e(description)}</p>` : ""}</div>${count ? `<span class="count">${e(count)}</span>` : ""}</div>`; }
  function activeNav(route) {
    const section = route.startsWith("/authors") ? "authors" : route.startsWith("/maps") ? "maps" : route.startsWith("/mine") || route.startsWith("/edit/") || route === "/new" ? "mine" : route.startsWith("/favorites") ? "favorites" : route.startsWith("/account") ? "account" : "library";
    for (const node of document.querySelectorAll("[data-nav]")) node.classList.toggle("active", node.dataset.nav === section);
    const mobile=document.querySelector(".mobile-nav"),order=["library","authors","maps","mine","favorites","account"];if(mobile)mobile.style.setProperty("--active-index",String(order.indexOf(section)));
    for (const node of document.querySelectorAll("[data-t]")) node.textContent = tr(node.dataset.t);
    document.getElementById("refresh").title = document.getElementById("refresh").ariaLabel = tr("Обновить список авторов");
    document.getElementById("help").title = document.getElementById("help").ariaLabel = tr("Помощь");
  }
  function go(path) { if(path==="/recent"&&routePath()!==path)recentVisible=25,authorPageIndex=0;closeCode(); if (routePath() !== path) { if (bundled) location.hash = path; else history.pushState({}, "", path); } renderRoute(); window.scrollTo(0, 0); }
  const cardScripts=new Map();
  function card(script) {
    cardScripts.set(script.uuid,script);
    const author = script.author_username ? "@" + script.author_username : script.author_name || "";
    return `<article class="script-card"><a class="script-card-link" href="${e(routeHref("/scripts/" + script.uuid))}" data-route="/scripts/${e(script.uuid)}"><h2 class="script-title">${e(script.name || tr("Без названия"))}</h2><p class="script-author">${e(author)}</p><p class="script-desc">${e(script.description || tr("Описание не добавлено"))}</p><div class="script-bottom"><span>${e(script.published_at ? date(script.published_at) : tr("Черновик"))}</span><span>${e(script.uuid.slice(0, 8))}</span></div></a><div class="card-quick" data-script-id="${e(script.uuid)}">${button(state.favorites.has(script.uuid)?"Удалить из избранного":"Добавить в избранное","quick-favorite",state.favorites.has(script.uuid)?"is-active":"")}${button("Поделиться скриптом","quick-share")}${button("Скачать .lua","quick-download")}</div></article>`;
  }
  function loadingSkeleton(label="Загрузка…") {return `<div role="status" class="loading-caption">${e(tr(label))}</div><div class="grid skeleton-grid" aria-hidden="true">${Array.from({length:6},()=>'<div class="skeleton-card"><i></i><i></i><i></i><i></i></div>').join("")}</div>`;}
  function catalogPlaceholder(){return state.catalogError?`<div class="empty">${e(state.catalogError)}<br><br>${button("Обновить","refresh")}</div>`:loadingSkeleton("Загружаю авторов…");}
  function authorReference(text,force=false){const value=String(text).trim();try{const url=new URL(value);if([location.origin,"https://patrick-9936.github.io"].includes(url.origin)){const path=url.hash.startsWith("#/")?url.hash.slice(1):url.pathname;const author=path.match(/^\/authors\/(@?[A-Za-z0-9_.-]{1,64})$/);if(author)return "@"+author[1].replace(/^@/,"");}}catch{}if(/^@[A-Za-z0-9_.-]{1,64}$/.test(value))return value;const match=value.match(/^https:\/\/scripting\.(?:nulls\.gg|donutquine\.dev)\/(?:users\/|authors\/)?(@[A-Za-z0-9_.-]{1,64}|[0-9a-f-]{36})(?:[/?#].*)?$/i);if(match)return match[1];if(force&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))return value;return null;}
  async function openAuthorReference(reference){try{const author=await js("/api/users/"+reference);go("/authors/"+encodeURIComponent(author.username));}catch(error){toast(error.message);}}
  function referenceDialog(){const dialog=document.createElement("dialog");dialog.className="preset-dialog";dialog.innerHTML=`<form><h2>${e(tr("Открыть по UUID / ссылке"))}</h2><input class="input reference-input" name="reference" aria-label="UUID" placeholder="UUID / https://scripting.nulls.gg/scripts/…" autocomplete="off" autocapitalize="off" spellcheck="false" required><button type="button" class="button small" data-paste-reference>${icon("upload")}${e(tr("Вставить"))}</button><p class="dialog-error" role="alert"></p><label class="remember"><input type="checkbox" data-open-author>${e(tr("Открыть автора"))}</label><div class="actions"><button type="button" class="button" data-cancel>${e(tr("Отмена"))}</button><button class="button primary" type="submit">${icon("connect")}${e(tr("Открыть"))}</button></div></form>`;const input=dialog.querySelector("input");if(scriptReference(state.query))input.value=state.query;dialog.querySelector("[data-paste-reference]").onclick=async()=>{try{input.value=await navigator.clipboard.readText();input.focus();}catch{input.focus();}};dialog.querySelector("[data-cancel]").onclick=()=>dialog.close();dialog.addEventListener("close",()=>dialog.remove());dialog.querySelector("form").onsubmit=event=>{event.preventDefault();const author=authorReference(input.value,dialog.querySelector("[data-open-author]").checked);const id=scriptReference(input.value);if(author){dialog.close();openAuthorReference(author);}else if(id&&!dialog.querySelector("[data-open-author]").checked){dialog.close();go("/scripts/"+id);}else if(/nullsbrawl:\/\//i.test(input.value)){const text=input.value;dialog.close();importBattleDialog(text);}else dialog.querySelector(".dialog-error").textContent=tr("Некорректная ссылка или UUID");};document.body.append(dialog);dialog.showModal();input.focus();}
  function filtered() {
    const query = state.query.toLocaleLowerCase().trim();
    const catalog = state.catalog || { scripts: [] };
    let scripts = catalog.scripts.filter(script => {
      if (blocks.scripts.has(script.uuid) || blocks.authors.has(script.author_uuid)) return false;
      if (!query) return true;
      const fields = {
        title: script.name, author: [script.author_name, script.author_username].join(" "),
        description: script.description, code: sourceForUse(state.codes.get(script.uuid)), all: [script.name, script.author_name, script.author_username, script.description, script.uuid, sourceForUse(state.codes.get(script.uuid))].join(" ")
      };
      return String(fields[state.scope] || "").toLocaleLowerCase().includes(query);
    });
    scripts = [...scripts];
    if (state.sort === "random") scripts.sort((a, b) => randomRank(a.uuid) - randomRank(b.uuid));
    if (state.sort === "new") scripts.sort((a, b) => (b.published_at || b.created_at || "").localeCompare(a.published_at || a.created_at || ""));
    if (state.sort === "old") scripts.sort((a, b) => (a.published_at || a.created_at || "").localeCompare(b.published_at || b.created_at || ""));
    if (state.sort === "az") scripts.sort((a, b) => a.name.localeCompare(b.name, navigator.language));
    if (state.sort === "za") scripts.sort((a, b) => b.name.localeCompare(a.name, navigator.language));
    if (state.sort === "updated") scripts.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return scripts;
  }
  const scriptNotice=()=>`<p class="script-notice">${e(tr("Скрипты не проверяются. Null’s Team не несёт ответственности за их работоспособность."))}</p>`;
  function library(preserveInput = false) {
    const items = filtered();
    const catalog = state.catalog;
    const results = items.length ? `<div class="grid">${items.slice(0, state.visible).map(card).join("")}</div>${items.length > state.visible ? `<div style="text-align:center;margin:24px 0">${button("Показать ещё", "more")}</div>` : ""}` : catalog ? `<div class="empty">${e(tr("Ничего не найдено."))}</div>` : catalogPlaceholder();
    if (preserveInput || document.activeElement?.id === "search" && document.getElementById("library-results")) {
      document.getElementById("library-results").innerHTML = results;
      const count = document.getElementById("library-count");
      if (count) count.textContent = `${items.length} ${tr("скриптов")}`;
      return;
    }
    main.innerHTML = heading(tr("Библиотека"), tr("Скрипты из списка авторов"), catalog ? `${items.length} ${tr("скриптов")}` : "").replace('<span class="count">', '<span id="library-count" class="count">') + scriptNotice() + `<div class="reference-action">${button("Открыть по UUID / ссылке","open-reference")}</div>` +
      `<div class="toolbar"><label class="field"><span>${e(tr("Поиск"))}</span><input id="search" class="input" type="search" autocomplete="off" placeholder="${e(tr("Название, автор, описание, код или UUID"))}" value="${e(state.query)}"></label><label class="field"><span>${e(tr("ИСКАТЬ В"))}</span><select id="scope" class="select">${[["all","Везде"],["title","Название"],["author","Автор"],["description","Описание"],["code","Код"]].map(([v,t]) => `<option value="${v}" ${state.scope === v ? "selected" : ""}>${e(tr(t))}</option>`).join("")}</select></label><label class="field"><span>${e(tr("СОРТИРОВКА"))}</span><select id="sort" class="select">${[["random","Случайно"],["new","Сначала новые"],["old","Сначала старые"],["az","Название А–Я"],["za","Название Я–А"],["updated","Обновлённые"]].map(([v,t]) => `<option value="${v}" ${state.sort === v ? "selected" : ""}>${e(tr(t))}</option>`).join("")}</select></label></div>` +
      `<div id="query-reference" class="query-reference">${scriptReference(state.query)||/nullsbrawl:\/\//i.test(state.query)?button("Открыть скрипт или конфигурацию","open-query"):""}</div><div class="toolbar-note"><span>${e(tr("Везде — название, автор, описание, UUID и загруженный код. Случайно — случайный порядок."))}</span><div class="actions">${button(state.indexing ? "Индексирование…" : "Индексировать код", "index", "small")}${state.sort === "random" ? button("Перемешать", "shuffle", "small") : ""}</div></div>` +
      `<div id="library-results">${results}</div>`;
  }
  function authors() {
    const list = [...(state.catalog?.authors || [])].sort((a, b) => randomRank(a.uuid) - randomRank(b.uuid));
    main.innerHTML = heading(tr("Авторы скриптов"), "", list.length ? `${list.length} ${tr("авторов")}` : "") +
      (list.length ? `<div class="author-grid">${list.map(author => `<a class="author-card" href="${e(routeHref("/authors/" + author.username))}" data-route="/authors/${e(author.username)}"><div class="author-name">${e(author.name)}</div><div class="author-handle">@${e(author.username)}</div>${blocks.authors.has(author.uuid) ? `<span class="blocked-tag">${e(tr("В чёрном списке"))}</span>` : ""}</a>`).join("")}</div>` : catalogPlaceholder());
  }
  const newestScript = (a,b) => (b.created_at || b.published_at || "").localeCompare(a.created_at || a.published_at || "") || b.uuid.localeCompare(a.uuid);
  function authorPage() {
    const author = state.author;
    if (!author) { main.innerHTML = `<div class="loading">${e(tr("Открываю автора…"))}</div>`; return; }
    const scripts = blocks.authors.has(author.uuid) ? [] : (state.authorScripts || state.catalog?.scripts.filter(item => item.author_uuid === author.uuid) || []).filter(item => !blocks.scripts.has(item.uuid)).sort(newestScript);
    main.innerHTML = `<button class="back" data-action="back">← ${e(tr("Авторы"))}</button>` +
      `<div class="panel"><p class="eyebrow">${e(tr("Профиль автора"))}</p><h1 class="detail-title">${e(author.name)}</h1><p class="author-handle">@${e(author.username)}</p><div class="actions">${button("Поделиться автором", "share-author")}${button(blocks.authors.has(author.uuid) ? "Разблокировать автора" : "Заблокировать автора", "block-author", blocks.authors.has(author.uuid) ? "is-active" : "")}</div><p class="detail-id">UUID ${e(author.uuid)}</p></div>` +
      `<div class="page-head" style="margin-top:28px"><h2>${e(tr("Скрипты"))}</h2><span class="count">${scripts.length}</span></div>${blocks.authors.has(author.uuid) ? `<div class="empty">${e(tr("Автор заблокирован."))}</div>` : `<div class="grid">${scripts.slice(authorPageIndex*60,(authorPageIndex+1)*60).map(card).join("")}</div><div class="actions"><button type="button" class="button" data-author-page="-1" ${authorPageIndex===0?"disabled":""}>${e(tr("Назад"))}</button><span>${authorPageIndex*60+1}–${Math.min(scripts.length,(authorPageIndex+1)*60)} / ${scripts.length}</span><button type="button" class="button" data-author-page="1" ${(authorPageIndex+1)*60>=scripts.length?"disabled":""}>${e(tr("Показать ещё"))}</button></div>`}`;
  }
  const availabilityCache=new Map();
  async function loadAvailability(id){
    const node=document.getElementById("availability");
    if(!node)return;
    if(availabilityCache.has(id)){renderAvailability(node,availabilityCache.get(id));return;}
    node.textContent=tr("Проверяю доступность боя…");
    let value;
    try{await js("/api/scripts/"+id+"/share",{method:"POST"});value=true;}
    catch(error){value=error.status===400||error.status===403||error.status===404?false:null;}
    if(routePath()!=="/scripts/"+id)return;
    if(value!==null)availabilityCache.set(id,value);
    const target=document.getElementById("availability");
    if(target)renderAvailability(target,value);
  }
  function renderAvailability(node,value){
    if(value===null){node.textContent=tr("Не удалось проверить доступность боя");node.className="availability unknown";return;}
    node.textContent=tr(value?"Автор подтверждён · бой доступен":"Автор не подтверждён · бой недоступен");
    node.className="availability "+(value?"ok":"blocked");
  }
  function detail() {
    document.body.classList.remove("battle-mode");
    const script = state.detail;
    if(script)rememberScript(script);
    if (!script) { main.innerHTML = `<div class="loading">${e(tr("Открываю скрипт…"))}</div>`; return; }
    const authorHandle = script.author_username || state.catalog?.authors.find(author => author.uuid === script.author_uuid)?.username;
    const mine = state.user && (script.author_uuid === state.user.uuid || state.own.some(item => item.uuid === script.uuid));
    main.innerHTML = `<button class="back" data-action="back">← ${e(tr("Библиотека"))}</button>` + scriptNotice() + `<div class="reference-action">${button("Открыть по UUID / ссылке","open-reference")}</div>` +
      `<div class="panel"><p class="eyebrow">${e(tr("Скрипт"))}</p><h1 class="detail-title">${e(script.name)}</h1>${authorHandle ? link("/authors/" + encodeURIComponent(authorHandle), "@" + authorHandle, "author-handle") : `<span class="author-handle">${e(script.author_name)}</span>`}<p class="detail-desc">${e(script.description || tr("Описание не добавлено"))}</p>${script.user_map_internal_id?`<div class="script-map"><span>${icon("map")}</span><div><strong>${e(tr("Прикреплённая карта"))}</strong><small>${e(script.user_map_internal_id)}</small></div><a class="button small" href="${e(mapLink(script.user_map_internal_id))}">${icon("play")}${e(tr("Открыть"))}</a></div>`:""}<div class="meta">${label("Создан:", date(script.created_at))}${label("Обновлён:", date(script.updated_at))}${label("Опубликован:", date(script.published_at))}</div><div class="actions">${button("Настроить и запустить бой", "battle", "primary")}${button("Посмотреть код", "code")}${button("Скачать .lua", "download-code")}${button("История версий", "script-releases")}${button("Поделиться скриптом", "share-script")}${button(blocks.scripts.has(script.uuid) ? "Разблокировать скрипт" : "Заблокировать скрипт", "block-script", blocks.scripts.has(script.uuid) ? "is-active" : "")}${button(state.favorites.has(script.uuid) ? "Удалить из избранного" : "В избранное", "favorite", state.favorites.has(script.uuid) ? "is-active" : "")}${mine ? button("Редактировать", "edit") : ""}${mine && canPublish(script) ? button("Опубликовать версию", "publish", "primary") : ""}${mine?button("Удалить скрипт","delete-script","danger"):""}</div><p class="detail-id">UUID ${e(script.uuid)}</p><p id="availability" class="availability unknown"></p><div id="release-summary" class="release-summary"></div></div>`;
loadReleaseSummary(script.uuid);loadAvailability(script.uuid);
  }
  const editedSincePublish = new Set(), publishedWithoutFurtherEdit = new Set();
  function canPublish(script) {
    if (!script.published_at) return true;
    if (publishedWithoutFurtherEdit.has(script.uuid)) return false;
    if (editedSincePublish.has(script.uuid)) return true;
    return Date.parse(script.updated_at) > Date.parse(script.published_at);
  }
  function sourceForUse(source) { if (typeof source !== "string") return source; return localStorage.getItem("strip-service-wrapper") === "true" ? SCRIPT_SOURCE.original(source) : source; }
  const WEB_RELEASE='1.7.19',WEB_RELEASE_ID='2026-10-27-maps-glass-1';
  const releaseChanges={
    added:['Библиотека карт','Импорт карт','Привязка карты к скрипту'],
    changed:['Плавающая стеклянная навигация','Стеклянные карточки и окна']
  };
  function selectedPreference(kind){return localStorage.getItem(kind)||'system';}
  function preferenceLabel(kind,value){return kind==='language'?(value==='system'?tr('Как на устройстве'):languageNames[languages.indexOf(value)]||value):tr(({system:'Как на устройстве',light:'Светлая',dark:'Тёмная'})[value]||'Как на устройстве');}
  function preferenceButton(kind){const title=tr(kind==='language'?'Язык':'Тема');return `<button type="button" class="preference-trigger" data-action="choose-${kind}" aria-haspopup="dialog"><span>${icon(kind)}<span><strong>${e(title)}</strong><small>${e(preferenceLabel(kind,selectedPreference(kind)))}</small></span></span><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>`;}
  const accentPresets=["#4265dc","#0f7b6c","#b35b35","#7a4fd3","#c2417a","#c8952b","#3b8ea5","#5a6472"];
  function defaultAccent(){try{return normalizeAccent(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())||"#b35b35";}catch{return "#b35b35";}}
  function accentSettings(){const stored=normalizeAccent(localStorage.getItem("accent")||""),current=stored||defaultAccent(),rgb=[parseInt(current.slice(1,3),16),parseInt(current.slice(3,5),16),parseInt(current.slice(5,7),16)];return `<section class="accent-settings" aria-labelledby="accent-title"><div class="accent-heading"><div><h3 id="accent-title">${e(tr("Цвет акцента"))}</h3><p class="sub">${e(tr("Выберите цвет или задайте HEX/RGB. Цвет синхронизируется с аккаунтом."))}</p></div><button type="button" class="button small" data-accent-reset>${e(tr("Сбросить"))}</button></div><div class="accent-presets" role="group" aria-label="${e(tr("Палитра акцентов"))}">${accentPresets.map(color=>`<button type="button" class="accent-swatch ${color===stored?"selected":""}" data-accent-value="${color}" style="--swatch:${color}" aria-label="${color}" aria-pressed="${color===stored}"></button>`).join("")}</div><div class="accent-editor"><label class="accent-color-field"><span>${e(tr("Палитра"))}</span><input id="accent-color" type="color" value="${current}" aria-label="${e(tr("Выбрать цвет"))}"></label><label class="accent-hex-field"><span>HEX</span><input id="accent-hex" class="input" value="${current}" maxlength="7" pattern="^#[0-9a-fA-F]{6}$" spellcheck="false" autocomplete="off" aria-label="HEX"></label><div class="accent-rgb" aria-label="RGB">${rgb.map((value,index)=>`<label><span>${["R","G","B"][index]}</span><input class="input" type="number" min="0" max="255" step="1" data-accent-rgb="${index}" value="${value}" aria-label="${["R","G","B"][index]}"></label>`).join("")}</div></div><p id="accent-error" class="accent-error" aria-live="polite"></p></section>`;}
  function setAccent(value,queue=true){const accent=normalizeAccent(value);if(!accent)return false;localStorage.setItem("accent",accent);applyTheme();if(queue)queuePreference("accent",accent);const hex=document.getElementById("accent-hex"),picker=document.getElementById("accent-color"),error=document.getElementById("accent-error");if(hex)hex.value=accent;if(picker)picker.value=accent;if(error)error.textContent="";document.querySelectorAll(".accent-swatch").forEach(node=>{const selected=node.dataset.accentValue===accent;node.classList.toggle("selected",selected);node.setAttribute("aria-pressed",String(selected));});const rgb=[1,3,5].map(offset=>parseInt(accent.slice(offset,offset+2),16));document.querySelectorAll("[data-accent-rgb]").forEach(input=>input.value=String(rgb[Number(input.dataset.accentRgb)]));return true;}
  function updateAccentFromRgb(){const channels=[...document.querySelectorAll("[data-accent-rgb]")].map(input=>Number(input.value));if(channels.length!==3||channels.some(value=>!Number.isInteger(value)||value<0||value>255))return;setAccent("#"+channels.map(value=>value.toString(16).padStart(2,"0")).join(""));}
  function choosePreference(kind){
    const dialog=document.createElement('dialog');dialog.className='preference-dialog';const title=tr(kind==='language'?'Язык':'Тема'),current=selectedPreference(kind),values=kind==='language'?languages:['system','light','dark'];
    dialog.innerHTML=`<header><h2>${e(title)}</h2><button type="button" class="button compact-action" data-picker-close aria-label="${e(tr('Закрыть'))}">${icon('close')}</button></header><div class="preference-options" role="group" aria-label="${e(title)}">${values.map(value=>`<button type="button" class="preference-option ${value===current?'selected':''}" data-preference-value="${e(value)}" aria-pressed="${value===current}"><span>${e(preferenceLabel(kind,value))}</span><span class="preference-tick">${icon('check')}</span></button>`).join('')}</div><p class="preference-sync-note">${e(tr('Конфигурации, параметры, язык и тема синхронизируются после входа.'))}</p>`;
    dialog.addEventListener('close',()=>dialog.remove());dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-picker-close]')){dialog.close();return;}const choice=event.target.closest('[data-preference-value]');if(!choice)return;const value=choice.dataset.preferenceValue;localStorage.setItem(kind,value);queuePreference(kind,value);if(kind==='theme')applyTheme();dialog.close();renderRoute();});
    document.body.append(dialog);dialog.showModal();dialog.querySelector('.selected')?.focus();
  }
  let releasePromptPending=true,releasePromptTimer;
  function seenRelease(){try{return localStorage.getItem('site-update-seen')===WEB_RELEASE_ID;}catch{return false;}}
  function showReleaseChanges(manual=false){
    if(!manual&&(seenRelease()||!releasePromptPending))return;
    if(document.hidden)return;
    if((!manual&&(state.restoring||preferenceSync.busy))||document.querySelector('dialog[open]')){if(!manual){clearTimeout(releasePromptTimer);releasePromptTimer=setTimeout(()=>showReleaseChanges(),800);}return;}
    releasePromptPending=false;const dialog=document.createElement('dialog');dialog.className='release-dialog';
    dialog.innerHTML=`<header><span class="release-logo">${icon('history')}</span><div><p class="eyebrow">${e(tr('Обновление сайта'))}</p><h2>${e(tr('Что нового'))}</h2><p class="release-version">${e(WEB_RELEASE)}</p></div></header><div class="release-notes">${[['Добавлено',releaseChanges.added],['Изменено',releaseChanges.changed]].map(([title,items])=>`<section><h3>${e(tr(title))}</h3><ul>${items.map(item=>`<li>${e(tr(item))}</li>`).join('')}</ul></section>`).join('')}</div><p class="preference-sync-note">${e(tr('Конфигурации, параметры, язык и тема синхронизируются после входа.'))}</p><button type="button" class="button primary release-ack">${icon('check')}${e(tr('Понятно'))}</button>`;
    dialog.querySelector('.release-ack').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});dialog.addEventListener('close',()=>{try{localStorage.setItem('site-update-seen',WEB_RELEASE_ID);}catch{}dialog.remove();});document.body.append(dialog);dialog.showModal();
  }
  function showUsageConsent(){
    if(usageDecided())return;
    if(document.querySelector("dialog[open]")){setTimeout(showUsageConsent,1200);return;}
    const dialog=document.createElement("dialog");dialog.className="release-dialog";
    dialog.innerHTML=`<header><span class="release-logo">${icon("history")}</span><div><p class="eyebrow">${e(tr("Статистика использования"))}</p><h2>${e(tr("Помогите улучшать проект"))}</h2></div></header><p class="sub">${e(tr("Отправляются только случайный идентификатор, платформа, версия и даты активности. Код скриптов, пароли и почта не передаются. Отключить можно в настройках."))}</p><div class="actions"><button type="button" class="button primary usage-allow">${e(tr("Разрешить"))}</button><button type="button" class="button usage-deny">${e(tr("Не отправлять"))}</button></div>`;
    const decide=value=>{try{localStorage.setItem("usage-decided","true");localStorage.setItem("usage-enabled",String(value));}catch{}dialog.close();if(value)sendTelemetry();};
    dialog.querySelector(".usage-allow").addEventListener("click",()=>decide(true));
    dialog.querySelector(".usage-deny").addEventListener("click",()=>decide(false));
    dialog.addEventListener("close",()=>dialog.remove());
    document.body.append(dialog);dialog.showModal();
  }
  let registryAuthors=[];
  async function manageAuthors(){
    main.innerHTML=loadingSkeleton("Загружаю авторов…");
    try{const data=await js("/api/library/authors");registryAuthors=data.authors||[];}
    catch(error){main.innerHTML=heading(tr("Управление авторами"))+`<div class="empty">${e(error.message)}</div>`+`<div class="actions">${button("Назад","back")}</div>`;return;}
    renderAuthors();
  }
  function renderAuthors(){
    const rows=registryAuthors.map((author,index)=>`<div class="panel author-row"><div><div class="author-name">${e(author.name||author.url)}</div>${author.username?`<div class="author-handle">@${e(author.username)}</div>`:""}<p class="detail-id">${e(author.url)}</p></div><div class="actions"><button type="button" class="button small" data-action="edit-author" data-index="${index}">${e(tr("Изменить"))}</button><button type="button" class="button small" data-action="remove-author" data-index="${index}">${e(tr("Удалить"))}</button></div></div>`).join("");
    main.innerHTML=heading(tr("Управление авторами"),tr("Список читают приложение и сайт. Изменения применяются после обновления каталога."),`${registryAuthors.length}`)
      +`<form id="author-add" class="panel"><label class="field"><span>${e(tr("Ссылка на профиль или @имя"))}</span><input class="input" name="url" autocomplete="off" required></label><div class="actions"><button class="button primary" type="submit">${icon("plus")}${e(tr("Добавить автора"))}</button>${button("Назад","back")}</div></form>`
      +(rows||`<p class="empty">${e(tr("Список пуст"))}</p>`);
  }
  function editAuthor(index){
    const author=registryAuthors[index];
    if(!author)return;
    const dialog=document.createElement("dialog");dialog.className="preset-dialog";
    dialog.innerHTML=`<form><h2>${e(tr("Изменить автора"))}</h2><label for="author-url">${e(tr("Ссылка на профиль или @имя"))}</label><input id="author-url" class="input" value="${e(author.url)}" required><div class="actions"><button class="button primary" type="submit">${e(tr("Сохранить"))}</button><button type="button" class="button" id="cancel-author">${e(tr("Отмена"))}</button></div></form>`;
    dialog.addEventListener("close",()=>dialog.remove());
    dialog.addEventListener("click",event=>{if(event.target.closest("#cancel-author"))dialog.close();});
    dialog.querySelector("form").addEventListener("submit",async event=>{
      event.preventDefault();
      const value=dialog.querySelector("#author-url").value.trim();
      if(!value)return;
      try{await js("/api/library/authors",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({target:author.url,url:value})});dialog.close();await manageAuthors();toast(tr("Автор обновлён"));}
      catch(error){toast(error.message);}
    });
    document.body.append(dialog);dialog.showModal();
  }
  async function removeAuthor(index){
    const author=registryAuthors[index];
    if(!author||!confirm(tr("Удалить автора?")))return;
    try{await js("/api/library/authors",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({target:author.url})});await manageAuthors();toast(tr("Автор удалён"));}
    catch(error){toast(error.message);}
  }
  function account() {
    const languageSetting = `<div class="panel settings-panel">${preferenceButton("language")}${preferenceButton("theme")}${accentSettings()}<label class="remember"><input id="strip-service-wrapper" type="checkbox" ${localStorage.getItem("strip-service-wrapper") === "true" ? "checked" : ""}> ${e(tr("Убирать защитную обёртку"))}</label><p class="sub">${e(tr("Восстанавливать исходный tick() при просмотре и сохранении кода."))}</p><div class="actions">${button("Импорт конфигурации боя","import-battle")}${button("Недавние скрипты","recent")}${button("Что нового","site-changes")}${state.user?button("Синхронизировать","sync-now"):""}</div><label class="remember"><input id="usage-enabled" type="checkbox" ${localStorage.getItem("usage-enabled")==="true"?"checked":""}>${e(tr("Отправлять статистику использования"))}</label><p class="sub">${e(tr("Отправляются только случайный идентификатор, платформа, версия и даты активности. Код скриптов, пароли и почта не передаются."))}</p><p id="sync-status" class="sub">${e(tr(preferenceSync.status))}</p></div>`;
    const blockedAuthors = [...blocks.authors].map(id => { const author = state.catalog?.authors.find(item => item.uuid === id); return `<div class="block-row"><span>${author ? link("/authors/" + encodeURIComponent(author.username), "@" + author.username) : e(id)}</span><button class="button small" type="button" data-action="unblock-author" data-id="${e(id)}">${e(tr("Разблокировать"))}</button></div>`; });
    const blockedScripts = [...blocks.scripts].map(id => { const script = state.catalog?.scripts.find(item => item.uuid === id) || state.own.find(item => item.uuid === id); return `<div class="block-row"><span>${link("/scripts/" + id, script?.name || id)}</span><button class="button small" type="button" data-action="unblock-script" data-id="${e(id)}">${e(tr("Разблокировать"))}</button></div>`; });
    const blacklist = `<div class="panel"><h2>${e(tr("Чёрный список"))}</h2><p class="sub">${e(tr(state.user?"Синхронизируется с вашим аккаунтом.":"Сохраняется только на этом устройстве."))}</p>${blockedAuthors.length || blockedScripts.length ? `${blockedAuthors.length ? `<h3>${e(tr("Авторы"))}</h3>${blockedAuthors.join("")}` : ""}${blockedScripts.length ? `<h3>${e(tr("Скрипты"))}</h3>${blockedScripts.join("")}` : ""}` : `<p class="sub">${e(tr("Чёрный список пуст"))}</p>`}</div>`;
    if (state.user) {
      main.innerHTML = heading(tr("Аккаунт")) + `<div class="panel login"><h2>${e(state.user.name || state.user.username)}</h2><p class="author-handle">@${e(state.user.username)}</p><div class="actions">${button("Мои скрипты", "mine", "primary")}${button("Карты", "maps")}${button("Избранное", "favorites")}${button("Настройки аккаунта","account-settings")}${button("Null’s Connect","nulls-connect")}${(state.permissionOwner===state.user.uuid&&state.permissions?.view_statistics===true)?button("Статистика","stats"):""}${(state.permissionOwner===state.user.uuid&&state.owner===true)?button("Управление авторами","authors-manage"):""}${button("Недавние скрипты", "recent")}${button("Выйти", "logout")}</div></div>` + languageSetting + blacklist;
    } else {
      main.innerHTML = heading(tr("Вход в Null’s")) + (localSession?button("Повторить восстановление","retry-session"):"")+`<form id="login" class="panel login"><label class="field"><span>${e(tr("Имя пользователя"))}</span><input class="input" name="username" autocomplete="username" required></label><label class="field"><span>${e(tr("Пароль"))}</span><input class="input" type="password" name="password" autocomplete="current-password" required></label><label class="remember"><input type="checkbox" name="remember"> ${e(tr("Сохранить вход на этом устройстве"))}</label><button class="button primary" type="submit">${e(tr("Войти"))}</button><div class="actions">${button("Создать аккаунт","register-account")}${button("Null’s Connect","nulls-connect")}</div><p class="sub">${e(tr("Вход нужен для избранного и просмотра кода."))}</p></form>` + languageSetting + blacklist;
    }
  }
  function acceptAccount(result,remember){if(bundled){if(!result.session)throw Error(tr("Сервис не вернул сессию."));localSession=result.session;sessionStore.set(localSession,remember);}state.user=result.user;state.restoring=false;state.permissions=null;state.permissionOwner="";state.own=[];state.ownLoaded=false;state.maps=[];state.mapsLoaded=false;void loadPermissions();sendTelemetry();void loadFavorites();void loadMaps();go("/mine");}
  function registerAccount(signup=null,remembered=false){const dialog=document.createElement("dialog");dialog.className="preset-dialog auth-dialog";const connect=!!signup;dialog.innerHTML=`<form><header class="auth-dialog-head"><span>${icon("user")}<h2>${e(tr("Создать аккаунт"))}</h2></span><button type="button" class="button compact-action" data-auth-close aria-label="${e(tr("Закрыть"))}">${icon("close")}</button></header>${connect?`<p class="sub">${e(tr("Null’s Connect подтверждён. Выберите имя и имя пользователя."))}</p>`:""}<label class="field"><span>${e(tr("Имя"))}</span><input class="input" name="name" minlength="${connect?1:3}" maxlength="128" autocomplete="name" required></label><label class="field"><span>${e(tr("Имя пользователя"))}</span><input class="input" name="username" minlength="${connect?1:3}" maxlength="128" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>${!connect?`<label class="field"><span>${e(tr("Пароль"))}</span><input class="input" name="password" type="password" minlength="8" maxlength="512" autocomplete="new-password" required></label><label class="field"><span>${e(tr("Повторите пароль"))}</span><input class="input" name="confirm" type="password" minlength="8" maxlength="512" autocomplete="new-password" required></label>`:""}<label class="remember"><input type="checkbox" name="remember">${e(tr("Сохранить вход на этом устройстве"))}</label><p class="dialog-error" role="alert"></p><div class="actions"><button class="button primary" type="submit">${icon("plus")}${e(tr("Создать аккаунт"))}</button>${!connect?button("Null’s Connect","register-connect"):""}</div></form>`;const form=dialog.querySelector("form"),error=dialog.querySelector(".dialog-error");form.elements.remember.checked=remembered;dialog.querySelector("[data-auth-close]").onclick=()=>dialog.close();dialog.querySelector('[data-action="register-connect"]')?.addEventListener("click",()=>{const remember=form.elements.remember.checked;dialog.close();startConnect(remember);});dialog.addEventListener("close",()=>dialog.remove());form.onsubmit=async event=>{event.preventDefault();const save=form.querySelector('[type="submit"]');if(save.disabled)return;if(!connect&&form.elements.password.value!==form.elements.confirm.value){error.textContent=tr("Пароли не совпадают");return;}save.disabled=true;error.textContent=tr("Создаю аккаунт…");const remember=form.elements.remember.checked;try{const data={name:form.elements.name.value.trim(),username:form.elements.username.value.trim(),remember};if(connect)data.sign_up_token=signup;else data.password=form.elements.password.value;const result=await js(connect?"/api/auth/connect/register":"/api/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});acceptAccount(result,remember);dialog.close();toast(tr("Аккаунт создан"));}catch(reason){error.textContent=reason.message;save.disabled=false;}};document.body.append(dialog);dialog.showModal();form.elements.name.focus();}
  let connectDialog=null;
  function startConnect(remember=false){
    connectDialog?.close();const stateId=crypto.randomUUID(),pending={state:stateId,owner:state.user?.uuid||"",remember,time:Date.now()};sessionStorage.setItem("connect-pending",JSON.stringify(pending));
    const dialog=document.createElement("dialog");dialog.className="preset-dialog auth-dialog";dialog.innerHTML=`<form><header class="auth-dialog-head"><span>${icon("connect")}<h2>Null’s Connect</h2></span><button type="button" class="button compact-action" data-close aria-label="${e(tr("Закрыть"))}">${icon("close")}</button></header><p class="sub">${e(tr("Подтвердите почту для входа или создания аккаунта сервиса скриптов."))}</p><label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" maxlength="254" required></label><label class="remember" data-register-option><input type="checkbox" name="can_register">${e(tr("Создать Null’s Connect, если аккаунта ещё нет"))}</label><label class="field" data-pin hidden><span>${e(tr("Код подтверждения"))}</span><input class="input" name="pin" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{1,16}" maxlength="16"></label><label class="remember"><input type="checkbox" name="remember">${e(tr("Сохранить вход на этом устройстве"))}</label><p class="dialog-error" role="status"></p><div class="actions"><button type="button" class="button" data-back hidden>${icon("back")}${e(tr("Назад"))}</button><button type="submit" class="button primary">${icon("connect")}<span>${e(tr("Получить код"))}</span></button></div></form>`;
    const form=dialog.querySelector("form"),submit=form.querySelector('[type="submit"]'),error=form.querySelector(".dialog-error"),back=form.querySelector("[data-back]");let pinRequired=false;
    form.elements.remember.checked=remember;dialog.querySelector("[data-close]").onclick=()=>dialog.close();back.onclick=()=>{pinRequired=false;form.elements.email.readOnly=false;form.elements.pin.value="";form.elements.pin.required=false;form.querySelector("[data-pin]").hidden=true;back.hidden=true;form.querySelector("[data-register-option]").hidden=false;submit.querySelector("span").textContent=tr("Получить код");error.textContent="";form.elements.email.focus();};
    form.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;submit.disabled=true;back.disabled=true;error.textContent=tr("Загрузка…");pending.remember=form.elements.remember.checked;sessionStorage.setItem("connect-pending",JSON.stringify(pending));try{const result=await js("/api/auth/connect/email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:form.elements.email.value.trim(),...(pinRequired?{pin:form.elements.pin.value.trim()}:{}),can_register:form.elements.can_register.checked,locale:locale().split("-")[0],state:stateId})});if(!dialog.open)return;if(result.pin_required){pinRequired=true;form.elements.email.readOnly=true;form.querySelector("[data-register-option]").hidden=true;form.querySelector("[data-pin]").hidden=false;form.elements.pin.required=true;back.hidden=false;submit.querySelector("span").textContent=tr("Войти");error.textContent=tr("Код отправлен на почту или в подключённый Telegram.");form.elements.pin.focus();}else{form.elements.pin.value="";form.elements.email.value="";await completeConnect({state:stateId,id_token:result.id_token});}}catch(reason){if(dialog.open)error.textContent=reason.message;}finally{submit.disabled=false;back.disabled=false;}};
    dialog.addEventListener("close",()=>{if(connectDialog===dialog)connectDialog=null;form.reset();try{const active=JSON.parse(sessionStorage.getItem("connect-pending")||"null");if(active?.state===stateId)sessionStorage.removeItem("connect-pending");}catch{}dialog.remove();});connectDialog=dialog;document.body.append(dialog);dialog.showModal();form.elements.email.focus();
  }
  async function completeConnect(payload){let pending;try{pending=JSON.parse(sessionStorage.getItem("connect-pending")||"null");}catch{}if(!pending||payload.state!==pending.state||Date.now()-pending.time>600000||typeof payload.id_token!=="string"||payload.id_token.length>32768){toast(tr("Подтверждение истекло. Войдите через Null’s Connect снова."));return;}sessionStorage.removeItem("connect-pending");connectDialog?.close();if(pending.owner&&state.user?.uuid&&state.user.uuid!==pending.owner){toast(tr("Аккаунт изменён."));return;}try{const result=await js("/api/auth/connect",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id_token:payload.id_token,guest:!pending.owner,expected_user_uuid:pending.owner,remember:pending.remember})});if(result.sign_up_token){state.restoring=false;go("/account");registerAccount(result.sign_up_token,pending.remember);return;}acceptAccount(result,pending.remember);toast(tr("Вход выполнен"));}catch(reason){state.restoring=false;go("/account");toast(reason.message);}}
  window.addEventListener("message",event=>{if(event.origin!==(apiOrigin||location.origin)||event.data?.type!=="nulls-connect"||connectDialog)return;void completeConnect(event.data);});
  function favorites() {
    if (!state.user) { main.innerHTML = heading(tr("Избранное")) + `<div class="notice">${e(tr("Войдите, чтобы увидеть избранное."))} ${link("/account", tr("Войти"))}</div>`; return; }
    const items = state.catalog?.scripts.filter(item => state.favorites.has(item.uuid)) || [];
    main.innerHTML = heading(tr("Избранное"), "", String(items.length)) + (items.length ? `<div class="grid">${items.slice(0, state.visible).map(card).join("")}</div>${items.length > state.visible ? `<div style="text-align:center;margin:24px 0">${button("Показать ещё", "more")}</div>` : ""}` : `<div class="empty">${e(tr("В избранном пока пусто"))}</div>`);
  }
  function mine() {
    if (!state.user) { main.innerHTML = heading(tr("Мои скрипты")) + `<div class="notice">${e(tr("Войдите, чтобы увидеть свои скрипты."))} ${link("/account", tr("Войти"))}</div>`; return; }
    main.innerHTML = heading(tr("Мои скрипты"), "", state.ownLoaded ? String(state.own.length) : "") + `<div class="actions own-actions">${button("+ Новый скрипт", "new", "primary")}</div>` + (state.own.length ? `<div class="grid">${state.own.map(card).join("")}</div>` : `<div class="empty">${e(tr(state.ownLoaded ? "Скриптов пока нет" : "Загружаю скрипты…"))}</div>`);
    if (!state.ownLoaded) loadOwn();
  }
  async function loadOwn(force = false) {
    if (!state.user) return;
    if (state.ownLoading) { await state.ownPromise; return force ? loadOwn(true) : undefined; }
    if (force) state.ownLoaded = false;
    state.ownLoading = true;
    const owner = state.user.uuid;
    state.ownPromise = (async () => { try {
      const data = await js("/api/users/" + owner + "/scripts",{fresh:force});
      if (!state.user || state.user.uuid !== owner) return;
      state.own = (data.scripts || []).map(item => ({ ...item, author_uuid: state.user.uuid, author_name: state.user.name, author_username: state.user.username }));
      state.ownLoaded = true;
      if (routePath() === "/mine") mine();
    } catch (error) { if (routePath() === "/mine") main.innerHTML = heading(tr("Мои скрипты")) + `<div class="empty">${e(error.message)} ${button("Повторить", "retry-own")}</div>`; }
    finally { state.ownLoading = false; } })();
    return state.ownPromise;
  }
  function mapInternalId(value) {
    const raw=String(value||"").trim();if(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(raw))return raw;
    try{const url=new URL(raw);if(!/^https?:$/.test(url.protocol)||url.hostname.toLowerCase()!=="link.nulls.gg"||!url.pathname.startsWith("/nulls-brawl/createAndJoinRoom/"))return null;const room=(url.searchParams.get("roomname")||"").trim();if(!room.toLowerCase().startsWith("map:"))return null;const id=room.slice(4);return /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(id)?id:null;}catch{return null;}
  }
  function mapLink(id){const url=new URL("https://link.nulls.gg/nulls-brawl/createAndJoinRoom/en");url.searchParams.set("roomname","map:"+id);url.searchParams.set("friendly","1");url.searchParams.set("side","0");return url.href;}
  function attachedMaps(){const found=new Map;for(const script of state.catalog?.scripts||[]){const id=script.user_map_internal_id;if(id&&!found.has(id))found.set(id,{internal_id:id,name:script.name,script});}return [...found.values()];}
  function mapCard(map,own=false){const id=map.internal_id||map.user_map_internal_id||"";return `<article class="map-card panel"><span class="map-pin">${icon("map")}</span><div class="map-copy"><h2>${e(map.name||tr("Карта"))}</h2><p>${e(id)}</p>${map.script?`<a href="${e(routeHref("/scripts/"+map.script.uuid))}" data-route="/scripts/${e(map.script.uuid)}">${e(map.script.name)}</a>`:""}</div><div class="map-actions"><a class="button compact-action" href="${e(mapLink(id))}" title="${e(tr("Открыть карту"))}" aria-label="${e(tr("Открыть карту"))}">${icon("play")}</a>${own?button("Переименовать","rename-map")+button("Удалить","delete-map","danger"):""}</div><span class="map-data" data-map-id="${e(map.user_map_id||"")}" data-map-internal="${e(id)}" data-map-name="${e(map.name||"")}"></span></article>`;}
  async function loadMaps(force=false){if(!state.user)return;if(state.mapsLoading)return;if(state.mapsLoaded&&!force)return;state.mapsLoading=true;const owner=state.user.uuid;try{const data=await js("/api/users/"+owner+"/maps",{fresh:force});if(state.user?.uuid!==owner)return;state.maps=Array.isArray(data.maps)?data.maps:[];state.mapsLoaded=true;if(routePath()==="/maps")mapLibrary();}catch(error){if(routePath()==="/maps")toast(error.message);}finally{state.mapsLoading=false;}}
  function mapLibrary(){const shared=attachedMaps(),own=state.user?state.maps:[];main.innerHTML=heading(tr("Карты"),tr("Карты из опубликованных скриптов и вашего аккаунта"),String(shared.length+own.length))+(state.user?`<div class="actions own-actions">${button("Импортировать карту","import-map","primary")}</div><h2>${e(tr("Мои карты"))}</h2>${own.length?`<div class="map-grid">${own.map(map=>mapCard(map,true)).join("")}</div>`:`<div class="empty">${e(tr(state.mapsLoaded?"Карт пока нет":"Загружаю карты…"))}</div>`}`:`<div class="notice">${e(tr("Войдите, чтобы импортировать карты и прикреплять их к скриптам."))}</div>`)+`<h2>${e(tr("Карты скриптов"))}</h2>${shared.length?`<div class="map-grid">${shared.map(map=>mapCard(map)).join("")}</div>`:`<div class="empty">${e(tr("К опубликованным скриптам пока не прикреплены карты"))}</div>`}`;if(state.user&&!state.mapsLoaded)void loadMaps();}
  function importMapDialog(){if(!state.user){go("/account");return;}const dialog=document.createElement("dialog");dialog.className="preset-dialog map-dialog";dialog.innerHTML=`<form><h2>${e(tr("Импортировать карту"))}</h2><label class="field"><span>${e(tr("Ссылка на карту"))}</span><textarea class="input" name="url" rows="3" required placeholder="https://link.nulls.gg/nulls-brawl/createAndJoinRoom/…"></textarea></label><label class="field"><span>${e(tr("Название"))}</span><input class="input" name="name" minlength="3" maxlength="64" required value="${e(tr("Новая карта"))}"></label><p class="dialog-error"></p><div class="actions"><button type="button" class="button" data-close>${e(tr("Отмена"))}</button><button class="button primary" type="submit">${icon("upload")}${e(tr("Импортировать"))}</button></div></form>`;const form=dialog.querySelector("form"),error=dialog.querySelector(".dialog-error");dialog.querySelector("[data-close]").onclick=()=>dialog.close();dialog.addEventListener("close",()=>dialog.remove());form.onsubmit=async event=>{event.preventDefault();const id=mapInternalId(form.elements.url.value);if(!id){error.textContent=tr("Некорректная ссылка на карту");return;}const save=form.querySelector('[type="submit"]');save.disabled=true;try{await js("/api/maps",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({map_internal_id:id,name:form.elements.name.value.trim()})});state.mapsLoaded=false;await loadMaps(true);dialog.close();toast(tr("Карта импортирована"));}catch(reason){error.textContent=reason.message;save.disabled=false;}};document.body.append(dialog);dialog.showModal();form.elements.url.focus();}
  function renameMapDialog(map){const dialog=document.createElement("dialog");dialog.className="preset-dialog map-dialog";dialog.innerHTML=`<form><h2>${e(tr("Переименовать карту"))}</h2><input class="input" name="name" minlength="3" maxlength="64" required value="${e(map.name)}"><div class="actions"><button type="button" class="button" data-close>${e(tr("Отмена"))}</button><button class="button primary" type="submit">${icon("save")}${e(tr("Сохранить"))}</button></div></form>`;dialog.querySelector("[data-close]").onclick=()=>dialog.close();dialog.addEventListener("close",()=>dialog.remove());dialog.querySelector("form").onsubmit=async event=>{event.preventDefault();await js("/api/maps/"+map.user_map_id+"/name",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({name:event.target.elements.name.value.trim()})});state.mapsLoaded=false;await loadMaps(true);dialog.close();toast(tr("Карта переименована"));};document.body.append(dialog);dialog.showModal();dialog.querySelector("input").select();}
  async function openEditor(id = null) {
    if (state.restoring) { main.innerHTML = `<div class="loading">${e(tr("Восстанавливаю сессию…"))}</div>`; return; }
    if (!state.user) { go("/account"); return; }
    const path = id ? "/edit/" + id : "/new";if(!state.mapsLoaded)await loadMaps().catch(()=>{});if(routePath()!==path)return;
    if (!id) { state.editor = { id: null, original: { name: "", description: "", content: "", user_map_id: "" } }; renderEditor(); return; }
    main.innerHTML = `<div class="loading">${e(tr("Открываю редактор…"))}</div>`;
    try {
      const [script, source] = await Promise.all([js("/api/scripts/" + id), js("/api/scripts/" + id + "/content")]);
      if (routePath() !== path) return;
      if (!state.ownLoaded) await loadOwn();
      if (script.author_uuid !== state.user.uuid && !state.own.some(item => item.uuid === id)) throw Error(tr("Скрипт не принадлежит этому аккаунту."));
      state.editor = { id, original: { name: script.name || "", description: script.description || "", content: source.content || "", user_map_id: script.user_map_id || "" }, published: !!script.published_at };
      renderEditor();
    } catch (error) { main.innerHTML = `<div class="empty">${e(error.message)}</div>`; }
  }
  function renderEditor() {
    const editor = state.editor;
    if (!editor) return;
    main.innerHTML = `<button class="back" data-action="back">← ${e(tr("Мои скрипты"))}</button>` + heading(tr(editor.id ? "Редактировать скрипт" : "Новый скрипт")) +
      `<form id="script-editor" class="panel editor"><label class="field"><span>${e(tr("Название"))}</span><input class="input" name="name" minlength="3" maxlength="32" required value="${e(editor.original.name)}"></label><label class="field"><span>${e(tr("Описание"))}</span><textarea class="input editor-description" name="description" maxlength="1024">${e(editor.original.description)}</textarea></label><label class="field"><span>${e(tr("Карта"))}</span><select class="select" name="map"><option value="">${e(tr("Без карты"))}</option>${state.maps.map(map=>`<option value="${e(map.user_map_id)}" ${map.user_map_id===editor.original.user_map_id?"selected":""}>${e(map.name)} · ${e(map.internal_id)}</option>`).join("")}</select></label><div class="field"><span>${e(tr("Код Luau"))}</span>${codeSearchMarkup()}<div class="editor-code">${lineGutterMarkup()}<pre class="editor-highlight" aria-hidden="true"><code id="editor-preview"></code></pre><textarea class="editor-source" name="content" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" required>${e(sourceForUse(editor.original.content))}</textarea></div></div><section class="code-validation"><label class="validation-toggle"><input type="checkbox" data-validate-enabled>${e(tr("Проверка синтаксиса"))}</label><div data-validation-controls hidden><p class="sub">${e(tr("Проверяет синтаксис Luau, не запускает скрипт."))}</p><button type="button" class="button small" data-validate-code>${icon("check")}${e(tr("Проверить код"))}</button><p data-validation-result role="status"></p></div></section><div class="actions"> <button class="button primary" type="submit">${e(tr("Сохранить на сервере"))}</button></div></form>`;
    const source=main.querySelector('.editor-source');bindValidation(source);source.codeSearch=bindCodeSearch(main.querySelector('.code-tools'),source,main.querySelector('#editor-preview'),true);
  }
  function bindValidation(source){const form=source.form,toggle=form.querySelector("[data-validate-enabled]"),controls=form.querySelector("[data-validation-controls]"),button=form.querySelector("[data-validate-code]"),result=form.querySelector("[data-validation-result]");let worker=null,timer;const stop=()=>{clearTimeout(timer);worker?.terminate();worker=null;button.disabled=false;};toggle.checked=localStorage.getItem("validate-code")==="true";controls.hidden=!toggle.checked;toggle.onchange=()=>{localStorage.setItem("validate-code",String(toggle.checked));controls.hidden=!toggle.checked;stop();result.textContent="";};source.addEventListener("input",()=>{stop();result.textContent="";});button.onclick=()=>{stop();if(source.value.length>1000000){result.textContent=tr("Код слишком большой для проверки");return;}button.disabled=true;result.textContent=tr("Проверяю код…");const finish=data=>{stop();if(!source.isConnected)return;result.textContent=data.valid?tr("Синтаксических ошибок нет"):data.diagnostic?tr("Ошибка синтаксиса")+String.fromCharCode(10)+data.diagnostic:tr("Проверка недоступна. Попробуйте снова.");result.classList.toggle("validation-ok",data.valid===true);};try{worker=new Worker(new URL("/validator/worker.js",location.origin),{type:"module"});worker.onmessage=event=>finish(event.data);worker.onerror=()=>finish({valid:false});timer=setTimeout(()=>finish({valid:false}),10000);worker.postMessage(source.value);}catch{finish({valid:false});}};}
  function syncEditorScroll(source){const preview=source.parentElement.querySelector(".editor-highlight");if(preview){preview.scrollTop=0;preview.scrollLeft=0;}syncCodeLines(source);}
  document.addEventListener("scroll",event=>{if(event.target.matches?.(".editor-source"))syncEditorScroll(event.target);},true);
  async function saveEditor(form) {
    const editor = state.editor;
    if (!editor || !state.user) return;
    const name = form.elements.namedItem("name").value.trim();
    const description = form.elements.namedItem("description").value.trim();
    const selectedMap = form.elements.namedItem("map").value || null;
    const content = sourceForUse(form.elements.namedItem("content").value);
    if (name.length < 3 || name.length > 32 || description && (description.length < 32 || description.length > 1024) || !content.trim() || new Blob([content]).size > 5 * 1024 * 1024) { toast(tr("Проверьте название, описание и код.")); return; }
    const save = form.querySelector('button[type="submit"]'); save.disabled = true;
    let id = editor.id;
    try {
      if (!id) {
        const created = await js("/api/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, content }) });
        id = created.uuid; if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw Error(tr("Сервис не вернул ID скрипта."));
        editor.id = id;
      } else {
        if (content !== editor.original.content) await js("/api/scripts/" + id + "/content", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
        if (name !== editor.original.name) await js("/api/scripts/" + id + "/name", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      }
      if (description !== editor.original.description) await js("/api/scripts/" + id + "/description", { method: description ? "PUT" : "DELETE", headers: { "content-type": "application/json" }, body: description ? JSON.stringify({ description }) : undefined });
      if (selectedMap !== (editor.original.user_map_id || null)) await js("/api/scripts/" + id + "/map", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_map_id: selectedMap }) });
      if (editor.published && (content !== editor.original.content || name !== editor.original.name || description !== editor.original.description || selectedMap !== (editor.original.user_map_id || null))) { editedSincePublish.add(id); publishedWithoutFurtherEdit.delete(id); }
      state.codes.delete(id); state.codeVersions.delete(id); state.ownLoaded = false; await loadOwn(true);
      go("/scripts/" + id); toast(tr("Скрипт сохранён"));
    } catch (error) { toast(error.message); save.disabled = false; }
  }
  async function publishScript(control) {
    const script = state.detail;
    if (!script || !state.user || !canPublish(script) || control.disabled) return;
    control.disabled = true;
    control.textContent = tr("Публикую…");
    try {
      await js("/api/scripts/" + script.uuid + "/publish", { method: "POST" });
      editedSincePublish.delete(script.uuid); publishedWithoutFurtherEdit.add(script.uuid); releaseCache.delete(script.uuid);
      state.ownLoaded = false; await loadOwn(true);
      state.detail = { ...script, ...await js("/api/scripts/" + script.uuid) }; detail(); toast(tr("Скрипт опубликован"));
    } catch (error) { toast(error.message); }
    finally { control.disabled = false; control.textContent = tr("Опубликовать версию"); }
  }
  function deleteOwnScript(){
    const script=state.detail,owner=state.user?.uuid;if(!script||!owner||!(script.author_uuid===owner||state.own.some(item=>item.uuid===script.uuid)))return;
    const dialog=document.createElement("dialog");dialog.className="preset-dialog";
    dialog.innerHTML=`<h2>${e(tr("Удалить скрипт"))}</h2><p>${e(script.name)}</p><p class="sub">${e(tr("Скрипт будет удалён на сервере. Это действие нельзя отменить."))}</p><div class="actions"><button type="button" class="button" id="cancel-delete">${e(tr("Отмена"))}</button><button type="button" class="button danger" id="confirm-delete">${icon("trash")}${e(tr("Удалить"))}</button></div>`;
    dialog.addEventListener("close",()=>dialog.remove());dialog.querySelector("#cancel-delete").onclick=()=>dialog.close();
    dialog.querySelector("#confirm-delete").onclick=async event=>{const button=event.currentTarget;if(state.user?.uuid!==owner){dialog.close();return;}button.disabled=true;
      try{await js("/api/scripts/"+script.uuid,{method:"DELETE"});if(state.user?.uuid!==owner){dialog.close();return;}
        state.codes.delete(script.uuid);state.codeVersions.delete(script.uuid);state.favorites.delete(script.uuid);releaseCache.delete(script.uuid);editedSincePublish.delete(script.uuid);publishedWithoutFurtherEdit.delete(script.uuid);
        state.own=state.own.filter(item=>item.uuid!==script.uuid);if(state.catalog){state.catalog.scripts=state.catalog.scripts.filter(item=>item.uuid!==script.uuid);catalogStore.set(state.catalog);}if(state.authorScripts)state.authorScripts=state.authorScripts.filter(item=>item.uuid!==script.uuid);
        try{const entries=JSON.parse(localStorage.getItem("recent-scripts")||"[]");localStorage.setItem("recent-scripts",JSON.stringify(entries.filter(item=>item.uuid!==script.uuid)));}catch{}
        try{const db=await codeDb();if(db)await new Promise((resolve,reject)=>{const transaction=db.transaction("codes","readwrite");transaction.objectStore("codes").delete(owner+":"+script.uuid);transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});}catch{}
        state.detail=null;dialog.close();go("/mine");toast(tr("Скрипт удалён"));
      }catch(error){toast(error.message);button.disabled=false;}
    };
    document.body.appendChild(dialog);dialog.showModal();
  }
  function help() {
    const question = (title, answer) => `<div class="panel"><p class="eyebrow">${e(tr(title))}</p><p>${e(tr(answer))}</p></div>`;
    main.innerHTML = heading(tr("Помощь")) +
      question("НУЖЕН ЛИ АККАУНТ?", "Нет. Смотреть скрипты и авторов можно сразу. Для избранного, просмотра кода и своих скриптов войдите в аккаунт.") +
      question("КАК НАЧАТЬ БОЙ?", "Откройте скрипт, нажмите «Настроить и запустить бой», выберите параметры и запустите. Если у автора не подключён Null’s Connect, сервис не выдаст ссылку на бой.") +
      question("КАК ИСКАТЬ ПО КОДУ?", "В библиотеке нажмите «Индексировать код», дождитесь загрузки и выберите «Код» в поле «Искать в». Недоступный аккаунту код в поиск не попадёт.") +
      `<div class="panel">${preferenceButton("language")}</div>`;
  }
  async function renderRoute() {
    document.body.classList.remove("battle-mode");
    if(!state.restoring){bindingPreferences=true;try{preferenceSync.bind(state.user?.uuid||"");}finally{bindingPreferences=false;}}
    const path = decodeURIComponent(routePath());
    document.documentElement.lang = locale();
    activeNav(path);
    if (path === "/authors") { authors(); return; }
    if (path === "/favorites") { favorites(); return; }
    if (path === "/maps") { mapLibrary(); return; }
    if (path === "/recent") { recentScripts(); return; }
    if (path === "/mine") { mine(); return; }
    if (path === "/new") { await openEditor(); return; }
    if (/^\/edit\/[0-9a-fA-F-]{36}$/.test(path)) { await openEditor(path.slice(6)); return; }
    if (path === "/account") { account(); return; }
    if(path==="/stats"){await showStats();return;}
    if (path === "/help") { help(); return; }
    if (path.startsWith("/authors/")) {
      const handle = path.slice(9).replace(/^@/, "");
      state.author = state.catalog?.authors.find(author => author.username.toLowerCase() === handle.toLowerCase()) || null;
      state.authorScripts = null;authorPageIndex=0;
      authorPage();
      try {
        if (!state.author) state.author = await js("/api/users/@" + encodeURIComponent(handle));
        if (routePath() !== path) return;
        authorPage();
        if (!state.catalog?.authors.some(author => author.uuid === state.author.uuid)) {
          const data = await js("/api/users/" + state.author.uuid + "/scripts");
          if (routePath() !== path) return;
          state.authorScripts = (data.scripts || []).filter(item => item.published_at).map(item => ({ ...item, author_uuid: state.author.uuid, author_name: state.author.name, author_username: state.author.username }));
          authorPage();
        }
      } catch (error) { if (!state.author) main.innerHTML = `<div class="empty">${e(error.message)}</div>`; else toast(error.message); }
      return;
    }
    if (/^\/scripts\/[0-9a-fA-F-]{36}$/.test(path)) {
      const id = path.slice(9);
      state.detail = state.catalog?.scripts.find(item => item.uuid === id) || state.own.find(item => item.uuid === id) || null;
      detail();
      try {
        const fresh = await js("/api/scripts/" + id);
        if (routePath() !== path) return;
        state.detail = { ...state.detail, ...fresh, author_username: state.detail?.author_username };
        detail();
      } catch (error) { if (!state.detail) main.innerHTML = `<div class="empty">${e(error.message)}</div>`; }
      return;
    }
    library();
  }
  async function loadCatalog(refresh = false) {
    state.catalogError="";if(!state.catalog&&(routePath()==="/"||routePath()==="/authors"))renderRoute();
    try {
      const data = await js("/data/catalog" + (refresh ? "?refresh=" + Date.now() : ""));
      if(!Array.isArray(data.authors)||!Array.isArray(data.scripts))throw Error(tr("Не удалось выполнить"));
      for (const script of data.scripts) if (state.codes.has(script.uuid) && state.codeVersions.get(script.uuid) !== (script.updated_at || script.created_at || "")) { state.codes.delete(script.uuid); state.codeVersions.delete(script.uuid); }
      state.catalog = data;
      catalogStore.set(data);
      const node = document.getElementById("catalog-age");
      node.textContent = `${data.authors.length} ${tr("авторов")} · ${data.scripts.length} ${tr("скриптов")}`;
      if(!document.getElementById("battle-form")&&!document.getElementById("script-editor"))renderRoute();
      if (refresh) toast(tr("Список обновлён"));
    } catch (error) { state.catalogError=error.name==="TimeoutError"?tr("Загрузка заняла слишком много времени. Попробуйте снова."):error.message;if (!state.catalog) renderRoute(); else toast(state.catalogError); }
  }
  function telemetryClient(){let id=localStorage.getItem("usage-client");if(!id){id=crypto.randomUUID();localStorage.setItem("usage-client",id);}return id;}
  let telemetryBusy=false;
  function usageDecided(){try{return localStorage.getItem("usage-decided")==="true";}catch{return false;}}
  async function sendTelemetry(){
    if(telemetryBusy||!usageDecided()||localStorage.getItem("usage-enabled")==="false")return;
    try{const stamp=(state.user?.uuid||"guest")+":1.7.3",sent=JSON.parse(localStorage.getItem("usage-last")||"null");if(sent?.stamp===stamp&&Date.now()-sent.time<900000)return;telemetryBusy=true;
      await js("/api/library/telemetry",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({client_id:telemetryClient(),platform:"web",version:"1.7.3"})});localStorage.setItem("usage-last",JSON.stringify({stamp,time:Date.now()}));
    }catch{}finally{telemetryBusy=false;}
  }
  function accountSettings(){
    if(!state.user){go("/account");return;}
    main.innerHTML=heading(tr("Настройки аккаунта"))+`<button class="back" data-route="/account">← ${e(tr("Аккаунт"))}</button><form id="change-password" class="panel login"><h2>${e(tr("Сменить пароль"))}</h2>${state.user.has_password!==false?`<label class="field"><span>${e(tr("Текущий пароль"))}</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>`:""}<label class="field"><span>${e(tr("Новый пароль"))}</span><input class="input" type="password" name="new_password" minlength="8" maxlength="512" autocomplete="new-password" required></label><label class="field"><span>${e(tr("Повторите пароль"))}</span><input class="input" type="password" name="confirm_password" minlength="8" maxlength="512" autocomplete="new-password" required></label><button class="button primary" type="submit">${icon("save")}${e(tr("Сохранить"))}</button></form>`;
  }
  async function showStats(){
    if(!state.user){go("/account");return;}
    main.innerHTML=heading(tr("Статистика"))+`<p class="loading">${e(tr("Загрузка…"))}</p>`;
    try{const data=await js("/api/library/stats",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});if(routePath()!=="/stats")return;
      const metric=(title,value)=>`<div class="panel stat-card"><span class="sub">${e(tr(title))}</span><strong>${e(value??"—")}</strong></div>`;
      const active=platform=>data.active.find(item=>item.platform===platform)||{},logged=platform=>data.logins.find(item=>item.platform===platform)||{};
      main.innerHTML=heading(tr("Статистика"))+`<div class="stats-grid">${metric("Скачивания APK (GitHub)",data.downloads)}${metric("Пользователи приложения",data.installs.android||0)}${metric("Пользователи сайта",data.installs.web||0)}${metric("Вошедшие аккаунты",data.accounts||0)}</div><p class="sub">${e(tr("Вошедшие пользователи учитываются по аккаунту. Без входа учитывается устройство или браузер."))}</p><div class="panel stats-table"><table><thead><tr><th>${e(tr("Активность"))}</th><th>${e(tr("Сегодня"))}</th><th>7 ${e(tr("дней"))}</th><th>30 ${e(tr("дней"))}</th></tr></thead><tbody>${[["Сайт",active("web")],["Приложение",active("android")],["Вход на сайте",logged("web")],["Вход в приложении",logged("android")]].map(([name,row])=>`<tr><td>${e(tr(name))}</td><td>${row.today||0}</td><td>${row.week||0}</td><td>${row.month||0}</td></tr>`).join("")}</tbody></table></div><h2>${e(tr("По дням"))}</h2><div class="panel stats-table"><table><thead><tr><th>${e(tr("Дата"))}</th><th>${e(tr("Платформа"))}</th><th>${e(tr("Активные"))}</th><th>${e(tr("Со входом"))}</th></tr></thead><tbody>${data.daily.map(row=>`<tr><td>${e(row.day)}</td><td>${e(tr(row.platform==="web"?"Сайт":"Приложение"))}</td><td>${row.active}</td><td>${row.logged_in}</td></tr>`).join("")}</tbody></table></div>`;
    }catch(error){if(routePath()==="/stats")main.innerHTML=heading(tr("Статистика"))+`<p class="empty">${e(error.message)}</p>`;}
  }
  let permissionsBusy=false,permissionsTime=0;
  async function loadPermissions(){if(!state.user||permissionsBusy)return;permissionsBusy=true;const owner=state.user.uuid;try{const result=await js("/api/library/permissions",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});if(state.user?.uuid!==owner||result.user_uuid!==owner)return;state.permissions=result.permissions;state.owner=result.owner===true;state.permissionOwner=owner;permissionsTime=Date.now();if(routePath()==="/account")account();}catch{if(state.user?.uuid===owner){state.permissions=null;state.owner=false;state.permissionOwner="";}}finally{permissionsBusy=false;}}
  window.addEventListener("focus",()=>{if(Date.now()-permissionsTime>60000)void loadPermissions();});
  async function restore() {
    if(bundled&&!localSession){state.restoring=false;renderRoute();sendTelemetry();return;}
    try {
      state.user=await js("/api/users/me",{signal:AbortSignal.timeout(10000)});state.restoring=false;renderRoute();void loadPermissions();
      sendTelemetry();void loadOwn();void loadFavorites().then(()=>{if(routePath()==="/favorites")favorites();else if(state.detail&&routePath()==="/scripts/"+state.detail.uuid&&!document.getElementById("battle-form"))detail();});
    } catch(error) {
      if(error.status===401||error.status===403){state.user=null;if(bundled){localSession="";sessionStore.clear();}}
      else toast(tr("Не удалось восстановить сессию. Повторите попытку."));
      state.restoring=false;renderRoute();sendTelemetry();
    }
  }
  async function loadFavorites() {
    if (!state.user) return;
    try { const data = await js("/api/users/" + state.user.uuid + "/favorites"); state.favorites = new Set((data.scripts || []).map(item => item.uuid));document.querySelectorAll(".card-quick[data-script-id]").forEach(row=>{const control=row.querySelector('[data-action="quick-favorite"]');if(control){const selected=state.favorites.has(row.dataset.scriptId);control.classList.toggle("is-active",selected);control.setAttribute("aria-pressed",String(selected));}}); } catch { state.favorites.clear(); }
  }
  async function downloadScript(script){
    const content = await scriptContent(script.uuid);
        const blob = new Blob([sourceForUse(content)], {type:"application/octet-stream"});
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = (script.name || "script").replace(/[\\/:*?"<>|]/g, "_").replace(/(?:\.lua)?(?:\.txt)?$/i, "") + ".lua";
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function share(path) {
    const url = new URL(bundled ? "/#" + path : path, publicOrigin).href;
    try { if (navigator.share) await navigator.share({ url }); else { await navigator.clipboard.writeText(url); toast(tr("Ссылка скопирована")); } }
    catch (error) { if (error.name !== "AbortError") toast(tr("Не удалось поделиться")); }
  }
  // Iterative lexer: no recursive regular expressions on long generated strings.
  function luaTokens(text){
    const tokens=[],keywords=new Set("and break do else elseif end false for function if in local nil not or repeat return then true until while continue export type".split(" "));
    const word=c=>!!c&&/[A-Za-z0-9_]/.test(c),digit=c=>!!c&&c>="0"&&c<="9";
    for(let i=0;i<text.length;){const start=i;let kind="",quote=text[i],comment=text.startsWith("--",i);if(comment){i+=2;kind="comment";}
      let opener=i;if(text[opener]==="["){let j=opener+1;while(text[j]==="=")j++;if(text[j]==="["){const close="]"+"=".repeat(j-opener-1)+"]",end=text.indexOf(close,j+1);i=end<0?text.length:end+close.length;kind=comment?"comment":"string";tokens.push({start,end:i,kind});continue;}}
      if(comment){const end=text.indexOf("\n",i);i=end<0?text.length:end;}
      else if(quote==='"'||quote==="'"){kind="string";i++;while(i<text.length){const c=text[i++];if(c==="\\")i=Math.min(text.length,i+1);else if(c===quote)break;}}
      else if(/[A-Za-z_]/.test(quote)){i++;while(word(text[i]))i++;if(keywords.has(text.slice(start,i)))kind="key";}
      else if(digit(quote)){kind="number";i++;while(word(text[i])||text[i]===".")i++;}
      else i++;
      if(kind)tokens.push({start,end:i,kind});
    }return tokens;
  }
  function highlight(source){const tokens=luaTokens(source);let out="",at=0;for(const token of tokens){out+=e(source.slice(at,token.start))+`<span class="tok-${token.kind}">${e(source.slice(token.start,token.end))}</span>`;at=token.end;}return out+e(source.slice(at));}
  function lineGutterMarkup(){return '<div class="code-gutter" aria-hidden="true"><pre class="line-number-list"></pre></div>';}
  function syncCodeLines(viewport){
    const wrapper=viewport.parentElement,gutter=wrapper.querySelector('.line-number-list');if(!gutter)return;
    const count=Number(viewport.dataset.lineCount)||1,style=getComputedStyle(viewport),height=parseFloat(style.lineHeight),padding=parseFloat(style.paddingTop)||0;
    if(!height||!viewport.clientHeight)return;
    wrapper.style.setProperty('--gutter-width',(Math.max(3,String(count).length)+2)+'ch');
    const first=Math.max(0,Math.floor((viewport.scrollTop-padding)/height)-1),last=Math.min(count,first+Math.ceil(viewport.clientHeight/height)+4);
    let lines='';for(let i=first;i<last;i++)lines+=(i+1)+(i+1<last?String.fromCharCode(10):'');
    gutter.textContent=lines;gutter.style.transform='translateY('+(padding+first*height-viewport.scrollTop)+'px)';
  }
  function codeSearchMarkup(){
    const arrow=(direction,title)=>`<button type="button" class="code-search-arrow" data-code-step="${direction}" title="${e(tr(title))}" aria-label="${e(tr(title))}"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${direction<0?'M6 15l6-6 6 6':'M6 9l6 6 6-6'}"/></svg></button>`;
    return `<section class="code-tools"><div class="code-stats-row"><p class="code-stats"></p><button type="button" class="button small" data-go-line title="${e(tr("Перейти к строке"))}">${icon("code")}${e(tr("Перейти к строке"))}</button></div><div class="code-search"><input type="search" class="input code-search-input" placeholder="${e(tr('Поиск в коде'))}" aria-label="${e(tr('Поиск в коде'))}" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="code-search-arrow code-case" aria-pressed="false" title="${e(tr("Учитывать регистр"))}" aria-label="${e(tr("Учитывать регистр"))}"><svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3,17 L7,5 L11,17 M4.5,13 L9.5,13 M14,11 C14,8 20,8 20,11 L20,17 M20,12 C14,10 12,17 17,17 C19,17 20,15 20,14 M13,20 L21,20"/></svg></button><output class="code-match-count" aria-live="polite">0 / 0</output>${arrow(-1,'Предыдущее совпадение')}${arrow(1,'Следующее совпадение')}</div></section>`;
  }
  function bindCodeSearch(tools,source,target,editor=false){
    const query=tools.querySelector('input'),count=tools.querySelector('output'),stats=tools.querySelector('.code-stats'),arrows=[...tools.querySelectorAll('[data-code-step]')],caseButton=tools.querySelector('.code-case');
    let matches=[],current=-1,timer,caseSensitive=false,textCache="",lineStarts=[0],tokens=[],renderStart=0,frame=0,requestedLine=null;
    const value=()=>editor?source.value:source;
    function paint(){
      const viewport=editor?source:target.parentElement,style=getComputedStyle(viewport),height=parseFloat(style.lineHeight)||20,padding=parseFloat(style.paddingTop)||16;
      const first=Math.max(0,Math.floor((viewport.scrollTop-padding)/height)-3),last=Math.min(lineStarts.length,first+Math.ceil(viewport.clientHeight/height)+8);
      renderStart=lineStarts[Math.min(first,lineStarts.length-1)]||0;const renderEnd=last<lineStarts.length?lineStarts[last]:textCache.length;
      let html="",at=renderStart;let low=0,high=tokens.length;while(low<high){const mid=(low+high)>>1;if(tokens[mid].end<=renderStart)low=mid+1;else high=mid;}
      for(let i=low;i<tokens.length&&tokens[i].start<renderEnd;i++){const token=tokens[i],from=Math.max(renderStart,token.start),to=Math.min(renderEnd,token.end);const row=(()=>{let a=0,b=lineStarts.length;while(a<b){const m=(a+b)>>1;if(lineStarts[m]<=from)a=m+1;else b=m;}return Math.max(0,a-1);})(),column=from-lineStarts[row],left=Math.max(0,Math.floor(viewport.scrollLeft/8)-100),right=left+Math.ceil(viewport.clientWidth/6)+200;
        html+=e(textCache.slice(at,from));if(column<right&&to-lineStarts[row]>left)html+=`<span class="tok-${token.kind}">${e(textCache.slice(from,to))}</span>`;else html+=e(textCache.slice(from,to));at=to;}html+=e(textCache.slice(at,renderEnd));target.innerHTML=html+"\n ";
      target.style.display="block";target.style.transform=`translate(${ -viewport.scrollLeft}px,${first*height-viewport.scrollTop}px)`;
      if(matches.length){
        const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT),nodes=[];let offset=renderStart,index=0;while(index<matches.length&&matches[index].end<=renderStart)index++;const visibleEnd=Math.min(matches.length,index+200);
        while(walker.nextNode()){const node=walker.currentNode;nodes.push({node,start:offset,end:offset+node.length});offset+=node.length;}
        for(const {node,start,end} of nodes){
          while(index<visibleEnd&&matches[index].end<=start)index++;
          let j=index,cursor=start;const fragment=document.createDocumentFragment();let touched=false;
          while(j<visibleEnd&&matches[j].start<end){const match=matches[j],from=Math.max(start,match.start),to=Math.min(end,match.end);if(from>cursor)fragment.append(document.createTextNode(node.data.slice(cursor-start,from-start)));const mark=document.createElement('mark');mark.className='code-hit'+(j===current?' current':'');mark.textContent=node.data.slice(from-start,to-start);fragment.append(mark);cursor=to;touched=true;j++;}
          if(touched){if(cursor<end)fragment.append(document.createTextNode(node.data.slice(cursor-start)));node.replaceWith(fragment);}
        }
      }
      count.textContent=(current<0?0:current+1)+' / '+matches.length;count.setAttribute('aria-label',tr('Совпадения')+': '+count.textContent);arrows.forEach(button=>button.disabled=!matches.length);
      syncCodeLines(viewport);
    }
    function reveal(){
      if(current<0)return;const match=matches[current],viewport=editor?source:target.parentElement;let low=0,high=lineStarts.length;while(low<high){const mid=(low+high)>>1;if(lineStarts[mid]<=match.start)low=mid+1;else high=mid;}const row=Math.max(0,low-1),height=parseFloat(getComputedStyle(viewport).lineHeight)||20;
      viewport.scrollTop=Math.max(0,row*height-viewport.clientHeight/2);const canvas=document.createElement("canvas"),context=canvas.getContext("2d");context.font=getComputedStyle(viewport).font;viewport.scrollLeft=Math.max(0,context.measureText(textCache.slice(lineStarts[row],match.start).replace(/\t/g,"  ")).width-viewport.clientWidth/2);if(editor)source.setSelectionRange(match.start,match.end);paint();syncCodeLines(viewport);
    }
    function refresh(reset=false,navigate=false){
      clearTimeout(timer);const text=value();let characters=0,lines=1;lineStarts=[0];for(let i=0;i<text.length;i++){if(text.charCodeAt(i)<0xdc00||text.charCodeAt(i)>0xdfff)characters++;if(text[i]==='\n'){lines++;lineStarts.push(i+1);}}textCache=text;tokens=luaTokens(text);
      const viewport=editor?source:target.parentElement;viewport.dataset.lineCount=String(lines);syncCodeLines(viewport);
      stats.textContent=tr('Символов')+': '+characters+' · '+tr('Строк')+': '+lines;
      const prior=current>=0?matches[current]?.start:0;matches=[];
      if(query.value){const pattern=new RegExp(query.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),caseSensitive?'gu':'giu');let match;while((match=pattern.exec(text)))matches.push({start:match.index,end:match.index+match[0].length});}
      current=matches.length?(reset?0:Math.max(0,matches.findIndex(match=>match.start>=prior))):-1;paint();if(navigate)reveal();
    }
    function step(direction){clearTimeout(timer);if(!matches.length)return;current=(current+direction+matches.length)%matches.length;paint();reveal();}
    query.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>refresh(true,true),120);});
    query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();refresh(false);step(event.shiftKey?-1:1);}});
    tools.addEventListener('click',event=>{const button=event.target.closest('[data-code-step]');if(button){event.preventDefault();step(Number(button.dataset.codeStep));}});
    caseButton.addEventListener("click",()=>{caseSensitive=!caseSensitive;caseButton.setAttribute("aria-pressed",String(caseSensitive));refresh(true,true);});
    tools.querySelector("[data-go-line]").addEventListener("click",()=>{const text=value(),max=text.split(String.fromCharCode(10)).length,dialog=document.createElement("dialog");dialog.className="preset-dialog";dialog.innerHTML=`<form><h2>${e(tr("Перейти к строке"))}</h2><label>${e(tr("Номер строки"))} · 1–${max}<input class="input" name="line" type="number" min="1" max="${max}" value="1" required inputmode="numeric"></label><div class="actions"><button type="button" class="button" data-cancel>${e(tr("Отмена"))}</button><button class="button primary" type="submit">${e(tr("Открыть"))}</button></div></form>`;dialog.querySelector("[data-cancel]").onclick=()=>dialog.close();dialog.addEventListener("close",()=>dialog.remove());dialog.querySelector("form").onsubmit=event=>{event.preventDefault();const line=Number(dialog.querySelector("input").value);if(!Number.isInteger(line)||line<1||line>max)return;let offset=0;for(let n=1;n<line;n++)offset=text.indexOf(String.fromCharCode(10),offset)+1;dialog.close();refresh(false);const viewport=editor?source:target.parentElement;if(editor){if(!source.readOnly)source.focus({preventScroll:true});source.setSelectionRange(offset,offset);}requestedLine=line;const jump=()=>{if(!viewport.isConnected||requestedLine!==line)return;const style=getComputedStyle(viewport),height=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.55||20,padding=parseFloat(style.paddingTop)||0;viewport.scrollLeft=0;viewport.scrollTop=Math.max(0,padding+(line-1)*height-height);paint();syncCodeLines(viewport);};requestAnimationFrame(()=>{jump();requestAnimationFrame(jump);});setTimeout(jump,180);setTimeout(jump,360);};document.body.append(dialog);dialog.showModal();dialog.querySelector("input").select();});
    const viewport=editor?source:target.parentElement;viewport.addEventListener("scroll",()=>{syncCodeLines(viewport);if(!frame)frame=requestAnimationFrame(()=>{frame=0;paint();});},{passive:true});for(const type of ["pointerdown","wheel","keydown","input"])viewport.addEventListener(type,()=>{requestedLine=null;},{passive:true});const observer=new ResizeObserver(()=>{if(!viewport.isConnected){observer.disconnect();return;}if(requestedLine!==null){const style=getComputedStyle(viewport),height=parseFloat(style.lineHeight)||20;viewport.scrollTop=Math.max(0,(parseFloat(style.paddingTop)||0)+(requestedLine-2)*height);}paint();});observer.observe(viewport);
    refresh();return {refresh:()=>{clearTimeout(timer);timer=setTimeout(()=>refresh(false),180);}};
  }
  async function scriptContent(id) {
    if (state.codes.has(id)) return state.codes.get(id);
    const data = await js("/api/scripts/" + id + "/content");
    const content = data.content || "";
    state.codes.set(id, content);
    const script = state.catalog?.scripts.find(item => item.uuid === id) || state.own.find(item => item.uuid === id);
    if (script) { state.codeVersions.set(id, script.updated_at || script.created_at || ""); saveCodeCache([{ ...script, content }]); }
    return content;
  }
  function openCode(content, name) {
    closeCode();
    const dialog = document.createElement("dialog");
    dialog.className = "code-dialog"; dialog.id = "code-viewer";
    dialog.setAttribute("aria-label", name);
    dialog.innerHTML = `<header class="code-header"><strong>${e(name)}</strong>${button("Закрыть", "close-code")}</header>${codeSearchMarkup()}<div class="code-workspace">${lineGutterMarkup()}<pre class="editor-highlight" aria-hidden="true"><code></code></pre><textarea class="editor-source code-full" readonly wrap="off" spellcheck="false">${e(sourceForUse(content))}</textarea></div>`;
    const cleanup = () => { if (activeCodeDialog === dialog) activeCodeDialog = null; document.body.classList.remove("code-open"); dialog.remove(); };
    dialog.addEventListener("close", cleanup);
    dialog.addEventListener("cancel", event => { event.preventDefault(); closeCode(); });
    activeCodeDialog = dialog; document.body.appendChild(dialog); document.body.classList.add("code-open");
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
    bindCodeSearch(dialog.querySelector(".code-tools"),dialog.querySelector("textarea"),dialog.querySelector("pre code"),true);
    dialog.querySelector("button").focus();
  }
  function closeCode() {
    const dialog = activeCodeDialog;
    if (!dialog) return;
    if (dialog.close) dialog.close();
    activeCodeDialog = null; document.body.classList.remove("code-open"); dialog.remove();
  }
  async function showCode() {
    const script = state.detail;
    if(script)rememberScript(script);
    if (!script) return;
    const content = await scriptContent(script.uuid);
    if (state.detail?.uuid === script.uuid) openCode(content, script.name);
  }
  const releaseCache = new Map();
  async function scriptReleases(id) {
    const version = state.detail?.uuid === id ? state.detail.updated_at || state.detail.published_at || "" : "";
    const cached = releaseCache.get(id);
    if (!cached || cached.version !== version || cached.expires < Date.now()) {
      const data = await js("/api/scripts/" + id + "/releases");
      releaseCache.set(id, {version, expires:Date.now()+60000, items:(data.releases || []).sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at))});
    }
    return releaseCache.get(id).items;
  }
  async function loadReleaseSummary(id) {
    try {
      const releases = await scriptReleases(id), node = document.getElementById("release-summary");
      if (state.detail?.uuid !== id || !node) return;
      node.innerHTML = releases.length ? `<span class="version-badge">${e(tr("Последняя версия"))} · #${e(releases[0].id)}</span><time>${e(date(releases[0].created_at))}</time>` : "";
    } catch { /* History remains retryable via its button. */ }
  }
  async function showReleases() {
    const script = state.detail;
    if(script)rememberScript(script);
    if (!script) return;
    const releases = await scriptReleases(script.uuid);
    if (state.detail?.uuid !== script.uuid) return;
    main.innerHTML = `<button class="back" data-action="detail">← ${e(tr("Скрипт"))}</button>` + heading(tr("История версий"), script.name) +
      `<div class="release-list">${releases.length ? releases.map((release,i) => `<article class="panel release-card"><header><h2>#${e(release.id)}</h2>${i===0 ? `<span class="version-badge">${e(tr("Последняя версия"))}</span>` : ""}</header><time datetime="${e(release.created_at)}">${e(date(release.created_at))}</time>${release.description ? `<p>${e(release.description)}</p>` : ""}</article>`).join("") : `<div class="empty">${e(tr("Опубликованных версий пока нет"))}</div>`}</div>`;
  }
  let codeDbPromise;
  function codeDb() {
    if (!codeDbPromise) codeDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("script-library-codes", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("codes", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(() => null);
    return codeDbPromise;
  }
  async function loadCodeCache(list) {
    try {
      const db = await codeDb(); if (!db || !state.user) return;
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction("codes", "readonly").objectStore("codes").getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const current = new Map(list.map(script => [script.uuid, script.updated_at || script.created_at || ""]));
      for (const row of rows) if (row.owner === state.user.uuid && current.get(row.id) === row.updated) { state.codes.set(row.id, row.content); state.codeVersions.set(row.id, row.updated); }
    } catch { /* Cache is optional. */ }
  }
  async function saveCodeCache(rows) {
    if (!rows.length || !state.user) return;
    const owner = state.user.uuid;
    try {
      const db = await codeDb(); if (!db) return;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("codes", "readwrite");
        for (const row of rows) transaction.objectStore("codes").put({ key: owner + ":" + row.uuid, owner, id: row.uuid, updated: row.updated_at || row.created_at || "", content: row.content });
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
      });
    } catch { /* Search still works in memory. */ }
  }
  async function clearCodeCache() {
    try {
      const db = await codeDb(); if (!db) return;
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("codes", "readwrite"); transaction.objectStore("codes").clear();
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
      });
    } catch { /* Ignore unavailable storage. */ }
  }
  async function indexCodes() {
    if (state.indexing) return;
    if (!state.user) { go("/account"); toast(tr("Сначала войдите в Null’s")); return; }
    const list = state.catalog?.scripts || [];
    state.indexing = true; library();
    await loadCodeCache(list);
    const pending = list.filter(script => !state.codes.has(script.uuid));
    const owner=state.user.uuid;let cursor=0,done=list.length-pending.length,failed=0;const fetched=[];
    const batches=[];for(let offset=0;offset<pending.length;offset+=12)batches.push(pending.slice(offset,offset+12));
    async function one(){
      while(cursor<batches.length&&state.indexing&&state.user?.uuid===owner){const batch=batches[cursor++];let remaining=batch;
        for(let attempt=0;attempt<3&&remaining.length&&state.indexing;attempt++){
          try{
            const response=await js("/api/library/code-batch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ids:remaining.map(script=>script.uuid)})});
            if(!state.indexing||state.user?.uuid!==owner)return;
            const retry=[];for(const script of remaining){const row=response.results.find(row=>row.uuid===script.uuid);if(typeof row?.content==="string"){state.codes.set(script.uuid,row.content);state.codeVersions.set(script.uuid,script.updated_at||script.created_at||"");fetched.push({...script,content:row.content});done++;}else if([429,502,503].includes(row?.status)&&attempt<2)retry.push(script);else{failed++;done++;}}
            remaining=retry;
          }catch(error){if(error.status===401){state.indexing=false;toast(error.message);return;}if(attempt===2){failed+=remaining.length;done+=remaining.length;remaining=[];}}
          if(remaining.length)await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
        }
        toast(`${tr("Код: ")}${done} / ${list.length}`);
      }
    }
    await Promise.all(Array.from({length:Math.min(3,batches.length)},one));
    if(state.user?.uuid!==owner){state.indexing=false;return;}
    await saveCodeCache(fetched);
    state.indexing = false; if (routePath() === "/") library();
    toast(`${tr("Код: ")}${state.codes.size} / ${list.length}${failed ? " · " + failed + " " + tr("недоступно") : ""}`);
  }
  const base62 = bytes => {
    const abc = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    let number = BigInt("0x" + [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""));
    let result = ""; while (number > 0n) { result = abc[Number(number % 62n)] + result; number /= 62n; }
    return "0".repeat(zeros) + result;
  };
  function roomLink(id, token, values, banned = [], map = null) {
    const config = window.BATTLE_CONFIG;
    const bp = values.map((value, i) => value - (i <= 5 || i === 9 || i === 11 || i === 15 ? config.defaults[i] : 0));
    const payload = { realm: "experiment:scripts", script: `https://scripting.nulls.gg/api/scripts/${id}/content?token=${encodeURIComponent(token)}`, bp, bc: banned };
    if(map)payload.map=map;
    return `nullsbrawl://createAndJoinRoom?roomname=params:v2:${base62(new TextEncoder().encode(JSON.stringify(payload)))}&friendly=1&side=0`;
  }
  let battleBans = new Set();
  const brawlerKey = id => "battle-brawlers:" + id;
  function savedBrawlerBans(id) { try { return new Set(JSON.parse(localStorage.getItem(brawlerKey(id)) || "[]")); } catch { return new Set(); } }
  function storeBrawlerBans(id) { localStorage.setItem(brawlerKey(id), JSON.stringify([...battleBans].sort((a,b)=>a-b))); queuePreference("brawlers:"+id,[...battleBans].sort((a,b)=>a-b)); }
  function brawlerOptions() {
    const names = window.BRAWLERS[locale()] || window.BRAWLERS.en;
    return `<details class="brawler-section"><summary><span>${icon("users")}${e(tr("Заблокированные бойцы"))}</span><span class="count" id="brawler-count">${battleBans.size} / ${Object.keys(window.BRAWLERS.en).length}</span></summary><p class="sub">${e(tr("Отмеченные бойцы недоступны в этом бою."))}</p><div class="brawler-toolbar"><input id="brawler-search" class="input" type="search" placeholder="${e(tr("Поиск бойца"))}" autocomplete="off"><div class="actions">${button("Заблокировать всех", "ban-brawlers")}${button("Разблокировать всех", "unban-brawlers")}</div></div><div class="brawler-grid">${Object.keys(window.BRAWLERS.en).map(id => `<label class="brawler-option" data-brawler-name="${e(names[id] || window.BRAWLERS.en[id])}"><input type="checkbox" data-brawler-id="${id}" aria-label="${e(names[id] || window.BRAWLERS.en[id])}" ${battleBans.has(Number(id)) ? "checked" : ""}><img src="${window.BRAWLER_ICONS[id]}" alt="" width="64" height="64" loading="lazy"><span>${e(names[id] || window.BRAWLERS.en[id])}</span><span class="brawler-badge" aria-hidden="true">${icon("block")}</span></label>`).join("")}</div><p class="empty" id="brawler-no-results" hidden>${e(tr("Ничего не найдено"))}</p></details>`;
  }
  function updateBrawlerCount() { document.getElementById("brawler-count").textContent = `${battleBans.size} / ${Object.keys(window.BRAWLERS.en).length}`; }
  function updateBrawlerChecks() { document.querySelectorAll("[data-brawler-id]").forEach(input=>input.checked=battleBans.has(Number(input.dataset.brawlerId)));updateBrawlerCount(); }
  let selectedPreset = "";
  function presets() {
    const result=[];
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith("battle-preset:"))continue;try{const value=JSON.parse(localStorage.getItem(key));if(typeof value?.name==="string"&&value.name&&Array.isArray(value.values)&&value.values.length===32&&Array.isArray(value.brawlers)){window.BATTLE_RULES.validate(window.BATTLE_CONFIG,value.values);result.push({id:key.slice(14),...value});}}catch{}}
    return result.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  }
  function presetControls() {
    return `<section class="preset-section"><div class="actions preset-save">${button("Сохранить конфигурацию","save-preset")}</div><h2>${e(tr("Конфигурации боя"))}</h2><select id="battle-presets" class="input" aria-label="${e(tr("Конфигурации боя"))}">${presetOptions()}</select><div class="actions">${button("Создать конфигурацию","create-preset")}${button("Переименовать","rename-preset")}${button("Удалить","delete-preset")}</div></section>`;
  }
  function presetOptions() { return (presets().length?"":`<option value="">${e(tr("Конфигурация"))} 1</option>`)+presets().map(p=>`<option value="${e(p.id)}" ${p.id===selectedPreset?"selected":""}>${e(p.name)}</option>`).join(""); }
  function refreshPresets() { const select=document.getElementById("battle-presets");if(select)select.innerHTML=presetOptions(); }
  function applyBattleValues(values,bans) {
    const form=document.getElementById("battle-form");values.forEach((value,i)=>{const field=form.elements.namedItem("p"+i);if(field.type==="checkbox")field.checked=value===1;else field.value=value;});
    battleBans=new Set(bans);updateBrawlerChecks();
  }
  function savePreset(id,name,rename=false,quiet=false) {
    const old=presets().find(p=>p.id===id);
    const config=rename?{name,values:old.values,brawlers:old.brawlers,updatedAt:Date.now()}:{name,values:readBattleValues(document.getElementById("battle-form")),brawlers:[...battleBans].sort((a,b)=>a-b),updatedAt:Date.now()};
    localStorage.setItem("battle-preset:"+id,JSON.stringify(config));queuePreference("preset:"+id,config);selectedPreset=id;refreshPresets();if(!quiet)toast(tr("Конфигурация сохранена"));
  }

  function scriptReference(text) {
    const uuid="[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
    const match=String(text).trim().match(new RegExp("^(?:https://scripting\\.(?:nulls\\.gg|donutquine\\.dev)/scripts/)?("+uuid+")(?:[/?#].*)?$","i"));
    return match?match[1].toLowerCase():null;
  }
  function rememberScript(script){try{const old=JSON.parse(localStorage.getItem("recent-scripts")||"[]"),entry={uuid:script.uuid,name:script.name,author_uuid:script.author_uuid,author_username:script.author_username,description:script.description,published_at:script.published_at,viewed_at:new Date().toISOString()};localStorage.setItem("recent-scripts",JSON.stringify([entry,...old.filter(x=>x.uuid!==entry.uuid)].slice(0,50)));}catch{}}
  let recentQuery="",recentAuthor="";
  function recentScripts(){
    let entries=[];try{entries=JSON.parse(localStorage.getItem("recent-scripts")||"[]");}catch{}
    const authors=[...new Set(entries.map(item=>item.author_name||item.author_username).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    const query=recentQuery.toLocaleLowerCase().trim();
    const matches=entries.filter(item=>{
      if(recentAuthor&&(item.author_name||item.author_username)!==recentAuthor)return false;
      if(!query)return true;
      return [item.name,item.author_name,item.author_username,item.uuid].join(" ").toLocaleLowerCase().includes(query);
    });
    const toolbar=`<div class="toolbar"><label class="field"><span>${e(tr("Поиск"))}</span><input id="recent-search" class="input" type="search" autocomplete="off" placeholder="${e(tr("Название, автор или UUID"))}" value="${e(recentQuery)}"></label><label class="field"><span>${e(tr("АВТОР"))}</span><select id="recent-author" class="select"><option value="">${e(tr("Все авторы"))}</option>${authors.map(author=>`<option value="${e(author)}"${author===recentAuthor?" selected":""}>${e(author)}</option>`).join("")}</select></label></div>`;
    main.innerHTML=heading(tr("Недавние скрипты"))+toolbar+`<div class="actions">${button("Очистить историю","clear-recent")}</div>`+(matches.length?`<div class="grid">${matches.slice(0,recentVisible).map(card).join("")}</div>`:`<p class="empty">${e(tr(entries.length?"Ничего не найдено":"История пуста"))}</p>`)+(matches.length>recentVisible?`<div class="actions">${button("Показать ещё","recent-more")}</div>`:"");
  }
  function importBattleDialog(text="") {
    const dialog=document.createElement("dialog");dialog.className="preset-dialog battle-import-dialog";
    dialog.innerHTML=`<form><h2>${e(tr("Импорт конфигурации боя"))}</h2><label class="import-link">${e(tr("Ссылка на бой"))}<textarea class="input" name="link" rows="3" required placeholder="nullsbrawl://…">${e(text)}</textarea></label><div id="import-preview"></div><div class="actions"><button type="submit" class="button primary">${icon("upload")}${e(tr("Предпросмотр"))}</button><button type="button" class="button" id="cancel-import">${e(tr("Отмена"))}</button></div></form>`;
    let decoded=null;
    const form=dialog.querySelector("form"),source=dialog.querySelector("textarea"),preview=dialog.querySelector("#import-preview"),submit=form.querySelector('button[type="submit"]');
    dialog.addEventListener("close",()=>dialog.remove());
    dialog.addEventListener("click",event=>{
      if(event.target.closest("#cancel-import"))dialog.close();
      if(event.target.closest("#open-import-script")&&decoded?.script){dialog.close();go("/scripts/"+decoded.script);}
      if(event.target.closest("#edit-import-link")){decoded=null;source.readOnly=false;dialog.querySelector(".import-link").hidden=false;preview.innerHTML="";submit.innerHTML=icon("upload")+e(tr("Предпросмотр"));source.focus();}
    });
    form.addEventListener("submit",event=>{event.preventDefault();try{
      if(!decoded){
        decoded=window.BATTLE_RULES.decodeRoom(window.BATTLE_CONFIG,source.value);source.readOnly=true;dialog.querySelector(".import-link").hidden=true;
        const config=window.BATTLE_CONFIG,changed=decoded.values.map((value,i)=>({value,i,original:config.defaults[i]})).filter(row=>row.value!==row.original);
        const rows=list=>list.map(row=>`<div class="import-change"><span>${e(tr(config.names[row.i]))}</span><span><s>${row.original}</s> → <strong>${row.value}</strong></span></div>`).join("");
        preview.innerHTML=`<section class="import-script"><p class="sub">${e(tr(decoded.script?"Найден скрипт":"Без скрипта"))}</p><h3 id="import-script-title">${e(tr(decoded.script?"Загружаю название…":"Без скрипта"))}</h3>${decoded.script?`<p class="import-uuid">UUID ${e(decoded.script)}</p>`:""}</section><div class="import-metrics"><div><strong>${changed.length} / 32</strong><span>${e(tr("Изменено параметров"))}</span></div><div><strong>${decoded.brawlers.length}</strong><span>${e(tr("Заблокированные бойцы"))}</span></div></div><section class="import-changes"><h3>${e(tr("Изменённые параметры"))}</h3><p class="sub">${e(tr("Сравнение со стандартными параметрами боя"))}</p>${changed.length?rows(changed.slice(0,6)):`<p class="sub">${e(tr("Стандартные параметры"))}</p>`}${changed.length>6?`<details><summary>${e(tr("Все изменённые параметры"))} (${changed.length})</summary>${rows(changed.slice(6))}</details>`:""}</section><label>${e(tr("Название"))}<input class="input" name="name" maxlength="80" value="${e(tr("Конфигурация"))} ${presets().length+1}" required></label><div class="actions">${decoded.script?`<button type="button" class="button" id="open-import-script">${icon("code")}${e(tr("Открыть скрипт"))}</button>`:""}<button type="button" class="button small" id="edit-import-link">${icon("edit")}${e(tr("Изменить ссылку"))}</button></div>`;
        submit.innerHTML=icon("save")+e(tr("Сохранить как конфигурацию"));
        if(decoded.script){const id=decoded.script;js("/api/scripts/"+id).then(script=>{if(decoded?.script!==id)return;const title=dialog.querySelector("#import-script-title");if(title)title.textContent=script.name||tr("Найден скрипт");}).catch(()=>{if(decoded?.script!==id)return;const title=dialog.querySelector("#import-script-title");if(title)title.textContent=tr("Название скрипта недоступно");});}
        return;
      }
      const name=form.elements.namedItem("name").value.trim();if(!name||name.length>80)throw Error(tr("Название: от 1 до 80 символов"));
      const id=crypto.randomUUID(),config={name,values:decoded.values,brawlers:decoded.brawlers,updatedAt:Date.now()};localStorage.setItem("battle-preset:"+id,JSON.stringify(config));queuePreference("preset:"+id,config);refreshPresets();dialog.close();toast(tr("Конфигурация сохранена"));
    }catch(error){toast(tr(error.message));}});
    document.body.appendChild(dialog);dialog.showModal();
  }

  function presetNameDialog(rename=false) {
    const current=presets().find(p=>p.id===selectedPreset);
    if(rename&&!current){toast(tr("Выберите конфигурацию"));return;}
    const dialog=document.createElement("dialog");dialog.className="preset-dialog";
    dialog.innerHTML=`<form><h2>${e(tr(rename?"Переименовать":"Создать конфигурацию"))}</h2><label for="preset-name">${e(tr("Название"))}</label><input id="preset-name" class="input" maxlength="80" required value="${e(rename?current.name:tr("Конфигурация")+" "+(presets().length+1))}"><div class="actions"><button type="submit" class="button primary">${icon("save")}${e(tr("Сохранить"))}</button><button type="button" class="button" id="cancel-preset">${e(tr("Отмена"))}</button></div></form>`;
    dialog.addEventListener("close",()=>dialog.remove());dialog.addEventListener("click",event=>{if(event.target.closest("#cancel-preset"))dialog.close();});dialog.querySelector("form").addEventListener("submit",event=>{event.preventDefault();const input=dialog.querySelector("input"),name=input.value.trim();if(!name){input.setCustomValidity(tr("Название: от 1 до 80 символов"));input.reportValidity();return;}try{savePreset(rename?current.id:crypto.randomUUID(),name,rename);dialog.close();}catch(error){toast(error.message);}});dialog.querySelector("input").addEventListener("input",event=>event.target.setCustomValidity(""));document.body.appendChild(dialog);dialog.showModal();dialog.querySelector("input").select();
  }
  async function battle() {
    if (!state.detail) return;
    main.innerHTML = `<div class="loading">${e(tr("Загружаю параметры…"))}</div>`;
    try {
      const data = await js("/api/scripts/" + state.detail.uuid + "/parameters");
      state.params = data.parameters || [];
      const known = new Map(state.params.map(param => [param.id, param]));
      const config = window.BATTLE_CONFIG;
      let values = initialBattleValues(state.detail.uuid, state.params);
      battleBans = savedBrawlerBans(state.detail.uuid);
      const configurations=presets();
      if(configurations.length){selectedPreset=configurations[0].id;if(!localStorage.getItem(battleKey(state.detail.uuid))){values=configurations[0].values;battleBans=new Set(configurations[0].brawlers);}}
      else{selectedPreset=crypto.randomUUID();const configuration={name:tr("Конфигурация")+" 1",values,brawlers:[...battleBans].sort((a,b)=>a-b),updatedAt:Date.now()};localStorage.setItem("battle-preset:"+selectedPreset,JSON.stringify(configuration));queuePreference("preset:"+selectedPreset,configuration);}
      const extra = state.params.filter(param => !config.ids.includes(param.id));
      document.body.classList.add("battle-mode");
      main.innerHTML = `<div class="battle-caption"><button class="back" data-action="detail">← ${e(tr("Скрипт"))}</button><strong>${e(state.detail.name)}</strong></div>` +
        (extra.length ? `<div class="notice">${e(tr("Есть дополнительные параметры, которые эта версия не передаёт."))}</div>` : "") +
        `<form id="battle-form" class="panel"><div class="battle-launch-bar"><button type="submit" class="button primary">${icon("play")}<span>${e(tr("Запустить"))}</span></button>${button("Импорт конфигурации боя","import-battle","small")}</div><details class="battle-presets-fold"><summary>${icon("save")}${e(tr("Конфигурации боя"))}</summary>${presetControls()}</details>${brawlerOptions()}${[["УРОВНИ И СКОРОСТЬ",[0,1,2,3,4,5]],["ЗАРЯД И ВОССТАНОВЛЕНИЕ",[6,7,8,9,10,11,12,15,31]],["ПРАВИЛА БОЯ",[14,19,20,22,24]],["СПОСОБНОСТИ И ФЛАГИ",[13,16,17,18,21,23,25,26,27,28,29,30]]].map(([title,indices]) => `<details class="battle-section" open><summary>${e(tr(title))}</summary><div class="battle-grid">${indices.map(i => {
          const id = config.ids[i];
          const param = known.get(id); const value = values[i];
          const isBool = param?.type === "bool" || [13,16,17,18,21,23,25,26,27,28,29,30].includes(i);
          const name = tr(config.names[i]);
          const range = `${tr("Мин")}: ${config.min[i]} · ${tr("Макс")}: ${config.max[i]} · ${tr("По умолчанию")}: ${config.defaults[i]}`;
          return `<div class="battle-option ${isBool ? "battle-toggle" : ""}"><div class="battle-option-head"><label for="p${i}">${e(name)}</label>${isBool ? `<input id="p${i}" name="p${i}" type="checkbox" ${value === 1 ? "checked" : ""}>` : ""}</div><div class="battle-range">${e(range)}</div>${isBool ? "" : `<div class="stepper"><button type="button" data-action="step" data-index="${i}" data-delta="-1" aria-label="${e(tr("Уменьшить"))}: ${e(name)}">−</button><input id="p${i}" name="p${i}" type="number" inputmode="numeric" min="${config.min[i]}" max="${config.max[i]}" value="${value}" required><button type="button" data-action="step" data-index="${i}" data-delta="1" aria-label="${e(tr("Увеличить"))}: ${e(name)}">+</button></div>`}</div>`;
        }).join("")}</div></details>`).join("")}<div class="actions battle-actions">${button("Сбросить параметры", "reset-battle")}${button("Сохранить параметры", "save-battle")}</div></form>`;
    } catch (error) { toast(error.message); detail(); }
  }
  async function launch(form) {
    let values;
    try { values = readBattleValues(form); if(Object.keys(window.BRAWLERS.en).every(id=>battleBans.has(Number(id))))throw Error(tr("Оставьте хотя бы одного бойца")); } catch (error) { toast(error.message); return; }
    try {
      const data = await js("/api/scripts/" + state.detail.uuid + "/share", { method: "POST" });
      const link = roomLink(state.detail.uuid, data.token, values, [...battleBans], state.detail.user_map_internal_id || null);
      storeBattleValues(state.detail.uuid, values); storeBrawlerBans(state.detail.uuid);
      main.innerHTML += `<div class="panel" style="margin-top:14px"><p>${e(tr("Ссылка на бой готова."))}</p><div class="actions"><a class="button primary" href="${e(link)}">${e(tr("Открыть игру"))}</a>${button("Скопировать ссылку", "copy-room")}</div></div>`;
      state.roomLink = link;
      location.href = link;
    } catch (error) { toast(error.message); }
  }
  document.addEventListener("click", async event => {
    const accentChoice=event.target.closest("[data-accent-value]");if(accentChoice){setAccent(accentChoice.dataset.accentValue);return;}if(event.target.closest("[data-accent-reset]")){localStorage.removeItem("accent");applyTheme();queuePreference("accent","");const fallback=defaultAccent(),hex=document.getElementById("accent-hex"),picker=document.getElementById("accent-color");if(hex)hex.value=fallback;if(picker)picker.value=fallback;const rgb=[1,3,5].map(offset=>parseInt(fallback.slice(offset,offset+2),16));document.querySelectorAll("[data-accent-rgb]").forEach((input,index)=>input.value=String(rgb[index]));document.querySelectorAll(".accent-swatch").forEach(node=>{node.classList.remove("selected");node.setAttribute("aria-pressed","false");});const error=document.getElementById("accent-error");if(error)error.textContent="";return;}
    const pageButton=event.target.closest("[data-author-page]");if(pageButton){authorPageIndex=Math.max(0,authorPageIndex+Number(pageButton.dataset.authorPage));authorPage();return;}
    const route = event.target.closest("[data-route]");
    if (route) { event.preventDefault(); go(route.dataset.route); return; }
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const action = control.dataset.action;
    try {
      if(action==="register-account"){registerAccount();return;}
      if(action==="nulls-connect"){if(state.user){const dialog=document.createElement("dialog");dialog.className="preset-dialog";dialog.innerHTML=`<h2>Null’s Connect</h2><p class="sub">${e(tr(state.user.has_connect_email?"Подключено":"Не подключено"))}</p><div class="actions">${!state.user.has_connect_email?button("Подключить","connect-authorize"):""}<button class="button" type="button" data-close>${e(tr("Закрыть"))}</button></div>`;dialog.querySelector("[data-close]").onclick=()=>dialog.close();dialog.querySelector('[data-action="connect-authorize"]')?.addEventListener("click",()=>{dialog.close();startConnect(!!localStorage.getItem("script-library-remembered"));});dialog.addEventListener("close",()=>dialog.remove());document.body.append(dialog);dialog.showModal();}else startConnect(document.querySelector('#login [name="remember"]')?.checked===true);return;}
      if(action==="open-reference"){referenceDialog();return;}
      if(action==="recent-more"){recentVisible+=25;recentScripts();return;}
      if(action.startsWith("quick-")){const id=control.closest("[data-script-id]")?.dataset.scriptId,script=cardScripts.get(id);if(!script)return;if(action==="quick-share"){await share("/scripts/"+id);return;}if(!state.user){go("/account");toast(tr("Сначала войдите в Null’s"));return;}if(control.disabled)return;control.disabled=true;try{if(action==="quick-download")await downloadScript(script);else{const owner=state.user.uuid,remove=state.favorites.has(id);await js("/api/users/"+owner+"/favorites",{method:remove?"DELETE":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({script_id:id})});if(state.user?.uuid!==owner)return;if(remove)state.favorites.delete(id);else state.favorites.add(id);control.classList.toggle("is-active",!remove);control.setAttribute("aria-pressed",String(!remove));control.title=control.ariaLabel=tr(remove?"Добавить в избранное":"Удалить из избранного");toast(tr(remove?"Удалено из избранного":"Добавлено в избранное"));}}finally{control.disabled=false;}return;}
      if(action==="import-battle"){importBattleDialog();return;}
      if(action==="maps"){go("/maps");return;}
      if(action==="import-map"){importMapDialog();return;}
      if(action==="rename-map"||action==="delete-map"){const data=control.closest(".map-card")?.querySelector(".map-data"),map=state.maps.find(item=>item.user_map_id===data?.dataset.mapId);if(!map)return;if(action==="rename-map"){renameMapDialog(map);return;}if(confirm(tr("Удалить карту?"))){await js("/api/maps/"+map.user_map_id,{method:"DELETE"});state.mapsLoaded=false;await loadMaps(true);toast(tr("Карта удалена"));}return;}
      if(action==="recent"){go("/recent");return;}
      if(action==="clear-recent"){localStorage.removeItem("recent-scripts");recentScripts();return;}
      if(action==="sync-now"){await preferenceSync.pull();return;}
      if(action==="open-query"){const input=document.getElementById("search");const id=scriptReference(input?.value||state.query);if(id)go("/scripts/"+id);else if(/nullsbrawl:\/\//i.test(input?.value||state.query))importBattleDialog(input?.value||state.query);return;}
      if(action==="retry-session"){await restore();return;}
      if(action==="account-settings"){accountSettings();return;}
      if(action==="stats"){go("/stats");return;}
      if(action==="authors-manage"){await manageAuthors();return;}
      if(action==="edit-author"){editAuthor(Number(control.dataset.index));return;}
      if(action==="remove-author"){await removeAuthor(Number(control.dataset.index));return;}
      if(action==='choose-language'||action==='choose-theme'){choosePreference(action.slice(7));return;}
      if(action==='site-changes'){showReleaseChanges(true);return;}
      if (action === "close-code") { closeCode(); return; }
      if (action === "script-releases") { await showReleases(); return; }
      if (action === "back") { history.length > 1 ? history.back() : go("/"); return; }
      if (action === "detail") { detail(); return; }
      if (action === "shuffle") { state.seed = Math.random(); state.visible = 60; library(); return; }
      if (action === "more") { state.visible += 60; library(); return; }
      if (action === "refresh") { await loadCatalog(true); return; }
      if (action === "index") { await indexCodes(); return; }
      if (action === "battle") { await battle(); return; }
      if (action === "step") {
        const i = Number(control.dataset.index), delta = Number(control.dataset.delta), field = document.getElementById("p" + i);
        if (!Number.isInteger(i) || i < 0 || i >= 32 || !field || field.type !== "number") return;
        const { min, max, defaultValue } = battleLimits(i);
        field.value = String(Math.max(min, Math.min(max, (Number.isInteger(Number(field.value)) && field.value !== "" ? Number(field.value) : defaultValue) + delta)));
        return;
      }
      if (action === "ban-brawlers" || action === "unban-brawlers") { battleBans=action==="ban-brawlers"?new Set(Object.keys(window.BRAWLERS.en).map(Number)):new Set();updateBrawlerChecks();return; }
      if (action === "create-preset") { presetNameDialog();return; }
      if (action === "rename-preset") { presetNameDialog(true);return; }
      if (action === "save-preset") { const preset=presets().find(p=>p.id===selectedPreset);if(preset)savePreset(preset.id,preset.name);else savePreset(crypto.randomUUID(),tr("Конфигурация")+" 1");return; }
      if (action === "delete-preset") { if(!selectedPreset){toast(tr("Выберите конфигурацию"));return;}if(confirm(tr("Удалить конфигурацию?"))){localStorage.removeItem("battle-preset:"+selectedPreset);queuePreference("preset:"+selectedPreset,false);selectedPreset="";refreshPresets();}return; }
      if (action === "reset-battle") {
        battleBans.clear(); document.querySelectorAll("[data-brawler-id]").forEach(input => input.checked=false); updateBrawlerCount();
        const form = document.getElementById("battle-form"), config = window.BATTLE_CONFIG;
        config.defaults.forEach((value, i) => { const field = form.elements.namedItem("p" + i); if (field.type === "checkbox") field.checked = value === 1; else field.value = value; });
        toast(tr("Параметры сброшены")); return;
      }
      if (action === "save-battle") {
        const values = readBattleValues(document.getElementById("battle-form"));
        const current=presets().find(p=>p.id===selectedPreset);if(current)savePreset(current.id,current.name,false,true);
        storeBrawlerBans(state.detail.uuid); if (storeBattleValues(state.detail.uuid, values)) toast(tr("Параметры сохранены")); else toast(tr("Не удалось сохранить параметры"));
        return;
      }
      if (action === "download-code") {
        if (!state.detail) return;
        if (!state.user) { go("/account"); toast(tr("Сначала войдите в Null’s")); return; }
        await downloadScript(state.detail); return;
      }
      if (action === "code") { if (!state.user) { go("/account"); toast(tr("Сначала войдите в Null’s")); } else await showCode(); return; }
      if (action === "share-script") { await share("/scripts/" + state.detail.uuid); return; }
      if (action === "share-author") { await share("/authors/" + state.author.username); return; }
      if (action === "block-author") { const id = state.author?.uuid; if (!id) return; if (blocks.authors.has(id)) blocks.authors.delete(id); else blocks.authors.add(id); blockStore.save(blocks); queuePreference("author:"+id,blocks.authors.has(id)); authorPage(); return; }
      if (action === "block-script") { const id = state.detail?.uuid; if (!id) return; if (blocks.scripts.has(id)) blocks.scripts.delete(id); else blocks.scripts.add(id); blockStore.save(blocks); queuePreference("script:"+id,blocks.scripts.has(id)); detail(); return; }
      if (action === "unblock-author" || action === "unblock-script") { const id = control.dataset.id; if (action === "unblock-author") blocks.authors.delete(id); else blocks.scripts.delete(id); blockStore.save(blocks); queuePreference((action==="unblock-author"?"author:":"script:")+id,false); account(); return; }
      if (action === "copy-room") { await navigator.clipboard.writeText(state.roomLink); toast(tr("Ссылка скопирована")); return; }
      if (action === "favorites") { go("/favorites"); return; }
      if (action === "mine") { go("/mine"); return; }
      if (action === "retry-own") { await loadOwn(); return; }
      if (action === "new") { go("/new"); return; }
      if (action === "edit") { go("/edit/" + state.detail.uuid); return; }
      if(action==="delete-script"){deleteOwnScript();return;}
      if (action === "publish") { await publishScript(control); return; }
      if (action === "favorite") {
        if (!state.user) { go("/account"); toast(tr("Сначала войдите в Null’s")); return; }
        const id = state.detail.uuid, remove = state.favorites.has(id);
        await js("/api/users/" + state.user.uuid + "/favorites", { method: remove ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ script_id: id }) });
        if (remove) state.favorites.delete(id); else state.favorites.add(id);
        detail(); toast(tr(remove ? "Удалено из избранного" : "Добавлено в избранное")); return;
      }
      if (action === "logout") { state.indexing = false; try { await js("/api/auth/logout", { method: "POST" }); } catch { /* Clear the local session anyway. */ } localSession = ""; sessionStore.clear(); await clearCodeCache(); state.user = null;state.permissions=null;state.permissionOwner=""; state.own = []; state.ownLoaded = false;state.maps=[];state.mapsLoaded=false; state.favorites.clear(); state.codes.clear(); editedSincePublish.clear(); publishedWithoutFurtherEdit.clear(); go("/"); toast(tr("Вы вышли")); }
    } catch (error) { toast(error.message); }
  });
  document.addEventListener("submit", async event => {
    if(event.target.id==="change-password"){
      event.preventDefault();const form=event.target;if(!state.user)return;
      const next=form.elements.new_password.value;if(next!==form.elements.confirm_password.value){toast(tr("Пароли не совпадают"));return;}
      const save=form.querySelector('button[type="submit"]');save.disabled=true;
      try{const payload={new_password:next};if(form.elements.password)payload.password=form.elements.password.value;await js("/api/users/"+state.user.uuid+"/password",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});form.reset();toast(tr("Пароль изменён"));}catch(error){toast(error.message);}finally{save.disabled=false;}return;
    }
    if (event.target.id === "login") {
      event.preventDefault();
      const form = event.target, button = form.querySelector("button");
      button.disabled = true;
      try {
        const remember = form.elements.namedItem("remember").checked;
        const result = await js("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.elements.namedItem("username").value.trim(), password: form.elements.namedItem("password").value, remember }) });
        if (bundled) { if (!result.session) throw new Error(tr("Сервис не вернул сессию.")); localSession = result.session; sessionStore.set(localSession, remember); }
        state.user = result.user;state.permissions=null;state.permissionOwner="";void loadPermissions(); state.own = []; state.ownLoaded = false;state.maps=[];state.mapsLoaded=false;sendTelemetry();void loadFavorites();void loadMaps();go("/mine"); toast(tr("Вход выполнен"));
      } catch (error) { toast(error.message); button.disabled = false; }
    }
    if (event.target.id === "author-add") {
      event.preventDefault();
      const form=event.target,value=form.elements.namedItem("url").value.trim();
      if(!value)return;
      const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
      try{await js("/api/library/authors",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({url:value})});form.reset();await manageAuthors();toast(tr("Автор добавлен"));}
      catch(error){toast(error.message);}
      finally{submit.disabled=false;}
      return;
    }
    if (event.target.id === "battle-form") { event.preventDefault(); await launch(event.target); }
    if (event.target.id === "script-editor") { event.preventDefault(); await saveEditor(event.target); }
  });
  document.addEventListener("input", event => { if(event.target.id==="accent-color"){setAccent(event.target.value);return;}if(event.target.id==="accent-hex"){const error=document.getElementById("accent-error");if(normalizeAccent(event.target.value)){setAccent(event.target.value);}else if(error)error.textContent=tr("Введите HEX в формате #RRGGBB.");return;}if(event.target.dataset?.accentRgb!==undefined){updateAccentFromRgb();return;} if (event.target.id === "brawler-search") { const query=event.target.value.toLocaleLowerCase(); document.querySelectorAll("[data-brawler-name]").forEach(row=>row.hidden=!row.dataset.brawlerName.toLocaleLowerCase().includes(query));document.getElementById("brawler-no-results").hidden=!!document.querySelector("[data-brawler-name]:not([hidden])"); } if(event.target.id==="recent-search"){recentQuery=event.target.value;recentVisible=25;recentScripts();document.getElementById("recent-search")?.focus();return;} if (event.target.id === "search") { state.query = event.target.value;const reference=document.getElementById("query-reference");if(reference)reference.innerHTML=scriptReference(state.query)||/nullsbrawl:\/\//i.test(state.query)?button("Открыть скрипт или конфигурацию","open-query"):""; state.visible = 60; library(true); } if (event.target.name === "content" && event.target.form?.id === "script-editor") { event.target.codeSearch?.refresh(); } });
  document.addEventListener("change", event => {
    if(event.target.id==="usage-enabled"){localStorage.setItem("usage-enabled",String(event.target.checked));localStorage.setItem("usage-decided","true");if(event.target.checked)sendTelemetry();return;}
    if(event.target.id==="theme"){localStorage.setItem("theme",event.target.value);applyTheme();queuePreference("theme",event.target.value);return;}
    if (event.target.id === "battle-presets") { selectedPreset=event.target.value;const preset=presets().find(p=>p.id===selectedPreset);if(preset)applyBattleValues(preset.values,preset.brawlers);return; }
    if (event.target.dataset?.brawlerId !== undefined) { const id=Number(event.target.dataset.brawlerId); if (event.target.checked) battleBans.add(id); else battleBans.delete(id); updateBrawlerCount(); }
    if(event.target.id==="recent-author"){recentAuthor=event.target.value;recentVisible=25;recentScripts();return;}
    if (event.target.id === "scope") { state.scope = event.target.value; state.visible = 60; library(); }
    if (event.target.id === "sort") { state.sort = event.target.value; state.visible = 60; library(); }
    if (event.target.id === "strip-service-wrapper") { localStorage.setItem("strip-service-wrapper", String(event.target.checked)); queuePreference("stripWrapper",event.target.checked); }
    if (event.target.id === "language") { localStorage.setItem("language", event.target.value); queuePreference("language",event.target.value); renderRoute(); }
  });
  document.getElementById("refresh").addEventListener("click", () => loadCatalog(true));
  document.getElementById("help").addEventListener("click", () => go("/help"));
  addEventListener("popstate", () => { closeCode(); renderRoute(); });
  addEventListener("hashchange", () => { closeCode(); renderRoute(); });
  state.catalog = catalogStore.get();
  if (state.catalog) document.getElementById("catalog-age").textContent = `${state.catalog.authors.length} ${tr("авторов")} · ${state.catalog.scripts.length} ${tr("скриптов")}`;
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&state.user)preferenceSync.pull();});
  addEventListener("focus",()=>{if(state.user)preferenceSync.pull();});
  setInterval(()=>{if(!document.hidden&&state.user)preferenceSync.pull();},45000);
  setInterval(()=>{if(!document.hidden)sendTelemetry();},900000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)sendTelemetry();});
  let connectPayload=null;if(routePath().startsWith("/connect-callback?")||new URLSearchParams(location.search).get("connect_callback")==="1"){const parameters=new URLSearchParams(routePath().startsWith("/connect-callback?")?routePath().split("?")[1]:location.search);connectPayload={state:parameters.get("state"),id_token:parameters.get("id_token")};history.replaceState(null,"",bundled?"/#/account":"/account");}
  renderRoute();
  addEventListener("resize",()=>document.querySelectorAll(".editor-source,.code-full").forEach(syncCodeLines));
  document.addEventListener("pointerup",()=>document.querySelectorAll(".editor-source,.code-full").forEach(syncCodeLines));
  loadCatalog();
  if(connectPayload)completeConnect(connectPayload);else restore();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)showReleaseChanges();});
  releasePromptTimer=setTimeout(()=>showReleaseChanges(),500);setTimeout(()=>showUsageConsent(),1200);
})();
