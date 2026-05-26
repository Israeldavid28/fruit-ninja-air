/**
 * dojo.js — Motor del juego Frutix
 * Canvas 2D + WebSocket MediaPipe + Lógica de frutas + Anti-Cheat
 */
import { obtenerUsuario, obtenerSesion, esperarSesion, cerrarSesion, garantizarPerfil } from '../servicios/supabase.js';
import { procesarPartida } from '../servicios/middleware.js';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// ── CONSTANTES ───────────────────────────────────────────
const WS_URL      = 'ws://localhost:8000/ws';
const DURACION    = 60;        // segundos
const FRUTAS_DEF  = ['🍎','🍊','🍋','🍇','🍓','🍉','🥝','🍑'];
const PUNTOS_FRUTA = 10;
const PUNTOS_COMBO = 5;        // bonus por combo
const RADIO_COLISION = 40;     // px

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
let efectosVisuales = [];  // partículas de corte
let estela = [];           // rastro del dedo

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
  const espirado = Math.random() < 0.08; // 8% probabilidad de bomba
  frutas.push({
    id:     Math.random(),
    emoji:  espirado ? '💣' : FRUTAS_DEF[Math.floor(Math.random() * FRUTAS_DEF.length)],
    esBomba: espirado,
    x:      0.1 + Math.random() * 0.8,       // 10%-90% del ancho
    y:      1.05,                              // empieza abajo
    vx:     (Math.random() - 0.5) * 0.005,
    vy:     -(0.008 + Math.random() * 0.006), // velocidad hacia arriba
    ay:     0.00012,                           // gravedad
    rot:    Math.random() * Math.PI * 2,
    rotVel: (Math.random() - 0.5) * 0.08,
    size:   45 + Math.random() * 25,
    viva:   true,
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
        terminarPartida(true); // BOMBA
        return;
      }

      // Puntaje + combo
      estado.combo++;
      if (estado.combo > estado.comboMax) estado.comboMax = estado.combo;
      const bonus = Math.max(0, estado.combo - 1) * PUNTOS_COMBO;
      estado.puntaje += PUNTOS_FRUTA + bonus;
      estado.frutasCorte++;

      // Efectos
      crearParticulas(fx, fy, f.emoji);
      actualizarHUD();
      mostrarCombo();
    }
  });
}

// ── PARTÍCULAS DE CORTE ──────────────────────────────────
function crearParticulas(x, y, emoji) {
  for (let i = 0; i < 8; i++) {
    const angulo = Math.random() * Math.PI * 2;
    const vel    = 2 + Math.random() * 4;
    efectosVisuales.push({
      x, y,
      vx:    Math.cos(angulo) * vel,
      vy:    Math.sin(angulo) * vel,
      vida:  1,
      emoji: emoji,
      size:  16 + Math.random() * 10,
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

  // Dibujar frutas
  frutas.forEach(f => {
    if (!f.viva) return;
    const fx = f.x * canvas.width;
    const fy = f.y * canvas.height;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(f.rot);
    ctx.font = `${f.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.emoji, 0, 0);
    ctx.restore();
  });

  // Partículas
  if (estado.efectos) {
    efectosVisuales.forEach((p, i) => {
      p.x    += p.vx;
      p.y    += p.vy;
      p.vy   += 0.15;
      p.vida -= 0.04;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.vida);
      ctx.font = `${p.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, p.x, p.y);
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
    }
  }

  requestAnimationFrame(gameLoop);
}

// ── INICIAR PARTIDA ───────────────────────────────────────
function iniciarPartida() {
  estado.activo          = true;
  estado.pausado         = false;
  estado.puntaje         = 0;
  estado.combo           = 0;
  estado.comboMax        = 0;
  estado.frutasCorte     = 0;
  estado.tiempoRestante  = DURACION;
  frutas                 = [];
  efectosVisuales        = [];
  estela                 = [];
  ultimoTick             = null;

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

document.getElementById('btn-reintentar')?.addEventListener('click', iniciarPartida);

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

async function resolverSesion() {
  modoInvitado = localStorage.getItem('fn_modo_invitado') === 'true';

  if (modoInvitado) {
    nombreJugador = localStorage.getItem('fn_invitado_nombre') ?? 'Invitado';
    return true;
  }

  // Si hay error de OAuth, Supabase lo pasa en la URL
  const params = new URLSearchParams(window.location.search);
  if (params.has('error')) {
    window.location.href = `/login.html?error=true&error_description=${encodeURIComponent(params.get('error_description') || 'Error desconocido')}`;
    return false;
  }

  // Si hay ?code= en la URL, Supabase necesita intercambiar el código primero.
  // esperarSesion() escucha onAuthStateChange y resuelve en cuanto el SDK termina.
  const tieneCode = params.has('code')
                 || window.location.hash.includes('access_token');

  let sesion;
  if (tieneCode) {
    sesion = await esperarSesion();
    // Limpiar los parámetros OAuth de la URL sin recargar
    history.replaceState(null, '', window.location.pathname);
  } else {
    sesion = await obtenerSesion();
  }

  if (!sesion) return false;

  usuario = await obtenerUsuario();
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
  lobbyNombre.textContent = nombre;
  lobbyCargando.style.display = 'none';
  btnComenzar.style.display = 'block';
}

function ocultarLobby() {
  overlayLobby.style.opacity = '0';
  overlayLobby.style.transition = 'opacity 0.4s ease';
  setTimeout(() => { overlayLobby.style.display = 'none'; }, 400);
}

// ── ARRANQUE ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  conectarWS();
  iniciarCamara();

  let autenticado;
  try {
    autenticado = await resolverSesion();
  } catch {
    autenticado = false;
  }

  if (!autenticado) {
    window.location.href = '/login.html';
    return;
  }

  mostrarLobby(nombreJugador);

  btnComenzar.addEventListener('click', () => {
    ocultarLobby();
    iniciarPartida();
  });
});
