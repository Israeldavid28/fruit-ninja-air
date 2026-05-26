/**
 * supabase.js — Cliente Supabase para Frutix
 * Gestiona autenticación y acceso a datos.
 */
import { createClient } from '@supabase/supabase-js';

// Las variables VITE_ son inyectadas por Vite en build time y en dev
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('[Supabase] ⚠️ Variables de entorno faltantes. Revisa frontend_web/.env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── AUTH ─────────────────────────────────────────────────

export async function loginConGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/dojo.html` },
  });
  if (error) throw error;
}

export async function loginConDiscord() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: `${window.location.origin}/dojo.html` },
  });
  if (error) throw error;
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
}

export async function obtenerSesion() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Espera hasta que Supabase resuelva el estado de auth (útil después del callback OAuth) */
export function esperarSesion() {
  return new Promise((resolve) => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      subscription.unsubscribe();
      resolve(session);
    });
  });
}

export async function obtenerUsuario() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// ── PERFILES ─────────────────────────────────────────────

export async function obtenerPerfil(userId) {
  const { data, error } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function crearOActualizarPerfil(userId, datos) {
  const { data, error } = await supabase
    .from('perfiles')
    .upsert({ id: userId, ...datos, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Garantiza que exista un perfil para el usuario autenticado.
 * Se llama en cada login — es seguro ejecutarlo siempre gracias al ON CONFLICT DO UPDATE.
 * Devuelve el perfil (nuevo o existente).
 */
export async function garantizarPerfil(user) {
  const nombreGoogle = user.user_metadata?.full_name
                    ?? user.user_metadata?.name
                    ?? user.email?.split('@')[0]
                    ?? 'Ninja';

  const { data, error } = await supabase
    .from('perfiles')
    .upsert(
      {
        id:              user.id,
        email:           user.email,
        nombre_jugador:  nombreGoogle,
        updated_at:      new Date().toISOString(),
      },
      {
        onConflict:      'id',
        ignoreDuplicates: false,   // actualiza updated_at en cada login
      }
    )
    .select()
    .single();

  if (error) {
    console.warn('[Frutix] No se pudo garantizar el perfil:', error.message);
    return null;
  }
  return data;
}

// ── RANKING ──────────────────────────────────────────────

/** Obtiene el top N del ranking ordenado por puntos */
export async function obtenerRanking(limite = 10, ordenarPor = 'puntos') {
  const { data, error } = await supabase
    .from('ranking')
    .select('id, user_id, nombre_jugador, puntos, combo_maximo, xp_ganada, fecha')
    .order(ordenarPor, { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}

/** Obtiene el ranking del día actual */
export async function obtenerRankingHoy(limite = 10) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('ranking')
    .select('id, user_id, nombre_jugador, puntos, combo_maximo, xp_ganada, fecha')
    .gte('fecha', hoy.toISOString())
    .order('puntos', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}

/** Estadísticas globales del juego */
export async function obtenerEstadisticas() {
  const [{ count: jugadores }, { count: partidas }, mejorRes] = await Promise.all([
    supabase.from('perfiles').select('id', { count: 'exact', head: true }),
    supabase.from('ranking').select('id', { count: 'exact', head: true }),
    supabase.from('ranking').select('puntos').order('puntos', { ascending: false }).limit(1),
  ]);
  return {
    jugadores: jugadores ?? 0,
    partidas:  partidas ?? 0,
    record:    mejorRes.data?.[0]?.puntos ?? 0,
  };
}

/** Suscripción en tiempo real al ranking */
export function suscribirRanking(callback) {
  return supabase
    .channel('ranking-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ranking' }, callback)
    .subscribe();
}
