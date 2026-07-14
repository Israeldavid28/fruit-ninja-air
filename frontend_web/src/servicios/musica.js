/**
 * musica.js — Música de fondo compartida entre páginas
 *
 * - Reproduce "Malie City (Night)" en bucle a bajo volumen.
 * - Añade un botón flotante para silenciar / reactivar la música.
 * - Recuerda la preferencia de silencio (localStorage) y la posición
 *   de reproducción (sessionStorage) para continuar al navegar entre páginas.
 * - Expone silenciarMusica() para apagarla cuando inicia una partida.
 */

const SRC            = '/musica-fondo.mp3';
const KEY_SILENCIADA = 'frutix_musica_silenciada';
const KEY_TIEMPO     = 'frutix_musica_tiempo';
const VOLUMEN        = 0.35;

let audio      = null;
let boton      = null;
let silenciada = localStorage.getItem(KEY_SILENCIADA) === 'true';

function crearAudio() {
  audio = new Audio(SRC);
  audio.loop    = true;
  audio.volume  = VOLUMEN;
  audio.preload = 'auto';

  // Reanudar cerca de donde quedó al cambiar de página
  const t = parseFloat(sessionStorage.getItem(KEY_TIEMPO) || '0');
  if (t > 0) {
    audio.addEventListener('loadedmetadata', () => {
      if (t < audio.duration) audio.currentTime = t;
    }, { once: true });
  }
  audio.addEventListener('timeupdate', () => {
    sessionStorage.setItem(KEY_TIEMPO, String(audio.currentTime));
  });
}

function intentarReproducir() {
  if (silenciada) return;
  audio.play().catch(() => {
    // Los navegadores bloquean el autoplay con sonido: esperamos
    // el primer gesto del usuario para arrancar la música.
    const arranque = () => {
      if (!silenciada) audio.play().catch(() => {});
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
      window.addEventListener(ev, arranque, { once: true }));
  });
}

function actualizarBoton() {
  if (!boton) return;
  boton.textContent = silenciada ? '🔇' : '🔊';
  boton.title = silenciada ? 'Activar música' : 'Silenciar música';
  boton.setAttribute('aria-label', boton.title);
}

function alternar() {
  silenciada = !silenciada;
  localStorage.setItem(KEY_SILENCIADA, String(silenciada));
  if (silenciada) audio.pause();
  else            intentarReproducir();
  actualizarBoton();
}

function crearBoton() {
  boton = document.createElement('button');
  boton.id = 'btn-musica';
  boton.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 9999;
    width: 48px; height: 48px; border-radius: 50%;
    border: 1px solid rgba(249,115,22,0.4);
    background: rgba(6,6,15,0.85); color: #f97316;
    font-size: 1.3rem; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(6px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    transition: transform 0.15s ease;`;
  boton.addEventListener('click', alternar);
  boton.addEventListener('mouseenter', () => { boton.style.transform = 'scale(1.1)'; });
  boton.addEventListener('mouseleave', () => { boton.style.transform = 'scale(1)'; });
  document.body.appendChild(boton);
  actualizarBoton();
}

/** Silencia la música (p. ej. al iniciar una partida). */
export function silenciarMusica() {
  if (silenciada) return;
  silenciada = true;
  localStorage.setItem(KEY_SILENCIADA, 'true');
  if (audio) audio.pause();
  actualizarBoton();
}

/** Inicializa la música de fondo y su botón. Idempotente. */
export function iniciarMusicaFondo() {
  if (audio) return;
  crearAudio();
  if (document.body) crearBoton();
  else document.addEventListener('DOMContentLoaded', crearBoton, { once: true });
  intentarReproducir();
}

// Auto-inicializar al importar el módulo.
iniciarMusicaFondo();
