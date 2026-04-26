-- ==========================================
-- JUTSU ACADEMY - FRUIT NINJA AIR
-- Configuración de Base de Datos Supabase (Actualizada)
-- ==========================================

-- 0. Limpiar tablas existentes por si acaso (descomentar si quieres resetear la DB)
-- DROP TABLE IF EXISTS public.ranking CASCADE;
-- DROP TABLE IF EXISTS public.perfiles CASCADE;

-- 1. Tabla de Perfiles (El carnet del Ninja)
CREATE TABLE IF NOT EXISTS public.perfiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    nombre_jugador TEXT NOT NULL,
    xp_total INTEGER DEFAULT 0,
    rango TEXT DEFAULT 'Estudiante de la Hoja',
    partidas_jugadas INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en perfiles
ALTER TABLE public.perfiles ENABLE ROW LEVEL SECURITY;

-- Evitar error si la política ya existe
DO $$ BEGIN
    CREATE POLICY "Perfiles son visibles para todos" ON public.perfiles FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Usuarios pueden actualizar su propio perfil" ON public.perfiles FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Service role tiene acceso total a perfiles" ON public.perfiles USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- 2. Tabla de Ranking (Historial de Partidas)
CREATE TABLE IF NOT EXISTS public.ranking (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.perfiles(id) ON DELETE CASCADE,
    nombre_jugador TEXT NOT NULL,
    puntos INTEGER NOT NULL DEFAULT 0,
    combo_maximo INTEGER NOT NULL DEFAULT 0,
    xp_ganada INTEGER NOT NULL DEFAULT 0,
    tiempo_segundos INTEGER NOT NULL DEFAULT 0,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en ranking
ALTER TABLE public.ranking ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Ranking es visible para todos" ON public.ranking FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE POLICY "Service role tiene acceso total al ranking" ON public.ranking FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- 3. Trigger para crear perfil automático al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.perfiles (id, email, nombre_jugador, xp_total, rango, partidas_jugadas)
  VALUES (
      new.id, 
      new.email, 
      COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 
      0, 
      'Estudiante de la Hoja', 
      0
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- 4. Habilitar Realtime para la tabla ranking
-- (Ignora error si ya estaba añadido)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'ranking'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ranking;
  END IF;
END $$;
