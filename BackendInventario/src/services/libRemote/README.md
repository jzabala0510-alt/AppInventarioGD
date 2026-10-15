# libRemote — cliente SOAP de ICG Manager (LibRemote)

Módulo para consumir el servicio SOAP `SvcRemote` de LibRemote/ICGManager:
listar facturas de venta pendientes y traer las líneas de una factura
puntual, para la pantalla de verificación de conteo contra factura.

## `clientDataSetDecoder.js`

Decodifica el binario propietario tipo "ClientDataSet" (Delphi/Borland
MIDAS) que estos métodos SOAP devuelven en sus parámetros `base64Binary`.
No tiene especificación pública — se reconstruyó por ingeniería inversa
contra muestras reales, comparando el bloque de definición de campos
(nombres en texto plano dentro del propio stream) contra los valores
decodificados hasta que tuvieron sentido de negocio (código de barras real,
montos coherentes, `numeroLinea` correlativo 1..N sin huecos, etc.).

El stream trae, antes de los datos, un **bloque de esquema autodescriptivo**
(nombre + tipo de cada campo). `decodificarLineasAlbaran` lee ese bloque en
vez de asumir un layout fijo — por eso funciona con cualquier contenido de
fila, sin depender de qué pinta tenga el código de barras. `parsearBloqueEsquema`
es reutilizable si algún día hace falta decodificar otro método de este
mismo servicio.

Validado con `node test-fixtures/libRemote/validar.js` (desde
`BackendInventario/`) contra tres muestras: `LINEAS.txt` (275 líneas reales),
`PENDIENTES.txt` (70 cabeceras reales) y
`factura_cargo_administrativo_ZZVC346.bin` (una factura real de producción
con una sola línea que **no** es un artículo físico — un cargo
administrativo con un código interno en vez de código de barras GS1 — el
caso concreto que rompía la versión anterior del decoder, basada en anclar
por el prefijo "889").

Esas tres muestras **no están en el repositorio** (son datos reales de
clientes y facturas, y el repo es público): están en `.gitignore` y solo
existen en la copia local donde se capturaron. Sin ellas, `validar.js` y
`validar_soap.js` avisan y se omiten.

### ⚠️ Limitación conocida: campos nulos en `decodificarCabecerasAlbaranVenta`

Dos campos del documento de cabeceras — `poblacionClienteProveedor` y
`nombreVendedor` — vinieron **nulos en el 100% de los 70 registros** de la
única muestra disponible (70 facturas, todas del mismo proveedor). Un campo
nulo en este formato no reserva espacio en el stream (a diferencia de un
string vacío, que sí ocupa el byte de longitud=0) — el stream simplemente
salta al siguiente campo.

El problema: no se encontró ningún bitmap de nulos ni otro mecanismo que
indique, registro por registro, cuándo un campo está presente. El decoder
de hoy **asume que esos dos campos siempre están ausentes**. Si en producción
aparece una factura real con `poblacionClienteProveedor` o `nombreVendedor`
poblados, el parseo de esa fila (y posiblemente las siguientes, si el
desalineamiento no se corrige solo) va a quedar mal.

**Antes de confiar en este decoder contra datos reales de producción**,
conseguir una muestra fresca de `Informes_GetAlbVentaCabNoRecibidos` con
varias facturas de **distintos** clientes, e idealmente alguna con vendedor
asignado, y volver a validar (o corregir) `decodificarCabecerasAlbaranVenta`
contra esa muestra antes de asumir que el resultado es correcto.

`decodificarLineasAlbaran` (líneas de factura) no tiene esta limitación — no
depende de asumir nulos en ningún campo, y ya se probó contra 275 líneas
reales de una factura y la línea de otra (con contenido bien distinto:
artículo físico con código de barras vs. cargo administrativo sin él) sin
problemas. Si algún día `decodificarCabecerasAlbaranVenta` necesita el mismo
tratamiento (parsear el esquema en vez de asumir offsets/campos ausentes),
el camino ya está probado — es cuestión de aplicar el mismo método.
