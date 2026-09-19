import React, { useState, useEffect } from "react";
import { Card, CardActionOutcome } from "../types";
import { useViewport } from "../utils/viewport";

interface CardFlipRevealProps {
  card: Card;
  playedBy: string;
  isFlipped: boolean;
  resultado?: CardActionOutcome;
  onContinue?: () => void;
  autoCloseDuration?: number; // default 10000ms (10 segundos)
  esperando?: boolean; // modo en línea: ya pulsé "Continuar" y espero al rival
}

export const CardFlipReveal: React.FC<CardFlipRevealProps> = ({
  card,
  playedBy,
  isFlipped,
  resultado,
  onContinue,
  autoCloseDuration = 10000,
  esperando = false
}) => {
  const [imageError, setImageError] = useState(false);
  const { h: viewH } = useViewport();
  const short = viewH <= 700; // pantallas bajas: textos y espacios más compactos
  const [timeLeft, setTimeLeft] = useState<number>(Math.ceil(autoCloseDuration / 1000));

  // Reset image error and countdown when card changes
  useEffect(() => {
    setImageError(false);
    setTimeLeft(Math.ceil(autoCloseDuration / 1000));
  }, [card.id, autoCloseDuration]);

  // Countdown timer for user peace of mind
  useEffect(() => {
    if (!isFlipped) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isFlipped]);

  // Theme color based on card type
  const getGlowColor = () => {
    switch (card.tipo) {
      case "ATAQUE":
        return "rgba(239, 68, 68, 0.9)"; // Red
      case "DEFENSA":
        return "rgba(16, 185, 129, 0.9)"; // Emerald green
      case "JOLLY":
        return "rgba(245, 158, 11, 0.95)"; // Gold
      default:
        return "rgba(255, 255, 255, 0.5)";
    }
  };

  const getBorderColor = () => {
    switch (card.tipo) {
      case "ATAQUE":
        return "border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.85)]";
      case "DEFENSA":
        return "border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.85)]";
      case "JOLLY":
        return "border-amber-400 shadow-[0_0_35px_rgba(245,158,11,0.9)]";
      default:
        return "border-white/50";
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-3">
      {/* Subtle backdrop spotlight */}
      <div 
        className="absolute w-[420px] h-[420px] rounded-full blur-[90px] pointer-events-none transition-all duration-700"
        style={{
          backgroundColor: isFlipped ? getGlowColor() : "rgba(245, 158, 11, 0.3)",
          opacity: 0.7
        }}
      />

      {/* Floating Status Tag above card */}
      <div className={`relative ${short ? "mb-1.5" : "mb-3"} z-20`}>
        <div 
          className="px-6 py-2 rounded-full bg-black/90 backdrop-blur-md border border-amber-400/80 shadow-[0_6px_22px_rgba(0,0,0,0.9)] text-white text-base sm:text-lg font-bold tracking-wide flex items-center gap-2 transition-all duration-300"
        >
          <span className="text-amber-400 text-lg">🃏</span>
          <span>
            {playedBy}: {isFlipped ? (
              <span className="text-amber-300 font-extrabold uppercase ml-1">
                {card.nombre}
              </span>
            ) : (
              <span className="text-slate-300 italic ml-1">Colocando carta...</span>
            )}
          </span>
        </div>
      </div>

      {/* 3D Card Turnover Container */}
      <div 
        className="relative z-20"
        style={{
          perspective: "1200px",
          // Se adapta al alto de la pantalla para que en celulares chicos no tape la cabecera
          width: "min(195px, calc(var(--vh) * 24), calc(var(--vw) * 52))",
          aspectRatio: "195 / 275"
        }}
      >
        <div
          className="relative w-full h-full duration-700 transition-transform"
          style={{
            transformStyle: "preserve-3d",
            transform: isFlipped ? "rotateY(180deg) scale(1.06)" : "rotateY(0deg) scale(1)"
          }}
        >
          {/* ============================================================ */}
          {/* BACK FACE (El revés de la carta: dorso.png)                  */}
          {/* ============================================================ */}
          <div
            className="absolute inset-0 w-full h-full rounded-xl overflow-hidden border-2 border-amber-400/80 shadow-[0_15px_35px_rgba(0,0,0,0.95)] bg-[#12141c]"
            style={{
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden"
            }}
          >
            <img
              src="/img/dorso.png"
              alt="Reverso de carta"
              className="w-full h-full object-cover rounded-xl select-none pointer-events-none"
              draggable={false}
            />
            {/* Shimmer line */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent pointer-events-none" />
          </div>

          {/* ============================================================ */}
          {/* FRONT FACE (Carta descubierta: Imagen real de Phishing, etc) */}
          {/* ============================================================ */}
          <div
            className={`absolute inset-0 w-full h-full rounded-xl border-3 ${getBorderColor()} shadow-[0_20px_45px_rgba(0,0,0,0.95)] bg-white flex flex-col items-center justify-center p-1 select-none`}
            style={{
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              transform: "rotateY(180deg)"
            }}
          >
            {card.rutaImagen && !imageError ? (
              <div 
                className="w-full h-full flex items-center justify-center rounded-lg overflow-hidden bg-white"
                style={{
                  backgroundImage: `url(${card.rutaImagen})`,
                  backgroundSize: "contain",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat"
                }}
              >
                <img
                  src={card.rutaImagen}
                  alt={card.nombre}
                  onError={() => setImageError(true)}
                  className="w-full h-full object-contain select-none pointer-events-none rounded-lg drop-shadow-sm"
                  draggable={false}
                />
              </div>
            ) : (
              /* Fallback Graphic */
              <div 
                className={`w-full h-full rounded-lg flex flex-col justify-between p-3 select-none text-center ${
                  card.tipo === "ATAQUE"
                    ? "bg-gradient-to-b from-[#b41e1e] to-[#781414] text-white"
                    : card.tipo === "DEFENSA"
                    ? "bg-gradient-to-b from-[#1e8c1e] to-[#125812] text-white"
                    : "bg-gradient-to-b from-[#d97706] to-[#92400e] text-white"
                }`}
              >
                <div className="flex justify-between items-center text-xs font-bold opacity-90">
                  <span>{card.rango}</span>
                  <span>{card.suitSymbol}</span>
                </div>
                <div className="flex flex-col items-center my-auto">
                  <div className="text-4xl mb-1">{card.suitSymbol}</div>
                  <div className="font-extrabold text-xl leading-tight">{card.nombre}</div>
                  <div className="text-xs opacity-90 mt-1">{card.subtitulo}</div>
                </div>
                <div className="text-[11px] font-semibold bg-black/40 rounded py-1 px-1">
                  {card.objetivo}
                </div>
              </div>
            )}

            {/* Glowing inner border highlight */}
            <div 
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{
                boxShadow: `inset 0 0 14px ${getGlowColor()}`
              }}
            />
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ACTION OUTCOME DETAILS (Panel grande y legible del movimiento)*/}
      {/* ============================================================ */}
      {isFlipped && resultado && (
        <div 
          className={`relative z-30 ${short ? "mt-2 p-3" : "mt-4 p-4 sm:p-5"} max-w-[min(540px,calc(var(--vw)*92))] w-full bg-black/92 backdrop-blur-xl border-2 border-amber-400/90 rounded-2xl shadow-[0_16px_45px_rgba(0,0,0,0.95)] animate-in fade-in zoom-in-95 duration-300`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span 
                  className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold tracking-wider ${
                    resultado.tipo === "ATAQUE"
                      ? "bg-red-900/80 text-red-200 border border-red-500/50"
                      : resultado.tipo === "DEFENSA"
                      ? "bg-emerald-900/80 text-emerald-200 border border-emerald-500/50"
                      : "bg-amber-900/80 text-amber-200 border border-amber-500/50"
                  }`}
                >
                  {resultado.tipo}
                </span>

                {resultado.impacto && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400/20 text-amber-300 border border-amber-400/40">
                    {resultado.impacto}
                  </span>
                )}
              </div>

              {/* Action Title */}
              <h3 className={`${short ? "text-base" : "text-lg sm:text-xl"} font-black text-white drop-shadow tracking-wide`}>
                {resultado.titulo}
              </h3>

              {/* Action Detailed Movement Explanation */}
              <p className={`text-slate-200 ${short ? "text-xs" : "text-sm sm:text-base"} mt-1.5 leading-relaxed`}>
                {resultado.detalle}
              </p>
            </div>
          </div>

          {/* Bottom Bar: Countdown & Manual Continue Button */}
          <div className={`${short ? "mt-2 pt-2" : "mt-3 pt-3"} border-t border-amber-400/25 flex items-center justify-between gap-3`}>
            <div className="text-xs sm:text-sm text-amber-300/80 font-medium flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>Siguiente turno en <strong className="text-amber-300 text-base">{timeLeft}s</strong>...</span>
            </div>

            {esperando && (
              <span className="text-xs sm:text-sm text-slate-300 italic">Esperando al rival…</span>
            )}

            {onContinue && !esperando && (
              <button
                type="button"
                onClick={onContinue}
                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-black font-extrabold text-xs sm:text-sm shadow-[0_2px_10px_rgba(245,158,11,0.5)] cursor-pointer transition-all duration-150 flex items-center gap-1.5"
              >
                <span>Continuar</span>
                <span>▶</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

