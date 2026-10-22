import type { Server, Socket } from "socket.io";
import { repartirManosDuelo } from "../src/utils/gameData";
import { resolverDuelo } from "../src/utils/encuentro";
import type {
  Card,
  PlayerEntity,
  OnlineAck,
  OnlineChoicePayload,
  OnlineClashPayload,
  OnlineCloseReason,
  OnlineOutcome,
  OnlineRole,
  OnlineSnapshot,
  OnlineSyncPayload,
  OnlineTurnPayload
} from "../src/types";

/**
 * Salas de juego en línea para Security Jollys.
 *
 * El SERVIDOR es la autoridad: reparte las cartas, tira los dados de
 * probabilidad y aplica los efectos. Los clientes solo piden "jugar la carta X"
 * y reciben el resultado. Así nadie puede ver la mano del rival ni hacer trampa.
 *
 * DUELO: en cada ronda un jugador es el ATACANTE (3 ataques) y el otro el DEFENSOR (3 defensas);
 * los roles se alternan. El atacante elige en secreto y el servidor anuncia al defensor 2 cartas
 * (la real y un señuelo). Cuando el defensor elige, se descubren las dos cartas y se resuelve
 * (ver resolverDuelo en utils/encuentro.ts).
 *
 * Las salas viven en memoria (se pierden si reinicias el servidor).
 */

type Seat = 0 | 1;

// Sin 0/O/1/I/L para que el código sea fácil de dictar y teclear.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

// Tiempo que se muestra la carta jugada antes de pasar el turno (el cliente
// muestra 10 s de cuenta atrás desde que se voltea la carta).
const REVEAL_MS = 11_000;
// Tiempo que se espera a que alguien desconectado vuelva antes de cerrar la sala.
const GRACE_WAITING_MS = 10 * 60_000; // el anfitrión puede irse a WhatsApp a mandar el código
const GRACE_PLAYING_MS = 2 * 60_000;

const NOMBRES = ["Empresa A", "Empresa B"] as const;

interface Slot {
  playerId: string;
  socketId: string | null;
  entity: PlayerEntity;
  hand: Card[];
  mesa: number;
  choiceId: string | null; // carta elegida en secreto esta ronda
  continued: boolean;
  dropTimer: NodeJS.Timeout | null;
}

// Encuentro ya resuelto, a la espera de que ambos pulsen "Continuar"
interface Pending {
  cards: [Card, Card]; // carta del asiento 0 y del asiento 1
  outcomes: [OnlineOutcome, OnlineOutcome];
  winner: Seat | "empate" | null;
}

interface Room {
  code: string;
  slots: Slot[]; // 1 (esperando) o 2 (jugando)
  phase: "waiting" | "playing" | "over";
  pending: Pending | null;
  attacker: Seat; // quién ataca esta ronda (el otro defiende)
  announced: Card[]; // las 2 cartas anunciadas al defensor (la real y un señuelo)
  advanceTimer: NodeJS.Timeout | null;
  winner: Seat | "empate" | null;
}

const otro = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** Reparte la ronda: el atacante recibe 3 ataques y el defensor 3 defensas. */
function repartirRonda(room: Room) {
  const m = repartirManosDuelo();
  room.slots[room.attacker].hand = m.ataque;
  room.slots[otro(room.attacker)].hand = m.defensa;
  room.announced = [];
}

function nuevaEntidad(seat: Seat): PlayerEntity {
  return {
    nombre: NOMBRES[seat],
    vida: 3,
    confidencialidad: true,
    integridad: true,
    disponibilidad: true
  };
}

function nuevoSlot(playerId: string, socketId: string, seat: Seat): Slot {
  return {
    playerId,
    socketId,
    entity: nuevaEntidad(seat),
    hand: [],
    mesa: 3,
    choiceId: null,
    continued: false,
    dropTimer: null
  };
}

// ---------------------------------------------------------------------------
// Manejo de salas y sockets
// ---------------------------------------------------------------------------

export function registerRoomHandlers(io: Server) {
  const rooms = new Map<string, Room>();
  const roomByPlayer = new Map<string, string>(); // playerId -> código

  const generarCodigo = (): string => {
    for (let intento = 0; intento < 50; intento++) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
    throw new Error("No se pudo generar un código de sala libre");
  };

  const normalizarCodigo = (raw: unknown): string =>
    typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";

  const validarPlayerId = (raw: unknown): string | null =>
    typeof raw === "string" && raw.length >= 8 && raw.length <= 64 ? raw : null;

  const emitToSeat = (room: Room, seat: Seat, event: string, payload: unknown) => {
    const sid = room.slots[seat]?.socketId;
    if (sid) io.to(sid).emit(event, payload);
  };

  const rivalConectado = (room: Room, seat: Seat): boolean => {
    const rival = room.slots[otro(seat)];
    return !!rival && !!rival.socketId;
  };

  const notificarRival = (room: Room) => {
    room.slots.forEach((_, seat) => {
      emitToSeat(room, seat as Seat, "room:rival", {
        connected: rivalConectado(room, seat as Seat)
      });
    });
  };

  const rolDe = (room: Room, seat: Seat): OnlineRole => (room.attacker === seat ? "attacker" : "defender");

  // El defensor solo puede elegir cuando el atacante ya eligió; el atacante elige primero.
  const puedoElegir = (room: Room, seat: Seat): boolean => {
    if (room.phase !== "playing" || room.pending || room.slots[seat].choiceId !== null) return false;
    return room.attacker === seat || room.slots[room.attacker].choiceId !== null;
  };

  // Solo el defensor ve las 2 cartas anunciadas (y solo después de que el atacante eligió)
  const anunciadasPara = (room: Room, seat: Seat): Card[] =>
    room.attacker !== seat && room.slots[room.attacker].choiceId !== null
      ? room.announced.map((c) => ({ ...c }))
      : [];

  const choicePayload = (room: Room, seat: Seat): OnlineChoicePayload => ({
    myChoiceId: room.slots[seat].choiceId,
    rivalChose: room.slots[otro(seat)].choiceId !== null,
    myTurn: puedoElegir(room, seat),
    role: rolDe(room, seat),
    announced: anunciadasPara(room, seat)
  });

  const snapshotFor = (room: Room, seat: Seat): OnlineSnapshot => {
    const yo = room.slots[seat];
    const rival = room.slots[otro(seat)];
    const pend = room.pending;
    const op = otro(seat);
    return {
      code: room.code,
      seat,
      phase: room.phase === "over" ? "over" : "playing",
      me: { ...yo.entity },
      rival: { ...rival.entity },
      meMesa: yo.mesa,
      rivalMesa: rival.mesa,
      hand: yo.hand.map((c) => ({ ...c })),
      myTurn: puedoElegir(room, seat),
      role: rolDe(room, seat),
      announced: anunciadasPara(room, seat),
      rivalConnected: !!rival.socketId,
      pending: pend
        ? {
            mine: pend.cards[seat],
            rival: pend.cards[op],
            outcomeMine: pend.outcomes[seat],
            outcomeRival: pend.outcomes[op]
          }
        : null,
      myChoiceId: yo.choiceId,
      rivalChose: rival.choiceId !== null,
      waitingContinue: yo.continued,
      result:
        room.phase === "over" && room.winner !== null
          ? room.winner === "empate"
            ? "draw"
            : room.winner === seat
            ? "win"
            : "lose"
          : null
    };
  };

  const enviarSync = (room: Room, seat: Seat, resumed: boolean) => {
    const payload: OnlineSyncPayload = { snapshot: snapshotFor(room, seat), resumed };
    emitToSeat(room, seat, "game:sync", payload);
  };

  const destruirSala = (room: Room, reason: OnlineCloseReason, exceptPlayerId?: string) => {
    if (room.advanceTimer) clearTimeout(room.advanceTimer);
    for (const slot of room.slots) {
      if (slot.dropTimer) clearTimeout(slot.dropTimer);
      if (roomByPlayer.get(slot.playerId) === room.code) roomByPlayer.delete(slot.playerId);
      if (slot.socketId) {
        if (slot.playerId !== exceptPlayerId) io.to(slot.socketId).emit("room:closed", { reason });
        const s = io.sockets.sockets.get(slot.socketId);
        if (s) {
          s.leave(room.code);
          s.data.code = undefined;
        }
      }
    }
    rooms.delete(room.code);
  };

  const salirDeSalaActual = (playerId: string) => {
    const code = roomByPlayer.get(playerId);
    const room = code ? rooms.get(code) : undefined;
    if (room) destruirSala(room, "rival_left", playerId);
    roomByPlayer.delete(playerId);
  };

  /** Asocia un socket con un asiento de la sala (crear, unirse o reconectar). */
  const enlazarSocket = (room: Room, seat: Seat, socket: Socket) => {
    const slot = room.slots[seat];
    if (slot.dropTimer) {
      clearTimeout(slot.dropTimer);
      slot.dropTimer = null;
    }
    // Si el mismo jugador abrió otra pestaña, la anterior pierde el asiento.
    if (slot.socketId && slot.socketId !== socket.id) {
      const vieja = io.sockets.sockets.get(slot.socketId);
      if (vieja) {
        vieja.emit("room:closed", { reason: "takeover" as OnlineCloseReason });
        vieja.leave(room.code);
        vieja.data.code = undefined;
      }
    }
    slot.socketId = socket.id;
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.playerId = slot.playerId;
    roomByPlayer.set(slot.playerId, room.code);
  };

  const avanzarRonda = (room: Room) => {
    const pend = room.pending;
    if (!pend) return;
    if (room.advanceTimer) {
      clearTimeout(room.advanceTimer);
      room.advanceTimer = null;
    }
    room.pending = null;
    room.slots.forEach((s) => {
      s.continued = false;
      s.choiceId = null;
    });

    if (pend.winner !== null) {
      room.phase = "over";
      room.winner = pend.winner;
      room.slots.forEach((_, seat) => {
        emitToSeat(room, seat as Seat, "game:over", {
          result: pend.winner === "empate" ? "draw" : pend.winner === seat ? "win" : "lose",
          snapshot: snapshotFor(room, seat as Seat)
        });
      });
      return;
    }

    // Se invierten los roles y se reparte la nueva ronda (3 ataques / 3 defensas)
    room.attacker = otro(room.attacker);
    repartirRonda(room);

    // Nueva ronda: cuando las 6 cartas de la mesa ya se jugaron.
    let newRound = false;
    if (room.slots.every((s) => s.mesa <= 0)) {
      room.slots.forEach((s) => (s.mesa = 3));
      newRound = true;
    }

    room.slots.forEach((_, seat) => {
      const payload: OnlineTurnPayload = { snapshot: snapshotFor(room, seat as Seat), newRound };
      emitToSeat(room, seat as Seat, "game:turn", payload);
    });
  };

  const error = (socket: Socket, message: string) => socket.emit("game:error", { message });

  io.on("connection", (socket: Socket) => {
    const responder = (ack: unknown, res: OnlineAck) => {
      if (typeof ack === "function") (ack as (r: OnlineAck) => void)(res);
    };

    // ---------------------------------------------------------------- crear
    socket.on("room:create", (data: { playerId?: string } | undefined, ack?: unknown) => {
      const playerId = validarPlayerId(data?.playerId);
      if (!playerId) {
        return responder(ack, { ok: false, error: "ID_INVALIDO", message: "Identificador de jugador inválido." });
      }
      salirDeSalaActual(playerId);
      const room: Room = {
        code: generarCodigo(),
        slots: [nuevoSlot(playerId, socket.id, 0)],
        phase: "waiting",
        pending: null,
        attacker: 0,
        announced: [],
        advanceTimer: null,
        winner: null
      };
      rooms.set(room.code, room);
      enlazarSocket(room, 0, socket);
      responder(ack, { ok: true, code: room.code, seat: 0, phase: "waiting" });
    });

    // --------------------------------------------------------------- unirse
    socket.on("room:join", (data: { playerId?: string; code?: string } | undefined, ack?: unknown) => {
      const playerId = validarPlayerId(data?.playerId);
      const code = normalizarCodigo(data?.code);
      if (!playerId) {
        return responder(ack, { ok: false, error: "ID_INVALIDO", message: "Identificador de jugador inválido." });
      }
      if (code.length !== CODE_LENGTH) {
        return responder(ack, {
          ok: false,
          error: "CODIGO_INVALIDO",
          message: `El código tiene ${CODE_LENGTH} caracteres.`
        });
      }
      const room = rooms.get(code);
      if (!room) {
        return responder(ack, {
          ok: false,
          error: "NO_EXISTE",
          message: "No existe una sala con ese código. Revisa que esté bien escrito."
        });
      }

      // ¿Ya es parte de esa sala? (por ejemplo, abre su propio enlace)
      const seatExistente = room.slots.findIndex((s) => s.playerId === playerId);
      if (seatExistente >= 0) {
        enlazarSocket(room, seatExistente as Seat, socket);
        responder(ack, { ok: true, code, seat: seatExistente as Seat, phase: room.phase });
        if (room.phase !== "waiting") enviarSync(room, seatExistente as Seat, true);
        notificarRival(room);
        return;
      }

      if (room.slots.length >= 2) {
        return responder(ack, {
          ok: false,
          error: "LLENA",
          message: "Esa sala ya tiene dos jugadores."
        });
      }

      // Si tenía otra sala (p. ej. la que se creó al abrir el lobby), se cierra.
      salirDeSalaActual(playerId);

      room.slots.push(nuevoSlot(playerId, socket.id, 1));
      enlazarSocket(room, 1, socket);
      room.phase = "playing";
      room.attacker = 0; // empieza atacando el anfitrión
      repartirRonda(room);

      responder(ack, { ok: true, code, seat: 1, phase: "playing" });
      enviarSync(room, 0, false);
      enviarSync(room, 1, false);
    });

    // ------------------------------------------------------------ reconectar
    socket.on("room:rejoin", (data: { playerId?: string; code?: string } | undefined, ack?: unknown) => {
      const playerId = validarPlayerId(data?.playerId);
      const code = normalizarCodigo(data?.code);
      const room = code ? rooms.get(code) : undefined;
      const seat = room && playerId ? room.slots.findIndex((s) => s.playerId === playerId) : -1;
      if (!room || seat < 0) {
        return responder(ack, {
          ok: false,
          error: "NO_EXISTE",
          message: "La sala ya no existe."
        });
      }
      enlazarSocket(room, seat as Seat, socket);
      responder(ack, { ok: true, code, seat: seat as Seat, phase: room.phase });
      if (room.phase !== "waiting") enviarSync(room, seat as Seat, true);
      notificarRival(room);
    });

    // ---------------------------------------------------------------- salir
    socket.on("room:leave", (_data?: unknown, ack?: unknown) => {
      const playerId = socket.data.playerId as string | undefined;
      if (playerId) salirDeSalaActual(playerId);
      socket.data.code = undefined;
      if (typeof ack === "function") (ack as () => void)();
    });

    // ---------------------------------------------------------- elegir carta
    // El ATACANTE elige primero (en secreto); se anuncian 2 cartas al defensor, que elige después.
    socket.on("game:play", (data: { cardId?: string } | undefined) => {
      const room = rooms.get(socket.data.code as string);
      if (!room) return error(socket, "La sala ya no existe.");
      const seatIdx = room.slots.findIndex((s) => s.socketId === socket.id);
      if (seatIdx < 0) return error(socket, "No formas parte de esta partida.");
      const seat = seatIdx as Seat;
      if (room.phase !== "playing") return error(socket, "La partida no está en curso.");
      if (room.pending) return error(socket, "Espera a que termine el encuentro anterior.");
      if (room.slots.some((s) => !s.socketId)) {
        return error(socket, "Tu rival está desconectado. Espera a que vuelva.");
      }

      const yo = room.slots[seat];
      const esAtacante = room.attacker === seat;
      if (yo.choiceId !== null) return error(socket, "Ya elegiste tu carta. Espera al rival.");
      if (!esAtacante && room.slots[room.attacker].choiceId === null) {
        return error(socket, "Espera a que el atacante elija su ataque.");
      }
      const card = yo.hand.find((c) => c.id === data?.cardId);
      if (!card) return error(socket, "Esa carta no está en tu mano.");

      yo.choiceId = card.id;

      if (esAtacante) {
        // Se anuncian 2 cartas al defensor: la real y un señuelo de la mano del atacante (orden aleatorio)
        const otras = yo.hand.filter((c) => c.id !== card.id);
        const senuelo = otras[Math.floor(Math.random() * otras.length)];
        room.announced = senuelo ? (Math.random() < 0.5 ? [card, senuelo] : [senuelo, card]) : [card];
        room.slots.forEach((_, s) => emitToSeat(room, s as Seat, "game:choice", choicePayload(room, s as Seat)));
        return;
      }

      // Eligió el defensor: las cartas salen de la mano y se resuelve el duelo
      const atk = room.slots[room.attacker];
      const cartaAtaque = atk.hand.find((c) => c.id === atk.choiceId) as Card;
      const cards: [Card, Card] = room.attacker === 0 ? [cartaAtaque, card] : [card, cartaAtaque];
      room.slots.forEach((sl) => {
        sl.hand = sl.hand.filter((c) => c.id !== sl.choiceId);
        sl.mesa = Math.max(0, sl.mesa - 1);
      });

      const res = resolverDuelo(cartaAtaque, card, atk.entity, yo.entity);
      atk.entity = res.atacante;
      yo.entity = res.defensor;
      const outcomes: [OnlineOutcome, OnlineOutcome] =
        room.attacker === 0
          ? [res.outcomeAtacante, res.outcomeDefensor]
          : [res.outcomeDefensor, res.outcomeAtacante];
      const winner: Seat | null = res.ganador === null ? null : res.ganador === "atacante" ? room.attacker : seat;
      room.pending = { cards, outcomes, winner };
      room.announced = [];
      room.slots.forEach((sl) => (sl.continued = false));

      room.slots.forEach((_, s) => {
        const me = room.slots[s];
        const rv = room.slots[otro(s as Seat)];
        const payload: OnlineClashPayload = {
          role: rolDe(room, s as Seat),
          mine: cards[s],
          rival: cards[otro(s as Seat)],
          outcomeMine: room.pending!.outcomes[s],
          outcomeRival: room.pending!.outcomes[otro(s as Seat)],
          state: {
            me: { ...me.entity },
            rival: { ...rv.entity },
            meMesa: me.mesa,
            rivalMesa: rv.mesa,
            hand: me.hand.map((c) => ({ ...c }))
          }
        };
        emitToSeat(room, s as Seat, "game:clash", payload);
      });

      room.advanceTimer = setTimeout(() => avanzarRonda(room), REVEAL_MS);
    });

    // -------------------------------------------------------------- continuar
    socket.on("game:continue", () => {
      const room = rooms.get(socket.data.code as string);
      if (!room || !room.pending) return;
      const slot = room.slots.find((s) => s.socketId === socket.id);
      if (!slot) return;
      slot.continued = true;
      // Avanza cuando todos los CONECTADOS ya pulsaron continuar.
      if (room.slots.every((s) => s.continued || !s.socketId)) avanzarRonda(room);
    });

    // ------------------------------------------------------------ desconexión
    socket.on("disconnect", () => {
      const room = rooms.get(socket.data.code as string);
      if (!room) return;
      const seat = room.slots.findIndex((s) => s.socketId === socket.id);
      if (seat < 0) return; // este socket ya fue reemplazado por otro
      const slot = room.slots[seat];
      slot.socketId = null;
      notificarRival(room);
      // Si estaban esperando "Continuar" solo de este jugador, se libera.
      if (room.pending && room.slots.every((s) => s.continued || !s.socketId)) {
        avanzarRonda(room);
      }
      slot.dropTimer = setTimeout(
        () => destruirSala(room, "rival_left"),
        room.phase === "waiting" ? GRACE_WAITING_MS : GRACE_PLAYING_MS
      );
    });
  });
}
