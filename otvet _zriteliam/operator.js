/*************************************************
 * Operator Overlay — «чат-пузырь» с печатью
 *************************************************/

const elPanel = document.getElementById('op-panel');
const elLog   = document.getElementById('op-log');

/* звук отправки (играет после окончания печати) */
const sfxSend = document.getElementById('sfx-send');

function getParam(key){
  const u = new URL(window.location.href);
  return u.searchParams.get(key);
}

const CONFIG = {
  cps: Number(getParam('cps')) || 18,             // скорость печати (симв/сек)
  autohideSec: Number(getParam('hide')) || 0,     // ⬅ по умолчанию НЕ скрывать
  side: (getParam('side') || 'left').toLowerCase() // 'left' или 'right'
};

/* ==================== ЗВУК ПЕЧАТИ ==================== */
/* Пул кликов для печати — надёжные RAW-ссылки GitHub */
const TYPE_SOURCES = [
  'https://raw.githubusercontent.com/TraMaland2028/stream-assets/main/click1.mp3',
  'https://raw.githubusercontent.com/TraMaland2028/stream-assets/main/click2.mp3',
  'https://raw.githubusercontent.com/TraMaland2028/stream-assets/main/click3.mp3'
];

/* Увеличим клоны (5) и явно вызываем .load() для стабильности */
const typePool = createMultiAudioPool(TYPE_SOURCES, 5);

function createMultiAudioPool(urls, clonesPerUrl = 3){
  const banks = urls.map(url =>
    Array.from({length: clonesPerUrl}, () => {
      const a = new Audio(url);
      a.preload = 'auto';
      a.playsInline = true;
      try { a.load(); } catch(_) {}
      return a;
    })
  );
  const idxs = banks.map(() => 0);
  function pick(){
    const b = Math.floor(Math.random()*banks.length);
    const i = idxs[b]; idxs[b] = (i+1)%banks[b].length;
    return banks[b][i];
  }
  return {
    play(){
      const a = pick();
      try{
        a.pause();
        a.currentTime = 0;
        a.playbackRate = 0.96 + Math.random()*0.10;
        a.volume = 0.85 + Math.random()*0.25;
        a.play().catch(err => console.debug('[type sfx] play reject', err));
      }catch(err){
        console.debug('[type sfx] error', err);
      }
    },
    warmup(){
      banks.flat().forEach(a=>{
        try{
          a.muted = true;
          a.play()
            .then(()=>{ a.pause(); a.currentTime=0; a.muted=false; })
            .catch(()=>{ /* ок, браузер может отказать до user-gesture */ });
        }catch(_){}
      });
    }
  };
}

/* ==================== УТИЛИТЫ ==================== */

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

function escapeHTML(str=''){
  return (str+'').replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[s]);
}

/* === Разблокировка аудио (и прогрев) === */
let audioUnlocked = false;
async function ensureAudioUnlocked(){
  if (audioUnlocked) return true;
  try {
    if (sfxSend){
      sfxSend.muted = true;
      await sfxSend.play().catch(()=>{});
      sfxSend.pause(); sfxSend.currentTime = 0; sfxSend.muted = false;
    }
    if (typePool) typePool.warmup();
    audioUnlocked = true;
    return true;
  } catch(_) {
    return false;
  }
}

/* Вспомогатель для разового звука (если где-то понадобится) */
function playOnce(a){
  if(!a) return;
  a.currentTime = 0;
  a.play().catch(async ()=>{
    const ok = await ensureAudioUnlocked();
    if (ok) { try { a.currentTime = 0; a.play(); } catch(_){} }
  });
}

/* Надёжный проигрыватель «отправки»: клонируем <audio>, играем копию */
function playSend(){
  if (!sfxSend) return;
  try {
    const a = sfxSend.cloneNode(true);
    a.volume = 1.0;
    a.play().catch(async ()=>{
      await ensureAudioUnlocked();
      try { a.currentTime = 0; a.play(); } catch(_){}
    });
  } catch(_) {}
}

/* ==================== ПАНЕЛЬ/ПУЗЫРЬ ==================== */

function showPanel(){
  elPanel.classList.remove('fadeout');
  elPanel.classList.add('show');
  elPanel.setAttribute('aria-hidden','false');
}
function hidePanelImmediate(){
  elPanel.classList.remove('show','fadeout');
  elPanel.setAttribute('aria-hidden','true');
}

/* плавное скрытие по кнопке */
function fadeOutPanel(){
  if (!elPanel.classList.contains('show')) return;
  elPanel.classList.add('fadeout');      // opacity -> 0 (см. CSS)
  const dur = 300;                       // синхронизировано с transition
  setTimeout(()=> hidePanelImmediate(), dur);
}

/* публичная кнопка скрытия */
window.operatorHide = fadeOutPanel;

function clearLog(){ elLog.innerHTML=''; }

/* ==================== ПЕЧАТЬ ==================== */

async function typeText(targetEl, text){
  const cps = Math.max(1, CONFIG.cps);
  const dt  = 1000 / cps;

  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  targetEl.appendChild(cursor);

  const chunks = (text+'').split(/\n/);
  for (let li=0; li<chunks.length; li++){
    const lineText = chunks[li];
    for (let i=0; i<lineText.length; i++){
      cursor.insertAdjacentText('beforebegin', lineText[i]);
      if (typePool){ typePool.play(); }   // звук печати на каждый символ
      await delay(dt);
    }
    if (li < chunks.length-1){
      cursor.insertAdjacentHTML('beforebegin','\n');
      await delay(dt*2);
    }
  }
  cursor.remove();
}

/* ==================== ПУБЛИЧНЫЙ API ==================== */

async function typeOperator(message, opts={}){
  message = String(message||'').trim();
  clearLog();

  // опции для конкретного сообщения
  const side = (opts.side || CONFIG.side || 'left').toLowerCase();
  const cps  = Number(opts.cps  ?? CONFIG.cps);
  const hide = Number(opts.hide ?? CONFIG.autohideSec);

  // сохранить глобальные и применить временные
  const prev = { cps: CONFIG.cps, autohideSec: CONFIG.autohideSec, side: CONFIG.side };
  CONFIG.cps = Math.max(1, cps);
  CONFIG.autohideSec = Math.max(0, hide);
  CONFIG.side = side;

  // сторона пузыря
  elPanel.classList.remove('right');
  if (CONFIG.side === 'right') elPanel.classList.add('right');

  showPanel();

  const line = document.createElement('div');
  elLog.appendChild(line);

  await ensureAudioUnlocked();
  await typeText(line, escapeHTML(message));   // печать

  /* печать закончилась — звук «отправки» */
  playSend();

  // автоскрытие ТОЛЬКО если > 0
  if (CONFIG.autohideSec > 0){
    setTimeout(()=> fadeOutPanel(), CONFIG.autohideSec*1000);
  }

  // вернуть глобальные настройки
  CONFIG.cps = prev.cps; CONFIG.autohideSec = prev.autohideSec; CONFIG.side = prev.side;
}

window.triggerOperator = ({message='' , side, cps, hide } = {}) =>
  typeOperator(message, {side, cps, hide});

/* ==================== СВЯЗЬ С ПУЛЬТОМ ==================== */

const CH_NAME = 'operator_channel_v1';
let bc = null, usingBroadcast = false;
try { bc = new BroadcastChannel(CH_NAME); usingBroadcast = true; } catch(e){}

if (bc){
  bc.onmessage = async (ev)=>{
    const data = ev.data || {};
    if (data.kind === 'operator_message' && data.payload){
      await ensureAudioUnlocked();
      const { message, side, cps, hide } = data.payload;
      window.triggerOperator({ message, side, cps, hide });
    }
    if (data.kind === 'operator_hide'){
      fadeOutPanel();
    }
  };
} else {
  // Резерв: polling localStorage
  let lastStamp = 0;
  setInterval(async ()=>{
    try{
      const raw = localStorage.getItem('operator_packet');
      if (!raw) return;
      const pkt = JSON.parse(raw);
      if (!pkt || !pkt.__t) return;
      if (pkt.__t <= lastStamp) return;
      lastStamp = pkt.__t;
      if (pkt.kind === 'operator_message' && pkt.payload){
        await ensureAudioUnlocked();
        const { message, side, cps, hide } = pkt.payload;
        window.triggerOperator({ message, side, cps, hide });
      }
      if (pkt.kind === 'operator_hide'){
        fadeOutPanel();
      }
    }catch(_){}
  }, 350);
}

/* подстраховка: подгрузить аудио при готовности DOM */
document.addEventListener('DOMContentLoaded', ()=>{
  try { sfxSend && sfxSend.load(); } catch(_) {}
});

/* ==================== ТЕСТ-РЕЖИМ ==================== */
/* ?test=1 → O печать, P звук отправки, H скрыть */
if (getParam('test') === '1'){
  window.addEventListener('pointerdown', ()=>{
    if(typePool) typePool.warmup();
    ensureAudioUnlocked();
  }, {once:true});

  window.addEventListener('keydown', (e)=>{
    if (e.key==='o' || e.key==='O'){
      window.triggerOperator({
        message:'На Центральной площади танцевальная вечеринка будет — сальса, зумба, танго. И всё под «живую» музыку. Пошли?',
        side: CONFIG.side, cps: CONFIG.cps, hide: CONFIG.autohideSec
      });
    }
    if (e.key==='p' || e.key==='P'){ playSend(); }
    if (e.key==='h' || e.key==='H'){ fadeOutPanel(); }
  });
}
