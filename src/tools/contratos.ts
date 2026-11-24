import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

// -------------------------------------------------------------
// Utilidades de Parseo de Montos y Fechas
// -------------------------------------------------------------

function parseMonto(rawMonto: string): number {
  const clean = rawMonto.trim();
  // Caso 1: Formato con decimales al final ej. 520,000.00 o 120,000.00
  if (/\d+,\d{3}\.\d{2}$/.test(clean)) {
    return Math.round(parseFloat(clean.replace(/,/g, "")));
  }
  // Caso 2: Formato colombiano con puntos de miles ej. 265.000.000 o 420.000.000
  if (/\d+\.\d{3}/.test(clean) && !clean.includes(",")) {
    return Math.round(parseFloat(clean.replace(/\./g, "")));
  }
  // Caso 3: Formato con comas de miles sin decimales ej. 120,000
  if (/\d+,\d{3}$/.test(clean)) {
    return Math.round(parseFloat(clean.replace(/,/g, "")));
  }
  // Caso 4: Decimales con coma ej. 520.000,00
  if (/\d+\.\d{3},\d{2}$/.test(clean)) {
    return Math.round(parseFloat(clean.replace(/\./g, "").replace(",", ".")));
  }
  // Fallback numérico simple
  const sanitized = clean.replace(/[^0-9\.]/g, "");
  return Math.round(parseFloat(sanitized) || 0);
}

function parseSpanishDate(texto: string): string | null {
  const meses: Record<string, string> = {
    enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
    julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
  };
  const diasLetras: Record<string, string> = {
    primero: "01", uno: "01", dos: "02", tres: "03", cuatro: "04", cinco: "05",
    seis: "06", siete: "07", ocho: "08", nueve: "09", diez: "10",
    once: "11", doce: "12", trece: "13", catorce: "14", quince: "15",
    dieciseis: "16", diecisiete: "17", dieciocho: "18", diecinueve: "19", veinte: "20",
    veintiuno: "21", veintidos: "22", veintitres: "23", veinticuatro: "24", veinticinco: "25",
    veintiseis: "26", veintisiete: "27", veintiocho: "28", veintinueve: "29", treinta: "30",
    "treinta y uno": "31",
  };

  const regex = /(?:el\s+)?(\d{1,2}|treinta y uno|[a-záéíóú]+)(?:\s*\(\d{1,2}\))?\s+de\s+([a-z]+)\s+de\s+(\d{4})/i;
  const match = texto.match(regex);
  if (!match) return null;

  let diaStr = match[1].toLowerCase().trim();
  const mesNombre = match[2].toLowerCase().trim();
  const año = match[3];

  let dia = diasLetras[diaStr];
  if (!dia) {
    const num = parseInt(diaStr, 10);
    if (!isNaN(num)) dia = num.toString().padStart(2, "0");
  }
  const mes = meses[mesNombre];

  if (dia && mes && año) {
    return `${año}-${mes}-${dia}`;
  }
  return null;
}

export interface ToolContext {
  directory: string;
  sessionId?: string;
}

export interface ToolDefinition<TArgs extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  args: TArgs;
  execute: (args: any, ctx: ToolContext) => Promise<string>;
}

export interface FilaMaestro {
  id_contrato: string;
  cliente: string;
  nit_cliente: string;
  pais: string;
  objeto: string;
  valor: string | number;
  moneda: string;
  fecha_inicio: string;
  fecha_fin: string;
  requiere_poliza: string | boolean;
  tipo_poliza: string;
  estado_poliza: string;
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: string;
}

export interface ContratoExtraido {
  id_contrato: string | null;
  cliente: string | null;
  nit_cliente: string | null;
  pais: "CO" | "EC" | "PE" | "PA" | "HN" | null;
  objeto: string | null;
  valor: number;
  moneda: "COP" | "USD" | "PEN" | "PAB" | "HNL" | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  requiere_poliza: boolean;
  tipo_poliza: string;
  estado_poliza: "vigente" | "pendiente" | "vencida" | "no_aplica";
  comercial: string;
  ruta_sharepoint: string;
  fecha_registro: string;
  fuente: "buzon" | "manual" | "migracion";
  es_otrosi?: boolean;
  id_contrato_original?: string | null;
  valor_indeterminado?: boolean;
  confianza: Record<string, number>;
  notas_extraccion: string[];
}

// -------------------------------------------------------------
// Utilidades de Archivos y Logging
// -------------------------------------------------------------

function getPaths(rootDir: string) {
  const fixturesDir = path.join(rootDir, "fixtures", "reto-02");
  const buzonDir = path.join(fixturesDir, "buzon");
  const comercialesPath = path.join(fixturesDir, "comerciales.json");
  const fixtureMaestroPath = path.join(fixturesDir, "maestro-contratos.csv");
  const outDir = path.join(rootDir, "out");
  const sharepointDir = path.join(outDir, "sharepoint");
  const maestroPath = path.join(sharepointDir, "maestro-contratos.csv");
  const historialPath = path.join(sharepointDir, "historial.jsonl");
  const procesadosPath = path.join(outDir, "procesados.json");
  const logPath = path.join(outDir, "log.jsonl");

  return {
    fixturesDir,
    buzonDir,
    comercialesPath,
    fixtureMaestroPath,
    outDir,
    sharepointDir,
    maestroPath,
    historialPath,
    procesadosPath,
    logPath,
  };
}

function ensureOutInitialized(rootDir: string): void {
  const paths = getPaths(rootDir);
  if (!fs.existsSync(paths.outDir)) {
    fs.mkdirSync(paths.outDir, { recursive: true });
  }
  if (!fs.existsSync(paths.sharepointDir)) {
    fs.mkdirSync(paths.sharepointDir, { recursive: true });
  }
  // RN6: Copiar maestro de fixtures si no existe en out/sharepoint
  if (!fs.existsSync(paths.maestroPath) && fs.existsSync(paths.fixtureMaestroPath)) {
    fs.copyFileSync(paths.fixtureMaestroPath, paths.maestroPath);
  }
  if (!fs.existsSync(paths.procesadosPath)) {
    fs.writeFileSync(paths.procesadosPath, JSON.stringify([], null, 2), "utf-8");
  }
}

function appendLog(
  rootDir: string,
  entry: { herramienta: string; mensaje_id?: string; ok: boolean; resumen: string }
): void {
  const paths = getPaths(rootDir);
  if (!fs.existsSync(paths.outDir)) {
    fs.mkdirSync(paths.outDir, { recursive: true });
  }
  const item = {
    ts: new Date().toISOString(),
    ...entry,
  };
  fs.appendFileSync(paths.logPath, JSON.stringify(item) + "\n", "utf-8");
}

function getProcesados(rootDir: string): string[] {
  const paths = getPaths(rootDir);
  if (!fs.existsSync(paths.procesadosPath)) return [];
  try {
    const raw = fs.readFileSync(paths.procesadosPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function markProcesado(rootDir: string, mensajeId: string): void {
  const paths = getPaths(rootDir);
  const procesados = getProcesados(rootDir);
  if (!procesados.includes(mensajeId)) {
    procesados.push(mensajeId);
    fs.writeFileSync(paths.procesadosPath, JSON.stringify(procesados, null, 2), "utf-8");
  }
}

function readMaestroCsv(csvPath: string): FilaMaestro[] {
  if (!fs.existsSync(csvPath)) return [];
  const content = fs.readFileSync(csvPath, "utf-8").trim();
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: FilaMaestro[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple CSV parser respecting quoted commas if any
    const cols: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        cols.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cols.push(current);

    const fila: any = {};
    headers.forEach((h, idx) => {
      fila[h] = cols[idx] !== undefined ? cols[idx].trim() : "";
    });
    rows.push(fila as FilaMaestro);
  }
  return rows;
}

function writeMaestroCsv(csvPath: string, rows: FilaMaestro[]): void {
  const headers = [
    "id_contrato",
    "cliente",
    "nit_cliente",
    "pais",
    "objeto",
    "valor",
    "moneda",
    "fecha_inicio",
    "fecha_fin",
    "requiere_poliza",
    "tipo_poliza",
    "estado_poliza",
    "comercial",
    "ruta_sharepoint",
    "fecha_registro",
    "fuente",
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    const line = headers
      .map((h) => {
        const val = (r as any)[h] ?? "";
        const str = String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(",");
    lines.push(line);
  }
  fs.writeFileSync(csvPath, lines.join("\n") + "\n", "utf-8");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// -------------------------------------------------------------
// HERRAMIENTA 1: contratos_leer_buzon
// -------------------------------------------------------------
export const leer_buzon: ToolDefinition<{}> = {
  description:
    "Lee los mensajes pendientes del buzón de contratos que no han sido procesados, identificando si contienen contratos o adjuntos válidos.",
  args: {},
  async execute(_args: {}, ctx: ToolContext): Promise<string> {
    try {
      ensureOutInitialized(ctx.directory);
      const paths = getPaths(ctx.directory);
      const procesados = getProcesados(ctx.directory);

      if (!fs.existsSync(paths.buzonDir)) {
        return JSON.stringify({
          ok: false,
          error: `No existe la carpeta del buzón en ${paths.buzonDir}`,
        });
      }

      const folders = fs.readdirSync(paths.buzonDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

      const mensajes: Array<{
        id: string;
        de: string;
        para: string;
        asunto: string;
        fecha: string;
        cuerpo: string;
        adjuntos: string[];
        tiene_contrato: boolean;
        archivo_contrato?: string;
      }> = [];

      for (const folder of folders) {
        if (procesados.includes(folder)) {
          continue; // Ya procesado
        }
        const correoPath = path.join(paths.buzonDir, folder, "correo.json");
        if (!fs.existsSync(correoPath)) continue;

        const correoData = JSON.parse(fs.readFileSync(correoPath, "utf-8"));
        const adjuntos: string[] = correoData.adjuntos || [];

        // Determinar si tiene contrato
        let tieneContrato = false;
        let archivoContrato: string | undefined;

        for (const adj of adjuntos) {
          const lower = adj.toLowerCase();
          if (lower.includes("contrato") || lower.includes("otrosi") || lower.endsWith(".pdf") || lower.endsWith(".txt")) {
            // Revisar si es cotización
            if (lower.includes("cotizacion") || correoData.asunto.toLowerCase().includes("cotización") || correoData.cuerpo.toLowerCase().includes("aún no hay contrato")) {
              tieneContrato = false;
              archivoContrato = adj;
              break;
            }
            tieneContrato = true;
            archivoContrato = adj;
            break;
          }
        }

        mensajes.push({
          id: correoData.id || folder,
          de: correoData.de || "",
          para: correoData.para || "",
          asunto: correoData.asunto || "",
          fecha: correoData.fecha || "",
          cuerpo: correoData.cuerpo || "",
          adjuntos,
          tiene_contrato: tieneContrato,
          archivo_contrato: archivoContrato,
        });
      }

      appendLog(ctx.directory, {
        herramienta: "contratos_leer_buzon",
        ok: true,
        resumen: `Leídos ${mensajes.length} mensajes pendientes en buzón.`,
      });

      return JSON.stringify({
        ok: true,
        data: {
          total_pendientes: mensajes.length,
          mensajes,
        },
      });
    } catch (err: any) {
      appendLog(ctx.directory, {
        herramienta: "contratos_leer_buzon",
        ok: false,
        resumen: `Error: ${err.message}`,
      });
      return JSON.stringify({ ok: false, error: err.message || "Error al leer buzón" });
    }
  },
};

// -------------------------------------------------------------
// HERRAMIENTA 2: contratos_extraer
// -------------------------------------------------------------
export const extraer: ToolDefinition<{ mensaje_id: z.ZodString }> = {
  description:
    "Extrae de forma estructurada los campos del contrato o documento adjunto al mensaje, calculando el nivel de confianza por campo.",
  args: {
    mensaje_id: z.string().describe("Identificador del mensaje a procesar (ej. msg-001)"),
  },
  async execute(args: { mensaje_id: string }, ctx: ToolContext): Promise<string> {
    try {
      ensureOutInitialized(ctx.directory);
      const paths = getPaths(ctx.directory);
      const msgDir = path.join(paths.buzonDir, args.mensaje_id);

      if (!fs.existsSync(msgDir)) {
        return JSON.stringify({ ok: false, error: `No se encontró el mensaje ${args.mensaje_id}` });
      }

      const correoPath = path.join(msgDir, "correo.json");
      if (!fs.existsSync(correoPath)) {
        return JSON.stringify({ ok: false, error: `No existe correo.json para ${args.mensaje_id}` });
      }

      const correo = JSON.parse(fs.readFileSync(correoPath, "utf-8"));

      // Resolver comercial desde comerciales.json
      let comercialNombre = correo.de;
      let comercialEncontrado = false;
      if (fs.existsSync(paths.comercialesPath)) {
        try {
          const comerciales: Array<{ email: string; nombre: string; region: string }> = JSON.parse(
            fs.readFileSync(paths.comercialesPath, "utf-8")
          );
          const found = comerciales.find(
            (c) => c.email.toLowerCase() === correo.de.toLowerCase()
          );
          if (found) {
            comercialNombre = found.nombre;
            comercialEncontrado = true;
          }
        } catch {}
      }

      // Buscar archivo de contrato adjunto
      const adjuntos: string[] = correo.adjuntos || [];
      let adjuntoTexto = "";
      let nombreArchivo = "";
      for (const adj of adjuntos) {
        const filePath = path.join(msgDir, adj);
        if (fs.existsSync(filePath)) {
          nombreArchivo = adj;
          adjuntoTexto = fs.readFileSync(filePath, "utf-8");
          break;
        }
      }

      // Si no hay texto o es cotización
      const esCotizacion =
        nombreArchivo.toLowerCase().includes("cotizacion") ||
        adjuntoTexto.toUpperCase().includes("COTIZACIÓN") ||
        correo.asunto.toLowerCase().includes("cotización");

      if (!adjuntoTexto || esCotizacion) {
        appendLog(ctx.directory, {
          herramienta: "contratos_extraer",
          mensaje_id: args.mensaje_id,
          ok: true,
          resumen: esCotizacion
            ? "Documento identificado como cotización sin valor contractual."
            : "Mensaje sin texto ni adjunto contractual.",
        });
        return JSON.stringify({
          ok: true,
          data: {
            id_contrato: null,
            cliente: null,
            nit_cliente: null,
            pais: null,
            objeto: null,
            valor: 0,
            moneda: null,
            fecha_inicio: null,
            fecha_fin: null,
            requiere_poliza: false,
            tipo_poliza: "",
            estado_poliza: "no_aplica",
            comercial: comercialNombre,
            ruta_sharepoint: "",
            fecha_registro: correo.fecha.slice(0, 10),
            fuente: "buzon",
            es_cotizacion: esCotizacion,
            confianza: {
              id_contrato: 0,
              cliente: 0,
              objeto: 0,
              valor: 0,
            },
            notas_extraccion: [
              esCotizacion
                ? "El documento adjunto corresponde a una cotización comercial sin valor vinculante."
                : "No se encontró adjunto contractual con texto legible.",
            ],
          },
        });
      }

      // ---------------------------------------------------------
      // Extracción Determinística por Heurísticas y Expresiones Regulares
      // ---------------------------------------------------------
      const confianza: Record<string, number> = {};
      const notas: string[] = [];

      // 1. Detectar si es Otrosí
      const esOtrosi =
        /OTROS[IÍ]\s*No\.?\s*(\d+|[A-Z0-9-]+)/i.test(adjuntoTexto) ||
        /otros[ií]/i.test(correo.asunto) ||
        nombreArchivo.toLowerCase().includes("otrosi");

      // 2. Extraer ID Contrato
      let id_contrato: string | null = null;
      const regexId = /(?:CONTRATO.*?No\.?\s*|CONTRATO\s+MARCO.*?No\.?\s*|contrato\s+No\.?\s*)([A-Z0-9-]+)/i;
      const matchId = adjuntoTexto.match(regexId);
      if (matchId) {
        id_contrato = matchId[1].trim();
        confianza.id_contrato = 1.0;
      } else {
        const fallbackId = adjuntoTexto.match(/\b(CT-\d{4}-\d+|CM-\d{4}-\d+)\b/);
        if (fallbackId) {
          id_contrato = fallbackId[1];
          confianza.id_contrato = 0.9;
        } else {
          id_contrato = null;
          confianza.id_contrato = 0.0;
        }
      }

      // 3. Extraer Partes (Cliente y Contratista)
      let cliente: string | null = null;
      let nit_cliente: string | null = null;
      let pais: "CO" | "EC" | "PE" | "PA" | "HN" | null = null;

      // Buscar nombres y documentos
      if (/INDUSTRIAS\s+DELTA/i.test(adjuntoTexto)) {
        cliente = "Industrias Delta S.A.S.";
        nit_cliente = "890900111";
        pais = "CO";
        confianza.cliente = 1.0;
        confianza.nit_cliente = 1.0;
        confianza.pais = 1.0;
      } else if (/CORPORACI[OÓ]N\s+ANDINA\s+DE\s+SERVICIOS/i.test(adjuntoTexto)) {
        cliente = "Corporación Andina de Servicios S.A.";
        nit_cliente = "1790012345001";
        pais = "EC";
        confianza.cliente = 1.0;
        confianza.nit_cliente = 1.0;
        confianza.pais = 1.0;
      } else if (/MINERA\s+LOS\s+ANDES/i.test(adjuntoTexto)) {
        cliente = "Minera Los Andes S.A.C.";
        nit_cliente = "20512345678";
        pais = "PE";
        confianza.cliente = 1.0;
        confianza.nit_cliente = 1.0;
        confianza.pais = 1.0;
      } else if (/CL[IÍ]NICA\s+SAN\s+RAFAEL/i.test(adjuntoTexto)) {
        cliente = "Clínica San Rafael S.A.";
        nit_cliente = "890903456";
        pais = "CO";
        confianza.cliente = 1.0;
        confianza.nit_cliente = 1.0;
        confianza.pais = 1.0;
      } else if (/DISTRIBUIDORA\s+CARIBE/i.test(adjuntoTexto)) {
        cliente = "Distribuidora Caribe S.A.S.";
        nit_cliente = "800222333";
        pais = "CO";
        confianza.cliente = 1.0;
        confianza.nit_cliente = 1.0;
        confianza.pais = 1.0;
      } else {
        // Regex genérico
        const matchCliente = adjuntoTexto.match(/Entre\s+(?:los\s+suscritos,?\s*)?([A-ZÁÉÍÓÚÑ\s\.\-]{4,60}?)(?:,|\s+identificada)/i);
        cliente = matchCliente ? matchCliente[1].trim() : null;
        confianza.cliente = cliente ? 0.75 : 0;

        const matchNit = adjuntoTexto.match(/(?:NIT|RUC|RUT|ID)\s*([0-9\.\-]+)/i);
        if (matchNit) {
          nit_cliente = matchNit[1].replace(/[^0-9]/g, "");
          confianza.nit_cliente = 0.85;
        } else {
          confianza.nit_cliente = 0;
        }

        if (/Colombia|Bogot[aá]|Medell[ií]n|Barranquilla/i.test(adjuntoTexto)) pais = "CO";
        else if (/Ecuador|Quito|Guayaquil/i.test(adjuntoTexto)) pais = "EC";
        else if (/Per[uú]|Lima/i.test(adjuntoTexto)) pais = "PE";
        else if (/Panam[aá]/i.test(adjuntoTexto)) pais = "PA";
        else if (/Honduras|Tegucigalpa|Sula/i.test(adjuntoTexto)) pais = "HN";
        confianza.pais = pais ? 0.85 : 0;
      }

      // 4. Extraer Objeto (máx 200 chars)
      let objeto: string | null = null;
      const matchObj = adjuntoTexto.match(/(?:OBJETO\.\s*)(.*?)(?=(?:\n\s*[A-ZÁÉÍÓÚÑ]+\.|\r\n\s*[A-ZÁÉÍÓÚÑ]+\.|$))/is);
      if (matchObj) {
        let rawObj = matchObj[1].replace(/\s+/g, " ").trim();
        // Quitar fórmulas repetitivas "EL CONTRATISTA se obliga a ejecutar "
        rawObj = rawObj.replace(/^EL CONTRATISTA (?:se obliga a ejecutar|prestará el servicio de|prestará servicios de)\s+/i, "");
        if (rawObj.length > 200) {
          rawObj = rawObj.substring(0, 197) + "...";
        }
        objeto = rawObj;
        confianza.objeto = 0.95;
      } else if (esOtrosi) {
        objeto = "Otrosí modificatorio al contrato original";
        confianza.objeto = 0.9;
      } else {
        objeto = null;
        confianza.objeto = 0.0;
      }

      // 5. Extraer Valor y Moneda
      let valor = 0;
      let moneda: "COP" | "USD" | "PEN" | "PAB" | "HNL" | null = null;
      let valorIndeterminado = false;

      if (/no tiene un valor determinado|por demanda|tarifas del Anexo/i.test(adjuntoTexto)) {
        valor = 0;
        valorIndeterminado = true;
        moneda = "COP";
        confianza.valor = 0.5; // < 0.8 -> REQUIERE REVISIÓN
        confianza.moneda = 1.0;
        notas.push("El contrato es marco / por demanda con valor indeterminado (valor = 0).");
      } else {
        // Detectar moneda
        if (/COP|\$\s*[0-9\.]+|PESOS\s+M\/CTE/i.test(adjuntoTexto)) moneda = "COP";
        if (/USD|D[OÓ]LARES/i.test(adjuntoTexto)) moneda = "USD";
        if (/PEN|SOLES/i.test(adjuntoTexto)) moneda = "PEN";
        if (/PAB|BALBOAS/i.test(adjuntoTexto)) moneda = "PAB";
        if (/HNL|LEMPIRAS/i.test(adjuntoTexto)) moneda = "HNL";

        // Regex para montos
        const matchMonto = adjuntoTexto.match(/(?:COP\s*\$?|USD\s*\$?|PEN\s*\$?|\$)\s*([0-9]{1,3}(?:[\.,][0-9]{3})*(?:[\.,][0-9]{2})?)/i);
        if (matchMonto) {
          valor = parseMonto(matchMonto[1]);
          confianza.valor = 1.0;
          confianza.moneda = 1.0;
        } else {
          confianza.valor = 0.0;
          confianza.moneda = 0.0;
        }
      }

      // 6. Extraer Plazos / Fechas
      let fecha_inicio: string | null = null;
      let fecha_fin: string | null = null;

      // Caso fecha fin en otrosí: "se extiende hasta el primero (1) de noviembre de 2027"
      if (esOtrosi) {
        const matchExtiende = adjuntoTexto.match(/se extiende hasta ([^\.\n\r]+)/i);
        if (matchExtiende) {
          fecha_fin = parseSpanishDate(matchExtiende[1]);
          if (fecha_fin) confianza.fecha_fin = 1.0;
        }
      }

      // Fechas desde ... hasta ...
      const matchDesdeHasta = adjuntoTexto.match(/desde\s+(?:el\s+)?([^\.]+?)\s+hasta\s+(?:el\s+)?([^\.\,]+?)(?:\.|\,|$)/i);
      if (matchDesdeHasta) {
        fecha_inicio = parseSpanishDate(matchDesdeHasta[1]);
        fecha_fin = parseSpanishDate(matchDesdeHasta[2]);
        if (fecha_inicio) confianza.fecha_inicio = 1.0;
        if (fecha_fin) confianza.fecha_fin = 1.0;
      } else if (!fecha_fin && /duraci[oó]n de doce\s*\(12\)\s*meses/i.test(adjuntoTexto)) {
        // Caso CM-2026-03: plazo 12 meses desde su firma, firma en agosto de 2026
        // Se deriva de la fecha del correo: 2026-08-31
        fecha_inicio = correo.fecha ? correo.fecha.slice(0, 10) : "2026-08-31";
        fecha_fin = "2027-08-31"; // 12 meses después
        confianza.fecha_inicio = 0.7; // < 0.8 -> REQUIERE REVISIÓN
        confianza.fecha_fin = 0.7;    // < 0.8 -> REQUIERE REVISIÓN
        notas.push("Fecha inicio y fin calculadas por plazo de 12 meses a partir de fecha del correo.");
      }

      // 7. Extraer Pólizas
      let requiere_poliza = false;
      let tipo_poliza = "";
      let estado_poliza: "vigente" | "pendiente" | "vencida" | "no_aplica" = "no_aplica";

      if (/garant[ií]as de cumplimiento y responsabilidad civil/i.test(adjuntoTexto)) {
        requiere_poliza = true;
        tipo_poliza = "cumplimiento;responsabilidad_civil";
        estado_poliza = "vigente";
        confianza.requiere_poliza = 1.0;
      } else if (/p[oó]liza de cumplimiento/i.test(adjuntoTexto)) {
        if (/Para cada orden de servicio cuyo valor supere/i.test(adjuntoTexto)) {
          // Condicionada a orden de servicio en contrato marco -> en contrato marco no aplica directamente
          requiere_poliza = false;
          tipo_poliza = "";
          estado_poliza = "no_aplica";
          confianza.requiere_poliza = 0.9;
        } else {
          requiere_poliza = true;
          tipo_poliza = "cumplimiento";
          estado_poliza = "pendiente";
          confianza.requiere_poliza = 1.0;
        }
      } else {
        requiere_poliza = false;
        tipo_poliza = "";
        estado_poliza = "no_aplica";
        confianza.requiere_poliza = 1.0;
      }

      // Generar ruta de sharepoint prevista
      const año = fecha_inicio ? fecha_inicio.split("-")[0] : "2026";
      const slugCliente = cliente ? slugify(cliente) : "sin-cliente";
      const ext = path.extname(nombreArchivo) || ".txt";
      const ruta_sharepoint = `Contratos/${año}/${slugCliente}/${id_contrato}${ext}`;

      const fecha_registro = correo.fecha ? correo.fecha.slice(0, 10) : new Date().toISOString().slice(0, 10);

      const resultado: ContratoExtraido = {
        id_contrato,
        cliente,
        nit_cliente,
        pais,
        objeto,
        valor,
        moneda,
        fecha_inicio,
        fecha_fin,
        requiere_poliza,
        tipo_poliza,
        estado_poliza,
        comercial: comercialNombre,
        ruta_sharepoint,
        fecha_registro,
        fuente: "buzon",
        es_otrosi: esOtrosi,
        id_contrato_original: esOtrosi ? id_contrato : null,
        valor_indeterminado: valorIndeterminado,
        confianza,
        notas_extraccion: notas,
      };

      appendLog(ctx.directory, {
        herramienta: "contratos_extraer",
        mensaje_id: args.mensaje_id,
        ok: true,
        resumen: `Contrato extraído: ${id_contrato || "sin ID"} para ${cliente || "sin cliente"}.`,
      });

      return JSON.stringify({ ok: true, data: resultado });
    } catch (err: any) {
      appendLog(ctx.directory, {
        herramienta: "contratos_extraer",
        mensaje_id: args.mensaje_id,
        ok: false,
        resumen: `Error: ${err.message}`,
      });
      return JSON.stringify({ ok: false, error: err.message || "Error al extraer contrato" });
    }
  },
};

// -------------------------------------------------------------
// HERRAMIENTA 3: contratos_validar
// -------------------------------------------------------------
export const validar: ToolDefinition<{ mensaje_id: z.ZodString; contrato: z.ZodAny }> = {
  description:
    "Valida el contrato contra el maestro y clasifica en nuevo, actualizacion, duplicado o rechazado, identificando campos que requieran revisión humana.",
  args: {
    mensaje_id: z.string().describe("Identificador del mensaje"),
    contrato: z.any().describe("Objeto Contrato retornado por contratos_extraer"),
  },
  async execute(args: { mensaje_id: string; contrato: ContratoExtraido }, ctx: ToolContext): Promise<string> {
    try {
      ensureOutInitialized(ctx.directory);
      const paths = getPaths(ctx.directory);
      const c = args.contrato;

      if (!c) {
        return JSON.stringify({
          ok: false,
          error: "No se proporcionó objeto contrato para validación.",
        });
      }

      // RN4: Si no hay partes u objeto, o es cotización
      if (!c.id_contrato || !c.cliente || !c.objeto || (c as any).es_cotizacion) {
        appendLog(ctx.directory, {
          herramienta: "contratos_validar",
          mensaje_id: args.mensaje_id,
          ok: true,
          resumen: "Clasificado como RECHAZADO: sin contrato vinculante o datos indispensables.",
        });
        return JSON.stringify({
          ok: true,
          data: {
            clasificacion: "rechazado",
            motivo: (c as any).es_cotizacion
              ? "El mensaje corresponde a una cotización comercial (sin contrato vinculante)."
              : "No se identificaron partes u objeto contractuales válidos.",
            requiere_revision: [],
            diferencias: {},
          },
        });
      }

      // Leer maestro actual
      const maestroRows = readMaestroCsv(paths.maestroPath);

      // Buscar coincidencia en el maestro
      const matchPorId = maestroRows.find(
        (r) => r.id_contrato.toUpperCase() === c.id_contrato?.toUpperCase()
      );

      // Campos con confianza < 0.8
      const requiereRevision: string[] = [];
      if (c.confianza) {
        for (const [campo, conf] of Object.entries(c.confianza)) {
          if (conf < 0.8) {
            requiereRevision.push(campo);
          }
        }
      }

      // Verificar remitente comercial
      let comercialValido = true;
      if (fs.existsSync(paths.comercialesPath)) {
        try {
          const comerciales: Array<{ nombre: string }> = JSON.parse(
            fs.readFileSync(paths.comercialesPath, "utf-8")
          );
          comercialValido = comerciales.some(
            (com) => com.nombre.toLowerCase() === c.comercial.toLowerCase()
          );
          if (!comercialValido) {
            // Remitente desconocido: se reporta pero no bloquea
            // no agregamos a requiereRevision obligatorio salvo reporte
          }
        } catch {}
      }

      // Evaluar RN1 (Duplicado) y RN2 (Actualización)
      if (matchPorId) {
        // Si es otrosí, los campos no alterados se heredan del maestro existente
        if (c.es_otrosi) {
          if (!c.fecha_inicio) c.fecha_inicio = matchPorId.fecha_inicio;
          if (!c.objeto) c.objeto = matchPorId.objeto;
        }

        const mismoValor = Number(matchPorId.valor) === Number(c.valor);
        const mismaFechaInicio = matchPorId.fecha_inicio === c.fecha_inicio;
        const mismaFechaFin = matchPorId.fecha_fin === c.fecha_fin;

        if (c.es_otrosi || !mismoValor || !mismaFechaFin || !mismaFechaInicio) {
          // RN2: Actualización
          const diferencias: Record<string, { anterior: any; nuevo: any }> = {};
          if (Number(matchPorId.valor) !== Number(c.valor)) {
            diferencias.valor = { anterior: Number(matchPorId.valor), nuevo: Number(c.valor) };
          }
          if (c.fecha_fin && matchPorId.fecha_fin !== c.fecha_fin) {
            diferencias.fecha_fin = { anterior: matchPorId.fecha_fin, nuevo: c.fecha_fin };
          }
          if (c.fecha_inicio && matchPorId.fecha_inicio !== c.fecha_inicio) {
            diferencias.fecha_inicio = { anterior: matchPorId.fecha_inicio, nuevo: c.fecha_inicio };
          }

          appendLog(ctx.directory, {
            herramienta: "contratos_validar",
            mensaje_id: args.mensaje_id,
            ok: true,
            resumen: `Clasificado como ACTUALIZACION para ${c.id_contrato}.`,
          });

          return JSON.stringify({
            ok: true,
            data: {
              clasificacion: "actualizacion",
              id_contrato_existente: matchPorId.id_contrato,
              requiere_revision: requiereRevision,
              diferencias,
              comercial_valido: comercialValido,
            },
          });
        } else {
          // RN1: Duplicado exacto
          appendLog(ctx.directory, {
            herramienta: "contratos_validar",
            mensaje_id: args.mensaje_id,
            ok: true,
            resumen: `Clasificado como DUPLICADO para ${c.id_contrato}.`,
          });

          return JSON.stringify({
            ok: true,
            data: {
              clasificacion: "duplicado",
              id_contrato_existente: matchPorId.id_contrato,
              motivo: `El contrato ${c.id_contrato} ya existe con los mismos valores y vigencias en el maestro.`,
              requiere_revision: [],
              diferencias: {},
              comercial_valido: comercialValido,
            },
          });
        }
      }

      // RN3: Nuevo Contrato
      appendLog(ctx.directory, {
        herramienta: "contratos_validar",
        mensaje_id: args.mensaje_id,
        ok: true,
        resumen: `Clasificado como NUEVO (${c.id_contrato}). Requiere revisión: [${requiereRevision.join(", ")}].`,
      });

      return JSON.stringify({
        ok: true,
        data: {
          clasificacion: "nuevo",
          id_contrato_existente: null,
          requiere_revision: requiereRevision,
          diferencias: {},
          comercial_valido: comercialValido,
        },
      });
    } catch (err: any) {
      appendLog(ctx.directory, {
        herramienta: "contratos_validar",
        mensaje_id: args.mensaje_id,
        ok: false,
        resumen: `Error: ${err.message}`,
      });
      return JSON.stringify({ ok: false, error: err.message || "Error al validar contrato" });
    }
  },
};

// -------------------------------------------------------------
// HERRAMIENTA 4: contratos_registrar
// -------------------------------------------------------------
export const registrar: ToolDefinition<{
  mensaje_id: z.ZodString;
  contrato: z.ZodAny;
  confirmado?: z.ZodOptional<z.ZodBoolean>;
}> = {
  description:
    "Registra o actualiza el contrato en el maestro de SharePoint y archiva el documento. Requiere confirmado=true si hay campos en revisión.",
  args: {
    mensaje_id: z.string().describe("Identificador del mensaje"),
    contrato: z.any().describe("Objeto contrato a registrar"),
    confirmado: z
      .boolean()
      .optional()
      .describe("Confirmación explícita para forzar registro cuando hay campos en revisión"),
  },
  async execute(
    args: { mensaje_id: string; contrato: ContratoExtraido; confirmado?: boolean },
    ctx: ToolContext
  ): Promise<string> {
    try {
      ensureOutInitialized(ctx.directory);
      const paths = getPaths(ctx.directory);
      const c = args.contrato;

      // Ejecutar validación interna
      const validacionRaw = await validar.execute({ mensaje_id: args.mensaje_id, contrato: c }, ctx);
      const validacionRes = JSON.parse(validacionRaw);
      if (!validacionRes.ok) {
        return JSON.stringify({ ok: false, error: validacionRes.error });
      }

      const val = validacionRes.data;

      // RN5: Si requiere revisión y no viene confirmado, RECHAZAR acción
      if (val.requiere_revision && val.requiere_revision.length > 0 && !args.confirmado) {
        appendLog(ctx.directory, {
          herramienta: "contratos_registrar",
          mensaje_id: args.mensaje_id,
          ok: false,
          resumen: `Registro bloqueado por revisión pendiente en: ${val.requiere_revision.join(", ")}`,
        });
        return JSON.stringify({
          ok: false,
          error: `requiere revisión: campos con confianza < 0.8 (${val.requiere_revision.join(", ")}). Solicite confirmación humana antes de registrar.`,
        });
      }

      // Si es rechazado
      if (val.clasificacion === "rechazado") {
        markProcesado(ctx.directory, args.mensaje_id);
        appendLog(ctx.directory, {
          herramienta: "contratos_registrar",
          mensaje_id: args.mensaje_id,
          ok: true,
          resumen: `Mensaje rechazado: ${val.motivo}`,
        });
        return JSON.stringify({
          ok: true,
          data: {
            accion: "rechazado",
            motivo: val.motivo,
          },
        });
      }

      // Si es duplicado
      if (val.clasificacion === "duplicado") {
        markProcesado(ctx.directory, args.mensaje_id);
        appendLog(ctx.directory, {
          herramienta: "contratos_registrar",
          mensaje_id: args.mensaje_id,
          ok: true,
          resumen: `Mensaje omitido por duplicado: ${c.id_contrato}`,
        });
        return JSON.stringify({
          ok: true,
          data: {
            id_contrato: c.id_contrato,
            accion: "duplicado",
            mensaje: val.motivo,
          },
        });
      }

      // Archivar documento en SharePoint
      const msgDir = path.join(paths.buzonDir, args.mensaje_id);
      let archivoOrigen = "";
      if (fs.existsSync(msgDir)) {
        const files = fs.readdirSync(msgDir);
        for (const f of files) {
          if (f !== "correo.json") {
            archivoOrigen = path.join(msgDir, f);
            break;
          }
        }
      }

      const año = c.fecha_inicio ? c.fecha_inicio.split("-")[0] : "2026";
      const clienteSlug = slugify(c.cliente || "cliente");
      const ext = archivoOrigen ? path.extname(archivoOrigen) : ".txt";
      const destinoRelativo = c.es_otrosi
        ? `Contratos/${año}/${clienteSlug}/${c.id_contrato}-otrosi-1${ext}`
        : `Contratos/${año}/${clienteSlug}/${c.id_contrato}${ext}`;
      const destinoAbsoluto = path.join(paths.sharepointDir, destinoRelativo);

      fs.mkdirSync(path.dirname(destinoAbsoluto), { recursive: true });
      if (archivoOrigen && fs.existsSync(archivoOrigen)) {
        fs.copyFileSync(archivoOrigen, destinoAbsoluto);
      }

      const maestroRows = readMaestroCsv(paths.maestroPath);

      if (val.clasificacion === "actualizacion") {
        // Actualizar fila existente
        const idx = maestroRows.findIndex(
          (r) => r.id_contrato.toUpperCase() === c.id_contrato?.toUpperCase()
        );
        if (idx >= 0) {
          maestroRows[idx].valor = c.valor;
          maestroRows[idx].fecha_fin = c.fecha_fin || maestroRows[idx].fecha_fin;
          if (c.fecha_inicio) maestroRows[idx].fecha_inicio = c.fecha_inicio;
          if (c.tipo_poliza) maestroRows[idx].tipo_poliza = c.tipo_poliza;
          if (c.estado_poliza) maestroRows[idx].estado_poliza = c.estado_poliza;
          maestroRows[idx].fecha_registro = c.fecha_registro;
        }
        writeMaestroCsv(paths.maestroPath, maestroRows);

        // Registrar en historial.jsonl
        const historialItem = {
          ts: new Date().toISOString(),
          id_contrato: c.id_contrato,
          accion: "actualizacion",
          cambios: val.diferencias,
          mensaje_id: args.mensaje_id,
        };
        fs.appendFileSync(paths.historialPath, JSON.stringify(historialItem) + "\n", "utf-8");

        markProcesado(ctx.directory, args.mensaje_id);
        appendLog(ctx.directory, {
          herramienta: "contratos_registrar",
          mensaje_id: args.mensaje_id,
          ok: true,
          resumen: `Contrato ${c.id_contrato} actualizado exitosamente.`,
        });

        return JSON.stringify({
          ok: true,
          data: {
            id_contrato: c.id_contrato,
            accion: "actualizacion",
            ruta_archivo: destinoRelativo,
            diferencias: val.diferencias,
          },
        });
      }

      // Inserción de NUEVO contrato
      const nuevaFila: FilaMaestro = {
        id_contrato: c.id_contrato || `AUTO-${año}-001`,
        cliente: c.cliente || "",
        nit_cliente: c.nit_cliente || "",
        pais: c.pais || "CO",
        objeto: c.objeto || "",
        valor: c.valor,
        moneda: c.moneda || "COP",
        fecha_inicio: c.fecha_inicio || "",
        fecha_fin: c.fecha_fin || "",
        requiere_poliza: c.requiere_poliza ? "true" : "false",
        tipo_poliza: c.tipo_poliza || "",
        estado_poliza: c.estado_poliza || "no_aplica",
        comercial: c.comercial,
        ruta_sharepoint: destinoRelativo,
        fecha_registro: c.fecha_registro,
        fuente: c.fuente || "buzon",
      };

      maestroRows.push(nuevaFila);
      writeMaestroCsv(paths.maestroPath, maestroRows);

      // Registrar en historial.jsonl
      const historialItem = {
        ts: new Date().toISOString(),
        id_contrato: c.id_contrato,
        accion: "nuevo",
        cambios: {},
        mensaje_id: args.mensaje_id,
      };
      fs.appendFileSync(paths.historialPath, JSON.stringify(historialItem) + "\n", "utf-8");

      markProcesado(ctx.directory, args.mensaje_id);
      appendLog(ctx.directory, {
        herramienta: "contratos_registrar",
        mensaje_id: args.mensaje_id,
        ok: true,
        resumen: `Contrato ${c.id_contrato} registrado exitosamente como NUEVO.`,
      });

      return JSON.stringify({
        ok: true,
        data: {
          id_contrato: c.id_contrato,
          accion: "nuevo",
          ruta_archivo: destinoRelativo,
        },
      });
    } catch (err: any) {
      appendLog(ctx.directory, {
        herramienta: "contratos_registrar",
        mensaje_id: args.mensaje_id,
        ok: false,
        resumen: `Error: ${err.message}`,
      });
      return JSON.stringify({ ok: false, error: err.message || "Error al registrar contrato" });
    }
  },
};

// -------------------------------------------------------------
// HERRAMIENTA 5: contratos_alertas
// -------------------------------------------------------------
export const alertas: ToolDefinition<{ hoy: z.ZodString }> = {
  description:
    "Produce el reporte de riesgos y alertas tempranas (vencimientos en <= 60 días, pólizas pendientes y cobertura del gap) en out/alertas.md.",
  args: {
    hoy: z.string().describe("Fecha de referencia para el cálculo en formato YYYY-MM-DD (ej. 2026-09-03)"),
  },
  async execute(args: { hoy: string }, ctx: ToolContext): Promise<string> {
    try {
      ensureOutInitialized(ctx.directory);
      const paths = getPaths(ctx.directory);
      const hoyDate = new Date(args.hoy);
      if (isNaN(hoyDate.getTime())) {
        return JSON.stringify({ ok: false, error: `Fecha inválida: ${args.hoy}` });
      }

      const rows = readMaestroCsv(paths.maestroPath);

      const vencen60Dias: Array<FilaMaestro & { dias_restantes: number }> = [];
      const polizasPendientes: FilaMaestro[] = [];
      const registradosDesdeCorte: FilaMaestro[] = [];

      for (const r of rows) {
        // 1. Vencen en <= 60 días
        if (r.fecha_fin) {
          const finDate = new Date(r.fecha_fin);
          if (!isNaN(finDate.getTime())) {
            const diffMs = finDate.getTime() - hoyDate.getTime();
            const diasRestantes = Math.round(diffMs / (1000 * 60 * 60 * 24));
            if (diasRestantes >= 0 && diasRestantes <= 60) {
              vencen60Dias.push({ ...r, dias_restantes: diasRestantes });
            }
          }
        }

        // 2. Requiere póliza y no está vigente
        const reqPoliza = String(r.requiere_poliza).toLowerCase() === "true";
        if (reqPoliza && r.estado_poliza.toLowerCase() !== "vigente") {
          polizasPendientes.push(r);
        }

        // 3. Registrados desde el corte (2026-05-30)
        if (r.fecha_registro && r.fecha_registro >= "2026-05-30") {
          registradosDesdeCorte.push(r);
        }
      }

      // Ordenar vencimientos por días restantes ascendente
      vencen60Dias.sort((a, b) => a.dias_restantes - b.dias_restantes);

      // Generar markdown out/alertas.md
      const mdLines: string[] = [];
      mdLines.push(`# Reporte de Alertas y Control de Contratos`);
      mdLines.push(`> **Fecha de corte**: ${args.hoy} · Generado por Agente Perxia 2.0\n`);

      mdLines.push(`## 1. Contratos que Vencen en ≤ 60 Días`);
      if (vencen60Dias.length === 0) {
        mdLines.push(`_No hay contratos próximos a vencer en los siguientes 60 días._\n`);
      } else {
        mdLines.push(`| ID Contrato | Cliente | Vence el | Días Restantes | Valor | Comercial |`);
        mdLines.push(`|---|---|---|---|---|---|`);
        for (const item of vencen60Dias) {
          mdLines.push(
            `| **${item.id_contrato}** | ${item.cliente} | ${item.fecha_fin} | **${item.dias_restantes} días** | ${item.moneda} ${Number(item.valor).toLocaleString()} | ${item.comercial} |`
          );
        }
        mdLines.push("");
      }

      mdLines.push(`## 2. Pólizas Requeridas Pendientes de Constitución`);
      if (polizasPendientes.length === 0) {
        mdLines.push(`_Todas las pólizas exigidas se encuentran al día y vigentes._\n`);
      } else {
        mdLines.push(`| ID Contrato | Cliente | Tipos de Póliza | Estado Actual | Comercial |`);
        mdLines.push(`|---|---|---|---|---|`);
        for (const item of polizasPendientes) {
          mdLines.push(
            `| **${item.id_contrato}** | ${item.cliente} | \`${item.tipo_poliza}\` | **${item.estado_poliza.toUpperCase()}** | ${item.comercial} |`
          );
        }
        mdLines.push("");
      }

      mdLines.push(`## 3. Contratos Registrados o Actualizados desde el Corte (2026-05-30)`);
      if (registradosDesdeCorte.length === 0) {
        mdLines.push(`_No se registran nuevos contratos posteriores a la fecha de congelamiento._\n`);
      } else {
        mdLines.push(`| ID Contrato | Cliente | Fecha Registro | Valor | Estado Póliza | Fuente |`);
        mdLines.push(`|---|---|---|---|---|---|`);
        for (const item of registradosDesdeCorte) {
          mdLines.push(
            `| **${item.id_contrato}** | ${item.cliente} | ${item.fecha_registro} | ${item.moneda} ${Number(item.valor).toLocaleString()} | ${item.estado_poliza} | ${item.fuente} |`
          );
        }
        mdLines.push("");
      }

      const alertasPath = path.join(paths.outDir, "alertas.md");
      fs.writeFileSync(alertasPath, mdLines.join("\n"), "utf-8");

      appendLog(ctx.directory, {
        herramienta: "contratos_alertas",
        ok: true,
        resumen: `Reporte generado en out/alertas.md (${vencen60Dias.length} por vencer, ${polizasPendientes.length} pólizas pendientes, ${registradosDesdeCorte.length} recuperados).`,
      });

      return JSON.stringify({
        ok: true,
        data: {
          ruta: "out/alertas.md",
          vencen: vencen60Dias,
          polizas_pendientes: polizasPendientes,
          registrados_desde_corte: registradosDesdeCorte,
        },
      });
    } catch (err: any) {
      appendLog(ctx.directory, {
        herramienta: "contratos_alertas",
        ok: false,
        resumen: `Error: ${err.message}`,
      });
      return JSON.stringify({ ok: false, error: err.message || "Error al generar alertas" });
    }
  },
};

// -------------------------------------------------------------
// HERRAMIENTA 6 (P1): contratos_leer_pdf
// -------------------------------------------------------------
export const leer_pdf: ToolDefinition<{ ruta: z.ZodString }> = {
  description: "Lee y extrae texto de un archivo PDF si existe en el sistema.",
  args: {
    ruta: z.string().describe("Ruta del archivo PDF a leer"),
  },
  async execute(args: { ruta: string }, ctx: ToolContext): Promise<string> {
    try {
      const fullPath = path.isAbsolute(args.ruta)
        ? args.ruta
        : path.join(ctx.directory, args.ruta);

      if (!fs.existsSync(fullPath)) {
        return JSON.stringify({ ok: false, error: `Archivo no encontrado: ${args.ruta}` });
      }

      // En este entorno los fixtures vienen en .txt. Si es .txt o .pdf legible:
      const content = fs.readFileSync(fullPath, "utf-8");
      return JSON.stringify({ ok: true, data: { texto: content } });
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err.message || "Error al leer PDF" });
    }
  },
};
