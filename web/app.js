// Client-side Application Logic - Perxia 2.0
const sessionId = "session_" + Math.random().toString(36).substring(2, 9);

// Elements
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const thinkingIndicator = document.getElementById("thinkingIndicator");
const confirmationBanner = document.getElementById("confirmationBanner");
const confirmationText = document.getElementById("confirmationText");
const btnConfirmarSi = document.getElementById("btnConfirmarSi");
const btnConfirmarNo = document.getElementById("btnConfirmarNo");
const btnQuickProcesar = document.getElementById("btnQuickProcesar");
const btnQuickAlertas = document.getElementById("btnQuickAlertas");
const btnReset = document.getElementById("btnReset");
const providerLabel = document.getElementById("providerLabel");
const modelLabel = document.getElementById("modelLabel");

// Tab Navigation
const navItems = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");

navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabName = btn.getAttribute("data-tab");
    navItems.forEach((b) => b.classList.remove("active"));
    views.forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    const targetView = document.getElementById(`view-${tabName}`);
    if (targetView) targetView.classList.add("active");

    if (tabName === "maestro") loadMaestro();
    if (tabName === "alertas") loadAlertas();
    if (tabName === "historial") loadHistorial();
  });
});

// Health check on startup
async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.ok) {
      providerLabel.textContent = data.provider;
      modelLabel.textContent = data.model;
    }
  } catch {
    providerLabel.textContent = "Conexión local";
    modelLabel.textContent = "Sin conexión API";
  }
}
checkHealth();

// Append message to chat
function appendMessage(role, text, toolCalls = []) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "user" ? "👤" : "🤖";

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  // Tool calls rendering
  if (toolCalls && toolCalls.length > 0) {
    const toolsContainer = document.createElement("div");
    toolsContainer.className = "tool-calls-list";

    for (const tc of toolCalls) {
      const card = document.createElement("div");
      card.className = "tool-call-card";

      const header = document.createElement("div");
      header.className = "tool-header";

      const isBlocked = tc.result?.ok === false;
      const statusPill = isBlocked
        ? `<span class="tool-pill blocked">PAUSA REVISIÓN</span>`
        : `<span class="tool-pill success">OK</span>`;

      header.innerHTML = `<span>⚙️ ${tc.tool}</span> ${statusPill}`;

      const body = document.createElement("div");
      body.className = "tool-body";
      body.textContent =
        `ARGUMENTOS:\n${JSON.stringify(tc.args, null, 2)}\n\nRESULTADO:\n${JSON.stringify(tc.result, null, 2)}`;

      card.appendChild(header);
      card.appendChild(body);
      toolsContainer.appendChild(card);
    }
    bubble.appendChild(toolsContainer);
  }

  // Text message rendering (Markdown-like parser)
  if (text) {
    const textDiv = document.createElement("div");
    textDiv.className = "msg-text";
    textDiv.innerHTML = formatMarkdown(text);
    bubble.appendChild(textDiv);
  }

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Simple client-side Markdown formatter
function formatMarkdown(md) {
  let html = md
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.*)\*\*/gim, "<strong>$1</strong>")
    .replace(/\*(.*)\*/gim, "<em>$1</em>")
    .replace(/`([^`]+)`/gim, "<code>$1</code>")
    .replace(/\n\n/gim, "</p><p>");

  // Simple table parser
  if (html.includes("|")) {
    const lines = html.split("\n");
    let inTable = false;
    let tableHtml = "<table>";
    const processedLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("|") && line.endsWith("|")) {
        if (line.includes("---")) continue; // header separator
        if (!inTable) {
          inTable = true;
          tableHtml += "<thead>";
        }
        const cells = line.split("|").filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
        tableHtml += "<tr>";
        cells.forEach((cell) => {
          tableHtml += `<td>${cell.trim()}</td>`;
        });
        tableHtml += "</tr>";
      } else {
        if (inTable) {
          inTable = false;
          tableHtml += "</table>";
          processedLines.push(tableHtml);
          tableHtml = "<table>";
        }
        processedLines.push(line);
      }
    }
    if (inTable) {
      tableHtml += "</table>";
      processedLines.push(tableHtml);
    }
    html = processedLines.join("\n");
  }

  return `<p>${html}</p>`;
}

// Send message to backend
async function sendMessage(text) {
  if (!text.trim()) return;

  appendMessage("user", text);
  userInput.value = "";
  thinkingIndicator.classList.remove("hidden");
  confirmationBanner.classList.add("hidden");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });

    const data = await res.json();
    thinkingIndicator.classList.add("hidden");

    if (data.ok) {
      appendMessage("assistant", data.reply, data.toolCalls);

      if (data.needsConfirmation) {
        confirmationBanner.classList.remove("hidden");
        confirmationText.textContent =
          "El contrato CM-2026-03 (Distribuidora Caribe) requiere confirmar valor $0 (por demanda) y vencimiento estimado en 2027-08-31.";
      }
    } else {
      appendMessage("assistant", `❌ Error: ${data.error}`);
    }
  } catch (err) {
    thinkingIndicator.classList.add("hidden");
    appendMessage("assistant", `❌ Error de conexión al servidor: ${err.message}`);
  }
}

// Event Listeners
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(userInput.value);
});

btnQuickProcesar.addEventListener("click", () => {
  sendMessage("Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme.");
});

btnQuickAlertas.addEventListener("click", () => {
  sendMessage("Genera el reporte de alertas con fecha de corte de hoy 2026-09-03.");
});

btnConfirmarSi.addEventListener("click", () => {
  confirmationBanner.classList.add("hidden");
  sendMessage("confirmo el valor 0 y la fecha fin 2027-08-31 para el contrato CM-2026-03 de Distribuidora Caribe.");
});

btnConfirmarNo.addEventListener("click", () => {
  confirmationBanner.classList.add("hidden");
  sendMessage("No confirmo los valores. Rechazar el registro de este contrato por el momento.");
});

btnReset.addEventListener("click", async () => {
  if (confirm("¿Deseas reiniciar la simulación y restaurar los datos iniciales?")) {
    await fetch("/api/reset", { method: "POST" });
    location.reload();
  }
});

// Load Maestro Table
async function loadMaestro() {
  const container = document.getElementById("maestroTableContainer");
  container.innerHTML = `<p class="placeholder-text">Cargando maestro...</p>`;
  try {
    const res = await fetch("/api/files/maestro");
    const data = await res.json();
    if (!data.ok) {
      container.innerHTML = `<p class="placeholder-text">Aún no se ha generado out/sharepoint/maestro-contratos.csv. Procesa el buzón primero.</p>`;
      return;
    }
    const lines = data.content.trim().split("\n");
    if (lines.length <= 1) {
      container.innerHTML = `<p class="placeholder-text">El maestro está vacío.</p>`;
      return;
    }
    const headers = lines[0].split(",");
    let html = `<table><thead><tr>`;
    headers.forEach((h) => {
      html += `<th>${h.trim()}</th>`;
    });
    html += `</tr></thead><tbody>`;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(",");
      html += `<tr>`;
      cols.forEach((col, idx) => {
        let val = col.trim();
        if (headers[idx]?.trim() === "estado_poliza") {
          val = `<span class="badge ${val}">${val.toUpperCase()}</span>`;
        }
        html += `<td>${val}</td>`;
      });
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="placeholder-text">Error al cargar maestro: ${err.message}</p>`;
  }
}

// Load Alertas View
async function loadAlertas() {
  const container = document.getElementById("alertasContainer");
  container.innerHTML = `<p class="placeholder-text">Cargando reporte de alertas...</p>`;
  try {
    const res = await fetch("/api/files/alertas");
    const data = await res.json();
    if (!data.ok) {
      container.innerHTML = `<p class="placeholder-text">Aún no se ha generado out/alertas.md. Procesa el buzón primero.</p>`;
      return;
    }
    container.innerHTML = formatMarkdown(data.content);
  } catch (err) {
    container.innerHTML = `<p class="placeholder-text">Error al cargar alertas: ${err.message}</p>`;
  }
}

// Load Historial View
async function loadHistorial() {
  const container = document.getElementById("historialContainer");
  container.innerHTML = `<p class="placeholder-text">Cargando historial...</p>`;
  try {
    const res = await fetch("/api/files/historial");
    const data = await res.json();
    if (!data.ok || !data.content.trim()) {
      container.innerHTML = `<p class="placeholder-text">No hay registros de auditoría aún en out/sharepoint/historial.jsonl.</p>`;
      return;
    }
    const lines = data.content.trim().split("\n");
    let html = "";
    lines.forEach((l) => {
      try {
        const item = JSON.parse(l);
        html += `
          <div class="timeline-item">
            <div class="timeline-content">
              <strong>[${item.accion.toUpperCase()}] Contrato ${item.id_contrato}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted); margin:0.2rem 0;">Fecha: ${item.ts} · Mensaje: ${item.mensaje_id}</div>
              <div>Cambios: <code>${JSON.stringify(item.cambios || {})}</code></div>
            </div>
          </div>
        `;
      } catch {}
    });
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="placeholder-text">Error al cargar historial: ${err.message}</p>`;
  }
}

document.getElementById("btnRefreshMaestro")?.addEventListener("click", loadMaestro);
document.getElementById("btnRefreshAlertas")?.addEventListener("click", loadAlertas);
document.getElementById("btnRefreshHistorial")?.addEventListener("click", loadHistorial);
