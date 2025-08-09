import React, { useEffect, useMemo, useState } from "react";

// ---- LocalStorage keys ----
const LS_KEY_DATA = "gtxd_textures_data";   // base textures (CSV/TSV/TXT import)
const FAV_KEY     = "gtxd_fav_folders_enc"; // favorites with folders (structure only)

// ---- Utils ----
function paginate(arr, pageSize, page){ const s=(page-1)*pageSize; return arr.slice(s, s+pageSize); }
const norm = (s) => String(s ?? "").trim().toLowerCase();
const favKeyOf = (t) => `${t.modelId}|${t.txdName}|${t.textureName}`;
function parseFavKey(k){ const [modelId,txdName,textureName] = k.split("|"); return { modelId:Number(modelId), txdName, textureName }; }

// Simple base64 helpers
function u8(b){ return new Uint8Array(b); }
function b64enc(bytes){ return btoa(String.fromCharCode(...bytes)); }
function b64dec(str){ return u8([...atob(str)].map(c=>c.charCodeAt(0))); }

const theme = {
  app: "bg-neutral-950 text-neutral-100",
  header: "backdrop-blur bg-neutral-950/70 border-b border-neutral-800",
  input: "bg-neutral-900 border border-neutral-800",
  button: "bg-neutral-900 border border-neutral-800",
  select: "bg-neutral-900 border border-neutral-800",
  chip: "bg-neutral-800 text-neutral-300",
  card: "bg-neutral-900 border border-neutral-800",
  modal: "bg-neutral-950 border border-neutral-800",
  preview: "bg-neutral-800",
  favActive: "border-pink-500/50 bg-pink-500/20",
  favIdle: "border-neutral-700 bg-neutral-900/70",
  navAll: "border-indigo-500/60 bg-indigo-500/10",
  navFav: "border-pink-500/60 bg-pink-500/10",
  muted: "opacity-70",
  success: "bg-emerald-500/20 border-emerald-600 text-emerald-300",
  error: "bg-rose-500/20 border-rose-600 text-rose-300",
};

export default function App(){
  // ---- Base dataset ----
  const [dataset,setDataset]=useState(()=>{ try{ const raw=localStorage.getItem(LS_KEY_DATA); const p=raw?JSON.parse(raw):[]; return Array.isArray(p)?p:[]; }catch{return [];} });

  // ---- Favorites (folders) structure ----
  const [favFolders,setFavFolders]=useState(()=>{ try{ const raw=localStorage.getItem(FAV_KEY); return raw?JSON.parse(raw):{folders:{Unfiled:[]}, lastFolder:"Unfiled"};}catch{return {folders:{Unfiled:[]}, lastFolder:"Unfiled"};} });
  useEffect(()=>{ try{ localStorage.setItem(FAV_KEY, JSON.stringify(favFolders)); }catch{} },[favFolders]);

  // ---- UI states ----
  const [query,setQuery] = useState("");
  const [pageSize,setPageSize] = useState(20);
  const [page,setPage] = useState(1);
  const [hideDupes,setHideDupes] = useState(false);
  const [active,setActive] = useState(null);
  const [view,setView] = useState("all"); // all | favorites
  const [favViewFolder,setFavViewFolder] = useState(()=>Object.keys((favFolders.folders)||{})[0]||"Unfiled");
  const [toast,setToast] = useState(null);
  const [busy,setBusy] = useState({ base:false, favExport:false, favImport:false }); // disable buttons during ops
  const [manageOpen,setManageOpen] = useState(false); // folder manager modal
  const [favModal,setFavModal] = useState({ open:false, target:null, newFolder:"" }); // choose-folder modal

  // persist base dataset
  useEffect(()=>{ try{ localStorage.setItem(LS_KEY_DATA, JSON.stringify(dataset)); }catch{} },[dataset]);

  // ---- Derived lists ----
  const baseList = useMemo(()=>{
    if(view!=="favorites") return dataset;
    const keys=new Set(favFolders.folders[favViewFolder]||[]);
    return dataset.filter(t=>keys.has(favKeyOf(t)));
  },[view,dataset,favFolders,favViewFolder]);

  const filtered = useMemo(()=>{
    const q = norm(query);
    let data = baseList.filter(t => [t.textureName, t.txdName, t.modelId, t.libraryName].map(String).some(v=>norm(v).includes(q)));
    if (hideDupes) data = data.filter(t => !t.duplicateOf);
    return data;
  },[query,hideDupes,baseList]);

  const total=filtered.length;
  const maxPage=Math.max(1,Math.ceil(total/pageSize));
  const pageSafe=Math.min(page,maxPage);
  const items=paginate(filtered,pageSize,pageSafe);

  // ---- Favorites helpers ----
  const folderNames = Object.keys(favFolders.folders||{});
  function isFavAnywhere(t){ const k=favKeyOf(t); return Object.values(favFolders.folders).some(list=>list.includes(k)); }
  function addFavToFolder(t, folder){
    const k=favKeyOf(t);
    setFavFolders(prev=>{
      const folders={...prev.folders};
      const set=new Set(folders[folder]||[]);
      set.add(k);
      folders[folder]=Array.from(set);
      return { folders, lastFolder: folder };
    });
  }
  function removeFavFromAllFolders(t){
    const k=favKeyOf(t);
    setFavFolders(prev=>{
      const folders=Object.fromEntries(Object.entries(prev.folders).map(([f,arr])=>[f,arr.filter(x=>x!==k)]));
      return { folders, lastFolder: prev.lastFolder };
    });
  }

  function showToast(kind,msg){ setToast({type:kind,msg}); window.clearTimeout(showToast._t); showToast._t = window.setTimeout(()=>setToast(null), 3000); }

  // ---- Import base textures (CSV/TSV/TXT; delimiter or fixed columns) ----
  function handleImport(ev){
    const input = ev.target;
    const file = input.files?.[0];
    if(!file || busy.base) return;
    setBusy(b=>({...b, base:true}));
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const text = String(reader.result || "");
        const rows = parseTable(text);
        if(!rows.length) throw new Error("File kosong");
        const header = rows[0].map(s=>String(s).trim().toLowerCase());
        const dataRows = rows.slice(1);
        const col = (names)=> names.map(s=>String(s).toLowerCase()).map(n=>header.indexOf(n)).find(i=>i>=0);
        const idxModel = col(["modelid","model_id","model","id","model id","Model ID"]);
        const idxTXD   = col(["txdname","txd","txd_name","txd name","TXD Name"]);
        const idxName  = col(["texturename","texture","name","texture name","Texture Name"]);
        const idxURL   = col(["url","image","img","URL"]);
        if(idxModel==null || idxTXD==null || idxName==null || idxURL==null) throw new Error("Header wajib: modelid, txdname, texturename, url");

        const next=[]; let autoId=1;
        for(const r of dataRows){
          if(!r || r.every(c=>String(c).trim()==="")) continue;
          const modelIdRaw = r[idxModel];
          const modelId = (modelIdRaw===undefined||modelIdRaw===null||String(modelIdRaw).trim()==="")?null:Number(modelIdRaw);
          const txdName = String(r[idxTXD]??"").trim();
          const textureName = String(r[idxName]??"").trim();
          let url = String(r[idxURL]??"").trim();
          if(!txdName || !textureName) continue;
          if(!url) url = `https://gtxd.net/images/gtasa_textures/${txdName}.${textureName}.png`;
          if(!modelId) continue;
          next.push({ id:autoId++, textureName, modelId, txdName, libraryName:"gta3.img", duplicateOf:null, url, tags:[] });
        }
        if(!next.length) throw new Error("Tidak ada baris valid");
        setDataset(next); setView("all"); setQuery(""); setHideDupes(false); setPage(1);
        showToast("success",`Berhasil memuat ${next.length} data.`);
      }catch(e){
        console.error("Import error:", e);
        showToast("error", `Gagal import: ${e.message||e}`);
      }finally{
        setBusy(b=>({...b, base:false}));
        // reset input agar bisa pilih file yang sama lagi
        input.value = "";
      }
    };
    reader.onerror = () => {
      showToast("error","Gagal membaca file.");
      setBusy(b=>({...b, base:false}));
      input.value="";
    };
    reader.readAsText(file);
  }

  function clearImported(){
    setDataset([]);
    try{ localStorage.removeItem(LS_KEY_DATA); }catch{}
    setPage(1);
    showToast("success","Dataset dikosongkan.");
  }

  // ---- Encrypted Favorites Export/Import (AES-GCM, PBKDF2) ----
  async function exportFavoritesJSON(){
    if(busy.favExport) return;
    setBusy(b=>({...b, favExport:true}));
    try{
      const password = prompt("Masukkan password untuk enkripsi:");
      if(!password){ showToast("error","Export dibatalkan (tanpa password)."); return; }
      // build data structure to encrypt
      const out = {};
      for(const [folder,list] of Object.entries(favFolders.folders)){
        out[folder] = list.map(k=>{
          const {modelId,txdName,textureName} = parseFavKey(k);
          const item = dataset.find(d=>d.modelId===modelId && d.txdName===txdName && d.textureName===textureName);
          return { modelid:modelId, txdname:txdName, texturename:textureName, url: item?.url || `https://gtxd.net/images/gtasa_textures/${txdName}.${textureName}.png` };
        });
      }
      const payload = new TextEncoder().encode(JSON.stringify(out));
      const enc = await encryptWithPassword(payload, password);
      const blob = new Blob([JSON.stringify(enc,null,2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href=url; a.download=`texfind_favorites_${new Date().toISOString().slice(0,10)}.tfx.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      showToast("success","Favorites dienkripsi & diexport.");
    }catch(e){
      console.error(e);
      showToast("error","Gagal export favorites.");
    }finally{
      setBusy(b=>({...b, favExport:false}));
    }
  }

  async function importFavoritesJSON(ev){
    if(busy.favImport) return;
    const input = ev.target;
    const file = input.files?.[0];
    if(!file) return;
    setBusy(b=>({...b, favImport:true}));
    try{
      const text = await file.text();
      let data;
      try {
        // coba asumsikan terenkripsi
        const enc = JSON.parse(text);
        if(enc && enc.v && enc.kdf && enc.iv && enc.ct){
          const password = prompt("Password untuk dekripsi:");
          if(!password){ showToast("error","Import dibatalkan (tanpa password)."); return; }
          const plain = await decryptWithPassword(enc, password);
          data = JSON.parse(new TextDecoder().decode(plain));
        } else {
          data = JSON.parse(text); // plaintext (fallback)
        }
      } catch (e) {
        throw new Error("File bukan JSON yang valid.");
      }

      const folders = { ...favFolders.folders };
      let added = 0;
      for(const [folder, arr] of Object.entries(data)){
        if(!Array.isArray(arr)) continue;
        if(!folders[folder]) folders[folder]=[];
        const set = new Set(folders[folder]);
        for(const obj of arr){
          const k = `${obj.modelid}|${obj.txdname}|${obj.texturename}`;
          if(!set.has(k)){ set.add(k); added++; }
        }
        folders[folder] = Array.from(set);
      }
      setFavFolders({ folders, lastFolder: favFolders.lastFolder });
      showToast("success", `Favorites loaded: ${added} entri baru.`);
    }catch(e){
      console.error("Import favorites error:", e);
      showToast("error", `Gagal load favorites: ${e.message||e}`);
    }finally{
      setBusy(b=>({...b, favImport:false}));
      // reset file input agar bisa pilih ulang file yang sama
      input.value = "";
    }
  }

  // ---- Folder management UI actions ----
  function createFolder(name){
    const n = String(name||"").trim();
    if(!n) return showToast("error","Nama folder kosong.");
    if(favFolders.folders[n]) return showToast("error","Folder sudah ada.");
    setFavFolders(prev=>({ folders:{...prev.folders,[n]:[]}, lastFolder:n }));
    setFavViewFolder(n);
    showToast("success",`Folder "${n}" dibuat.`);
  }
  function renameFolder(oldName, newName){
    const n = String(newName||"").trim();
    if(!n) return showToast("error","Nama baru kosong.");
    if(!favFolders.folders[oldName]) return;
    if(oldName===n) return;
    if(favFolders.folders[n]) return showToast("error","Nama tujuan sudah dipakai.");
    setFavFolders(prev=>{
      const entries = Object.entries(prev.folders).map(([k,v])=>[k===oldName?n:k,v]);
      const folders = Object.fromEntries(entries);
      return { folders, lastFolder: prev.lastFolder===oldName ? n : prev.lastFolder };
    });
    if(favViewFolder===oldName) setFavViewFolder(n);
    showToast("success",`Folder "${oldName}" → "${n}"`);
  }
  function deleteFolder(name, moveTo){
    if(!favFolders.folders[name]) return;
    setFavFolders(prev=>{
      const folders={...prev.folders};
      const items = folders[name]||[];
      delete folders[name];
      if(items.length && moveTo && folders[moveTo]){
        const set = new Set([...(folders[moveTo]||[]), ...items]);
        folders[moveTo] = Array.from(set);
      }
      const lastFolder = prev.lastFolder===name ? (Object.keys(folders)[0]||"Unfiled") : prev.lastFolder;
      return { folders, lastFolder };
    });
    if(favViewFolder===name) setFavViewFolder(Object.keys(favFolders.folders).find(f=>f!==name) || "Unfiled");
    showToast("success",`Folder "${name}" dihapus${moveTo?` (dipindahkan ke "${moveTo}")`:""}.`);
  }
  function moveAll(from, to){
    if(from===to) return;
    const src = favFolders.folders[from]||[];
    setFavFolders(prev=>{
      const folders={...prev.folders};
      const set=new Set([...(folders[to]||[]), ...src]);
      folders[to]=Array.from(set);
      folders[from]=[];
      return { folders, lastFolder: prev.lastFolder };
    });
    showToast("success",`Semua item dari "${from}" → "${to}".`);
  }

  return (
    <div className={`min-h-screen ${theme.app}`}>
      {/* TOAST */}
      {toast && (<div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-xl border shadow ${toast.type==='success'?theme.success:theme.error}`}>{toast.msg}</div>)}

      <header className={`sticky top-0 z-20 ${theme.header}`}>
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="text-2xl font-black tracking-tight">TexFind</div>
          <nav className="flex items-center gap-2">
            <button onClick={()=>setView('all')} className={`px-3 py-1 rounded-xl border text-sm ${view==='all'?theme.navAll:theme.button}`}>All Textures</button>
            <button onClick={()=>setView('favorites')} className={`px-3 py-1 rounded-xl border text-sm flex items-center gap-2 ${view==='favorites'?theme.navFav:theme.button}`}>
              <span>Favorites</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] border border-neutral-700">{(favFolders.folders[favViewFolder]||[]).length}</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className={`px-3 py-2 rounded-xl cursor-pointer ${theme.button}`}>
            <input
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              onChange={handleImport}
              disabled={busy.base}
            />
            {busy.base ? "Importing..." : "Import Textures (CSV/TSV/TXT)"}
          </label>
          <button onClick={clearImported} className={`px-3 py-2 rounded-xl ${theme.button}`}>Clear data</button>

          {view==='favorites' && (
            <>
              <select className={`px-3 py-2 rounded-xl ${theme.select}`} value={favViewFolder} onChange={(e)=>setFavViewFolder(e.target.value)}>
                {Object.keys(favFolders.folders).map((f)=><option key={f} value={f}>{f}</option>)}
              </select>
              <button className={`px-3 py-2 rounded-xl ${theme.button}`} onClick={()=>setManageOpen(true)}>Manage folders</button>

              <button onClick={exportFavoritesJSON} className={`px-3 py-2 rounded-xl ${theme.button}`} disabled={busy.favExport}>
                {busy.favExport ? "Exporting..." : "Export favorites (Encrypted JSON)"}
              </button>
              <label className={`px-3 py-2 rounded-xl cursor-pointer ${theme.button}`}>
                <input type="file" accept="application/json,.json" className="hidden" onChange={importFavoritesJSON} disabled={busy.favImport} />
                {busy.favImport ? "Loading..." : "Load favorites (JSON)"}
              </label>
            </>
          )}

          <span className={`ml-auto text-xs ${theme.muted}`}>Data source: {dataset.length ? "imported" : "empty"} • {dataset.length} rows</span>
        </div>

        {/* Filters */}
        {dataset.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(e)=>{ setPage(1); setQuery(e.target.value); }}
              placeholder={view==='favorites' ? "Search favorites..." : "Search textures..."}
              className={`w-full md:w-72 px-3 py-2 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 ${theme.input}`}
            />
            <div className="flex items-center gap-2">
              <label className={`text-sm ${theme.muted}`}>Show</label>
              <select value={pageSize} onChange={(e)=>{ setPage(1); setPageSize(parseInt(e.target.value,10)); }} className={`px-3 py-2 rounded-xl ${theme.select}`}>
                {[20,40,60,80,100].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
              <span className={`text-sm ${theme.muted}`}>entries</span>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hideDupes} onChange={(e)=>{ setPage(1); setHideDupes(e.target.checked); }} />
              Hide duplicates
            </label>
            <div className={`ml-auto text-sm ${theme.muted}`}>{total.toLocaleString()} item ditemukan</div>
          </div>
        )}

        {/* EMPTY / GRID */}
        {items.length === 0 ? (
          <div className={`rounded-2xl p-8 text-center ${theme.card}`}>
            <div className="text-sm opacity-80 mb-2">
              {dataset.length === 0 ? "Belum ada data. Import file terlebih dulu." : "Tidak ada hasil yang cocok."}
            </div>
            <div className="text-xs opacity-60">Coba hapus filter/pencarian.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((t) => (
              <div key={t.id} className="relative">
                <button onClick={()=>setActive(t)} className={`w-full text-left rounded-2xl p-4 hover:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${theme.card}`}>
                  <div className="text-sm font-semibold truncate pr-8">{t.textureName}</div>
                  <div className={`mt-2 h-28 w-full rounded-xl flex items-center justify-center overflow-hidden ${theme.preview}`}>
                    <img src={t.url} alt={t.textureName} onError={(e)=>{ e.currentTarget.style.display='none'; e.currentTarget.parentElement.innerText='No preview'; }} className="w-full h-full object-cover" />
                  </div>
                  <div className={`mt-2 text-xs ${theme.muted}`}>More info</div>
                </button>
                <button
                  aria-label={isFavAnywhere(t) ? "Remove from favorites" : "Add to favorites"}
                  onClick={(e)=>{
                    e.stopPropagation();
                    if (isFavAnywhere(t)) { removeFavFromAllFolders(t); showToast("success","Dihapus dari semua folder."); }
                    else { setFavModal({ open:true, target:t, newFolder:"" }); }
                  }}
                  className={`absolute top-2 right-2 rounded-full border px-2 py-1 text-xs backdrop-blur transition ${isFavAnywhere(t) ? theme.favActive : theme.favIdle}`}
                >
                  <HeartIcon filled={isFavAnywhere(t)} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* PAGINATION */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} className={`px-3 py-2 rounded-xl disabled:opacity-40 ${theme.button}`} disabled={pageSafe===1}>Prev</button>
          <div className={`text-sm ${theme.muted}`}>Page {pageSafe} / {maxPage}</div>
          <button onClick={()=>setPage(p=>Math.min(maxPage,p+1))} className={`px-3 py-2 rounded-xl disabled:opacity-40 ${theme.button}`} disabled={pageSafe===maxPage}>Next</button>
        </div>
      </main>

      {/* DETAILS MODAL */}
      {active && (
        <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={()=>setActive(null)}>
          <div className={`w-full max-w-2xl rounded-2xl ${theme.modal}`} onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 border-b border-inherit flex items-start justify-between">
              <div>
                <div className="text-lg font-bold flex items-center gap-2">
                  {active.textureName}
                  <button
                    aria-label={isFavAnywhere(active) ? "Remove from favorites" : "Add to favorites"}
                    onClick={()=>{
                      if (isFavAnywhere(active)) { removeFavFromAllFolders(active); showToast("success","Dihapus dari semua folder."); }
                      else { setFavModal({ open:true, target:active, newFolder:"" }); }
                    }}
                    className={`rounded-full border px-2 py-1 text-xs transition ${isFavAnywhere(active) ? theme.favActive : theme.favIdle}`}
                  >
                    <HeartIcon filled={isFavAnywhere(active)} />
                  </button>
                </div>
                <div className={`text-xs ${theme.muted}`}>Texture details</div>
              </div>
              <button onClick={()=>setActive(null)} className={`px-3 py-1 rounded-xl ${theme.button}`}>Close</button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className={`h-40 rounded-xl flex items-center justify-center overflow-hidden ${theme.preview}`}>
                  <img src={active.url} alt={active.textureName} onError={(e)=>{ e.currentTarget.style.display='none'; e.currentTarget.parentElement.innerText='No preview'; }} className="w-full h-full object-cover" />
                </div>
                <a href={active.url} target="_blank" rel="noreferrer" className="text-xs underline opacity-80">Open image URL</a>
              </div>
              <div className="space-y-2 text-sm">
                <Row label="Model ID" value={active.modelId ?? '-'} />
                <Row label="TXD Name" value={active.txdName} />
                <Row label="Texture Name" value={active.textureName} />
                <Row label="URL" value={active.url} />
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className={`rounded-xl p-3 text-xs space-y-2 ${theme.card}`}>
                <div className="font-semibold">In-Game Commands</div>
                <Code label="/edittexture" code={`/edittexture ${active.modelId ?? ''} ${active.txdName} ${active.textureName}`} />
                <Code label="/mmat" code={`/mmat ${active.modelId ?? ''} ${active.txdName} ${active.textureName}`} />
                <Code label="Builder Code" code={`${active.modelId ?? ''} ${active.txdName} ${active.textureName}`} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHOOSE FOLDER MODAL */}
      {favModal.open && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setFavModal({open:false,target:null,newFolder:""})}>
          <div className={`w-full max-w-sm rounded-2xl ${theme.modal} p-4`} onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-bold mb-2">Simpan ke folder</div>
            <label className="text-sm opacity-80">Pilih folder</label>
            <select
              className={`mt-1 w-full px-3 py-2 rounded-xl ${theme.select}`}
              defaultValue={favFolders.lastFolder || (folderNames[0] || "Unfiled")}
              onChange={(e)=> setFavFolders(prev=>({...prev, lastFolder: e.target.value }))}
            >
              {folderNames.map(f=><option key={f} value={f}>{f}</option>)}
              {!folderNames.includes("Unfiled") && <option value="Unfiled">Unfiled</option>}
            </select>

            <div className="mt-3 text-sm opacity-80">…atau buat folder baru</div>
            <input className={`mt-1 w-full px-3 py-2 rounded-xl ${theme.input}`} placeholder="Nama folder baru (opsional)" value={favModal.newFolder} onChange={(e)=>setFavModal(m=>({...m, newFolder:e.target.value}))} />

            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={()=>setFavModal({open:false,target:null,newFolder:""})} className={`px-3 py-2 rounded-xl ${theme.button}`}>Batal</button>
              <button onClick={()=>{ const folder=(favModal.newFolder||favFolders.lastFolder||"Unfiled").trim(); if(!folder) return; if(!favFolders.folders[folder]) createFolder(folder); addFavToFolder(favModal.target, folder); setFavModal({open:false,target:null,newFolder:""}); showToast("success",`Disimpan ke folder "${folder}".`); }} className={`px-3 py-2 rounded-xl ${theme.button}`}>Simpan</button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE FOLDERS MODAL */}
      {manageOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onClick={()=>setManageOpen(false)}>
          <div className={`w-full max-w-2xl rounded-2xl ${theme.modal} p-4`} onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-bold">Manage folders</div>
              <button onClick={()=>setManageOpen(false)} className={`px-3 py-1 rounded-xl ${theme.button}`}>Close</button>
            </div>

            <div className="flex gap-2 mb-4">
              <input id="newFolderName" className={`flex-1 px-3 py-2 rounded-xl ${theme.input}`} placeholder="Nama folder baru" />
              <button className={`px-3 py-2 rounded-xl ${theme.button}`} onClick={()=>{ const val=document.getElementById("newFolderName").value; document.getElementById("newFolderName").value=""; createFolder(val); }}>+ Create</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(favFolders.folders).map(([name, list])=>(
                <div key={name} className={`rounded-xl p-3 ${theme.card}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{name}</div>
                    <div className="text-xs opacity-70">{list.length} items</div>
                  </div>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <button className={`px-3 py-1 rounded-xl ${theme.button}`} onClick={()=>{ const nn=prompt(`Rename "${name}" ke:`, name); if(nn!=null) renameFolder(name, nn); }}>Rename</button>
                    <button className={`px-3 py-1 rounded-xl ${theme.button}`} onClick={()=>{ if(!list.length){ if(confirm(`Hapus folder "${name}"?`)) deleteFolder(name); } else { const target=prompt(`Folder "${name}" berisi ${list.length} item.\nPindahkan semua ke folder mana? (ketik nama folder tujuan, harus sudah ada)`); if(target && favFolders.folders[target]) deleteFolder(name, target); else alert("Nama folder tujuan tidak valid / tidak ada."); } }}>Delete</button>
                    {Object.keys(favFolders.folders).length>1 && (
                      <button className={`px-3 py-1 rounded-xl ${theme.button}`} onClick={()=>{ const target=prompt(`Pindahkan semua dari "${name}" ke folder:`); if(target && favFolders.folders[target]) moveAll(name, target); else alert("Nama folder tujuan tidak valid / tidak ada."); }}>Move all →</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="max-w-6xl mx-auto px-4 py-10 opacity-70 text-xs">
        <div>TexFind • rezam5n / dvberg • © {new Date().getFullYear()}</div>
      </footer>
    </div>
  );
}

// ---- Small UI helpers ----
function Row({ label, value }){
  return (<div className="flex items-center gap-2"><div className="w-28 shrink-0 opacity-70">{label}</div><div className="truncate">{String(value??"")}</div></div>);
}

function Code({ label, code }){
  const [copied,setCopied]=useState(false);
  return (
    <div className={`rounded-2xl overflow-hidden border ${theme.card}`}>
      <div className="px-3 py-2 text-[10px] opacity-70 flex items-center justify-between border-b border-inherit">
        <span>{label}</span>
        <button className={`px-2 py-0.5 rounded-lg border`} onClick={()=>{ navigator.clipboard.writeText(code); setCopied(true); setTimeout(()=>setCopied(false),1000); }}>{copied?"Copied":"Copy"}</button>
      </div>
      <pre className="p-3 text-xs overflow-auto">{code}</pre>
    </div>
  );
}

function HeartIcon({ filled }){
  return (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill={filled?"currentColor":"none"} className="inline"><path d="M12 21s-6.716-4.297-9.193-7.243C-0.298 12.21.16 8.53 2.98 7.157A4.93 4.93 0 0 1 12 8.09a4.93 4.93 0 0 1 9.02-0.933c2.82 1.372 3.279 5.052-.827 6.6C18.716 16.703 12 21 12 21z" stroke="currentColor" strokeWidth="1.5"/></svg>);
}

// --- Parser: auto-detect table (CSV/TSV/TXT and fixed columns via 2+ spaces) ---
function parseTable(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length);
  if(!lines.length) return [];
  const first = lines[0].replace(/^\ufeff/,"");
  const candidates = [
    {d:",", c:(first.match(/,/g)||[]).length},
    {d:";", c:(first.match(/;/g)||[]).length},
    {d:"\t", c:(first.match(/\t/g)||[]).length},
    {d:"|", c:(first.match(/\|/g)||[]).length},
  ];
  const best = candidates.sort((a,b)=>b.c-a.c)[0];
  if(best.c>0){
    // Use CSV-like parser for the chosen delimiter
    return lines.map(line=>csvSplit(line.replace(/^\ufeff/,""), best.d));
  }
  // fallback: split by 2+ spaces
  return lines.map(line=> line.replace(/^\ufeff/,"").trim().split(/ {2,}/).map(s=>s.trim()));
}

// handle quotes for CSV-ish lines on a single line
function csvSplit(line, delim){
  const out=[]; let cell=""; let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i]; const next=line[i+1];
    if(inQ){
      if(ch==='"' && next==='"'){ cell+='"'; i++; continue; }
      if(ch==='"'){ inQ=false; continue; }
      cell+=ch;
    }else{
      if(ch==='"'){ inQ=true; continue; }
      if(ch===delim){ out.push(cell.trim()); cell=""; continue; }
      cell+=ch;
    }
  }
  out.push(cell.trim());
  return out;
}

// ---- Crypto (AES-GCM + PBKDF2-SHA256) ----
async function encryptWithPassword(plainBytes, password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations:150000, hash:"SHA-256" },
    keyMat,
    { name:"AES-GCM", length:256 },
    false,
    ["encrypt"]
  );
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, plainBytes));
  return { v:1, kdf:"PBKDF2", iter:150000, hash:"SHA-256", alg:"AES-GCM", salt:b64enc(salt), iv:b64enc(iv), ct:b64enc(ct) };
}

async function decryptWithPassword(encObj, password){
  const salt = b64dec(encObj.salt);
  const iv = b64dec(encObj.iv);
  const ct = b64dec(encObj.ct);
  const keyMat = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations:encObj.iter||150000, hash:"SHA-256" },
    keyMat,
    { name:"AES-GCM", length:256 },
    false,
    ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name:"AES-GCM", iv }, key, ct);
  return new Uint8Array(plain);
}
