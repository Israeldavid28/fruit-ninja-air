# 🔐 Fix de Autenticación - Sistema de Registro de Usuarios

## Problema
El sistema de autenticación con Google no estaba creando los perfiles de usuarios automáticamente en Supabase.

## Solución Implementada

### 1️⃣ Cambios en Supabase (BASE DE DATOS)

**Archivo a ejecutar:** `supabase_fix_auth.sql`

Este script:
- ✅ Asegura que la tabla `perfiles` existe con los campos correctos
- ✅ Configura el Trigger `handle_new_user()` que crea un perfil automáticamente cuando el usuario se registra
- ✅ Establece las políticas RLS (Row Level Security) correctas
- ✅ Crea índices para optimizar las queries

**Pasos:**
1. Abre tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Ve a **SQL Editor**
3. Crea una nueva query (o abre la existente)
4. Copia todo el contenido de `supabase_fix_auth.sql`
5. Ejecuta el script (botón de play)
6. Verifica que no haya errores

### 2️⃣ Cambios en el Backend Python

**Archivo modificado:** `api/usuarios.py`

Se agregó un nuevo endpoint POST `/api/usuarios/crear-perfil` que:
- Recibe: `user_id`, `email`, `nombre_jugador`
- Garantiza que el perfil existe en la BD
- Si el perfil ya existe, lo actualiza
- Si no existe, lo crea

Este endpoint es el encargado de sincronizar los usuarios después del login OAuth.

### 3️⃣ Cambios en el Frontend

**Archivo modificado:** `frontend_web/src/servicios/supabase.js`

La función `garantizarPerfil()` ahora:
1. **Intenta sincronizar con el backend** (`POST /api/usuarios/crear-perfil`)
   - Es más confiable porque usa `SERVICE_KEY` en el backend
   - Bypasea las políticas RLS
2. **FALLBACK: Lee desde Supabase** si el backend falla
3. **FALLBACK: Crea localmente** si no existe
4. **FALLBACK: Modo offline** como último recurso

Esta secuencia de intentos garantiza que el usuario siempre pueda jugar, incluso si hay problemas de conectividad.

---

## Flujo de Autenticación Ahora

```
Usuario hace clic en "Google"
    ↓
login.js → loginConGoogle()
    ↓
Supabase OAuth → Google → usuario autoriza
    ↓
Supabase crea auth.users (automático)
    ↓
Trigger handle_new_user() crea perfil en tabla perfiles
    ↓
Usuario redirigido a dojo.html con código OAuth
    ↓
dojo.js → resolverSesion()
    ↓
garantizarPerfil(usuario) → sincronizarPerfilConBackend()
    ↓
POST /api/usuarios/crear-perfil (double-check)
    ↓
Perfil existe en BD ✅
    ↓
Lobby listo → Usuario puede jugar
    ↓
Puntaje se guarda en tabla ranking
    ↓
Ranking actualiza en tiempo real
```

---

## Verificación

### ✅ Test Manual

1. **Abre el sitio en navegador incógnito** (sin sesión previa)
2. Haz clic en **"Continuar con Google"**
3. Autoriza el acceso a tu cuenta de Google
4. Deberías llegar al **Lobby del Dojo**
5. Haz clic en **"¡Comenzar Partida!"**
6. Juega una partida y termina
7. En la pantalla de fin de partida, deberías ver **"✓ Puntaje guardado en el ranking"**

### ✅ Verificar en Supabase

1. Abre Supabase Dashboard → Tu proyecto
2. Ve a **SQL Editor** → crea una nueva query:

```sql
SELECT id, email, nombre_jugador, xp_total, rango, created_at
FROM public.perfiles
ORDER BY created_at DESC
LIMIT 10;
```

Deberías ver tus usuarios creados automáticamente.

```sql
SELECT nombre_jugador, puntos, combo_maximo, xp_ganada, fecha
FROM public.ranking
ORDER BY fecha DESC
LIMIT 10;
```

Deberías ver tus partidas guardadas.

### ✅ Verificar en el Navegador

1. Abre DevTools (F12)
2. Ve a **Console**
3. Busca logs que digan:
   - `[Supabase] Sincronizando perfil con backend...`
   - `[Supabase] Perfil sincronizado...` (o "created" o "existing")
   - `[Supabase] Creando perfil nuevo para...` (si hace fallback local)

---

## Si Aún No Funciona

### 🔍 Debugging

1. **Verificar variables de entorno:**
   - `frontend_web/.env` tiene `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
   - Backend tiene `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` en Vercel

2. **Verificar el trigger en Supabase:**
   ```sql
   SELECT * FROM pg_stat_user_functions 
   WHERE funcname = 'handle_new_user';
   ```
   Si no aparece, ejecuta `supabase_fix_auth.sql` de nuevo.

3. **Verificar RLS:**
   ```sql
   SELECT schemaname, tablename, policyname, permissive
   FROM pg_policies
   WHERE tablename = 'perfiles';
   ```

4. **Ver logs del backend:**
   - Si el backend está en Vercel, ve a **Settings** → **Function logs**
   - Busca errores al procesar `/api/usuarios/crear-perfil`

5. **Reintentar el login:**
   - Abre el sitio en navegador incógnito (sin cache)
   - Intenta el login de nuevo

---

## Resumen de Cambios

| Archivo | Cambio |
|---------|--------|
| `supabase_fix_auth.sql` | **NUEVO** - Script SQL para arreglar BD |
| `api/usuarios.py` | Agregado endpoint POST `/crear-perfil` |
| `frontend_web/src/servicios/supabase.js` | Mejorada función `garantizarPerfil()` con 4 capas de fallback |
| `frontend_web/.env` | ✅ Ya está configurado correctamente |

---

## Próximos Pasos

1. **Ejecuta el SQL** en Supabase Dashboard
2. **Deploy a Vercel** (push los cambios)
3. **Testea el login** en el sitio en vivo
4. **Verifica el ranking** con datos reales

¿Preguntas? Revisa la consola del navegador (DevTools → Console) — allí verás logs detallados del proceso.
