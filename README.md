# PianoStudy — Aplicación de Estudio para Pianistas

Aplicación web para pianistas que permite grabar sesiones de práctica, gestionar una biblioteca de licks, editar frases musicales, seguir el progreso diario y descubrir artistas de referencia. Desplegada en **Netlify** con **Supabase** como backend.

---

## 🎹 Características

### 🎙️ Grabador de Sesiones
- Detección automática de dispositivos de audio (USB, interfaz, integrado)
- Visualización en tiempo real con waveform y medidores de nivel
- Grabación con backing track para practicar con acompañamiento
- Historial de grabaciones sincronizado con Supabase Storage

### 🎵 Biblioteca de Licks
- Licks personales organizados por estilo musical: Blues, Bebop, Hard-bop, Latin Jazz, Son Cubano, Bolero, Jazz Colombiano
- Subida de audio por lick almacenado en Supabase Storage
- Cola de estudio con loop y reordenamiento por drag & drop
- Sistema de recomendaciones diarias

### ✂️ Editor de Frases
- Selección visual de fragmentos sobre el waveform de la grabación
- Reproducción del fragmento seleccionado
- Guardado de frases con nombre personalizado
- Exportación de frases a la biblioteca de licks

### � Frases de YouTube
- Extracción de frases desde videos de YouTube por URL
- Marcado de inicio/fin con reproductor integrado
- Filtrado por estilo musical
- Guardado en biblioteca local

### 🏆 Seguimiento de Progreso
- Cronómetro de sesión con historial diario
- Gráfico de minutos practicados por día (últimos 7 días)
- Totales acumulados por semana y mes
- Persistencia en Supabase

### 🎨 Artistas y Descubrimiento
- Catálogo de artistas de referencia por estilo
- Artistas personalizados agregados por el usuario
- Sistema de favoritos por usuario
- Piezas favoritas con notas personales

### 👤 Autenticación
- Registro e inicio de sesión con email/contraseña vía Supabase Auth
- Login alternativo por nombre de usuario
- Recuperación de contraseña por pregunta de seguridad
- Todos los datos vinculados al usuario autenticado

---

## 🚀 Despliegue en Netlify

### Pasos

1. Haz fork o clona este repositorio
2. Ve a [netlify.com](https://netlify.com) → **Add new site → Import an existing project**
3. Conecta tu repositorio de GitHub
4. Configuración de build:
   - **Build command**: *(dejar vacío — es un sitio estático)*
   - **Publish directory**: `.` (raíz del proyecto)
5. Haz clic en **Deploy site**

No se requiere proceso de build. El sitio se sirve directamente desde los archivos estáticos.

### Variables de entorno

No se usan variables de entorno en el cliente. Las credenciales de Supabase están en `assets/js/modules/supabase-client.js`. Si quieres protegerlas, usa [Netlify environment variables](https://docs.netlify.com/environment-variables/overview/) e inyéctalas en el build.

---

## ☁️ Configuración de Supabase

### 1. Crear proyecto

Ve a [supabase.com](https://supabase.com), crea un nuevo proyecto y copia la **URL** y la **anon key** en `assets/js/modules/supabase-client.js`.

### 2. Tablas — SQL Editor

Ejecuta el siguiente SQL completo en **SQL Editor** de tu proyecto Supabase:

```sql
-- Licks
create table if not exists licks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  style text default '',
  notes text default '',
  file_path text,
  order_index integer default 0,
  created_at timestamptz default now()
);

-- Grabaciones
create table if not exists recordings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  duration integer default 0,
  file_path text not null,
  created_at timestamptz default now()
);

-- Artistas personalizados
create table if not exists custom_artists (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  style text default '',
  description text default '',
  tags text[] default '{}',
  created_at timestamptz default now()
);

-- Perfiles de usuario (login por username + recuperación de contraseña)
create table if not exists user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text unique,
  security_question text,
  created_at timestamptz default now()
);

-- Sesiones de práctica
create table if not exists practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  duration_seconds integer not null default 0,
  date date not null,
  created_at timestamptz default now()
);

-- Row Level Security
alter table licks enable row level security;
alter table recordings enable row level security;
alter table custom_artists enable row level security;
alter table user_profiles enable row level security;
alter table practice_sessions enable row level security;

create policy "usuarios ven sus licks" on licks
  for all using (auth.uid()::text = user_id);

create policy "usuarios ven sus grabaciones" on recordings
  for all using (auth.uid()::text = user_id);

create policy "usuarios ven sus artistas" on custom_artists
  for all using (auth.uid()::text = user_id);

create policy "usuarios gestionan su perfil" on user_profiles
  for all using (auth.uid() = id);

create policy "usuarios ven sus sesiones" on practice_sessions
  for all using (auth.uid() = user_id);

-- Función RPC: resolver username → email (sin exponer la tabla directamente)
create or replace function get_email_by_username(p_username text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select email
  from user_profiles
  where lower(username) = lower(p_username)
  limit 1;
$$;

revoke all on function get_email_by_username(text) from public;
grant execute on function get_email_by_username(text) to anon, authenticated;

-- Backfill para usuarios ya existentes (ejecutar una sola vez)
insert into user_profiles (id, email, username, security_question)
select
  au.id,
  au.email,
  au.raw_user_meta_data->>'username',
  au.raw_user_meta_data->>'securityQuestion'
from auth.users au
where not exists (
  select 1 from user_profiles up where up.id = au.id
)
on conflict (id) do update
  set
    username = excluded.username,
    security_question = excluded.security_question;
```

### 3. Storage bucket

1. Ve a **Storage** en el Dashboard de Supabase
2. Crea un bucket llamado `recordings` con **acceso público habilitado**
3. Ejecuta estas políticas en el SQL Editor:

```sql
CREATE POLICY "usuarios suben sus archivos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'recordings');

CREATE POLICY "lectura publica recordings"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'recordings');
```

### 4. Autenticación

En **Authentication → Settings** de Supabase:
- Habilita **Email provider**
- Configura la **Site URL** con la URL de tu sitio en Netlify (ej. `https://tu-sitio.netlify.app`)
- Agrega la misma URL en **Redirect URLs**

---

## 💾 Almacenamiento local

Solo se usa `localStorage` para preferencias ligeras por usuario:

| Clave | Contenido |
|---|---|
| `pianostudy_metronome` | Preferencias del metrónomo |
| `pianostudy-youtube-phrases_<user>` | Frases de YouTube guardadas |
| `pianostudy-liked-artists_<user>` | Artistas con like |
| `pianostudy-favorite-pieces_<user>` | Piezas favoritas |

---

## 🛠️ Requisitos técnicos

### Navegadores compatibles
- Chrome 90+
- Firefox 85+
- Safari 15+
- Edge 90+

### Permisos necesarios
- **Micrófono** — para grabación de sesiones
- **Almacenamiento local** — para preferencias

### Dispositivos de audio soportados
- Micrófonos USB
- Interfaces de audio (USB / Thunderbolt)
- Micrófono integrado
- Micrófono Bluetooth (funcionalidad limitada según navegador)

---

## 🐛 Solución de problemas

**No se detecta el micrófono**
- Verifica que el navegador tenga permiso de micrófono
- Asegúrate de que el dispositivo esté conectado antes de abrir la app
- Recarga la página y vuelve a intentar

**La grabación no se guarda en la nube**
- Verifica que estés autenticado (sesión iniciada)
- Revisa que el bucket `recordings` exista en Supabase con las políticas correctas
- Abre DevTools → Console para ver el error exacto

**No puedo iniciar sesión con mi username**
- Asegúrate de haber ejecutado el backfill SQL de `user_profiles`
- Verifica que la función `get_email_by_username` esté creada en Supabase

---

## 🔮 Funciones futuras

### Análisis con IA *(en desarrollo)*
El código base ya incluye la integración con **Google Gemini** para análisis automático de grabaciones: detección de tempo, tonalidad, dinámica y feedback personalizado. Esta función está deshabilitada en la versión actual (`ENABLE_AI = false` en `app.js`) y se activará en una próxima versión cuando la integración esté lista para producción.

Para reactivarla cuando esté lista:
1. Cambiar `const ENABLE_AI = false` → `true` en `app.js`
2. Descomentar el import de `AIAnalysisEngine` en `app.js`
3. Quitar `style="display:none"` de los elementos de IA en `index.html`
4. Desplegar la Edge Function `gemini-proxy` en Supabase

---

## 📄 Licencia

MIT — ver [LICENSE](LICENSE) para detalles.

---

**¡Feliz práctica! 🎹**
