import React, { useState, useEffect } from "react";
import { 
  Server, 
  Terminal, 
  CheckCircle2, 
  Copy, 
  Check, 
  FolderOpen,
  Wifi,
  Image as ImageIcon
} from "lucide-react";
import { ServerHealthResponse } from "../types";
import { copyText } from "../utils/socket";

interface VsCodePortModalProps {
  isOpen?: boolean;
  onClose: () => void;
  currentPort?: number;
}

export const VsCodePortModal: React.FC<VsCodePortModalProps> = ({
  isOpen = true,
  onClose,
  currentPort = 3000
}) => {
  const [healthData, setHealthData] = useState<ServerHealthResponse | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);

  const checkConnection = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        setHealthData(data);
      }
    } catch {
      // Offline fallback
    }
    // Direcciones de esta computadora en la red WiFi (para jugar desde otro dispositivo)
    try {
      const res = await fetch("/api/network");
      if (res.ok) {
        const data = await res.json();
        setLanUrls(Array.isArray(data.lanUrls) ? data.lanUrls : []);
      }
    } catch {
      // Sin datos de red: se muestra el ejemplo genérico
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkConnection();
    }
  }, [isOpen]);

  const copyToClipboard = (text: string, index: number) => {
    copyText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[calc(var(--vh)*90)] overflow-y-auto rounded-xl border-2 border-amber-500 bg-[#12141c] text-white shadow-2xl p-6 font-['Arial']">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2a2c38]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-white">
                Guía de Ejecución en Visual Studio Code
              </h3>
              <p className="text-xs text-slate-400">
                Puerto configurado: <strong className="text-amber-300">:{currentPort}</strong> (http://localhost:{currentPort})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/10 text-xl font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Server status indicator */}
        <div className="my-4 p-3.5 rounded bg-[#181a24] border border-[#2e303f] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </span>
            <span className="text-sm font-semibold text-emerald-400">
              Servidor activo en el puerto {currentPort}
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {healthData ? "Online (Express + Vite)" : "Conectado"}
          </span>
        </div>

        {/* STEP 1: DÓNDE COLOCAR LAS IMÁGENES */}
        <div className="mb-5 p-4 rounded bg-[#181a24] border border-[#2e303f]">
          <div className="flex items-center gap-2 mb-2 text-amber-400 font-bold text-sm">
            <FolderOpen className="w-4 h-4" />
            <span>1. ¿Dónde poner tus imágenes descargadas?</span>
          </div>
          <p className="text-xs text-slate-300 mb-2">
            Copia tus imágenes dentro de la carpeta:
          </p>
          <div className="flex items-center justify-between p-2 rounded bg-[#0b0c10] border border-amber-500/30 font-mono text-xs text-amber-300 mb-3">
            <span>public/img/</span>
            <button
              onClick={() => copyToClipboard("public/img/", 99)}
              className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              {copiedIndex === 99 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="text-[11px] text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">Nombres exactos de las imágenes:</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-slate-300 bg-[#0f1015] p-2.5 rounded border border-[#252733]">
              <div>• <code>inicio.png</code> (Pantalla inicial)</div>
              <div>• <code>cartas.png</code> (Fondo menús)</div>
              <div>• <code>Mesa_jollys.jpeg</code> (Mesa de juego)</div>
              <div>• <code>dorso.png</code> (Dorso de cartas)</div>
              <div>• <code>J_diamante_phishing.png</code></div>
              <div>• <code>K_pica_ddos.png</code></div>
              <div>• <code>Q_trebol_malware.png</code></div>
              <div>• <code>K_pica_antivirus.png</code></div>
              <div>• <code>Q_trebol_2fa.png</code></div>
              <div>• <code>J_diamante_firewall.png</code></div>
              <div>• <code>Jolly_A.png</code> (Jolly Ataque)</div>
              <div>• <code>jolly_D.png</code> (Jolly Defensa)</div>
            </div>
          </div>
        </div>

        {/* STEP 2: COMANDOS DE VISUAL STUDIO CODE */}
        <div className="mb-5 p-4 rounded bg-[#181a24] border border-[#2e303f]">
          <div className="flex items-center gap-2 mb-2 text-amber-400 font-bold text-sm">
            <Terminal className="w-4 h-4" />
            <span>2. Comandos en la terminal de Visual Studio Code</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-300 mb-1">
                Paso A: Instalar dependencias (solo la primera vez):
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-[#0b0c10] border border-[#2d3040] font-mono text-xs text-emerald-400">
                <code>npm install</code>
                <button
                  onClick={() => copyToClipboard("npm install", 1)}
                  className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  {copiedIndex === 1 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-300 mb-1">
                Paso B: Iniciar el servidor en el puerto 3000:
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-[#0b0c10] border border-[#2d3040] font-mono text-xs text-emerald-400">
                <code>npm run dev</code>
                <button
                  onClick={() => copyToClipboard("npm run dev", 2)}
                  className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  {copiedIndex === 2 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* STEP 3: ABRIR EN EL NAVEGADOR */}
        <div className="p-4 rounded bg-[#181a24] border border-[#2e303f]">
          <div className="flex items-center gap-2 mb-1 text-amber-400 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>3. Abrir en tu navegador (en esta computadora)</span>
          </div>
          <p className="text-xs text-slate-300 mb-2">
            Una vez ejecutado <code>npm run dev</code>, abre tu navegador web en:
          </p>
          <div className="flex items-center justify-between p-2 rounded bg-[#0b0c10] border border-emerald-500/30 font-mono text-sm text-amber-300">
            <code>http://localhost:3000</code>
            <button
              onClick={() => copyToClipboard("http://localhost:3000", 3)}
              className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              {copiedIndex === 3 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* STEP 4: JUGAR DESDE OTRO DISPOSITIVO CON WIFI */}
        <div className="mt-5 p-4 rounded bg-[#181a24] border border-cyan-500/30">
          <div className="flex items-center gap-2 mb-1 text-cyan-300 font-bold text-sm">
            <Wifi className="w-4 h-4" />
            <span>4. Jugar con otro dispositivo (WiFi)</span>
          </div>
          <p className="text-xs text-slate-300 mb-2">
            El otro jugador <strong>no</strong> puede usar <code>localhost</code>. Con los dos dispositivos conectados a la
            misma red WiFi, debe abrir en su navegador la dirección de esta computadora, con este formato:
          </p>
          <div className="flex items-center justify-between p-2 rounded bg-[#0b0c10] border border-cyan-500/30 font-mono text-sm text-cyan-200 mb-3">
            <code>http://192.168.x.x:{currentPort}</code>
            <button
              onClick={() => copyToClipboard(`http://192.168.x.x:${currentPort}`, 4)}
              className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              {copiedIndex === 4 ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          {lanUrls.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-emerald-300 font-semibold mb-1">
                Tu dirección real (detectada ahora):
              </div>
              {lanUrls.map((url, i) => (
                <div
                  key={url}
                  className="flex items-center justify-between p-2 mb-1 rounded bg-[#0b0c10] border border-emerald-500/30 font-mono text-sm text-amber-300"
                >
                  <code>{url}</code>
                  <button
                    onClick={() => copyToClipboard(url, 10 + i)}
                    className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {copiedIndex === 10 + i ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}

          <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 leading-relaxed">
            <li>
              Las <code>192.168.x.x</code> son los números de tu IP. También aparece en la terminal al ejecutar{" "}
              <code>npm run dev</code> (línea <em>&quot;Para jugar desde otro dispositivo…&quot;</em>).
            </li>
            <li>
              Si no la ves, búscala: en Windows escribe <code>ipconfig</code> (dato «Dirección IPv4»); en Mac o Linux,{" "}
              <code>ifconfig</code> o <code>ip a</code>.
            </li>
            <li>
              Si Windows pregunta por el Firewall, pulsa <strong>Permitir acceso</strong> para Node.js.
            </li>
            <li>
              En el juego pulsa <strong>2 JUGADORES</strong>, comparte el código y el otro jugador lo escribe en su
              dispositivo.
            </li>
          </ol>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded bg-[#781414] hover:bg-[#8c1c1c] text-white font-bold text-sm border border-white cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};
