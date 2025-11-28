/*************************************************
 * Wishes Communicator — logic
 * — типограф + очередь событий
 * — совместим со Streamlabs AlertBox (onEventReceived)
 * — работает автономно (window.triggerDonation / тестовый режим)
 *************************************************/

const elLog   = document.getElementById('log');
const elFlash = document.getElementById('flash-overlay');
const elHints = document.getElementById('hints');

const sfxMain = document.getElementById('sfx-main');
const sfxType = document.getElementById('sfx-type'); // оставляем, но для кликов используем пул ниже
const sfxBig  = document.getElementById('sfx-big');  // может быть null

// 🔊 звук вспышки (играет ровно в момент flash())
const sfxFlash = new Audio('https://github.com/TraMaland2028/stream-assets/raw/refs/heads/main/%D0%B4%D0%BB%D1%8F%20%D0%B2%D1%81%D0%BF%D1%8B%D1%88%D0%BA%D0%B8.mp3');
sfxFlash.preload = 'auto';
sfxFlash.volume = 1.0; // при желании 0.8–0.9

// === многообразный пул коротких кликов для печати ===
// ТРИ твои рабочие raw-ссылки с GitHub:
const TYPE_SOURCES = [
  'https://github.com/TraMaland2028/stream-assets/raw/refs/heads/main/click1.mp3',
  'https://github.com/TraMaland2028/stream-assets/raw/refs/heads/main/click2.mp3',
  'https://github.com/TraMaland2028/stream-assets/raw/refs/heads/main/click3.mp3'
];

// создаём по 3 копии на каждый источник (можно 4–5, если cps высокий)
const typePool = createMultiAudioPool(TYPE_SOURCES, 3);

function createMultiAudioPool(urls, clonesPerUrl = 3) {
  const banks = urls.map(url =>
    Array.from({ length: clonesPerUrl }, () => {
      const a = new Audio(url);
      a.preload = 'auto';
      return a;
    })
  );

  const idxs = banks.map(() => 0);

  function pick() {
    const bankId = Math.floor(Math.random() * banks.length);
    const bank = banks[bankId];
    const i = idxs[bankId];
    idxs[bankId] = (i + 1) % bank.length;
    return bank[i];
  }

  return {
    play() {
      const a = pick();
      try {
        a.pause();
        a.currentTime = 0;
        // лёгкая вариация тембра и громкости для «живости»
        a.playbackRate = 0.96 + Math.random() * 0.10; // ~±5%
        a.volume = 0.85 + Math.random() * 0.25;       // 0.85–1.10
        a.play();
      } catch (_) {}
    },
    warmup() { // «разбудить» все копии по первому клику
      banks.flat().forEach(a => {
        try { a.play().then(() => { a.pause(); a.currentTime = 0; }); } catch (_) {}
      });
    }
  };
}

// Конфиг (удобно менять)
const CONFIG = {
  charsPerSec: Number(getParam('cps')) || parseFloat(getCss('--type-cps')) || 18,
  maxLines: Number(getParam('max_lines')) || parseInt(getCss('--max-lines')) || 200,

  // первая строка: только "ник — суммавалюта" (конверт добавляем в pushLine)
  headerTemplate: (name, amount, currency) =>
    `${name || 'anon'} — ${amount != null ? amount : ''}${currency || ''}`.trim(),

  // Очистка HTML инъекций
  sanitize: true,
  // Вспышка при старте оповещения
  flashOnStart: true,
  // Порог крупного доната (для отдельного звука)
  bigThreshold: Number(getParam('big')) || 20,
  // Автоскролл вниз при печати
  autoScroll: true,
  // Подсказки (в тестовом режиме)
  showHints: getParam('hints') === '1' || getParam('test') === '1'
};

// Очередь событий
const queue = [];
let busy = false;

function getCss(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function getParam(key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Безопасная вставка текста (экранируем html)
function escapeHTML(str = '') {
  return (str + '').replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}

// Добавить строку в лог
function pushLine(html, cls) {
  const line = document.createElement('div');
  line.className = 'line' + (cls ? ' ' + cls : '');
  line.innerHTML = html;
  elLog.appendChild(line);
  pruneLog();
  if (CONFIG.autoScroll) elLog.scrollTop = elLog.scrollHeight;
  return line;
}

function pruneLog() {
  const lines = elLog.querySelectorAll('.line');
  const max = CONFIG.maxLines;
  if (lines.length > max) {
    const extra = lines.length - max;
    for (let i = 0; i < extra; i++) lines[i].remove();
  }
}

async function playSfx(audioEl, {restart=true} = {}) {
  if (!audioEl) return;
  try {
    if (restart) audioEl.currentTime = 0;
    await audioEl.play();
  } catch (_) {
    // Автовоспроизведение может быть заблокировано браузером (обычно не в OBS)
  }
}

function flash() {
  if (!CONFIG.flashOnStart) return;

  // 🎵 звук вспышки строго в момент старта
  try { sfxFlash.currentTime = 0; sfxFlash.play(); } catch (_) {}

  const screen = document.getElementById('screen');
  screen.classList.add('flash');
  elFlash.classList.add('active');
  setTimeout(() => screen.classList.remove('flash'), 380);
  setTimeout(() => elFlash.classList.remove('active'), 300);
}

async function typeText(targetEl, text) {
  const cps = Math.max(1, CONFIG.charsPerSec);
  const dt = 1000 / cps;

  // курсор
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  targetEl.appendChild(cursor);

  const chunks = (text + '').split(/\n/);
  for (let li = 0; li < chunks.length; li++) {
    const lineText = chunks[li];
    for (let i = 0; i < lineText.length; i++) {
      const ch = lineText[i];
      cursor.insertAdjacentText('beforebegin', ch);

      // звук печати (разнообразные клики)
      if (typePool) { typePool.play(); }

      if (CONFIG.autoScroll) elLog.scrollTop = elLog.scrollHeight;
      await delay(dt);
    }
    if (li < chunks.length - 1) {
      cursor.insertAdjacentHTML('beforebegin', '<br/>');
      if (CONFIG.autoScroll) elLog.scrollTop = elLog.scrollHeight;
      await delay(dt * 2);
    }
  }
  cursor.remove();
}

async function processQueue() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const evt = queue.shift();
    const {name, amount, currency, message, isBig} = evt;

    // старт: вспышка + звук доната
    flash();
    await playSfx(isBig && sfxBig ? sfxBig : sfxMain);

    // 1) Заголовок (статично): ✉ (красный) + ник — сумма/валюта
    const header = CONFIG.headerTemplate(name, amount, currency);
    const safeHeader = CONFIG.sanitize ? escapeHTML(header) : header;
    const envelope = '<span class="env">✉</span>'; // цвет задаёт .env в CSS
    pushLine(`<span class="header-line">${envelope}&nbsp;${safeHeader}</span>`);

    // 2) Послание (печать)
    const text = message && message.trim() ? message.trim() : '(no message)';
    const safeText = CONFIG.sanitize ? escapeHTML(text) : text;
    const wishEl = pushLine('');
    await typeText(wishEl, safeText);
    await delay(500);

    // 3) Двойной разделитель
    pushLine('');
    pushLine('');
  }
  busy = false;
}

function enqueueDonation(evt) {
  const isBig = Number(evt.amount) >= CONFIG.bigThreshold;
  queue.push({ ...evt, isBig });
  processQueue();
}

// ========= Streamlabs интеграция =========
// Работает в окне кастомного AlertBox через их SDK (window.addEventListener)
window.addEventListener('onEventReceived', function (obj) {
  try {
    const { listener, event } = obj.detail;
    if (!listener || !event) return;

    if (listener === 'donation') {
      const data = Array.isArray(event) ? event[0] : event;
      const name = data.name || data.from || 'anonymous';
      const amount = parseFloat(data.amount || data.donation || 0);
      const currency = data.currency || (data.formattedAmount ? data.formattedAmount.replace(/[0-9\s.,]/g, '') : '') || '';
      const message = data.message || '';
      enqueueDonation({ name, amount, currency, message });
    }

    // поддержка superchat / подписок (опционально)
    if (listener === 'message' && event && event.type === 'superchat') {
      const data = event.data || {};
      enqueueDonation({
        name: data.displayName || 'viewer',
        amount: parseFloat(data.amount || 0),
        currency: data.currency || '',
        message: data.message || ''
      });
    }
  } catch (_) {
    // молча игнорируем ошибки SDK в OBS
  }
});

// ========= Автономный режим / тест =========
// Глобальный API для ручного вызова из OBS (Интерактив):
window.triggerDonation = function ({ name='guest', amount=1, currency='$', message='Hello from bunker.' } = {}) {
  enqueueDonation({ name, amount, currency, message });
};

// Небольшая подсказка в тестовом режиме
if (CONFIG.showHints) {
  elHints.textContent = 'TEST: press T to trigger sample wish · URL params: ?test=1&cps=18&big=20&max_lines=200';
}

// Тест по клавише T
window.addEventListener('keydown', (e) => {
  if ((getParam('test') === '1' || CONFIG.showHints) && (e.key === 't' || e.key === 'T')) {
    window.triggerDonation({
      name: 'wanderer',
      amount: (Math.random() * 50 + 1).toFixed(2),
      currency: '$',
      message: 'May our common flame endure.\nAnd guide those who are lost.'
    });
  }
});

// Инициализация приветственной надписи (не мешает алертам)
(function boot() {
  const hello1 = pushLine('<span class="accent">COMM LINK</span> online — terminal ready');
  const hello2 = pushLine('listening for <span class="accent">wishes</span>...');
  pushLine('');
  // курсор в последней строке
  typeText(hello2, '');
})();

// Разблокировка аудио в редких случаях (по клику мыши)
window.addEventListener('pointerdown', () => {
  playSfx(sfxMain, { restart:false });
  if (typePool) typePool.warmup(); // снять блокировку автоплея со всех копий

  // прогрев звука вспышки
  try {
    sfxFlash.play().then(() => { sfxFlash.pause(); sfxFlash.currentTime = 0; });
  } catch (_) {}
});

console.log('Custom overlay loaded!');