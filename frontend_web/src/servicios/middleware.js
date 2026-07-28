/**
 * middleware.js — Comunicación con el API Python de Frutix
 * El middleware valida puntajes con Anti-Cheat antes de guardarlos.
 */

// El router del backend se monta bajo /api/usuarios (ver api/index.py)
const API_BASE = '/api/usuarios';

/**
 * Envía el resultado de una partida al middleware para validación y guardado.
 * @param {object} datos - { userId, nombreJugador, puntos, comboMaximo, frutasCortadas, duracionSegundos }
 */
export async function procesarPartida(datos) {
  // El backend (Pydantic) exige snake_case; el frontend usa camelCase.
  // Sin este mapeo, FastAPI devuelve 422 y el error salía como "[object Object]".
  const payload = {
    user_id:         datos.userId,
    nombre_jugador:  datos.nombreJugador,
    puntos:          datos.puntos,
    combo_maximo:    datos.comboMaximo,
    tiempo_segundos: datos.duracionSegundos,
  };

  const res = await fetch(`${API_BASE}/procesar-partida`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(mensajeDeError(err, res.status));
  }

  return res.json();
}

// Normaliza el "detail" de FastAPI (string, objeto, o lista de errores de
// validación) a un mensaje legible, en vez de mostrar "[object Object]".
function mensajeDeError(err, status) {
  const d = err?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d))      return d.map(e => e?.msg || JSON.stringify(e)).join('; ');
  if (d && typeof d === 'object') return JSON.stringify(d);
  return `HTTP ${status}`;
}

/**
 * Obtiene el ranking directamente desde el middleware (incluye anti-cheat cache).
 */
export async function obtenerRankingAPI(limite = 10) {
  const res = await fetch(`${API_BASE}/leaderboard?limite=${limite}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Obtiene o crea el perfil del usuario vía middleware.
 */
export async function sincronizarPerfil(userId, displayName, avatarUrl) {
  const res = await fetch(`${API_BASE}/perfil`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ user_id: userId, display_name: displayName, avatar_url: avatarUrl }),
  });
  if (!res.ok) return null;
  return res.json();
}
