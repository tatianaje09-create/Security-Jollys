import type { Server, Socket } from "socket.io";
import { repartirTresCartas } from "../src/utils/gameData";
import type {
  Card,
  PlayerEntity,
  OnlineAck,
  OnlineCloseReason,
  OnlineFx,
  OnlineOutcome,
  OnlinePlayedPayload,
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
 * Las salas viven en memoria (se pierden si reinicias el servidor).
 */

type Seat = 0 | 1;
type Campo = "confidencialidad" | "integridad" | "disponibilidad";

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
  continued: boolean;
  dropTimer: NodeJS.Timeout | null;
}

interface Pending {
  seat: Seat;
  card: Card;
  outcome: OnlineOutcome;
  winner: Seat | null;
}

interface Room {
  code: string;
  slots: Slot[]; // 1 (esperando) o 2 (jugando)
  phase: "waiting" | "playing" | "over";
  turn: Seat;
  pending: Pending | null;
  advanceTimer: NodeJS.Timeout | null;
  winner: Seat | null;
}

const exito = (probabilidad: number): boolean => Math.random() * 100 < probabilidad;
const otro = (s: Seat): Seat => (s === 0 ? 1 : 0);

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
    continued: false,
    dropTimer: null
  };
}

// ---------------------------------------------------------------------------
// Efectos de las cartas (equivalente a aplicarCarta del modo local)
// ---------------------------------------------------------------------------

interface DefAtaque {
  prob: number;
  campo: Campo;
  mensaje: string;
  ok: { titulo: string; detalle: (objetivo: string) => string };
  fail: { titulo: string; detalle: (objetivo: string) => string };
}

const ATAQUES: Record<string, DefAtaque> = {
  Phishing: {
    prob: 60,
    campo: "confidencialidad",
    mensaje: "📧 Phishing exitoso: Confidencialidad comprometida",
    ok: {
      titulo: "📧 Phishing Exitoso",
      detalle: (o) =>
        `Ataque de ingeniería social efectivo. La Confidencialidad de ${o} fue vulnerada y perdió 1 vida.`
    },
    fail: {
      titulo: "🛡 Phishing Bloqueado",
      detalle: (o) => `${o} detectó el engaño y protegió sus credenciales sin sufrir daño.`
    }
  },
  DDoS: {
    prob: 70,
    campo: "disponibilidad",
    mensaje: "🌐 DDoS exitoso: Disponibilidad caída",
    ok: {
      titulo: "🌐 Ataque DDoS Exitoso",
      detalle: (o) =>
        `Inundación masiva de peticiones saturó el servidor. La Disponibilidad de ${o} cayó y perdió 1 vida.`
    },
    fail: {
      titulo: "🛡 DDoS Mitigado",
      detalle: (o) => `Los sistemas de balanceo de ${o} mitigaron la sobrecarga de tráfico.`
    }
  },
  Malware: {
    prob: 65,
    campo: "integridad",
    mensaje: "🦠 Malware exitoso: Integridad comprometida",
    ok: {
      titulo: "🦠 Infección de Malware Exitosa",
      detalle: (o) =>
        `Binario malicioso ejecutado. La Integridad de los archivos de ${o} fue alterada y perdió 1 vida.`
    },
    fail: {
      titulo: "🛡 Malware Neutralizado",
      detalle: (o) => `El sistema antivirus y EDR de ${o} interceptó el código hostil a tiempo.`
    }
  }
};

interface DefDefensa {
  campo: Campo;
  mensaje: string;
  titulo: string;
  detalle: (propio: string) => string;
}

const DEFENSAS: Record<string, DefDefensa> = {
  Antivirus: {
    campo: "confidencialidad",
    mensaje: "🛡 Defensa aplicada: Antivirus",
    titulo: "🛡 Antivirus Activo",
    detalle: (p) =>
      `${p} detectó y eliminó el software malicioso de sus equipos, restaurando Confidencialidad (+1 ♥).`
  },
  "2FA": {
    campo: "integridad",
    mensaje: "🛡 Defensa aplicada: 2FA",
    titulo: "🔐 Doble Factor Activado",
    detalle: (p) =>
      `${p} exigió una segunda verificación en cada acceso, recuperando Integridad (+1 ♥).`
  },
  Firewall: {
    campo: "disponibilidad",
    mensaje: "🛡 Defensa aplicada: Firewall",
    titulo: "🧱 Reglas de Firewall Activas",
    detalle: (p) =>
      `${p} filtró el tráfico de red anómalo, recuperando Disponibilidad total (+1 ♥).`
  }
};

/** Aplica la carta MUTANDO `propio` y `objetivo`, y devuelve el resultado para mostrar. */
function resolverCarta(c: Card, propio: PlayerEntity, objetivo: PlayerEntity): OnlineOutcome {
  if (c.tipo === "ATAQUE") {
    const def = ATAQUES[c.nombre];
    if (def) {
      if (exito(def.prob)) {
        objetivo.vida = Math.max(0, objetivo.vida - 1);
        objetivo[def.campo] = false;
        return {
          titulo: def.ok.titulo,
          detalle: def.ok.detalle(objetivo.nombre),
          exito: true,
          tipo: "ATAQUE",
          impacto: "-1 ♥ Vida",
          mensaje: def.mensaje,
          fx: ["hit"]
        };
      }
      return {
        titulo: def.fail.titulo,
        detalle: def.fail.detalle(objetivo.nombre),
        exito: false,
        tipo: "ATAQUE",
        impacto: "Ataque Fallido",
        mensaje: "❌ El ataque falló",
        fx: ["miss"]
      };
    }
  }

  if (c.tipo === "DEFENSA") {
    const def = DEFENSAS[c.nombre];
    if (def) {
      propio.vida = Math.min(3, propio.vida + 1);
      propio[def.campo] = true;
      return {
        titulo: def.titulo,
        detalle: def.detalle(propio.nombre),
        exito: true,
        tipo: "DEFENSA",
        impacto: "+1 ♥ Vida",
        mensaje: def.mensaje,
        fx: ["defensa"]
      };
    }
  }

  if (c.tipo === "JOLLY") {
    if (c.nombre === "Jolly Ataque") {
      const fx: OnlineFx[] = ["jolly"];
      if (exito(35)) {
        let hits = 0;
        for (let i = 0; i < 3; i++) if (exito(70)) hits++;
        if (hits > 0) {
          objetivo.vida = Math.max(0, objetivo.vida - hits);
          fx.push("hit");
          return {
            titulo: `🃏🔥 ¡Jolly Ataque Impactó (${hits} impacto${hits > 1 ? "s" : ""})!`,
            detalle: `Exploit de día cero multifase golpeó múltiples servicios de ${objetivo.nombre}.`,
            exito: true,
            tipo: "JOLLY",
            impacto: `-${hits} ♥ Vidas`,
            mensaje: "🃏🔥 ¡Jolly Ataque impactó!",
            fx
          };
        }
        return {
          titulo: "⚖️ Jolly Ataque sin Daño",
          detalle: `El exploit avanzado no encontró vulnerabilidades explotables en ${objetivo.nombre}.`,
          exito: false,
          tipo: "JOLLY",
          impacto: "Sin Daño",
          mensaje: "⚖️ Jolly Ataque no causó daño",
          fx
        };
      }
      fx.push("miss");
      return {
        titulo: "⚖️ Jolly Ataque Falló",
        detalle: `El ataque multifase no logró penetrar los perímetros de ${objetivo.nombre}.`,
        exito: false,
        tipo: "JOLLY",
        impacto: "Ataque Fallido",
        mensaje: "⚖️ Jolly Ataque falló",
        fx
      };
    }
    if (c.nombre === "Jolly Defensa") {
      propio.vida = 3;
      propio.confidencialidad = true;
      propio.integridad = true;
      propio.disponibilidad = true;
      return {
        titulo: "🃏🛡 ¡Resiliencia Total: Jolly Defensa!",
        detalle: `${propio.nombre} desplegó un plan de contingencia de respuesta rápida, restaurando la Tríada CIA al 100% (3 ♥).`,
        exito: true,
        tipo: "JOLLY",
        impacto: "Restauración Total (3 ♥)",
        mensaje: "🃏🛡 ¡Recuperación Total con Jolly Defensa!",
        fx: ["jolly"]
      };
    }
  }

  // Carta desconocida: no hace nada
  return {
    titulo: c.nombre,
    detalle: c.descripcion,
    exito: true,
    tipo: c.tipo,
    mensaje: c.nombre,
    fx: []
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

  const snapshotFor = (room: Room, seat: Seat): OnlineSnapshot => {
    const yo = room.slots[seat];
    const rival = room.slots[otro(seat)];
    const pend = room.pending;
    return {
      code: room.code,
      seat,
      phase: room.phase === "over" ? "over" : "playing",
      me: { ...yo.entity },
      rival: { ...rival.entity },
      meMesa: yo.mesa,
      rivalMesa: rival.mesa,
      hand: yo.hand.map((c) => ({ ...c })),
      myTurn: room.phase === "playing" && room.turn === seat,
      rivalConnected: !!rival.socketId,
      pending: pend
        ? { card: pend.card, playedByMe: pend.seat === seat, outcome: pend.outcome }
        : null,
      waitingContinue: yo.continued,
      result:
        room.phase === "over" && room.winner !== null ? (room.winner === seat ? "win" : "lose") : null
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

  const avanzarTurno = (room: Room) => {
    const pend = room.pending;
    if (!pend) return;
    if (room.advanceTimer) {
      clearTimeout(room.advanceTimer);
      room.advanceTimer = null;
    }
    room.pending = null;
    room.slots.forEach((s) => (s.continued = false));

    if (pend.winner !== null) {
      room.phase = "over";
      room.winner = pend.winner;
      room.slots.forEach((_, seat) => {
        emitToSeat(room, seat as Seat, "game:over", {
          result: pend.winner === seat ? "win" : "lose",
          snapshot: snapshotFor(room, seat as Seat)
        });
      });
      return;
    }

    // Si el jugador se quedó sin cartas en la mano, se le reparten 3 nuevas.
    const quienJugo = room.slots[pend.seat];
    if (quienJugo.hand.length === 0) quienJugo.hand = repartirTresCartas();

    // Nueva ronda: cuando las 6 cartas de la mesa ya se jugaron.
    let newRound = false;
    if (room.slots.every((s) => s.mesa <= 0)) {
      room.slots.forEach((s) => (s.mesa = 3));
      newRound = true;
    }

    room.turn = otro(pend.seat);
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
        turn: 0,
        pending: null,
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
      room.turn = 0;
      room.slots[0].hand = repartirTresCartas();
      room.slots[1].hand = repartirTresCartas();

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

    // ---------------------------------------------------------- jugar carta
    socket.on("game:play", (data: { cardId?: string } | undefined) => {
      const room = rooms.get(socket.data.code as string);
      if (!room) return error(socket, "La sala ya no existe.");
      const seatIdx = room.slots.findIndex((s) => s.socketId === socket.id);
      if (seatIdx < 0) return error(socket, "No formas parte de esta partida.");
      const seat = seatIdx as Seat;
      if (room.phase !== "playing") return error(socket, "La partida no está en curso.");
      if (room.pending) return error(socket, "Espera a que termine la jugada anterior.");
      if (room.turn !== seat) return error(socket, "No es tu turno.");
      if (room.slots.some((s) => !s.socketId)) {
        return error(socket, "Tu rival está desconectado. Espera a que vuelva.");
      }

      const yo = room.slots[seat];
      const rival = room.slots[otro(seat)];
      const card = yo.hand.find((c) => c.id === data?.cardId);
      if (!card) return error(socket, "Esa carta no está en tu mano.");

      yo.hand = yo.hand.filter((c) => c.id !== card.id);
      yo.mesa = Math.max(0, yo.mesa - 1);

      const outcome = resolverCarta(card, yo.entity, rival.entity);
      const winner: Seat | null =
        rival.entity.vida <= 0 ? seat : yo.entity.vida <= 0 ? otro(seat) : null;

      room.pending = { seat, card, outcome, winner };
      room.slots.forEach((s) => (s.continued = false));

      room.slots.forEach((_, s) => {
        const me = room.slots[s];
        const rv = room.slots[otro(s as Seat)];
        const payload: OnlinePlayedPayload = {
          card,
          playedByMe: s === seat,
          outcome,
          state: {
            me: { ...me.entity },
            rival: { ...rv.entity },
            meMesa: me.mesa,
            rivalMesa: rv.mesa,
            hand: me.hand.map((c) => ({ ...c }))
          }
        };
        emitToSeat(room, s as Seat, "game:played", payload);
      });

      room.advanceTimer = setTimeout(() => avanzarTurno(room), REVEAL_MS);
    });

    // -------------------------------------------------------------- continuar
    socket.on("game:continue", () => {
      const room = rooms.get(socket.data.code as string);
      if (!room || !room.pending) return;
      const slot = room.slots.find((s) => s.socketId === socket.id);
      if (!slot) return;
      slot.continued = true;
      // Avanza cuando todos los CONECTADOS ya pulsaron continuar.
      if (room.slots.every((s) => s.continued || !s.socketId)) avanzarTurno(room);
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
        avanzarTurno(room);
      }
      slot.dropTimer = setTimeout(
        () => destruirSala(room, "rival_left"),
        room.phase === "waiting" ? GRACE_WAITING_MS : GRACE_PLAYING_MS
      );
    });
  });
}
