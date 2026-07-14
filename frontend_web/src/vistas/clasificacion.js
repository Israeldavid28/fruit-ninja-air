/**
 * clasificacion.js — Leaderboard en tiempo real de Frutix
 */
import {
  obtenerRanking, obtenerRankingHoy, obtenerEstadisticas,
  suscribirRanking, obtenerUsuario, obtenerSesion
} from '../servicios/supabase.js';
import '../servicios/musica.js';

let tabActual   = 'puntos';
let periodoActual = 'todo';
let miUserId    = null;

// ── COLORES DE AVATAR ─────────────────────────────────────
const COLORES = ['#f97316','#ef4444','#8b5cf6','#06b6d4','#22c55e','#f59e0b','#3b82f6','#ec4899'];

function colorAvatar(s = '') {
  let h = 0;
  for (const c of s) h = c.charCodeAt(0) + (h << 5) - h;
  return COLORES[Math.abs(h) % COLORES.length];
}

function iconoRank(i) {
  if (i === 0) return `<span style="font-size:1.3rem;">👑</span>`;
  return `<span style="color:var(--color-fn-tenue);font-size:.85rem;font-weight:700;">#${i + 1}</span>`;
}

function badgePodio(i) {
  if (i === 0) return '<span class="badge-podio badge-oro">ORO</span>';
  if (i === 1) return '<span class="badge-podio badge-plata">PLATA</span>';
  if (i === 2) return '<span class="badge-podio badge-plata">PLATA</span>';
  return '<span class="badge-podio badge-bronce">BRONCE</span>';
}

function renderFila(entry, i, esYo = false) {
  const inicial = (entry.nombre_jugador ?? 'A')[0].toUpperCase();
  const color   = colorAvatar(entry.nombre_jugador ?? '');
  const valor   = tabActual === 'puntos'
    ? `<td style="font-weight:700;color:var(--color-fn-blanco);">${(entry.puntos ?? 0).toLocaleString()}</td>`
    : `<td style="font-weight:700;color:var(--color-fn-verde);">x${entry.combo_maximo ?? 0}</td>`;

  return `
    <tr style="${esYo ? 'background:rgba(249,115,22,0.07);' : ''}">
      <td style="text-align:center;">${iconoRank(i)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="avatar--inicial" style="background:${color};width:34px;height:34px;font-size:0.9rem;">${inicial}</div>
          <div>
            <div style="font-weight:700;color:${esYo ? 'var(--color-fn-naranja)' : (i === 0 ? 'var(--color-fn-naranja)' : 'var(--color-fn-claro)')};">
              ${entry.nombre_jugador ?? 'Anónimo'}
              ${esYo ? '<span style="font-size:0.65rem;color:var(--color-fn-tenue);margin-left:6px;">← Tú</span>' : ''}
            </div>
          </div>
        </div>
      </td>
      ${valor}
      <td style="color:var(--color-fn-verde);font-weight:600;">x${entry.combo_maximo ?? 0}</td>
      <td>${badgePodio(i)}</td>
    </tr>`;
}

// ── CARGAR DATOS ──────────────────────────────────────────
async function cargarTabla() {
  const cuerpo = document.getElementById('cuerpo-clasificacion');
  if (!cuerpo) return;

  cuerpo.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:48px;color:var(--color-fn-tenue);">
    <div style="font-size:1.5rem;margin-bottom:8px;">⏳</div>Cargando...
  </td></tr>`;

  try {
    const datos = periodoActual === 'hoy'
      ? await obtenerRankingHoy(50)
      : await obtenerRanking(50, tabActual === 'combo' ? 'combo_maximo' : 'puntos');

    if (!datos.length) {
      cuerpo.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:48px;color:var(--color-fn-tenue);">
        <div style="font-size:2rem;margin-bottom:12px;">🍃</div>
        ¡Sin jugadores aún! Sé el primero en jugar.
      </td></tr>`;
      return;
    }

    cuerpo.innerHTML = datos
      .map((e, i) => renderFila(e, i, e.user_id === miUserId))
      .join('');

    // Actualizar columna principal
    const colPrincipal = document.getElementById('col-principal');
    if (colPrincipal) colPrincipal.textContent = tabActual === 'combo' ? 'Combo' : 'Puntos';

    // Mi posición
    const misResultados = datos.filter(e => e.user_id === miUserId);
    const miPosPanel = document.getElementById('mi-posicion');
    const miFilaEl   = document.getElementById('fila-mi-posicion');
    if (miPosPanel && miFilaEl && misResultados.length && miUserId) {
      const miIdx = datos.findIndex(e => e.user_id === miUserId);
      miFilaEl.outerHTML = renderFila(misResultados[0], miIdx, true);
      miPosPanel.style.display = 'block';
    }

    // Timestamp
    const ts = document.getElementById('ultimo-update');
    if (ts) ts.textContent = `— actualizado ${new Date().toLocaleTimeString()}`;

  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:48px;color:#f87171;">
      ⚠ Error al cargar el ranking. Intenta de nuevo.
    </td></tr>`;
    console.error('[Clasificación]', err);
  }
}

async function cargarEstadisticas() {
  try {
    const s = await obtenerEstadisticas();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('total-jugadores', s.jugadores.toLocaleString());
    set('total-partidas',  s.partidas.toLocaleString());
    set('puntaje-record',  s.record.toLocaleString());
  } catch { /* silencioso */ }
}

// ── TABS ─────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
    btn.classList.add('activo');
    tabActual = btn.dataset.tab;
    cargarTabla();
  });
});

// ── FILTRO PERÍODO ────────────────────────────────────────
document.getElementById('filtro-periodo')?.addEventListener('change', function () {
  periodoActual = this.value;
  cargarTabla();
});

// ── REALTIME ─────────────────────────────────────────────
function suscribirCambios() {
  suscribirRanking(() => {
    cargarTabla();
    cargarEstadisticas();
  });
}

// ── NAV AUTH ─────────────────────────────────────────────
async function configurarNavAuth() {
  try {
    const sesion = await obtenerSesion();
    const btn = document.getElementById('nav-auth-btn');
    if (sesion && btn) {
      btn.textContent = '⚔️ Jugar';
      btn.href = '/dojo.html';
    }
  } catch { /* sin sesión */ }
}

// ── INICIALIZAR ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const sesion = await obtenerSesion();
    if (sesion) {
      const user = await obtenerUsuario();
      miUserId = user?.id ?? null;
    }
  } catch { /* invitado */ }

  await cargarTabla();
  await cargarEstadisticas();
  configurarNavAuth();
  suscribirCambios();
});
