export type CardType = "ATAQUE" | "DEFENSA" | "JOLLY";

export type Dificultad = "FACIL" | "NORMAL" | "DIFICIL";

export type ScreenState = "INICIO" | "MODO" | "DIFICULTAD" | "LOBBY" | "JUEGO" | "FIN";

export interface Card {
  id: string;
  tipo: CardType;
  nombre: string;
  subtitulo: string;
  descripcion: string;
  objetivo: string;
  probBase: number;
  rango: string; // ej: "J ♦", "K ♠", "Q ♣", "★ JOLLY"
  suitSymbol: string;
  suitColor: string;
  rutaImagen?: string;
}

export interface CardActionOutcome {
  titulo: string;
  detalle: string;
  exito: boolean;
  tipo: CardType;
  impacto?: string;
}

// Un lado del "encuentro": la carta que puso un jugador y lo que le pasó
export interface LadoEncuentro {
  card: Card;
  playedBy: string;
  resultado?: CardActionOutcome;
}

// Cartas en la mesa. Siempre se muestran las DOS cartas que se encuentran:
// `card` es la del lado izquierdo (tú / jugador 1) y `segunda` la del derecho (IA / rival / jugador 2).
// `resultado` es un resultado compartido (modos 1 jugador); en 2 jugadores cada lado trae el suyo.
export interface ActivePlayedCardState {
  card: Card;
  playedBy: string;
  isFlipped: boolean;
  resultado?: CardActionOutcome;
  segunda?: LadoEncuentro;
}

export interface PlayerEntity {
  nombre: string;
  vida: number; // 0 to 3
  confidencialidad: boolean;
  integridad: boolean;
  disponibilidad: boolean;
}

export interface GameLogEntry {
  id: string;
  texto: string;
  tipo: "ataque-exito" | "ataque-fallo" | "defensa" | "jolly" | "ronda" | "info";
  timestamp: string;
}

export interface ServerHealthResponse {
  status: string;
  port: number;
  game: string;
  framework: string;
  environment: string;
  timestamp: string;
  vscodeGuide: {
    command: string;
    defaultPort: number;
    url: string;
  };
}

// ---------------------------------------------------------------------------
// MODO EN LÍNEA (2 jugadores desde dispositivos distintos)
// Estos tipos se comparten entre el servidor (server/rooms.ts) y el cliente.
// ---------------------------------------------------------------------------

export type OnlineFx = "jolly" | "hit" | "miss" | "defensa";

export interface OnlineOutcome extends CardActionOutcome {
  mensaje: string; // texto corto para el mensaje central
  fx: OnlineFx[]; // sonidos que debe reproducir el cliente
}

// DUELO en línea: en cada ronda un jugador ATACA y el otro DEFIENDE (se alternan)
export type OnlineRole = "attacker" | "defender";

export interface OnlineSnapshot {
  code: string;
  seat: 0 | 1;
  phase: "playing" | "over";
  me: PlayerEntity; // siempre "yo"
  rival: PlayerEntity; // siempre "el otro"
  meMesa: number;
  rivalMesa: number;
  hand: Card[]; // solo mi mano (la del rival nunca sale del servidor)
  myTurn: boolean; // true = puedo elegir carta ahora mismo
  role: OnlineRole; // mi rol en esta ronda
  announced: Card[]; // solo para el defensor: las 2 cartas anunciadas (la real y un señuelo)
  rivalConnected: boolean;
  // Encuentro ya resuelto: mi carta, la del rival y lo que hizo cada una
  pending: null | { mine: Card; rival: Card; outcomeMine: OnlineOutcome; outcomeRival: OnlineOutcome };
  myChoiceId: string | null; // carta que ya elegí (el rival no la ve hasta el encuentro)
  rivalChose: boolean; // el rival ya eligió (sin saber cuál)
  waitingContinue: boolean; // ya pulsé "Continuar" y espero al rival
  result: "win" | "lose" | "draw" | null;
}

export interface OnlineSyncPayload {
  snapshot: OnlineSnapshot;
  resumed: boolean; // false = la partida acaba de empezar
}

// Alguien (yo o el rival) eligió carta; las cartas siguen ocultas hasta que ambos elijan
export interface OnlineChoicePayload {
  myChoiceId: string | null;
  rivalChose: boolean;
  myTurn: boolean;
  role: OnlineRole;
  announced: Card[]; // solo el defensor recibe las 2 cartas anunciadas
}

// Ambos eligieron: las dos cartas se encuentran y se conoce el resultado de cada una
export interface OnlineClashPayload {
  role: OnlineRole; // mi rol en este encuentro
  mine: Card;
  rival: Card;
  outcomeMine: OnlineOutcome;
  outcomeRival: OnlineOutcome;
  state: {
    me: PlayerEntity;
    rival: PlayerEntity;
    meMesa: number;
    rivalMesa: number;
    hand: Card[];
  };
}

export interface OnlineTurnPayload {
  snapshot: OnlineSnapshot;
  newRound: boolean;
}

export type OnlineCloseReason = "rival_left" | "takeover";

// ok=true  -> code, seat y phase vienen llenos
// ok=false -> error (código) y message (texto para mostrar) vienen llenos
export interface OnlineAck {
  ok: boolean;
  code?: string;
  seat?: 0 | 1;
  phase?: "waiting" | "playing" | "over";
  error?: string;
  message?: string;
}
