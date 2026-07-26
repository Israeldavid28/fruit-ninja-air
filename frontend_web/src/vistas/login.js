/**
 * login.js — Manejo de autenticación en Frutix
 */
import { loginConEmail, registrarConEmail, obtenerSesion } from '../servicios/supabase.js';
import '../servicios/musica.js';

const btnInvitado = document.getElementById('btn-invitado');
const msgError    = document.getElementById('mensaje-error');
const msgAviso    = document.getElementById('mensaje-aviso');
const elCargando  = document.getElementById('cargando');

const formEmail   = document.getElementById('form-email');
const btnEmail    = document.getElementById('btn-email');
const campoNombre = document.getElementById('campo-nombre');
const inputNombre = document.getElementById('input-nombre');
const inputEmail  = document.getElementById('input-email');
const inputPass   = document.getElementById('input-password');

/** 'entrar' | 'registro' */
let modo = 'entrar';

// ── MENSAJES ──────────────────────────────────────────────
function limpiarMensajes() {
  if (msgError) msgError.style.display = 'none';
  if (msgAviso) msgAviso.style.display = 'none';
}

function mostrarError(msg) {
  if (!msgError) return;
  limpiarMensajes();
  msgError.textContent = msg;
  msgError.style.display = 'block';
}

function mostrarAviso(msg) {
  if (!msgAviso) return;
  limpiarMensajes();
  msgAviso.textContent = msg;
  msgAviso.style.display = 'block';
}

function mostrarCargando(si) {
  if (elCargando)  elCargando.style.display = si ? 'block' : 'none';
  if (btnEmail)    btnEmail.disabled = si;
  [inputNombre, inputEmail, inputPass].forEach(el => { if (el) el.disabled = si; });
}

/**
 * Supabase devuelve los errores de auth en inglés. Los traducimos a mensajes
 * que el jugador entienda, dejando el original como respaldo si aparece uno
 * que todavía no contemplamos.
 */
function traducirError(mensaje = '') {
  const m = mensaje.toLowerCase();
  if (m.includes('invalid login credentials'))   return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed'))         return 'Debes confirmar tu correo antes de entrar. Revisa tu bandeja de entrada.';
  if (m.includes('user already registered') ||
      m.includes('already been registered'))     return 'Ese correo ya está registrado. Cambia a "Entrar" para iniciar sesión.';
  if (m.includes('password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (m.includes('unable to validate email') ||
      m.includes('invalid format'))              return 'El correo no tiene un formato válido.';
  if (m.includes('email rate limit') ||
      m.includes('over_email_send_rate_limit'))  return 'Demasiados intentos seguidos. Espera un momento e inténtalo de nuevo.';
  if (m.includes('signups not allowed') ||
      m.includes('signup is disabled'))          return 'El registro está desactivado en el servidor. Actívalo en Supabase → Authentication → Providers → Email.';
  return mensaje || 'No se pudo completar la operación. Inténtalo de nuevo.';
}

// ── CAMBIO ENTRE ENTRAR Y REGISTRO ────────────────────────
function cambiarModo(nuevo) {
  modo = nuevo;
  limpiarMensajes();

  document.querySelectorAll('.auth-tab').forEach(tab => {
    const activo = tab.dataset.modo === nuevo;
    tab.classList.toggle('activo', activo);
    tab.setAttribute('aria-selected', String(activo));
  });

  const esRegistro = nuevo === 'registro';
  if (campoNombre) campoNombre.style.display = esRegistro ? 'flex' : 'none';
  if (btnEmail)    btnEmail.textContent = esRegistro ? '🥷 Crear mi cuenta' : '⚔️ Entrar al Dojo';
  // Ayuda al gestor de contraseñas a distinguir alta de inicio de sesión
  if (inputPass)   inputPass.autocomplete = esRegistro ? 'new-password' : 'current-password';
}

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => cambiarModo(tab.dataset.modo));
});

// ── ENVÍO DEL FORMULARIO ──────────────────────────────────
formEmail?.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarMensajes();

  const email  = inputEmail?.value.trim() ?? '';
  const pass   = inputPass?.value ?? '';
  const nombre = inputNombre?.value.trim() ?? '';

  if (!email || !pass) {
    mostrarError('Completa tu correo y contraseña.');
    return;
  }
  if (pass.length < 6) {
    mostrarError('La contraseña debe tener al menos 6 caracteres.');
    return;
  }

  mostrarCargando(true);
  try {
    if (modo === 'registro') {
      // Si no escribe nombre, usamos la parte anterior a la @ del correo
      const nombreJugador = nombre || email.split('@')[0];
      const { session } = await registrarConEmail(email, pass, nombreJugador);

      if (!session) {
        // El proyecto tiene activada la confirmación por correo
        mostrarCargando(false);
        mostrarAviso('¡Cuenta creada! Revisa tu correo y confirma tu cuenta para poder entrar.');
        return;
      }
    } else {
      await loginConEmail(email, pass);
    }

    window.location.href = '/dojo.html';
  } catch (err) {
    mostrarCargando(false);
    mostrarError(traducirError(err?.message));
  }
});

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
  const params = new URLSearchParams(window.location.search);
  const errorDesc = params.get('error_description');
  if (errorDesc) {
    // params.get() ya decodifica una vez. Supabase a veces codifica dos veces,
    // así que intentamos una segunda pasada, pero sin romper el mensaje si el
    // texto trae un '%' suelto (decodeURIComponent lanzaría URIError).
    let texto = errorDesc;
    try { texto = decodeURIComponent(errorDesc); } catch { /* ya estaba plano */ }

    // Si venimos de un fallo de auth (ej: desde dojo.html o la landing)
    mostrarError(`No se pudo completar el inicio de sesión: ${texto}`);
    // Limpiar la URL para que no siga saliendo el error al recargar
    window.history.replaceState(null, '', window.location.pathname);
  }

  verificarSesionExistente();
});
