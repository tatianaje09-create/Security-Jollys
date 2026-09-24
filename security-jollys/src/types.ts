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

export interface ActivePlayedCardState {
  card: Card;
  playedBy: string;
  isFlipped: boolean;
  resultado?: CardActionOutcome;
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

export interface OnlineSnapshot {
  code: string;
  seat: 0 | 1;
  phase: "playing" | "over";
  me: PlayerEntity; // siempre "yo"
  rival: PlayerEntity; // siempre "el otro"
  meMesa: number;
  rivalMesa: number;
  hand: Card[]; // solo mi mano (la del rival nunca sale del servidor)
  myTurn: boolean;
  rivalConnected: boolean;
  pending: null | { card: Card; playedByMe: boolean; outcome: OnlineOutcome };
  waitingContinue: boolean; // ya pulsé "Continuar" y espero al rival
  result: "win" | "lose" | null;
}

export interface OnlineSyncPayload {
  snapshot: OnlineSnapshot;
  resumed: boolean; // false = la partida acaba de empezar
}

export interface OnlinePlayedPayload {
  card: Card;
  playedByMe: boolean;
  outcome: OnlineOutcome;
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
