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

// El origen SIEMPRE se toma del navegador actual (window.location.origin).
// Así el enlace de confirmación funciona igual en localhost (dev) y en el
// dominio de Vercel (producción), sin depender de una variable del build.
const APP_ORIGIN = window.location.origin;

// ── AUTH ─────────────────────────────────────────────────
// La autenticación es exclusivamente por correo y contraseña gestionada por
// Supabase. No se usa ningún proveedor externo (OAuth), de modo que el sistema
// no depende de servicios de terceros para registrar jugadores.

/**
 * Registra un usuario nuevo con correo y contraseña.
 *
 * El nombre se guarda en `options.data`, que Supabase escribe en
 * `raw_user_meta_data`. El trigger handle_new_user() lo lee desde ahí para
 * rellenar `nombre_jugador` en la tabla perfiles.
 *
 * @returns {Promise<{ session: object|null, user: object|null }>} Si `session`
 *   es null, el proyecto tiene activada la confirmación por correo y el usuario
 *   aún debe verificarlo antes de poder entrar.
 */
export async function registrarConEmail(email, password, nombreJugador) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: nombreJugador },
      emailRedirectTo: `${APP_ORIGIN}/dojo.html`,
    },
  });
  if (error) throw error;
  return data;
}

/** Inicia sesión con correo y contraseña ya registrados. */
export async function loginConEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
  window.location.href = '/index.html';
}

export async function obtenerSesion() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Espera hasta que Supabase resuelva el estado de auth (útil tras confirmar el correo) */
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
 * Sincroniza el perfil del usuario con el backend.
 * Esto asegura que el perfil exista en la BD y tenga todos los campos correctos.
 * Se llama después de iniciar sesión.
 */
async function sincronizarPerfilConBackend(user) {
  try {
    console.log('[Supabase] Sincronizando perfil con backend:', user.email);
    const res = await fetch('/api/usuarios/crear-perfil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user.id,
        email: user.email,
        nombre_jugador: user.user_metadata?.full_name
                     ?? user.user_metadata?.name
                     ?? user.email?.split('@')[0]
                     ?? 'Ninja'
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log('[Supabase] Perfil sincronizado:', data.status, data.message);
    return data.perfil;
  } catch (err) {
    console.warn('[Supabase] Error al sincronizar perfil con backend:', err.message);
    // No lanzar error — continuamos con el fallback local
    return null;
  }
}

/**
 * Garantiza que exista un perfil para el usuario autenticado.
 * Se llama en cada login — es seguro ejecutarlo siempre.
 * 1. Intenta sincronizar con el backend
 * 2. Fallback: intenta leer/crear localmente vía Supabase
 * Devuelve el perfil (nuevo o existente).
 */
export async function garantizarPerfil(user) {
  if (!user?.id || !user?.email) {
    console.error('[Supabase] Usuario inválido para garantizarPerfil:', user);
    throw new Error('Usuario no autenticado correctamente');
  }

  const nombrePorDefecto = user.user_metadata?.full_name
                    ?? user.user_metadata?.name
                    ?? user.email?.split('@')[0]
                    ?? 'Ninja';

  // 1️⃣ Intentar sincronizar con el backend (más confiable)
  const perfilBackend = await sincronizarPerfilConBackend(user);
  if (perfilBackend) {
    return perfilBackend;
  }

  // 2️⃣ FALLBACK: Leer el perfil existente desde Supabase
  const { data: existente } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (existente) {
    console.log('[Supabase] Perfil existente encontrado:', existente.id);
    // Perfil ya existe — actualizar updated_at y rellenar campos que puedan faltar
    const patch = { updated_at: new Date().toISOString() };
    if (!existente.nombre_jugador) patch.nombre_jugador = nombrePorDefecto;
    if (!existente.email)          patch.email          = user.email;

    const { data: actualizado } = await supabase
      .from('perfiles')
      .update(patch)
      .eq('id', user.id)
      .select()
      .single();

    return actualizado ?? existente;
  }

  // 3️⃣ FALLBACK: Crear el perfil localmente vía Supabase
  console.log('[Supabase] Creando perfil nuevo para:', user.email);

  const nuevosPerfil = {
    id:                user.id,
    email:             user.email,
    nombre_jugador:    nombrePorDefecto,
    xp_total:          0,
    rango:             'Estudiante de la Hoja',
    partidas_jugadas:  0,
    updated_at:        new Date().toISOString(),
  };

  const { data: perfilCreado, error } = await supabase
    .from('perfiles')
    .insert([nuevosPerfil])
    .select()
    .single();

  if (error) {
    console.error('[Supabase] Error al crear perfil:', error.message, error.details);

    // ÚLTIMO FALLBACK: Devolver un perfil mínimo para que el juego funcione
    const perfilFallback = {
      id: user.id,
      email: user.email,
      nombre_jugador: nombrePorDefecto,
      rango: 'Estudiante de la Hoja',
      xp_total: 0,
      partidas_jugadas: 0,
    };
    console.warn('[Supabase] Usando perfil fallback (offline mode):', perfilFallback);
    return perfilFallback;
  }

  console.log('[Supabase] Perfil creado exitosamente:', perfilCreado?.id);
  return perfilCreado;
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
