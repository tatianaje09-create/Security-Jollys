import React from "react";
import { useViewport } from "../utils/viewport";

interface TableCardsViewProps {
  cartasMesaJugador: number; // 0 to 3
  cartasMesaIA: number; // 0 to 3
  onDropCard?: (e: React.DragEvent) => void;
  onDragOverTable?: (e: React.DragEvent) => void;
  isDraggingOver?: boolean;
}

export const TableCardsView: React.FC<TableCardsViewProps> = ({
  cartasMesaJugador,
  cartasMesaIA,
  onDropCard,
  onDragOverTable,
  isDraggingOver = false
}) => {
  const { portrait } = useViewport();

  // Posiciones y rotaciones calculadas para la mesa ovalada amplia (como en el juego original)
  const posIzquierda = portrait
    ? [
        // Celular vertical: mis cartas en fila, en la mitad inferior de la mesa
        { left: "27%", top: "58%", rot: -6 },
        { left: "50%", top: "58%", rot: 0 },
        { left: "73%", top: "58%", rot: 6 }
      ]
    : [
        { left: "18.5%", top: "31%", rot: 117 },
        { left: "16.5%", top: "49%", rot: 90 },
        { left: "18.5%", top: "67%", rot: 62 }
      ];

  const posDerecha = portrait
    ? [
        // Celular vertical: cartas del rival en fila, en la mitad superior de la mesa
        { left: "27%", top: "27%", rot: 174 },
        { left: "50%", top: "27%", rot: 180 },
        { left: "73%", top: "27%", rot: 186 }
      ]
    : [
        { left: "81.5%", top: "31%", rot: -117 },
        { left: "83.5%", top: "49%", rot: -90 },
        { left: "81.5%", top: "67%", rot: -62 }
      ];

  // Tamaño de cada carta de la mesa (en vertical se escala con la pantalla)
  const cardSize: React.CSSProperties = portrait
    ? { width: "min(calc(var(--vw) * 24), calc(var(--vh) * 13))", aspectRatio: "125 / 175" }
    : // En horizontal se achica solo cuando la pantalla es baja (celular): en escritorio queda en 125px
      { width: "min(125px, calc(var(--vh) * 21.5))", aspectRatio: "125 / 175" };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverTable?.(e);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropCard?.(e);
      }}
      className={`absolute inset-0 w-full h-full select-none pointer-events-auto transition-colors ${
        isDraggingOver ? "bg-amber-500/10" : ""
      }`}
    >
      {/* Cartas mesa Jugador (Izquierda) */}
      {posIzquierda.map((pos, i) => {
        if (i >= cartasMesaJugador) return null;
        return (
          <div
            key={`mesa-izq-${i}`}
            style={{
              position: "absolute",
              left: pos.left,
              top: pos.top,
              ...cardSize,
              transform: `translate(-50%, -50%) rotate(${pos.rot}deg)`,
              transformOrigin: "center center"
            }}
            className="shadow-[0_10px_25px_rgba(0,0,0,0.6)] rounded-md border-2 border-black/50 overflow-hidden pointer-events-none transition-all duration-300 hover:brightness-105"
          >
            <img
              src="/img/dorso.png"
              alt="Dorso carta jugador"
              className="w-full h-full object-cover rounded-md select-none"
              draggable={false}
            />
          </div>
        );
      })}

      {/* Cartas mesa IA / Jugador 2 (Derecha) */}
      {posDerecha.map((pos, i) => {
        if (i >= cartasMesaIA) return null;
        return (
          <div
            key={`mesa-der-${i}`}
            style={{
              position: "absolute",
              left: pos.left,
              top: pos.top,
              ...cardSize,
              transform: `translate(-50%, -50%) rotate(${pos.rot}deg)`,
              transformOrigin: "center center"
            }}
            className="shadow-[0_10px_25px_rgba(0,0,0,0.6)] rounded-md border-2 border-black/50 overflow-hidden pointer-events-none transition-all duration-300 hover:brightness-105"
          >
            <img
              src="/img/dorso.png"
              alt="Dorso carta rival"
              className="w-full h-full object-cover rounded-md select-none"
              draggable={false}
            />
          </div>
        );
      })}
    </div>
  );
};
