<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/064dc81b-c416-4fb8-9254-0c28219a2593

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

(La variable `GEMINI_API_KEY` de `.env.example` es un sobrante de la plantilla y no la usa el juego; puedes ignorarla.)

## Jugar por internet (sin compartir WiFi)

Este proyecto ya trae `render.yaml`, así que el despliegue es en un click:

1. Sube esta carpeta a un repositorio en GitHub.
2. En [render.com](https://render.com), click en **New > Blueprint** y selecciona el repo (Render leerá `render.yaml` automáticamente). Si prefieres configurarlo a mano, usa **New > Web Service** con:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
3. Cuando termine el deploy, te da una URL pública (ej. `https://security-jollys.onrender.com`). Compártela y listo, cualquiera puede unirse desde esa URL sin estar en tu WiFi.

Alternativa rápida sin desplegar (solo para pruebas cortas): corre `npm run dev` localmente e instala [ngrok](https://ngrok.com), luego `ngrok http 3000`. Te da una URL temporal pública que se apaga si cierras la terminal.
