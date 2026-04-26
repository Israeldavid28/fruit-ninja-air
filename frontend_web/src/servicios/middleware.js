/**
 * middleware.js — Comunicación con el API Python de Fruit Ninja Air
 * El middleware valida puntajes con Anti-Cheat antes de guardarlos.
 */

const API_BASE = '/api';

/**
 * Envía el resultado de una partida al middleware para validación y guardado.
 * @param {object} datos - { userId, nombreJugador, puntos, comboMaximo, frutasCortadas, duracionSegundos }
 */
export async function procesarPartida(datos) {
  const res = await fetch(`${API_BASE}/procesar-partida`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(datos),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Error desconocido' }));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }

  return res.json();
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
