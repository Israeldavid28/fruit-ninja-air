-- ==========================================
-- FIX: Asegurar que la autenticación y creación de perfiles funcione
-- Ejecutar en el SQL Editor de Supabase
-- ==========================================

-- 1. Verificar y recrear la tabla perfiles si es necesario
CREATE TABLE IF NOT EXISTS public.perfiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    nombre_jugador TEXT NOT NULL,
    avatar_url TEXT,
    xp_total INTEGER DEFAULT 0,
    rango TEXT DEFAULT 'Estudiante de la Hoja',
    partidas_jugadas INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Habilitar RLS (Row Level Security)
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

-- 3. Borrar políticas viejas para evitar conflictos
DROP POLICY IF EXISTS "Perfiles son visibles para todos" ON public.perfiles;
DROP POLICY IF EXISTS "Usuarios pueden insertar su propio perfil" ON public.perfiles;
DROP POLICY IF EXISTS "Usuarios pueden actualizar su propio perfil" ON public.perfiles;
DROP POLICY IF EXISTS "Service role tiene acceso total a perfiles" ON public.perfiles;

-- 4. Recrear políticas RLS
-- Todos pueden LEER perfiles (para leaderboard)
CREATE POLICY "Perfiles son visibles para todos"
  ON public.perfiles
  FOR SELECT
  USING (true);

-- Los usuarios pueden insertar su PROPIO perfil
CREATE POLICY "Usuarios pueden insertar su propio perfil"
  ON public.perfiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Los usuarios pueden actualizar su PROPIO perfil
CREATE POLICY "Usuarios pueden actualizar su propio perfil"
  ON public.perfiles
  FOR UPDATE
  USING (auth.uid() = id);

-- Service role (backend) tiene acceso total (bypasea RLS)
CREATE POLICY "Service role tiene acceso total a perfiles"
  ON public.perfiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Borrar trigger viejo
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 6. Crear función para manejar nuevos usuarios
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.perfiles (id, email, nombre_jugador, xp_total, rango, partidas_jugadas)
  VALUES (
      new.id,
      new.email,
      COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Ninja'),
      0,
      'Estudiante de la Hoja',
      0
  )
  ON CONFLICT (id) DO UPDATE SET
      updated_at = now()
  RETURNING *;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Crear trigger para ejecutar la función automáticamente
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 8. Crear tabla de ranking si no existe
CREATE TABLE IF NOT EXISTS public.ranking (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.perfiles(id) ON DELETE CASCADE,
    nombre_jugador TEXT NOT NULL,
    puntos INTEGER NOT NULL DEFAULT 0,
    combo_maximo INTEGER NOT NULL DEFAULT 0,
    xp_ganada INTEGER NOT NULL DEFAULT 0,
    tiempo_segundos INTEGER NOT NULL DEFAULT 0,
    fruta_cortada INTEGER NOT NULL DEFAULT 0,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Habilitar RLS en ranking
ALTER TABLE public.ranking ENABLE ROW LEVEL SECURITY;

-- Borrar políticas viejas
DROP POLICY IF EXISTS "Ranking es visible para todos" ON public.ranking;
DROP POLICY IF EXISTS "Service role tiene acceso total al ranking" ON public.ranking;

-- Recrear políticas
CREATE POLICY "Ranking es visible para todos"
  ON public.ranking
  FOR SELECT
  USING (true);

CREATE POLICY "Service role tiene acceso total al ranking"
  ON public.ranking
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 10. Habilitar Realtime para ranking
ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS public.ranking;

-- 11. Crear índices para optimizar queries
CREATE INDEX IF NOT EXISTS idx_ranking_user_id ON public.ranking(user_id);
CREATE INDEX IF NOT EXISTS idx_ranking_fecha ON public.ranking(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_perfiles_email ON public.perfiles(email);

-- Verificación: mostrar que todo está listo
SELECT
  'Tablas: ' || COUNT(*) as status
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('perfiles', 'ranking');

-- Mostrar políticas
SELECT
  schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public';
