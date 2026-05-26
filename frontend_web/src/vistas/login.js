/**
 * login.js — Manejo de autenticación en Frutix
 */
import { loginConGoogle, loginConDiscord, obtenerSesion } from '../servicios/supabase.js';

const btnGoogle   = document.getElementById('btn-google');
const btnDiscord  = document.getElementById('btn-discord');
const btnInvitado = document.getElementById('btn-invitado');
const msgError    = document.getElementById('mensaje-error');
const elCargando  = document.getElementById('cargando');

function mostrarError(msg) {
  if (!msgError) return;
  msgError.textContent = msg;
  msgError.style.display = 'block';
}

function mostrarCargando(si) {
  if (elCargando)  elCargando.style.display  = si ? 'block' : 'none';
  if (btnGoogle)   btnGoogle.disabled  = si;
  if (btnDiscord)  btnDiscord.disabled = si;
}

// Si ya hay sesión activa → ir al dojo
async function verificarSesionExistente() {
  mostrarCargando(true);
  try {
    const sesion = await obtenerSesion();
    if (sesion) {
      window.location.href = '/dojo.html';
      return;
    }
  } catch { /* sin sesión */ }
  mostrarCargando(false);
}

// Google
btnGoogle?.addEventListener('click', async () => {
  msgError.style.display = 'none';
  try {
    mostrarCargando(true);
    await loginConGoogle();
    // La redirección la maneja Supabase OAuth
  } catch (err) {
    mostrarCargando(false);
    mostrarError(`Error al iniciar con Google: ${err.message}`);
  }
});

// Discord
btnDiscord?.addEventListener('click', async () => {
  msgError.style.display = 'none';
  try {
    mostrarCargando(true);
    await loginConDiscord();
  } catch (err) {
    mostrarCargando(false);
    mostrarError(`Error al iniciar con Discord: ${err.message}`);
  }
});

// Invitado
btnInvitado?.addEventListener('click', () => {
  // Guarda un perfil temporal en localStorage
  const invitadoId = `invitado_${Date.now()}`;
  localStorage.setItem('fn_modo_invitado', 'true');
  localStorage.setItem('fn_invitado_id', invitadoId);
  localStorage.setItem('fn_invitado_nombre', `Ninja${Math.floor(Math.random() * 9999)}`);
  window.location.href = '/dojo.html';
});

// ── INICIALIZAR ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  verificarSesionExistente();
});
