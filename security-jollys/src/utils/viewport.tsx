import { createContext, useContext, useEffect, useState } from "react";

/**
 * Tamaño "efectivo" de la pantalla del juego.
 * Si el jugador pulsa "Girar" en un celular vertical y el navegador no permite bloquear
 * la orientación (por ejemplo en iPhone), la interfaz se gira 90° con CSS y aquí
 * el ancho y el alto ya vienen intercambiados.
 */
export interface ViewportInfo {
  w: number; // ancho efectivo en px
  h: number; // alto efectivo en px
  realPortrait: boolean; // el celular está físicamente de pie
  rotated: boolean; // la interfaz se está girando con CSS
  portrait: boolean; // el juego se ve en vertical
  isPhone: boolean; // el lado corto de la pantalla mide menos de 700px
}

const DEFAULT: ViewportInfo = {
  w: 1280,
  h: 720,
  realPortrait: false,
  rotated: false,
  portrait: false,
  isPhone: false
};

export const ViewportContext = createContext<ViewportInfo>(DEFAULT);
export const useViewport = () => useContext(ViewportContext);

const readSize = () => ({ w: window.innerWidth, h: window.innerHeight });

export function useViewportInfo(forceRotate: boolean): ViewportInfo {
  const [size, setSize] = useState(readSize);

  useEffect(() => {
    const update = () => setSize(readSize());
    const onOrientation = () => {
      update();
      // Algunos navegadores tardan en reportar el nuevo tamaño
      setTimeout(update, 250);
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", onOrientation);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrientation);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  const realPortrait = size.h > size.w;
  const rotated = forceRotate && realPortrait;
  const w = rotated ? size.h : size.w;
  const h = rotated ? size.w : size.h;
  return {
    w,
    h,
    realPortrait,
    rotated,
    portrait: h > w,
    isPhone: Math.min(size.w, size.h) < 700
  };
}
