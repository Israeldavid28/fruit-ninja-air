from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
