import React, { useEffect, useMemo, useState } from "react";

const LS_KEY_DATA="gtxd_textures_data";
const FAV_KEY="gtxd_fav_folders";

const theme={app:"bg-neutral-950 text-neutral-100",header:"backdrop-blur bg-neutral-950/70 border-b border-neutral-800",input:"bg-neutral-900 border border-neutral-800",button:"bg-neutral-900 border border-neutral-800",select:"bg-neutral-900 border border-neutral-800",chip:"bg-neutral-800 text-neutral-300",card:"bg-neutral-900 border border-neutral-800",modal:"bg-neutral-950 border border-neutral-800",preview:"bg-neutral-800",favActive:"border-pink-500/50 bg-pink-500/20",favIdle:"border-neutral-700 bg-neutral-900/70",navAll:"border-indigo-500/60 bg-indigo-500/10",navFav:"border-pink-500/60 bg-pink-500/10",navTut:"border-emerald-500/60 bg-emerald-500/10",muted:"opacity-70",success:"bg-emerald-500/20 border-emerald-600 text-emerald-300",error:"bg-rose-500/20 border-rose-600 text-rose-300"};

function paginate(arr, pageSize, page){const s=(page-1)*pageSize; return arr.slice(s,s+pageSize);}
const norm=(s)=>String(s??"").trim().toLowerCase();
const favKeyOf=(t)=>`${t.modelId}|${t.txdName}|${t.textureName}`;
function parseFavKey(k){const [modelId,txdName,textureName]=k.split("|"); return {modelId:Number(modelId),txdName,textureName};}
function b64enc(s){return typeof btoa!=="undefined"?btoa(s):Buffer.from(s,"utf-8").toString("base64");}
function b64dec(s){return typeof atob!=="undefined"?atob(s):Buffer.from(s,"base64").toString("utf-8");}

function parseTable(text){
  const first=(text.split(/\r?\n/)[0]||"").replace(/^\ufeff/,"");
  const counts={',':(first.match(/,/g)||[]).length,';':(first.match(/;/g)||[]).length,'\t':(first.match(/\t/g)||[]).length,'|':(first.match(/\|/g)||[]).length};
  const best=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  const lines=text.split(/\r?\n/).filter(l=>l.trim().length);
  if(!best||best[1]===0){
    if(/\S(?:  +)\S/.test(first)){return lines.map(l=>l.replace(/^\ufeff/,"").trim().split(/ {2,}/).map(c=>c.trim()));}
  }
  const delim=best[0];
  const rows=[];
  for(const raw of lines){
    const line=String(raw).replace(/^\ufeff/,"");
    const row=[]; let cell=""; let inQ=false;
    for(let i=0;i<line.length;i++){const ch=line[i]; const nx=line[i+1];
      if(inQ){ if(ch==='\"'&&nx==='\"'){cell+='\"';i++;continue;} if(ch==='\"'){inQ=false;continue;} cell+=ch; }
      else{ if(ch==='\"'){inQ=true;continue;} if(ch===delim){row.push(cell.trim()); cell=""; continue;} cell+=ch; }
    }
    row.push(cell.trim()); rows.push(row);
  }
  return rows;
}

// crypto helpers (AES-GCM + PBKDF2)
async function deriveKey(password, salt, iter=150000){
  const enc=new TextEncoder();
  const keyMaterial=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);
  return await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:iter,hash:"SHA-256"}, keyMaterial, {name:"AES-GCM",length:256}, false, ["encrypt","decrypt"]);
}
async function encryptJson(obj, password){
  const enc=new TextEncoder();
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(password, salt);
  const data=enc.encode(JSON.stringify(obj));
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, data);
  return {v:1,algo:"AES-GCM",kdf:{name:"PBKDF2",salt:b64enc(String.fromCharCode(...salt)),iter:150000,hash:"SHA-256"},iv:b64enc(String.fromCharCode(...iv)),data:b64enc(String.fromCharCode(...new Uint8Array(ct)))};
}
async function decryptJson(payload, password){
  const dec=new TextDecoder();
  const salt=new Uint8Array(atob(payload.kdf.salt).split("").map(c=>c.charCodeAt(0)));
  const iv=new Uint8Array(atob(payload.iv).split("").map(c=>c.charCodeAt(0)));
  const key=await deriveKey(password, salt, payload.kdf.iter||150000);
  const ct=new Uint8Array(atob(payload.data).split("").map(c=>c.charCodeAt(0)));
  const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv}, key, ct);
  return JSON.parse(dec.decode(pt));
}

function Row({label,value}){return (<div className="flex items-center gap-2"><div className="w-28 shrink-0 opacity-70">{label}</div><div className="truncate">{String(value??"")}</div></div>);}
function Code({label,code}){const [copied,setCopied]=useState(false);return(<div className={`rounded-2xl overflow-hidden border ${theme.card}`}><div className="px-3 py-2 text-[10px] opacity-70 flex items-center justify-between border-b border-inherit"><span>{label}</span><button className={`px-2 py-0.5 rounded-lg border`} onClick={()=>{navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false),1000);}}>{copied?"Copied":"Copy"}</button></div><pre className="p-3 text-xs overflow-auto">{code}</pre></div>);}
function HeartIcon({filled}){return(<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill={filled?"currentColor":"none"} className="inline"><path d="M12 21s-6.716-4.297-9.193-7.243C-0.298 12.21.16 8.53 2.98 7.157A4.93 4.93 0 0 1 12 8.09a4.93 4.93 0 0 1 9.02-0.933c2.82 1.372 3.279 5.052-.827 6.6C18.716 16.703 12 21 12 21z" stroke="currentColor" strokeWidth="1.5"/></svg>);}

export default function App(){
  const [dataset,setDataset]=useState(()=>{try{const raw=localStorage.getItem(LS_KEY_DATA);const p=raw?JSON.parse(raw):[];return Array.isArray(p)?p:[]}catch{return[]}});
  const [favFolders,setFavFolders]=useState(()=>{try{const raw=localStorage.getItem(FAV_KEY); if(raw) return JSON.parse(raw); return {folders:{Unfiled:[]}, lastFolder:"Unfiled"};}catch{return{folders:{Unfiled:[]}, lastFolder:"Unfiled"}}});
  useEffect(()=>{try{localStorage.setItem(LS_KEY_DATA,JSON.stringify(dataset));}catch{}},[dataset]);
  useEffect(()=>{try{localStorage.setItem(FAV_KEY,JSON.stringify(favFolders));}catch{}},[favFolders]);

  const [view,setView]=useState("home"); // home | favorites | tutorial
  const [query,setQuery]=useState("");
  const [pageSize,setPageSize]=useState(20);
  const [page,setPage]=useState(1);
  const [hideDupes,setHideDupes]=useState(false);
  const [active,setActive]=useState(null);
  const [toast,setToast]=useState(null);
  const [busy,setBusy]=useState(false);

  const [favViewFolder,setFavViewFolder]=useState(()=>Object.keys((favFolders.folders)||{})[0]||"Unfiled");
  const folderNames=Object.keys(favFolders.folders||{});

  const [favModal,setFavModal]=useState({open:false,target:null});
  const [deleteFavModal,setDeleteFavModal]=useState({open:false,target:null});
  const [manageModal,setManageModal]=useState({open:false});
  const [exportModal,setExportModal]=useState({open:false,password:""});
  const [importModal,setImportModal]=useState({open:false,password:""});

  const baseList=useMemo(()=>{
    if(view!=="favorites") return dataset;
    const keys=new Set(favFolders.folders[favViewFolder]||[]);
    return dataset.filter(t=>keys.has(favKeyOf(t)));
  },[view,dataset,favFolders,favViewFolder]);

  const filtered=useMemo(()=>{
    const q=norm(query);
    let data=baseList.filter(t=>[t.textureName,t.txdName,t.modelId,t.libraryName].map(String).some(v=>norm(v).includes(q)));
    if(hideDupes) data=data.filter(t=>!t.duplicateOf);
    return data;
  },[baseList,query,hideDupes]);

  const total=filtered.length;
  const maxPage=Math.max(1,Math.ceil(total/pageSize));
  const pageSafe=Math.min(page,maxPage);
  const items=paginate(filtered,pageSize,pageSafe);

  useEffect(()=>{setPage(1);},[view,query,pageSize,hideDupes,favViewFolder]);

  function showToast(kind,msg){setToast({type:kind,msg});window.clearTimeout(showToast._t);showToast._t=window.setTimeout(()=>setToast(null),3000);}

  function isFavAnywhere(t){const k=favKeyOf(t);return Object.values(favFolders.folders).some(list=>list.includes(k));}
  function addFavToFolder(t,folder){const k=favKeyOf(t);setFavFolders(prev=>{const folders={...prev.folders};const s=new Set(folders[folder]||[]);s.add(k);folders[folder]=Array.from(s);return {folders,lastFolder:folder};});}
  function removeFavFromAllFolders(t){const k=favKeyOf(t);setFavFolders(prev=>{const folders=Object.fromEntries(Object.entries(prev.folders).map(([f,arr])=>[f,arr.filter(x=>x!==k)]));return {folders,lastFolder:prev.lastFolder};});}

  function handleImport(ev){
    const file=ev.target.files?.[0]; if(!file) return;
    setBusy(true);
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const text=String(reader.result||"");
        const rows=parseTable(text);
        if(!rows.length) throw new Error("File kosong");
        const header=rows[0].map(s=>String(s).trim().toLowerCase());
        const col=(names)=>names.map(n=>String(n).toLowerCase()).map(n=>header.indexOf(n)).find(i=>i>=0);
        const idxModel=col(["modelid","model_id","model","id","model id"]);
        const idxTXD=col(["txdname","txd","txd_name","txd name"]);
        const idxName=col(["texturename","texture","name","texture name"]);
        const idxURL=col(["url","image","img"]);
        if(idxModel==null||idxTXD==null||idxName==null) throw new Error("Header wajib: modelid, txdname, texturename, url");
        const next=[]; let autoId=1;
        for(let i=1;i<rows.length;i++){
          const r=rows[i];
          const modelIdRaw=r[idxModel];
          const modelId=(modelIdRaw==null||String(modelIdRaw).trim()==="")?null:Number(modelIdRaw);
          const txdName=String(r[idxTXD]??"").trim();
          const textureName=String(r[idxName]??"").trim();
          const urlRaw=idxURL!=null?String(r[idxURL]??"").trim():"";
          if(!modelId||!txdName||!textureName) continue;
          const url=urlRaw||`https://gtxd.net/images/gtasa_textures/${txdName}.${textureName}.png`;
          next.push({id:autoId++,textureName,modelId,txdName,libraryName:"gta3.img",duplicateOf:null,urlEnc:b64enc(url),tags:[]});
        }
        if(!next.length) throw new Error("Tidak ada baris valid");
        setDataset(next); setView("home"); setQuery(""); setHideDupes(false); setPage(1);
        showToast("success",`Berhasil memuat ${next.length} data.`);
      }catch(e){console.error(e);showToast("error",`Gagal import: ${e.message||e}`);}finally{setBusy(false); ev.target.value="";}
    };
    reader.onerror=()=>{showToast("error","Gagal membaca file"); setBusy(false); ev.target.value="";};
    reader.readAsText(file);
  }
  function clearImported(){ setDataset([]); try{localStorage.removeItem(LS_KEY_DATA);}catch{} setPage(1); showToast("success","Dataset dikosongkan."); }

  // Export / Import encrypted
  async function handleExportEncrypted(){ setExportModal({open:true,password:""}); }
  async function doExport(){
    if(!exportModal.password){ showToast("error","Masukkan password."); return; }
    try{
      const out={};
      for(const [folder,list] of Object.entries(favFolders.folders)){
        out[folder]=list.map(k=>{const {modelId,txdName,textureName}=parseFavKey(k); const item=dataset.find(d=>d.modelId===modelId&&d.txdName===txdName&&d.textureName===textureName); const url=item?(item.urlEnc?b64dec(item.urlEnc):item.url):`https://gtxd.net/images/gtasa_textures/${txdName}.${textureName}.png`; return {modelid:modelId,txdname:txdName,texturename:textureName,url};});
      }
      const payload=await encryptJson(out, exportModal.password);
      const blob=new Blob([JSON.stringify(payload)],{type:"application/json"});
      const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`texfind_favorites_${new Date().toISOString().slice(0,10)}.tfx.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      showToast("success","Favorites diexport (encrypted)."); setExportModal({open:false,password:""});
    }catch(e){console.error(e);showToast("error","Gagal export.");}
  }
  function handleImportEncrypted(){ setImportModal({open:true,password:""}); }

  function onImportFileChange(ev){
    const file=ev.target.files?.[0]; if(!file){ return; }
    if(!importModal.password){ showToast("error","Masukkan password terlebih dulu."); ev.target.value=""; return; }
    const reader=new FileReader();
    reader.onload=async ()=>{
      try{
        const payload=JSON.parse(String(reader.result||"{}"));
        const data=await decryptJson(payload, importModal.password);
        const folders={...favFolders.folders}; let added=0;
        for(const [folder,arr] of Object.entries(data)){
          if(!Array.isArray(arr)) continue;
          if(!folders[folder]) folders[folder]=[];
          const set=new Set(folders[folder]);
          for(const obj of arr){ const k=`${obj.modelid}|${obj.txdname}|${obj.texturename}`; if(!set.has(k)){ set.add(k); added++; } }
          folders[folder]=Array.from(set);
        }
        setFavFolders({folders, lastFolder:favFolders.lastFolder});
        showToast("success",`Favorites loaded: ${added} entri baru.`);
        setImportModal({open:false,password:""});
      }catch(e){console.error(e); showToast("error","Decrypt/import gagal. Cek password & file.");}
      ev.target.value=""; // reset agar bisa pilih file sama
    };
    reader.onerror=()=>{showToast("error","Gagal membaca file"); ev.target.value="";};
    reader.readAsText(file);
  }

  // Folder management
  function renameFolder(oldName){
    const name=prompt("Nama folder baru:", oldName); if(!name || name===oldName) return;
    if(favFolders.folders[name]){ showToast("error","Folder sudah ada."); return; }
    setFavFolders(prev=>{
      const folders={...prev.folders};
      folders[name]=folders[oldName]||[];
      delete folders[oldName];
      return {folders, lastFolder: (prev.lastFolder===oldName?name:prev.lastFolder)};
    });
    if(favViewFolder===oldName) setFavViewFolder(name);
  }
  function deleteFolder(name){
    if(!confirm(`Hapus folder "${name}"?`)) return;
    const others=Object.keys(favFolders.folders).filter(n=>n!==name);
    let moveTo=null;
    if((favFolders.folders[name]||[]).length && others.length){
      moveTo=prompt(`Pindahkan ${favFolders.folders[name].length} item ke folder mana? (${others.join(", ")})`, others[0])||null;
      if(moveTo && !favFolders.folders[moveTo]){ showToast("error","Folder tujuan tidak ada."); moveTo=null; }
    }
    setFavFolders(prev=>{
      const folders={...prev.folders};
      const items=folders[name]||[];
      delete folders[name];
      if(moveTo){ folders[moveTo]=Array.from(new Set([...(folders[moveTo]||[]), ...items])); }
      const last = prev.lastFolder===name ? (Object.keys(folders)[0]||"Unfiled") : prev.lastFolder;
      return {folders, lastFolder:last};
    });
    if(favViewFolder===name) setFavViewFolder(Object.keys(favFolders.folders).find(n=>n!==name)||"Unfiled");
  }
  function moveAll(from){
    const others=Object.keys(favFolders.folders).filter(n=>n!==from);
    if(!others.length){ showToast("error","Tidak ada folder tujuan."); return; }
    const to=prompt(`Pindahkan semua item dari "${from}" ke folder:`, others[0]); if(!to||!favFolders.folders[to]) return;
    setFavFolders(prev=>{
      const folders={...prev.folders};
      const merged=Array.from(new Set([...(folders[to]||[]), ...(folders[from]||[])]));
      folders[to]=merged; folders[from]=[];
      return {folders, lastFolder: prev.lastFolder};
    });
    showToast("success",`Dipindahkan ke "${to}".`);
  }

  return (
    <div className={`min-h-screen ${theme.app}`}>
      {toast && (<div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-xl border shadow ${toast.type==='success'?theme.success:theme.error}`}>{toast.msg}</div>)}

      <header className={`sticky top-0 z-20 ${theme.header}`}>
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="text-2xl font-black tracking-tight">TexFind</div>
          <nav className="flex items-center gap-2">
            <button onClick={()=>setView('home')} className={`px-3 py-1 rounded-xl border text-sm ${view==='home'?theme.navAll:theme.button}`}>Home</button>
            <button onClick={()=>setView('favorites')} className={`px-3 py-1 rounded-xl border text-sm ${view==='favorites'?theme.navFav:theme.button}`}>Favorites</button>
            <button onClick={()=>setView('tutorial')} className={`px-3 py-1 rounded-xl border text-sm ${view==='tutorial'?theme.navTut:theme.button}`}>Tutorial</button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {view==='home' && (
            <>
              <label className={`px-3 py-2 rounded-xl cursor-pointer ${theme.button}`}>
                <input type="file" accept=".csv,.tsv,.txt,text/*" className="hidden" onChange={handleImport}/>
                Import Textures (CSV)
              </label>
              <button onClick={clearImported} className={`px-3 py-2 rounded-xl ${theme.button}`}>Clear data</button>
            </>
          )}

          {view==='favorites' && (
            <>
              <span className="text-sm opacity-80">Folder</span>
              <select className={`px-3 py-2 rounded-xl ${theme.select}`} value={favViewFolder} onChange={(e)=>setFavViewFolder(e.target.value)}>
                {folderNames.map(f=>(<option key={f} value={f}>{f}</option>))}
                {!folderNames.includes("Unfiled") && <option value="Unfiled">Unfiled</option>}
              </select>
              <button className={`px-3 py-2 rounded-xl ${theme.button}`} onClick={()=>setManageModal({open:true})}>Manage</button>

              <div className="ml-auto flex items-center gap-2">
                <button onClick={handleExportEncrypted} className={`px-3 py-2 rounded-xl ${theme.button}`}>Export (encrypted)</button>
                <button onClick={handleImportEncrypted} className={`px-3 py-2 rounded-xl ${theme.button}`}>Import (encrypted)</button>
              </div>
            </>
          )}

          <span className={`ml-auto text-xs ${theme.muted}`}>{view!=='favorites' && <>Data source: {dataset.length ? "imported" : "empty"} • {dataset.length} rows</>}</span>
        </div>

        {/* Filters only when dataset loaded and not tutorial */}
        {dataset.length>0 && view!=='tutorial' && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input value={query} onChange={(e)=>{setPage(1);setQuery(e.target.value);}} placeholder={view==='favorites'?"Search favorites...":"Search textures..."} className={`w-full md:w-72 px-3 py-2 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 ${theme.input}`}/>
            <div className="flex items-center gap-2">
              <label className={`text-sm ${theme.muted}`}>Show</label>
              <select value={pageSize} onChange={(e)=>{setPage(1);setPageSize(parseInt(e.target.value,10));}} className={`px-3 py-2 rounded-xl ${theme.select}`}>
                {[20,40,60,80,100].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className={`text-sm ${theme.muted}`}>entries</span>
            </div>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={hideDupes} onChange={(e)=>{setPage(1);setHideDupes(e.target.checked);}}/>Hide duplicates</label>
            <div className={`ml-auto text-sm ${theme.muted}`}>{total.toLocaleString()} item ditemukan</div>
          </div>
        )}

        {/* Views */}
        {view==='tutorial' ? (
          <div className={`rounded-2xl p-4 leading-relaxed ${theme.card} space-y-3`}>
            <h2 className="text-lg font-bold">Tutorial: Builder JGRP — Menggunakan TexFind untuk /dyoh</h2>
            <p>1) Cari texture di tab <b>Home</b> ➜ buka <i>Texture Detail</i> ➜ salin <b>Builder Code</b> (format: <code>[modelid] [txdname] [texturename]</code>).</p>
            <p>2) Masuk ke in-game JGRP sebagai builder, gunakan <code>/dyoh</code> untuk object handling/material.</p>
            <p>3) Tempel <b>builder code</b> ke field yang sesuai saat mengganti material object.</p>
            <p>4) Simpan dan ikuti SOP builder.</p>
            <div className="opacity-80 text-sm">
              <div>Referensi:</div>
              <ul className="list-disc pl-5">
                <li><a href="https://jogjagamers.org/topic/42025-guide-builder-how-to-basic/" target="_blank" rel="noreferrer">Guide Builder — How to Basic (jogjagamers.org)</a></li>
                <li><a href="https://jogjagamers.org/forum/80-mapping/" target="_blank" rel="noreferrer">Subforum Mapping/Builder</a></li>
                <li><a href="https://sampwiki.blast.hk/wiki/Objects" target="_blank" rel="noreferrer">SA:MP Objects (arsip)</a></li>
              </ul>
            </div>
          </div>
        ) : items.length===0 ? (
          <div className={`rounded-2xl p-8 text-center ${theme.card}`}>
            <div className="text-sm opacity-80 mb-2">{dataset.length===0?"Belum ada data. Import CSV/TSV/TXT di Home.":"Tidak ada hasil yang cocok."}</div>
            <div className="text-xs opacity-60">Coba hapus filter/pencarian.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map(t=>(
              <div key={t.id} className="relative">
                <button onClick={()=>setActive(t)} className={`w-full text-left rounded-2xl p-4 hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${theme.card}`}>
                  <div className="text-sm font-semibold truncate pr-8">{t.textureName}</div>
                  <div className={`mt-2 h-28 w-full rounded-xl flex items-center justify-center overflow-hidden ${theme.preview}`}>
                    <img src={b64dec(t.urlEnc)} alt={t.textureName} onError={(e)=>{e.currentTarget.style.display='none'; e.currentTarget.parentElement.innerText='No preview';}} className="w-full h-full object-cover"/>
                  </div>
                  <div className={`mt-2 text-xs ${theme.muted}`}>More info</div>
                </button>
                <button aria-label={isFavAnywhere(t)?"Remove from favorites":"Add to favorites"} onClick={(e)=>{e.stopPropagation(); if(isFavAnywhere(t)){ setDeleteFavModal({open:true,target:t}); } else { setFavModal({open:true,target:t}); } }} className={`absolute top-2 right-2 rounded-full border px-2 py-1 text-xs backdrop-blur transition ${isFavAnywhere(t)?theme.favActive:theme.favIdle}`}>
                  <HeartIcon filled={isFavAnywhere(t)}/>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {view!=='tutorial' && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} className={`px-3 py-2 rounded-xl disabled:opacity-40 ${theme.button}`} disabled={pageSafe===1}>Prev</button>
            <div className={`text-sm ${theme.muted}`}>Page {pageSafe} / {maxPage}</div>
            <button onClick={()=>setPage(p=>Math.min(maxPage,p+1))} className={`px-3 py-2 rounded-xl disabled:opacity-40 ${theme.button}`} disabled={pageSafe===maxPage}>Next</button>
          </div>
        )}
      </main>

      {/* Detail Modal */}
      {active && (
        <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={()=>setActive(null)}>
          <div className={`w-full max-w-2xl rounded-2xl ${theme.modal}`} onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 border-b border-inherit flex items-start justify-between">
              <div>
                <div className="text-lg font-bold flex items-center gap-2">
                  {active.textureName}
                  <button onClick={()=>{ if(isFavAnywhere(active)){ setDeleteFavModal({open:true,target:active}); } else { setFavModal({open:true,target:active}); } }} className={`rounded-full border px-2 py-1 text-xs transition ${isFavAnywhere(active)?theme.favActive:theme.favIdle}`}>
                    <HeartIcon filled={isFavAnywhere(active)}/>
                  </button>
                </div>
                <div className={`text-xs ${theme.muted}`}>Texture details</div>
              </div>
              <button onClick={()=>setActive(null)} className={`px-3 py-1 rounded-xl ${theme.button}`}>Close</button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className={`h-40 rounded-xl flex items-center justify-center overflow-hidden ${theme.preview}`}>
                  <img src={b64dec(active.urlEnc)} alt={active.textureName} onError={(e)=>{e.currentTarget.style.display='none'; e.currentTarget.parentElement.innerText='No preview';}} className="w-full h-full object-cover"/>
                </div>
                {/* URL hidden/obfuscated intentionally */}
              </div>
              <div className="space-y-2 text-sm">
                <Row label="Model ID" value={active.modelId??'-'}/>
                <Row label="TXD Name" value={active.txdName}/>
                <Row label="Texture Name" value={active.textureName}/>
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className={`rounded-xl p-3 text-xs space-y-2 ${theme.card}`}>
                <div className="font-semibold">In-Game Commands</div>
                <Code label="/edittexture" code={`/edittexture ${active.modelId??''} ${active.txdName} ${active.textureName}`}/>
                <Code label="/mmat" code={`/mmat ${active.modelId??''} ${active.txdName} ${active.textureName}`}/>
                {/* Builder Code at bottom */}
                <Code label="Builder Code" code={`${active.modelId??''} ${active.txdName} ${active.textureName}`}/>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save To Folder Modal */}
      {favModal.open && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setFavModal({open:false,target:null})}>
          <div className={`w-full max-w-sm rounded-2xl ${theme.modal} p-4`} onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-bold mb-2">Simpan ke folder</div>
            <select className={`mt-1 w-full px-3 py-2 rounded-xl ${theme.select}`} defaultValue={favFolders.lastFolder || (folderNames[0]||"Unfiled")} onChange={(e)=>setFavFolders(prev=>({...prev, lastFolder:e.target.value}))}>
              {folderNames.map(f=>(<option key={f} value={f}>{f}</option>))}
              {!folderNames.includes("Unfiled") && <option value="Unfiled">Unfiled</option>}
            </select>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={()=>setFavModal({open:false,target:null})} className={`px-3 py-2 rounded-xl ${theme.button}`}>Batal</button>
              <button onClick={()=>{ addFavToFolder(favModal.target, favFolders.lastFolder || (folderNames[0]||"Unfiled")); setFavModal({open:false,target:null}); showToast("success","Disimpan."); }} className={`px-3 py-2 rounded-xl ${theme.button}`}>Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Favorite Modal */}
      {deleteFavModal.open && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setDeleteFavModal({open:false,target:null})}>
          <div className={`w-full max-w-sm rounded-2xl ${theme.modal} p-4`} onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-bold mb-2">Hapus dari favorit?</div>
            <div className="text-sm opacity-80">Item ini akan dihapus dari semua folder favorit.</div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={()=>setDeleteFavModal({open:false,target:null})} className={`px-3 py-2 rounded-xl ${theme.button}`}>Batal</button>
              <button onClick={()=>{ removeFavFromAllFolders(deleteFavModal.target); setDeleteFavModal({open:false,target:null}); showToast("success","Dihapus dari favorit."); }} className={`px-3 py-2 rounded-xl ${theme.button}`}>Hapus</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Folders Modal */}
      {manageModal.open && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setManageModal({open:false})}>
          <div className={`w-full max-w-lg rounded-2xl ${theme.modal} p-4`} onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-bold">Manage Folders</div>
              <button onClick={()=>setManageModal({open:false})} className={`px-3 py-1 rounded-xl ${theme.button}`}>Close</button>
            </div>
            <div className="mb-3">
              <button className={`px-3 py-2 rounded-xl ${theme.button}`} onClick={()=>{
                const name=prompt("Nama folder baru:"); if(!name) return;
                if(favFolders.folders[name]){ showToast("error","Folder sudah ada."); return; }
                setFavFolders(prev=>({folders:{...prev.folders,[name]:[]}, lastFolder:name}));
                setFavViewFolder(name);
              }}>+ Folder</button>
            </div>
            <div className="space-y-2 max-h-80 overflow-auto pr-1">
              {Object.entries(favFolders.folders).map(([name,arr])=> (
                <div key={name} className={`flex items-center justify-between rounded-xl px-3 py-2 ${theme.card}`}>
                  <div className="flex items-center gap-3">
                    <div className="font-semibold">{name}</div>
                    <div className="text-xs opacity-70">{arr.length} item</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className={`px-2 py-1 rounded-lg ${theme.button}`} onClick={()=>renameFolder(name)}>Rename</button>
                    <button className={`px-2 py-1 rounded-lg ${theme.button}`} onClick={()=>moveAll(name)}>Move all</button>
                    <button className={`px-2 py-1 rounded-lg ${theme.button}`} onClick={()=>deleteFolder(name)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {exportModal.open && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setExportModal({open:false,password:""})}>
          <div className={`w-full max-w-sm rounded-2xl ${theme.modal} p-4`} onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-bold mb-2">Export Favorites (Encrypted)</div>
            <label className="text-sm opacity-80">Password (jangan lupa)</label>
            <input type="password" className={`mt-1 w-full px-3 py-2 rounded-xl ${theme.input}`} value={exportModal.password} onChange={(e)=>setExportModal(m=>({...m,password:e.target.value}))}/>
            <div className="text-xs opacity-70 mt-2">Catatan: password tidak dapat dipulihkan. Simpan dengan aman.</div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={()=>setExportModal({open:false,password:""})} className={`px-3 py-2 rounded-xl ${theme.button}`}>Batal</button>
              <button onClick={doExport} className={`px-3 py-2 rounded-xl ${theme.button}`}>Export</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importModal.open && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setImportModal({open:false,password:""})}>
          <div className={`w-full max-w-sm rounded-2xl ${theme.modal} p-4`} onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-bold mb-2">Import Favorites (Encrypted)</div>
            <label className="text-sm opacity-80">Password</label>
            <input type="password" className={`mt-1 w-full px-3 py-2 rounded-xl ${theme.input}`} value={importModal.password} onChange={(e)=>setImportModal(m=>({...m,password:e.target.value}))}/>
            <div className="mt-3">
              <label className={`px-3 py-2 rounded-xl cursor-pointer ${theme.button}`}>
                <input type="file" accept="application/json,.json" className="hidden" onChange={onImportFileChange}/>
                Pilih file .tfx.json
              </label>
            </div>
            <div className="text-xs opacity-70 mt-2">Catatan: password harus sama dengan saat export.</div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={()=>setImportModal({open:false,password:""})} className={`px-3 py-2 rounded-xl ${theme.button}`}>Close</button>
            </div>
          </div>
        </div>
      )}

      <footer className="max-w-6xl mx-auto px-4 py-10 opacity-70 text-xs">
        <div>TexFind • rezam5n / dvberg • © 2025</div>
      </footer>
    </div>
  );
}
