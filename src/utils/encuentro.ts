import type { Card, OnlineFx, OnlineOutcome, PlayerEntity } from "../types";

/**
 * ENCUENTRO DE CARTAS (modo 2 jugadores).
 *
 * Los dos jugadores eligen su carta en secreto; cuando ambos han elegido, las dos cartas se
 * descubren y se encuentran. Solo entonces se sabe si el ataque funcionó:
 *   - Una DEFENSA solo cura (+1 vida) cuando el rival NO ataca en ese turno. Si hay un ataque en curso,
 *     la defensa solo sirve si es el control correcto (bloquea); si no, no cura y el ataque sigue su curso.
 *     Así un ataque y una defensa nunca se anulan entre sí. Jolly Defensa restaura todo.
 *   - Si la defensa del rival es el control CORRECTO contra el ataque, el ataque queda bloqueado
 *     (Phishing↔2FA, Malware↔Antivirus, DDoS↔Firewall, Jolly Ataque↔Jolly Defensa).
 *   - Un ataque que no es bloqueado se juega con su probabilidad de siempre (60/70/65 %, Jolly 35 %).
 *   - Primero se activan las defensas y después llegan los ataques.
 *
 * Este módulo lo usan el servidor (partidas en línea) y el cliente (2 jugadores en un dispositivo).
 */

type Campo = "confidencialidad" | "integridad" | "disponibilidad";

const CONTRA_DE_ATAQUE: Record<string, string> = {
  phishing: "2FA",
  malware: "antivirus",
  ddos: "firewall",
  jolly_ataque: "jolly_defensa"
};

const baseId = (c: Card): string => c.id.split("-")[0];
const esAtaque = (c: Card): boolean => c.tipo === "ATAQUE" || baseId(c) === "jolly_ataque";
const esDefensa = (c: Card): boolean => c.tipo === "DEFENSA" || baseId(c) === "jolly_defensa";
const bloquea = (defensa: Card, ataque: Card): boolean =>
  esDefensa(defensa) && esAtaque(ataque) && CONTRA_DE_ATAQUE[baseId(ataque)] === baseId(defensa);

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
      titulo: "🛡 Phishing Fallido",
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
    campo: "integridad",
    mensaje: "🛡 Defensa aplicada: Antivirus",
    titulo: "🛡 Antivirus Activo",
    detalle: (p) =>
      `${p} detectó y eliminó el software malicioso de sus equipos, restaurando Integridad (+1 ♥).`
  },
  "2FA": {
    campo: "confidencialidad",
    mensaje: "🛡 Defensa aplicada: 2FA",
    titulo: "🔐 Doble Factor Activado",
    detalle: (p) =>
      `${p} exigió una segunda verificación en cada acceso, recuperando Confidencialidad (+1 ♥).`
  },
  Firewall: {
    campo: "disponibilidad",
    mensaje: "🛡 Defensa aplicada: Firewall",
    titulo: "🧱 Reglas de Firewall Activas",
    detalle: (p) =>
      `${p} filtró el tráfico de red anómalo, recuperando Disponibilidad total (+1 ♥).`
  }
};

export interface ResultadoEncuentro {
  a: PlayerEntity; // estado final de quien jugó la carta A
  b: PlayerEntity; // estado final de quien jugó la carta B
  outcomeA: OnlineOutcome; // qué le pasó a la carta A
  outcomeB: OnlineOutcome; // qué le pasó a la carta B
  ganador: 0 | 1 | "empate" | null; // 0 = A, 1 = B
}

/** Efecto de una DEFENSA sobre quien la juega. */
function aplicarDefensa(c: Card, propio: PlayerEntity, rival: Card): OnlineOutcome {
  const bloqueo = esAtaque(rival) && bloquea(c, rival);
  const nota = bloqueo ? ` ¡Era el control correcto contra ${rival.nombre}: el ataque quedó bloqueado!` : "";
  const sufijo = bloqueo ? " · Ataque bloqueado" : "";

  if (baseId(c) === "jolly_defensa") {
    propio.vida = 3;
    propio.confidencialidad = true;
    propio.integridad = true;
    propio.disponibilidad = true;
    return {
      titulo: "🃏🛡 ¡Resiliencia Total: Jolly Defensa!",
      detalle: `${propio.nombre} desplegó un plan de contingencia de respuesta rápida, restaurando la Tríada CIA al 100% (3 ♥).${nota}`,
      exito: true,
      tipo: "JOLLY",
      impacto: `Restauración Total (3 ♥)${sufijo}`,
      mensaje: "🃏🛡 ¡Recuperación Total con Jolly Defensa!",
      fx: ["jolly"]
    };
  }

  const def = DEFENSAS[c.nombre];
  if (def) {
    propio[def.campo] = true;
    const amenazado = esAtaque(rival);

    // Sin ataque en curso: la defensa cura +1 vida
    if (!amenazado) {
      propio.vida = Math.min(3, propio.vida + 1);
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

    // Con ataque en curso: NO cura. Si era el control correcto, bloquea; si no, el ataque sigue su curso
    return {
      titulo: def.titulo,
      detalle: bloqueo
        ? `${propio.nombre} activó el control correcto y frenó el ataque.${nota}`
        : `${propio.nombre} activó ${c.nombre}, pero no era el control contra ${rival.nombre}: con un ataque en curso no recupera vida.`,
      exito: bloqueo,
      tipo: "DEFENSA",
      impacto: bloqueo ? "Ataque bloqueado" : "Sin recuperación",
      mensaje: bloqueo ? def.mensaje : `⚠️ ${c.nombre} no frenó el ${rival.nombre}`,
      fx: ["defensa"]
    };
  }

  return { titulo: c.nombre, detalle: c.descripcion, exito: true, tipo: c.tipo, mensaje: c.nombre, fx: [] };
}

/** Efecto de un ATAQUE sobre `objetivo` (ya sabiendo qué carta puso el rival). */
function aplicarAtaque(
  c: Card,
  objetivo: PlayerEntity,
  rival: Card,
  azar: () => number
): OnlineOutcome {
  const exito = (prob: number) => azar() * 100 < prob;
  const esJolly = baseId(c) === "jolly_ataque";

  // El rival jugó justo el control correcto: las cartas se encuentran y el ataque se bloquea
  if (bloquea(rival, c)) {
    return {
      titulo: `🛡 ¡${rival.nombre} bloqueó el ${c.nombre}!`,
      detalle: `${objetivo.nombre} respondió con el control correcto (${rival.nombre}) y el ataque quedó neutralizado.`,
      exito: false,
      tipo: c.tipo,
      impacto: "Ataque Bloqueado",
      mensaje: `🛡 ${rival.nombre} bloqueó el ${c.nombre}`,
      fx: esJolly ? ["jolly", "miss"] : ["miss"]
    };
  }

  const sinDefensa = esDefensa(rival)
    ? ` La defensa del rival (${rival.nombre}) no era el control correcto.`
    : "";

  if (esJolly) {
    const fx: OnlineFx[] = ["jolly"];
    if (exito(35)) {
      let hits = 0;
      for (let i = 0; i < 3; i++) if (exito(70)) hits++;
      if (hits > 0) {
        objetivo.vida = Math.max(0, objetivo.vida - hits);
        fx.push("hit");
        return {
          titulo: `🃏🔥 ¡Jolly Ataque Impactó (${hits} impacto${hits > 1 ? "s" : ""})!`,
          detalle: `Exploit de día cero multifase golpeó múltiples servicios de ${objetivo.nombre}.${sinDefensa}`,
          exito: true,
          tipo: "JOLLY",
          impacto: `-${hits} ♥ Vidas`,
          mensaje: "🃏🔥 ¡Jolly Ataque impactó!",
          fx
        };
      }
      return {
        titulo: "⚖️ Jolly Ataque sin Daño",
        detalle: `El exploit avanzado no encontró vulnerabilidades explotables en ${objetivo.nombre}.${sinDefensa}`,
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
      detalle: `El ataque multifase no logró penetrar los perímetros de ${objetivo.nombre}.${sinDefensa}`,
      exito: false,
      tipo: "JOLLY",
      impacto: "Ataque Fallido",
      mensaje: "⚖️ Jolly Ataque falló",
      fx
    };
  }

  const def = ATAQUES[c.nombre];
  if (def) {
    if (exito(def.prob)) {
      objetivo.vida = Math.max(0, objetivo.vida - 1);
      objetivo[def.campo] = false;
      return {
        titulo: def.ok.titulo,
        detalle: def.ok.detalle(objetivo.nombre) + sinDefensa,
        exito: true,
        tipo: "ATAQUE",
        impacto: "-1 ♥ Vida",
        mensaje: def.mensaje,
        fx: ["hit"]
      };
    }
    return {
      titulo: def.fail.titulo,
      detalle: def.fail.detalle(objetivo.nombre) + sinDefensa,
      exito: false,
      tipo: "ATAQUE",
      impacto: "Ataque Fallido",
      mensaje: "❌ El ataque falló",
      fx: ["miss"]
    };
  }

  return { titulo: c.nombre, detalle: c.descripcion, exito: true, tipo: c.tipo, mensaje: c.nombre, fx: [] };
}

/** Resuelve el encuentro entre la carta A (jugador A) y la carta B (jugador B). No muta los argumentos. */
export function resolverEncuentro(
  cartaA: Card,
  cartaB: Card,
  entidadA: PlayerEntity,
  entidadB: PlayerEntity,
  azar: () => number = Math.random
): ResultadoEncuentro {
  const a = { ...entidadA };
  const b = { ...entidadB };
  let outcomeA: OnlineOutcome | null = null;
  let outcomeB: OnlineOutcome | null = null;

  // 1) Las defensas se activan primero
  if (esDefensa(cartaA)) outcomeA = aplicarDefensa(cartaA, a, cartaB);
  if (esDefensa(cartaB)) outcomeB = aplicarDefensa(cartaB, b, cartaA);
  // 2) Después llegan los ataques (cada uno contra el otro jugador)
  if (esAtaque(cartaA)) outcomeA = aplicarAtaque(cartaA, b, cartaB, azar);
  if (esAtaque(cartaB)) outcomeB = aplicarAtaque(cartaB, a, cartaA, azar);

  const vacio = (c: Card): OnlineOutcome => ({
    titulo: c.nombre,
    detalle: c.descripcion,
    exito: true,
    tipo: c.tipo,
    mensaje: c.nombre,
    fx: []
  });

  const ganador: ResultadoEncuentro["ganador"] =
    a.vida <= 0 && b.vida <= 0 ? "empate" : b.vida <= 0 ? 0 : a.vida <= 0 ? 1 : null;

  return {
    a,
    b,
    outcomeA: outcomeA ?? vacio(cartaA),
    outcomeB: outcomeB ?? vacio(cartaB),
    ganador
  };
}
