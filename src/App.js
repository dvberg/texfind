import React, { useEffect, useMemo, useState } from "react";

const APP_VERSION="2025.10.15-r1";
const LS_KEY_DATA="gtxd_textures_data";
const FAV_KEY="gtxd_fav_folders";
const UI_KEY="tf_ui_state";
const SEEN_KEY="tf_seen_version";

function paginate(a,s,p){const i=(p-1)*s;return a.slice(i,i+s);}
const norm=(s)=>String(s??"").trim().toLowerCase();
const favKeyOf=(t)=>`${t.modelId}|${t.txdName}|${t.textureName}`;
function parseFavKey(k){const [m,x,n]=k.split("|");return{modelId:Number(m),txdName:x,textureName:n};}

async function deriveKey(password,salt){
  const enc=new TextEncoder();
  const base=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:150000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encryptJson(obj,password){
  const enc=new TextEncoder();
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await deriveKey(password,salt);
  const data=enc.encode(JSON.stringify(obj));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,data));
  const payload=new Uint8Array(1+salt.length+iv.length+ct.length);
  payload[0]=1; payload.set(salt,1); payload.set(iv,17); payload.set(ct,29);
  return btoa(String.fromCharCode(...payload));
}
async function decryptJson(b64,password){
  const buf=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  if(buf[0]!==1) throw new Error("Unsupported format");
  const salt=buf.slice(1,17), iv=buf.slice(17,29), ct=buf.slice(29);
  const key=await deriveKey(password,salt);
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

const theme={app:"bg-neutral-950 text-neutral-100",header:"backdrop-blur bg-neutral-950/70 border-b border-neutral-800",input:"bg-neutral-900 border border-neutral-800",button:"bg-neutral-900 border border-neutral-800",select:"bg-neutral-900 border border-neutral-800",card:"bg-neutral-900 border border-neutral-800",modal:"bg-neutral-950 border border-neutral-800",preview:"bg-neutral-800",navAll:"border-indigo-500/60 bg-indigo-500/10",navFav:"border-pink-500/60 bg-pink-500/10",navTut:"border-emerald-500/60 bg-emerald-500/10",muted:"opacity-70",success:"bg-emerald-500/20 border-emerald-600 text-emerald-300",error:"bg-rose-500/20 border-rose-600 text-rose-300"};

export default function App(){
  useEffect(()=>{
    const seen=localStorage.getItem(SEEN_KEY);
    if(seen!==APP_VERSION){
      localStorage.setItem(SEEN_KEY,APP_VERSION);
      if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));}
      if('caches' in window){caches.keys().then(keys=>keys.forEach(k=>caches.delete(k)));}
      if(!sessionStorage.getItem("tf_reloaded")){sessionStorage.setItem("tf_reloaded","1"); setTimeout(()=>window.location.reload(),50);}
    }
  },[]);

  const [dataset,setDataset]=useState(()=>{try{const raw=localStorage.getItem(LS_KEY_DATA);const p=raw?JSON.parse(raw):[];return Array.isArray(p)?p:[]}catch{return[]}});

  useEffect(()=>{
    if(dataset.length===0){
      loadTexturesFromLocal();
    }
  },[]);
  const [favFolders,setFavFolders]=useState(()=>{try{const raw=localStorage.getItem(FAV_KEY);return raw?JSON.parse(raw):{folders:{Unfiled:[]},lastFolder:"Unfiled"};}catch{return{folders:{Unfiled:[]},lastFolder:"Unfiled"}}});
  useEffect(()=>{try{localStorage.setItem(FAV_KEY,JSON.stringify(favFolders));}catch{}},[favFolders]);
  useEffect(()=>{try{localStorage.setItem(LS_KEY_DATA,JSON.stringify(dataset));}catch{}},[dataset]);

  const uiInit=(()=>{try{const raw=localStorage.getItem(UI_KEY);return raw?JSON.parse(raw):null;}catch{return null}})();
  const [view,setView]=useState(uiInit?.view||"home");
  const [favViewFolder,setFavViewFolder]=useState(uiInit?.favViewFolder||"Unfiled");
  const [query,setQuery]=useState(uiInit?.query||"");
  const [pageSize,setPageSize]=useState(uiInit?.pageSize||20);
  const [page,setPage]=useState(1);
  const [hideDupes,setHideDupes]=useState(!!uiInit?.hideDupes);
  useEffect(()=>{try{localStorage.setItem(UI_KEY,JSON.stringify({view,favViewFolder,query,pageSize,hideDupes}));}catch{}},[view,favViewFolder,query,pageSize,hideDupes]);

  const [toast,setToast]=useState(null);
  function showToast(kind,msg){setToast({type:kind,msg});window.clearTimeout(showToast._t);showToast._t=window.setTimeout(()=>setToast(null),3000);}

  async function loadTexturesFromLocal(){
    try{
      const response=await fetch('/textures.csv');
      if(!response.ok) throw new Error('Failed to load textures.csv');
      const text=await response.text();
      const rows=parseTable(text);
      if(!rows.length) throw new Error("File kosong");
      const header=rows[0].map(s=>String(s).trim().toLowerCase());
      const col=(names)=>names.map(n=>String(n).toLowerCase()).map(n=>header.indexOf(n)).find(i=>i>=0);
      const iM=col(["modelid","model_id","model id","model","id"]);
      const iTxd=col(["txdname","txd","txd name","txd_name"]);
      const iName=col(["texturename","texture name","texturename","name"]);
      const iURL=col(["url","image","img"]);
      if(iM==null||iTxd==null||iName==null) throw new Error("Header wajib: modelid, txdname, texturename (url opsional)");
      const next=[]; let auto=1;
      for(const r of rows.slice(1)){
        if(r.every(c=>String(c).trim()==="")) continue;
        const midRaw=r[iM]; const modelId=(midRaw==null||String(midRaw).trim()==="")?null:Number(midRaw);
        const txdName=String(r[iTxd]??"").trim();
        const textureName=String(r[iName]??"").trim();
        const urlRaw=iURL!=null?String(r[iURL]??"").trim():"";
        const url=urlRaw || (txdName&&textureName?`https://gtxd.net/images/gtasa_textures/${txdName}.${textureName}.png`:"");
        if(!modelId||!txdName||!textureName) continue;
        next.push({id:auto++,textureName,modelId,txdName,libraryName:"gta3.img",duplicateOf:null,urlEnc: btoa(url), tags:[]});
      }
      if(!next.length) throw new Error("Tidak ada baris valid");
      setDataset(next); setQuery(""); setHideDupes(false); setPage(1);
      showToast("success",`Berhasil memuat ${next.length} texture otomatis.`);
      return next;
    }catch(e){console.error(e);showToast("error",`Gagal load otomatis: ${e.message||e}`);return [];}
  }

  const baseList=useMemo(()=>{
    if(view!=="favorites") return dataset;
    const keys=new Set((favFolders.folders?.[favViewFolder])||[]);
    return dataset.filter(t=>keys.has(favKeyOf(t)));
  },[view,dataset,favFolders,favViewFolder]);
  const filtered=useMemo(()=>{
    const q=norm(query);
    let d=baseList.filter(t=>[t.textureName,t.txdName,t.modelId,t.libraryName].map(String).some(v=>norm(v).includes(q)));
    if(hideDupes) d=d.filter(t=>!t.duplicateOf);
    return d;
  },[baseList,query,hideDupes]);
  const total=filtered.length, maxPage=Math.max(1,Math.ceil(total/pageSize)), pageSafe=Math.min(page,maxPage);
  const items=paginate(filtered,pageSize,pageSafe);

  
  const folderNames=Object.keys(favFolders.folders||{});
  const keysOfActive=new Set((favFolders.folders?.[favViewFolder])||[]);
  function isFav(t){const k=favKeyOf(t); return keysOfActive.has(k) || Object.values(favFolders.folders).some(l=>l.includes(k));}
  function addFavToFolder(t,folder){const k=favKeyOf(t); setFavFolders(prev=>{const fs={...prev.folders}; const s=new Set(fs[folder]||[]); s.add(k); fs[folder]=Array.from(s); return {folders:fs,lastFolder:folder};});}
  function removeFavFromAllFolders(t){const k=favKeyOf(t); setFavFolders(prev=>{const fs=Object.fromEntries(Object.entries(prev.folders).map(([f,arr])=>[f,arr.filter(x=>x!==k)])); return {folders:fs,lastFolder:prev.lastFolder};});}

  async function doExportFavorites(password){
    const out={};
    for(const [folder,list] of Object.entries(favFolders.folders)){
      out[folder]=list.map(k=>{const {modelId,txdName,textureName}=parseFavKey(k); const item=dataset.find(d=>d.modelId===modelId&&d.txdName===txdName&&d.textureName===textureName); const url=item?.urlEnc?atob(item.urlEnc):""; return {modelid:modelId,txdname:txdName,texturename:textureName,url};});
    }
    const b64=await encryptJson(out,password);
    const blob=new Blob([JSON.stringify({enc:b64,ts:Date.now()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`texfind_favorites_${new Date().toISOString().slice(0,10)}.tfx.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    showToast("success","Favorites diexport terenkripsi.");
  }
  async function doImportFavorites(file,password,done){
    try{
      const obj=JSON.parse(await file.text());
      const data=await decryptJson(obj.enc,password);
      const folders={...favFolders.folders}; let added=0;
      for(const [folder,arr] of Object.entries(data)){
        if(!Array.isArray(arr)) continue;
        if(!folders[folder]) folders[folder]=[];
        const set=new Set(folders[folder]);
        for(const o of arr){const k=`${o.modelid}|${o.txdname}|${o.texturename}`; if(!set.has(k)){set.add(k); added++;}}
        folders[folder]=Array.from(set);
      }
      setFavFolders({folders,lastFolder:favFolders.lastFolder}); showToast("success",`Favorites loaded: ${added} entri baru.`);
    }catch(e){console.error(e);showToast("error",`Gagal import: ${e.message||e}`);} finally{done&&done();}
  }

  const [active,setActive]=useState(null);
  const [favModal,setFavModal]=useState({open:false,target:null});
  const [delModal,setDelModal]=useState({open:false,target:null});
  const [exportModal,setExportModal]=useState({open:false,password:""});
  const [importModal,setImportModal]=useState({open:false,password:"",file:null});
  const [manageOpen,setManageOpen]=useState(false);

  const isHome=view==="home", isFavs=view==="favorites", isTut=view==="tutorial";

  return (<div className={`min-h-screen ${theme.app}`}>
    {toast && (<div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-xl border shadow ${toast.type==='success'?'bg-emerald-500/20 border-emerald-600 text-emerald-300':'bg-rose-500/20 border-rose-600 text-rose-300'}`}>{toast.msg}</div>)}

    <header className={`sticky top-0 z-20 ${theme.header}`}>
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="text-2xl font-black tracking-tight">TexFind</div>
        <nav className="flex items-center gap-2">
          <button onClick={()=>setView('home')} className={`px-3 py-1 rounded-xl border text-sm ${isHome?theme.navAll: 'bg-neutral-900 border border-neutral-800'}`}>Home</button>
          <button onClick={()=>setView('favorites')} className={`px-3 py-1 rounded-xl border text-sm ${isFavs?theme.navFav:'bg-neutral-900 border border-neutral-800'}`}>Favorites</button>
          <button onClick={()=>setView('tutorial')} className={`px-3 py-1 rounded-xl border text-sm ${isTut?theme.navTut:'bg-neutral-900 border border-neutral-800'}`}>Tutorial</button>
        </nav>
      </div>
    </header>

    <main className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isHome && (
          <span className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-sm opacity-70`}>
            Data loaded automatically from textures.csv
          </span>
        )}

        {isFavs && (
          <div className="flex items-center gap-2 flex-wrap w-full">
            <span className="text-sm">Folder</span>
            <select value={favViewFolder} onChange={(e)=>setFavViewFolder(e.target.value)} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>
              {Object.keys(favFolders.folders||{}).map(f=>(<option key={f} value={f}>{f} ({(favFolders.folders[f]||[]).length})</option>))}
            </select>
            <button onClick={()=>setManageOpen(true)} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Manage</button>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={()=>setExportModal({open:true,password:""})} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Export (encrypted)</button>
              <label className={`px-3 py-2 rounded-xl cursor-pointer bg-neutral-900 border border-neutral-800`}>
                <input type="file" accept=".json,application/json" className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(!f) return; setImportModal({open:true,password:"",file:f}); e.target.value="";}}/>
                Import (encrypted)
              </label>
            </div>
          </div>
        )}

        <span className={`ml-auto text-xs opacity-70`}>Data source: textures.csv • {dataset.length} rows</span>
      </div>

      {dataset.length>0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input value={query} onChange={(e)=>{setPage(1); setQuery(e.target.value);}} placeholder={isFavs?"Search favorites...":"Search textures..."} className={`w-full md:w-72 px-3 py-2 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 bg-neutral-900 border border-neutral-800`}/>
          <div className="flex items-center gap-2">
            <label className={`text-sm opacity-70`}>Show</label>
            <select value={pageSize} onChange={(e)=>{setPage(1); setPageSize(parseInt(e.target.value,10));}} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>
              {[20,40,60,80,100].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <span className={`text-sm opacity-70`}>entries</span>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hideDupes} onChange={(e)=>{setPage(1); setHideDupes(e.target.checked);}}/>
            Hide duplicates
          </label>
          <div className={`ml-auto text-sm opacity-70`}>{total.toLocaleString()} item ditemukan</div>
        </div>
      )}

      {view==="tutorial" ? (
        <div className="prose prose-invert max-w-none">
          <h2 className="text-xl font-bold mb-3">Tutorial Builder JGRP (/dyoh)</h2>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Buka TexFind, cari texture lalu salin <b>Builder Code</b> (format: <code>modelId txdName textureName</code>).</li>
            <li>Di JGRP, masuk mode builder dan gunakan perintah <code>/dyoh</code> untuk pengaturan material.</li>
            <li>Pada dialog material, masukkan <b>Builder Code</b> untuk menerapkan texture.</li>
            <li>Ulangi untuk tiap material/object yang ingin kamu mapping.</li>
          </ol>
          <h3 className="text-lg font-semibold mt-6">Referensi Penting</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Guide Builder — How to Basic (Forum JGRP)</li>
            <li>Subforum Mapping/Builder</li>
            <li>Daftar objek SA:MP</li>
          </ul>
          <p className="text-xs opacity-70 mt-4">Catatan: beberapa dialog/fitur dapat berbeda tergantung update server JGRP.</p>
        </div>
      ) : items.length===0 ? (
        <div className={`rounded-2xl p-8 text-center bg-neutral-900 border border-neutral-800`}>
          <div className="text-sm opacity-80 mb-2">{dataset.length===0?"Loading textures...":"Tidak ada hasil yang cocok."}</div>
          <div className="text-xs opacity-60">{dataset.length===0?"Memuat data dari textures.csv":"Coba ubah pencarian atau filter."}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map(t=>(<TextureCard key={t.id} t={t} onOpen={(x)=>setActive(x)} onFav={()=>setFavModal({open:true,target:t})} onDel={()=>setDelModal({open:true,target:t})} isFav={isFav(t)}/>))}
        </div>
      )}

      {view!=="tutorial" && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 disabled:opacity-40`} disabled={pageSafe===1}>Prev</button>
          <div className={`text-sm opacity-70`}>Page {pageSafe} / {maxPage}</div>
          <button onClick={()=>setPage(p=>Math.min(maxPage,p+1))} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800 disabled:opacity-40`} disabled={pageSafe===maxPage}>Next</button>
        </div>
      )}
    </main>

    {active && (<DetailsModal t={active} onClose={()=>setActive(null)}/>)}
    {favModal.open && (<ChooseFolderModal folders={favFolders.folders} last={favFolders.lastFolder} onCancel={()=>setFavModal({open:false,target:null})} onConfirm={(folder)=>{if(!folder)return; addFavToFolder(favModal.target,folder); setFavModal({open:false,target:null}); showToast("success",`Disimpan ke folder "${folder}".`);}}/>)}
    {delModal.open && (<ConfirmModal text="Hapus dari semua folder favorit?" onCancel={()=>setDelModal({open:false,target:null})} onConfirm={()=>{removeFavFromAllFolders(delModal.target); setDelModal({open:false,target:null}); showToast("success","Dihapus dari favorit.");}}/>)}
    {exportModal.open && (<ExportModal password={exportModal.password} setPassword={(v)=>setExportModal(s=>({...s,password:v}))} onCancel={()=>setExportModal({open:false,password:""})} onExport={async()=>{if(!exportModal.password.trim()){showToast("error","Masukkan password.");return;} await doExportFavorites(exportModal.password.trim()); setExportModal({open:false,password:""});}}/>)}
    {importModal.open && (<ImportModal password={importModal.password} setPassword={(v)=>setImportModal(s=>({...s,password:v}))} file={importModal.file} onCancel={()=>setImportModal({open:false,password:"",file:null})} onImport={async()=>{if(!importModal.password.trim()||!importModal.file){showToast("error","Lengkapi password & file.");return;} await doImportFavorites(importModal.file,importModal.password.trim(),()=>setImportModal({open:false,password:"",file:null}));}}/>)}

    <FolderManager/>

    <footer className="max-w-6xl mx-auto px-4 py-10 opacity-70 text-xs">
      <div>TexFind • rezam5n / dvberg • © 2025</div>
    </footer>
  </div>);

  function TextureCard({t,onOpen,onFav,onDel,isFav}){
    const url=t.urlEnc?atob(t.urlEnc):"";
    return (<div className="relative">
      <button onClick={()=>onOpen(t)} className={`w-full text-left rounded-2xl p-4 hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-neutral-900 border border-neutral-800`}>
        <div className="text-sm font-semibold truncate pr-8">{t.textureName}</div>
        <div className={`mt-2 h-28 w-full rounded-xl flex items-center justify-center overflow-hidden bg-neutral-800`}>
          {url?<img src={url} alt={t.textureName} onError={(e)=>{e.currentTarget.style.display='none'; e.currentTarget.parentElement.innerText='No preview';}} className="w-full h-full object-cover"/>:<span>No preview</span>}
        </div>
        <div className={`mt-2 text-xs opacity-70`}>More info</div>
      </button>
      <div className="absolute top-2 right-2 flex gap-2">
        <button onClick={(e)=>{e.stopPropagation(); onFav();}} className={`rounded-full border px-2 py-1 text-xs ${isFav?'border-pink-500/50 bg-pink-500/20':'border-neutral-700 bg-neutral-900/70'}`}>♥</button>
        <button onClick={(e)=>{e.stopPropagation(); onDel();}} className={`rounded-full border px-2 py-1 text-xs`}>🗑</button>
      </div>
    </div>);
  }

  function DetailsModal({t,onClose}){
    const url=t.urlEnc?atob(t.urlEnc):"";
    return (<div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className={`w-full max-w-2xl rounded-2xl bg-neutral-950 border border-neutral-800`} onClick={(e)=>e.stopPropagation()}>
        <div className="p-4 border-b border-neutral-800 flex items-start justify-between">
          <div><div className="text-lg font-bold">{t.textureName}</div><div className="text-xs opacity-70">Texture details</div></div>
          <button onClick={onClose} className={`px-3 py-1 rounded-xl bg-neutral-900 border border-neutral-800`}>Close</button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className={`h-40 rounded-xl flex items-center justify-center overflow-hidden bg-neutral-800`}>
              {url?<img src={url} alt={t.textureName} onError={(e)=>{e.currentTarget.style.display='none'; e.currentTarget.parentElement.innerText='No preview';}} className="w-full h-full object-cover"/>:<span>No preview</span>}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Model ID" value={t.modelId??'-'}/>
            <Row label="TXD Name" value={t.txdName}/>
            <Row label="Texture Name" value={t.textureName}/>
          </div>
        </div>
        <div className="px-4 pb-4">
          <div className={`rounded-xl p-3 text-xs space-y-2 bg-neutral-900 border border-neutral-800`}>
            <div className="font-semibold">In-Game Commands</div>
            <Code label="/edittexture" code={`/edittexture ${t.modelId??''} ${t.txdName} ${t.textureName}`}/>
            <Code label="/mmat" code={`/mmat ${t.modelId??''} ${t.txdName} ${t.textureName}`}/>
            <Code label="Builder Code" code={`${t.modelId??''} ${t.txdName} ${t.textureName}`}/>
          </div>
        </div>
      </div>
    </div>);
  }

  function Row({label,value}){return(<div className="flex items-center gap-2"><div className="w-28 shrink-0 opacity-70">{label}</div><div className="truncate">{String(value??"")}</div></div>);}
  function Code({label,code}){const [copied,setCopied]=useState(false);return(<div className={`rounded-2xl overflow-hidden border bg-neutral-900 border-neutral-800`}><div className="px-3 py-2 text-[10px] opacity-70 flex items-center justify-between border-b border-neutral-800"><span>{label}</span><button className={`px-2 py-0.5 rounded-lg border`} onClick={()=>{navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false),1000);}}>{copied?"Copied":"Copy"}</button></div><pre className="p-3 text-xs overflow-auto">{code}</pre></div>);}

  function FolderManager(){
    if(!manageOpen) return null;
    const folders=favFolders.folders||{}; const names=Object.keys(folders);
    return (<div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setManageOpen(false)}>
      <div className={`w-full max-w-2xl rounded-2xl bg-neutral-950 border border-neutral-800 p-4`} onClick={(e)=>e.stopPropagation()}>
        <div className="text-lg font-bold mb-2">Manage Folders</div>
        <div className="space-y-2 max-h-[60vh] overflow-auto">
          {names.length===0 && <div className="text-sm opacity-70">Tidak ada folder.</div>}
          {names.map(f=>{const count=(folders[f]||[]).length; return (
            <div key={f} className="p-3 rounded-xl border bg-neutral-900 border-neutral-800 flex items-center gap-2">
              <div className="font-semibold">{f}</div>
              <div className="text-xs opacity-70">• {count} item</div>
              <div className="ml-auto flex items-center gap-2">
                <button className={`px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800`} onClick={()=>{const to=prompt("Rename folder:",f); if(!to||to===f) return; if(folders[to]){alert("Nama sudah ada."); return;} const nf={...folders,[to]:folders[f]}; delete nf[f]; setFavFolders({folders:nf,lastFolder:to});}}>Rename</button>
                <button className={`px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800`} onClick={()=>{const target=prompt("Pindahkan semua item ke folder (kosongkan utk hapus isi):",""); const nf={...folders}; const items=new Set(nf[f]||[]); if(target){ if(!nf[target]) nf[target]=[]; const set=new Set(nf[target]); items.forEach(k=>set.add(k)); nf[target]=Array.from(set);} delete nf[f]; setFavFolders({folders:nf,lastFolder:target||Object.keys(nf)[0]||"Unfiled"}); if(f===favViewFolder) setFavViewFolder(target||Object.keys(nf)[0]||"Unfiled");}}>Delete</button>
                <button className={`px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800`} onClick={()=>{const to=prompt("Move ALL items to folder:",""); if(!to) return; const nf={...folders}; if(!nf[to]) nf[to]=[]; const set=new Set(nf[to]); (nf[f]||[]).forEach(k=>set.add(k)); nf[to]=Array.from(set); nf[f]=[]; setFavFolders({folders:nf,lastFolder:to});}}>Move all</button>
              </div>
            </div>
          );})}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button onClick={()=>setManageOpen(false)} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Close</button>
          <button className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`} onClick={()=>{const name=prompt("Nama folder baru:"); if(!name) return; if((favFolders.folders||{})[name]){alert("Folder sudah ada."); return;} setFavFolders(prev=>({folders:{...prev.folders,[name]:[]},lastFolder:name})); setFavViewFolder(name);}}>+ Folder</button>
        </div>
      </div>
    </div>);
  }

  function ChooseFolderModal({folders,last,onCancel,onConfirm}){
    const [folder,setFolder]=useState(last||Object.keys(folders||{})[0]||"Unfiled");
    return (<div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className={`w-full max-w-sm rounded-2xl bg-neutral-950 border border-neutral-800 p-4`} onClick={(e)=>e.stopPropagation()}>
        <div className="text-lg font-bold mb-2">Simpan ke folder</div>
        <label className="text-sm opacity-80">Pilih folder</label>
        <select className={`mt-1 w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`} value={folder} onChange={(e)=>setFolder(e.target.value)}>
          {Object.keys(folders||{}).map(f=>(<option key={f} value={f}>{f}</option>))}
        </select>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onCancel} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Batal</button>
          <button onClick={()=>onConfirm(folder)} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Simpan</button>
        </div>
      </div>
    </div>);
  }
  function ConfirmModal({text,onCancel,onConfirm}){
    return (<div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className={`w-full max-w-sm rounded-2xl bg-neutral-950 border border-neutral-800 p-4`} onClick={(e)=>e.stopPropagation()}>
        <div className="text-lg font-bold mb-2">Konfirmasi</div>
        <div className="text-sm mb-4">{text}</div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Batal</button>
          <button onClick={onConfirm} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Hapus</button>
        </div>
      </div>
    </div>);
  }
  function ExportModal({password,setPassword,onCancel,onExport}){
    return (<div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className={`w-full max-w-sm rounded-2xl bg-neutral-950 border border-neutral-800 p-4`} onClick={(e)=>e.stopPropagation()}>
        <div className="text-lg font-bold mb-2">Export Favorites (Encrypted)</div>
        <label className="text-sm opacity-80">Password</label>
        <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className={`mt-1 w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`} placeholder="Masukkan password"/>
        <div className="mt-2 text-[11px] opacity-70">Catatan: password tidak boleh lupa. Tanpa password yang sama, data tidak bisa dibuka.</div>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onCancel} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Batal</button>
          <button onClick={onExport} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Export</button>
        </div>
      </div>
    </div>);
  }
  function ImportModal({password,setPassword,file,onCancel,onImport}){
    return (<div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className={`w-full max-w-sm rounded-2xl bg-neutral-950 border border-neutral-800 p-4`} onClick={(e)=>e.stopPropagation()}>
        <div className="text-lg font-bold mb-2">Import Favorites (Encrypted)</div>
        <label className="text-sm opacity-80">Password</label>
        <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} className={`mt-1 w-full px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`} placeholder="Masukkan password"/>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onCancel} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Batal</button>
          <button onClick={onImport} className={`px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-800`}>Import</button>
        </div>
      </div>
    </div>);
  }
}


  function parseTable(text){
  const first=(text.split(/\r?\n/)[0]||"").replace(/^\ufeff/,"");
  const counts={",":(first.match(/,/g)||[]).length,";":(first.match(/;/g)||[]).length,"\t":(first.match(/\t/g)||[]).length,"|":(first.match(/\|/g)||[]).length};
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  if(!top || top[1]===0){
    if(/\S(?:  +)\S/.test(first)) return text.split(/\r?\n/).filter(l=>l.trim().length).map(l=>l.trim().split(/ {2,}/).map(s=>s.trim()));
    return text.split(/\r?\n/).filter(l=>l.trim().length).map(l=>l.trim().split(/\s+/));
  }
  const d=top[0];
  const lines=text.split(/\r?\n/).filter(l=>l.length); const rows=[];
  for(const raw of lines){
    const line=String(raw).replace(/^\ufeff/,""); const row=[]; let cell=""; let inQ=false;
    for(let i=0;i<line.length;i++){const ch=line[i],nx=line[i+1];
      if(inQ){ if(ch=='"'&&nx=='"'){cell+='"';i++;continue;} if(ch=='"'){inQ=false;continue;} cell+=ch; }
      else { if(ch=='"'){inQ=true;continue;} if(ch===d){row.push(cell.trim());cell="";continue;} cell+=ch; }
    }
    row.push(cell.trim()); rows.push(row);
  }
  return rows;
}
