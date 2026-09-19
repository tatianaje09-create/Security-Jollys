import express from "express";
import path from "path";
import fs from "fs";
import http from "http";
import os from "os";
import { createServer as createViteServer } from "vite";
import { Server as SocketServer } from "socket.io";
import { registerRoomHandlers } from "./server/rooms";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Servidor HTTP compartido: Express + Vite + Socket.IO (salas en línea) usan el mismo puerto.
  const httpServer = http.createServer(app);
  const io = new SocketServer(httpServer, { maxHttpBufferSize: 1e5 });
  registerRoomHandlers(io);

  // Direcciones de esta computadora en la red local (para que otros dispositivos entren)
  const getLanUrls = (): string[] => {
    const urls: string[] = [];
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family === "IPv4" && !info.internal) {
          urls.push(`http://${info.address}:${PORT}`);
        }
      }
    }
    return urls;
  };

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({
      status: "online",
      port: PORT,
      game: "Security Jollys - Ciberseguridad por Cartas",
      framework: "Express + Vite (React 19 + TypeScript)",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      vscodeGuide: {
        command: "npm run dev",
        defaultPort: 3000,
        url: `http://localhost:${PORT}`
      }
    });
  });

  // Direcciones de red local: las usa el lobby en línea para armar el enlace de invitación
  app.get("/api/network", (req, res) => {
    res.json({ port: PORT, lanUrls: getLanUrls() });
  });

  app.get("/api/game-info", (req, res) => {
    res.json({
      name: "Security Jollys",
      version: "1.0.0",
      description: "Juego de cartas de ciberseguridad sobre la tríada CIA (Confidencialidad, Integridad y Disponibilidad)",
      entities: ["Empresa A", "Empresa B"],
      deck: [
        { id: "phishing", tipo: "ATAQUE", nombre: "Phishing", objetivo: "Confidencialidad", probabilidadBase: 60, icon: "mail" },
        { id: "ddos", tipo: "ATAQUE", nombre: "DDoS", objetivo: "Disponibilidad", probabilidadBase: 70, icon: "activity" },
        { id: "malware", tipo: "ATAQUE", nombre: "Malware", objetivo: "Integridad", probabilidadBase: 65, icon: "bug" },
        { id: "antivirus", tipo: "DEFENSA", nombre: "Antivirus", objetivo: "Confidencialidad", efecto: "Restaura C (+1)", probabilidadBase: 100, icon: "shield" },
        { id: "2fa", tipo: "DEFENSA", nombre: "2FA", objetivo: "Integridad", efecto: "Restaura I (+1)", probabilidadBase: 100, icon: "key" },
        { id: "firewall", tipo: "DEFENSA", nombre: "Firewall", objetivo: "Disponibilidad", efecto: "Restaura D (+1)", probabilidadBase: 100, icon: "shield" },
        { id: "jolly_ataque", tipo: "JOLLY", nombre: "Jolly Ataque", objetivo: "Múltiple (C, I, D)", probabilidadBase: 35, icon: "zap" },
        { id: "jolly_defensa", tipo: "JOLLY", nombre: "Jolly Defensa", objetivo: "Recuperación Total (3 vidas)", probabilidadBase: 100, icon: "sparkles" }
      ]
    });
  });

  // Static img serving for direct image asset access with case-insensitive fallback
  const imgPath = path.join(process.cwd(), "public", "img");

  app.get("/img/:fileName", (req, res, next) => {
    const requestedName = req.params.fileName;
    const directPath = path.join(imgPath, requestedName);
    if (fs.existsSync(directPath)) {
      return next();
    }
    try {
      if (fs.existsSync(imgPath)) {
        const files = fs.readdirSync(imgPath);
        const match = files.find(
          (f) =>
            f.toLowerCase() === requestedName.toLowerCase() ||
            f.toLowerCase().replace(/\.jpe?g$/, "") === requestedName.toLowerCase().replace(/\.jpe?g$/, "")
        );
        if (match) {
          const targetPath = path.join(imgPath, match);
          const header = fs.readFileSync(targetPath, "utf8").slice(0, 60);
          if (header.includes("<svg") || header.includes("<?xml")) {
            res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
          } else if (match.toLowerCase().endsWith(".png")) {
            res.setHeader("Content-Type", "image/png");
          } else if (match.toLowerCase().match(/\.jpe?g$/)) {
            res.setHeader("Content-Type", "image/jpeg");
          }
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          return res.sendFile(targetPath);
        }
      }
    } catch (e) {}
    next();
  });

  app.use(
    "/img",
    express.static(imgPath, {
      setHeaders: (res, filePath) => {
        try {
          const header = fs.readFileSync(filePath, "utf8").slice(0, 60);
          if (header.includes("<svg") || header.includes("<?xml")) {
            res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
          }
        } catch (e) {}
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    })
  );

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      // hmr.server: el hot-reload usa el mismo puerto (si no, otros dispositivos en la red
      // no alcanzan el puerto 24678 de Vite y la página se recarga en bucle).
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          try {
            const header = fs.readFileSync(filePath, "utf8").slice(0, 60);
            if (header.includes("<svg") || header.includes("<?xml")) {
              res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
            }
          } catch (e) {}
        }
      })
    );
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Security Jollys server running on http://localhost:${PORT}`);
    const lan = getLanUrls();
    if (lan.length > 0) {
      console.log("Para jugar desde otro dispositivo en la misma red WiFi abre:");
      lan.forEach((u) => console.log(`  ${u}`));
    }
  });
}

startServer();
