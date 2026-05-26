-- ============================================================
-- FIX: Completar schema de perfiles y trigger de auto-creación
-- Pegar en: https://supabase.com/dashboard/project/xqukwugiisnjhwduaceg/sql/new
-- ============================================================

-- 1. Agregar columnas faltantes
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS email          TEXT,
  ADD COLUMN IF NOT EXISTS nombre_jugador TEXT,
  ADD COLUMN IF NOT EXISTS created_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now());

-- 2. Rellenar datos de usuarios existentes desde auth.users
UPDATE public.perfiles p
SET
  email          = u.email,
  nombre_jugador = COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  created_at     = COALESCE(p.updated_at, now())
FROM auth.users u
WHERE p.id = u.id;

-- 3. Trigger que crea perfil completo al registrarse con Google
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.perfiles (
    id, email, nombre_jugador,
    xp_total, rango, partidas_jugadas,
    created_at, updated_at
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    0,
    'Estudiante de la Hoja',
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email          = EXCLUDED.email,
    nombre_jugador = COALESCE(public.perfiles.nombre_jugador, EXCLUDED.nombre_jugador),
    updated_at     = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4. Políticas RLS para perfiles
DO $$ BEGIN
  CREATE POLICY "Perfiles son visibles para todos"
    ON public.perfiles FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Usuarios pueden insertar su propio perfil"
    ON public.perfiles FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Usuarios pueden actualizar su propio perfil"
    ON public.perfiles FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 5. Política INSERT para ranking
DO $$ BEGIN
  CREATE POLICY "Usuarios autenticados pueden insertar en ranking"
    ON public.ranking FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 6. Realtime para ranking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'ranking'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ranking;
  END IF;
END $$;

-- Verificar resultado
SELECT id, email, nombre_jugador, rango, xp_total, partidas_jugadas, created_at
FROM public.perfiles
LIMIT 10;
