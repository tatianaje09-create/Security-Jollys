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
    descripcion: "Respuesta a incidentes de élite: restaura la tríada al 100%.",
    objetivo: "Recuperación Total (3 ♥)",
    probBase: 100,
    rango: "🛡",
    suitSymbol: "JOLLY",
    suitColor: "#38bdf8",
    rutaImagen: "/img/jolly_D.png"
  }
];

export function repartirTresCartas(): Card[] {
  const mano: Card[] = [];
  for (let i = 0; i < 3; i++) {
    const randomIndex = Math.floor(Math.random() * MAZO_BASE.length);
    // clone to avoid reference overlap
    mano.push({ ...MAZO_BASE[randomIndex], id: `${MAZO_BASE[randomIndex].id}-${Date.now()}-${Math.random()}` });
  }
  return mano;
}
