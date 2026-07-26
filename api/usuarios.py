from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from supabase import create_client, Client

# Inicializar Router
router = APIRouter()

# --- CONEXIÓN SUPABASE ---
# URL del proyecto "handjutsu"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
# La ANON KEY se usa para operaciones de lectura pública
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
# La SERVICE KEY bypasea RLS — SOLO para el middleware (nunca al frontend)
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Cliente público (lectura de perfiles y ranking)
supabase_public: Client | None = None
# Cliente administrativo (escritura validada desde el backend)
supabase_admin: Client | None = None

if SUPABASE_URL and SUPABASE_ANON_KEY:
    supabase_public = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# --- SISTEMA DE RANGOS DE LA ACADEMIA JUTSU ---
RANGOS = [
    {"nombre": "Estudiante de la Hoja", "xp_minima": 0,     "color": "gray",   "emoji": "📜"},
    {"nombre": "Genin (Principiante)", "xp_minima": 1000,  "color": "green",  "emoji": "🌿"},
    {"nombre": "Chunin (Avanzado)",    "xp_minima": 5000,  "color": "blue",   "emoji": "💧"},
    {"nombre": "Jonin (Experto)",      "xp_minima": 15000, "color": "purple", "emoji": "⚡"},
    {"nombre": "Anbu (Élite)",         "xp_minima": 30000, "color": "orange", "emoji": "🔥"},
    {"nombre": "Kage (Maestro)",       "xp_minima": 50000, "color": "red",    "emoji": "👁️"},
]

# Modelo de datos que esperamos recibir del Frontend
class ResultadoPartida(BaseModel):
    user_id: str
    nombre_jugador: str = "Ninja Anónimo"
    puntos: int
    combo_maximo: int
    tiempo_segundos: int

def calcular_rango(xp_actual: int) -> dict:
    """Determina el rango basado en la XP total del jugador."""
    rango_actual = RANGOS[0]
    for rango in RANGOS:
        if xp_actual >= rango["xp_minima"]:
            rango_actual = rango
        else:
            break
    return rango_actual

def calcular_xp(puntos: int, combo_maximo: int) -> int:
    """
    Calcula la XP ganada en la partida.
    La validación es del BACKEND — el frontend no puede alterar esto.
    """
    multiplicador = 1.0
    if combo_maximo >= 15:
        multiplicador = 2.5
    elif combo_maximo >= 10:
        multiplicador = 2.0
    elif combo_maximo >= 5:
        multiplicador = 1.5

    xp_ganada = int(puntos * multiplicador)

    # ANTI-CHEAT: Tope máximo por partida
    return min(xp_ganada, 15000)

@router.get("/perfil/{user_id}")
async def obtener_perfil(user_id: str):
    """Devuelve el perfil del usuario con su rango calculado."""
    if not supabase_public:
        raise HTTPException(status_code=503, detail="Base de datos no configurada")

    res = supabase_public.table("perfiles").select("*").eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Ninja no encontrado en la academia")

    perfil = res.data[0]
    rango = calcular_rango(perfil.get("xp_total", 0))
    perfil["rango_info"] = rango
    return perfil

@router.post("/crear-perfil")
async def crear_perfil(datos: dict):
    """
    Garantiza que un perfil exista para el usuario autenticado.
    Se llama después de iniciar sesión.

    Recibe: { user_id, email, nombre_jugador }
    """
    if not supabase_admin:
        raise HTTPException(status_code=503, detail="Backend no configurado para crear perfiles")

    user_id = datos.get("user_id")
    email = datos.get("email")
    nombre_jugador = datos.get("nombre_jugador", "Ninja")

    if not user_id or not email:
        raise HTTPException(status_code=400, detail="user_id y email son requeridos")

    # 1. Verificar si el perfil ya existe
    res_existente = supabase_admin.table("perfiles").select("*").eq("id", user_id).execute()

    if res_existente.data and len(res_existente.data) > 0:
        # Perfil ya existe — actualizar updated_at
        supabase_admin.table("perfiles").update({
            "updated_at": "now()"
        }).eq("id", user_id).execute()
        return {
            "status": "existing",
            "message": "Perfil ya existía",
            "perfil": res_existente.data[0]
        }

    # 2. Crear nuevo perfil
    try:
        res = supabase_admin.table("perfiles").insert({
            "id": user_id,
            "email": email,
            "nombre_jugador": nombre_jugador,
            "xp_total": 0,
            "rango": "Estudiante de la Hoja",
            "partidas_jugadas": 0,
        }).execute()

        if res.data and len(res.data) > 0:
            return {
                "status": "created",
                "message": "Perfil creado exitosamente",
                "perfil": res.data[0]
            }
        else:
            raise Exception("No se devolvieron datos después de crear el perfil")
    except Exception as e:
        print(f"[API] Error al crear perfil: {str(e)}")
        raise HTTPException(
            status_code=400,
            detail=f"Error al crear perfil: {str(e)}"
        )

@router.get("/leaderboard")
async def obtener_leaderboard(limite: int = 10):
    """Devuelve el top de jugadores por mejor puntaje en una partida."""
    if not supabase_public:
        raise HTTPException(status_code=503, detail="Base de datos no configurada")

    res = supabase_public.table("ranking") \
        .select("nombre_jugador, puntos, combo_maximo, xp_ganada, fecha") \
        .order("puntos", desc=True) \
        .limit(limite) \
        .execute()

    return {"leaderboard": res.data or []}

@router.post("/procesar-partida")
async def procesar_partida(datos: ResultadoPartida):
    """
    Recibe el resultado de una partida, valida con Anti-Cheat,
    calcula XP real y actualiza el perfil en Supabase.
    Requiere SUPABASE_SERVICE_KEY para escribir bypasseando RLS.
    """
    if not supabase_admin:
        # Fallback al cliente público si no hay service key (modo desarrollo)
        db = supabase_public
        if not db:
            raise HTTPException(status_code=503, detail="Base de datos no configurada")
    else:
        db = supabase_admin

    # ── 1. ANTI-CHEAT: Validaciones físicamente imposibles ──────────────
    if datos.puntos > 500 and datos.tiempo_segundos < 10:
        raise HTTPException(
            status_code=400,
            detail="🚨 Movimiento sospechoso detectado (Anti-Cheat activado)"
        )
    if datos.combo_maximo > datos.puntos:
        raise HTTPException(
            status_code=400,
            detail="🚨 Combo imposible detectado (Anti-Cheat activado)"
        )
    if datos.puntos < 0 or datos.combo_maximo < 0 or datos.tiempo_segundos < 0:
        raise HTTPException(
            status_code=400,
            detail="🚨 Valores negativos detectados (Anti-Cheat activado)"
        )

    # ── 2. Calcular XP real desde el Backend (el frontend no puede alterar esto) ──
    xp_ganada = calcular_xp(datos.puntos, datos.combo_maximo)

    # ── 3. Obtener la XP actual del usuario ──────────────────────────────
    res_perfil = db.table("perfiles").select("xp_total, partidas_jugadas").eq("id", datos.user_id).execute()
    if not res_perfil.data:
        raise HTTPException(status_code=404, detail="Ninja no encontrado en la academia")

    xp_actual = res_perfil.data[0].get("xp_total", 0)
    nueva_xp = xp_actual + xp_ganada
    nuevo_rango = calcular_rango(nueva_xp)

    # ── 4. Actualizar perfil en Supabase ─────────────────────────────────
    db.table("perfiles").update({
        "xp_total": nueva_xp,
        "rango": nuevo_rango["nombre"],
    }).eq("id", datos.user_id).execute()

    # ── 5. Insertar en ranking (dispara Realtime → leaderboard en vivo) ──
    db.table("ranking").insert({
        "user_id": datos.user_id,
        "nombre_jugador": datos.nombre_jugador,
        "puntos": datos.puntos,
        "xp_ganada": xp_ganada,
        "combo_maximo": datos.combo_maximo,
        "tiempo_segundos": datos.tiempo_segundos,
    }).execute()

    return {
        "status": "success",
        "xp_ganada": xp_ganada,
        "xp_total": nueva_xp,
        "nuevo_rango": nuevo_rango["nombre"],
        "emoji_rango": nuevo_rango["emoji"],
        "color_rango": nuevo_rango["color"],
        "mensaje": f"¡Ganaste {xp_ganada} XP! Ahora eres {nuevo_rango['emoji']} {nuevo_rango['nombre']}",
    }
