from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Carga las variables de .env en ejecución LOCAL (uvicorn desde la raíz).
# En Vercel no hay .env y las variables ya están en el entorno → no-op.
# Debe ir ANTES de importar el router, que lee las variables al importarse.
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from api.usuarios import router as usuarios_router

app = FastAPI(title="Jutsu Academy API", description="Middleware para Fruit Ninja Air")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Permitir todos para pruebas locales
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registramos el router de usuarios
app.include_router(usuarios_router, prefix="/api/usuarios", tags=["usuarios"])

@app.get("/api/health")
async def health_check():
    """Para verificar que el backend en Vercel está vivo."""
    return {"status": "ok", "message": "Jutsu Academy Middleware operando correctamente."}
