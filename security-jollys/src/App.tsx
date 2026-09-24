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
  OnlinePlayedPayload,
  OnlineSnapshot,
  OnlineSyncPayload,
  OnlineTurnPayload
} from "./types";
import { MAZO_BASE, repartirTresCartas } from "./utils/gameData";

// --- Modo FÁCIL (aprendizaje por puntos) ---------------------------------
// Mapa ataque -> control correcto, según la tabla: Phishing-2FA, Malware-Antivirus, DDoS-Firewall, Jolly Ataque-Jolly Defensa
const CONTRA_DE_ATAQUE: Record<string, string> = {
  phishing: "2FA",
  malware: "antivirus",
  ddos: "firewall",
  jolly_ataque: "jolly_defensa"
};
const ATAQUES_FACIL = ["phishing", "malware", "ddos", "jolly_ataque"];

function clonarCarta(base: Card): Card {
  return { ...base, id: `${base.id}-${Date.now()}-${Math.random().toString(36).slice(2)}` };
}

// Arma la mano de 3 cartas del jugador garantizando que el control correcto para
// el ataque anunciado por la IA esté siempre entre ellas.
function construirManoConContra(cartaAtaque: Card): Card[] {
  const contraId = CONTRA_DE_ATAQUE[cartaAtaque.id];
  const cartaContra = MAZO_BASE.find((c) => c.id === contraId) ?? MAZO_BASE[0];
  const otras = MAZO_BASE.filter((c) => c.id !== contraId);
  const mano: Card[] = [clonarCarta(cartaContra)];
  while (mano.length < 3) {
    const pick = otras[Math.floor(Math.random() * otras.length)];
    mano.push(clonarCarta(pick));
  }
  // Mezclar para que el control correcto no quede siempre en la misma posición
  for (let i = mano.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mano[i], mano[j]] = [mano[j], mano[i]];
  }
  return mano;
}

// Aplica el impacto directo (sin probabilidad) del ataque anunciado sobre el jugador,
// usado cuando en modo FÁCIL el jugador responde con el control incorrecto.
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
  const pilar: "confidencialidad" | "integridad" | "disponibilidad" =
    atacante.id === "phishing" ? "confidencialidad" : atacante.id === "malware" ? "integridad" : "disponibilidad";
  setObjetivo((prev) => ({ ...prev, vida: Math.max(0, prev.vida - 1), [pilar]: false }));
}
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

  // Turn management: true = Jugador 1, false = Jugador 2 or IA
  const [turnoJugador, setTurnoJugador] = useState<boolean>(true);

  // Modo FACIL (aprendizaje): en vez de vidas, se juega a puntos. Gana quien llegue primero a 100.
  // Cada jugada que "acierta" (ataque exitoso o defensa aplicada) suma 10 puntos a quien la jugó.
  const [puntajeJugador, setPuntajeJugador] = useState<number>(0);
  const [puntajeIA, setPuntajeIA] = useState<number>(0);
  // Carta que la IA jugará en su próximo turno, anunciada de antemano al jugador para que
  // pueda elegir con cuál de sus 3 cartas responder (solo en modo FACIL, un jugador vs IA).
  const [cartaAnunciadaIA, setCartaAnunciadaIA] = useState<Card | null>(null);

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

  // Probability random check: exito(int prob)
  const exito = (probabilidad: number): boolean => {
    return Math.random() * 100 < probabilidad;
  };

  // Probability modifier based on difficulty (from Java original)
  const ajustarProbabilidad = (base: number, esIA: boolean): number => {
    if (!esIA || modoDosJugadores) {
      return base;
    }
    let ajuste = 0;
    if (dificultad === "FACIL") ajuste = -20;
    else if (dificultad === "DIFICIL") ajuste = 20;

    const resultado = base + ajuste;
    return Math.max(5, Math.min(95, resultado));
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
    setRivalConectado(s.rivalConnected);
    setYaContinue(s.waitingContinue);
    setAnimatingCardId(null);
    if (s.pending) {
      setActivePlayedCard({
        card: s.pending.card,
        playedBy: s.pending.playedByMe ? "TÚ" : "RIVAL",
        isFlipped: true,
        resultado: s.pending.outcome
      });
    } else {
      setActivePlayedCard(null);
    }
    if (s.phase === "over") {
      setMensajeFinJuego(
        s.result === "win"
          ? `¡GANASTE! Has derrotado a la ${s.rival.nombre}`
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
        showCentralMessage(
          snapshot.myTurn ? "🃏 ¡Rival conectado! Comienzas tú" : "🃏 ¡Rival conectado! Empieza el rival"
        );
      }
    };

    // Alguien jugó una carta: dorso -> volteo -> efecto (mismos tiempos que el modo local)
    const onPlayed = (p: OnlinePlayedPayload) => {
      limpiarTimersOnline();
      playLockRef.current = false;
      setAnimatingCardId(null);
      setYaContinue(false);
      setManoJugador(p.state.hand);
      setCartasMesaJugador(p.state.meMesa);
      setCartasMesaIA(p.state.rivalMesa);
      if (!p.playedByMe) playCardPlaySound();
      setActivePlayedCard({
        card: p.card,
        playedBy: p.playedByMe ? "TÚ" : "RIVAL",
        isFlipped: false
      });
      const t1 = setTimeout(() => {
        playCardFlipSound();
        setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true } : null));
        const t2 = setTimeout(() => {
          setJugador(p.state.me);
          setIa(p.state.rival);
          reproducirFx(p.outcome.fx);
          showCentralMessage(p.outcome.mensaje);
          setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true, resultado: p.outcome } : null));
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

    const onOver = ({ result, snapshot }: { result: "win" | "lose"; snapshot: OnlineSnapshot }) => {
      aplicarSnapshot(snapshot);
      if (result === "win") playVictorySound();
      else playDefeatSound();
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
    socket.on("game:played", onPlayed);
    socket.on("game:turn", onTurn);
    socket.on("game:over", onOver);
    socket.on("room:rival", onRival);
    socket.on("room:closed", onClosed);
    socket.on("game:error", onError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("game:sync", onSync);
      socket.off("game:played", onPlayed);
      socket.off("game:turn", onTurn);
      socket.off("game:over", onOver);
      socket.off("room:rival", onRival);
      socket.off("room:closed", onClosed);
      socket.off("game:error", onError);
      limpiarTimersOnline();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setCartaAnunciadaIA(null);

    const m1 = repartirTresCartas();
    setManoJugador(m1);

    if (dosJugadores) {
      const m2 = repartirTresCartas();
      setManoJugador2(m2);
    } else {
      setManoJugador2([]);
    }

    setTurnoJugador(true);
    setMensajeCentral(null);
    setAnimatingCardId(null);
    setActivePlayedCard(null);
    setScreen("JUEGO");
  };

  // Execute card effect (aplicarCarta in Java)
  const aplicarCarta = (
    c: Card,
    objetivo: PlayerEntity,
    setObjetivo: React.Dispatch<React.SetStateAction<PlayerEntity>>,
    propio: PlayerEntity,
    setPropio: React.Dispatch<React.SetStateAction<PlayerEntity>>,
    esIA: boolean
  ): CardActionOutcome => {
    switch (c.tipo) {
      case "ATAQUE": {
        let prob = c.probBase;
        if (c.nombre === "Phishing") {
          prob = ajustarProbabilidad(60, esIA);
          if (exito(prob)) {
            setObjetivo((prev) => ({
              ...prev,
              vida: Math.max(0, prev.vida - 1),
              confidencialidad: false
            }));
            playAttackHitSound();
            showCentralMessage("📧 Phishing exitoso: Confidencialidad comprometida");
            return {
              titulo: "📧 Phishing Exitoso",
              detalle: `Ataque de ingeniería social efectivo. La Confidencialidad de ${objetivo.nombre} fue vulnerada y perdió 1 vida.`,
              exito: true,
              tipo: "ATAQUE",
              impacto: "-1 ♥ Vida"
            };
          } else {
            playAttackMissSound();
            showCentralMessage("❌ El ataque falló");
            return {
              titulo: "🛡 Phishing Bloqueado",
              detalle: `${objetivo.nombre} detectó el engaño y protegió sus credenciales sin sufrir daño.`,
              exito: false,
              tipo: "ATAQUE",
              impacto: "Ataque Fallido"
            };
          }
        } else if (c.nombre === "DDoS") {
          prob = ajustarProbabilidad(70, esIA);
          if (exito(prob)) {
            setObjetivo((prev) => ({
              ...prev,
              vida: Math.max(0, prev.vida - 1),
              disponibilidad: false
            }));
            playAttackHitSound();
            showCentralMessage("🌐 DDoS exitoso: Disponibilidad caída");
            return {
              titulo: "🌐 Ataque DDoS Exitoso",
              detalle: `Inundación masiva de peticiones saturó el servidor. La Disponibilidad de ${objetivo.nombre} cayó y perdió 1 vida.`,
              exito: true,
              tipo: "ATAQUE",
              impacto: "-1 ♥ Vida"
            };
          } else {
            playAttackMissSound();
            showCentralMessage("❌ El ataque falló");
            return {
              titulo: "🛡 DDoS Mitigado",
              detalle: `Los sistemas de balanceo de ${objetivo.nombre} mitigaron la sobrecarga de tráfico.`,
              exito: false,
              tipo: "ATAQUE",
              impacto: "Ataque Fallido"
            };
          }
        } else if (c.nombre === "Malware") {
          prob = ajustarProbabilidad(65, esIA);
          if (exito(prob)) {
            setObjetivo((prev) => ({
              ...prev,
              vida: Math.max(0, prev.vida - 1),
              integridad: false
            }));
            playAttackHitSound();
            showCentralMessage("🦠 Malware exitoso: Integridad comprometida");
            return {
              titulo: "🦠 Infección de Malware Exitosa",
              detalle: `Binario malicioso ejecutado. La Integridad de los archivos de ${objetivo.nombre} fue alterada y perdió 1 vida.`,
              exito: true,
              tipo: "ATAQUE",
              impacto: "-1 ♥ Vida"
            };
          } else {
            playAttackMissSound();
            showCentralMessage("❌ El ataque falló");
            return {
              titulo: "🛡 Malware Neutralizado",
              detalle: `El sistema antivirus y EDR de ${objetivo.nombre} interceptó el código hostil a tiempo.`,
              exito: false,
              tipo: "ATAQUE",
              impacto: "Ataque Fallido"
            };
          }
        }
        break;
      }

      case "DEFENSA": {
        playDefenseSound();
        if (c.nombre === "Antivirus") {
          setPropio((prev) => ({
            ...prev,
            vida: Math.min(3, prev.vida + 1),
            integridad: true
          }));
          showCentralMessage("🛡 Defensa aplicada: Antivirus");
          return {
            titulo: "🛡 Antivirus Activo",
            detalle: `${propio.nombre} detectó y eliminó el software malicioso de sus equipos, restaurando Integridad (+1 ♥).`,
            exito: true,
            tipo: "DEFENSA",
            impacto: "+1 ♥ Vida"
          };
        } else if (c.nombre === "2FA") {
          setPropio((prev) => ({
            ...prev,
            vida: Math.min(3, prev.vida + 1),
            confidencialidad: true
          }));
          showCentralMessage("🛡 Defensa aplicada: 2FA");
          return {
            titulo: "🔐 Doble Factor Activado",
            detalle: `${propio.nombre} exigió una segunda verificación en cada acceso, recuperando Confidencialidad (+1 ♥).`,
            exito: true,
            tipo: "DEFENSA",
            impacto: "+1 ♥ Vida"
          };
        } else if (c.nombre === "Firewall") {
          setPropio((prev) => ({
            ...prev,
            vida: Math.min(3, prev.vida + 1),
            disponibilidad: true
          }));
          showCentralMessage("🛡 Defensa aplicada: Firewall");
          return {
            titulo: "🧱 Reglas de Firewall Activas",
            detalle: `${propio.nombre} filtró el tráfico de red anómalo, recuperando Disponibilidad total (+1 ♥).`,
            exito: true,
            tipo: "DEFENSA",
            impacto: "+1 ♥ Vida"
          };
        }
        break;
      }

      case "JOLLY": {
        playJollySound();
        if (c.nombre === "Jolly Ataque") {
          if (exito(35)) {
            let hits = 0;
            if (exito(70)) hits++;
            if (exito(70)) hits++;
            if (exito(70)) hits++;

            if (hits > 0) {
              setObjetivo((prev) => ({
                ...prev,
                vida: Math.max(0, prev.vida - hits)
              }));
              playAttackHitSound();
              showCentralMessage("🃏🔥 ¡Jolly Ataque impactó!");
              return {
                titulo: `🃏🔥 ¡Jolly Ataque Impactó (${hits} impacto${hits > 1 ? "s" : ""})!`,
                detalle: `Exploit de día cero multifase golpeó múltiples servicios de ${objetivo.nombre}.`,
                exito: true,
                tipo: "JOLLY",
                impacto: `-${hits} ♥ Vidas`
              };
            } else {
              showCentralMessage("⚖️ Jolly Ataque no causó daño");
              return {
                titulo: "⚖️ Jolly Ataque sin Daño",
                detalle: `El exploit avanzado no encontró vulnerabilidades explotables en ${objetivo.nombre}.`,
                exito: false,
                tipo: "JOLLY",
                impacto: "Sin Daño"
              };
            }
          } else {
            playAttackMissSound();
            showCentralMessage("⚖️ Jolly Ataque falló");
            return {
              titulo: "⚖️ Jolly Ataque Falló",
              detalle: `El ataque multifase no logró penetrar los perímetros de ${objetivo.nombre}.`,
              exito: false,
              tipo: "JOLLY",
              impacto: "Ataque Fallido"
            };
          }
        } else if (c.nombre === "Jolly Defensa") {
          setPropio((prev) => ({
            ...prev,
            vida: 3,
            confidencialidad: true,
            integridad: true,
            disponibilidad: true
          }));
          showCentralMessage("🃏🛡 ¡Recuperación Total con Jolly Defensa!");
          return {
            titulo: "🃏🛡 ¡Resiliencia Total: Jolly Defensa!",
            detalle: `${propio.nombre} desplegó un plan de contingencia de respuesta rápida, restaurando la Tríada CIA al 100% (3 ♥).`,
            exito: true,
            tipo: "JOLLY",
            impacto: "Restauración Total (3 ♥)"
          };
        }
        break;
      }
    }

    return {
      titulo: c.nombre,
      detalle: c.descripcion,
      exito: true,
      tipo: c.tipo
    };
  };

  // Check new round: checkNuevaRonda()
  const checkNuevaRonda = (mesaJugador: number, mesaIA: number) => {
    if (mesaJugador <= 0 && mesaIA <= 0) {
      setTimeout(() => {
        setCartasMesaJugador(3);
        setCartasMesaIA(3);
        playRoundResetSound();
        showCentralMessage("🃏✨ ¡Nueva ronda! Las 6 cartas han vuelto.");
      }, 2000);
    }
  };

  // Handle Player Action: jugarCarta(Carta carta) with 3D Flip Animation (Reverso -> Volteo -> Frente)
  const handleJugarCarta = (carta: Card) => {
    if (online) {
      // En línea solo se PIDE jugar la carta; el servidor decide y responde con game:played
      if (!turnoJugador || animatingCardId || activePlayedCard || playLockRef.current) return;
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
    if (animatingCardId || activePlayedCard) return; // Prevent double trigger
    playCardPlaySound();

    // Trigger animation in player's hand
    setAnimatingCardId(carta.id);

    setTimeout(() => {
      setAnimatingCardId(null);

      const esJugador1 = turnoJugador;
      const nombreQuienLanza = esJugador1
        ? modoDosJugadores
          ? "JUGADOR 1"
          : jugador.nombre
        : "JUGADOR 2";

      // 1. Quitar carta de la mano y descontar carta de la mesa
      if (esJugador1) {
        setManoJugador((prev) => prev.filter((c) => c.id !== carta.id));
        setCartasMesaJugador((prev) => Math.max(0, prev - 1));
      } else {
        setManoJugador2((prev) => prev.filter((c) => c.id !== carta.id));
        setCartasMesaIA((prev) => Math.max(0, prev - 1));
      }

      // 2. PASO 1: Aparece el revés de la carta en la mesa (dorso)
      setActivePlayedCard({
        card: carta,
        playedBy: nombreQuienLanza,
        isFlipped: false
      });

      // 3. PASO 2: A los 350ms, la carta da la vuelta (flip 3D) y revela el frente con su imagen real
      setTimeout(() => {
        playCardFlipSound();
        setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true } : null));

        // 4. PASO 3: Tras voltearse (550ms), se aplica el efecto en las vidas/estados
        setTimeout(() => {
          const esRondaFacil =
            dificultad === "FACIL" && !modoDosJugadores && esJugador1 && !!cartaAnunciadaIA;

          let outcome: CardActionOutcome;

          if (esRondaFacil && cartaAnunciadaIA) {
            const contraId = CONTRA_DE_ATAQUE[cartaAnunciadaIA.id];
            const cartaContra = MAZO_BASE.find((c) => c.id === contraId);
            const acierto = carta.id.split("-")[0] === contraId;

            if (acierto) {
              // Control correcto: aplica la defensa sobre el propio jugador y suma 10 puntos
              outcome = aplicarCarta(carta, ia, setIa, jugador, setJugador, false);
              setPuntajeJugador((prev) => Math.min(100, prev + 10));
            } else {
              // Control incorrecto: el ataque anunciado por la IA impacta directamente
              aplicarAtaqueDirecto(cartaAnunciadaIA, setJugador);
              playAttackHitSound();
              showCentralMessage(`❌ Control incorrecto: ${cartaAnunciadaIA.nombre} impactó`);
              outcome = {
                titulo: "❌ Control Incorrecto",
                detalle: `La IA atacó con ${cartaAnunciadaIA.nombre}. El control correcto era ${cartaContra?.nombre ?? "otro"}, pero jugaste ${carta.nombre}, así que el ataque impactó de lleno.`,
                exito: false,
                tipo: "ATAQUE",
                impacto: "-1 ♥ Vida"
              };
              setPuntajeIA((prev) => Math.min(100, prev + 10));
            }
          } else {
            outcome = esJugador1
              ? aplicarCarta(carta, ia, setIa, jugador, setJugador, false)
              : aplicarCarta(carta, jugador, setJugador, ia, setIa, false);
          }

          setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true, resultado: outcome } : null));

          // 5. PASO 4: Se mantiene la carta y el panel explicativo visibles por 10000ms para que se alcance a leer cómodamente
          const advance = () => {
            setActivePlayedCard(null);

            if (esJugador1) {
              if (esRondaFacil) {
                // En FACIL cada ronda la resuelve el jugador de una vez: se limpia la mano
                // (se regenera junto a la próxima carta anunciada) y se sigue en su turno.
                setManoJugador([]);
                setCartaAnunciadaIA(null);
                setCartasMesaIA((prevMesaIA) => Math.max(0, prevMesaIA - 1));
                checkNuevaRonda(Math.max(0, cartasMesaJugador - 1), Math.max(0, cartasMesaIA - 1));
              } else {
                setManoJugador((prev) => (prev.length === 0 ? repartirTresCartas() : prev));
                checkNuevaRonda(cartasMesaJugador - 1, cartasMesaIA);
                setTurnoJugador(false);
              }
            } else {
              setManoJugador2((prev) => (prev.length === 0 ? repartirTresCartas() : prev));
              checkNuevaRonda(cartasMesaJugador, cartasMesaIA - 1);
              setTurnoJugador(true);
            }
          };

          pendingTurnAdvanceRef.current = advance;
          turnAdvanceTimerRef.current = setTimeout(() => {
            if (pendingTurnAdvanceRef.current === advance) {
              advance();
              pendingTurnAdvanceRef.current = null;
            }
          }, 10000); // 10 segundos de visibilidad
        }, 550);
      }, 350);
    }, 200);
  };

  // AI Turn effect: ejecutarTurnoIA() with 3D Flip Reveal and clear reading time
  useEffect(() => {
    if (screen !== "JUEGO") return;
    if (online || modoDosJugadores || turnoJugador) return;
    // En FACIL cada ronda se resuelve por completo cuando el jugador juega su carta
    // (ver handleJugarCarta), así que la IA no tiene un turno propio aparte.
    if (dificultad === "FACIL") return;
    if (jugador.vida <= 0 || ia.vida <= 0) return;
    if (activePlayedCard) return;

    // Pausa de 1600ms antes de que la IA juegue para que el jugador pueda asimilar la acción anterior
    const timer = setTimeout(() => {
      // Pick AI card based on difficulty (from Java ejecutarTurnoIA)
      let cartaElegida: Card;

      if (dificultad === "DIFICIL") {
        if (ia.vida <= 2 && exito(70)) {
          const defensas = MAZO_BASE.filter((c) => c.tipo === "DEFENSA");
          cartaElegida = defensas[Math.floor(Math.random() * defensas.length)];
        } else if (jugador.vida <= 2 && exito(50)) {
          const fuertes = MAZO_BASE.filter((c) => c.nombre === "Jolly Ataque" || c.nombre === "DDoS");
          cartaElegida = fuertes[Math.floor(Math.random() * fuertes.length)];
        } else if (exito(70)) {
          const ataques = MAZO_BASE.filter((c) => c.tipo === "ATAQUE");
          cartaElegida = ataques[Math.floor(Math.random() * ataques.length)];
        } else {
          cartaElegida = MAZO_BASE[Math.floor(Math.random() * MAZO_BASE.length)];
        }
      } else {
        // NORMAL
        if (ia.vida <= 1) {
          cartaElegida = MAZO_BASE.find((c) => c.nombre === "2FA") || MAZO_BASE[0];
        } else if (jugador.vida <= 1) {
          cartaElegida = MAZO_BASE.find((c) => c.nombre === "DDoS") || MAZO_BASE[0];
        } else {
          cartaElegida = MAZO_BASE[Math.floor(Math.random() * MAZO_BASE.length)];
        }
      }

      playCardPlaySound();
      const nuevoMesaIA = Math.max(0, cartasMesaIA - 1);
      setCartasMesaIA(nuevoMesaIA);

      // PASO 1: IA pone la carta en la mesa boca abajo (dorso)
      setActivePlayedCard({
        card: cartaElegida,
        playedBy: "IA",
        isFlipped: false
      });

      // PASO 2: A los 450ms se voltea mostrando la carta lanzada con su imagen real
      setTimeout(() => {
        playCardFlipSound();
        setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true } : null));

        // PASO 3: A los 550ms se aplica el efecto sobre el jugador y se muestra el mensaje
        setTimeout(() => {
          const outcome = aplicarCarta(cartaElegida, jugador, setJugador, ia, setIa, true);
          setActivePlayedCard((prev) => (prev ? { ...prev, isFlipped: true, resultado: outcome } : null));

          // PASO 4: Mantener la carta y el mensaje explicativo visibles durante 10000ms para que se pueda leer todo con tranquilidad
          const advanceIA = () => {
            setActivePlayedCard(null);
            checkNuevaRonda(cartasMesaJugador, nuevoMesaIA);
            setTurnoJugador(true);
          };

          pendingTurnAdvanceRef.current = advanceIA;
          turnAdvanceTimerRef.current = setTimeout(() => {
            if (pendingTurnAdvanceRef.current === advanceIA) {
              advanceIA();
              pendingTurnAdvanceRef.current = null;
            }
          }, 10000); // 10 segundos de visibilidad
        }, 550);
      }, 450);
    }, 1600);

    return () => clearTimeout(timer);
  }, [screen, modoDosJugadores, turnoJugador, jugador.vida, ia.vida, activePlayedCard, dificultad, cartasMesaJugador, cartasMesaIA, cartaAnunciadaIA]);

  // Modo FACIL: anuncia con antelación qué carta jugará la IA en su próximo turno, y arma
  // la mano de 3 cartas del jugador garantizando que el control correcto esté presente.
  useEffect(() => {
    if (screen !== "JUEGO" || online || modoDosJugadores) return;
    if (dificultad !== "FACIL") return;
    if (!turnoJugador) return; // solo se anuncia mientras el jugador está decidiendo
    if (activePlayedCard) return;
    if (cartaAnunciadaIA) return; // ya hay una anunciada para esta ronda

    const idx = Math.floor(Math.random() * ATAQUES_FACIL.length);
    const cartaBase = MAZO_BASE.find((c) => c.id === ATAQUES_FACIL[idx]) ?? MAZO_BASE[0];
    // OJO: se guarda con su id original (sin sufijo), porque CONTRA_DE_ATAQUE y toda la
    // lógica de acierto/error buscan la carta por ese id exacto ("phishing", "malware", etc.).
    setCartaAnunciadaIA(cartaBase);
    setManoJugador(construirManoConContra(cartaBase));
  }, [screen, online, modoDosJugadores, dificultad, turnoJugador, activePlayedCard, cartaAnunciadaIA]);

  // Check Game Over: comprobarFinJuego()
  useEffect(() => {
    if (screen !== "JUEGO" || online) return; // en línea el final lo manda el servidor (game:over)

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

    if (jugador.vida <= 0) {
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
  }, [jugador.vida, ia.vida, screen, modoDosJugadores, dificultad, jugador.nombre, ia.nombre, puntajeJugador, puntajeIA]);

  // Current active hand to display
  const manoActual = modoDosJugadores
    ? turnoJugador
      ? manoJugador
      : manoJugador2
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

        {/* Salir de la sala (solo en partida en línea) */}
        {online && screen === "JUEGO" && (
          <button
            onClick={() => {
              if (window.confirm("¿Salir de la partida en línea? Tu rival será notificado.")) {
                playButtonClick();
                salirDeSala();
                setScreen("INICIO");
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-b from-[#1c1f2b] to-[#12141d] hover:from-[#252a3a] hover:to-[#181b26] border border-rose-400/50 hover:border-rose-300 text-rose-200 cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.5)] active:scale-95 transition-all"
            title="Salir de la sala"
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
                    ? turnoJugador
                      ? "Tu turno"
                      : "Turno del rival"
                    : modoDosJugadores
                    ? turnoJugador
                      ? "Turno: JUGADOR 1"
                      : "Turno: JUGADOR 2"
                    : turnoJugador
                    ? "Turno: JUGADOR"
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
                if (!turnoJugador) return;
                // Juega la carta que se arrastró (si no se puede saber cuál, la primera)
                const idArrastrada = e?.dataTransfer?.getData("text/plain");
                const carta = manoActual.find((c) => c.id === idArrastrada) ?? manoActual[0];
                if (carta) handleJugarCarta(carta);
              }}
            />

            {/* Modo FACIL: aviso de qué carta jugará la IA a continuación, para elegir con qué responder */}
            {dificultad === "FACIL" && !modoDosJugadores && !online && turnoJugador && !activePlayedCard && cartaAnunciadaIA && (
              <div
                className="absolute left-1/2 top-[30%] -translate-x-1/2 z-[35] px-4 py-2 rounded-2xl bg-emerald-950/90 border border-emerald-400/60 text-emerald-200 text-xs sm:text-sm font-bold text-center pointer-events-none shadow-[0_6px_20px_rgba(0,0,0,0.7)]"
                style={{ maxWidth: "calc(var(--vw) * 90)" }}
              >
                🤖 La IA jugará: {cartaAnunciadaIA.nombre} ({cartaAnunciadaIA.objetivo}) — ¡elige tu carta!
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
                onContinue={handleContinuarTurno}
                esperando={online && yaContinue}
                autoCloseDuration={10000}
              />
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
                        ? !turnoJugador || !!activePlayedCard
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
