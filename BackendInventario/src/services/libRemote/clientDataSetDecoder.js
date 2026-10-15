// Decodificador del formato binario "ClientDataSet" (Delphi/Borland MIDAS) que
// devuelve LibRemote/ICGManager en los parametros base64Binary de sus metodos
// SOAP (DataLineas, Data). No es un formato con especificacion publica -- se
// reconstruyo por ingenieria inversa comparando el bloque de definicion de
// campos (nombres en texto plano) contra los bytes de datos reales, hasta que
// los valores decodificados tuvieron sentido de negocio.
//
// El stream trae, antes de los datos, un bloque de esquema AUTODESCRIPTIVO:
// una cabecera fija de 32 bytes (con la cantidad de campos y de registros),
// seguida de una entrada por cada campo (nombre, tipo, y si el tipo lo
// necesita, un bloque de propiedades -- WIDTH, y a veces SUBTYPE). Parsear
// ese bloque en vez de asumir un layout fijo es lo que hace que
// decodificarLineasAlbaran funcione con CUALQUIER contenido de fila -- ver
// parsearBloqueEsquema().
//
// Dos documentos soportados hoy, cada uno con su propio "hueco" antes de
// cada registro de datos (constante, descubierto empiricamente comparando
// contra muestras reales, no documentado en ningun lado):
//   - lineasAlbaran: lineas de un albaran/factura de venta o compra
//     (Documento_GetLineasAlbVenta/CompraU). 11 bytes entre el fin del
//     esquema y el primer registro; 9 bytes entre cada registro y el
//     siguiente. Robusto: no asume nada del contenido de las filas (antes
//     dependia de que el codigo de barras empezara por "889", lo cual
//     rompia con lineas que no son de un articulo fisico -- ej. cargos
//     administrativos con un codigo interno en vez de un codigo de barras
//     real).
//   - cabecerasAlbaranVenta: cabeceras de albaranes de venta pendientes
//     (Informes_GetAlbVentaCabNoRecibidos). Prefijo fijo de 8 bytes antes de
//     CADA registro (incluido el primero).
//
// IMPORTANTE (limitacion conocida): en cabecerasAlbaranVenta hay dos campos
// (POBLACIONCLIPROV, NOMBREVENDEDOR) que en la unica muestra disponible para
// reversear el formato (70 facturas, un solo proveedor) vinieron nulos en el
// 100% de los casos, y un campo nulo no reserva espacio en el stream (a
// diferencia de un string vacio). No se encontro un bitmap de nulos ni ningun
// otro mecanismo que indique, fila por fila, cuando un campo esta presente --
// por eso este decoder los asume SIEMPRE ausentes. Si algun dia aparece una
// fila real con esos campos poblados, el parseo de esa fila (y posiblemente
// las siguientes) va a quedar desalineado. Ver README de este directorio.

/** Envuelve un Buffer con un cursor de lectura secuencial little-endian. */
export class LectorSecuencial {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
  }

  quedanBytes(n) {
    return this.pos + n <= this.buf.length;
  }

  i16() {
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  f8() {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  byte() {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  // Nombres de campo/propiedad DENTRO del bloque de esquema: 1 byte de largo
  // + esa cantidad de bytes en ASCII/latin1 de un byte por caracter -- a
  // diferencia de los VALORES de los registros (str1/str2), que van en
  // UTF-16LE. Dos codificaciones de texto distintas conviven en el mismo
  // stream segun la seccion.
  str1Ascii() {
    const n = this.byte();
    const v = this.buf.toString('latin1', this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  // Texto de largo variable: 1 byte de longitud (EN BYTES, no en caracteres)
  // + esa cantidad de bytes en UTF-16LE.
  str1() {
    const n = this.byte();
    const v = this.buf.toString('utf16le', this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  // Igual que str1 pero con 2 bytes de longitud (campos declarados con ancho
  // > 255, donde un solo byte no alcanza para expresar el largo maximo).
  str2() {
    const n = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    const v = this.buf.toString('utf16le', this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  saltar(n) {
    this.pos += n;
  }
}

// Tipos de campo vistos en el bloque de esquema (mismos codigos usa el nivel
// de "propiedad" adentro de un campo, con otro significado -- ver mas abajo).
const TIPO_ENTERO = 4; // i32
const TIPO_DOBLE = 8; // f8 (double)
const TIPO_CORTO = 2; // i16
const TIPO_TEXTO = 1; // string (1 byte de largo + UTF-16LE), necesita bloque de propiedades

/**
 * Parsea el bloque de esquema autodescriptivo que trae CUALQUIER respuesta
 * de este servicio antes de los datos: cabecera fija de 32 bytes (con la
 * cantidad de campos y de registros), seguida de una entrada por campo
 * (nombre + tipo, y si el tipo es texto, un bloque de propiedades -- WIDTH
 * siempre, a veces tambien SUBTYPE). No hace falta entender el VALOR de las
 * propiedades para nada de lo que necesitamos (los datos reales van
 * despues), asi que se leen solo para saber cuantos bytes ocupan y poder
 * saltarlas.
 *
 * Devuelve la lista de [nombre, tipo] en el orden real del stream, la
 * cantidad de registros declarada, y la posicion donde termina el bloque
 * (arranca el primer registro despues de un "hueco" fijo que varia por
 * documento -- ver los MARCADOR_* de cada decoder).
 */
function parsearBloqueEsquema(buffer) {
  const lector = new LectorSecuencial(buffer);
  lector.i32(); lector.i32(); lector.i32(); lector.i32(); lector.i32(); // cabecera de 20 bytes, contenido no usado
  const numCampos = lector.i16();
  const numRegistros = lector.i32();
  lector.i32(); // constante, no usada
  lector.saltar(2); // marcador de 2 bytes antes del bloque de campos

  const campos = [];
  for (let i = 0; i < numCampos; i++) {
    const nombre = lector.str1Ascii();
    const tipo = lector.i16();
    if (tipo === TIPO_ENTERO || tipo === TIPO_DOBLE || tipo === TIPO_CORTO) {
      // Campo numerico de tamano fijo: trailer constante de 6 bytes, sin
      // bloque de propiedades (un numero no necesita declarar un WIDTH).
      lector.i16();
      lector.i32();
    } else if (tipo === TIPO_TEXTO) {
      lector.i32(); // constante, no representa un largo a saltar (se confirmo por ensayo y error)
      const numProps = lector.i16();
      for (let p = 0; p < numProps; p++) {
        const nombreProp = lector.str1Ascii();
        const tipoProp = lector.i16();
        if (tipoProp === TIPO_ENTERO) {
          // Propiedad de valor numerico (WIDTH): [i16 constante=1][i32 valor]
          lector.i16();
          lector.i32();
        } else if (tipoProp === TIPO_CORTO) {
          // Propiedad de valor texto (ej. SUBTYPE="FixedChar"): [i16 constante][i16 largo][largo bytes ASCII, incluye un \0 final]
          lector.i16();
          const largo = lector.i16();
          lector.saltar(largo);
        } else {
          throw new Error(
            `Tipo de propiedad desconocido (${tipoProp}) en el campo "${nombre}.${nombreProp}" `
            + `del bloque de esquema, pos=${lector.pos}`,
          );
        }
      }
    } else {
      throw new Error(`Tipo de campo desconocido (${tipo}) para "${nombre}" en el bloque de esquema, pos=${lector.pos}`);
    }
    campos.push([nombre, tipo]);
  }

  return { campos, numRegistros, finEsquema: lector.pos };
}

// FECHA viene como "milisegundos desde 0001-01-01" (no es OLE Date estandar).
export function fechaAIso(valor) {
  if (!Number.isFinite(valor)) return null;
  const dias = valor / 1000 / 86400;
  // Date.UTC(1,1,1) en JS no representa el año 1 correctamente (Date usa
  // 1900 como pivote para años de 2 digitos), asi que se ancla en un año
  // seguro (2001, multiplo de 400 => mismos años bisiestos que el año 1) y
  // se corrige el offset de dias entre 0001-01-01 y 2001-01-01.
  const DIAS_ENTRE_0001_Y_2001 = 730485;
  const ms = Date.UTC(2001, 0, 1) + (dias - DIAS_ENTRE_0001_Y_2001) * 86400 * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Documento: lineas de un albaran de venta/compra
// (Documento_GetLineasAlbVentaU / Documento_GetLineasAlbCompraU)
// ---------------------------------------------------------------------------

// Nombre del stream (tal como lo declara el propio bloque de esquema) ->
// nombre legible de salida. Ya no hace falta declarar el TIPO de cada campo
// aca -- se lee del esquema mismo (ver parsearBloqueEsquema).
const NOMBRES_LINEA = {
  CODARTICULO: 'codigoArticulo',
  CODBARRAS: 'codigoBarras',
  REFERENCIA: 'referencia',
  TALLA: 'talla',
  COLOR: 'color',
  UNID1: 'cantidad',
  UNID2: 'unid2',
  UNID3: 'unid3',
  UNID4: 'unid4',
  PRECIOCOMPRA: 'precioCompra',
  DTO: 'descuentoPct',
  UNIDALTERNATIVAS: 'unidadesAlternativas',
  DESCRIPCION: 'descripcion',
  EMBALAJE: 'embalaje',
  FECHA: 'fecha',
  TIPOIMPUESTO: 'tipoImpuesto',
  IVA: 'iva',
  REQ: 'recargoEquivalencia',
  CODMONEDA: 'codigoMoneda',
  FACTORMONEDA: 'factorMoneda',
  UDMEDIDA2: 'unidadMedida2',
  SUPEDIDO: 'pedidoOrigen',
  LINEAOCULTA: 'lineaOculta',
  CARGO1: 'cargo1',
  CARGO2: 'cargo2',
  USARNUMSERIE: 'usarNumSerie',
  CODFORMATO: 'codigoFormato',
  DESCFORMATO: 'descFormato',
  NUMLIN: 'numeroLinea',
};

// Huecos constantes (descubiertos empiricamente contra datos reales, ver
// comentario de cabecera del archivo): 11 bytes entre el fin del bloque de
// esquema y el primer registro; 9 bytes entre cada registro y el siguiente.
const MARCADOR_LINEA_INICIAL = 11;
const MARCADOR_LINEA_ENTRE = 9;

function leerValorSegunTipoSchema(lector, tipo) {
  switch (tipo) {
    case TIPO_ENTERO: return lector.i32();
    case TIPO_CORTO: return lector.i16();
    case TIPO_DOBLE: return lector.f8();
    case TIPO_TEXTO: return lector.str1();
    default: throw new Error(`Tipo de campo desconocido en los datos: ${tipo}`);
  }
}

/**
 * Decodifica el binario (ya sin el base64) de un Documento_GetLineasAlb*.
 * Devuelve un array de lineas con nombres de campo legibles.
 *
 * A diferencia de una version anterior de este decoder, no depende en nada
 * del CONTENIDO de las filas (antes anclaba buscando un codigo de barras que
 * empezara por "889", lo que fallaba con lineas que no son de un articulo
 * fisico -- cargos administrativos, descuentos, etc., que traen un codigo
 * interno en vez de un codigo de barras real). Ahora lee el bloque de
 * esquema del propio stream y camina los registros secuencialmente.
 */
export function decodificarLineasAlbaran(buffer) {
  const { campos, numRegistros, finEsquema } = parsearBloqueEsquema(buffer);

  const lineas = [];
  let pos = finEsquema + MARCADOR_LINEA_INICIAL;
  for (let i = 0; i < numRegistros; i++) {
    const lector = new LectorSecuencial(buffer);
    lector.pos = pos;
    const registro = {};
    for (const [nombreStream, tipo] of campos) {
      const nombreSalida = NOMBRES_LINEA[nombreStream] ?? nombreStream;
      registro[nombreSalida] = leerValorSegunTipoSchema(lector, tipo);
    }
    registro.fecha = fechaAIso(registro.fecha);
    registro.lineaOculta = String(registro.lineaOculta).trim() === 'T';
    registro.usarNumSerie = String(registro.usarNumSerie).trim() === 'T';
    lineas.push(registro);
    pos = lector.pos + MARCADOR_LINEA_ENTRE;
  }
  return lineas;
}

// ---------------------------------------------------------------------------
// Documento: cabeceras de albaranes de venta pendientes
// (Informes_GetAlbVentaCabNoRecibidos / U)
// ---------------------------------------------------------------------------

// Lector por tipo declarado a mano (string corto), usado por el decoder de
// cabeceras -- a diferencia de lineasAlbaran, este todavia no deriva el tipo
// del propio bloque de esquema (ver limitacion conocida mas abajo).
function leerCampo(lector, tipo) {
  switch (tipo) {
    case 'i4': return lector.i32();
    case 'i2': return lector.i16();
    case 'f8': return lector.f8();
    case 'str1': return lector.str1();
    case 'str2': return lector.str2();
    default: throw new Error(`Tipo de campo desconocido: ${tipo}`);
  }
}

// 'skip' = campo que en la muestra de referencia vino nulo en el 100% de los
// registros y no reserva espacio en el stream. Ver limitacion conocida en el
// comentario de cabecera de este archivo.
const CAMPOS_CABECERA = [
  ['serie', 'str1'],
  ['numero', 'i4'],
  ['n', 'str1'],
  ['fecha', 'f8'],
  ['codigoClienteProveedor', 'i4'],
  ['nombreClienteProveedor', 'str2'],
  ['direccionClienteProveedor', 'str2'],
  ['codigoPostalClienteProveedor', 'str1'],
  ['poblacionClienteProveedor', 'skip'],
  ['codigoVendedor', 'i4'],
  ['nombreVendedor', 'skip'],
  ['descuentoComercialPct', 'f8'],
  ['totalDescuentoComercial', 'f8'],
  ['descuentoProntoPagoPct', 'f8'],
  ['totalDescuentoProntoPago', 'f8'],
  ['bruto', 'f8'],
  ['impuestos', 'f8'],
  ['neto', 'f8'],
  ['codigoMoneda', 'i4'],
  ['factorMoneda', 'f8'],
  ['sufijoDocumento', 'str1'],
  ['inicialesMoneda', 'str1'],
  ['decimalesMoneda', 'i2'],
  ['idTipoDocumento', 'i4'],
  ['prestamoDeposito', 'str1'],
];

// Offset del primer registro dentro del binario decodificado (bloque de
// definicion de campos + cabecera del dataset). Prefijo constante de 8 bytes
// que precede a CADA registro (incluido el primero, ya contemplado en
// REGISTRO_CABECERA_INICIO).
const REGISTRO_CABECERA_INICIO = 706;
const MARCADOR_CABECERA = 8;

function parsearRegistroCabecera(buffer, inicio) {
  const lector = new LectorSecuencial(buffer);
  lector.pos = inicio;
  const registro = {};
  for (const [nombre, tipo] of CAMPOS_CABECERA) {
    if (tipo === 'skip') {
      registro[nombre] = null;
      continue;
    }
    registro[nombre] = leerCampo(lector, tipo);
  }
  return { registro, fin: lector.pos };
}

/**
 * Decodifica el binario (ya sin el base64) de Informes_GetAlbVentaCabNoRecibidos.
 * A diferencia del documento de lineas, aca se camina secuencialmente desde
 * un offset de inicio conocido en vez de anclar por patron -- no hay un campo
 * con prefijo reconocible como el codigo de barras para usar de ancla.
 */
export function decodificarCabecerasAlbaranVenta(buffer) {
  const cabeceras = [];
  let pos = REGISTRO_CABECERA_INICIO;
  while (pos < buffer.length) {
    // Un registro real trae, como minimo, los primeros campos fijos (SERIE
    // corto + NUMERO + N + FECHA + CODCLIPROV = unos 25 bytes minimo antes
    // del nombre, que es variable). Si queda menos que eso, lo que resta es
    // padding final del stream, no otro registro.
    if (buffer.length - pos < 30) break;
    const { registro, fin } = parsearRegistroCabecera(buffer, pos);
    registro.fecha = fechaAIso(registro.fecha);
    registro.sufijoDocumento = registro.sufijoDocumento.trim();
    registro.prestamoDeposito = registro.prestamoDeposito.trim() === 'T';
    cabeceras.push(registro);
    pos = fin + MARCADOR_CABECERA;
  }
  return cabeceras;
}
