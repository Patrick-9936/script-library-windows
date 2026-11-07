((root) => {
  function initial(config, parameters, saved) {
    const known = new Map(parameters.map(param => [param.id, param]));
    return config.ids.map((id, i) => {
      const candidate = Array.isArray(saved) && saved.length === config.ids.length ? saved[i] : known.get(id)?.default_value ?? config.defaults[i];
      return Number.isInteger(candidate) ? Math.max(config.min[i], Math.min(config.max[i], candidate)) : config.defaults[i];
    });
  }
  function validate(config, values) {
    if (values.length !== config.ids.length) throw Object.assign(new Error("parameter count"), { index: -1 });
    for (let i = 0; i < values.length; i++) {
      if (!Number.isInteger(values[i]) || values[i] < config.min[i] || values[i] > config.max[i])
        throw Object.assign(new Error("parameter range"), { index: i });
    }
    return values;
  }
  function decodeRoom(config,text) {
    const invalid=()=>new Error("Некорректная конфигурация боя");
    if(typeof text!=="string"||text.length>65536)throw invalid();
    let url;try{url=new URL(text.trim());}catch{throw invalid();}if(url.protocol!=="nullsbrawl:"||url.hostname.toLowerCase()!=="createandjoinroom")throw invalid();
    const room=url.searchParams.get("roomname")||"";if(!room.startsWith("params:v2:"))throw invalid();
    const encoded=room.slice(10),alphabet="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";if(!encoded||encoded.length>16384||!/^[0-9A-Za-z]+$/.test(encoded))throw invalid();
    let number=0n;for(const character of encoded)number=number*62n+BigInt(alphabet.indexOf(character));
    let hex=number.toString(16);if(hex.length%2)hex="0"+hex;const bytes=Uint8Array.from(hex.match(/../g),byte=>parseInt(byte,16));
    let data;try{data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw invalid();}
    if(!data||typeof data!=="object"||Array.isArray(data))throw invalid();
    let values=config.defaults.slice();
    if(Object.prototype.hasOwnProperty.call(data,"bp")){if(!Array.isArray(data.bp)||data.bp.length!==32||!data.bp.every(Number.isInteger))throw invalid();values=data.bp.map((value,i)=>value+(i<=5||[9,11,15].includes(i)?config.defaults[i]:0));try{validate(config,values);}catch{throw invalid();}}
    const bans=data.bc??[];if(!Array.isArray(bans)||bans.length>256||!bans.every(id=>Number.isInteger(id)&&id>=0&&id<=1024))throw invalid();
    let script="";if(data.script){let source;try{source=new URL(data.script);}catch{throw invalid();}if(source.protocol!=="https:"||!["scripting.nulls.gg","scripting.donutquine.dev"].includes(source.hostname))throw invalid();const match=source.pathname.match(/^\/(?:api\/)?scripts\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\/content)?\/?$/i);if(!match)throw invalid();script=match[1].toLowerCase();}
    return {values,brawlers:[...new Set(bans)].sort((a,b)=>a-b),script};
  }
  root.BATTLE_RULES = { initial, validate, decodeRoom };
})(globalThis);
