from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import pyodbc
from datetime import datetime

app = FastAPI(title="Chronos ITT API", version="1.0")

# Permitir solicitudes desde cualquier origen (CORS) para el frontend local y dispositivos móviles
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------
# CONEXIÓN A BASE DE DATOS (SQL Server)
# ------------------------------------------------------------
# Ajusta SERVER, DATABASE, USER y PASSWORD según tu configuración local.
DB_CONFIG = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"
    "DATABASE=ChronosITT;"
    "Trusted_Connection=yes;"  # Cambia a UID=tu_usuario;PWD=tu_password si usas autenticación SQL
)

def get_db():
    conn = pyodbc.connect(DB_CONFIG)
    try:
        yield conn
    finally:
        conn.close()

# ------------------------------------------------------------
# MODELOS DE DATO (Pydantic Schemas)
# ------------------------------------------------------------
class LoginSchema(BaseModel):
    usuario: str
    password: str

class SesionSchema(BaseModel):
    grupoId: int

class AsistenciaSchema(BaseModel):
    sesionId: int
    token: str
    alumnoId: int

class JustificarSchema(BaseModel):
    motivo: str

# ------------------------------------------------------------
# ENDPOINTS DE LA API
# ------------------------------------------------------------

@app.post("/api/auth/login")
def login(data: LoginSchema, db: pyodbc.Connection = Depends(get_db)):
    cursor = db.cursor()
    # Consulta el usuario en la BD
    query = "SELECT u.id, u.nombre, u.rol, u.alumno_id FROM Usuarios u WHERE u.identificador = ?"
    cursor.execute(query, (data.usuario,))
    row = cursor.fetchone()

    if not row:
        raise HTTPException(status_code=401, detail="Usuario no encontrado.")

    # NOTA: En producción valida el hash con password_hash. Para desarrollo se acepta cualquier contraseña válida.
    user_id, nombre, rol, alumno_id = row
    return {
        "token": f"jwt-token-simulado-{user_id}",
        "usuario": {
            "id": alumno_id if rol == "alumno" else user_id,
            "nombre": nombre,
            "rol": rol
        }
    }

@app.get("/api/grupos")
def get_grupos(db: pyodbc.Connection = Depends(get_db)):
    cursor = db.cursor()
    query = """
        SELECT g.id, m.nombre AS materia, g.nombre AS grupo 
        FROM Grupos g
        JOIN Materias m ON g.materia_id = m.id
    """
    cursor.execute(query)
    rows = cursor.fetchall()
    return [{"id": r[0], "materia": r[1], "grupo": r[2]} for r in rows]

@app.post("/api/sesiones")
def iniciar_sesion(data: SesionSchema, db: pyodbc.Connection = Depends(get_db)):
    cursor = db.cursor()
    ip_local = "192.168.1.100"  # Puedes obtener la IP local dinámicamente si lo requieres
    fecha_hoy = datetime.now().strftime("%Y-%m-%d")
    hora_actual = datetime.now().strftime("%H:%M:%S")

    try:
        # Crea la sesión insertando en la tabla de Sesiones
        query = """
            INSERT INTO Sesiones (grupo_id, fecha, hora_inicio, ip_servidor, estado)
            OUTPUT INSERTED.id, INSERTED.token_qr, INSERTED.fecha_generacion
            VALUES (?, ?, ?, ?, 'abierta')
        """
        cursor.execute(query, (data.grupoId, fecha_hoy, hora_actual, ip_local))
        row = cursor.fetchone()
        db.commit()

        return {
            "id": row[0],
            "grupoId": data.grupoId,
            "inicio": str(row[2]),
            "cierre": None,
            "token": str(row[1])
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"No se pudo iniciar la sesión: {str(e)}")

@app.get("/api/sesiones/{sesion_id}/asistencias")
def get_asistencias_sesion(sesion_id: int, db: pyodbc.Connection = Depends(get_db)):
    cursor = db.cursor()
    query = """
        SELECT a.id, a.sesion_id, a.alumno_id, 
               CONVERT(VARCHAR(5), a.fecha_hora_registro, 108) AS hora,
               a.estado, CASE WHEN a.estado = 'justificado' THEN 1 ELSE 0 END as justificada
        FROM Asistencias a
        WHERE a.sesion_id = ?
    """
    cursor.execute(query, (sesion_id,))
    rows = cursor.fetchall()
    
    return [
        {
            "id": r[0],
            "sesionId": r[1],
            "alumnoId": r[2],
            "hora": r[3],
            "estado": r[4].capitalize(),
            "justificada": bool(r[5])
        }
        for r in rows
    ]

@app.put("/api/sesiones/{sesion_id}/cerrar")
def cerrar_sesion(sesion_id: int, db: pyodbc.Connection = Depends(get_db)):
    cursor = db.cursor()
    try:
        # Llama al Stored Procedure de SQL Server para cerrar la sesión y marcar ausentes
        cursor.execute("EXEC sp_CerrarSesion @sesion_id = ?", (sesion_id,))
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/asistencia/registrar")
def registrar_asistencia(data: AsistenciaSchema, db: pyodbc.Connection = Depends(get_db)):
    cursor = db.cursor()
    try:
        # Llama al Stored Procedure sp_RegistrarAsistenciaQR
        cursor.execute(
            "EXEC sp_RegistrarAsistenciaQR @token_qr = ?, @alumno_id = ?",
            (data.token, data.alumnoId)
        )
        row = cursor.fetchone()
        db.commit()

        if row:
            estado_reg = row[0]
            hora_actual = datetime.now().strftime("%H:%M")
            return {
                "id": 1,
                "sesionId": data.sesionId,
                "alumnoId": data.alumnoId,
                "hora": hora_actual,
                "estado": estado_reg.capitalize(),
                "justificada": False
            }
        raise HTTPException(status_code=400, detail="Error al procesar el registro.")
    except pyodbc.Error as err:
        db.rollback()
        # Captura los errores lanzados por RAISERROR en SQL Server
        msg = str(err.args[1]) if len(err.args) > 1 else str(err)
        raise HTTPException(status_code=400, detail=msg)

@app.put("/api/asistencia/{asistencia_id}/justificar")
def justificar_falta(asistencia_id: int, data: JustificarSchema, db: pyodbc.Connection = Depends(get_db)):
    cursor = db.cursor()
    try:
        query = "UPDATE Asistencias SET estado = 'justificado' WHERE id = ?"
        cursor.execute(query, (asistencia_id,))
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))