import { useState, useCallback, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = [
  { bg: "#c8f05a", fg: "#0c0c0f", light: "#c8f05a18" },
  { bg: "#5af0c8", fg: "#0c0c0f", light: "#5af0c818" },
  { bg: "#f0c85a", fg: "#0c0c0f", light: "#f0c85a18" },
  { bg: "#c85af0", fg: "#fff",    light: "#c85af018" },
  { bg: "#f05a8f", fg: "#fff",    light: "#f05a8f18" },
  { bg: "#5a8ff0", fg: "#fff",    light: "#5a8ff018" },
  { bg: "#f07a5a", fg: "#0c0c0f", light: "#f07a5a18" },
  { bg: "#8ff05a", fg: "#0c0c0f", light: "#8ff05a18" },
  { bg: "#5af0f0", fg: "#0c0c0f", light: "#5af0f018" },
  { bg: "#f05af0", fg: "#fff",    light: "#f05af018" },
  { bg: "#a0f05a", fg: "#0c0c0f", light: "#a0f05a18" },
  { bg: "#5a5af0", fg: "#fff",    light: "#5a5af018" },
  { bg: "#f0a05a", fg: "#0c0c0f", light: "#f0a05a18" },
  { bg: "#5af08f", fg: "#0c0c0f", light: "#5af08f18" },
  { bg: "#f05a5a", fg: "#fff",    light: "#f05a5a18" },
];

const SENT_COLORS = { POSITIVO: "#5af0c8", NEGATIVO: "#f05a5a", NEUTRO: "#888", MIXTO: "#f0c85a" };
const SENT_OPTS = ["POSITIVO", "NEGATIVO", "NEUTRO", "MIXTO"];
const BATCH_SIZE = 50;
const GEMINI_MODEL = "gemini-2.0-flash";

// ─── Gemini API helper ────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `Error ${res.status}`;
    if (res.status === 400) throw new Error("API Key inválida. Verifica que copiaste bien tu clave de Google AI Studio.");
    if (res.status === 429) throw new Error("Límite de requests alcanzado. Espera 1 minuto e intenta de nuevo.");
    throw new Error(msg);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = raw.replace(/```json[\s\S]*?```/g, m => m.slice(7, -3)).replace(/```/g, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("La IA no devolvió un JSON válido. Intenta reducir el número de respuestas por lote.");
  return JSON.parse(match[0]);
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("vb_gemini_key") || "");
  const [showKey, setShowKey] = useState(false);
  const [question, setQuestion] = useState("");
  const [sector, setSector] = useState("");
  const [lang, setLang] = useState("español");
  const [maxcats, setMaxcats] = useState("10");
  const [extra, setExtra] = useState("");
  const [rawText, setRawText] = useState("");
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0, msg: "" });
  const [error, setError] = useState("");
  const [codebook, setCodebook] = useState([]);
  const [coded, setCoded] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [editingRow, setEditingRow] = useState(null);
  const [filterCat, setFilterCat] = useState("ALL");
  const [filterSent, setFilterSent] = useState("ALL");
  const [searchText, setSearchText] = useState("");
  const cancelRef = useRef(false);

  const saveKey = (k) => { setApiKey(k); localStorage.setItem("vb_gemini_key", k); };

  const responses = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 2);
  const batchCount = Math.ceil(responses.length / BATCH_SIZE);
  const estSecs = batchCount * 12 + 12;

  // ── Phase 1: Build codebook ────────────────────────────────────────────────
  const buildCodebook = async (resps) => {
    const sampleSize = Math.min(200, resps.length);
    const step = Math.max(1, Math.floor(resps.length / sampleSize));
    const sample = resps.filter((_, i) => i % step === 0).slice(0, sampleSize);

    setProgress({ current: 0, total: 1, msg: `Analizando muestra de ${sample.length} respuestas para construir libro de códigos…` });

    const prompt = `Eres un experto en codificación de preguntas abiertas en investigación de mercados.
Lee esta muestra de respuestas y construye un libro de códigos inductivo.

CONTEXTO:
- Pregunta analizada: ${question || "(no especificada)"}
- Sector/Categoría: ${sector || "(no especificado)"}
- Idioma: ${lang}
${extra ? "- Instrucciones adicionales: " + extra : ""}

REGLAS PARA EL LIBRO DE CÓDIGOS:
1. Máximo ${maxcats} categorías, mutuamente excluyentes y colectivamente exhaustivas.
2. Nombres cortos (2-4 palabras), descriptivos y sustantivos basados en el contenido real.
3. SIEMPRE incluir "OTRO / NO CLASIFICABLE" como última categoría.
4. Las categorías deben cubrir los temas más frecuentes e importantes.

MUESTRA DE RESPUESTAS (${sample.length} respuestas):
${sample.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Responde ÚNICAMENTE con este JSON (sin texto adicional):
{"codebook":[{"id":"C01","name":"Nombre corto","description":"Descripción de qué incluye esta categoría"}]}`;

    const result = await callGemini(apiKey, prompt);
    if (!result.codebook || !Array.isArray(result.codebook)) throw new Error("El libro de códigos recibido no es válido.");
    return result.codebook;
  };

  // ── Phase 2: Code a batch ──────────────────────────────────────────────────
  const codeBatch = async (batch, startIdx, cb) => {
    const cbStr = cb.map(c => `${c.id}: ${c.name} — ${c.description}`).join("\n");

    const prompt = `Eres un codificador experto en investigación de mercados.
Tienes un libro de códigos fijo. Asigna códigos a cada respuesta.

CONTEXTO:
- Pregunta analizada: ${question || "(no especificada)"}
- Idioma: ${lang}

LIBRO DE CÓDIGOS (usa SOLO estos códigos):
${cbStr}

REGLAS:
1. Asigna 1 a 3 códigos por respuesta, SOLO del libro de códigos anterior.
2. Si no encaja en ninguna categoría, usa el código de "OTRO / NO CLASIFICABLE".
3. Sentimiento: POSITIVO, NEGATIVO, NEUTRO o MIXTO.
4. Nota (máx 8 palabras) solo si es ambiguo o muy destacable, sino deja vacío.

RESPUESTAS A CODIFICAR:
${batch.map((r, i) => `${startIdx + i + 1}. ${r}`).join("\n")}

Responde ÚNICAMENTE con este JSON (sin texto adicional):
{"coded":[{"id":1,"codes":["C01"],"sentiment":"POSITIVO","note":""}]}`;

    const result = await callGemini(apiKey, prompt);
    if (!result.coded || !Array.isArray(result.coded)) throw new Error("Lote mal formateado.");

    return result.coded.map((row, i) => ({
      id: startIdx + i + 1,
      text: batch[i] || "",
      codes: Array.isArray(row.codes) ? row.codes : [],
      sentiment: SENT_OPTS.includes(row.sentiment) ? row.sentiment : "NEUTRO",
      note: row.note || "",
    }));
  };

  // ── Main runner ────────────────────────────────────────────────────────────
  const runCoding = useCallback(async () => {
    if (!apiKey.trim()) { setError("Ingresa tu API Key de Google AI Studio para continuar."); return; }
    if (responses.length === 0) { setError("Pega al menos algunas respuestas antes de continuar."); return; }

    setError(""); setCoded([]); setCodebook([]);
    cancelRef.current = false;

    try {
      setPhase("codebook");
      const cb = await buildCodebook(responses);
      if (cancelRef.current) return;
      setCodebook(cb);

      setPhase("coding");
      const batches = [];
      for (let i = 0; i < responses.length; i += BATCH_SIZE) batches.push(responses.slice(i, i + BATCH_SIZE));

      const allCoded = [];
      for (let b = 0; b < batches.length; b++) {
        if (cancelRef.current) return;
        setProgress({
          current: b + 1,
          total: batches.length,
          msg: `Codificando lote ${b + 1} de ${batches.length} · ${Math.min((b + 1) * BATCH_SIZE, responses.length)} / ${responses.length} respuestas procesadas…`,
        });
        const res = await codeBatch(batches[b], b * BATCH_SIZE, cb);
        allCoded.push(...res);
        if (b < batches.length - 1) await new Promise(r => setTimeout(r, 5000));
      }

      setCoded(allCoded);
      setPhase("done");
      setActiveTab("dashboard");
    } catch (err) {
      setError(err.message);
      setPhase("error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, rawText, question, sector, lang, maxcats, extra]);

  const cancel = () => { cancelRef.current = true; setPhase("idle"); };
  const reset = () => { setCoded([]); setCodebook([]); setPhase("idle"); setError(""); setRawText(""); setQuestion(""); setSector(""); setExtra(""); };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const catCounts = {};
  const sentCounts = { POSITIVO: 0, NEGATIVO: 0, NEUTRO: 0, MIXTO: 0 };
  coded.forEach(r => {
    r.codes.forEach(c => { catCounts[c] = (catCounts[c] || 0) + 1; });
    if (sentCounts[r.sentiment] !== undefined) sentCounts[r.sentiment]++;
  });
  const sortedCats = [...codebook].sort((a, b) => (catCounts[b.id] || 0) - (catCounts[a.id] || 0));
  const maxCount = sortedCats[0] ? (catCounts[sortedCats[0].id] || 0) : 1;

  const filteredCoded = coded.filter(r => {
    const catOk = filterCat === "ALL" || r.codes.includes(filterCat);
    const sentOk = filterSent === "ALL" || r.sentiment === filterSent;
    const txtOk = !searchText || r.text.toLowerCase().includes(searchText.toLowerCase());
    return catOk && sentOk && txtOk;
  });

  const updateRow = (id, field, value) => setCoded(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportCSV = () => {
    let csv = "LIBRO DE CÓDIGOS\nID,Nombre,Descripción,Frecuencia,Porcentaje\n";
    sortedCats.forEach(c => {
      const cnt = catCounts[c.id] || 0;
      const pct = coded.length > 0 ? ((cnt / coded.length) * 100).toFixed(1) : "0.0";
      csv += `"${c.id}","${c.name}","${c.description}","${cnt}","${pct}%"\n`;
    });
    csv += "\nRESUMEN SENTIMIENTO\nSentimiento,Frecuencia,Porcentaje\n";
    SENT_OPTS.forEach(s => {
      const cnt = sentCounts[s] || 0;
      csv += `"${s}","${cnt}","${coded.length > 0 ? ((cnt / coded.length) * 100).toFixed(1) : "0.0"}%"\n`;
    });
    csv += "\nCODIFICACIÓN COMPLETA\n#,Respuesta,Códigos,Categorías,Sentimiento,Notas\n";
    coded.forEach(r => {
      const names = r.codes.map(cid => { const c = codebook.find(x => x.id === cid); return c ? c.name : cid; }).join("; ");
      csv += `"${r.id}","${r.text.replace(/"/g, '""')}","${r.codes.join("; ")}","${names}","${r.sentiment}","${(r.note || "").replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `codificacion_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const copyForExcel = () => {
    let txt = "#\tRespuesta\tCódigos\tCategorías\tSentimiento\tNotas\n";
    coded.forEach(r => {
      const names = r.codes.map(cid => { const c = codebook.find(x => x.id === cid); return c ? c.name : cid; }).join("; ");
      txt += `${r.id}\t${r.text}\t${r.codes.join("; ")}\t${names}\t${r.sentiment}\t${r.note || ""}\n`;
    });
    navigator.clipboard.writeText(txt);
  };

  const isRunning = phase === "codebook" || phase === "coding";
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // ── Styles ─────────────────────────────────────────────────────────────────
  const C = {
    app: { fontFamily: "'DM Mono','Courier New',monospace", background: "#0c0c0f", minHeight: "100vh", color: "#e2e2e8", padding: "0 0 80px" },
    grid: { position: "fixed", inset: 0, backgroundImage: "linear-gradient(rgba(200,240,90,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(200,240,90,.025) 1px,transparent 1px)", backgroundSize: "44px 44px", pointerEvents: "none", zIndex: 0 },
    inner: { position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "40px 20px" },
    tag: { display: "inline-block", fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: "#c8f05a", border: "1px solid #c8f05a", padding: "3px 10px", borderRadius: 2, marginBottom: 14 },
    h1: { fontSize: "clamp(28px,5vw,48px)", fontWeight: 300, lineHeight: 1.08, marginBottom: 10 },
    em: { color: "#c8f05a", fontStyle: "italic" },
    sub: { fontSize: 12, color: "#5a5a68", lineHeight: 1.7, maxWidth: 540, marginBottom: 40 },
    card: { background: "#131317", border: "1px solid #252530", borderRadius: 14, padding: "28px", position: "relative", marginBottom: 18 },
    cardHL: { borderColor: "#c8f05a33" },
    badge: (color = "#c8f05a") => ({ position: "absolute", top: -11, left: 22, background: color, color: color === "#c8f05a" ? "#0c0c0f" : "#fff", fontSize: 10, fontWeight: 700, padding: "2px 12px", borderRadius: 20, letterSpacing: ".1em" }),
    stepTitle: { fontSize: 12, color: "#5a5a68", marginBottom: 18, letterSpacing: ".04em" },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
    label: { display: "block", fontSize: 10, color: "#5a5a68", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 5 },
    inp: { width: "100%", background: "#1a1a20", border: "1px solid #252530", color: "#e2e2e8", fontFamily: "inherit", fontSize: 12, padding: "9px 12px", borderRadius: 8, outline: "none", boxSizing: "border-box" },
    ta: { width: "100%", background: "#1a1a20", border: "1px solid #252530", color: "#e2e2e8", fontFamily: "inherit", fontSize: 12, padding: "12px", borderRadius: 8, outline: "none", resize: "vertical", minHeight: 200, lineHeight: 1.7, boxSizing: "border-box" },
    btnP: { display: "inline-flex", alignItems: "center", gap: 7, background: "#c8f05a", color: "#0c0c0f", border: "none", borderRadius: 8, padding: "11px 24px", fontSize: 12, fontFamily: "inherit", fontWeight: 700, cursor: "pointer" },
    btnG: { display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", color: "#5a5a68", border: "1px solid #252530", borderRadius: 8, padding: "11px 20px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" },
    btnR: { display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(240,90,90,.1)", color: "#f05a5a", border: "1px solid rgba(240,90,90,.3)", borderRadius: 8, padding: "11px 20px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" },
    chip: { fontSize: 11, padding: "3px 10px", background: "#1a1a20", border: "1px solid #252530", borderRadius: 20, color: "#5a5a68" },
    chipV: { color: "#5af0c8" },
    err: { background: "rgba(240,90,90,.07)", border: "1px solid rgba(240,90,90,.25)", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "#f05a5a", marginTop: 14, lineHeight: 1.6 },
    ok: { background: "rgba(90,240,200,.06)", border: "1px solid rgba(90,240,200,.2)", borderRadius: 8, padding: "10px 16px", fontSize: 12, color: "#5af0c8", marginTop: 14 },
    info: { background: "rgba(200,240,90,.05)", border: "1px solid rgba(200,240,90,.2)", borderRadius: 8, padding: "14px 16px", fontSize: 12, color: "#c8f05a", lineHeight: 1.7 },
    sLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: ".15em", color: "#5a5a68", marginBottom: 10 },
    tableWrap: { overflowX: "auto", border: "1px solid #252530", borderRadius: 10 },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 11 },
    th: { padding: "9px 13px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em", color: "#5a5a68", borderBottom: "1px solid #252530", background: "#1a1a20", whiteSpace: "nowrap" },
    td: { padding: "8px 13px", borderBottom: "1px solid rgba(37,37,48,.5)", verticalAlign: "top", lineHeight: 1.5 },
    tab: (a) => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, fontSize: 12, fontFamily: "inherit", cursor: "pointer", border: "1px solid", background: a ? "#c8f05a" : "transparent", color: a ? "#0c0c0f" : "#5a5a68", borderColor: a ? "#c8f05a" : "#252530", fontWeight: a ? 700 : 400 }),
    sel: { background: "#1a1a20", border: "1px solid #252530", color: "#e2e2e8", fontFamily: "inherit", fontSize: 11, padding: "5px 8px", borderRadius: 6, outline: "none" },
    progTrack: { height: 4, background: "#252530", borderRadius: 99, overflow: "hidden", marginBottom: 6 },
    progFill: (p) => ({ height: "100%", width: p + "%", background: "linear-gradient(90deg,#c8f05a,#5af0c8)", borderRadius: 99, transition: "width .4s ease" }),
  };

  return (
    <div style={C.app}>
      <div style={C.grid} />
      <div style={C.inner}>

        {/* Header */}
        <div style={C.tag}>↯ Powered by Google Gemini · 100% Gratis</div>
        <h1 style={C.h1}>Codificador de<br /><em style={C.em}>Respuestas Abiertas</em></h1>
        <p style={C.sub}>Herramienta de investigación de mercados. Codificación automática de hasta 900+ verbatims con IA. Libro de códigos inductivo, edición manual y exportación lista para reportes.</p>

        {/* API Key Card */}
        <div style={{ ...C.card, ...C.cardHL }}>
          <div style={C.badge("#4285f4")}>🔑 GOOGLE AI STUDIO · GRATIS</div>
          <p style={C.stepTitle}>API Key de Google Gemini. Gratuita, sin tarjeta de crédito. Se guarda solo en tu navegador.</p>

          <div style={C.info}>
            <strong>¿Cómo obtener tu API Key gratis?</strong><br />
            1. Ve a <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: "#c8f05a" }}>aistudio.google.com/app/apikey</a><br />
            2. Haz clic en <strong>"Create API Key"</strong><br />
            3. Copia la key y pégala aquí abajo<br />
            <span style={{ color: "#5a5a68", fontSize: 11 }}>✓ 1,500 requests/día gratis · ✓ Sin tarjeta de crédito · ✓ Activa en segundos</span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <input
              style={{ ...C.inp, flex: 1, letterSpacing: apiKey && !showKey ? ".15em" : "normal" }}
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={e => saveKey(e.target.value)}
              placeholder="AIza..."
            />
            <button style={C.btnG} onClick={() => setShowKey(s => !s)}>{showKey ? "🙈 Ocultar" : "👁 Ver"}</button>
          </div>
          {apiKey && <p style={{ fontSize: 11, color: "#5af0c8", marginTop: 8 }}>✓ API Key guardada en tu navegador</p>}
        </div>

        {/* Step 1 — Context */}
        <div style={C.card}>
          <div style={C.badge()}>01 — CONTEXTO</div>
          <p style={C.stepTitle}>Define el marco para que la IA codifique con precisión contextual</p>
          <div style={C.row2}>
            <div><label style={C.label}>Pregunta / Tema analizado</label>
              <input style={C.inp} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ej: ¿Por qué prefiere la marca Familia?" disabled={isRunning} /></div>
            <div><label style={C.label}>Sector / Categoría</label>
              <input style={C.inp} value={sector} onChange={e => setSector(e.target.value)} placeholder="Ej: Papel higiénico, Consumo masivo" disabled={isRunning} /></div>
          </div>
          <div style={C.row2}>
            <div>
              <label style={C.label}>Idioma de las respuestas</label>
              <select style={C.inp} value={lang} onChange={e => setLang(e.target.value)} disabled={isRunning}>
                <option value="español">Español</option>
                <option value="inglés">Inglés</option>
                <option value="portugués">Portugués</option>
              </select>
            </div>
            <div>
              <label style={C.label}>Máximo de categorías</label>
              <select style={C.inp} value={maxcats} onChange={e => setMaxcats(e.target.value)} disabled={isRunning}>
                {["5","8","10","12","15"].map(v => <option key={v} value={v}>{v} categorías</option>)}
              </select>
            </div>
          </div>
          <div><label style={C.label}>Instrucciones adicionales (opcional)</label>
            <input style={C.inp} value={extra} onChange={e => setExtra(e.target.value)}
              placeholder="Ej: Distinguir razones funcionales de emocionales, agrupar por atributo de precio…" disabled={isRunning} />
          </div>
        </div>

        {/* Step 2 — Verbatims */}
        <div style={C.card}>
          <div style={C.badge()}>02 — VERBATIMS</div>
          <p style={C.stepTitle}>Una respuesta por línea. Pega directo desde Excel, CAWI o cualquier fuente.</p>
          <textarea style={C.ta} value={rawText} onChange={e => setRawText(e.target.value)} disabled={isRunning}
            placeholder={"Pega aquí las respuestas...\n\nEjemplo:\nMe gusta porque es suave y no irrita la piel\nEs económica y rinde más que las otras marcas\nMuy buena calidad para el precio que tiene\nLa he usado toda la vida, nunca me ha fallado\nNo me convence, la siento muy delgada\nExcelente para la familia, sobre todo para los niños\n..."} />
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <span style={C.chip}>Respuestas detectadas: <span style={C.chipV}>{responses.length}</span></span>
            <span style={C.chip}>Lotes: <span style={C.chipV}>{batchCount}</span></span>
            <span style={C.chip}>Tiempo aprox: <span style={C.chipV}>~{estSecs}s</span></span>
          </div>
          <p style={{ fontSize: 11, color: "#3a3a48", marginTop: 8, lineHeight: 1.5 }}>
            💡 Soporta 900+ respuestas. Procesa en lotes de {BATCH_SIZE} con libro de códigos unificado.
          </p>
        </div>

        {/* Step 3 — Run */}
        <div style={C.card}>
          <div style={C.badge()}>03 — EJECUTAR</div>
          <p style={C.stepTitle}>Fase 1: construye el libro de códigos inductivo. Fase 2: codifica todos los lotes con consistencia.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!isRunning
              ? <button style={{ ...C.btnP, opacity: responses.length === 0 || !apiKey ? 0.4 : 1 }}
                  onClick={runCoding} disabled={responses.length === 0 || !apiKey}>
                  ⚡ Iniciar codificación
                </button>
              : <button style={C.btnR} onClick={cancel}>✕ Cancelar proceso</button>
            }
            {(phase === "done" || phase === "error") && <button style={C.btnG} onClick={reset}>↺ Nuevo análisis</button>}
          </div>

          {isRunning && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#5a5a68", marginBottom: 5 }}>
                <span>{phase === "codebook" ? "Fase 1/2 — Construyendo libro de códigos" : `Fase 2/2 — Codificando respuestas (${pct}%)`}</span>
                {phase === "coding" && <span>Lote {progress.current} / {progress.total}</span>}
              </div>
              <div style={C.progTrack}><div style={C.progFill(phase === "codebook" ? 8 : pct)} /></div>
              <p style={{ fontSize: 11, color: "#5a5a68", fontStyle: "italic", marginTop: 5 }}>{progress.msg}</p>
            </div>
          )}

          {phase === "done" && <div style={C.ok}>✓ Completado — {coded.length} respuestas procesadas · {codebook.length} categorías generadas</div>}
          {error && <div style={C.err}>⚠ {error}</div>}
        </div>

        {/* Results */}
        {phase === "done" && coded.length > 0 && (
          <div style={C.card}>
            <div style={C.badge()}>RESULTADOS</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24, marginTop: 8, flexWrap: "wrap" }}>
              <button style={C.tab(activeTab === "dashboard")} onClick={() => setActiveTab("dashboard")}>📊 Dashboard ejecutivo</button>
              <button style={C.tab(activeTab === "table")} onClick={() => setActiveTab("table")}>📋 Tabla de codificación</button>
            </div>

            {/* Dashboard */}
            {activeTab === "dashboard" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 28 }}>
                  {[
                    { n: coded.length, l: "Total respuestas" },
                    { n: codebook.length, l: "Categorías" },
                    { n: sentCounts.POSITIVO, l: "Positivo", c: "#5af0c8" },
                    { n: sentCounts.NEGATIVO, l: "Negativo", c: "#f05a5a" },
                    { n: sentCounts.NEUTRO, l: "Neutro", c: "#888" },
                    { n: sentCounts.MIXTO, l: "Mixto", c: "#f0c85a" },
                  ].map((k, i) => (
                    <div key={i} style={{ background: "#1a1a20", border: "1px solid #252530", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ fontSize: 30, fontWeight: 700, color: k.c || "#c8f05a", lineHeight: 1 }}>{k.n}</div>
                      <div style={{ fontSize: 10, color: "#5a5a68", textTransform: "uppercase", letterSpacing: ".08em", marginTop: 4 }}>{k.l}</div>
                    </div>
                  ))}
                </div>

                <div style={C.sLabel}>Frecuencia por categoría (mayor a menor)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 28 }}>
                  {sortedCats.map(cat => {
                    const idx = codebook.findIndex(c => c.id === cat.id);
                    const col = COLORS[idx % COLORS.length];
                    const cnt = catCounts[cat.id] || 0;
                    const barPct = maxCount > 0 ? (cnt / maxCount) * 100 : 0;
                    const respPct = coded.length > 0 ? ((cnt / coded.length) * 100).toFixed(1) : "0.0";
                    return (
                      <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 34, fontSize: 10, color: col.bg, textAlign: "right", flexShrink: 0, fontWeight: 700 }}>{cat.id}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                            <span style={{ color: "#c8c8d8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.name}</span>
                            <span style={{ color: col.bg, flexShrink: 0, marginLeft: 8 }}>{cnt} ({respPct}%)</span>
                          </div>
                          <div style={{ height: 6, background: "#252530", borderRadius: 99, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: barPct + "%", background: col.bg, borderRadius: 99, transition: "width .6s ease" }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={C.sLabel}>Distribución de sentimiento</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
                  {SENT_OPTS.map(s => {
                    const cnt = sentCounts[s] || 0;
                    const p = coded.length > 0 ? ((cnt / coded.length) * 100).toFixed(1) : "0.0";
                    return (
                      <div key={s} style={{ background: "#1a1a20", border: `1px solid ${SENT_COLORS[s]}44`, borderRadius: 10, padding: "12px 18px", minWidth: 110 }}>
                        <div style={{ fontSize: 26, fontWeight: 700, color: SENT_COLORS[s] }}>{p}%</div>
                        <div style={{ fontSize: 10, color: "#5a5a68", textTransform: "uppercase", marginTop: 2 }}>{s}</div>
                        <div style={{ fontSize: 11, color: "#5a5a68" }}>{cnt} resp.</div>
                      </div>
                    );
                  })}
                </div>

                <div style={C.sLabel}>Libro de códigos generado</div>
                <div style={C.tableWrap}>
                  <table style={C.table}>
                    <thead><tr>{["ID","Categoría","Descripción","Frec.","% Total"].map(h => <th key={h} style={C.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {sortedCats.map(cat => {
                        const idx = codebook.findIndex(c => c.id === cat.id);
                        const col = COLORS[idx % COLORS.length];
                        const cnt = catCounts[cat.id] || 0;
                        const p = coded.length > 0 ? ((cnt / coded.length) * 100).toFixed(1) : "0.0";
                        return (
                          <tr key={cat.id}>
                            <td style={{ ...C.td, color: col.bg, fontWeight: 700 }}>{cat.id}</td>
                            <td style={C.td}><span style={{ background: col.light, color: col.bg, padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{cat.name}</span></td>
                            <td style={{ ...C.td, color: "#5a5a68", fontSize: 11 }}>{cat.description}</td>
                            <td style={{ ...C.td, textAlign: "center" }}>{cnt}</td>
                            <td style={{ ...C.td, color: col.bg, textAlign: "center", fontWeight: 700 }}>{p}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Table */}
            {activeTab === "table" && (
              <div>
                <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <input style={{ ...C.inp, maxWidth: 220 }} value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="🔍 Buscar en respuestas…" />
                  <select style={C.sel} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                    <option value="ALL">Todas las categorías</option>
                    {codebook.map(c => <option key={c.id} value={c.id}>{c.id}: {c.name}</option>)}
                  </select>
                  <select style={C.sel} value={filterSent} onChange={e => setFilterSent(e.target.value)}>
                    <option value="ALL">Todos los sentimientos</option>
                    {SENT_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span style={{ ...C.chip, marginLeft: "auto" }}>
                    Mostrando <span style={C.chipV}>{filteredCoded.length}</span> de {coded.length}
                  </span>
                </div>

                <div style={C.tableWrap}>
                  <table style={C.table}>
                    <thead><tr>{["#","Respuesta original","Código(s) asignado(s)","Sentimiento","Notas IA"].map(h => <th key={h} style={C.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {filteredCoded.map((row, idx) => {
                        const isEditing = editingRow === row.id;
                        return (
                          <tr key={row.id}
                            style={{ background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)", cursor: "pointer" }}
                            onDoubleClick={() => setEditingRow(isEditing ? null : row.id)}>
                            <td style={{ ...C.td, color: "#5af0c8", textAlign: "center", fontSize: 10, width: 36 }}>{row.id}</td>
                            <td style={{ ...C.td, maxWidth: 280, color: "#6a6a7a", fontSize: 11 }}>{row.text}</td>
                            <td style={{ ...C.td, minWidth: 200 }}>
                              {isEditing ? (
                                <div>
                                  {codebook.map(c => {
                                    const col = COLORS[codebook.findIndex(x => x.id === c.id) % COLORS.length];
                                    return (
                                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, cursor: "pointer" }}>
                                        <input type="checkbox" checked={row.codes.includes(c.id)}
                                          onChange={e => updateRow(row.id, "codes", e.target.checked ? [...row.codes, c.id] : row.codes.filter(x => x !== c.id))} />
                                        <span style={{ fontSize: 10, color: col.bg }}>{c.id}: {c.name}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              ) : row.codes.map(cid => {
                                const i2 = codebook.findIndex(c => c.id === cid);
                                const col = COLORS[i2 % COLORS.length] || COLORS[0];
                                const cat = codebook.find(c => c.id === cid);
                                return <span key={cid} style={{ display: "inline-block", background: col.bg, color: col.fg, padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, margin: "2px 2px 2px 0", whiteSpace: "nowrap" }}>{cid}{cat ? ": " + cat.name : ""}</span>;
                              })}
                            </td>
                            <td style={{ ...C.td, minWidth: 100 }}>
                              {isEditing
                                ? <select style={C.sel} value={row.sentiment} onChange={e => updateRow(row.id, "sentiment", e.target.value)}>{SENT_OPTS.map(s => <option key={s} value={s}>{s}</option>)}</select>
                                : <span style={{ fontSize: 11, color: SENT_COLORS[row.sentiment] || "#888" }}>{row.sentiment}</span>}
                            </td>
                            <td style={{ ...C.td, fontSize: 11, color: "#5a5a68", maxWidth: 180 }}>
                              {isEditing
                                ? <input style={{ ...C.inp, fontSize: 11, padding: "4px 8px" }} value={row.note || ""} onChange={e => updateRow(row.id, "note", e.target.value)} />
                                : row.note}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 10, color: "#3a3a48", marginTop: 8 }}>💡 Doble clic en una fila para editar códigos, sentimiento y notas.</p>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 22, paddingTop: 20, borderTop: "1px solid #252530", flexWrap: "wrap" }}>
              <button style={C.btnP} onClick={exportCSV}>⬇ Exportar CSV completo</button>
              <button style={C.btnG} onClick={copyForExcel}>⎘ Copiar para Excel</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
