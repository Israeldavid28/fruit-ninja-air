/**
 * inicio.js — Lógica de la landing page de Fruit Ninja Air
 */
import { obtenerRanking, obtenerEstadisticas, suscribirRanking } from '../servicios/supabase.js';

// ── CANVAS PREVIEW (Frutas animadas) ─────────────────────
function iniciarCanvasPreview() {
  const canvas = document.getElementById('canvas-preview');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function redimensionar() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  redimensionar();
  window.addEventListener('resize', redimensionar);

  const FRUTAS_EMOJIS = ['🍎', '🍊', '🍋', '🍇', '🍓', '🍉', '🥝', '🍑'];
  const frutas = [];

  for (let i = 0; i < 7; i++) {
    frutas.push({
      emoji:  FRUTAS_EMOJIS[Math.floor(Math.random() * FRUTAS_EMOJIS.length)],
      x:      Math.random() * 100,
      y:      Math.random() * 100,
      vx:     (Math.random() - 0.5) * 0.4,
      vy:     (Math.random() - 0.5) * 0.4,
      size:   28 + Math.random() * 22,
      alpha:  0.6 + Math.random() * 0.4,
      rot:    Math.random() * Math.PI * 2,
      rotVel: (Math.random() - 0.5) * 0.03,
    });
  }

  function animar() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;

    frutas.forEach(f => {
      f.x  += f.vx;
      f.y  += f.vy;
      f.rot += f.rotVel;

      if (f.x < -5 || f.x > 105) f.vx *= -1;
      if (f.y < -5 || f.y > 105) f.vy *= -1;

      ctx.save();
      ctx.globalAlpha = f.alpha;
      ctx.font = `${f.size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const px = (f.x / 100) * W;
      const py = (f.y / 100) * H;

      ctx.translate(px, py);
      ctx.rotate(f.rot);
      ctx.fillText(f.emoji, 0, 0);
      ctx.restore();
    });

    // Estela de corte decorativa
    ctx.strokeStyle = 'rgba(249,115,22,0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W * 0.1, H * 0.8);
    ctx.bezierCurveTo(W * 0.3, H * 0.4, W * 0.7, H * 0.6, W * 0.9, H * 0.2);
    ctx.stroke();

    requestAnimationFrame(animar);
  }
  animar();
}

// ── RANKING PREVIEW ──────────────────────────────────────
const COLORES_AVATAR = [
  '#f97316','#ef4444','#8b5cf6','#06b6d4',
  '#22c55e','#f59e0b','#3b82f6','#ec4899',
];

function colorAvatar(str = '') {
  let hash = 0;
  for (const c of str) hash = c.charCodeAt(0) + (hash << 5) - hash;
  return COLORES_AVATAR[Math.abs(hash) % COLORES_AVATAR.length];
}

function iconoPodio(rank) {
  if (rank === 0) return `<span style="font-size:1.2rem;" title="1° Lugar">👑</span>`;
  return `<span style="color:var(--color-fn-tenue);font-size:.85rem;font-weight:700;">#${rank + 1}</span>`;
}

function badgePodio(rank) {
  if (rank === 0) return '<span class="badge-podio badge-oro">ORO</span>';
  if (rank === 1) return '<span class="badge-podio badge-plata">PLATA</span>';
  if (rank === 2) return '<span class="badge-podio badge-plata">PLATA</span>';
  return '<span class="badge-podio badge-bronce">BRONCE</span>';
}

function renderizarFila(entry, rank) {
  const inicial = (entry.nombre_jugador ?? 'A')[0].toUpperCase();
  const color   = colorAvatar(entry.nombre_jugador ?? '');
  return `
    <tr>
      <td style="text-align:center;">${iconoPodio(rank)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="avatar--inicial" style="background:${color};">${inicial}</div>
          <span style="font-weight:600;color:${rank === 0 ? 'var(--color-fn-naranja)' : 'var(--color-fn-claro)'};">
            ${entry.nombre_jugador ?? 'Anónimo'}
          </span>
        </div>
      </td>
      <td style="font-weight:700;color:var(--color-fn-blanco);">${(entry.puntos ?? 0).toLocaleString()}</td>
      <td style="color:var(--color-fn-verde);font-weight:700;">x${entry.combo_maximo ?? 0}</td>
      <td>${badgePodio(rank)}</td>
    </tr>`;
}

async function cargarRankingPreview() {
  const body = document.getElementById('ranking-body');
  if (!body) return;

  try {
    const datos = await obtenerRanking(8);
    if (!datos.length) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--color-fn-tenue);">¡Sé el primero en jugar!</td></tr>`;
      return;
    }
    body.innerHTML = datos.map((e, i) => renderizarFila(e, i)).join('');
  } catch {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--color-fn-tenue);">Sin conexión al ranking</td></tr>`;
  }
}

// ── ESTADÍSTICAS ─────────────────────────────────────────
async function cargarEstadisticas() {
  try {
    const stats = await obtenerEstadisticas();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-jugadores', stats.jugadores.toLocaleString());
    set('stat-partidas',  stats.partidas.toLocaleString());
    set('stat-mejor',     stats.record.toLocaleString());
  } catch {
    /* Silencioso */
  }
}

// ── REALTIME ─────────────────────────────────────────────
function suscribirActualizaciones() {
  suscribirRanking(() => {
    cargarRankingPreview();
    cargarEstadisticas();
  });
}

// ── NAVBAR scroll effect ──────────────────────────────────
function iniciarNavbar() {
  const nav = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      nav.style.background = 'rgba(6,6,15,0.98)';
    } else {
      nav.style.background = 'rgba(6,6,15,0.85)';
    }
  });
}

// ── INICIALIZAR ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  iniciarCanvasPreview();
  cargarRankingPreview();
  cargarEstadisticas();
  suscribirActualizaciones();
  iniciarNavbar();
});
