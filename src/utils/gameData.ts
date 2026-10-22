import { Card } from "../types";

export const MAZO_BASE: Card[] = [
  {
    id: "phishing",
    tipo: "ATAQUE",
    nombre: "Phishing",
    subtitulo: "Ingeniería Social",
    descripcion: "Suplanta identidades para robar credenciales críticas.",
    objetivo: "Ataca Confidencialidad (C)",
    probBase: 60,
    rango: "J",
    suitSymbol: "♦",
    suitColor: "#ef4444",
    rutaImagen: "/img/J_diamante_phishing.png"
  },
  {
    id: "ddos",
    tipo: "ATAQUE",
    nombre: "DDoS",
    subtitulo: "Denegación de Servicio",
    descripcion: "Satura los servidores con avalanchas de tráfico malicioso.",
    objetivo: "Ataca Disponibilidad (D)",
    probBase: 70,
    rango: "K",
    suitSymbol: "♠",
    suitColor: "#64748b",
    rutaImagen: "/img/K_pica_ddos.png"
  },
  {
    id: "malware",
    tipo: "ATAQUE",
    nombre: "Malware",
    subtitulo: "Código Hostil",
    descripcion: "Corrompe o altera la base de datos y archivos de la empresa.",
    objetivo: "Ataca Integridad (I)",
    probBase: 65,
    rango: "Q",
    suitSymbol: "♣",
    suitColor: "#10b981",
    rutaImagen: "/img/Q_trebol_malware.png"
  },
    {
    id: "antivirus",
    tipo: "DEFENSA",
    nombre: "Antivirus",
    subtitulo: "Protección Activa",
    descripcion: "Programa que detecta, bloquea y elimina software malicioso (virus, troyanos, spyware) antes de que robe o dañe la información.",
    objetivo: "Restaura Integridad (+1 ♥)",
    probBase: 100,
    rango: "K",
    suitSymbol: "♠",
    suitColor: "#10b981",
    rutaImagen: "/img/K_pica_antivirus.png"
  },
    {
    id: "2FA",
    tipo: "DEFENSA",
    nombre: "2FA",
    subtitulo: "Doble Factor de Autenticación",
    descripcion: "Pide un segundo paso de verificación (código, app o huella) además de la contraseña, para que solo personas autorizadas puedan entrar y modificar los datos.",
    objetivo: "Restaura Confidencialidad (+1 ♥)",
    probBase: 100,
    rango: "Q",
    suitSymbol: "♣",
    suitColor: "#ef4444",
    rutaImagen: "/img/Q_trebol_2fa.png"
  },
  {
    id: "firewall",
    tipo: "DEFENSA",
    nombre: "Firewall",
    subtitulo: "Barrera Perimetral",
    descripcion: "Filtra el tráfico malicioso y restablece los servicios.",
    objetivo: "Restaura Disponibilidad (+1 ♥)",
    probBase: 100,
    rango: "J",
    suitSymbol: "♦",
    suitColor: "#ef4444",
    rutaImagen: "/img/J_diamante_firewall.png"
  },
  {
    id: "jolly_ataque",
    tipo: "JOLLY",
    nombre: "Jolly Ataque",
    subtitulo: "Zero-Day Exploit",
    descripcion: "Amenaza avanzada capaz de comprometer múltiples activos.",
    objetivo: "Ataca C, I y D simultáneamente",
    probBase: 35,
    rango: "★",
    suitSymbol: "JOLLY",
    suitColor: "#f59e0b",
    rutaImagen: "/img/Jolly_A.png"
  },
  {
    id: "jolly_defensa",
    tipo: "JOLLY",
    nombre: "Jolly Defensa",
    subtitulo: "SOC & Resiliencia",
    descripcion: "Respuesta a incidentes de élite: recupera 2 vidas y restaura la tríada.",
    objetivo: "Recupera 2 ♥",
    probBase: 100,
    rango: "🛡",
    suitSymbol: "JOLLY",
    suitColor: "#38bdf8",
    rutaImagen: "/img/jolly_D.png"
  }
];

/**
 * Reparte 3 cartas DISTINTAS (sin repetir tipo dentro de la misma mano).
 * Se mezcla el mazo (Fisher-Yates) y se toman las 3 primeras, así nunca salen
 * dos cartas iguales en una mano (p. ej. dos Jolly Ataque).
 */
export function repartirTresCartas(): Card[] {
  const barajado = [...MAZO_BASE];
  for (let i = barajado.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }
  return barajado.slice(0, 3).map((base) => ({
    ...base,
    // id único por carta (el prefijo antes del primer "-" sigue siendo el id base)
    id: `${base.id}-${Date.now()}-${Math.random()}`
  }));
}

/**
 * DUELO (2 jugadores): el Atacante recibe 3 cartas de ataque distintas (de Phishing, Malware, DDoS
 * y Jolly Ataque) y el Defensor 3 defensas distintas (2FA, Antivirus, Firewall y Jolly Defensa).
 */
export function repartirManosDuelo(): { ataque: Card[]; defensa: Card[] } {
  const tres = (pool: Card[]): Card[] => {
    const b = [...pool];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b.slice(0, 3).map((c) => ({ ...c, id: `${c.id}-${Date.now()}-${Math.random()}` }));
  };
  const ataques = MAZO_BASE.filter((c) => c.tipo === "ATAQUE" || c.id === "jolly_ataque");
  const defensas = MAZO_BASE.filter((c) => c.tipo === "DEFENSA" || c.id === "jolly_defensa");
  return { ataque: tres(ataques), defensa: tres(defensas) };
}
