import React, { useEffect, useRef, useState } from "react";
import { Copy, Check, Link as LinkIcon, Loader2, Wifi } from "lucide-react";
import { OnlineAck } from "../types";
import {
  clearSavedRoom,
  connectSocket,
  copyText,
  emitAck,
  getPlayerId,
  saveRoom,
  socket
} from "../utils/socket";
import { playButtonClick } from "../utils/sound";

interface OnlineLobbyProps {
  /** Código que llegó por enlace (?sala=ABCDE): se intenta entrar directo. */
  joinCode?: string;
  /** Sala propia ya creada (por ejemplo, tras recargar la página). */
  resumeCode?: string;
  onBack: () => void;
  onLocal: () => void;
}

const CODE_LENGTH = 5;

const btnPrimary =
  "w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-lg tracking-wider text-amber-100 uppercase bg-gradient-to-b from-[#991b1b] via-[#851414] to-[#540909] border-2 border-amber-400/80 shadow-[0_6px_20px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:from-[#b91c1c] hover:via-[#991b1b] hover:to-[#630b0b] hover:border-amber-300 hover:shadow-[0_0_24px_rgba(251,191,36,0.5)] active:scale-95 transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

const btnSecondary =
  "w-full py-2.5 px-6 rounded-xl font-bold text-sm sm:text-base text-slate-300 uppercase bg-gradient-to-b from-[#1e2333] to-[#121520] border border-slate-500/60 hover:border-slate-400 hover:text-white active:scale-95 transition-all cursor-pointer";

const btnSmall =
  "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs sm:text-sm font-bold text-amber-100 bg-gradient-to-b from-[#1c1f2b] to-[#12141d] border border-amber-400/50 hover:border-amber-300 active:scale-95 transition-all cursor-pointer";

export const OnlineLobby: React.FC<OnlineLobbyProps> = ({ joinCode, resumeCode, onBack, onLocal }) => {
  const [codigo, setCodigo] = useState<string | null>(resumeCode ?? null);
  const [creando, setCreando] = useState<boolean>(!resumeCode && !joinCode);
  const [errorSala, setErrorSala] = useState<string | null>(null);
  const [codigoInput, setCodigoInput] = useState<string>(joinCode ?? "");
  const [uniendo, setUniendo] = useState<boolean>(false);
  const [errorUnirse, setErrorUnirse] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<"codigo" | "enlace" | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [conectado, setConectado] = useState<boolean>(socket.connected);
  const copiadoTimer = useRef<NodeJS.Timeout | null>(null);

  const esLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  // Estado de la conexión (para avisar si se cae mientras esperan)
  useEffect(() => {
    const on = () => setConectado(true);
    const off = () => setConectado(false);
    socket.on("connect", on);
    socket.on("disconnect", off);
    return () => {
      socket.off("connect", on);
      socket.off("disconnect", off);
    };
  }, []);

  // Al abrir el lobby: entra por enlace, retoma una sala o crea una nueva.
  useEffect(() => {
    let cancelado = false;
    connectSocket();

    const crearSala = async () => {
      setCreando(true);
      setErrorSala(null);
      try {
        const res = await emitAck<OnlineAck>("room:create", { playerId: getPlayerId() });
        if (cancelado) return;
        if (res.ok) {
          setCodigo(res.code);
          saveRoom(res.code);
        } else {
          setErrorSala(res.message);
        }
      } catch {
        if (!cancelado) setErrorSala("No se pudo conectar con el servidor. ¿Está corriendo `npm run dev`?");
      } finally {
        if (!cancelado) setCreando(false);
      }
    };

    if (joinCode) {
      // Entrada por enlace: intenta unirse; si falla, muestra el error y crea sala propia.
      (async () => {
        try {
          const res = await emitAck<OnlineAck>("room:join", { playerId: getPlayerId(), code: joinCode });
          if (cancelado) return;
          if (res.ok) {
            saveRoom(res.code);
            return; // el servidor enviará game:sync y App pasará a la pantalla de juego
          }
          setErrorUnirse(res.message);
        } catch {
          if (!cancelado) setErrorUnirse("No se pudo conectar con el servidor.");
        }
        if (!cancelado) crearSala();
      })();
    } else if (!resumeCode) {
      crearSala();
    }

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si abrieron la app por "localhost", otros dispositivos no pueden usar ese enlace:
  // pedimos al servidor su dirección en la red local.
  useEffect(() => {
    if (!esLocalhost) return;
    fetch("/api/network")
      .then((r) => r.json())
      .then((d: { lanUrls?: string[] }) => setLanUrl(d.lanUrls?.[0] ?? null))
      .catch(() => {});
  }, [esLocalhost]);

  useEffect(() => {
    return () => {
      if (copiadoTimer.current) clearTimeout(copiadoTimer.current);
    };
  }, []);

  const baseUrl = esLocalhost && lanUrl ? lanUrl : window.location.origin;
  const enlace = codigo ? `${baseUrl}/?sala=${codigo}` : "";

  const copiar = async (que: "codigo" | "enlace") => {
    playButtonClick();
    const ok = await copyText(que === "codigo" ? codigo ?? "" : enlace);
    if (!ok) return;
    setCopiado(que);
    if (copiadoTimer.current) clearTimeout(copiadoTimer.current);
    copiadoTimer.current = setTimeout(() => setCopiado(null), 2000);
  };

  const unirse = async () => {
    const code = codigoInput.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== CODE_LENGTH) {
      setErrorUnirse(`El código tiene ${CODE_LENGTH} caracteres.`);
      return;
    }
    playButtonClick();
    setUniendo(true);
    setErrorUnirse(null);
    try {
      const res = await emitAck<OnlineAck>("room:join", { playerId: getPlayerId(), code });
      if (res.ok) {
        saveRoom(res.code);
        // El servidor enviará game:sync a ambos y App pasará a la pantalla de juego.
      } else {
        setErrorUnirse(res.message);
      }
    } catch {
      setErrorUnirse("No se pudo conectar con el servidor.");
    } finally {
      setUniendo(false);
    }
  };

  const volver = () => {
    playButtonClick();
    if (socket.connected) socket.emit("room:leave");
    clearSavedRoom();
    onBack();
  };

  const jugarLocal = () => {
    playButtonClick();
    if (socket.connected) socket.emit("room:leave");
    clearSavedRoom();
    onLocal();
  };

  return (
    <div
      className="relative w-full h-full flex items-center justify-center bg-cover bg-center overflow-y-auto"
      style={{
        backgroundImage: "url('/img/cartas.png'), url('/img/Mesa_jollys.jpeg')",
        backgroundColor: "#0f0f14"
      }}
    >
      <div className="fixed inset-0 bg-black/60 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center bg-[#10121c]/95 border-2 border-amber-400/80 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] px-5 sm:px-8 py-6 w-[calc(var(--vw)*94)] max-w-md backdrop-blur-md my-4">
        <h2 className="font-black text-2xl sm:text-3xl text-amber-100 mb-1 tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
          JUGAR EN LÍNEA
        </h2>
        <p className="text-slate-400 text-xs sm:text-sm mb-4">Cada jugador usa su propio dispositivo</p>

        {/* ------------------------- Tu sala ------------------------- */}
        <div className="w-full rounded-xl border border-amber-400/40 bg-black/40 px-4 py-4">
          <div className="text-[11px] sm:text-xs font-bold tracking-widest text-amber-300/80 uppercase mb-1">
            Tu código de sala
          </div>

          {creando && (
            <div className="flex items-center justify-center gap-2 py-4 text-slate-300 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> Creando sala…
            </div>
          )}

          {!creando && errorSala && (
            <div className="py-2">
              <p className="text-rose-300 text-sm mb-2">{errorSala}</p>
              <button
                type="button"
                className={btnSmall}
                onClick={() => {
                  setCreando(true);
                  setErrorSala(null);
                  emitAck<OnlineAck>("room:create", { playerId: getPlayerId() })
                    .then((res) => {
                      if (res.ok) {
                        setCodigo(res.code);
                        saveRoom(res.code);
                      } else setErrorSala(res.message);
                    })
                    .catch(() => setErrorSala("No se pudo conectar con el servidor."))
                    .finally(() => setCreando(false));
                }}
              >
                Reintentar
              </button>
            </div>
          )}

          {!creando && codigo && (
            <>
              <div className="font-mono font-black text-4xl sm:text-5xl tracking-[0.3em] pl-[0.3em] text-amber-200 drop-shadow-[0_0_14px_rgba(251,191,36,0.55)] select-text">
                {codigo}
              </div>

              <div className="flex gap-2 mt-3">
                <button type="button" onClick={() => copiar("codigo")} className={btnSmall}>
                  {copiado === "codigo" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copiado === "codigo" ? "¡Copiado!" : "Copiar código"}
                </button>
                <button type="button" onClick={() => copiar("enlace")} className={btnSmall}>
                  {copiado === "enlace" ? <Check className="w-4 h-4 text-emerald-400" /> : <LinkIcon className="w-4 h-4" />}
                  {copiado === "enlace" ? "¡Copiado!" : "Copiar enlace"}
                </button>
              </div>

              <div className="mt-3 flex items-center justify-center gap-2 text-sm text-amber-300/90">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                {conectado ? "Esperando al otro jugador…" : "Reconectando con el servidor…"}
              </div>

              {esLocalhost && (
                <div className="mt-3 text-left text-[11px] sm:text-xs leading-relaxed rounded-lg border border-cyan-400/30 bg-cyan-950/30 text-cyan-100 px-3 py-2">
                  <div className="flex items-center gap-1.5 font-bold mb-0.5">
                    <Wifi className="w-3.5 h-3.5" /> ¿Otro dispositivo?
                  </div>
                  {lanUrl ? (
                    <>
                      El otro jugador (en la misma red WiFi) debe abrir{" "}
                      <span className="font-mono font-bold text-cyan-200 select-text">{lanUrl}</span> y escribir el
                      código. El enlace de arriba ya usa esa dirección.
                    </>
                  ) : (
                    <>
                      Abriste el juego con <span className="font-mono">localhost</span>, que solo funciona en esta
                      computadora. Abre la app con la IP de tu red (la que aparece en la terminal al iniciar) o
                      publícala en internet.
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ------------------------- Unirse ------------------------- */}
        <div className="w-full mt-4">
          <div className="flex items-center gap-3 text-slate-500 text-[11px] font-bold tracking-widest uppercase mb-2">
            <span className="flex-1 h-px bg-slate-600/60" />
            ¿Ya tienes un código?
            <span className="flex-1 h-px bg-slate-600/60" />
          </div>

          <div className="flex gap-2">
            <input
              value={codigoInput}
              onChange={(e) => {
                setCodigoInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH));
                setErrorUnirse(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") unirse();
              }}
              placeholder="ABCDE"
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              className="min-w-0 flex-1 text-center font-mono font-black text-2xl tracking-[0.3em] uppercase rounded-xl bg-black/50 border-2 border-slate-500/60 focus:border-amber-400 outline-none text-amber-100 placeholder:text-slate-600 py-2"
            />
            <button
              type="button"
              onClick={unirse}
              disabled={uniendo || codigoInput.length !== CODE_LENGTH}
              className="px-5 rounded-xl font-black text-base tracking-wider text-amber-100 uppercase bg-gradient-to-b from-[#065f46] via-[#047857] to-[#022c22] border-2 border-emerald-400/80 hover:border-emerald-300 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uniendo ? <Loader2 className="w-5 h-5 animate-spin" /> : "Unirme"}
            </button>
          </div>
          {errorUnirse && <p className="text-rose-300 text-sm mt-2">{errorUnirse}</p>}
        </div>

        {/* ------------------------- Otras opciones ------------------------- */}
        <div className="w-full mt-5 flex flex-col gap-2.5">
          <button type="button" onClick={jugarLocal} className={btnSecondary}>
            Jugar en este mismo dispositivo
          </button>
          <button type="button" onClick={volver} className={btnSecondary}>
            Volver
          </button>
        </div>
      </div>
    </div>
  );
};
