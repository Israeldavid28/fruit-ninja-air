/**
 * dojo.js — Motor del juego Frutix
 * Canvas 2D + WebSocket MediaPipe + Lógica de frutas + Anti-Cheat
 */
import { supabase, cerrarSesion, garantizarPerfil } from '../servicios/supabase.js';
import { procesarPartida } from '../servicios/middleware.js';
import { silenciarMusica } from '../servicios/musica.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// ── AUDIO (Web Audio API — sin archivos externos) ─────────
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function sonidoCorte() {
  if (!estado.sonido) return;
  const ac = getAudioCtx();
  const t = ac.currentTime;
  // Ruido blanco filtrado → "fsh" húmedo de corte
  const bufLen = Math.floor(ac.sampleRate * 0.18);
  const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bpf = ac.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.setValueAtTime(2200, t);
  bpf.frequency.exponentialRampToValueAtTime(600, t + 0.12);
  bpf.Q.value = 0.8;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.55, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(bpf); bpf.connect(gain); gain.connect(ac.destination);
  src.start(t); src.stop(t + 0.18);
}

function sonidoPowerup() {
  if (!estado.sonido) return;
  const ac = getAudioCtx();
  const t = ac.currentTime;
  // Arpegio ascendente C5 → E5 → C6
  [523.25, 659.25, 1046.5].forEach((freq, idx) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const s = t + idx * 0.1;
    gain.gain.setValueAtTime(0, s);
    gain.gain.linearRampToValueAtTime(0.28, s + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(s); osc.stop(s + 0.22);
  });
}

function sonidoBeep(freq, duracion, volumen = 0.35) {
  // Beep limpio para 3-2-1
  if (!estado.sonido) return;
  const ac = getAudioCtx();
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volumen, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duracion);
  osc.connect(gain); gain.connect(ac.destination);
  osc.start(t); osc.stop(t + duracion);
}

function sonidoStart() {
  // Acorde mayor para "¡YA!"
  if (!estado.sonido) return;
  const ac = getAudioCtx();
  const t = ac.currentTime;
  [523.25, 659.25, 783.99].forEach(freq => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(t); osc.stop(t + 0.5);
  });
}

// ── CONSTANTES ───────────────────────────────────────────
const WS_URL      = 'ws://localhost:8000/ws';
const DURACION    = 60;        // segundos
const PUNTOS_FRUTA = 10;
const PUNTOS_COMBO = 5;        // bonus por combo
const RADIO_COLISION = 40;     // px

// Power-up definitions
const POWERUP_DEFS = {
  estrella: { id: 'estrella', src: '/frutas/estrella.png', emoji: '⭐', label: '×2 Puntos', duracion: 5000, color: '#f59e0b' },
  hielo:    { id: 'hielo', src: '/frutas/hielo.png', emoji: '❄️', label: 'Congelar',  duracion: 4000, color: '#60a5fa' },
  reloj:    { id: 'reloj', src: '/frutas/reloj.png', emoji: '⏰', label: '+10s',       duracion: 0,    color: '#4ade80' },
  escudo:   { id: 'escudo', src: '/frutas/escudo.png', emoji: '🛡️', label: 'Escudo',    duracion: 0,    color: '#c084fc' },
};

// ── CATÁLOGO DE FRUTAS CON IMÁGENES ──────────────────────
const FRUTAS_CATALOGO = [
  { id: 'manzana', src: '/frutas/manzana.png',  esBomba: false },
  { id: 'naranja', src: '/frutas/naranja.png',  esBomba: false },
  { id: 'limon',   src: '/frutas/limon.png',    esBomba: false },
  { id: 'sandia',  src: '/frutas/sandia.png',   esBomba: false },
  { id: 'fresa',   src: '/frutas/fresa.png',    esBomba: false },
  { id: 'durazno', src: '/frutas/durazno.png',  esBomba: false },
  { id: 'kiwi',    src: '/frutas/kiwi.png',     esBomba: false },
  { id: 'uvas',    src: '/frutas/uvas.png',     esBomba: false },
];
const BOMBA_DEF = { id: 'bomba', src: '/frutas/bomba.png', esBomba: true };

// Pre-carga todas las imágenes
const IMGS = {};
[
  ...FRUTAS_CATALOGO, 
  BOMBA_DEF,
  POWERUP_DEFS.estrella,
  POWERUP_DEFS.hielo,
  POWERUP_DEFS.reloj,
  POWERUP_DEFS.escudo
].forEach(f => {
  const img = new Image();
  img.src = f.src;
  IMGS[f.id] = img;
});

// ── ESTADO DEL JUEGO ─────────────────────────────────────
let estado = {
  activo:     false,
  pausado:    false,
  puntaje:    0,
  combo:      0,
  comboMax:   0,
  frutasCorte: 0,
  tiempoRestante: DURACION,
  modo:       'normal',   // 'normal' | 'infinito'
  efectos:    true,
  sonido:     true,
  sensibilidad: 0.7,
  fuenteDeteccion: 'local',
};

// ── ESTADO DE POWER-UPS ───────────────────────────────────
let powerups = {
  multiplicador: false,  // ⭐ x2 puntos activo
  hielo:         false,  // ❄️ frutas lentas activo
  escudo:        false,  // 🛡️ escudo activo (absorbe 1 bomba)
  timers:        {},     // { [tipo]: timeoutId }
};

let usuario    = null;
let modoInvitado = false;
let nombreJugador = '';

// ── ELEMENTOS DOM ────────────────────────────────────────
const canvas        = document.getElementById('canvas-juego');
const ctx           = canvas.getContext('2d');
const webcamEl      = document.getElementById('webcam-vista');
const wsBadge       = document.getElementById('ws-badge-ia');
const wsTexto       = document.getElementById('ws-texto');
const hudJugador    = document.getElementById('hud-jugador');
const hudTiempo     = document.getElementById('hud-tiempo');
const hudPuntaje    = document.getElementById('hud-puntaje');
const hudCombo      = document.getElementById('hud-combo');
const comboNum      = document.getElementById('combo-num');
const finPanel      = document.getElementById('fin-partida');
const finPuntaje    = document.getElementById('fin-puntaje');
const finCombo      = document.getElementById('fin-combo');
const finFrutas     = document.getElementById('fin-frutas');
const finXp         = document.getElementById('fin-xp');
const finGuardando  = document.getElementById('fin-guardando');
const finGuardado   = document.getElementById('fin-guardado');
const finError      = document.getElementById('fin-error');
const configPanel   = document.getElementById('config-panel');
const pausaOverlay  = document.getElementById('overlay-pausa');
const toastContainer= document.getElementById('toast-container');

// ── FRUTAS EN VUELO ──────────────────────────────────────
let frutas = [];
let mitades = [];          // mitades de fruta cortada (animación split)
let estela = [];           // rastro del dedo
let efectosVisuales = []; // partículas de corte

// ── WEBSOCKET / POSICIÓN DEL DEDO ────────────────────────
let ws = null;
let dedoPos = null;        // { x, y } en coordenadas canvas (0..1 normalizado)
let wsConectado = false;

function conectarWS() {
  if (estado.fuenteDeteccion !== 'ws') return;
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      wsConectado = true;
      wsBadge.className = 'ws-badge conectado';
      wsTexto.textContent = 'MediaPipe Activo';
    };

    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        // El servidor manda {x, y} normalizados 0-1 (punto 8, dedo índice)
        if (d.x !== undefined && d.y !== undefined) {
          // Invertir X (espejo de cámara)
          dedoPos = { x: 1 - d.x, y: d.y };
        }
      } catch { /* skip */ }
    };

    ws.onclose = () => {
      wsConectado = false;
      wsBadge.className = 'ws-badge desconectado';
      wsTexto.textContent = 'Sin Conexión (modo ratón)';
      dedoPos = null;
      // Reintentar en 3s
      setTimeout(conectarWS, 3000);
    };

    ws.onerror = () => ws.close();
  } catch {
    wsBadge.className = 'ws-badge desconectado';
    wsTexto.textContent = 'Usando Ratón como Espada';
  }
}

// ── IA LOCAL JS ──────────────────────────────────────────
let handLandmarker = null;
let lastVideoTime = -1;

async function inicializarMediaPipeLocal() {
  if (estado.fuenteDeteccion !== 'local') return;
  try {
    wsBadge.className = 'ws-badge';
    wsTexto.textContent = 'Cargando IA Local...';
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1
    });
    
    wsBadge.className = 'ws-badge conectado';
    wsTexto.textContent = 'IA Local Activa';
    loopDeteccionLocal();
  } catch (e) {
    console.error("Error cargando MediaPipe Local:", e);
    wsBadge.className = 'ws-badge desconectado';
    wsTexto.textContent = 'Error IA Local';
  }
}

async function loopDeteccionLocal() {
  if (estado.fuenteDeteccion === 'local' && handLandmarker && webcamEl.videoWidth > 0) {
    let startTimeMs = performance.now();
    if (lastVideoTime !== webcamEl.currentTime) {
      lastVideoTime = webcamEl.currentTime;
      let results = handLandmarker.detectForVideo(webcamEl, startTimeMs);
      if (results.landmarks && results.landmarks.length > 0) {
        const d = results.landmarks[0][8];
        dedoPos = { x: 1 - d.x, y: d.y };
      }
    }
  }
  requestAnimationFrame(loopDeteccionLocal);
}

// Fallback: usar el ratón cuando no hay WS
canvas.addEventListener('mousemove', (e) => {
  if (wsConectado) return;
  const r = canvas.getBoundingClientRect();
  dedoPos = {
    x: (e.clientX - r.left) / r.width,
    y: (e.clientY - r.top)  / r.height,
  };
});

canvas.addEventListener('touchmove', (e) => {
  if (wsConectado) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const t = e.touches[0];
  dedoPos = {
    x: (t.clientX - r.left) / r.width,
    y: (t.clientY - r.top)  / r.height,
  };
}, { passive: false });

// ── CÁMARA ───────────────────────────────────────────────
async function iniciarCamara() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    webcamEl.srcObject = stream;
    webcamEl.addEventListener('loadeddata', () => {
      if (estado.fuenteDeteccion === 'local') {
        inicializarMediaPipeLocal();
      }
    });
  } catch {
    webcamEl.style.display = 'none';
  }
}

// ── REDIMENSIONAR CANVAS ─────────────────────────────────
function redimensionar() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', redimensionar);
redimensionar();

// ── SPAWN DE FRUTAS ──────────────────────────────────────
function spawnFruta() {
  const r = Math.random();
  const esBomba   = r < 0.08;
  const esPowerup = !esBomba && r < 0.14;

  let tipo = null;
  let imgObj = null;
  let emoji = '';

  if (esPowerup) {
    const tipos = Object.keys(POWERUP_DEFS);
    tipo  = tipos[Math.floor(Math.random() * tipos.length)];
    emoji = POWERUP_DEFS[tipo].emoji;
    imgObj = IMGS[tipo];
  } else if (esBomba) {
    emoji  = '💣';
    imgObj = IMGS['bomba'];
  } else {
    const def = FRUTAS_CATALOGO[Math.floor(Math.random() * FRUTAS_CATALOGO.length)];
    tipo   = def.id;
    imgObj = IMGS[def.id];
  }

  const velBase = powerups.hielo ? 0.004 : 0.008;
  frutas.push({
    id:          Math.random(),
    emoji,
    img:         imgObj,
    esBomba,
    esPowerup,
    tipoPowerup: tipo,
    x:           0.1 + Math.random() * 0.8,
    y:           1.05,
    vx:          (Math.random() - 0.5) * 0.005,
    vy:          -(velBase + Math.random() * 0.006),
    ay:          0.00012,
    rot:         Math.random() * Math.PI * 2,
    rotVel:      (Math.random() - 0.5) * 0.05,
    size:        65 + Math.random() * 30,
    viva:        true,
  });
}

// ── DETECCIÓN DE COLISIÓN ────────────────────────────────
function verificarColisiones() {
  if (!dedoPos) return;

  const px = dedoPos.x * canvas.width;
  const py = dedoPos.y * canvas.height;

  frutas.forEach(f => {
    if (!f.viva) return;
    const fx = f.x * canvas.width;
    const fy = f.y * canvas.height;
    const dist = Math.hypot(px - fx, py - fy);

    if (dist < RADIO_COLISION * estado.sensibilidad * 1.5) {
      f.viva = false;

      if (f.esBomba) {
        if (powerups.escudo) {
          // Escudo absorbe la bomba
          desactivarPowerup('escudo');
          mostrarToast('🛡️ ¡Escudo activado! Bomba bloqueada', 'verde');
          crearParticulas(fx, fy, '💥');
          return;
        }
        terminarPartida(true);
        return;
      }

      if (f.esPowerup) {
        sonidoPowerup();
        activarPowerup(f.tipoPowerup);
        crearParticulas(fx, fy, f.emoji);
        return;
      }

      // Fruta normal
      sonidoCorte();
      estado.combo++;
      if (estado.combo > estado.comboMax) estado.comboMax = estado.combo;
      const bonus = Math.max(0, estado.combo - 1) * PUNTOS_COMBO;
      const multiplicador = powerups.multiplicador ? 2 : 1;
      estado.puntaje += (PUNTOS_FRUTA + bonus) * multiplicador;
      estado.frutasCorte++;

      // Animación de corte en dos mitades
      crearMitades(f, fx, fy);
      actualizarHUD();
      mostrarCombo();
    }
  });
}

// ── ANIMACIÓN DE CORTE EN DOS MITADES ────────────────────
/**
 * Crea dos mitades de la fruta que vuelan separadas, rotan y se desvanecen.
 * Para power-ups / bomba usamos el emoji como fallback visual.
 */
function crearMitades(fruta, fx, fy) {
  const vel = 3 + Math.random() * 2;
  const baseData = {
    img:    fruta.img ?? null,
    emoji:  fruta.emoji,
    size:   fruta.size,
    rot:    fruta.rot,
    vy:     -(2 + Math.random() * 3),
    ay:     0.2,
    alpha:  1,
  };
  // Mitad izquierda vuela hacia la izquierda y rota en sentido anti-horario
  mitades.push({ ...baseData, lado: 'izq', x: fx, y: fy, vx: -(vel + Math.random()*1.5), rotVel: -(0.07 + Math.random()*0.08) });
  // Mitad derecha vuela hacia la derecha y rota en sentido horario
  mitades.push({ ...baseData, lado: 'der', x: fx, y: fy, vx: +(vel + Math.random()*1.5), rotVel: +(0.07 + Math.random()*0.08) });
}

/** Dibuja una mitad con clip rect para el efecto de corte */
function dibujarMitad(m) {
  if (m.alpha <= 0) return;
  const s = m.size;
  const r = s / 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0, m.alpha);
  ctx.translate(m.x, m.y);
  ctx.rotate(m.rot);
  ctx.beginPath();
  if (m.lado === 'izq') {
    ctx.rect(-r, -r, r, r * 2);   // mitad izquierda
  } else {
    ctx.rect(0,  -r, r, r * 2);   // mitad derecha
  }
  ctx.clip();
  if (m.img && m.img.complete && m.img.naturalWidth > 0) {
    ctx.drawImage(m.img, -r, -r, s, s);
  } else {
    // Fallback emoji para power-ups y bomba
    ctx.font = `${s * 0.7}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.emoji, 0, 0);
  }
  ctx.restore();
}

/** @deprecated Kept only for power-ups which don’t have custom images */
function crearParticulas(x, y, emoji) {
  for (let i = 0; i < 6; i++) {
    const angulo = Math.random() * Math.PI * 2;
    const vel    = 2 + Math.random() * 3;
    efectosVisuales.push({
      x, y,
      vx: Math.cos(angulo) * vel,
      vy: Math.sin(angulo) * vel,
      vida: 1,
      emoji,
      size: 18 + Math.random() * 10,
    });
  }
}

// ── MOSTRAR COMBO ─────────────────────────────────────────
let timerCombo = null;

function mostrarCombo() {
  if (estado.combo > 1) {
    hudCombo.style.display = 'block';
    comboNum.textContent = estado.combo;
    hudCombo.style.animation = 'none';
    requestAnimationFrame(() => { hudCombo.style.animation = 'combo-pulso 0.3s ease-out'; });
    clearTimeout(timerCombo);
    timerCombo = setTimeout(() => {
      hudCombo.style.display = 'none';
      estado.combo = 0;
    }, 1500);
  }
}

// ── POWER-UPS ─────────────────────────────────────────────
function activarPowerup(tipo) {
  const def = POWERUP_DEFS[tipo];
  if (!def) return;

  // Tiempo extra: efecto instantáneo, sin duración
  if (tipo === 'reloj') {
    estado.tiempoRestante = Math.min(estado.tiempoRestante + 10, estado.modo === 'normal' ? DURACION + 20 : Infinity);
    mostrarToast(`⏰ +10 segundos`, 'verde');
    actualizarHUD();
    return;
  }

  // Escudo: dura hasta absorber 1 bomba
  if (tipo === 'escudo') {
    powerups.escudo = true;
    mostrarToast('🛡️ Escudo activado', 'morado');
    renderizarHudPowerups();
    return;
  }

  // Estrella: x2 puntos por 5s
  if (tipo === 'estrella') {
    powerups.multiplicador = true;
    mostrarToast('⭐ ×2 Puntos activado!', 'dorado');
    clearTimeout(powerups.timers.estrella);
    powerups.timers.estrella = setTimeout(() => {
      powerups.multiplicador = false;
      renderizarHudPowerups();
    }, POWERUP_DEFS.estrella.duracion);
    renderizarHudPowerups();
    return;
  }

  // Hielo: frutas lentas por 4s
  if (tipo === 'hielo') {
    powerups.hielo = true;
    mostrarToast('❄️ Frutas congeladas!', 'azul');
    // Ralentizar frutas ya en vuelo
    frutas.forEach(f => { f.vy *= 0.4; f.vx *= 0.4; });
    clearTimeout(powerups.timers.hielo);
    powerups.timers.hielo = setTimeout(() => {
      powerups.hielo = false;
      renderizarHudPowerups();
    }, POWERUP_DEFS.hielo.duracion);
    renderizarHudPowerups();
  }
}

function desactivarPowerup(tipo) {
  if (tipo === 'escudo') {
    powerups.escudo = false;
    renderizarHudPowerups();
  }
}

function renderizarHudPowerups() {
  const hud = document.getElementById('hud-powerups');
  if (!hud) return;
  hud.innerHTML = '';

  const activos = [];
  if (powerups.multiplicador) activos.push({ tipo: 'estrella' });
  if (powerups.hielo)         activos.push({ tipo: 'hielo' });
  if (powerups.escudo)        activos.push({ tipo: 'escudo' });

  activos.forEach(({ tipo }) => {
    const def = POWERUP_DEFS[tipo];
    const badge = document.createElement('div');
    badge.style.cssText = `
      display:flex; align-items:center; gap:6px;
      padding:6px 14px; border-radius:99px;
      background:rgba(6,6,15,0.85);
      border:1px solid ${def.color}55;
      font-size:0.75rem; font-weight:700;
      color:${def.color};
      text-transform:uppercase; letter-spacing:0.06em;
      animation: powerup-entrada 0.3s ease-out;
    `;
    badge.innerHTML = `<span>${def.emoji}</span><span>${def.label}</span>`;
    hud.appendChild(badge);
  });
}

// ── COUNTDOWN ─────────────────────────────────────────────
function mostrarCountdown() {
  return new Promise(resolve => {
    const overlay = document.getElementById('overlay-countdown');
    const numero  = document.getElementById('countdown-numero');
    if (!overlay || !numero) { resolve(); return; }

    overlay.style.display = 'flex';
    const pasos = ['3', '2', '1', '¡YA!'];
    let i = 0;

    // Frecuencias: 3→440Hz, 2→440Hz, 1→523Hz (C5), ¡YA!→sonidoStart
    const beepFreqs = [440, 440, 523.25, 0];

    function mostrarPaso() {
      const esYa = pasos[i] === '¡YA!';
      numero.textContent = pasos[i];
      numero.style.transform = 'scale(1.4)';
      numero.style.opacity   = '1';
      numero.style.color = esYa ? 'var(--color-fn-naranja)' : 'white';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          numero.style.transform = 'scale(1)';
        });
      });

      // Sonido del paso
      if (esYa) {
        sonidoStart();
      } else {
        sonidoBeep(beepFreqs[i], 0.25, i === 2 ? 0.5 : 0.35);
      }

      i++;
      if (i < pasos.length) {
        setTimeout(mostrarPaso, 900);
      } else {
        setTimeout(() => {
          overlay.style.display = 'none';
          resolve();
        }, 600);
      }
    }
    mostrarPaso();
  });
}

// ── TUTORIAL ──────────────────────────────────────────────
let tutorialPaso = 0;
const TUTORIAL_KEY = 'frutix_tutorial_visto';

function mostrarTutorial() {
  return new Promise(resolve => {
    const overlay = document.getElementById('overlay-tutorial');
    if (!overlay) { resolve(); return; }

    tutorialPaso = 0;
    actualizarPasoTutorial();
    overlay.style.display = 'flex';

    const btnNext  = document.getElementById('tutorial-next');
    const btnPrev  = document.getElementById('tutorial-prev');
    const btnSkip  = document.getElementById('tutorial-skip');

    function cerrarTutorial() {
      overlay.style.display = 'none';
      localStorage.setItem(TUTORIAL_KEY, '1');
      resolve();
    }

    btnNext.onclick = () => {
      if (tutorialPaso < 2) {
        tutorialPaso++;
        actualizarPasoTutorial();
      } else {
        cerrarTutorial();
      }
    };

    btnPrev.onclick = () => {
      if (tutorialPaso > 0) {
        tutorialPaso--;
        actualizarPasoTutorial();
      }
    };

    btnSkip.onclick = cerrarTutorial;
  });
}

function actualizarPasoTutorial() {
  document.querySelectorAll('.tutorial-paso').forEach(el => {
    el.style.display = el.dataset.paso === String(tutorialPaso) ? 'block' : 'none';
  });
  document.querySelectorAll('.tutorial-dot').forEach(el => {
    el.classList.toggle('activo', el.dataset.dot === String(tutorialPaso));
  });
  const btnNext = document.getElementById('tutorial-next');
  const btnPrev = document.getElementById('tutorial-prev');
  if (btnNext) btnNext.textContent = tutorialPaso === 2 ? '¡Jugar! →' : 'Siguiente →';
  if (btnPrev) btnPrev.style.display = tutorialPaso > 0 ? 'inline-flex' : 'none';
}

// ── HUD ──────────────────────────────────────────────────
function actualizarHUD() {
  if (hudPuntaje) hudPuntaje.textContent = estado.puntaje.toLocaleString();
  if (hudTiempo)  hudTiempo.textContent  = Math.max(0, Math.ceil(estado.tiempoRestante));
}

// ── TIMER DE PARTIDA ─────────────────────────────────────
let ultimoTick = null;

function tickTimer(timestamp) {
  if (!estado.activo || estado.pausado) {
    ultimoTick = null;
    return;
  }
  if (!ultimoTick) ultimoTick = timestamp;
  const delta = (timestamp - ultimoTick) / 1000;
  ultimoTick = timestamp;

  if (estado.modo === 'normal') {
    estado.tiempoRestante -= delta;
    if (estado.tiempoRestante <= 0) {
      estado.tiempoRestante = 0;
      actualizarHUD();
      terminarPartida(false);
      return;
    }
  }
  actualizarHUD();
}

// ── GAME LOOP ─────────────────────────────────────────────
function gameLoop(timestamp) {
  if (!estado.activo) return;

  // Timer
  tickTimer(timestamp);

  // Fondo
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fondo degradado
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#06060f');
  grad.addColorStop(1, '#0d0d1a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Efecto de Hielo (Frost Overlay)
  if (powerups.hielo) {
    ctx.fillStyle = 'rgba(96, 165, 250, 0.15)'; // Azul claro transparente
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!estado.pausado) {
    // Spawn aleatorio
    if (Math.random() < 0.018) spawnFruta();

    // Actualizar frutas
    frutas.forEach(f => {
      if (!f.viva) return;
      f.x  += f.vx;
      f.y  += f.vy;
      f.vy += f.ay;
      f.rot += f.rotVel;
    });

    // Limpiar frutas fuera del canvas
    frutas = frutas.filter(f => f.viva && f.y < 1.3);

    // Verificar colisiones
    verificarColisiones();
  }

  // Dibujar frutas (imágenes 2D)
  frutas.forEach(f => {
    if (!f.viva) return;
    const fx = f.x * canvas.width;
    const fy = f.y * canvas.height;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(f.rot);
    if (f.img && f.img.complete && f.img.naturalWidth > 0) {
      ctx.drawImage(f.img, -f.size / 2, -f.size / 2, f.size, f.size);
    } else {
      // Fallback emoji para power-ups y bomba
      ctx.font = `${f.size * 0.7}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.emoji, 0, 0);
    }
    ctx.restore();
  });

  // Mitades cortadas (animación split en 2)
  if (estado.efectos) {
    mitades.forEach(m => {
      m.x    += m.vx;
      m.y    += m.vy;
      m.vy   += m.ay;
      m.rot  += m.rotVel;
      m.alpha -= 0.025;
      dibujarMitad(m);
    });
    mitades = mitades.filter(m => m.alpha > 0 && m.y < canvas.height + 150);

    // Partículas (y texto de powerups)
    efectosVisuales.forEach(p => {
      p.x    += p.vx;
      p.y    += p.vy;
      p.vy   += 0.15;
      p.vida -= 0.04;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.vida);
      ctx.font = `bold ${p.size}px "Inter", sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      if (p.texto) {
        ctx.fillStyle = p.color || 'white';
        ctx.fillText(p.texto, p.x, p.y);
      } else if (p.emoji) {
        ctx.font = `${p.size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.fillText(p.emoji, p.x, p.y);
      }
      ctx.restore();
    });
    efectosVisuales = efectosVisuales.filter(p => p.vida > 0);
  }

  // Estela del dedo
  if (dedoPos) {
    const px = dedoPos.x * canvas.width;
    const py = dedoPos.y * canvas.height;

    estela.push({ x: px, y: py });
    if (estela.length > 14) estela.shift();

    if (estela.length > 1) {
      ctx.save();
      for (let i = 1; i < estela.length; i++) {
        const alpha = (i / estela.length) * 0.8;
        const width = (i / estela.length) * 5;
        ctx.strokeStyle = `rgba(249,115,22,${alpha})`;
        ctx.lineWidth   = width;
        ctx.lineCap     = 'round';
        ctx.shadowBlur  = 12;
        ctx.shadowColor = 'rgba(249,115,22,0.6)';
        ctx.beginPath();
        ctx.moveTo(estela[i - 1].x, estela[i - 1].y);
        ctx.lineTo(estela[i].x, estela[i].y);
        ctx.stroke();
      }
      ctx.restore();

      // Punto del dedo
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(249,115,22,0.9)';
      ctx.shadowBlur  = 20;
      ctx.shadowColor = 'rgba(249,115,22,1)';
      ctx.fill();
      ctx.restore();

      // Efecto de Escudo (Anillo protector)
      if (powerups.escudo) {
        const pulse = 1 + Math.sin(timestamp * 0.005) * 0.1;
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 35 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.8)';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgba(192, 132, 252, 1)';
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(px, py, 35 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(192, 132, 252, 0.2)';
        ctx.fill();
        ctx.restore();
      }

      // Efecto Estrella (Aura dorada)
      if (powerups.multiplicador) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 25, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -timestamp * 0.05;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  requestAnimationFrame(gameLoop);
}

// ── INICIAR PARTIDA ───────────────────────────────────────
function iniciarPartida() {
  // Silenciar la música de fondo al comenzar la partida
  silenciarMusica();

  estado.activo          = true;
  estado.pausado         = false;
  estado.puntaje         = 0;
  estado.combo           = 0;
  estado.comboMax        = 0;
  estado.frutasCorte     = 0;
  estado.tiempoRestante  = DURACION;
  frutas                 = [];
  mitades                = [];
  efectosVisuales        = [];
  estela                 = [];
  ultimoTick             = null;

  // Limpiar power-ups anteriores
  Object.values(powerups.timers).forEach(t => clearTimeout(t));
  powerups.multiplicador = false;
  powerups.hielo         = false;
  powerups.escudo        = false;
  powerups.timers        = {};
  renderizarHudPowerups();

  if (finPanel)   finPanel.classList.remove('visible');
  if (pausaOverlay) pausaOverlay.style.display = 'none';

  actualizarHUD();
  requestAnimationFrame(gameLoop);
}

// ── TERMINAR PARTIDA ──────────────────────────────────────
async function terminarPartida(esBomba = false) {
  estado.activo = false;

  // Sonido de fin
  if (esBomba) mostrarToast('💣 ¡Tocaste una bomba!', 'naranja');

  // Mostrar pantalla de fin
  if (finPuntaje) finPuntaje.textContent = estado.puntaje.toLocaleString();
  if (finCombo)   finCombo.textContent   = `x${estado.comboMax}`;
  if (finFrutas)  finFrutas.textContent  = estado.frutasCorte;
  const xp = Math.floor(estado.puntaje * 0.1 + estado.comboMax * 5);
  if (finXp) finXp.textContent = `+${xp}`;
  document.getElementById('fin-emoji').textContent = esBomba ? '💣' : '🏆';

  if (finGuardando) finGuardando.style.display = 'flex';
  if (finGuardado)  finGuardado.style.display  = 'none';
  if (finError)     finError.style.display     = 'none';

  if (finPanel) finPanel.classList.add('visible');

  // Guardar puntaje vía middleware
  if (!modoInvitado && usuario) {
    try {
      await procesarPartida({
        userId:         usuario.id,
        nombreJugador:  nombreJugador,
        puntos:         estado.puntaje,
        comboMaximo:    estado.comboMax,
        frutasCortadas: estado.frutasCorte,
        duracionSegundos: DURACION - Math.max(0, estado.tiempoRestante),
      });
      if (finGuardando) finGuardando.style.display = 'none';
      if (finGuardado)  finGuardado.style.display  = 'block';
    } catch (e) {
      if (finGuardando) finGuardando.style.display = 'none';
      if (finError)     finError.style.display     = 'block';
      console.error('[Dojo] Error al guardar:', e.message);
    }
  } else {
    if (finGuardando) finGuardando.style.display = 'none';
    if (finError) {
      finError.textContent = '👤 Modo invitado: puntaje no guardado.';
      finError.style.display = 'block';
    }
  }
}

// ── TOASTS ───────────────────────────────────────────────
function mostrarToast(msg, tipo = '') {
  if (!toastContainer) return;
  const t = document.createElement('div');
  t.className = `toast ${tipo ? 'toast--' + tipo : ''}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 3100);
}

// ── CONTROLES ────────────────────────────────────────────
document.getElementById('btn-config')?.addEventListener('click', () => {
  configPanel.classList.toggle('abierto');
});

document.getElementById('btn-cerrar-config')?.addEventListener('click', () => {
  configPanel.classList.remove('abierto');
});

document.getElementById('btn-pausar')?.addEventListener('click', () => {
  if (!estado.activo) return;
  estado.pausado = !estado.pausado;
  document.getElementById('btn-pausar').textContent = estado.pausado ? '▶' : '⏸';
  if (pausaOverlay) pausaOverlay.style.display = estado.pausado ? 'flex' : 'none';
});

document.getElementById('btn-reanudar')?.addEventListener('click', () => {
  estado.pausado = false;
  document.getElementById('btn-pausar').textContent = '⏸';
  if (pausaOverlay) pausaOverlay.style.display = 'none';
  ultimoTick = null;
  requestAnimationFrame(gameLoop);
});

document.getElementById('btn-reintentar')?.addEventListener('click', async () => {
  await mostrarCountdown();
  iniciarPartida();
});

document.getElementById('btn-cerrar-sesion')?.addEventListener('click', () => {
  if (modoInvitado) {
    localStorage.removeItem('fn_modo_invitado');
    localStorage.removeItem('fn_invitado_id');
    localStorage.removeItem('fn_invitado_nombre');
    window.location.href = '/index.html';
  } else {
    cerrarSesion();
  }
});

// Config: sensibilidad
const sliderSens = document.getElementById('slider-sensibilidad');
sliderSens?.addEventListener('input', () => {
  estado.sensibilidad = sliderSens.value / 100;
  const el = document.getElementById('val-sensibilidad');
  if (el) el.textContent = `${sliderSens.value}%`;
});

// Config: toggles
document.getElementById('toggle-sonido')?.addEventListener('click', function () {
  this.classList.toggle('activo');
  estado.sonido = this.classList.contains('activo');
});

document.getElementById('toggle-efectos')?.addEventListener('click', function () {
  this.classList.toggle('activo');
  estado.efectos = this.classList.contains('activo');
});

// Config: modo de juego
document.querySelectorAll('.modo-opcion').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.modo-opcion').forEach(m => m.classList.remove('activo'));
    el.classList.add('activo');
    estado.modo = el.dataset.modo;
  });
});

// Config: fuente deteccion
document.getElementById('select-camara')?.addEventListener('change', (e) => {
  estado.fuenteDeteccion = e.target.value;
  if (estado.fuenteDeteccion === 'local' && !handLandmarker) {
    inicializarMediaPipeLocal();
  } else if (estado.fuenteDeteccion === 'ws') {
    conectarWS();
  }
});

// ── LOBBY ─────────────────────────────────────────────────
const overlayLobby   = document.getElementById('overlay-lobby');
const lobbyCargando  = document.getElementById('lobby-cargando');
const lobbyNombre    = document.getElementById('lobby-nombre');
const btnComenzar    = document.getElementById('btn-comenzar');

/**
 * Resuelve la sesión del usuario.
 * - Modo invitado: lee localStorage.
 * - Confirmación de correo (llega con ?code= o #access_token): espera el evento
 *   SIGNED_IN del SDK antes de leer la sesión, para evitar la condición de
 *   carrera mientras Supabase canjea el token del enlace.
 * - Sesión existente: lee directamente con getSession().
 */
async function resolverSesion() {
  modoInvitado = localStorage.getItem('fn_modo_invitado') === 'true';

  if (modoInvitado) {
    nombreJugador = localStorage.getItem('fn_invitado_nombre') ?? 'Invitado';
    return true;
  }

  const params = new URLSearchParams(window.location.search);

  // Redirigir errores de autenticación al login con mensaje
  if (params.has('error')) {
    const desc = encodeURIComponent(params.get('error_description') || 'Error desconocido');
    window.location.href = `/login.html?error=true&error_description=${desc}`;
    return false;
  }

  // Si viene con ?code= (o #access_token), Supabase todavía está canjeando el
  // token del enlace de confirmación. Esperamos el evento SIGNED_IN para seguir.
  const tieneCode = params.has('code') || window.location.hash.includes('access_token');

  if (tieneCode) {
    try {
      await new Promise((resolve, reject) => {
        const TIMEOUT_MS = 8000;
        const tid = setTimeout(() => {
          sub.unsubscribe();
          reject(new Error('Tiempo de espera agotado al confirmar la sesión.'));
        }, TIMEOUT_MS);

        const { data: { subscription: sub } } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
            clearTimeout(tid);
            sub.unsubscribe();
            resolve(session);
          }
        });
      });
    } catch (err) {
      console.error('[Dojo] Error al resolver la sesión:', err.message);
      window.location.href = `/login.html?error=true&error_description=${encodeURIComponent(err.message)}`;
      return false;
    }
    // Limpiar los parámetros de la URL para que una recarga no re-procese el código
    history.replaceState(null, '', window.location.pathname);
  }

  // Leer sesión ya establecida
  const { data: { session }, error: sesionError } = await supabase.auth.getSession();
  if (sesionError) {
    console.error('[Dojo] Error getSession:', sesionError.message);
    return false;
  }
  if (!session) {
    console.warn('[Dojo] No hay sesión activa.');
    return false;
  }

  // Obtener datos del usuario y garantizar su perfil en la BD
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    console.error('[Dojo] No se pudo obtener usuario:', userError?.message);
    return false;
  }

  usuario = user;
  const perfil = await garantizarPerfil(usuario);
  nombreJugador = perfil?.nombre_jugador
                ?? usuario.user_metadata?.full_name
                ?? usuario.user_metadata?.name
                ?? usuario.email?.split('@')[0]
                ?? 'Ninja';
  if (hudJugador) hudJugador.textContent = nombreJugador;
  return true;
}

function mostrarLobby(nombre) {
  if (lobbyNombre) lobbyNombre.textContent = nombre;
  if (lobbyCargando) lobbyCargando.style.display = 'none';
  if (btnComenzar) btnComenzar.style.display = 'block';
}

function ocultarLobby() {
  if (!overlayLobby) return;
  overlayLobby.style.opacity = '0';
  overlayLobby.style.transition = 'opacity 0.4s ease';
  setTimeout(() => { overlayLobby.style.display = 'none'; }, 400);
}

// ── ARRANQUE ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  conectarWS();
  iniciarCamara();

  let autenticado = false;
  try {
    autenticado = await resolverSesion();
  } catch (err) {
    console.error('[Dojo] Error inesperado en arranque:', err);
    autenticado = false;
  }

  if (!autenticado) {
    window.location.href = '/login.html';
    return;
  }

  mostrarLobby(nombreJugador);

  btnComenzar?.addEventListener('click', async () => {
    ocultarLobby();
    // Tutorial en primera sesión
    if (!localStorage.getItem(TUTORIAL_KEY)) {
      await mostrarTutorial();
    }
    await mostrarCountdown();
    iniciarPartida();
  });
});
