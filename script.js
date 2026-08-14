// script.js — Reveal/Next + Select-all categories + tap-to-pronounce (Web Speech API)
// Data shape: [{chi:"", jpn:"", kana:"", cat:"optional-category"}]

/* -------------------------
   DOM references
   ------------------------- */
const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
const revealNextBtn = document.getElementById('revealNextBtn');
const prevBtn = document.getElementById('prevBtn');
const speakBtn = document.getElementById('speakBtn');

const statusEl = document.getElementById('status');
const chiEl = document.getElementById('chi');
const jpnEl = document.getElementById('jpn');
const kanaEl = document.getElementById('kana');
const jpnTextEl = jpnEl.querySelector('.word');
const kanaTextEl = kanaEl.querySelector('.word');

const categoryListEl = document.getElementById('categoryList');
const toggleAllBtn = document.getElementById('toggleAllBtn');
const catCountEl = document.getElementById('catCount');

const speechPanel = document.getElementById('speechPanel');
const autoSpeakChk = document.getElementById('autoSpeakChk');
const rateRange = document.getElementById('rateRange');
const rateVal = document.getElementById('rateVal');
const voiceSelect = document.getElementById('voiceSelect');
const speechNote = document.getElementById('speechNote');

/* -------------------------
   Storage keys & state
   ------------------------- */
const STORAGE_ITEMS = 'vocab-items';
const STORAGE_STATE = 'vocab-state';
const STORAGE_CATS = 'vocab-cats';
const STORAGE_KNOWN = 'vocab-known-cats';
const STORAGE_SPEECH = 'vocab-speech';

let items = [];
let workingItems = [];
let order = [];
let pos = -1;
let history = [];
let revealed = false;

let availableCategories = [];
let chosenCategories = new Set();

/* -------------------------
   Utilities
   ------------------------- */
function saveItemsToStorage(arr){ try{ localStorage.setItem(STORAGE_ITEMS, JSON.stringify(arr)); }catch(e){} }
function loadItemsFromStorage(){
  try{ const raw = localStorage.getItem(STORAGE_ITEMS); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
}
function saveState(){
  try{ localStorage.setItem(STORAGE_STATE, JSON.stringify({order,pos,history,revealed})); }catch(e){}
}
function loadState(){
  try{ const raw = localStorage.getItem(STORAGE_STATE); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
}
function saveCats(){ try{ localStorage.setItem(STORAGE_CATS, JSON.stringify(Array.from(chosenCategories))); }catch(e){} }
function loadCats(){ try{ const r = localStorage.getItem(STORAGE_CATS); return r ? JSON.parse(r) : null; }catch(e){ return null; } }
function saveKnownCats(){ try{ localStorage.setItem(STORAGE_KNOWN, JSON.stringify(availableCategories)); }catch(e){} }
function loadKnownCats(){ try{ const r = localStorage.getItem(STORAGE_KNOWN); return r ? JSON.parse(r) : null; }catch(e){ return null; } }

function makeShuffled(n){
  const a = Array.from({length:n}, (_,i)=>i);
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function show(el, visible){ el.classList.toggle('is-hidden', !visible); }

/* =========================================================
   SPEECH  (Web Speech API — offline, built into the browser)
   ========================================================= */
const synth = window.speechSynthesis || null;
const speechSupported = !!synth && typeof window.SpeechSynthesisUtterance === 'function';

let allVoices = [];
let speechUnlocked = false;
let currentUtterance = null;
let lastSpeak = {text:'', at:0};

let speechSettings = { autoSpeak:false, rate:0.9, voiceURI:'' };

function loadSpeechSettings(){
  try{
    const raw = localStorage.getItem(STORAGE_SPEECH);
    if(raw) Object.assign(speechSettings, JSON.parse(raw));
  }catch(e){}
  autoSpeakChk.checked = !!speechSettings.autoSpeak;
  rateRange.value = speechSettings.rate;
  rateVal.textContent = Number(speechSettings.rate).toFixed(2) + '×';
}
function saveSpeechSettings(){
  try{ localStorage.setItem(STORAGE_SPEECH, JSON.stringify(speechSettings)); }catch(e){}
}

/* Japanese voices only */
function japaneseVoices(){
  return allVoices.filter(v => /^ja/i.test(v.lang || '') || /japanese|日本語/i.test(v.name || ''));
}

/* Choose the best available Japanese voice */
function pickVoice(){
  const jv = japaneseVoices();
  if(speechSettings.voiceURI){
    const chosen = allVoices.find(v => v.voiceURI === speechSettings.voiceURI);
    if(chosen) return chosen;
  }
  const preferred = [/kyoko/i, /o-?ren/i, /otoya/i, /hattori/i, /google.*(日本語|japanese)/i, /nanami/i];
  for(const p of preferred){
    const m = jv.find(v => p.test(v.name || ''));
    if(m) return m;
  }
  return jv[0] || null;
}

function refreshVoices(){
  if(!speechSupported) return;
  allVoices = synth.getVoices() || [];
  const jv = japaneseVoices();

  const keep = voiceSelect.value;
  voiceSelect.innerHTML = '<option value="">Auto (best Japanese)</option>';
  jv.forEach(v=>{
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
  voiceSelect.value = (speechSettings.voiceURI && jv.some(v=>v.voiceURI===speechSettings.voiceURI))
    ? speechSettings.voiceURI : (keep && jv.some(v=>v.voiceURI===keep) ? keep : '');

  if(!jv.length){
    speechNote.textContent = allVoices.length
      ? 'No Japanese voice found — install one in your OS settings.'
      : 'Loading voices…';
  } else {
    const v = pickVoice();
    speechNote.textContent = v ? `Using: ${v.name}` : '';
  }
}

/* iOS/Safari need the first speak() to happen inside a user gesture */
function unlockSpeech(){
  if(!speechSupported || speechUnlocked) return;
  try{
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = 'ja-JP';
    synth.speak(u);
    speechUnlocked = true;
  }catch(e){}
}

function markSpeaking(on){
  jpnEl.classList.toggle('speaking', on);
  kanaEl.classList.toggle('speaking', on);
}

/* The main speak function */
function speak(text){
  if(!speechSupported){
    setStatus('This browser cannot speak. Try Safari, Chrome or Edge.');
    return;
  }
  text = (text || '').trim();
  if(!text) return;

  // ignore accidental duplicate taps within 250 ms
  const now = Date.now();
  if(text === lastSpeak.text && now - lastSpeak.at < 250) return;
  lastSpeak = {text, at: now};

  try{ synth.cancel(); }catch(e){}   // stop anything already playing

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = Number(speechSettings.rate) || 0.9;
  u.pitch = 1;
  u.volume = 1;

  const v = pickVoice();
  if(v){ u.voice = v; u.lang = v.lang || 'ja-JP'; }

  u.onstart = ()=> markSpeaking(true);
  u.onend   = ()=> markSpeaking(false);
  u.onerror = ()=> markSpeaking(false);

  currentUtterance = u;
  // small delay helps Safari right after cancel()
  setTimeout(()=>{ try{ synth.speak(u); }catch(e){ markSpeaking(false); } }, 30);
}

function currentItem(){
  return (pos >= 0 && pos < order.length) ? workingItems[order[pos]] : null;
}

/* kana is the most reliable reading; fall back to the kanji/word */
function speakText(it){
  if(!it) return '';
  const kana = (it.kana || '').trim();
  return kana || (it.jpn || '').trim();
}
function speakCurrent(){
  const it = currentItem();
  if(!it || !revealed) return;
  speak(speakText(it));
}
function maybeAutoSpeak(){
  if(speechSettings.autoSpeak) speakCurrent();
}

/* -------------------------
   UI / rendering
   ------------------------- */
function setStatus(text){ statusEl.textContent = text; }

function updateUI(){
  if(!workingItems.length){
    setStatus('No items loaded / selected. Upload or host items.json and choose categories.');
    chiEl.textContent = '—';
    show(jpnEl,false); show(kanaEl,false);
    revealNextBtn.disabled = true;
    prevBtn.disabled = true;
    speakBtn.disabled = true;
    return;
  }

  setStatus(`Items available: ${workingItems.length}. Shown: ${history.length} / ${workingItems.length}.`);

  if(pos < 0 || pos >= order.length){
    revealNextBtn.textContent = 'Reveal';
    revealNextBtn.disabled = false;
  } else if(revealed){
    revealNextBtn.textContent = (pos < order.length - 1) ? 'Next' : 'Finish';
    revealNextBtn.disabled = false;
  } else {
    revealNextBtn.textContent = 'Reveal';
    revealNextBtn.disabled = false;
  }

  prevBtn.disabled = history.length <= 1;

  const it = currentItem();
  if(it){
    chiEl.textContent = it.chi || '—';
    if(revealed){
      jpnTextEl.textContent = it.jpn || '';
      kanaTextEl.textContent = it.kana || '';
      show(jpnEl, !!it.jpn);
      show(kanaEl, !!it.kana);
    } else {
      show(jpnEl,false);
      show(kanaEl,false);
    }
  } else {
    chiEl.textContent = '—';
    show(jpnEl,false);
    show(kanaEl,false);
  }

  speakBtn.disabled = !(revealed && it && speakText(it));
}

/* -------------------------
   Category UI
   ------------------------- */
function updateCatUIState(){
  const total = availableCategories.length;
  if(catCountEl) catCountEl.textContent = total ? `${chosenCategories.size} / ${total} selected` : '';
  if(!toggleAllBtn) return;
  if(!total){
    toggleAllBtn.disabled = true;
    toggleAllBtn.textContent = 'Select all';
    return;
  }
  toggleAllBtn.disabled = false;
  const allSelected = availableCategories.every(c => chosenCategories.has(c));
  toggleAllBtn.textContent = allSelected ? 'Clear all' : 'Select all';
}

function setAllCategories(select){
  chosenCategories = select ? new Set(availableCategories) : new Set();
  categoryListEl.querySelectorAll('input[type="checkbox"]').forEach(cb=>{ cb.checked = select; });
  saveCats();
  updateCatUIState();
}

function buildCategoryUI(){
  const cats = new Set(items.map(it=>{
    const c = (it.cat || 'uncategorized').toString().trim();
    return c === '' ? 'uncategorized' : c;
  }));
  availableCategories = Array.from(cats).sort();
  categoryListEl.innerHTML = '';

  const saved = loadCats();
  const known = loadKnownCats();
  if(Array.isArray(saved)){
    const savedSet = new Set(saved);
    const knownSet = new Set(Array.isArray(known) ? known : []);
    chosenCategories = new Set(availableCategories.filter(c => savedSet.has(c) || !knownSet.has(c)));
  } else {
    chosenCategories = new Set(availableCategories);
  }
  saveKnownCats();
  saveCats();

  availableCategories.forEach(cat=>{
    const id = 'cat_' + cat.replace(/\s+/g,'_').replace(/[^\w-]/g,'');
    const label = document.createElement('label');
    label.className = 'cat-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.value = cat;
    cb.checked = chosenCategories.has(cat);
    cb.addEventListener('change',(e)=>{
      if(e.target.checked) chosenCategories.add(cat); else chosenCategories.delete(cat);
      saveCats();
      updateCatUIState();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + cat));
    categoryListEl.appendChild(label);
  });

  updateCatUIState();
}

function getFilteredItems(){
  if(chosenCategories.size === 0) return [];
  return items.filter(it => chosenCategories.has((it.cat || 'uncategorized').toString().trim()));
}

/* -------------------------
   Core controls
   ------------------------- */
function start(){
  workingItems = getFilteredItems();
  if(!workingItems.length && items.length) workingItems = items.slice();
  if(!workingItems.length){
    alert('No items for selected categories. Please select at least one category.');
    return;
  }
  order = makeShuffled(workingItems.length);
  pos = -1;
  history = [];
  revealed = false;
  saveState();
  goNext();
}

function reveal(){
  if(pos < 0 || pos >= order.length) return;
  revealed = true;
  saveState();
  updateUI();
  maybeAutoSpeak();
}

function goNext(){
  if(pos < order.length - 1){
    pos++;
    history.push(order[pos]);
    revealed = false;
    try{ if(synth) synth.cancel(); }catch(e){}
    markSpeaking(false);
    saveState();
    updateUI();
  } else {
    alert('Finished the current deck.');
  }
}

function previous(){
  if(history.length <= 1) return;
  history.pop();
  pos--;
  revealed = true;
  saveState();
  updateUI();
  maybeAutoSpeak();
}

function resetStorage(){
  if(!confirm('Remove stored items, categories and progress from this browser?')) return;
  [STORAGE_ITEMS,STORAGE_STATE,STORAGE_CATS,STORAGE_KNOWN,STORAGE_SPEECH].forEach(k=>localStorage.removeItem(k));
  items = []; workingItems = []; order = []; pos = -1; history = []; revealed = false;
  chosenCategories = new Set(); availableCategories = [];
  categoryListEl.innerHTML = '';
  updateCatUIState();
  updateUI();
  alert('Cleared local storage for this site.');
}

/* -------------------------
   Combined Reveal/Next
   ------------------------- */
function revealNextAction(){
  if(pos < 0 || pos >= order.length){
    if(!order.length){
      workingItems = getFilteredItems();
      if(!workingItems.length && items.length) workingItems = items.slice();
      if(!workingItems.length){
        alert('No items for selected categories. Please select at least one category.');
        return;
      }
      order = makeShuffled(workingItems.length);
      pos = -1; history = []; revealed = false;
    }
    goNext();
    revealed = true;
    saveState();
    updateUI();
    maybeAutoSpeak();
    return;
  }
  if(!revealed){ reveal(); return; }
  goNext();
}

/* -------------------------
   File parsing (CSV / JSON)
   ------------------------- */
function parseCSV(text){
  const lines = text.split(/\r?\n/);
  const out = [];
  for(const l of lines){
    if(!l.trim()) continue;
    const fields = l.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || l.split(',');
    const chi = (fields[0] || '').replace(/^"|"$/g,'').trim();
    const jpn = (fields[1] || '').replace(/^"|"$/g,'').trim();
    const kana = (fields[2] || '').replace(/^"|"$/g,'').trim();
    const cat = (fields[3] || '').replace(/^"|"$/g,'').trim();
    if(chi) out.push({chi,jpn,kana,cat});
  }
  return out;
}

fileInput.addEventListener('change',(ev)=>{
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = function(e){
    const text = e.target.result;
    try{
      const parsed = JSON.parse(text);
      if(Array.isArray(parsed) && parsed.every(o=>o && typeof o === 'object')){
        items = parsed.map(o=>({
          chi: String(o.chi || o.Chi || o.CH || '').trim(),
          jpn: String(o.jpn || o.Jpn || o.jp || '').trim(),
          kana: String(o.kana || o.Kana || o.k || '').trim(),
          cat: String(o.cat || o.category || '').trim()
        })).filter(x=>x.chi);
        if(!items.length){ alert('JSON parsed but no rows with Chinese (chi) found.'); return; }
        finishLoadFromItems(items, 'uploaded JSON');
        return;
      }
    }catch(err){}
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

function finishLoadFromItems(arr, sourceNote){
  saveItemsToStorage(arr);
  localStorage.removeItem(STORAGE_STATE);
  items = arr.slice();
  buildCategoryUI();
  workingItems = items.slice();
  order = []; pos = -1; history = []; revealed = false;
  saveState();
  setStatus(`Loaded ${items.length} items from ${sourceNote}. Choose categories and press Start.`);
  updateUI();
}

/* -------------------------
   Init
   ------------------------- */
async function init(){
  loadSpeechSettings();

  if(!speechSupported){
    speechPanel.classList.add('is-hidden');
    speakBtn.classList.add('is-hidden');
  } else {
    refreshVoices();
    synth.addEventListener?.('voiceschanged', refreshVoices);
    synth.onvoiceschanged = refreshVoices;
    // Safari sometimes fills the list late
    [200, 600, 1500].forEach(ms => setTimeout(refreshVoices, ms));
  }

  setStatus('Loading items.json if present...');
  try{
    const resp = await fetch('items.json', {cache:'no-store'});
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
        localStorage.removeItem(STORAGE_STATE);
        buildCategoryUI();
        workingItems = items.slice();
        setStatus(`Loaded ${items.length} items from items.json (shared). Choose categories and press Start.`);
        updateUI();
        return;
      }
    }
  }catch(err){ console.warn('fetch items.json failed', err); }

  const savedItems = loadItemsFromStorage();
  if(savedItems && Array.isArray(savedItems) && savedItems.length){
    items = savedItems.slice();
    buildCategoryUI();
    const s = loadState();
    if(s){
      order = Array.isArray(s.order) ? s.order : [];
      pos = (typeof s.pos === 'number') ? s.pos : -1;
      history = Array.isArray(s.history) ? s.history : [];
      revealed = !!s.revealed;
      workingItems = getFilteredItems();
      if(!workingItems.length) workingItems = items.slice();
    } else {
      workingItems = items.slice();
    }
    setStatus(`Loaded ${items.length} items from local storage. Choose categories and press Start.`);
    updateUI();
  } else {
    items = []; workingItems = []; availableCategories = [];
    updateCatUIState();
    setStatus('No items found. Upload CSV/JSON or host items.json in the site root.');
    updateUI();
  }
}

/* -------------------------
   Wire up
   ------------------------- */
startBtn.addEventListener('click', start);
revealNextBtn.addEventListener('click', revealNextAction);
prevBtn.addEventListener('click', previous);
speakBtn.addEventListener('click', speakCurrent);

if(toggleAllBtn){
  toggleAllBtn.addEventListener('click', ()=>{
    const allSelected = availableCategories.length > 0 && availableCategories.every(c=>chosenCategories.has(c));
    setAllCategories(!allSelected);
  });
}

/* tap the word / the kana to pronounce */
jpnEl.addEventListener('click', ()=>{
  const it = currentItem();
  if(it) speak(speakText(it));       // kana reading if available, else the word
});
kanaEl.addEventListener('click', ()=>{
  const it = currentItem();
  if(it) speak((it.kana || '').trim() || (it.jpn || '').trim());
});

/* speech settings */
autoSpeakChk.addEventListener('change', ()=>{
  speechSettings.autoSpeak = autoSpeakChk.checked;
  saveSpeechSettings();
  if(speechSettings.autoSpeak && revealed) speakCurrent();
});
rateRange.addEventListener('input', ()=>{
  speechSettings.rate = Number(rateRange.value);
  rateVal.textContent = speechSettings.rate.toFixed(2) + '×';
  saveSpeechSettings();
});
voiceSelect.addEventListener('change', ()=>{
  speechSettings.voiceURI = voiceSelect.value;
  saveSpeechSettings();
  const v = pickVoice();
  speechNote.textContent = v ? `Using: ${v.name}` : '';
  if(revealed) speakCurrent();
});

/* unlock audio on the very first user interaction (needed on iOS) */
['touchstart','mousedown','keydown'].forEach(evt=>{
  document.addEventListener(evt, unlockSpeech, {once:true, passive:true});
});

/* stop talking when leaving the page */
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){
    try{ if(synth) synth.cancel(); }catch(e){}
    markSpeaking(false);
  }
});

/* -------------------------
   iPhone / iPad: block double-tap zoom
   ------------------------- */
(function preventDoubleTapZoom(){
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function(e){
    const now = Date.now();
    if(now - lastTouchEnd <= 350){
      e.preventDefault();
      const el = e.target && e.target.closest
        ? e.target.closest('button, label, input, a, .speakable')
        : null;
      if(el) el.click();
    }
    lastTouchEnd = now;
  }, {passive:false});
})();

/* Keyboard: Space/→ = Reveal/Next, ← = Previous, S = Speak */
document.addEventListener('keydown',(e)=>{
  const tag = (e.target.tagName || '').toLowerCase();
  if(tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if(e.code === 'Space' || e.code === 'ArrowRight'){ e.preventDefault(); revealNextAction(); }
  if(e.code === 'ArrowLeft'){ e.preventDefault(); previous(); }
  if(e.key === 's' || e.key === 'S'){ e.preventDefault(); speakCurrent(); }
});

/* -------------------------
   Start
   ------------------------- */
init();
