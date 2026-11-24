import * as fs from "node:fs";
import * as path from "node:path";
import {
  leer_buzon,
  extraer,
  validar,
  registrar,
  alertas,
} from "./src/tools/contratos.ts";
import type { ToolContext } from "./src/tools/contratos.ts";

async function runDemo() {
  const rootDir = process.cwd();
  const ctx: ToolContext = { directory: rootDir, sessionId: "demo-session" };

  console.log("================================================================================");
  console.log(" 🚀 INICIANDO DEMO DETERMINISTA DE HERRAMIENTAS - RETO 02 (PERIFERIA IT GROUP)");
  console.log("================================================================================");

  // 1. Limpieza de out/ para garantizar determinismo estricto (Requisito Sec. 8)
  const outDir = path.join(rootDir, "out");
  if (fs.existsSync(outDir)) {
    console.log("🧹 Limpiando directorio out/ para inicio determinista...");
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  // 2. Leer buzón (HU-1)
  console.log("\n📥 [PASO 1] Invocando contratos_leer_buzon...");
  const rawBuzon = await leer_buzon.execute({}, ctx);
  const resBuzon = JSON.parse(rawBuzon);

  if (!resBuzon.ok) {
    console.error("❌ Error al leer buzón:", resBuzon.error);
    process.exit(1);
  }

  const { total_pendientes, mensajes } = resBuzon.data;
  console.log(`✅ Mensajes encontrados en buzón: ${total_pendientes}`);

  const resumenResultados: Array<{
    id: string;
    de: string;
    asunto: string;
    clasificacion: string;
    revision: string;
    accion_1: string;
    accion_2?: string;
  }> = [];

  // Guardar contrato de msg-006 para la segunda pasada
  let contratoMsg006: any = null;

  // 3. Procesamiento en orden de los 6 mensajes (Primera pasada)
  console.log("\n================================================================================");
  console.log(" 📋 [PASO 2] Procesando mensajes 1 a 6 (Primera Pasada - Sin Confirmación Humana)");
  console.log("================================================================================");

  for (const msg of mensajes) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`🔍 Procesando Mensaje: [${msg.id}]`);
    console.log(`   De: ${msg.de}`);
    console.log(`   Asunto: "${msg.asunto}"`);
    console.log(`   Tiene contrato preliminar: ${msg.tiene_contrato}`);

    // Extraer
    const rawExtr = await extraer.execute({ mensaje_id: msg.id }, ctx);
    const resExtr = JSON.parse(rawExtr);
    const contrato = resExtr.data;

    // Validar
    const rawVal = await validar.execute({ mensaje_id: msg.id, contrato }, ctx);
    const resVal = JSON.parse(rawVal);
    const val = resVal.data;

    const revisionStr =
      val.requiere_revision && val.requiere_revision.length > 0
        ? val.requiere_revision.join(", ")
        : "Ninguno";

    console.log(`   📊 Clasificación: ${val.clasificacion.toUpperCase()}`);
    console.log(`   ⚠️  Campos en revisión: ${revisionStr}`);
    if (val.diferencias && Object.keys(val.diferencias).length > 0) {
      console.log(`   🔄 Diferencias detectadas:`, JSON.stringify(val.diferencias));
    }

    // Intentar registrar sin confirmar
    const rawReg = await registrar.execute(
      { mensaje_id: msg.id, contrato, confirmado: false },
      ctx
    );
    const resReg = JSON.parse(rawReg);

    let accionTomada = "";
    if (resReg.ok) {
      accionTomada = `Registrado (${resReg.data.accion})`;
      console.log(`   ✅ Acción tomada: ${accionTomada}`);
      if (resReg.data.ruta_archivo) {
        console.log(`   📁 Archivo: ${resReg.data.ruta_archivo}`);
      }
    } else {
      accionTomada = `DETENIDO: ${resReg.error}`;
      console.log(`   🛑 Acción tomada: ${accionTomada}`);
    }

    if (msg.id === "msg-006") {
      contratoMsg006 = contrato;
    }

    resumenResultados.push({
      id: msg.id,
      de: msg.de,
      asunto: msg.asunto,
      clasificacion: val.clasificacion,
      revision: revisionStr,
      accion_1: accionTomada,
    });
  }

  // 4. Segunda pasada para msg-006 con confirmación humana (Requisito Sec. 6.6)
  console.log("\n================================================================================");
  console.log(" 👤 [PASO 3] Segunda Pasada: Simulación de Confirmación Humana para msg-006");
  console.log("================================================================================");
  console.log("Analista administrativa revisa msg-006 (Contrato marco Distribuidora Caribe):");
  console.log(" - Confirma valor: $0 (por demanda)");
  console.log(" - Confirma plazo: 12 meses (fecha_fin estimada: 2027-08-31)");
  console.log("Invocando contratos_registrar con { confirmado: true }...");

  const rawReg006 = await registrar.execute(
    { mensaje_id: "msg-006", contrato: contratoMsg006, confirmado: true },
    ctx
  );
  const resReg006 = JSON.parse(rawReg006);

  if (resReg006.ok) {
    console.log(`✅ msg-006 registrado exitosamente tras confirmación:`);
    console.log(`   ID: ${resReg006.data.id_contrato}`);
    console.log(`   Acción: ${resReg006.data.accion}`);
    console.log(`   Archivo SharePoint: ${resReg006.data.ruta_archivo}`);
    const r6 = resumenResultados.find((r) => r.id === "msg-006");
    if (r6) r6.accion_2 = `Registrado (confirmado=true)`;
  } else {
    console.error("❌ Error en registro confirmado de msg-006:", resReg006.error);
  }

  // 5. Generar reporte de alertas (HU-5)
  console.log("\n================================================================================");
  console.log(" 🚨 [PASO 4] Generación de Reporte de Alertas (contratos_alertas)");
  console.log("================================================================================");
  const fechaHoy = "2026-09-03";
  console.log(`Fecha de referencia: ${fechaHoy}`);
  const rawAlertas = await alertas.execute({ hoy: fechaHoy }, ctx);
  const resAlertas = JSON.parse(rawAlertas);

  if (resAlertas.ok) {
    console.log(`✅ Reporte guardado en: ${resAlertas.data.ruta}`);
    console.log(`   ⏰ Contratos vencen ≤ 60 días: ${resAlertas.data.vencen.length}`);
    for (const v of resAlertas.data.vencen) {
      console.log(`      - ${v.id_contrato} (${v.cliente}): vence en ${v.dias_restantes} días (${v.fecha_fin})`);
    }
    console.log(`   🛡️  Pólizas requeridas pendientes: ${resAlertas.data.polizas_pendientes.length}`);
    for (const p of resAlertas.data.polizas_pendientes) {
      console.log(`      - ${p.id_contrato} (${p.cliente}): estado ${p.estado_poliza} (${p.tipo_poliza})`);
    }
    console.log(`   📈 Contratos registrados desde corte 2026-05-30: ${resAlertas.data.registrados_desde_corte.length}`);
  }

  // 6. Tabla Resumen Final de Ejecución
  console.log("\n================================================================================");
  console.log(" 📊 TABLA RESUMEN DE EJECUCIÓN (6 MENSAJES DEL BUZÓN)");
  console.log("================================================================================");
  console.table(
    resumenResultados.map((r) => ({
      Mensaje: r.id,
      Clasificación: r.clasificacion,
      "Campos Revisión": r.revision,
      "Pasada 1 (confirmado=false)": r.accion_1.includes("DETENIDO") ? "DETENIDO (RN5)" : r.accion_1,
      "Pasada 2 (confirmado=true)": r.accion_2 || "-",
    }))
  );

  console.log("\n🎉 DEMO COMPLETADA EXITOSAMENTE SIN NINGUNA CLAVE DE PROVEEDOR LLM.");
  console.log("================================================================================\n");
}

runDemo().catch((err) => {
  console.error("Error fatal en demo:", err);
  process.exit(1);
});
