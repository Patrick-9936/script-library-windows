(() => {
  // Compare executable tokens, not the notice text, which varies by script/language.
  const signature = "local_guard_start_tick=nillocal_guard_welcome_shown=falselocal_guard_server=serverlocal_GUARD_WELCOME_TEXT=functiontick()ifnot_guard_start_tickthen_guard_start_tick=_guard_server.tickendlocalelapsed=_guard_server.tick-_guard_start_tickifnot_guard_welcome_shownthenlog(_GUARD_WELCOME_TEXT)_guard_welcome_shown=trueendifelapsed<100thenreturnendiftype(_user_tick)==then_user_tick()endend";

  function longEnd(source, start) {
    if (source[start] !== "[") return -1;
    let i = start + 1;
    while (source[i] === "=") i++;
    if (source[i] !== "[") return -1;
    const end = "]" + source.slice(start + 1, i) + "]";
    const close = source.indexOf(end, i + 1);
    return close < 0 ? source.length : close + end.length;
  }

  // Preserve offsets and line endings while masking Lua comments and literals.
  function mask(source) {
    const out = source.split("");
    for (let i = 0; i < source.length;) {
      let end = -1;
      const ch = source[i];
      if (source.startsWith("--", i)) {
        end = longEnd(source, i + 2);
        if (end < 0) {
          end = source.indexOf("\n", i);
          if (end < 0) end = source.length;
        }
      } else if (ch === "'" || ch === '"') {
        end = i + 1;
        while (end < source.length) {
          const value = source[end++];
          if (value === "\\") end = Math.min(source.length, end + 1);
          else if (value === ch) break;
        }
      } else if (ch === "[") end = longEnd(source, i);
      if (end < 0) { i++; continue; }
      for (let j = i; j < end; j++) if (out[j] !== "\n" && out[j] !== "\r") out[j] = " ";
      i = end;
    }
    return out.join("");
  }

  function original(source) {
    const code = mask(source);
    const marker = /^local _guard_start_tick\s*=\s*nil\s*$/m.exec(code);
    if (!marker || code.slice(marker.index).replace(/\s+/g, "") !== signature) return source;
    if (!/type\s*\(_user_tick\)\s*==\s*(["'])function\1/.test(source.slice(marker.index))) return source;
    const hooks = [...code.slice(0, marker.index).matchAll(/^(\s*function\s+)(_user_tick)(\s*\(\s*\))/gm)];
    if (hooks.length !== 1) return source;
    const from = hooks[0].index + hooks[0][1].length;
    const body = source.slice(0, from) + "tick" + source.slice(from + 10, marker.index);
    return body.replace(/[\r\n]+$/, "") + (source.includes("\r\n") ? "\r\n" : "\n");
  }

  globalThis.SCRIPT_SOURCE = { original };
})();
