import React, { useState } from "react";
import { Card } from "../types";

interface CardComponentProps {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  isFaceDown?: boolean;
  isAnimating?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}

export const CardComponent: React.FC<CardComponentProps> = ({
  card,
  onClick,
  disabled = false,
  isFaceDown = false,
  isAnimating = false,
  onDragStart,
  onDragEnd
}) => {
  const [imageError, setImageError] = useState(false);

  // If face down (dorso.png)
  if (isFaceDown) {
    return (
      <div
        className="w-[115px] h-[160px] rounded border border-[#0f0f0f] shadow-lg overflow-hidden flex items-center justify-center bg-[#151515] select-none pointer-events-none"
      >
        <img
          src="/img/dorso.png"
          alt="Dorso"
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    );
  }

  // Fallback text style if image fails to load or not provided (configurarBotonTexto in Java)
  if (imageError || !card.rutaImagen) {
    const getBgColor = () => {
      switch (card.tipo) {
        case "ATAQUE":
          return "bg-[#b41e1e] text-white"; // new Color(180, 30, 30)
        case "DEFENSA":
          return "bg-[#1e8c1e] text-white"; // new Color(30, 140, 30)
        case "JOLLY":
          return "bg-[#ffb400] text-black"; // new Color(255, 180, 0)
      }
    };

    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        draggable={!disabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={{
          width: `min(${isAnimating ? 180 : 160}px, calc(var(--vw) * 29))`,
          height: isAnimating ? "170px" : "150px",
          fontFamily: "Arial, sans-serif"
        }}
        className={`select-none cursor-pointer flex items-center justify-center text-center font-bold text-[14px] p-2 transition-all duration-300 ${getBgColor()} ${
          isAnimating
            ? "border-[5px] border-[#ffdc00]" // new Color(255, 220, 0)
            : "border-4 border-black"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "hover:brightness-110 active:scale-95"}`}
      >
        {card.nombre}
      </button>
    );
  }

  // Image button (crearBotonCarta in Java)
  // Matching playing card proportions, showing 100% of the card graphics without clipping
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        // Las 3 cartas de la mano caben a lo ancho (29% cada una) y respetan la proporción
        // de la carta también en pantallas bajas (celular horizontal)
        width: `min(${isAnimating ? 175 : 155}px, calc(var(--vw) * 29), calc(var(--vh) * ${isAnimating ? 21.5 : 19.2}))`,
        aspectRatio: isAnimating ? "175 / 245" : "155 / 218",
        maxHeight: "calc(var(--vh) * 27)",
        borderColor: isAnimating ? "#ffdc00" : "#0f0f0f",
        borderWidth: isAnimating ? "4px" : "3px"
      }}
      className={`relative select-none cursor-pointer bg-white border rounded-lg flex items-center justify-center p-0.5 overflow-hidden shadow-[0_8px_22px_rgba(0,0,0,0.85)] transition-all duration-200 ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:-translate-y-3 hover:shadow-[0_16px_32px_rgba(0,0,0,0.95)] hover:border-amber-400 active:scale-95"
      }`}
      title={`${card.nombre} - ${card.tipo} (${card.objetivo})`}
    >
      <img
        src={card.rutaImagen}
        alt={card.nombre}
        onError={() => setImageError(true)}
        className="w-full h-full object-contain pointer-events-none select-none rounded-[5px]"
        draggable={false}
      />
    </button>
  );
};
