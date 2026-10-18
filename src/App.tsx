import React, { useState, useEffect, useRef } from "react";
import { 
  Card, 
  Dificultad, 
  ScreenState, 
  PlayerEntity, 
  GameLogEntry,
  ActivePlayedCardState,
  CardActionOutcome,
  OnlineAck,
  OnlineCloseReason,
  OnlineFx,
  OnlineChoicePayload,
  OnlineClashPayload,
  OnlineSnapshot,
  OnlineSyncPayload,
  OnlineTurnPayload
} from "./types";
import { MAZO_BASE, repartirTresCartas } from "./utils/gameData";
import { resolverEncuentro } from "./utils/encuentro";

// --- Modos de 1 JUGADOR (vs IA): la IA SOLO ATACA y el jugador SOLO DEFIENDE ---------
// (el modo 2 jugadores no usa nada de esto)
//
// Cada ronda: la IA anuncia N cartas de ataque y lanza UNA de ellas (escogida al azar). El
// jugador tiene 3 defensas y elige con cuál responder:
//   FÁCIL   -> 1 carta anunciada  (100 % de acierto si eliges bien). Gana quien llegue a 100 puntos.
//   NORMAL  -> 2 cartas anunciadas (50 / 50 de que la IA lance una u otra). Se juega a vidas.
//   DIFÍCIL -> 3 cartas anunciadas + tiempo límite + la IA ataca donde más débil estás. Vidas.
// Defensa correcta = el ataque se bloquea (y en NORMAL/DIFÍCIL la IA pierde 1 ♥).
// Defensa incorrecta (o se acaba el tiempo) = el ataque impacta (-1 ♥ y pilar comprometido).
interface ConfigModo {
  candidatas: number; // cuántas cartas de ataque muestra la IA antes de lanzar
  tiempoLimite: number | null; // segundos para elegir defensa (null = sin límite)
}
const CONFIG_MODO: Record<Dificultad, ConfigModo> = {
  FACIL: { candidatas: 1, tiempoLimite: null },
  NORMAL: { candidatas: 2, tiempoLimite: null },
  DIFICIL: { candidatas: 3, tiempoLimite: 15 }
};

// Mapa ataque -> control correcto: Phishing-2FA, Malware-Antivirus, DDoS-Firewall, Jolly Ataque-Jolly Defensa
const CONTRA_DE_ATAQUE: Record<string, string> = {
  phishing: "2FA",
  malware: "antivirus",
  ddos: "firewall",
  jolly_ataque: "jolly_defensa"
};
const ATAQUES_IDS = ["phishing", "malware", "ddos", "jolly_ataque"];
const DEFENSAS_IDS = ["2FA", "antivirus", "firewall", "jolly_defensa"];
type Pilar = "confidencialidad" | "integridad" | "disponibilidad";
const PILAR_DE_ATAQUE: Record<string, Pilar> = {
  phishing: "confidencialidad",
  malware: "integridad",
  ddos: "disponibilidad"
};

function clonarCarta(base: Card): Card {
  return { ...base, id: `${base.id}-${Date.now()}-${Math.random().toString(36).slice(2)}` };
}

function mezclar<T>(arr: T[]): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Cartas de ataque (distintas entre sí) que la IA muestra antes de lanzar.
// OJO: se guardan con su id original (sin sufijo) porque CONTRA_DE_ATAQUE busca por ese id exacto.
// Si el jugador ya tiene cartas en la mano (conserva las que no jugó), se priorizan ataques
// cuyo control correcto SÍ esté en su mano, para que siempre pueda defenderse bien.
function elegirAtaquesAnunciados(cantidad: number, mano: Card[] = []): Card[] {
  const defensasEnMano = mano.map((c) => c.id.split("-")[0]);
  const conContra = mezclar(ATAQUES_IDS.filter((a) => defensasEnMano.includes(CONTRA_DE_ATAQUE[a])));
  const sinContra = mezclar(ATAQUES_IDS.filter((a) => !defensasEnMano.includes(CONTRA_DE_ATAQUE[a])));
  const elegidos = [...conContra.slice(0, cantidad)];
  elegidos.push(...sinContra.slice(0, cantidad - elegidos.length));
  return mezclar(elegidos).map((id) => MAZO_BASE.find((c) => c.id === id) ?? MAZO_BASE[0]);
}

// Mano de 3 DEFENSAS del jugador: siempre incluye el control correcto de TODAS las cartas
// anunciadas (así elegir es una decisión real) y se completa con otras defensas distintas.
function construirManoDefensas(anunciados: Card[]): Card[] {
  const ids = anunciados.map((a) => CONTRA_DE_ATAQUE[a.id]);
  const otras = mezclar(DEFENSAS_IDS.filter((id) => !ids.includes(id)));
  while (ids.length < 3) ids.push(otras.shift() as string);
  return mezclar(ids).map((id) => clonarCarta(MAZO_BASE.find((c) => c.id === id) ?? MAZO_BASE[0]));
}

// Cuál de las cartas anunciadas lanza de verdad la IA.
// FÁCIL / NORMAL: al azar, todas con la misma probabilidad (en NORMAL = 50 / 50).
// DIFÍCIL: la IA "huele sangre": favorece el ataque a un pilar que ya tienes caído.
function elegirAtaqueReal(anunciados: Card[], nivel: Dificultad, jug: PlayerEntity): Card {
  if (nivel !== "DIFICIL") return anunciados[Math.floor(Math.random() * anunciados.length)];
  const caidos = [jug.confidencialidad, jug.integridad, jug.disponibilidad].filter((ok) => !ok).length;
  const pesos = anunciados.map((c) => {
    const pilar = PILAR_DE_ATAQUE[c.id];
    if (!pilar) return 1 + caidos; // el Jolly gana peso cuantos más pilares tengas caídos
    return jug[pilar] ? 1 : 3; // pilar ya comprometido: 3 veces más probable
  });
  let tirada = Math.random() * pesos.reduce((a, b) => a + b, 0);
  for (let i = 0; i < anunciados.length; i++) {
    tirada -= pesos[i];
    if (tirada < 0) return anunciados[i];
  }
  return anunciados[anunciados.length - 1];
}

// Aplica el impacto del ataque lanzado por la IA sobre el jugador (sin probabilidad):
// ocurre cuando el jugador responde con el control incorrecto o se le acaba el tiempo.
function aplicarAtaqueDirecto(
  atacante: Card,
  setObjetivo: React.Dispatch<React.SetStateAction<PlayerEntity>>
) {
  if (atacante.id === "jolly_ataque") {
    setObjetivo((prev) => ({
      ...prev,
      vida: Math.max(0, prev.vida - 1),
      confidencialidad: false,
      integridad: false,
      disponibilidad: false
    }));
    return;
  }
  const pilar = PILAR_DE_ATAQUE[atacante.id];
  setObjetivo((prev) => ({ ...prev, vida: Math.max(0, prev.vida - 1), [pilar]: false }));
}

// Carta pequeña (solo vista) para mostrar los ataques que la IA anuncia.
// Aparece boca abajo y se VOLTEA (flip 3D) para revelar el ataque; "retraso" escalona varias cartas.
const MiniCarta: React.FC<{ card: Card; retraso?: number }> = ({ card, retraso = 0 }) => {
  const [error, setError] = useState(false);
  const [volteada, setVolteada] = useState(false);
  const borde = card.tipo === "JOLLY" ? "border-amber-400" : "border-red-500";

  useEffect(() => {
    setVolteada(false);
    const t = setTimeout(() => {
      if (retraso === 0) playCardFlipSound();
      setVolteada(true);
    }, 400 + retraso);
    return () => clearTimeout(t);
  }, [card.id, retraso]);

  return (
    <div
      style={{
        // Cartas grandes para que se lea el texto: crecen con la pantalla (y nunca más de 30% del ancho)
        width: "min(clamp(104px, calc(var(--vh) * 20), 190px), calc(var(--vw) * 30))",
        aspectRatio: "195 / 275",
        perspective: "700px"
      }}
      title={volteada ? `${card.nombre}: ${card.objetivo}` : "Carta de la IA"}
    >
      <div
        className="relative w-full h-full"
        style={{
          transformStyle: "preserve-3d",
          transition: "transform 700ms",
          transform: volteada ? "rotateY(0deg)" : "rotateY(180deg)"
        }}
      >
        {/* Frente: el ataque */}
        <div
          className={`absolute inset-0 rounded-lg border-2 ${borde} bg-white overflow-hidden shadow-[0_0_18px_rgba(239,68,68,0.65)] flex items-center justify-center`}
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
        >
          {card.rutaImagen && !error ? (
            <img
              src={card.rutaImagen}
              alt={card.nombre}
              onError={() => setError(true)}
              className="w-full h-full object-contain select-none"
              draggable={false}
            />
          ) : (
            <span className="text-[10px] font-extrabold text-red-700 text-center px-1">{card.nombre}</span>
          )}
        </div>
        {/* Dorso */}
        <div
          className="absolute inset-0 rounded-lg border-2 border-amber-400/80 bg-[#12141c] overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,0.9)]"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
        >
          <img src="/img/dorso.png" alt="Dorso" className="w-full h-full object-cover" draggable={false} />
        </div>
      </div>
    </div>
  );
};
// ---------------------------------------------------------------------------

import { 
  playCardPlaySound, 
  playCardFlipSound,
  playAttackHitSound, 
  playAttackMissSound, 
  playDefenseSound, 
  playJollySound, 
  playVictorySound, 
  playDefeatSound, 
  playRoundResetSound, 
  playButtonClick,
  setSoundMuted
} from "./utils/sound";
import { CardComponent } from "./components/CardComponent";
import { TableCardsView } from "./components/TableCardsView";
import { CardFlipReveal } from "./components/CardFlipReveal";
import { VsCodePortModal } from "./components/VsCodePortModal";
import { RulesModal } from "./components/RulesModal";
import { OnlineLobby } from "./components/OnlineLobby";
import { ViewportContext, useViewportInfo } from "./utils/viewport";
import {
  socket,
  connectSocket,
  emitAck,
  getPlayerId,
  getSavedRoom,
  clearSavedRoom
} from "./utils/socket";
import { 
  Volume2, 
  VolumeX, 
  Server, 
  BookOpen, 
  RotateCcw,
  Maximize,
  Minimize,
  Heart,
  LogOut,
  RotateCw
} from "lucide-react";

export default function App() {
  // Screen management: INICIO, MODO, DIFICULTAD, JUEGO, FIN
  const [screen, setScreen] = useState<ScreenState>("INICIO");
  const [modoDosJugadores, setModoDosJugadores] = useState<boolean>(false);
  const [dificultad, setDificultad] = useState<Dificultad>("NORMAL");
  const screenRef = useRef<ScreenState>("INICIO");
  screenRef.current = screen;

  // "Girar pantalla" en celulares: primero se intenta bloquear la orientación horizontal del
  // navegador (Android/Chrome); si no se puede (p. ej. iPhone), se gira la interfaz con CSS.
  const [rotarForzado, setRotarForzado] = useState<boolean>(false);
  const [bloqueado, setBloqueado] = useState<boolean>(false);
  const vp = useViewportInfo(rotarForzado);
  const portrait = vp.portrait; // el juego se está viendo en vertical
  const compact = vp.w < 640 || vp.h < 520; // pantallas chicas: cabecera y textos compactos

  // Modo en línea (2 jugadores en dispositivos distintos)
  const [online, setOnline] = useState<boolean>(false);
  const [codigoSala, setCodigoSala] = useState<string>("");
  const [rivalConectado, setRivalConectado] = useState<boolean>(true);
  const [yaContinue, setYaContinue] = useState<boolean>(false);
  const [joinCodeUrl, setJoinCodeUrl] = useState<string | undefined>(undefined);
  const [resumeCode, setResumeCode] = useState<string | undefined>(undefined);
  const [lobbyKey, setLobbyKey] = useState<number>(0);
  const playLockRef = useRef<boolean>(false);
  const onlineTimersRef = useRef<NodeJS.Timeout[]>([]);
  const hasConnectedRef = useRef<boolean>(false);
  // En línea: los dos eligen carta en secreto y recién entonces se encuentran
  const [miEleccionId, setMiEleccionId] = useState<string | null>(null); // carta que ya elegí
  const [rivalEligio, setRivalEligio] = useState<boolean>(false); // el rival ya eligió (sin saber cuál)
  // 2 jugadores en un dispositivo: carta que eligió el JUGADOR 1 (oculta hasta que elija el JUGADOR 2)
  const [eleccionJ1, setEleccionJ1] = useState<Card | null>(null);
  // 2 jugadores en un dispositivo: pantalla de relevo ("Turno del JUGADOR X") que tapa las cartas
  // hasta que el siguiente jugador pulse "Siguiente". null = sin pantalla de relevo.
  const [relevoLocal, setRelevoLocal] = useState<1 | 2 | null>(null);
  // true = es la pantalla de bienvenida al empezar la partida (antes de la primera jugada)
  const [relevoInicio, setRelevoInicio] = useState<boolean>(false);

  // Players state
  const [jugador, setJugador] = useState<PlayerEntity>({
    nombre: "Empresa A",
    vida: 3,
    confidencialidad: true,
    integridad: true,
    disponibilidad: true
  });

  const [ia, setIa] = useState<PlayerEntity>({
    nombre: "Empresa B",
    vida: 3,
    confidencialidad: true,
    integridad: true,
    disponibilidad: true
  });

  // Copia siempre actualizada del jugador, para leerla desde temporizadores (p. ej. al preparar la siguiente ronda)
  const jugadorRef = useRef<PlayerEntity>(jugador);
  jugadorRef.current = jugador;

  // Turn management: true = Jugador 1, false = Jugador 2 or IA
  const [turnoJugador, setTurnoJugador] = useState<boolean>(true);

  // Modo FACIL (aprendizaje): en vez de vidas, se juega a puntos. Gana quien llegue primero a 100.
  // Cada jugada que "acierta" (ataque exitoso o defensa aplicada) suma 10 puntos a quien la jugó.
  const [puntajeJugador, setPuntajeJugador] = useState<number>(0);
  const [puntajeIA, setPuntajeIA] = useState<number>(0);
  // Carta que la IA jugará en su próximo turno, anunciada de antemano al jugador para que
  // pueda elegir con cuál de sus 3 cartas responder (solo en modo FACIL, un jugador vs IA).
  const [ataquesAnunciados, setAtaquesAnunciados] = useState<Card[]>([]);
  // Cuál de las anunciadas lanza de verdad la IA (se revela al responder el jugador)
  const [ataqueReal, setAtaqueReal] = useState<Card | null>(null);
  // Segundos que le quedan al jugador para elegir defensa (solo DIFÍCIL; null = sin límite)
  const [tiempoRestante, setTiempoRestante] = useState<number | null>(null);
  const rondaResueltaRef = useRef<boolean>(false);

  // Hands & Table counts
  const [manoJugador, setManoJugador] = useState<Card[]>([]);
  const [manoJugador2, setManoJugador2] = useState<Card[]>([]);
  const [cartasMesaJugador, setCartasMesaJugador] = useState<number>(3);
  const [cartasMesaIA, setCartasMesaIA] = useState<number>(3);

  // Animating card in player's hand (animarCartaJugando in Java)
  const [animatingCardId, setAnimatingCardId] = useState<string | null>(null);

  // Active Played Card on table for 3D flip animation (face down -> flip -> face up)
  const [activePlayedCard, setActivePlayedCard] = useState<ActivePlayedCardState | null>(null);
  const pendingTurnAdvanceRef = useRef<(() => void) | null>(null);
  const turnAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Temporizadores de las partidas locales (1 jugador y 2 jugadores en un dispositivo)
  const timersLocalRef = useRef<NodeJS.Timeout[]>([]);
  const programarLocal = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timersLocalRef.current.push(t);
    return t;
  };
  const limpiarTimersLocal = () => {
    timersLocalRef.current.forEach((t) => clearTimeout(t));
    timersLocalRef.current = [];
    if (turnAdvanceTimerRef.current) {
      clearTimeout(turnAdvanceTimerRef.current);
      turnAdvanceTimerRef.current = null;
    }
    pendingTurnAdvanceRef.current = null;
  };

  // Manual or automatic turn advance helper
  const handleContinuarTurno = () => {
    if (online) {
      // En línea el servidor pasa el turno cuando ambos pulsan "Continuar" (o a los 11 s)
      if (!yaContinue) {
        setYaContinue(true);
        socket.emit("game:continue");
      }
      return;
    }
    if (turnAdvanceTimerRef.current) {
      clearTimeout(turnAdvanceTimerRef.current);
      turnAdvanceTimerRef.current = null;
    }
    if (pendingTurnAdvanceRef.current) {
      const advanceFn = pendingTurnAdvanceRef.current;
      pendingTurnAdvanceRef.current = null;
      advanceFn();
    }
  };

  // Central Notification Message (mensajeCentral in Java)
  const [mensajeCentral, setMensajeCentral] = useState<string | null>(null);
  const mensajeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // End Game Result
  const [mensajeFinJuego, setMensajeFinJuego] = useState<string>("");

  // Modals & UI helpers
  const [showVsCodeModal, setShowVsCodeModal] = useState<boolean>(false);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Toggle Sound
  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    setSoundMuted(next);
  };

  // Toggle Fullscreen (maximize window like desktop)
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const girarPantalla = async () => {
    playButtonClick();
    // Ya está girada con CSS -> volver a vertical
    if (rotarForzado) {
      setRotarForzado(false);
      return;
    }
    // Bloqueada en horizontal -> liberar
    if (bloqueado) {
      try {
        window.screen.orientation.unlock();
      } catch {
        /* ignorar */
      }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setBloqueado(false);
      return;
    }
    // 1) Intento nativo: pantalla completa + bloqueo horizontal (Android/Chrome)
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      await (window.screen.orientation as any).lock("landscape");
      // Algunos navegadores aceptan el bloqueo pero no giran la pantalla: se comprueba
      await new Promise((r) => setTimeout(r, 700));
      if (window.innerWidth >= window.innerHeight) {
        setBloqueado(true);
        return;
      }
      try {
        window.screen.orientation.unlock();
      } catch {
        /* ignorar */
      }
    } catch {
      /* 2) el navegador no lo permite: se gira la interfaz con CSS */
    }
    setRotarForzado(true);
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (!document.fullscreenElement) setBloqueado(false); // al salir de pantalla completa se libera el bloqueo
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Helper for Central Message (identical to JLabel mensajeCentral in Java)
  const showCentralMessage = (texto: string) => {
    if (mensajeTimerRef.current) {
      clearTimeout(mensajeTimerRef.current);
    }
    setMensajeCentral(texto);
    mensajeTimerRef.current = setTimeout(() => {
      setMensajeCentral(null);
    }, 10000); // 10 segundos para leer cómodamente el resultado
  };

  // Hearts formatter: Corazones rojos y lindos con animación, brillo y drop-shadow
  const renderCorazones = (vida: number, maxVida: number = 3) => {
    return (
      <div className={`flex items-center ${compact ? "gap-1 mt-1" : "gap-2 mt-2"} select-none`}>
        {Array.from({ length: maxVida }).map((_, idx) => {
          const isActive = idx < vida;
          return (
            <div
              key={idx}
              className="relative flex items-center justify-center transition-all duration-300 transform hover:scale-125"
            >
              {isActive ? (
                <div className="relative group">
                  {/* Glowing Red Heart */}
                  <Heart
                    className={`${compact ? "w-5 h-5" : "w-8 h-8 sm:w-9 sm:h-9"} text-rose-500 fill-red-600 drop-shadow-[0_0_10px_rgba(239,68,68,0.95)]`}
                  />
                  {/* Cute Gloss Highlight Reflection */}
                  <span className={`absolute ${compact ? "top-0.5 left-1 w-1 h-1" : "top-1 left-2 w-2 h-2"} rounded-full bg-white/80 pointer-events-none blur-[0.2px]`} />
                </div>
              ) : (
                <Heart
                  className={`${compact ? "w-5 h-5" : "w-8 h-8 sm:w-9 sm:h-9"} text-neutral-600/50 fill-black/40 stroke-neutral-700/60`}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Plain text fallback if needed
  const corazones = (vida: number): string => {
    let result = "";
    for (let i = 0; i < vida; i++) {
      result += "♥ ";
    }
    return result.trim();
  };

  // ======================================================================
  // MODO EN LÍNEA: el servidor (server/rooms.ts) reparte, tira los dados y
  // aplica los efectos. Aquí solo se muestra lo que llega y se pide jugar.
  // ======================================================================
  const limpiarTimersOnline = () => {
    onlineTimersRef.current.forEach((t) => clearTimeout(t));
    onlineTimersRef.current = [];
  };

  const reproducirFx = (fx: OnlineFx[]) => {
    fx.forEach((f) => {
      if (f === "hit") playAttackHitSound();
      else if (f === "miss") playAttackMissSound();
      else if (f === "defensa") playDefenseSound();
      else if (f === "jolly") playJollySound();
    });
  };

  const salirDeSala = () => {
    limpiarTimersOnline();
    if (socket.connected) socket.emit("room:leave");
    clearSavedRoom();
    playLockRef.current = false;
    setOnline(false);
    setActivePlayedCard(null);
    setAnimatingCardId(null);
    setMensajeCentral(null);
    setYaContinue(false);
    setResumeCode(undefined);
    setJoinCodeUrl(undefined);
  };

  // Salir de una partida local (1 jugador o 2 jugadores en un dispositivo) y volver al inicio
  const salirPartidaLocal = () => {
    limpiarTimersLocal();
    rondaResueltaRef.current = false;
    setActivePlayedCard(null);
    setAnimatingCardId(null);
    setMensajeCentral(null);
    setAtaquesAnunciados([]);
    setAtaqueReal(null);
    setTiempoRestante(null);
    setEleccionJ1(null);
    setRelevoLocal(null);
    setRelevoInicio(false);
    setScreen("INICIO");
  };

  const volverAlInicio = () => {
    playButtonClick();
    if (online) salirDeSala();
    setScreen("INICIO");
  };

  // Pone en pantalla el estado completo que manda el servidor
  const aplicarSnapshot = (s: OnlineSnapshot) => {
    limpiarTimersOnline();
    playLockRef.current = false;
    setOnline(true);
    setModoDosJugadores(false);
    setCodigoSala(s.code);
    setJugador(s.me);
    setIa(s.rival);
    setCartasMesaJugador(s.meMesa);
    setCartasMesaIA(s.rivalMesa);
    setManoJugador(s.hand);
    setTurnoJugador(s.myTurn);
    setMiEleccionId(s.myChoiceId);
    setRivalEligio(s.rivalChose);
    setRivalConectado(s.rivalConnected);
    setYaContinue(s.waitingContinue);
    setAnimatingCardId(null);
    if (s.pending) {
      // Encuentro ya resuelto: se ven las dos cartas y el resultado de cada una
      setActivePlayedCard({
        card: s.pending.mine,
        playedBy: "TÚ",
        isFlipped: true,
        resultado: s.pending.outcomeMine,
        segunda: { card: s.pending.rival, playedBy: "RIVAL", resultado: s.pending.outcomeRival }
      });
    } else {
      setActivePlayedCard(null);
    }
    if (s.phase === "over") {
      setMensajeFinJuego(
        s.result === "win"
          ? `¡GANASTE! Has derrotado a la ${s.rival.nombre}`
          : s.result === "draw"
          ? "¡EMPATE! Las dos empresas cayeron al mismo tiempo"
          : `¡PERDISTE! La ${s.me.nombre} ha caído`
      );
      setScreen("FIN");
    }
  };

  useEffect(() => {
    // Entrada por enlace de invitación: https://.../?sala=ABCDE
    const params = new URLSearchParams(window.location.search);
    const codigoEnlace = params.get("sala");
    if (codigoEnlace) {
      setJoinCodeUrl(codigoEnlace.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5));
      setScreen("LOBBY");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (getSavedRoom()) {
      // Se recargó la página en medio de una sala: nos reconectamos
      connectSocket();
    }

    const onConnect = async () => {
      const primera = !hasConnectedRef.current;
      hasConnectedRef.current = true;
      const code = getSavedRoom();
      if (!code) return;
      const pantalla = screenRef.current;
      const debeRetomar = primera ? pantalla === "INICIO" : pantalla === "LOBBY" || pantalla === "JUEGO";
      if (!debeRetomar) return;
      try {
        const res = await emitAck<OnlineAck>("room:rejoin", { playerId: getPlayerId(), code });
        if (res.ok) {
          if (res.phase === "waiting" && screenRef.current === "INICIO") {
            setResumeCode(res.code);
            setScreen("LOBBY");
          }
          // Si la partida ya empezó, el servidor manda game:sync
        } else {
          clearSavedRoom();
          if (screenRef.current === "JUEGO") {
            setMensajeFinJuego("La sala ya no existe.");
            setScreen("FIN");
          } else if (screenRef.current === "LOBBY") {
            setResumeCode(undefined);
            setJoinCodeUrl(undefined);
            setLobbyKey((k) => k + 1); // el lobby crea una sala nueva
          }
        }
      } catch {
        /* sin respuesta: se intentará en la próxima reconexión */
      }
    };

    // Partida iniciada o retomada
    const onSync = ({ snapshot, resumed }: OnlineSyncPayload) => {
      aplicarSnapshot(snapshot);
      if (snapshot.phase === "over") return;
      setScreen("JUEGO");
      if (!resumed) {
        playRoundResetSound();
        showCentralMessage("🃏 ¡Rival conectado! Los dos eligen una carta en secreto");
      }
    };

    // Uno de los dos eligió carta; las cartas siguen ocultas hasta que elijan los dos
    const onChoice = (p: OnlineChoicePayload) => {
      playLockRef.current = false;
      setAnimatingCardId(null);
      setMiEleccionId(p.myChoiceId);
      setRivalEligio(p.rivalChose);
      setTurnoJugador(p.myChoiceId === null);
    };

    // Los dos eligieron: las dos cartas se ponen boca abajo, se voltean y se ve qué pasó con cada una
    const onClash = (p: OnlineClashPayload) => {
      limpiarTimersOnline();
      playLockRef.current = false;
      setAnimatingCardId(null);
      setYaContinue(false);
      setMiEleccionId(null);
      setRivalEligio(false);
      setTurnoJugador(false);
      setManoJugador(p.state.hand);
      setCartasMesaJugador(p.state.meMesa);
      setCartasMesaIA(p.state.rivalMesa);
      playCardPlaySound();
      setActivePlayedCard({
        card: p.mine,
        playedBy: "TÚ",
        isFlipped: false,
        segunda: { card: p.rival, playedBy: "RIVAL" }
      });
      const t1 = setTimeout(() => {
        playCardFlipSound();
        setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true } : null));
        const t2 = setTimeout(() => {
          setJugador(p.state.me);
          setIa(p.state.rival);
          reproducirFx(p.outcomeMine.fx);
          reproducirFx(p.outcomeRival.fx);
          showCentralMessage(p.outcomeMine.mensaje);
          setActivePlayedCard((prev) =>
            prev
              ? {
                  ...prev,
                  isFlipped: true,
                  resultado: p.outcomeMine,
                  segunda: prev.segunda ? { ...prev.segunda, resultado: p.outcomeRival } : undefined
                }
              : null
          );
        }, 550);
        onlineTimersRef.current.push(t2);
      }, 350);
      onlineTimersRef.current.push(t1);
    };

    // Cambio de turno (y nueva ronda si ya se jugaron las 6 cartas)
    const onTurn = ({ snapshot, newRound }: OnlineTurnPayload) => {
      aplicarSnapshot(snapshot);
      if (newRound) {
        playRoundResetSound();
        showCentralMessage("🃏✨ ¡Nueva ronda! Las 6 cartas han vuelto.");
      }
    };

    const onOver = ({ result, snapshot }: { result: "win" | "lose" | "draw"; snapshot: OnlineSnapshot }) => {
      aplicarSnapshot(snapshot);
      if (result === "win") playVictorySound();
      else if (result === "lose") playDefeatSound();
      else playRoundResetSound();
    };

    const onRival = ({ connected }: { connected: boolean }) => setRivalConectado(connected);

    const onClosed = ({ reason }: { reason: OnlineCloseReason }) => {
      limpiarTimersOnline();
      clearSavedRoom();
      playLockRef.current = false;
      setActivePlayedCard(null);
      setAnimatingCardId(null);
      if (reason === "takeover") {
        if (screenRef.current === "JUEGO") {
          setMensajeFinJuego("Esta partida se abrió en otra pestaña.");
          setScreen("FIN");
        } else if (screenRef.current === "LOBBY") {
          setScreen("INICIO");
        }
      } else if (screenRef.current === "JUEGO") {
        setMensajeFinJuego("Tu rival abandonó la partida.");
        setScreen("FIN");
      }
    };

    const onError = ({ message }: { message: string }) => {
      playLockRef.current = false;
      setAnimatingCardId(null);
      showCentralMessage(`⚠️ ${message}`);
    };

    socket.on("connect", onConnect);
    socket.on("game:sync", onSync);
    socket.on("game:choice", onChoice);
    socket.on("game:clash", onClash);
    socket.on("game:turn", onTurn);
    socket.on("game:over", onOver);
    socket.on("room:rival", onRival);
    socket.on("room:closed", onClosed);
    socket.on("game:error", onError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("game:sync", onSync);
      socket.off("game:choice", onChoice);
      socket.off("game:clash", onClash);
      socket.off("game:turn", onTurn);
      socket.off("game:over", onOver);
      socket.off("room:rival", onRival);
      socket.off("room:closed", onClosed);
      socket.off("game:error", onError);
      limpiarTimersOnline();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1 JUGADOR: prepara una ronda nueva. La IA anuncia sus cartas de ataque, decide en secreto
  // cuál lanzará y el jugador recibe 3 defensas (con el control correcto de cada ataque anunciado).
  // manoConservada: defensas que el jugador aún tiene sin jugar. Si está vacía (inicio de partida o
  // nueva ronda de mesa) se reparten 3 defensas nuevas; si no, se sigue con las que quedan (2, luego 1).
  const prepararRonda = (nivel: Dificultad, jug: PlayerEntity, manoConservada: Card[] = []) => {
    const anunciados = elegirAtaquesAnunciados(CONFIG_MODO[nivel].candidatas, manoConservada);
    setAtaquesAnunciados(anunciados);
    setAtaqueReal(elegirAtaqueReal(anunciados, nivel, jug));
    setManoJugador(manoConservada.length > 0 ? manoConservada : construirManoDefensas(anunciados));
    setTiempoRestante(CONFIG_MODO[nivel].tiempoLimite);
    rondaResueltaRef.current = false;
  };

  // Start game flow: iniciarJuego(boolean dosJugadores, Dificultad dif)
  const iniciarJuego = (dosJugadores: boolean, nivel: Dificultad) => {
    playButtonClick();
    setOnline(false); // los modos locales nunca son en línea
    setModoDosJugadores(dosJugadores);
    setDificultad(nivel);

    setJugador({
      nombre: "Empresa A",
      vida: 3,
      confidencialidad: true,
      integridad: true,
      disponibilidad: true
    });

    setIa({
      nombre: "Empresa B",
      vida: 3,
      confidencialidad: true,
      integridad: true,
      disponibilidad: true
    });

    setCartasMesaJugador(3);
    setCartasMesaIA(3);
    setPuntajeJugador(0);
    setPuntajeIA(0);
    limpiarTimersLocal(); // por si quedó algo pendiente de una partida anterior
    setAtaquesAnunciados([]);
    setAtaqueReal(null);
    setTiempoRestante(null);
    setEleccionJ1(null);
    setRelevoLocal(dosJugadores ? 1 : null); // en 2 jugadores se tapan las cartas hasta pulsar "Comenzar"
    setRelevoInicio(dosJugadores);
    setMiEleccionId(null);
    setRivalEligio(false);

    if (dosJugadores) {
      // 2 JUGADORES: cada uno con 3 cartas al azar del mazo completo (sin cambios)
      setManoJugador(repartirTresCartas());
      setManoJugador2(repartirTresCartas());
    } else {
      // 1 JUGADOR: la IA anuncia sus ataques y el jugador recibe solo defensas
      setManoJugador2([]);
      prepararRonda(nivel, {
        nombre: "Empresa A",
        vida: 3,
        confidencialidad: true,
        integridad: true,
        disponibilidad: true
      });
    }

    setTurnoJugador(true);
    setMensajeCentral(null);
    setAnimatingCardId(null);
    setActivePlayedCard(null);
    setScreen("JUEGO");
  };

  // Check new round: checkNuevaRonda()
  const checkNuevaRonda = (mesaJugador: number, mesaIA: number) => {
    if (mesaJugador <= 0 && mesaIA <= 0) {
      programarLocal(() => {
        setCartasMesaJugador(3);
        setCartasMesaIA(3);
        playRoundResetSound();
        showCentralMessage("🃏✨ ¡Nueva ronda! Las 6 cartas han vuelto.");
      }, 2000);
    }
  };

  // ======================================================================
  // 1 JUGADOR (FÁCIL / NORMAL / DIFÍCIL): la IA solo ataca, el jugador solo defiende.
  // Resuelve la ronda: la IA revela el ataque que lanza de verdad y se compara con la
  // defensa elegida (carta = null significa que se acabó el tiempo en DIFÍCIL).
  // ======================================================================
  const resolverRonda = (carta: Card | null) => {
    const real = ataqueReal;
    if (!real || rondaResueltaRef.current) return;
    rondaResueltaRef.current = true;
    setTiempoRestante(null);

    const nivel = dificultad;
    const facil = nivel === "FACIL";
    const anunciados = ataquesAnunciados;
    const contraId = CONTRA_DE_ATAQUE[real.id];
    const cartaContra = MAZO_BASE.find((c) => c.id === contraId);
    const acierto = !!carta && carta.id.split("-")[0] === contraId;
    const nuevaMesaJugador = Math.max(0, cartasMesaJugador - 1);
    const nuevaMesaIA = Math.max(0, cartasMesaIA - 1);

    // 1. La defensa jugada sale de la mano y ambos gastan una carta de la mesa.
    // Sin tiempo (carta = null) se descarta una carta al azar para que la mano siga igual que la mesa.
    const descartada = carta ?? manoJugador[Math.floor(Math.random() * manoJugador.length)] ?? null;
    const manoRestante = manoJugador.filter((c) => c.id !== descartada?.id);
    setManoJugador(manoRestante);
    if (!carta) playCardPlaySound();
    setCartasMesaJugador(nuevaMesaJugador);
    setCartasMesaIA(nuevaMesaIA);

    // 2. Las dos cartas se ponen boca abajo en la mesa: tu defensa (izquierda) y el ataque de la IA (derecha)
    const propia = carta ?? descartada ?? real;
    setActivePlayedCard({
      card: propia,
      playedBy: carta ? "TÚ" : "TÚ (sin tiempo)",
      isFlipped: false,
      segunda: { card: real, playedBy: "IA" }
    });

    // 3. A los 450ms se voltean las dos y se revela qué ataque lanzó de verdad la IA
    programarLocal(() => {
      playCardFlipSound();
      setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true } : null));

      // 4. Tras voltearse (550ms) se aplica el resultado
      programarLocal(() => {
        const mostradas =
          anunciados.length > 1
            ? ` La IA tenía en la mira: ${anunciados.map((c) => c.nombre).join(" / ")}.`
            : "";
        let outcome: CardActionOutcome;

        if (acierto && carta) {
          // Defensa correcta: el ataque se bloquea y el pilar queda protegido
          if (real.id === "jolly_ataque") {
            playJollySound();
            setJugador((prev) => ({ ...prev, confidencialidad: true, integridad: true, disponibilidad: true }));
          } else {
            playDefenseSound();
            const pilar = PILAR_DE_ATAQUE[real.id];
            setJugador((prev) => ({ ...prev, [pilar]: true }));
          }
          if (facil) {
            setPuntajeJugador((prev) => Math.min(100, prev + 10));
          } else {
            setIa((prev) => ({ ...prev, vida: Math.max(0, prev.vida - 1) }));
          }
          outcome = {
            titulo: `🛡 ¡${carta.nombre} bloqueó el ${real.nombre}!`,
            detalle: `La IA lanzó ${real.nombre} (${real.objetivo}) y ${carta.nombre} era el control correcto.${mostradas} ${
              facil ? "Sumas 10 puntos." : `El ataque se neutraliza y la ${ia.nombre} pierde 1 vida por el contraataque.`
            }`,
            exito: true,
            tipo: "DEFENSA",
            impacto: facil ? "+10 puntos" : "IA -1 ♥ Vida"
          };
        } else {
          // Defensa incorrecta (o sin tiempo): el ataque impacta
          if (real.id === "jolly_ataque") playJollySound();
          playAttackHitSound();
          aplicarAtaqueDirecto(real, setJugador);
          if (facil) setPuntajeIA((prev) => Math.min(100, prev + 10));
          const pilarAfectado = real.id === "jolly_ataque" ? "toda la tríada CIA" : `la ${real.objetivo.replace("Ataca ", "")}`;
          outcome = {
            titulo: carta ? `❌ ¡${real.nombre} impactó!` : `⏱ ¡Sin tiempo! ${real.nombre} impactó`,
            detalle: `${
              carta ? `Jugaste ${carta.nombre}, pero el control correcto era ${cartaContra?.nombre ?? "otro"}.` : `No elegiste defensa a tiempo; el control correcto era ${cartaContra?.nombre ?? "otro"}.`
            }${mostradas} Se comprometió ${pilarAfectado}.${facil ? " La IA suma 10 puntos." : " Pierdes 1 vida."}${
              !carta && descartada ? ` Se descarta ${descartada.nombre} de tu mano.` : ""
            }`,
            exito: false,
            tipo: real.tipo,
            impacto: facil ? "IA +10 puntos" : "-1 ♥ Vida"
          };
        }

        setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true, resultado: outcome } : null));

        // 5. Resultado visible 10 s (o hasta pulsar Continuar); después arranca la siguiente ronda
        const advance = () => {
          setActivePlayedCard(null);
          // Con la mesa agotada empieza una ronda nueva (3 cartas); si no, se conservan las que quedan
          const mesaAgotada = nuevaMesaJugador <= 0 && nuevaMesaIA <= 0;
          prepararRonda(nivel, jugadorRef.current, mesaAgotada ? [] : manoRestante);
          checkNuevaRonda(nuevaMesaJugador, nuevaMesaIA);
        };
        pendingTurnAdvanceRef.current = advance;
        turnAdvanceTimerRef.current = setTimeout(() => {
          if (pendingTurnAdvanceRef.current === advance) {
            advance();
            pendingTurnAdvanceRef.current = null;
          }
        }, 10000);
      }, 550);
    }, 450);
  };

  // ======================================================================
  // 2 JUGADORES en un dispositivo: los dos eligen carta en secreto y SOLO cuando ambos
  // han elegido se descubren las dos cartas, se encuentran y se sabe si el ataque funcionó.
  // (La resolución es la misma que usa el servidor en línea: utils/encuentro.ts)
  // ======================================================================
  const resolverEncuentroLocal = (cartaJ1: Card, cartaJ2: Card) => {
    const nuevaMesaJ1 = Math.max(0, cartasMesaJugador - 1);
    const nuevaMesaJ2 = Math.max(0, cartasMesaIA - 1);

    // Las dos cartas salen de las manos y ambos gastan una carta de la mesa
    setManoJugador((prev) => prev.filter((c) => c.id !== cartaJ1.id));
    setManoJugador2((prev) => prev.filter((c) => c.id !== cartaJ2.id));
    setEleccionJ1(null);
    setCartasMesaJugador(nuevaMesaJ1);
    setCartasMesaIA(nuevaMesaJ2);

    const res = resolverEncuentro(cartaJ1, cartaJ2, jugador, ia);

    // PASO 1: las dos cartas aparecen boca abajo en la mesa
    setActivePlayedCard({
      card: cartaJ1,
      playedBy: "JUGADOR 1",
      isFlipped: false,
      segunda: { card: cartaJ2, playedBy: "JUGADOR 2" }
    });

    // PASO 2: a los 350ms se voltean las dos
    programarLocal(() => {
      playCardFlipSound();
      setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true } : null));

      // PASO 3: tras voltearse (550ms) se aplican los efectos y se muestra qué pasó con cada carta
      programarLocal(() => {
        setJugador(res.a);
        setIa(res.b);
        reproducirFx(res.outcomeA.fx);
        reproducirFx(res.outcomeB.fx);
        setActivePlayedCard((prev) =>
          prev
            ? {
                ...prev,
                isFlipped: true,
                resultado: res.outcomeA,
                segunda: prev.segunda ? { ...prev.segunda, resultado: res.outcomeB } : undefined
              }
            : null
        );

        // PASO 4: resultado visible 10 s (o hasta pulsar Continuar); luego empieza la siguiente jugada
        const advance = () => {
          setActivePlayedCard(null);
          setManoJugador((prev) => (prev.length === 0 ? repartirTresCartas() : prev));
          setManoJugador2((prev) => (prev.length === 0 ? repartirTresCartas() : prev));
          checkNuevaRonda(nuevaMesaJ1, nuevaMesaJ2);
          setTurnoJugador(true); // vuelve a elegir primero el JUGADOR 1
          setRelevoLocal(1); // pantalla de relevo: nadie ve las cartas del JUGADOR 1 hasta pulsar "Siguiente"
        };
        pendingTurnAdvanceRef.current = advance;
        turnAdvanceTimerRef.current = setTimeout(() => {
          if (pendingTurnAdvanceRef.current === advance) {
            advance();
            pendingTurnAdvanceRef.current = null;
          }
        }, 10000);
      }, 550);
    }, 350);
  };

  // Handle Player Action: jugarCarta(Carta carta) with 3D Flip Animation (Reverso -> Volteo -> Frente)
  const handleJugarCarta = (carta: Card) => {
    if (online) {
      // En línea solo se PIDE jugar la carta; el servidor espera a que elijan los dos y responde con game:clash
      if (!turnoJugador || miEleccionId || animatingCardId || activePlayedCard || playLockRef.current) return;
      if (!socket.connected) {
        showCentralMessage("⚠️ Sin conexión con el servidor. Reintentando…");
        return;
      }
      playCardPlaySound();
      playLockRef.current = true;
      setAnimatingCardId(carta.id);
      const t = setTimeout(() => {
        setAnimatingCardId(null);
        socket.emit("game:play", { cardId: carta.id });
      }, 200);
      onlineTimersRef.current.push(t);
      return;
    }
    if (animatingCardId || activePlayedCard || relevoLocal !== null) return; // Prevent double trigger

    // 1 JUGADOR: el jugador solo defiende; la IA ya tiene su ataque decidido
    if (!modoDosJugadores) {
      if (carta.tipo === "ATAQUE" || rondaResueltaRef.current || !ataqueReal) return;
      playCardPlaySound();
      setTiempoRestante(null); // se detiene el reloj en cuanto eliges
      setAnimatingCardId(carta.id);
      programarLocal(() => {
        setAnimatingCardId(null);
        resolverRonda(carta);
      }, 200);
      return;
    }

    // ---- 2 JUGADORES (mismo dispositivo): cada uno elige en secreto, luego se encuentran las cartas ----
    playCardPlaySound();
    setAnimatingCardId(carta.id);
    programarLocal(() => {
      setAnimatingCardId(null);
      if (turnoJugador) {
        // JUGADOR 1 elige: su carta queda boca abajo y le toca elegir al JUGADOR 2 (sin mirar)
        setEleccionJ1(carta);
        setTurnoJugador(false);
        setRelevoLocal(2); // pantalla de relevo: oculta las cartas hasta que el JUGADOR 2 pulse "Siguiente"
        return;
      }
      // JUGADOR 2 elige: ya están las dos cartas, se encuentran
      if (eleccionJ1) resolverEncuentroLocal(eleccionJ1, carta);
    }, 200);
  };

  // DIFÍCIL: cuenta atrás para elegir defensa. Si llega a 0, el ataque impacta.
  // Se pausa mientras hay un modal abierto o la ronda se está resolviendo.
  useEffect(() => {
    if (screen !== "JUEGO" || online || modoDosJugadores) return;
    if (tiempoRestante === null || activePlayedCard || animatingCardId) return;
    if (showRulesModal || showVsCodeModal) return;
    if (tiempoRestante <= 0) {
      resolverRonda(null);
      return;
    }
    const t = setTimeout(() => setTiempoRestante((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, online, modoDosJugadores, tiempoRestante, activePlayedCard, animatingCardId, showRulesModal, showVsCodeModal]);

  // Check Game Over: comprobarFinJuego()
  useEffect(() => {
    if (screen !== "JUEGO" || online) return; // en línea el final lo manda el servidor (game:over)
    // Se espera a que se vea el resultado del último encuentro antes de terminar la partida
    if (activePlayedCard) return;

    if (dificultad === "FACIL" && !modoDosJugadores) {
      if (puntajeJugador >= 100) {
        setMensajeFinJuego(`¡GANASTE! Llegaste a 100 puntos antes que la ${ia.nombre} (FACIL)`);
        playVictorySound();
        setScreen("FIN");
      } else if (puntajeIA >= 100) {
        setMensajeFinJuego(`¡PERDISTE! La ${ia.nombre} llegó a 100 puntos primero (FACIL)`);
        playDefeatSound();
        setScreen("FIN");
      }
      return;
    }

    if (jugador.vida <= 0 && ia.vida <= 0) {
      // Las dos cartas se golpearon a la vez y las dos empresas cayeron (solo 2 jugadores)
      setMensajeFinJuego("¡EMPATE! Las dos empresas cayeron al mismo tiempo");
      playRoundResetSound();
      setScreen("FIN");
    } else if (jugador.vida <= 0) {
      if (modoDosJugadores) {
        setMensajeFinJuego(`¡JUGADOR 2 GANA! (${jugador.nombre} ha caído)`);
      } else {
        setMensajeFinJuego(`¡PERDISTE! La ${jugador.nombre} ha caído (${dificultad})`);
      }
      playDefeatSound();
      setScreen("FIN");
    } else if (ia.vida <= 0) {
      if (modoDosJugadores) {
        setMensajeFinJuego(`¡JUGADOR 1 GANA! (${ia.nombre} ha caído)`);
      } else {
        setMensajeFinJuego(`¡GANASTE! Has derrotado a la ${ia.nombre} (${dificultad})`);
      }
      playVictorySound();
      setScreen("FIN");
    }
  }, [jugador.vida, ia.vida, screen, modoDosJugadores, dificultad, jugador.nombre, ia.nombre, puntajeJugador, puntajeIA, activePlayedCard]);

  // Current active hand to display
  const manoActual = modoDosJugadores
    ? turnoJugador
      ? manoJugador
      : manoJugador2
    : online
    ? manoJugador.filter((c) => c.id !== miEleccionId) // en línea, la carta ya elegida queda boca abajo en la mesa
    : manoJugador;

  return (
    <ViewportContext.Provider value={vp}>
    <div
      className="overflow-hidden bg-[#0a0a0f] flex flex-col items-center justify-center select-none font-['Arial'] text-white relative"
      style={
        {
          // --vw / --vh = 1% del ancho / alto REAL del juego (ya girado si aplica)
          "--vw": `${vp.w / 100}px`,
          "--vh": `${vp.h / 100}px`,
          ...(vp.rotated
            ? {
                position: "fixed",
                top: 0,
                left: 0,
                width: vp.w,
                height: vp.h,
                transformOrigin: "top left",
                transform: "rotate(90deg) translateY(-100%)"
              }
            : { width: "100vw", height: "100dvh" })
        } as unknown as React.CSSProperties
      }
    >
      {/* Floating Toolbar: Non-intrusive at bottom-right corner, leaving headers 100% visible and unblocked */}
      <div
        className={`fixed bottom-3 right-4 z-50 flex items-center gap-2 bg-[#0e1017]/90 hover:bg-[#0e1017] backdrop-blur-md px-3 py-1.5 rounded-full border border-amber-400/40 shadow-[0_6px_24px_rgba(0,0,0,0.85)] text-xs transition-all ${
          // En pantallas bajas la barra tapaba el botón "Continuar" de la carta jugada
          activePlayedCard && (vp.h <= 520 || (portrait && vp.h <= 720)) ? "hidden" : ""
        }`}
      >
        {/* Title Badge */}
        <span className={`font-bold text-amber-400 ${compact ? "hidden" : "inline-flex"} items-center gap-1.5 pr-2.5 border-r border-amber-400/20 text-[11px] tracking-wide`}>
          <span>🃏</span> Security Jollys
        </span>

        {/* Port 3000 Status Indicator */}
        <button
          onClick={() => setShowVsCodeModal(true)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-b from-[#1c1f2b] to-[#12141d] hover:from-[#252a3a] hover:to-[#181b26] border border-amber-400/40 hover:border-amber-300 text-amber-300 font-mono text-[11px] cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.5)] hover:shadow-[0_0_12px_rgba(251,191,36,0.35)] active:scale-95 transition-all"
          title="Ver conexión al puerto 3000 y comandos de Visual Studio Code"
        >
          <Server className="w-3.5 h-3.5 text-emerald-400" />
          <span className="whitespace-nowrap">{compact ? ":3000" : "Puerto: 3000"}</span>
        </button>

        {/* Rules button */}
        <button
          onClick={() => setShowRulesModal(true)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-b from-[#1c1f2b] to-[#12141d] hover:from-[#252a3a] hover:to-[#181b26] border border-amber-400/40 hover:border-amber-300 text-amber-200 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.5)] hover:shadow-[0_0_12px_rgba(251,191,36,0.35)] active:scale-95 transition-all"
          title="Reglas del juego y cartas"
        >
          <BookOpen className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden md:inline">Reglas</span>
        </button>

        {/* Girar pantalla (solo celulares): pone el juego en horizontal */}
        {vp.isPhone && (vp.realPortrait || rotarForzado || bloqueado) && (
          <button
            onClick={girarPantalla}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-b from-[#3a2a06] to-[#1c1503] border text-amber-200 font-bold cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.5)] active:scale-95 transition-all ${
              rotarForzado || bloqueado
                ? "border-amber-400/50 hover:border-amber-300"
                : "border-amber-300 animate-pulse shadow-[0_0_14px_rgba(251,191,36,0.55)]"
            }`}
            title={rotarForzado || bloqueado ? "Volver a vertical" : "Girar pantalla: jugar en horizontal"}
          >
            <RotateCw className="w-3.5 h-3.5 text-amber-300" />
            <span>{rotarForzado || bloqueado ? "Vertical" : "Girar"}</span>
          </button>
        )}

        {/* Salir de la partida (1 jugador, 2 jugadores y en línea) */}
        {screen === "JUEGO" && (
          <button
            onClick={() => {
              if (online) {
                if (window.confirm("¿Salir de la partida en línea? Tu rival será notificado.")) {
                  playButtonClick();
                  salirDeSala();
                  setScreen("INICIO");
                }
              } else if (window.confirm("¿Salir de la partida? Se perderá el progreso actual.")) {
                playButtonClick();
                salirPartidaLocal();
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-b from-[#1c1f2b] to-[#12141d] hover:from-[#252a3a] hover:to-[#181b26] border border-rose-400/50 hover:border-rose-300 text-rose-200 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.5)] active:scale-95 transition-all"
            title="Salir de la partida"
          >
            <LogOut className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden md:inline">Salir</span>
          </button>
        )}

        {/* Fullscreen Toggle */}
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-b from-[#1c1f2b] to-[#12141d] hover:from-[#252a3a] hover:to-[#181b26] border border-amber-400/40 hover:border-amber-300 text-amber-200 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.5)] hover:shadow-[0_0_12px_rgba(251,191,36,0.35)] active:scale-95 transition-all"
          title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa (Maximizar)"}
        >
          {isFullscreen ? <Minimize className="w-3.5 h-3.5 text-amber-400" /> : <Maximize className="w-3.5 h-3.5 text-cyan-400" />}
          <span className="hidden lg:inline">{isFullscreen ? "Ventana" : "Pantalla Completa"}</span>
        </button>

        {/* Sound Toggle */}
        <button
          onClick={toggleMute}
          className="p-1.5 rounded-full bg-gradient-to-b from-[#1c1f2b] to-[#12141d] hover:from-[#252a3a] hover:to-[#181b26] border border-amber-400/40 hover:border-amber-300 text-[#ccc] hover:text-white cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.5)] hover:shadow-[0_0_12px_rgba(251,191,36,0.35)] active:scale-95 transition-all"
          title={isMuted ? "Activar sonido" : "Silenciar"}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
        </button>
      </div>

      {/* Main Game Container: Fills the entire screen seamlessly, with spacious layout matching original desktop */}
      <div 
        className="relative w-full h-full flex flex-col justify-between overflow-hidden"
      >
        {/* ============================================================= */}
        {/* 1. PANTALLA INICIO (Exact matching of crearPantallaInicio)     */}
        {/* ============================================================= */}
        {screen === "INICIO" && (
          <div 
            className="relative w-full h-full flex flex-col justify-end items-center bg-cover bg-center"
            style={{
              backgroundImage: "url('/img/inicio.png'), url('/img/Mesa_jollys.jpeg')",
              backgroundColor: "#0f0f14",
              // En vertical la imagen (horizontal) se muestra completa en vez de recortarse
              ...(portrait
                ? {
                    backgroundImage: "url('/img/inicio.png')",
                    backgroundSize: "contain",
                    backgroundPosition: "center 40%",
                    backgroundRepeat: "no-repeat"
                  }
                : {})
            }}
          >
            {/* Button JUGAR: Luxurious Casino Poker Velvet Button - Raised so author names below are fully visible */}
            <div
              className="z-10 flex flex-col items-center"
              style={{
                marginBottom: `calc(var(--vh) * ${portrait ? 30 : vp.w >= 1024 ? 30 : vp.w >= 640 ? 28 : 25})`
              }}
            >
              <button
                type="button"
                onClick={() => {
                  playButtonClick();
                  setScreen("MODO");
                }}
                className="group relative inline-flex items-center justify-center px-14 sm:px-18 py-3.5 sm:py-4.5 overflow-hidden font-black text-2xl sm:text-3xl tracking-widest text-amber-100 uppercase rounded-2xl bg-gradient-to-b from-[#a31c1c] via-[#851414] to-[#540909] border-2 border-amber-400 shadow-[0_12px_35px_rgba(0,0,0,0.85),inset_0_2px_2px_rgba(255,255,255,0.35)] hover:from-[#b91c1c] hover:via-[#991b1b] hover:to-[#630b0b] hover:border-amber-300 hover:shadow-[0_0_35px_rgba(251,191,36,0.65)] hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
              >
                <span className="flex items-center gap-3">
                  <span className="text-amber-300 text-2xl group-hover:rotate-12 transition-transform duration-200">♠</span>
                  <span className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">JUGAR</span>
                  <span className="text-amber-300 text-2xl group-hover:-rotate-12 transition-transform duration-200">♦</span>
                </span>
              </button>

              {vp.isPhone && vp.realPortrait && !vp.rotated && (
                <p className="mt-4 px-4 text-center text-xs text-amber-200/90 leading-snug">
                  📱 Para jugar mejor, pulsa <strong>Girar</strong> (abajo a la derecha) o voltea el celular.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* 2. PANTALLA MODO (Exact matching of crearPantallaModo)         */}
        {/* ============================================================= */}
        {screen === "MODO" && (
          <div 
            className="relative w-full h-full flex overflow-y-auto bg-cover bg-center"
            style={{
              backgroundImage: "url('/img/cartas.png'), url('/img/Mesa_jollys.jpeg')",
              backgroundColor: "#0f0f14"
            }}
          >
            {/* Dark overlay */}
            <div className="fixed inset-0 bg-black/60 pointer-events-none" />

            {/* Panel contenedor estilo mesa de casino */}
            <div 
              className={`relative z-10 m-auto flex flex-col items-center text-center bg-[#10121c]/90 border-2 border-amber-400/80 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] px-8 ${vp.h < 520 ? "py-4" : "py-8"} min-w-[min(380px,calc(var(--vw)*92))] max-w-md backdrop-blur-md`}
            >
              {/* Titulo */}
              <h2 
                className="font-black text-2xl sm:text-3xl text-amber-100 mb-3 sm:mb-6 tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
              >
                MODO DE JUEGO
              </h2>

              {/* Boton 1 JUGADOR */}
              <button
                type="button"
                onClick={() => {
                  playButtonClick();
                  setScreen("DIFICULTAD");
                }}
                className="w-full flex items-center justify-center gap-2 mb-3.5 py-3.5 px-6 rounded-xl font-bold text-xl tracking-wider text-amber-100 uppercase bg-gradient-to-b from-[#991b1b] via-[#851414] to-[#540909] border-2 border-amber-400/80 shadow-[0_6px_20px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:from-[#b91c1c] hover:via-[#991b1b] hover:to-[#630b0b] hover:border-amber-300 hover:shadow-[0_0_24px_rgba(251,191,36,0.5)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                <span>♠</span> 1 JUGADOR (vs IA) <span>♦</span>
              </button>

              {/* Boton 2 JUGADORES */}
              <button
                type="button"
                onClick={() => {
                  playButtonClick();
                  setScreen("LOBBY");
                }}
                className="w-full flex items-center justify-center gap-2 mb-4 py-3.5 px-6 rounded-xl font-bold text-xl tracking-wider text-amber-100 uppercase bg-gradient-to-b from-[#991b1b] via-[#851414] to-[#540909] border-2 border-amber-400/80 shadow-[0_6px_20px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:from-[#b91c1c] hover:via-[#991b1b] hover:to-[#630b0b] hover:border-amber-300 hover:shadow-[0_0_24px_rgba(251,191,36,0.5)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                <span>♣</span> 2 JUGADORES <span>♥</span>
              </button>

              {/* Boton VOLVER */}
              <button
                type="button"
                onClick={() => {
                  playButtonClick();
                  setScreen("INICIO");
                }}
                className="w-full py-2.5 px-6 rounded-xl font-bold text-base text-slate-300 uppercase bg-gradient-to-b from-[#1e2333] to-[#121520] border border-slate-500/60 hover:border-slate-400 hover:text-white hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                VOLVER
              </button>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* 3. PANTALLA DIFICULTAD (Exact matching of crearPantallaDificultad) */}
        {/* ============================================================= */}
        {screen === "DIFICULTAD" && (
          <div 
            className="relative w-full h-full flex overflow-y-auto bg-cover bg-center"
            style={{
              backgroundImage: "url('/img/cartas.png'), url('/img/Mesa_jollys.jpeg')",
              backgroundColor: "#0f0f14"
            }}
          >
            <div className="fixed inset-0 bg-black/60 pointer-events-none" />

            <div 
              className={`relative z-10 m-auto flex flex-col items-center text-center bg-[#10121c]/90 border-2 border-amber-400/80 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] px-8 ${vp.h < 520 ? "py-4" : "py-8"} min-w-[min(380px,calc(var(--vw)*92))] max-w-md backdrop-blur-md`}
            >
              <h2 
                className="font-black text-2xl sm:text-3xl text-amber-100 mb-3 sm:mb-6 tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
              >
                NIVEL DE DIFICULTAD
              </h2>

              {/* FACIL */}
              <button
                type="button"
                onClick={() => iniciarJuego(false, "FACIL")}
                className="w-full mb-3 py-3 px-6 rounded-xl font-bold text-lg tracking-wider text-emerald-100 uppercase bg-gradient-to-b from-[#065f46] via-[#047857] to-[#022c22] border-2 border-emerald-400/80 shadow-[0_6px_18px_rgba(0,0,0,0.7)] hover:border-emerald-300 hover:shadow-[0_0_20px_rgba(52,211,153,0.5)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                FÁCIL
              </button>

              {/* NORMAL */}
              <button
                type="button"
                onClick={() => iniciarJuego(false, "NORMAL")}
                className="w-full mb-3 py-3 px-6 rounded-xl font-bold text-lg tracking-wider text-amber-100 uppercase bg-gradient-to-b from-[#b45309] via-[#92400e] to-[#78350f] border-2 border-amber-400/80 shadow-[0_6px_18px_rgba(0,0,0,0.7)] hover:border-amber-300 hover:shadow-[0_0_20px_rgba(251,191,36,0.5)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                NORMAL
              </button>

              {/* DIFICIL */}
              <button
                type="button"
                onClick={() => iniciarJuego(false, "DIFICIL")}
                className="w-full mb-4 py-3 px-6 rounded-xl font-bold text-lg tracking-wider text-rose-100 uppercase bg-gradient-to-b from-[#991b1b] via-[#851414] to-[#540909] border-2 border-rose-400/80 shadow-[0_6px_18px_rgba(0,0,0,0.7)] hover:border-rose-300 hover:shadow-[0_0_20px_rgba(244,63,94,0.5)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                DIFÍCIL
              </button>

              {/* VOLVER */}
              <button
                type="button"
                onClick={() => {
                  playButtonClick();
                  setScreen("MODO");
                }}
                className="w-full py-2.5 px-6 rounded-xl font-bold text-base text-slate-300 uppercase bg-gradient-to-b from-[#1e2333] to-[#121520] border border-slate-500/60 hover:border-slate-400 hover:text-white hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                VOLVER
              </button>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* 3.5 LOBBY EN LÍNEA: código de sala para jugar desde otro dispositivo */}
        {/* ============================================================= */}
        {screen === "LOBBY" && (
          <OnlineLobby
            key={lobbyKey}
            joinCode={joinCodeUrl}
            resumeCode={resumeCode}
            onBack={() => {
              setJoinCodeUrl(undefined);
              setResumeCode(undefined);
              setScreen("MODO");
            }}
            onLocal={() => iniciarJuego(true, "NORMAL")}
          />
        )}

        {/* ============================================================= */}
        {/* 4. PANTALLA DE JUEGO (Exact matching of screenshot & Java)   */}
        {/* ============================================================= */}
        {screen === "JUEGO" && (
          <div 
            className="relative w-full h-full flex flex-col justify-between overflow-hidden select-none"
            style={{
              backgroundImage: "url('/img/Mesa_jollys.jpeg')",
              backgroundSize: "100% 100%",
              backgroundPosition: "center",
              backgroundColor: "rgb(20, 30, 25)"
            }}
          >
            {/* Panel Superior: Wide, spacious header with dedicated stylish glass plates */}
            <div className={`relative z-20 w-full flex items-start justify-between gap-2 ${compact ? "pt-2 px-2" : "pt-6 md:pt-7 px-10 md:px-14 lg:px-18"}`}>
              {/* WEST: cajaJugador */}
              <div className={`flex flex-col items-start min-w-0 ${vp.w < 640 ? "flex-1" : "flex-none"} select-none bg-black/55 backdrop-blur-md ${compact ? "px-2.5 py-1.5" : "px-5 py-2.5"} rounded-2xl border border-amber-400/30 shadow-[0_6px_20px_rgba(0,0,0,0.7)]`}>
                <div 
                  className={`font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] ${
                    compact ? "text-[12px] leading-tight break-words tracking-wide" : "text-lg sm:text-xl md:text-2xl tracking-wider"
                  }`}
                >
                  {online
                    ? `TÚ - ${jugador.nombre.toUpperCase()}`
                    : modoDosJugadores
                    ? `JUGADOR 1 - ${jugador.nombre.toUpperCase()}`
                    : jugador.nombre.toUpperCase()}
                </div>
                {dificultad === "FACIL" && !modoDosJugadores && !online ? (
                  <div className={`font-mono font-bold text-emerald-300 ${compact ? "text-xs mt-1" : "text-base mt-2"}`}>
                    🏆 {puntajeJugador} / 100
                  </div>
                ) : (
                  renderCorazones(jugador.vida)
                )}
              </div>

              {/* CENTER: lblTurno */}
              <div
                className={`flex flex-col items-center justify-center ${compact ? "pt-1" : "pt-2"} select-none shrink-0`}
                style={{ maxWidth: vp.w < 640 ? "calc(var(--vw) * 32)" : undefined }}
              >
                <div 
                  className={`drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] ${compact ? "px-3 py-1 text-xs" : "px-6 py-1.5 text-lg md:text-xl"} rounded-full bg-black/65 backdrop-blur-md border border-amber-400/60 text-amber-300 font-bold text-center leading-tight shadow-[0_6px_20px_rgba(0,0,0,0.7)] tracking-wide`}
                >
                  {online
                    ? activePlayedCard
                      ? "Las cartas se encuentran"
                      : miEleccionId
                      ? "Esperando al rival…"
                      : "Elige tu carta"
                    : modoDosJugadores
                    ? activePlayedCard
                      ? "Las cartas se encuentran"
                      : turnoJugador
                      ? "JUGADOR 1: elige tu carta"
                      : "JUGADOR 2: elige tu carta"
                    : turnoJugador
                    ? "🛡 Elige tu defensa"
                    : "Turno: IA"}
                </div>

                {online && (
                  <div className="mt-1 flex flex-col items-center gap-1">
                    <span className={`${compact ? "px-2 text-[10px] tracking-[0.15em]" : "px-3 text-[11px] tracking-[0.25em]"} py-0.5 rounded-full bg-black/60 border border-amber-400/30 font-mono text-amber-200/90 whitespace-nowrap`}>
                      SALA {codigoSala}
                    </span>
                  </div>
                )}
              </div>

              {/* EAST: cajaIA / JUGADOR 2 - Completely unblocked and crystal clear */}
              <div className={`flex flex-col items-end min-w-0 ${vp.w < 640 ? "flex-1" : "flex-none"} select-none text-right bg-black/55 backdrop-blur-md ${compact ? "px-2.5 py-1.5" : "px-5 py-2.5"} rounded-2xl border border-amber-400/30 shadow-[0_6px_20px_rgba(0,0,0,0.7)]`}>
                <div 
                  className={`font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] ${
                    compact ? "text-[12px] leading-tight break-words tracking-wide" : "text-lg sm:text-xl md:text-2xl tracking-wider"
                  }`}
                >
                  {online
                    ? `RIVAL - ${ia.nombre.toUpperCase()}`
                    : modoDosJugadores
                    ? `JUGADOR 2 - ${ia.nombre.toUpperCase()}`
                    : `${ia.nombre.toUpperCase()} (${dificultad.toUpperCase()})`}
                </div>
                {dificultad === "FACIL" && !modoDosJugadores && !online ? (
                  <div className={`font-mono font-bold text-emerald-300 ${compact ? "text-xs mt-1" : "text-base mt-2"}`}>
                    🏆 {puntajeIA} / 100
                  </div>
                ) : (
                  renderCorazones(ia.vida)
                )}
              </div>
            </div>

            {/* MESA CANVAS: TableCardsView (6 rotated cards on the table with dorso) */}
            <TableCardsView
              cartasMesaJugador={cartasMesaJugador}
              cartasMesaIA={cartasMesaIA}
              onDropCard={(e) => {
                if (relevoLocal !== null) return;
                if (online ? !turnoJugador || !!miEleccionId : !turnoJugador && !modoDosJugadores) return;
                // Juega la carta que se arrastró (si no se puede saber cuál, la primera)
                const idArrastrada = e?.dataTransfer?.getData("text/plain");
                const carta = manoActual.find((c) => c.id === idArrastrada) ?? manoActual[0];
                if (carta) handleJugarCarta(carta);
              }}
            />

            {/* 1 JUGADOR: la IA muestra la(s) carta(s) de ataque de las que lanzará UNA; el jugador elige su defensa */}
            {!modoDosJugadores && !online && !activePlayedCard && ataquesAnunciados.length > 0 && (
              <div
                className="absolute left-1/2 top-[17%] -translate-x-1/2 z-[35] flex flex-col items-center gap-2 pointer-events-none"
                style={{ maxWidth: "calc(var(--vw) * 94)" }}
              >
                <div className="px-4 py-1.5 rounded-2xl bg-emerald-950/90 border border-emerald-400/60 text-emerald-200 text-xs sm:text-sm font-bold text-center shadow-[0_6px_20px_rgba(0,0,0,0.7)]">
                  🤖{" "}
                  {ataquesAnunciados.length === 1
                    ? `La IA lanzará: ${ataquesAnunciados[0].nombre} (${ataquesAnunciados[0].objetivo})`
                    : dificultad === "NORMAL"
                    ? "La IA lanzará UNA de estas 2 cartas (50 % / 50 %)"
                    : `La IA lanzará UNA de estas ${ataquesAnunciados.length} cartas`}{" "}
                  — ¡elige tu defensa!
                </div>
                <div className="flex items-end justify-center gap-4 sm:gap-6">
                  {ataquesAnunciados.map((c, i) => (
                    <MiniCarta key={c.id} card={c} retraso={i * 300} />
                  ))}
                </div>
                {tiempoRestante !== null && (
                  <div
                    className={`px-4 py-1 rounded-full border font-mono font-black text-sm sm:text-base shadow-[0_6px_20px_rgba(0,0,0,0.7)] ${
                      tiempoRestante <= 5
                        ? "bg-rose-950/95 border-rose-400 text-rose-200 animate-pulse"
                        : "bg-black/80 border-amber-400/70 text-amber-200"
                    }`}
                  >
                    ⏱ {tiempoRestante}s
                  </div>
                )}
              </div>
            )}

            {/* En línea: los dos eligen en secreto; aquí se ve quién ya eligió (sin mostrar cuál carta) */}
            {online && !activePlayedCard && (miEleccionId || rivalEligio) && (
              <div
                className="absolute left-1/2 top-[27%] -translate-x-1/2 z-[35] flex flex-col items-center gap-2 pointer-events-none"
                style={{ maxWidth: "calc(var(--vw) * 94)" }}
              >
                <div className="px-4 py-1.5 rounded-2xl bg-emerald-950/90 border border-emerald-400/60 text-emerald-200 text-xs sm:text-sm font-bold text-center shadow-[0_6px_20px_rgba(0,0,0,0.7)]">
                  {miEleccionId
                    ? rivalEligio
                      ? "✅ Los dos eligieron… ¡las cartas se encuentran!"
                      : "✅ Elegiste tu carta — esperando a que el rival elija…"
                    : "⏳ El rival ya eligió. ¡Elige tu carta!"}
                </div>
                <div className="flex items-end justify-center gap-4">
                  {miEleccionId && (
                    <div style={{ width: "clamp(58px, calc(var(--vh) * 11), 100px)", aspectRatio: "195 / 275" }}>
                      <img
                        src="/img/dorso.png"
                        alt="Tu carta"
                        className="w-full h-full object-cover rounded-lg border-2 border-amber-400/80 shadow-[0_6px_16px_rgba(0,0,0,0.9)]"
                        draggable={false}
                      />
                    </div>
                  )}
                  <div
                    className={`${rivalEligio ? "" : "opacity-30"}`}
                    style={{ width: "clamp(58px, calc(var(--vh) * 11), 100px)", aspectRatio: "195 / 275" }}
                  >
                    <img
                      src="/img/dorso.png"
                      alt="Carta del rival"
                      className="w-full h-full object-cover rounded-lg border-2 border-amber-400/80 shadow-[0_6px_16px_rgba(0,0,0,0.9)]"
                      draggable={false}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 2 jugadores en un dispositivo: la carta del JUGADOR 1 ya está elegida y boca abajo */}
            {!online && modoDosJugadores && !activePlayedCard && eleccionJ1 && (
              <div
                className="absolute left-1/2 top-[27%] -translate-x-1/2 z-[35] flex flex-col items-center gap-2 pointer-events-none"
                style={{ maxWidth: "calc(var(--vw) * 94)" }}
              >
                <div className="px-4 py-1.5 rounded-2xl bg-emerald-950/90 border border-emerald-400/60 text-emerald-200 text-xs sm:text-sm font-bold text-center shadow-[0_6px_20px_rgba(0,0,0,0.7)]">
                  ✅ JUGADOR 1 ya eligió (carta oculta) — ahora elige JUGADOR 2
                </div>
                <div style={{ width: "clamp(58px, calc(var(--vh) * 11), 100px)", aspectRatio: "195 / 275" }}>
                  <img
                    src="/img/dorso.png"
                    alt="Carta del jugador 1"
                    className="w-full h-full object-cover rounded-lg border-2 border-amber-400/80 shadow-[0_6px_16px_rgba(0,0,0,0.9)]"
                    draggable={false}
                  />
                </div>
              </div>
            )}

            {/* Aviso: el rival perdió la conexión (en línea) */}
            {online && !rivalConectado && (
              <div className="absolute left-1/2 top-[38%] -translate-x-1/2 z-[35] px-4 py-2 rounded-full bg-rose-950/95 border border-rose-400/70 text-rose-200 text-xs sm:text-sm font-bold animate-pulse text-center pointer-events-none" style={{ maxWidth: "calc(var(--vw) * 90)" }}>
                ⚠ Rival desconectado… esperando a que vuelva
              </div>
            )}

            {/* 3D FLIP REVEAL: Animación cuando se pone la carta (Reverso -> Volteo -> Frente ej. DDoS) */}
            {activePlayedCard && (
              <CardFlipReveal
                key={activePlayedCard.card.id}
                card={activePlayedCard.card}
                playedBy={activePlayedCard.playedBy}
                isFlipped={activePlayedCard.isFlipped}
                resultado={activePlayedCard.resultado}
                segunda={activePlayedCard.segunda}
                onContinue={handleContinuarTurno}
                esperando={online && yaContinue}
                autoCloseDuration={10000}
              />
            )}

            {/* 2 JUGADORES (mismo dispositivo): pantalla de relevo que tapa las cartas del otro jugador */}
            {!online && modoDosJugadores && relevoLocal !== null && !activePlayedCard && (
              <div className="absolute inset-0 z-[70] flex items-center justify-center bg-[#07080d]/[0.97] backdrop-blur-md px-4">
                <div
                  className={`flex flex-col items-center text-center bg-[#10121c] border-2 border-amber-400/80 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.95)] ${
                    compact ? "px-5 py-4 gap-2" : "px-10 py-8 gap-4"
                  }`}
                  style={{ maxWidth: "calc(var(--vw) * 92)" }}
                >
                  <div className={compact ? "text-3xl" : "text-5xl"}>🔒</div>
                  <h2 className={`font-black text-amber-300 tracking-wide ${compact ? "text-xl" : "text-3xl md:text-4xl"}`}>
                    {relevoInicio ? "¡Va a empezar la partida!" : `Turno del JUGADOR ${relevoLocal}`}
                  </h2>
                  <p className={`text-slate-200 ${compact ? "text-xs" : "text-base md:text-lg"}`}>
                    {relevoInicio
                      ? "Comienza el JUGADOR 1. JUGADOR 2, aparta la vista mientras el JUGADOR 1 ve sus cartas."
                      : relevoLocal === 2
                      ? "JUGADOR 1 ya eligió. JUGADOR 1, aparta la vista y pásale el dispositivo al JUGADOR 2."
                      : "JUGADOR 2, aparta la vista y pásale el dispositivo al JUGADOR 1."}
                  </p>
                  <p className={`text-slate-400 ${compact ? "text-[10px]" : "text-sm"}`}>
                    {relevoInicio ? "JUGADOR 1, pulsa Comenzar cuando estés listo." : "Cuando estés listo, pulsa Siguiente para ver tus cartas."}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      playButtonClick();
                      setRelevoLocal(null);
                      setRelevoInicio(false);
                    }}
                    className={`mt-1 rounded-xl font-bold tracking-wider text-amber-100 uppercase bg-gradient-to-b from-[#991b1b] via-[#851414] to-[#540909] border-2 border-amber-400/80 shadow-[0_6px_20px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:from-[#b91c1c] hover:border-amber-300 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer ${
                      compact ? "px-6 py-2 text-sm" : "px-10 py-3 text-xl"
                    }`}
                  >
                    {relevoInicio ? "Comenzar ▶" : "Siguiente ▶"}
                  </button>
                </div>
              </div>
            )}

            {/* MENSAJE CENTRAL (JLabel mensajeCentral in Java) */}
            {mensajeCentral && !activePlayedCard && (
              <div 
                style={{
                  position: "absolute",
                  left: "50%",
                  top: activePlayedCard ? "72%" : "46%",
                  transform: "translate(-50%, -50%)",
                  backgroundColor: "rgba(16, 18, 28, 0.96)",
                  color: "#ffffff",
                  fontFamily: "'Segoe UI Emoji', Arial, sans-serif",
                  fontSize: "clamp(14px, calc(var(--vw) * 4.4), 20px)",
                  maxWidth: "calc(var(--vw) * 88)",
                  fontWeight: "bold",
                  border: "2px solid #ffc800",
                  padding: "clamp(8px, calc(var(--vw) * 2), 14px) clamp(14px, calc(var(--vw) * 4), 28px)",
                  zIndex: 50
                }}
                className="shadow-[0_15px_40px_rgba(0,0,0,0.95)] text-center select-none pointer-events-none rounded-xl transition-all duration-300 backdrop-blur-md"
              >
                {mensajeCentral}
              </div>
            )}

            {/* PANEL INFERIOR: Cartas de la mano (Centered with generous spacing and padding) */}
            <div
              className={`relative z-30 w-full flex items-center justify-center ${
                // En vertical se deja espacio abajo para la barra flotante y las 3 cartas caben a lo ancho
                portrait ? "gap-2 pb-16 px-2" : "gap-4 sm:gap-6 pb-6 sm:pb-8 md:pb-10 px-4"
              }`}
            >
              {manoActual.map((carta) => {
                const isThisAnimating = animatingCardId === carta.id;
                return (
                  <CardComponent
                    key={carta.id}
                    card={carta}
                    disabled={
                      online
                        ? !turnoJugador || !!activePlayedCard || !!miEleccionId
                        : !turnoJugador && !modoDosJugadores
                    }
                    isAnimating={isThisAnimating}
                    onClick={() => handleJugarCarta(carta)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", carta.id);
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* 5. PANTALLA FIN DE JUEGO (Exact matching of crearPantallaFinJuego) */}
        {/* ============================================================= */}
        {screen === "FIN" && (
          <div 
            className="relative w-full h-full flex overflow-y-auto bg-cover bg-center"
            style={{
              backgroundImage: "url('/img/cartas.png'), url('/img/Mesa_jollys.jpeg')",
              backgroundColor: "#0f0f14"
            }}
          >
            {/* Overlay */}
            <div className="fixed inset-0 bg-black/70 pointer-events-none" />

            {/* Panel Contenedor */}
            <div 
              className={`relative z-10 m-auto flex flex-col items-center text-center bg-[#10121c]/95 border-2 border-amber-400/80 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.95)] px-8 ${vp.h < 520 ? "py-4" : "py-8"} min-w-[min(380px,calc(var(--vw)*92))] max-w-md backdrop-blur-md`}
            >
              {/* Titulo mensajeTexto */}
              <h2 
                className="font-black text-2xl sm:text-3xl text-amber-100 mb-3 sm:mb-6 tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
              >
                {mensajeFinJuego}
              </h2>

              {/* Boton VOLVER AL INICIO */}
              <button
                type="button"
                onClick={volverAlInicio}
                className="w-full mb-3.5 py-3.5 px-6 rounded-xl font-bold text-xl tracking-wider text-amber-100 uppercase bg-gradient-to-b from-[#991b1b] via-[#851414] to-[#540909] border-2 border-amber-400/80 shadow-[0_6px_20px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:from-[#b91c1c] hover:via-[#991b1b] hover:to-[#630b0b] hover:border-amber-300 hover:shadow-[0_0_24px_rgba(251,191,36,0.5)] hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
              >
                VOLVER AL INICIO
              </button>
            </div>
          </div>
        )}
      </div>

      {/* VS Code & Port Connection Guide Modal */}
      {showVsCodeModal && (
        <VsCodePortModal
          onClose={() => setShowVsCodeModal(false)}
          currentPort={3000}
        />
      )}

      {/* Rules Modal */}
      {showRulesModal && (
  <RulesModal
    isOpen={showRulesModal}
    onClose={() => setShowRulesModal(false)}
  />
)}
    </div>
    </ViewportContext.Provider>
  );
}
