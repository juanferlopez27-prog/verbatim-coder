# Codificador de Respuestas Abiertas · IA v2.0
### Powered by Google Gemini Flash · 100% Gratis

---

## ¿Cómo obtener tu API Key gratuita de Google?

1. Ve a → **https://aistudio.google.com/app/apikey**
2. Inicia sesión con tu cuenta Google
3. Clic en **"Create API Key"**
4. Copia la key (empieza con `AIza...`)
5. Pégala en la app al abrir

✓ Completamente gratis  
✓ Sin tarjeta de crédito  
✓ 1,500 requests/día  
✓ Se activa en segundos  

---

## ¿Cómo desplegar en Vercel? (URL pública gratis)

### Paso 1 — Sube a GitHub
1. Crea cuenta en **github.com** (gratis)
2. Crea un nuevo repositorio → llámalo `verbatim-coder`
3. Sube los archivos de esta carpeta al repositorio

### Paso 2 — Despliega en Vercel
1. Ve a **vercel.com** → crea cuenta con tu GitHub (gratis)
2. Clic en **"Add New Project"**
3. Selecciona el repositorio `verbatim-coder`
4. Clic en **Deploy**
5. En ~2 minutos tienes tu URL: `verbatim-coder.vercel.app`

### Paso 3 — Comparte
Comparte la URL con tu equipo. Cada persona:
- Abre el link en su navegador
- Ingresa su propia API Key de Google (gratis, se obtiene en 1 min)
- La key se guarda en su navegador, no en ningún servidor

---

## Funcionalidades

| Feature | Detalle |
|---|---|
| Capacidad | Hasta 900+ respuestas |
| Procesamiento | Lotes de 80 con codebook unificado |
| Libro de códigos | Inductivo automático (hasta 15 categorías) |
| Edición | Doble clic en cualquier fila para corregir |
| Filtros | Por categoría, sentimiento y búsqueda de texto |
| Dashboard | Frecuencias, %, sentimiento, gráfico de barras |
| Exportación | CSV completo + copia para Excel |
| Costo | $0 — 100% gratis con Google Gemini |

---

## Estructura del proyecto

```
verbatim-coder/
├── public/
│   └── index.html
├── src/
│   ├── App.js       ← Toda la lógica y UI
│   └── index.js     ← Entry point
├── package.json
├── vercel.json
└── README.md
```
