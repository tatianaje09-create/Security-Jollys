import React, { useState, useEffect } from "react";
import { Card, CardActionOutcome, LadoEncuentro } from "../types";
import { useViewport } from "../utils/viewport";

interface CardFlipRevealProps {
  card: Card; // carta del lado izquierdo (tú / jugador 1)
  playedBy: string;
  isFlipped: boolean;
  resultado?: CardActionOutcome; // resultado del lado izquierdo (o compartido si no hay `segunda.resultado`)
  segunda?: LadoEncuentro; // carta del lado derecho (IA / rival / jugador 2): las dos cartas se encuentran
  onContinue?: () => void;
  autoCloseDuration?: number; // default 10000ms (10 segundos)
  esperando?: boolean; // modo en línea: ya pulsé "Continuar" y espero al rival
}

// Colores según el tipo de carta
const glowColor = (tipo: Card["tipo"]) => {
  switch (tipo) {
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

const borderClass = (tipo: Card["tipo"]) => {
  switch (tipo) {
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

// ---------------------------------------------------------------------------
// Una carta que se pone boca abajo y se voltea (flip 3D) con su etiqueta encima
// ---------------------------------------------------------------------------
const CartaVolteable: React.FC<{
  card: Card;
  playedBy: string;
  isFlipped: boolean;
  dos: boolean; // hay dos cartas en la mesa: se dibujan un poco más chicas
  short: boolean;
}> = ({ card, playedBy, isFlipped, dos, short }) => {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [card.id]);

  return (
    <div className="relative z-20 flex flex-col items-center">
      {/* Etiqueta: quién la jugó y cuál es */}
      <div className={`${short ? "mb-1.5" : "mb-3"}`}>
        <div className="px-4 sm:px-6 py-1.5 sm:py-2 rounded-full bg-black/90 backdrop-blur-md border border-amber-400/80 shadow-[0_6px_22px_rgba(0,0,0,0.9)] text-white text-sm sm:text-lg font-bold tracking-wide flex items-center gap-2 transition-all duration-300">
          <span className="text-amber-400 text-base sm:text-lg">🃏</span>
          <span>
            {playedBy}:{" "}
            {isFlipped ? (
              <span className="text-amber-300 font-extrabold uppercase ml-1">{card.nombre}</span>
            ) : (
              <span className="text-slate-300 italic ml-1">Colocando carta...</span>
            )}
          </span>
        </div>
      </div>

      {/* 3D Card Turnover Container */}
      <div
        style={{
          perspective: "1200px",
          // Se adapta al alto de la pantalla para que en celulares chicos no tape la cabecera
          width: dos
            ? "min(175px, calc(var(--vh) * 21), calc(var(--vw) * 38))"
            : "min(195px, calc(var(--vh) * 24), calc(var(--vw) * 52))",
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
          {/* BACK FACE (El revés de la carta: dorso.png) */}
          <div
            className="absolute inset-0 w-full h-full rounded-xl overflow-hidden border-2 border-amber-400/80 shadow-[0_15px_35px_rgba(0,0,0,0.95)] bg-[#12141c]"
            style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          >
            <img
              src="/img/dorso.png"
              alt="Reverso de carta"
              className="w-full h-full object-cover rounded-xl select-none pointer-events-none"
              draggable={false}
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent pointer-events-none" />
          </div>

          {/* FRONT FACE (Carta descubierta) */}
          <div
            className={`absolute inset-0 w-full h-full rounded-xl border-3 ${borderClass(card.tipo)} shadow-[0_20px_45px_rgba(0,0,0,0.95)] bg-white flex flex-col items-center justify-center p-1 select-none`}
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
                <div className="text-[11px] font-semibold bg-black/40 rounded py-1 px-1">{card.objetivo}</div>
              </div>
            )}

            {/* Glowing inner border highlight */}
            <div
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{ boxShadow: `inset 0 0 14px ${glowColor(card.tipo)}` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel con el resultado (título, explicación, etiquetas)
// ---------------------------------------------------------------------------
const PanelResultado: React.FC<{
  resultado: CardActionOutcome;
  quien?: string; // se muestra cuando hay dos paneles, para saber de quién es cada uno
  short: boolean;
  ancho: string;
  children?: React.ReactNode; // barra inferior (cuenta atrás / continuar) cuando el panel es único
}> = ({ resultado, quien, short, ancho, children }) => (
  <div
    className={`relative z-30 ${short ? "p-3" : "p-4 sm:p-5"} w-full bg-black/92 backdrop-blur-xl border-2 border-amber-400/90 rounded-2xl shadow-[0_16px_45px_rgba(0,0,0,0.95)] animate-in fade-in zoom-in-95 duration-300`}
    style={{ maxWidth: ancho }}
  >
    <div className="flex items-center gap-2 flex-wrap mb-1">
      {quien && (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold tracking-wider bg-amber-400 text-black">
          {quien}
        </span>
      )}
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

    <h3 className={`${short ? "text-base" : "text-lg sm:text-xl"} font-black text-white drop-shadow tracking-wide`}>
      {resultado.titulo}
    </h3>

    <p className={`text-slate-200 ${short ? "text-xs" : "text-sm sm:text-base"} mt-1.5 leading-relaxed`}>
      {resultado.detalle}
    </p>

    {children}
  </div>
);

export const CardFlipReveal: React.FC<CardFlipRevealProps> = ({
  card,
  playedBy,
  isFlipped,
  resultado,
  segunda,
  onContinue,
  autoCloseDuration = 10000,
  esperando = false
}) => {
  const { h: viewH } = useViewport();
  const short = viewH <= 700; // pantallas bajas: textos y espacios más compactos
  const [timeLeft, setTimeLeft] = useState<number>(Math.ceil(autoCloseDuration / 1000));

  // Reset countdown when the cards change
  useEffect(() => {
    setTimeLeft(Math.ceil(autoCloseDuration / 1000));
  }, [card.id, segunda?.card.id, autoCloseDuration]);

  // Countdown timer for user peace of mind
  useEffect(() => {
    if (!isFlipped) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isFlipped]);

  const dos = !!segunda;
  // 2 jugadores: cada carta trae su propio resultado. 1 jugador: un resultado compartido.
  const dosPaneles = !!segunda?.resultado && !!resultado;
  const resultadoUnico = resultado ?? segunda?.resultado;

  // Barra inferior: cuenta atrás y botón "Continuar"
  const barra = (
    <div
      className={`${short ? "mt-2 pt-2" : "mt-3 pt-3"} border-t border-amber-400/25 flex items-center justify-between gap-3`}
    >
      <div className="text-xs sm:text-sm text-amber-300/80 font-medium flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping" />
        <span>
          Siguiente turno en <strong className="text-amber-300 text-base">{timeLeft}s</strong>...
        </span>
      </div>

      {esperando && <span className="text-xs sm:text-sm text-slate-300 italic">Esperando al rival…</span>}

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
  );

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center p-3 overflow-y-auto">
      {/* Subtle backdrop spotlight */}
      <div
        className="absolute w-[420px] h-[420px] rounded-full blur-[90px] pointer-events-none transition-all duration-700"
        style={{
          backgroundColor: isFlipped ? glowColor(card.tipo) : "rgba(245, 158, 11, 0.3)",
          opacity: 0.7
        }}
      />

      {/* Las dos cartas que se encuentran (o una sola) */}
      <div className={`relative z-20 flex items-start justify-center ${dos ? "gap-3 sm:gap-10" : ""}`}>
        <CartaVolteable card={card} playedBy={playedBy} isFlipped={isFlipped} dos={dos} short={short} />
        {segunda && (
          <CartaVolteable
            card={segunda.card}
            playedBy={segunda.playedBy}
            isFlipped={isFlipped}
            dos={dos}
            short={short}
          />
        )}
      </div>

      {/* ACTION OUTCOME DETAILS (Panel grande y legible del movimiento) */}
      {isFlipped && resultadoUnico && !dosPaneles && (
        <div className={`relative z-30 ${short ? "mt-2" : "mt-4"} w-full flex justify-center`}>
          <PanelResultado resultado={resultadoUnico} short={short} ancho="min(540px, calc(var(--vw) * 92))">
            {barra}
          </PanelResultado>
        </div>
      )}

      {isFlipped && dosPaneles && resultado && segunda?.resultado && (
        <div className={`relative z-30 ${short ? "mt-2" : "mt-4"} w-full flex flex-col items-center gap-2`}>
          <div className="w-full flex flex-wrap justify-center items-stretch gap-3">
            <PanelResultado
              resultado={resultado}
              quien={playedBy}
              short={short}
              ancho="min(440px, calc(var(--vw) * 92))"
            />
            <PanelResultado
              resultado={segunda.resultado}
              quien={segunda.playedBy}
              short={short}
              ancho="min(440px, calc(var(--vw) * 92))"
            />
          </div>
          <div className="w-full max-w-[min(900px,calc(var(--vw)*92))] bg-black/92 border-2 border-amber-400/90 rounded-2xl px-4 pb-3">
            {barra}
          </div>
        </div>
      )}
    </div>
  );
};
