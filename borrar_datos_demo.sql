-- ============================================================
-- Frutix — Borrar los jugadores FICTICIOS del ranking (demo expo)
-- Ejecutar en el SQL Editor de Supabase cuando quieras limpiar.
-- Solo afecta a las cuentas @frutixdemo.local; NO toca usuarios reales.
-- ============================================================

DELETE FROM public.ranking
WHERE user_id IN (SELECT id FROM public.perfiles WHERE email LIKE 'demo%@frutixdemo.local');

DELETE FROM public.perfiles
WHERE email LIKE 'demo%@frutixdemo.local';

DELETE FROM auth.users
WHERE email LIKE 'demo%@frutixdemo.local';

-- Verificación (debe quedar solo tu(s) usuario(s) real(es))
SELECT nombre_jugador, email, rango FROM public.perfiles ORDER BY xp_total DESC;
