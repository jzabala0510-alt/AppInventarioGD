# AppInventario

Reemplazo en Node.js/Express + Vue 3 del backend legacy **`Reposiciones.war`**
(Java/GlassFish) — app interna para conteo de inventario, reposición y
verificación de facturas de venta en tiendas retail que usan **ICG Manager**
como POS/ERP.

Corre como servicio de Windows (vía NSSM) directamente sobre la base de datos
de ICG (tablas nativas como `ARTICULOS`, `STOCKS`, `ALMACEN`,
`ALBVENTACAB`/`ALBVENTALIN`, …), sumando un esquema propio (`rip.*` /
`ripWsRep.*`) para todo lo que el conteo necesita y que ICG no modela.

## Índice

- [Qué hace la app](#qué-hace-la-app)
- [Arquitectura](#arquitectura)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Módulos principales](#módulos-principales)
- [Variables de entorno](#variables-de-entorno)
- [Desarrollo local](#desarrollo-local)
- [Despliegue en producción (NSSM)](#despliegue-en-producción-nssm)
- [Base de datos: cómo se despliega y actualiza el esquema](#base-de-datos-cómo-se-despliega-y-actualiza-el-esquema)
- [Integración con ICG Manager (LibRemote)](#integración-con-icg-manager-libremote)
- [Notas de seguridad](#notas-de-seguridad)

## Qué hace la app

- **Conteo de inventario**: crea conteos por almacén, los divide en bloques,
  permite escanear artículos (código de barras) y compara lo contado contra
  el stock vivo de ICG y contra lo **vendido durante el período del conteo**
  (recalculado en vivo cada vez que se abre el reporte — ver
  [Módulos principales](#conteo-y-cálculo-de-vendidas)). Exporta diferencias
  a Excel.
- **Órdenes de reposición**: búsqueda de artículos y generación de órdenes
  (heredado del módulo `ArticuloResource`/`orden` del backend Java original).
- **Verificar factura / Telestock**: selecciona una factura de venta
  pendiente (traída en vivo desde ICG vía **LibRemote**), escanea
  físicamente lo que se está separando/empacando, bloquea cualquier escaneo
  que no pertenezca a esa factura, y al cerrar genera un `StockMov.txt`
  (formato Telestock de ICG) listo para importar.
- **Actualizador**: la propia app se autoactualiza descargando la última
  versión del código desde este repositorio de GitHub, sin necesitar acceso
  remoto al servidor.
- **Configuración de base de datos** desde la propia interfaz: permite
  apuntar la app a otra base de datos SQL Server sin tocar archivos a mano
  (pensado para cuando una tienda cambia de servidor).

## Arquitectura

- **Backend**: Node.js (ESM, `type: module`) + Express, `mssql` para SQL
  Server, autenticación propia con JWT (compatible con el formato de tokens
  del backend Java anterior).
- **Frontend**: Vue 3 + Vite + Pinia. Se compila a estático
  (`InventarioWebVue/dist`) y **se sirve desde el mismo proceso Express** —
  un solo servicio de Windows que hay que actualizar y reiniciar, en vez de
  dos.
- **Base de datos**: SQL Server. Usa las tablas nativas de ICG tal cual están
  (solo lectura en su mayoría) y agrega su propio esquema (`rip.*` para el
  conteo, `ripWsRep.*` para reportes web) mediante un único script SQL
  idempotente (ver más abajo).
- **Despliegue**: servicio de Windows administrado con
  [NSSM](https://nssm.cc/) (binario incluido en [`nssm-2.24/`](nssm-2.24)),
  configurado para reiniciarse solo si el proceso termina — esto es lo que
  hace posible el autoactualizador.

## Estructura del repositorio

```
BackendInventario/
  src/
    routes/          — un router por área (conteo, orden, sql, actualizador, telestock, ...)
    services/        — lógica de negocio y acceso a datos
      libRemote/      — cliente SOAP de ICG Manager + decoder del formato binario ClientDataSet
    db/pool.js        — pool de conexión mssql, reconfigurable en caliente
    middleware/       — auth (JWT), manejo de errores, logging de requests
    config/env.js     — lectura y validación de variables de entorno
    resources/
      scriptConteo.sql — script único e idempotente que crea/actualiza TODO el esquema propio (tablas + stored procedures)
      passbd.json       — presets de conexión (NO se versiona, ver .gitignore)
    data/             — estado runtime (config de conexión activa, sesiones de Telestock) — NO se versiona
    static/descargas/ — APKs descargables vía QR desde /descargas
  test-fixtures/      — scripts de validación manual (node directo, no hay framework de tests formal)
InventarioWebVue/
  src/
    views/            — una pantalla por vista (Login, Conteo, Telestock, Configuración, Actualizador, ...)
    components/
    stores/           — estado global con Pinia (auth)
    router/           — rutas de Vue Router
    services/         — clientes axios hacia el backend
nssm-2.24/            — binario de NSSM (win32/win64) para instalar el servicio de Windows
Manual-AppInventario.pdf — manual de uso original
```

## Módulos principales

### Conteo y cálculo de "Vendidas"

Archivos: [`routes/conteo.js`](BackendInventario/src/routes/conteo.js),
[`services/conteoService.js`](BackendInventario/src/services/conteoService.js),
[`services/conteoBatchService.js`](BackendInventario/src/services/conteoBatchService.js),
[`services/excelService.js`](BackendInventario/src/services/excelService.js).

Un conteo (`rip.CONTEOCAB`) se divide en bloques y cada escaneo queda como
una línea (`rip.CONTEOLIN`) con su hora exacta (`HORACONTEO`). Al abrir el
reporte o exportar a Excel, la columna **Vendidas** se recalcula **en vivo**
en el propio SQL (CTEs `CTE_VENTAS` / `CTE_CONTEO_REAL` / `CTE_VENDIDO`
dentro de `scriptConteo.sql`): compara, para cada artículo, la hora de cada
venta contra la hora en que se contó, de forma que solo cuenta como
"vendido durante el conteo" lo que se vendió después de haberlo contado.
Es intencional que salga 0 cuando la venta ocurrió antes de contar el
artículo.

### Órdenes de reposición

Archivos: [`routes/orden.js`](BackendInventario/src/routes/orden.js),
[`services/ordenService.js`](BackendInventario/src/services/ordenService.js).

Búsqueda de artículos y generación de órdenes de reposición. Heredado del
`ArticuloResource` del backend Java (el nombre de la clase no coincidía con
su `@Path` real, que ya era `orden`).

### Configuración de base de datos

Archivos: [`routes/sql.js`](BackendInventario/src/routes/sql.js),
[`services/sqlConfigService.js`](BackendInventario/src/services/sqlConfigService.js).

Pantalla pública (no requiere login, a propósito: si la base de datos no
está configurada, nadie podría loguearse para arreglarlo) que permite
probar y guardar los datos de conexión a SQL Server desde la propia app.
Al guardar una conexión válida, además **ejecuta automáticamente**
`scriptConteo.sql` contra esa base — ver
[Base de datos](#base-de-datos-cómo-se-despliega-y-actualiza-el-esquema).

### Actualizador (self-update)

Archivos: [`routes/actualizador.js`](BackendInventario/src/routes/actualizador.js),
[`services/actualizadorService.js`](BackendInventario/src/services/actualizadorService.js).

Descarga el zip de la rama configurada de este repositorio
(`codeload.github.com`, sin necesitar token porque el repo es accesible para
la cuenta configurada), lo extrae sobre la instalación actual respetando una
lista de rutas protegidas (`.env`, `logs/`, `node_modules/`, `data/`,
`TeleStock/`, `src/resources/passbd.json`, …) para no pisar configuración ni
datos propios de la tienda, y termina el proceso a propósito
(`process.exit(0)`) confiando en que **NSSM** (configurado con reinicio
automático) lo vuelva a levantar ya con el código nuevo. Incluye reintentos
y logging del error real (`err.cause`) para los fallos de red intermitentes.

### Verificar factura / Telestock (integración con LibRemote)

Archivos: [`routes/telestock.js`](BackendInventario/src/routes/telestock.js),
[`services/telestockSesionService.js`](BackendInventario/src/services/telestockSesionService.js),
[`services/libRemote/`](BackendInventario/src/services/libRemote/).

Flujo: se listan las facturas de venta pendientes de una tienda (vía SOAP
LibRemote de ICG Manager), se elige una, se trae el detalle de sus líneas, y
se abre una sesión de verificación. Cada escaneo se valida contra las líneas
de esa factura — un código que no pertenezca se rechaza con `422`. Al cerrar
la sesión se genera un `StockMov.txt` (formato Telestock de ICG,
`IDMov|CodArticulo|Talla|Color|Unidades|Precio|Dto|Total|CodBarras|`) que se
guarda en `TeleStock/StockMov-<fecha de la factura>/<serie>-<numero>/StockMov.txt`
(el nombre del archivo es fijo, exigido por ICG) y se ofrece también como
descarga desde el navegador.

Detalle completo del protocolo SOAP y del formato binario propietario que
decodifica (`ClientDataSet`, reconstruido por ingeniería inversa) en
[`services/libRemote/README.md`](BackendInventario/src/services/libRemote/README.md).

### Autenticación

Archivo: [`middleware/auth.js`](BackendInventario/src/middleware/auth.js).

JWT propio, firmado con HMAC-SHA256 usando el mismo formato de secreto que
el backend Java anterior (`JWT_SECRET_BASE64` decodificado a bytes crudos),
para poder seguir aceptando tokens ya emitidos.

## Variables de entorno

Configurar en `BackendInventario/.env` (ver
[`.env.example`](BackendInventario/.env.example) como plantilla):

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PORT` | no (default `8085`) | Puerto donde escucha el backend. |
| `BASE_PATH` | no (default `/recursos`) | Prefijo de la API — se mantiene `/Reposiciones/recursos` por compatibilidad con clientes existentes. |
| `DB_HOST`, `DB_PORT`, `DB_INSTANCE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | no | Conexión a SQL Server. El backend arranca igual sin esto configurado (para que la pantalla Configuración > Base de datos sea alcanzable en una instalación nueva). |
| `JWT_SECRET_BASE64` | **sí** | Secreto de firma de JWT, en Base64. |
| `JWT_EXPIRES_IN` | no (default `8h`) | Expiración de los tokens nuevos. |
| `UPDATER_PASSWORD` | no | Clave para autorizar una actualización desde la pantalla del Actualizador. |
| `UPDATER_REPO_OWNER`, `UPDATER_REPO_NAME`, `UPDATER_REPO_BRANCH` | no | Repositorio de GitHub del que se autoactualiza (default de rama: `main`). |
| `LIBREMOTE_BASE_URL`, `LIBREMOTE_USUARIO`, `LIBREMOTE_PASSWORD` | no | Servicio SOAP `SvcRemote` de ICG Manager, para el módulo Telestock. Sin esto configurado, el módulo simplemente reporta que no está disponible. |

## Desarrollo local

Requiere Node.js 18+ (usa `fetch` nativo).

```bash
# Backend
cd BackendInventario
npm install
cp .env.example .env   # completar los valores necesarios
npm run dev             # node --watch, recarga sola al guardar

# Frontend (en otra terminal)
cd InventarioWebVue
npm install
npm run dev              # Vite, con proxy hacia el backend
```

## Despliegue en producción (NSSM)

1. `npm install` + `npm run build` en `InventarioWebVue/` (genera
   `InventarioWebVue/dist`, que el backend sirve como estático).
2. `npm install --omit=dev` en `BackendInventario/`.
3. Registrar `BackendInventario/src/server.js` como servicio con NSSM
   (binario en [`nssm-2.24/`](nssm-2.24)), con la acción de salida
   (**AppExit**) en **Restart** — de esto depende que el Actualizador
   funcione, ya que se apoya en que el servicio se relance solo tras un
   `process.exit(0)`.
4. Completar `BackendInventario/.env` en el servidor (nunca se versiona).

## Base de datos: cómo se despliega y actualiza el esquema

Todo el esquema propio (tablas `rip.*`, stored procedures de conteo y
reportes) vive en un único archivo:
[`BackendInventario/src/resources/scriptConteo.sql`](BackendInventario/src/resources/scriptConteo.sql).
Es **idempotente**: cada tabla se crea solo si no existe
(`IF NOT EXISTS ... CREATE TABLE`), y cada procedimiento se recrea con
`IF EXISTS(...) DROP PROCEDURE` seguido de `CREATE PROCEDURE ... WITH
ENCRYPTION`.

Esto se ejecuta automáticamente, sin intervención manual, en dos momentos:

- **Al arrancar el backend** (`server.js`), si hay una base de datos
  configurada y alcanzable.
- **Al guardar una conexión** válida desde Configuración > Base de datos
  (`sqlConfigService.js`).

En la práctica, esto significa que usar el **Actualizador** (que reinicia el
proceso al terminar) ya aplica cualquier cambio de esquema/SP incluido en el
commit que se está desplegando — no hace falta correr nada a mano en SQL
Server Management Studio.

> ⚠️ Como los procedimientos se crean con `WITH ENCRYPTION`, su definición
> **no es recuperable desde la base de datos** una vez creados — este
> archivo `.sql` es la única fuente de verdad. Cualquier cambio a un
> procedimiento tiene que hacerse editando `scriptConteo.sql`, nunca
> directamente contra el servidor.

## Integración con ICG Manager (LibRemote)

El módulo de Telestock consume el servicio SOAP 1.1 `SvcRemote` de ICG
Manager (RemObjects SDK) mediante un cliente hecho a mano (sin WSDL/librería
SOAP), incluyendo un decodificador del formato binario propietario
"ClientDataSet" (Delphi/Borland MIDAS) que ICG usa para devolver listas de
facturas y líneas. Documentación técnica completa, decisiones de diseño y
limitaciones conocidas en
[`BackendInventario/src/services/libRemote/README.md`](BackendInventario/src/services/libRemote/README.md).

## Notas de seguridad

- Pensada como herramienta **interna de LAN**, no expuesta a internet (CSP
  deshabilitado a propósito en `app.js` para poder cargar fuentes de Google
  Fonts sin fricción).
- Nada de credenciales se versiona: `.env`, `passbd.json` y `data/` están en
  `.gitignore`. Usar siempre `.env.example` como referencia de qué variables
  hacen falta, nunca copiar un `.env` real entre entornos.
- Las contraseñas de conexión a base de datos que persiste la app se
  guardan cifradas, nunca en texto plano.
