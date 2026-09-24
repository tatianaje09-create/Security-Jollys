import { io, Socket } from "socket.io-client";
import type { OnlineAck } from "../types";

/**
 * Conexión en tiempo real con el servidor (misma dirección y puerto que la página).
 * No se conecta sola: solo cuando el jugador entra al modo en línea.
 */
export const socket: Socket = io({ autoConnect: false });

const PLAYER_KEY = "jollys.playerId";
const ROOM_KEY = "jollys.room";

let memoryPlayerId: string | null = null;

/**
 * Identificador estable del jugador en esta pestaña. Permite volver a la misma
 * partida si se cae el WiFi o el celular apaga la pantalla.
 * (No usa crypto.randomUUID porque no existe en http://192.168.x.x, solo en https/localhost.)
 */
export function getPlayerId(): string {
  try {
    const guardado = sessionStorage.getItem(PLAYER_KEY);
    if (guardado) return guardado;
  } catch {
    /* sessionStorage no disponible */
  }
  if (!memoryPlayerId) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    memoryPlayerId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      sessionStorage.setItem(PLAYER_KEY, memoryPlayerId);
    } catch {
      /* ignorar */
    }
  }
  return memoryPlayerId;
}

export function getSavedRoom(): string | null {
  try {
    return sessionStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

export function saveRoom(code: string) {
  try {
    sessionStorage.setItem(ROOM_KEY, code);
  } catch {
    /* ignorar */
  }
}

export function clearSavedRoom() {
  try {
    sessionStorage.removeItem(ROOM_KEY);
  } catch {
    /* ignorar */
  }
}

export function connectSocket() {
  if (!socket.connected) socket.connect();
}

/** Emite un evento y espera la respuesta (ack) del servidor. */
export function emitAck<T = OnlineAck>(event: string, payload?: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: T) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

/** Copia texto al portapapeles. Funciona también en http:// (donde navigator.clipboard no existe). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* seguimos con el método alternativo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
