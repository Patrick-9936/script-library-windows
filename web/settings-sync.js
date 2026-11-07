(() => {
  class PreferenceSync {
    constructor(storage, adapter, request, notify) {
      this.storage=storage;this.adapter=adapter;this.request=request;this.notify=notify;
      this.owner=storage.getItem('sync-current-account')||'';this.bound=false;this.pending=this.read('sync-outbox:'+this.owner,{});this.busy=false;this.status='';
    }
    read(key,fallback){try{return JSON.parse(this.storage.getItem(key)||'null')??fallback;}catch{return fallback;}}
    bind(id) {
      if(id===this.owner){if(!this.bound){this.bound=true;this.bootstrap=this.adapter.snapshot();if(id)this.pull();}return;}
      this.bound=true;
      const old=this.owner,current=this.adapter.snapshot();
      if(old)this.storage.setItem('sync-backup:'+old,JSON.stringify(current));
      else if(id)this.storage.setItem('sync-guest',JSON.stringify(current));
      this.owner=id;this.storage.setItem('sync-current-account',id);
      this.pending=id?this.read('sync-outbox:'+id,{}):{};
      if(id){const backup=this.read('sync-backup:'+id,null);this.bootstrap=backup||(!old?current:{});this.adapter.replace(backup||{});}
      else {const guest={...this.read('sync-guest',{}),theme:current.theme||'system',language:current.language||'system'};this.storage.setItem('sync-guest',JSON.stringify(guest));this.adapter.replace(guest);this.status='';}
      this.notify();if(id)this.pull();
    }
    queue(key,value) {
      if(!this.owner)return;
      this.pending[key]=value;this.storage.setItem('sync-outbox:'+this.owner,JSON.stringify(this.pending));
      clearTimeout(this.timer);this.timer=setTimeout(()=>this.pull(),500);
    }
    async pull() {
      if(!this.owner||this.busy)return;
      const id=this.owner;this.busy=true;this.status='Синхронизация…';this.notify();
      const initialize=!this.storage.getItem('sync-known:'+id);
      const sent=JSON.parse(JSON.stringify(this.pending));
      try {
        const data=await this.request({initialize,changes:initialize?{...(this.bootstrap||this.adapter.snapshot()),...sent}:sent});
        if(this.owner!==id||data.user_uuid!==id)return;
        for(const [key,value] of Object.entries(sent))if(JSON.stringify(this.pending[key])===JSON.stringify(value)&&(!initialize||data.initialized||JSON.stringify(data.values[key])===JSON.stringify(value)))delete this.pending[key];
        this.storage.setItem('sync-known:'+id,'true');this.storage.setItem('sync-outbox:'+id,JSON.stringify(this.pending));
        this.adapter.replace({...data.values,...this.pending});
        this.storage.setItem('sync-backup:'+id,JSON.stringify(this.adapter.snapshot()));
        this.status='Синхронизировано';this.notify();
        if(Object.keys(this.pending).length)this.timer=setTimeout(()=>this.pull(),500);
      }catch{if(this.owner===id){this.status='Синхронизация недоступна. Настройки сохранены на устройстве.';this.notify();}}
      finally{this.busy=false;if(this.owner&&this.owner!==id)this.pull();}
    }
  }
  globalThis.PreferenceSync=PreferenceSync;
})();
