/* =========================================================
   Chronos ITT – Lógica de interfaz
   Para conectar el backend real (Python/REST): pon
   USE_MOCK = false y ajusta API_URL. Cada función de `api`
   indica el endpoint que debe llamar con un comentario TODO.
   ========================================================= */
// Obtén la IP de tu PC en la red local (ejemplo: 192.168.1.75)
const LOCAL_IP = '192.168.0.76'; // <-- Reemplaza por la IP local de tu laptop

const API_URL = `http://${LOCAL_IP}:8000/api`;
const USE_MOCK = false; // <-- Cambia a false para conectar con la API real y BD
const TOLERANCIA_MIN = 10; // minutos para contar "Presente"; después y antes del cierre = "Retardo"

/* ---------- Datos simulados (mock), persistidos en localStorage
   para que Docente / Alumno / Admin compartan el mismo estado
   al alternar roles con el selector de pruebas. ---------- */
function seed() {
  return {
    grupos: [
      { id: 1, materia: 'Programación Web', grupo: '6A' },
      { id: 2, materia: 'Redes de Computadoras', grupo: '6B' },
      { id: 3, materia: 'Bases de Datos', grupo: '4A' },
    ],
    alumnos: [
      { id: 1, nombre: 'alumno', grupoIds: [1, 2] },
      { id: 2, nombre: 'Ana Ibarra', grupoIds: [1] },
      { id: 3, nombre: 'Luis Peña', grupoIds: [1, 3] },
      { id: 4, nombre: 'Marco Ruiz', grupoIds: [2] },
    ],
    sesiones: [
      { id: 1, grupoId: 1, inicio: '2026-09-21T08:00', cierre: '2026-09-21T08:50', token: 'tok-1' },
      { id: 2, grupoId: 1, inicio: '2026-09-23T08:00', cierre: '2026-09-23T08:50', token: 'tok-2' },
      { id: 3, grupoId: 1, inicio: '2026-09-28T08:00', cierre: '2026-09-28T08:50', token: 'tok-3' },
    ],
    asistencias: [
      { id: 1, sesionId: 1, alumnoId: 1, hora: '08:03', estado: 'Presente', justificada: false },
      { id: 2, sesionId: 1, alumnoId: 2, hora: '08:14', estado: 'Retardo', justificada: false },
      { id: 3, sesionId: 1, alumnoId: 3, hora: null, estado: 'Falta', justificada: false },
      { id: 4, sesionId: 2, alumnoId: 1, hora: '08:16', estado: 'Retardo', justificada: false },
      { id: 5, sesionId: 2, alumnoId: 2, hora: '08:02', estado: 'Presente', justificada: false },
      { id: 6, sesionId: 2, alumnoId: 3, hora: null, estado: 'Falta', justificada: false },
      { id: 7, sesionId: 3, alumnoId: 1, hora: null, estado: 'Falta', justificada: false },
      { id: 8, sesionId: 3, alumnoId: 2, hora: '08:05', estado: 'Presente', justificada: false },
      { id: 9, sesionId: 3, alumnoId: 3, hora: '08:12', estado: 'Retardo', justificada: false },
    ],
    nextId: 100,
  };
}
function loadDB() {
  const raw = localStorage.getItem('chronos_db');
  if (raw) return JSON.parse(raw);
  const fresh = seed();
  localStorage.setItem('chronos_db', JSON.stringify(fresh));
  return fresh;
}
function saveDB() { localStorage.setItem('chronos_db', JSON.stringify(db)); }
const db = loadDB();
const newId = () => db.nextId++;

/* ---------- Capa de red ----------
   Con USE_MOCK = true ejecuta `mockFn` (datos locales).
   Con USE_MOCK = false hace el fetch() real al backend. */
async function request(path, method, body, mockFn) {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 150));
    const result = mockFn();
    saveDB();
    return result;
  }
  const token = sessionStorage.getItem('token');
  const res = await fetch(API_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).mensaje || 'Error del servidor');
  return res.json();
}

const api = {
  // TODO: POST /api/auth/login  → { token, usuario: { id, nombre, rol } }
  login: (usuario, password) => request('/auth/login', 'POST', { usuario, password }, () => {
    if (password !== '1234') throw new Error('Credenciales incorrectas (demo: contraseña 1234).');
    const u = usuario.toLowerCase();
    const rol = u.startsWith('docente') ? 'docente' : u.startsWith('admin') ? 'admin' : 'alumno';
    const alumno = db.alumnos.find(a => a.nombre.toLowerCase() === u) || db.alumnos[0];
    return { token: 'mock-token', usuario: { id: rol === 'alumno' ? alumno.id : null, nombre: usuario, rol } };
  }),

  // TODO: GET /api/grupos
  getGrupos: () => request('/grupos', 'GET', null, () => structuredClone(db.grupos)),

  // TODO: POST /api/sesiones  { grupoId }  → crea la sesión y el token del QR
  iniciarSesion: grupoId => request('/sesiones', 'POST', { grupoId }, () => {
    const s = { id: newId(), grupoId, inicio: new Date().toISOString(), cierre: null, token: 'tok-' + Math.random().toString(36).slice(2, 8) };
    db.sesiones.push(s); return s;
  }),

  // TODO: GET /api/sesiones/{id}/asistencias  (lista en tiempo real; en producción usar polling o WebSocket)
  getAsistenciasSesion: sesionId => request(`/sesiones/${sesionId}/asistencias`, 'GET', null, () =>
    structuredClone(db.asistencias.filter(a => a.sesionId === sesionId))),

  // TODO: PUT /api/sesiones/{id}/cerrar  → marca Falta a quien no registró asistencia
  cerrarSesion: (sesionId, grupoId) => request(`/sesiones/${sesionId}/cerrar`, 'PUT', null, () => {
    const s = db.sesiones.find(x => x.id === sesionId); s.cierre = new Date().toISOString();
    const inscritos = db.alumnos.filter(a => a.grupoIds.includes(grupoId));
    inscritos.forEach(a => {
      if (!db.asistencias.some(x => x.sesionId === sesionId && x.alumnoId === a.id)) {
        db.asistencias.push({ id: newId(), sesionId, alumnoId: a.id, hora: null, estado: 'Falta', justificada: false });
      }
    });
    return { ok: true };
  }),

  // TODO: POST /api/asistencia/registrar  { sesionId, token, alumnoId }
  // El backend debe validar el token y calcular el estado según la hora de inicio y la tolerancia.
  registrarAsistencia: (sesionId, token, alumnoId) => request('/asistencia/registrar', 'POST', { sesionId, token, alumnoId }, () => {
    const s = db.sesiones.find(x => x.id === sesionId);
    if (!s || s.token !== token) throw new Error('Código QR no válido.');
    if (s.cierre) throw new Error('Esta sesión ya cerró.');
    if (db.asistencias.some(a => a.sesionId === sesionId && a.alumnoId === alumnoId)) throw new Error('Ya registraste tu asistencia en esta clase.');
    const minutos = (Date.now() - new Date(s.inicio).getTime()) / 60000;
    const estado = minutos <= TOLERANCIA_MIN ? 'Presente' : 'Retardo';
    const a = { id: newId(), sesionId, alumnoId, hora: new Date().toTimeString().slice(0, 5), estado, justificada: false };
    db.asistencias.push(a); return a;
  }),

  // TODO: PUT /api/asistencia/{id}/justificar  { motivo }
  justificarFalta: (asistenciaId, motivo) => request(`/asistencia/${asistenciaId}/justificar`, 'PUT', { motivo }, () => {
    const a = db.asistencias.find(x => x.id === asistenciaId); a.justificada = true; a.motivo = motivo; return { ok: true };
  }),

  // TODO: GET /api/alumnos/{id}/historial
  getHistorialAlumno: alumnoId => request(`/alumnos/${alumnoId}/historial`, 'GET', null, () => ({})),

  // TODO: GET /api/reportes/grupo/{id}
  getReporteGrupo: grupoId => request(`/reportes/grupo/${grupoId}`, 'GET', null, () => ({})),
};

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getUser = () => JSON.parse(sessionStorage.getItem('user') || 'null');
const badge = e => `<span class="badge b-${e.toLowerCase()}">${esc(e)}</span>`;
const fmtDT = iso => new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.remove('show'), 2500);
}

/* Convierte retardos a faltas equivalentes (3 retardos = 1 falta) y calcula % de faltas efectivas */
function calcularRiesgo(registros) {
  const total = registros.length;
  const faltas = registros.filter(r => r.estado === 'Falta' && !r.justificada).length;
  const retardos = registros.filter(r => r.estado === 'Retardo').length;
  const faltasEq = faltas + Math.floor(retardos / 3);
  const pct = total ? Math.round((faltasEq / total) * 100) : 0;
  return { total, faltas, retardos, faltasEq, pct, riesgo: pct >= 20 };
}

/* ---------- Login ---------- */
function initLogin() {
  if (getUser()) return (location.href = 'dashboard.html');
  const f = $('#loginForm'), err = $('#loginError');
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const u = f.usuario.value.trim(), p = f.password.value;
    if (u.length < 3 || p.length < 4) return (err.textContent = 'Usuario de mínimo 3 caracteres y contraseña de mínimo 4.');
    try {
      const r = await api.login(u, p);
      sessionStorage.setItem('token', r.token);
      sessionStorage.setItem('user', JSON.stringify(r.usuario));
      location.href = 'dashboard.html';
    } catch (x) { err.textContent = x.message; }
  });
}

/* ---------- Dashboard ---------- */
const VIEWS = {
  docente: [['clase', 'Clase activa'], ['justificar', 'Faltas por justificar']],
  alumno: [['escanear', 'Escanear'], ['historial', 'Mi historial']],
  admin: [['resumen', 'Resumen'], ['alertas', 'Alertas']],
};
const state = { user: null, rol: 'alumno', grupos: [], poll: null, html5Qr: null };

async function initDashboard() {
  state.user = getUser();
  if (!state.user) return (location.href = 'index.html');
  state.rol = state.user.rol;
  $('#userName').textContent = state.user.nombre;
  $('#roleSwitch').value = state.rol;
  state.grupos = await api.getGrupos();

  $('#roleSwitch').addEventListener('change', e => setRole(e.target.value));
  $('#logoutBtn').addEventListener('click', () => { clearInterval(state.poll); sessionStorage.clear(); location.href = 'index.html'; });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

  // Docente
  $('#grupoSelect').innerHTML = state.grupos.map(g => `<option value="${g.id}">${esc(g.materia)} · ${esc(g.grupo)}</option>`).join('');
  $('#grupoSelectJustificar').innerHTML = $('#grupoSelect').innerHTML;
  $('#grupoSelect').addEventListener('change', renderClase);
  $('#grupoSelectJustificar').addEventListener('change', renderJustificar);
  $('#iniciarSesion').addEventListener('click', onIniciarSesion);
  $('#cerrarSesion').addEventListener('click', onCerrarSesion);
  $('#justificarForm').addEventListener('submit', onJustificar);
  $('#faltasTabla').addEventListener('click', onClickJustificarBtn);

  // Alumno
  $('#startScan').addEventListener('click', startScan);
  $('#stopScan').addEventListener('click', stopScan);
  $('#simularScan').addEventListener('click', simularScan);
  $('#confirmOk').addEventListener('click', () => { $('#confirmBox').hidden = true; $('#escanerBox').hidden = false; });

  setRole(state.rol);
}

function setRole(rol) {
  state.rol = rol;
  $('#tabs').innerHTML = VIEWS[rol].map(([id, t]) => `<button class="tab" data-view="${id}">${t}</button>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
  showView(VIEWS[rol][0][0]);
}

function showView(id) {
  clearInterval(state.poll); stopScan();
  document.querySelectorAll('.view').forEach(v => (v.hidden = v.id !== `view-${id}`));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === id));
  ({ clase: renderClase, justificar: renderJustificar, escanear: renderEscanear, historial: renderHistorial, resumen: renderResumen, alertas: renderAlertas })[id]?.();
}

/* ----- Docente: clase activa ----- */
function sesionAbierta(grupoId) { return db.sesiones.find(s => s.grupoId === grupoId && !s.cierre); }

function renderClase() {
  const grupoId = +$('#grupoSelect').value || state.grupos[0]?.id;
  const sesion = sesionAbierta(grupoId);
  $('#sinSesion').hidden = !!sesion;
  $('#conSesion').hidden = !sesion;
  clearInterval(state.poll);
  if (!sesion) return;

  $('#qrcode').innerHTML = '';
  new QRCode($('#qrcode'), { text: JSON.stringify({ sesionId: sesion.id, token: sesion.token }), width: 180, height: 180 });
  $('#tolInfo').textContent = TOLERANCIA_MIN;
  $('#inicioInfo').textContent = fmtDT(sesion.inicio);

  const renderLista = async () => {
    const asistencias = await api.getAsistenciasSesion(sesion.id);
    $('#listaEnVivo').innerHTML = asistencias.length ? asistencias.map(a => {
      const alumno = db.alumnos.find(x => x.id === a.alumnoId);
      return `<tr><td>${esc(alumno?.nombre)}</td><td>${esc(a.hora ?? '—')}</td><td>${badge(a.estado)}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="empty">Aún no hay registros en esta sesión.</td></tr>';
  };
  renderLista();
  state.poll = setInterval(renderLista, 4000); // simula "tiempo real" con sondeo
}

async function onIniciarSesion() {
  const grupoId = +$('#grupoSelect').value;
  await api.iniciarSesion(grupoId);
  toast('Sesión iniciada: QR generado'); renderClase();
}

async function onCerrarSesion() {
  if (!confirm('¿Cerrar el pase de lista de esta clase? Los alumnos sin registro se marcarán como falta.')) return;
  const grupoId = +$('#grupoSelect').value;
  const sesion = sesionAbierta(grupoId);
  await api.cerrarSesion(sesion.id, grupoId);
  toast('Sesión cerrada'); renderClase();
}

/* ----- Docente: justificar faltas ----- */
function renderJustificar() {
  const grupoId = +$('#grupoSelectJustificar').value || state.grupos[0]?.id;
  const sesiones = db.sesiones.filter(s => s.grupoId === grupoId);
  const faltas = db.asistencias.filter(a => a.estado === 'Falta' && !a.justificada && sesiones.some(s => s.id === a.sesionId));
  $('#faltasTabla').innerHTML = faltas.length ? faltas.map(a => {
    const alumno = db.alumnos.find(x => x.id === a.alumnoId);
    const sesion = sesiones.find(s => s.id === a.sesionId);
    return `<tr><td>${esc(alumno?.nombre)}</td><td>${fmtDT(sesion.inicio)}</td><td>${badge(a.estado)}</td>
      <td><button class="btn btn-ghost btn-sm" data-justificar="${a.id}">Justificar</button></td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">No hay faltas pendientes de justificar en este grupo.</td></tr>';
}
function onClickJustificarBtn(e) {
  const b = e.target.closest('[data-justificar]'); if (!b) return;
  const a = db.asistencias.find(x => x.id === +b.dataset.justificar);
  const alumno = db.alumnos.find(x => x.id === a.alumnoId);
  $('#justificarInfo').textContent = `Alumno: ${alumno.nombre}`;
  $('#justificarForm').dataset.id = a.id;
  $('#justificarMotivo').value = '';
  $('#justificarDialog').showModal();
}
async function onJustificar(e) {
  const id = +$('#justificarForm').dataset.id;
  await api.justificarFalta(id, $('#justificarMotivo').value.trim());
  toast('Falta justificada'); renderJustificar();
}

/* ----- Alumno: escanear ----- */
function renderEscanear() { $('#escanerBox').hidden = false; $('#confirmBox').hidden = true; }

function startScan() {
  $('#startScan').hidden = true; $('#stopScan').hidden = false;
  state.html5Qr = new Html5Qrcode('reader');
  state.html5Qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, onScanSuccess)
    .catch(() => { toast('No se pudo activar la cámara'); stopScan(); });
}
function stopScan() {
  $('#startScan').hidden = false; $('#stopScan').hidden = true;
  if (state.html5Qr) { state.html5Qr.stop().catch(() => {}); state.html5Qr = null; }
}
async function onScanSuccess(texto) {
  stopScan();
  try {
    const { sesionId, token } = JSON.parse(texto);
    await procesarAsistencia(sesionId, token);
  } catch { mostrarConfirmacion('bad', 'Código no válido', 'Escanea el QR que proyecta tu docente.'); }
}
async function simularScan() {
  // Para pruebas sin cámara: usa la sesión abierta más reciente del alumno.
  const grupoId = db.alumnos.find(a => a.id === state.user.id)?.grupoIds[0];
  const sesion = db.sesiones.find(s => s.grupoId === grupoId && !s.cierre);
  if (!sesion) return mostrarConfirmacion('bad', 'Sin sesión activa', 'Pide a tu docente que inicie la clase.');
  await procesarAsistencia(sesion.id, sesion.token);
}
async function procesarAsistencia(sesionId, token) {
  try {
    const a = await api.registrarAsistencia(sesionId, token, state.user.id);
    const map = { Presente: ['ok', '✅'], Retardo: ['warn', '⏳'] };
    const [cls, icon] = map[a.estado] || ['ok', '✅'];
    mostrarConfirmacion(cls, `${icon} ${a.estado}`, `Registrado a las ${a.hora}.`);
  } catch (err) { mostrarConfirmacion('bad', 'No se pudo registrar', err.message); }
}
function mostrarConfirmacion(tipo, titulo, detalle) {
  $('#escanerBox').hidden = true; $('#confirmBox').hidden = false;
  $('#confirmIcon').className = 'confirm-icon ' + tipo;
  $('#confirmIcon').textContent = tipo === 'bad' ? '⚠️' : titulo.split(' ')[0];
  $('#confirmEstado').textContent = titulo.replace(/^\S+\s/, '');
  $('#confirmDetalle').textContent = detalle;
}

/* ----- Alumno: mi historial ----- */
function renderHistorial() {
  const alumno = db.alumnos.find(a => a.id === state.user.id);
  $('#historialMaterias').innerHTML = alumno.grupoIds.map(gid => {
    const grupo = state.grupos.find(g => g.id === gid);
    const sesiones = db.sesiones.filter(s => s.grupoId === gid);
    const registros = db.asistencias.filter(a => a.alumnoId === alumno.id && sesiones.some(s => s.id === a.sesionId));
    const r = calcularRiesgo(registros);
    return `<article class="card mat-card">
      <h3>${esc(grupo.materia)}</h3>
      <span class="muted">${esc(grupo.grupo)}</span>
      <span class="pct" style="color:${r.riesgo ? 'var(--red)' : 'var(--teal)'}">${r.pct}% faltas</span>
      <span class="muted">${r.faltas} faltas · ${r.retardos} retardos · ${sesiones.length} sesiones</span>
      ${r.riesgo ? badge('Falta') : ''}
    </article>`;
  }).join('') || '<p class="empty">No estás inscrito en ninguna materia.</p>';
}

/* ----- Admin: resumen por grupo ----- */
function renderResumen() {
  $('#resumenTabla').innerHTML = state.grupos.map(g => {
    const sesiones = db.sesiones.filter(s => s.grupoId === g.id);
    const registros = db.asistencias.filter(a => sesiones.some(s => s.id === a.sesionId));
    const presentes = registros.filter(r => r.estado === 'Presente').length;
    const r = calcularRiesgo(registros);
    const pctAsistencia = 100 - r.pct;
    return `<tr><td>${esc(g.materia)} · ${esc(g.grupo)}</td><td>${sesiones.length}</td><td>${presentes}</td><td>${r.retardos}</td><td>${r.faltas}</td>
      <td style="color:${r.riesgo ? 'var(--red)' : 'var(--green-dark)'}; font-weight:700;">${pctAsistencia}%</td></tr>`;
  }).join('');
}

/* ----- Admin: alertas de riesgo ----- */
function renderAlertas() {
  const tarjetas = [];
  state.grupos.forEach(g => {
    const sesiones = db.sesiones.filter(s => s.grupoId === g.id);
    db.alumnos.filter(a => a.grupoIds.includes(g.id)).forEach(al => {
      const registros = db.asistencias.filter(a => a.alumnoId === al.id && sesiones.some(s => s.id === a.sesionId));
      if (!registros.length) return;
      const r = calcularRiesgo(registros);
      const nivel = r.pct >= 20 ? 'alto' : r.pct >= 10 ? 'medio' : 'bajo';
      tarjetas.push({ nivel, html: `<article class="card risk-card ${nivel}">
        <h3>${esc(al.nombre)}</h3>
        <span class="muted">${esc(g.materia)} · ${esc(g.grupo)}</span>
        <p class="pct" style="color:${nivel === 'alto' ? 'var(--red)' : nivel === 'medio' ? 'var(--amber)' : 'var(--green-dark)'}">${r.pct}% faltas</p>
        ${r.riesgo ? badge('Falta') : ''}
      </article>` });
    });
  });
  tarjetas.sort((a, b) => (b.nivel === 'alto') - (a.nivel === 'alto'));
  $('#alertasGrid').innerHTML = tarjetas.map(t => t.html).join('') || '<p class="empty">Sin datos de asistencia todavía.</p>';
}

/* ---------- Arranque ---------- */
document.addEventListener('DOMContentLoaded', () => ($('#loginForm') ? initLogin() : initDashboard()));
