// script.js — full working code
// Assumes items.json at site root (optional) or CSV/JSON upload
// Data shape: [{chi:"", jpn:"", kana:"", cat:"optional-category"}]

/* -------------------------
   DOM references
   ------------------------- */
const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
const revealBtn = document.getElementById('revealBtn');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const resetBtn = document.getElementById('resetBtn');

const statusEl = document.getElementById('status');
const chiEl = document.getElementById('chi');
const jpnEl = document.getElementById('jpn');
const kanaEl = document.getElementById('kana');

const categoryListEl = document.getElementById('categoryList');
const selectAllCatsEl = document.getElementById('selectAllCats');

/* -------------------------
   Storage keys & state
   ------------------------- */
const STORAGE_ITEMS = 'vocab-items';
const STORAGE_STATE = 'vocab-state';
const STORAGE_CATS = 'vocab-cats';

let items = [];         // full dataset
let workingItems = [];  // filtered dataset used for the session
let order = [];         // shuffled indices into workingItems
let pos = -1;           // index into order
let history = [];       // shown indices (history of order positions)
let revealed = false;   // whether current item's jpn+kana are visible

let availableCategories = [];
let chosenCategories = new Set();

/* -------------------------
   Utilities
   ------------------------- */
function saveItemsToStorage(arr){
  try{ localStorage.setItem(STORAGE_ITEMS, JSON.stringify(arr)); }catch(e){}
}
function loadItemsFromStorage(){
  try{ const raw = localStorage.getItem(STORAGE_ITEMS); return raw ? JSON.parse(raw) : null; }
  catch(e){ return null; }
}
function saveState(){
  try{
    localStorage.setItem(STORAGE_STATE, JSON.stringify({order,pos,history,revealed}));
  }catch(e){}
}
function loadState(){
  try{ const raw = localStorage.getItem(STORAGE_STATE); return raw ? JSON.parse(raw) : null; }
  catch(e){ return null; }
}
function saveCats(){ try{ localStorage.setItem(STORAGE_CATS, JSON.stringify(Array.from(chosenCategories))); }catch(e){} }
function loadCats(){ try{ const r = localStorage.getItem(STORAGE_CATS); return r ? JSON.parse(r) : null; }catch(e){ return null; } }

/* Fisher-Yates shuffle */
function makeShuffled(n){
  const a = Array.from({length:n}, (_,i)=>i);
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/* -------------------------
   UI / rendering
   ------------------------- */
function setStatus(text){
  statusEl.textContent = text;
}

function updateUI(){
  if(!workingItems.length){
    setStatus('No items loaded / selected. Upload or host /items.json and choose categories.');
    chiEl.textContent = '—';
    jpnEl.style.display = 'none';
    kanaEl.style.display = 'none';
    revealBtn.disabled = true;
    nextBtn.disabled = true;
    prevBtn.disabled = true;
    return;
  }

  setStatus(`Items available: ${workingItems.length}. Shown: ${history.length} / ${workingItems.length}.`);
  revealBtn.disabled = (pos < 0 || pos >= order.length || revealed);
  nextBtn.disabled = (pos < 0 || pos >= order.length - 1);
  prevBtn.disabled = history.length <= 1;

  if(pos >= 0 && pos < order.length){
    const it = workingItems[order[pos]];
    chiEl.textContent = it.chi || '—';
    if(revealed){
      jpnEl.textContent = it.jpn || '';
      kanaEl.textContent = it.kana || '';
      jpnEl.style.display = it.jpn ? 'block' : 'none';
      kanaEl.style.display = it.kana ? 'block' : 'none';
      jpnEl.setAttribute('aria-hidden','false');
      kanaEl.setAttribute('aria-hidden','false');
    } else {
      jpnEl.style.display = 'none';
      kanaEl.style.display = 'none';
      jpnEl.setAttribute('aria-hidden','true');
      kanaEl.setAttribute('aria-hidden','true');
    }
  } else {
    chiEl.textContent = '—';
    jpnEl.style.display = 'none';
    kanaEl.style.display = 'none';
  }
}

/* -------------------------
   Category UI
   ------------------------- */
function buildCategoryUI(){
  const cats = new Set(items.map(it => (it.cat || 'uncategorized').toString().trim()));
  availableCategories = Array.from(cats).sort();
  categoryListEl.innerHTML = '';
  // load saved selection
  const saved = loadCats();
  if(Array.isArray(saved) && saved.length) chosenCategories = new Set(saved);

  availableCategories.forEach(cat=>{
    const id = 'cat_' + cat.replace(/\s+/g,'_').replace(/[^\w-]/g,'');
    const label = document.createElement('label');
    label.className = 'cat-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.value = cat;
    // default: checked unless saved selection exists
    cb.checked = (chosenCategories.size ? chosenCategories.has(cat) : true);
    if(cb.checked) chosenCategories.add(cat);
    cb.addEventListener('change', (e)=>{
      if(e.target.checked) chosenCategories.add(cat);
      else chosenCategories.delete(cat);
      // update select all checkbox
      const allChecked = availableCategories.every(c=>{
        const el = document.getElementById('cat_' + c.replace(/\s+/g,'_').replace(/[^\w-]/g,'')); return el && el.checked;
      });
      selectAllCatsEl.checked = allChecked;
      saveCats();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + cat));
    categoryListEl.appendChild(label);
  });

  // selectAll behavior
  selectAllCatsEl.checked = availableCategories.every(c=>{
    const el = document.getElementById('cat_' + c.replace(/\s+/g,'_').replace(/[^\w-]/g,''));
    return el && el.checked;
  });
  selectAllCatsEl.onchange = ()=>{
    const checked = selectAllCatsEl.checked;
    availableCategories.forEach(c=>{
      const el = document.getElementById('cat_' + c.replace(/\s+/g,'_').replace(/[^\w-]/g,''));
      if(el){ el.checked = checked; if(checked) chosenCategories.add(c); else chosenCategories.delete(c); }
    });
    saveCats();
  };
}

/* produce workingItems (filtered) from chosenCategories */
function getFilteredItems(){
  if(chosenCategories.size === 0) return [];
  return items.filter(it => chosenCategories.has((it.cat || 'uncategorized').toString().trim()));
}

/* -------------------------
   Core controls
   ------------------------- */
function start(){
  workingItems = getFilteredItems();
  if(!workingItems.length){
    alert('No items for selected categories. Please select at least one category.');
    return;
  }
  order = makeShuffled(workingItems.length);
  pos = -1;
  history = [];
  revealed = false;
  saveState();
  next(); // automatically show first
}

function reveal(){
  if(pos < 0 || pos >= order.length) return;
  revealed = true;
  saveState();
  updateUI();
}

function next(){
  if(pos < order.length - 1){
    pos++;
    history.push(order[pos]);
    revealed = false;
    saveState();
    updateUI();
  } else {
    // if finished, show final message
    alert('Finished the current deck.');
  }
}

function previous(){
  if(history.length <= 1) return;
  history.pop(); // remove current
  pos--;
  revealed = true; // show previous item fully
  saveState();
  updateUI();
}

function resetStorage(){
  if(!confirm('Remove stored items, categories and progress from this browser?')) return;
  localStorage.removeItem(STORAGE_ITEMS);
  localStorage.removeItem(STORAGE_STATE);
  localStorage.removeItem(STORAGE_CATS);
  items = []; workingItems = []; order = []; pos = -1; history = []; revealed = false; chosenCategories = new Set();
  categoryListEl.innerHTML = '';
  updateUI();
  alert('Cleared local storage for this site.');
}

/* -------------------------
   File parsing (CSV / JSON)
   ------------------------- */
function parseCSV(text){
  const lines = text.split(/\r?\n/);
  const out = [];
  for(const l of lines){
    if(!l.trim()) continue;
    // Basic CSV parse: handle quoted fields roughly
    const fields = l.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || l.split(',');
    const chi = (fields[0] || '').replace(/^"|"$/g,'').trim();
    const jpn = (fields[1] || '').replace(/^"|"$/g,'').trim();
    const kana = (fields[2] || '').replace(/^"|"$/g,'').trim();
    const cat = (fields[3] || '').replace(/^"|"$/g,'').trim();
    if(chi) out.push({chi,jpn,kana,cat});
  }
  return out;
}

/* -------------------------
   File upload handler
   ------------------------- */
fileInput.addEventListener('change', (ev)=>{
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = function(e){
    const text = e.target.result;
    // try JSON
    try{
      const parsed = JSON.parse(text);
      if(Array.isArray(parsed) && parsed.every(o=>o && typeof o === 'object')){
        items = parsed.map(o=>({
          chi: String(o.chi || o.Chi || o.CH || '').trim(),
          jpn: String(o.jpn || o.Jpn || o.jp || '').trim(),
          kana: String(o.kana || o.Kana || o.k || '').trim(),
          cat: String(o.cat || o.category || '').trim()
        })).filter(x=>x.chi);
        if(!items.length) { alert('JSON parsed but no rows with Chinese (chi) found.'); return; }
        finishLoadFromItems(items, 'uploaded JSON');
        return;
      }
    }catch(err){}
    // try CSV
    const csvItems = parseCSV(text);
    if(csvItems.length){
      items = csvItems.filter(x=>x.chi);
      finishLoadFromItems(items, 'uploaded CSV');
      return;
    }
    alert('Could not parse file. Use JSON (array of objects) or CSV (chi,jpn,kana[,cat]).');
  };
  reader.readAsText(f,'utf-8');
});

/* -------------------------
   Finalize load
   ------------------------- */
function finishLoadFromItems(arr, sourceNote){
  saveItemsToStorage(arr);
  // reset state (we want clean start after new upload)
  localStorage.removeItem(STORAGE_STATE);
  items = arr.slice();
  buildCategoryUI();
  workingItems = items.slice();
  order = [];
  pos = -1;
  history = [];
  revealed = false;
  saveState();
  setStatus(`Loaded ${items.length} items from ${sourceNote}. Choose categories and press Start.`);
  updateUI();
}

/* -------------------------
   Initialization: try fetch /items.json, else load local storage
   ------------------------- */
async function init(){
  setStatus('Loading /items.json if present...');
  try {
    const resp = await fetch('items.json', {cache: 'no-store'});
    if(resp.ok){
      const parsed = await resp.json();
      if(Array.isArray(parsed) && parsed.every(o=>o && typeof o === 'object')){
        items = parsed.map(o=>({
          chi: String(o.chi || '').trim(),
          jpn: String(o.jpn || '').trim(),
          kana: String(o.kana || '').trim(),
          cat: String(o.cat || '').trim()
        })).filter(x=>x.chi);
        saveItemsToStorage(items);
        // clear previous state to avoid mismatch with new dataset; keep cat prefs if possible
        localStorage.removeItem(STORAGE_STATE);
        buildCategoryUI();
        workingItems = items.slice();
        setStatus(`Loaded ${items.length} items from /items.json (shared). Choose categories and press Start.`);
        updateUI();
        return;
      } else {
        console.warn('/items.json not expected shape');
      }
    } else {
      console.info('/items.json not found (HTTP ' + resp.status + ')');
    }
  } catch(err){
    console.warn('fetch /items.json failed', err);
  }

  // fallback: load from localStorage
  const savedItems = loadItemsFromStorage();
  if(savedItems && Array.isArray(savedItems) && savedItems.length){
    items = savedItems.slice();
    buildCategoryUI();
    // try restore state (order/pos/history)
    const s = loadState();
    if(s){
      order = Array.isArray(s.order) ? s.order : [];
      pos = (typeof s.pos === 'number') ? s.pos : -1;
      history = Array.isArray(s.history) ? s.history : [];
      revealed = !!s.revealed;
      // set workingItems to filtered items using saved category selection (if any)
      const savedCats = loadCats();
      if(Array.isArray(savedCats) && savedCats.length){
        chosenCategories = new Set(savedCats);
      }
      workingItems = getFilteredItems();
      if(!workingItems.length) workingItems = items.slice();
    } else {
      workingItems = items.slice();
    }
    setStatus(`Loaded ${items.length} items from local storage. Choose categories and press Start.`);
    updateUI();
  } else {
    items = [];
    workingItems = [];
    setStatus('No items found. Upload CSV/JSON or host /items.json in the site root.');
    updateUI();
  }
}

/* -------------------------
   Wire up buttons
   ------------------------- */
startBtn.addEventListener('click', start);
revealBtn.addEventListener('click', reveal);
nextBtn.addEventListener('click', next);
prevBtn.addEventListener('click', previous);
resetBtn.addEventListener('click', resetStorage);

/* -------------------------
   Start
   ------------------------- */
init();
