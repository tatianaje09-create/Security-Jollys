import React from "react";
import { Lock, Database, ShieldAlert, Heart } from "lucide-react";

interface TriadPillarsProps {
  playerName: string;
  lives: number; // 0 to 3
  isTurn: boolean;
  side: "left" | "right";
}

export const TriadPillars: React.FC<TriadPillarsProps> = ({
  playerName,
  lives,
  isTurn,
  side
}) => {
  // 3 lives represent the CIA Triad:
  // Life >= 3: all 3 intact
  // Life = 2: 1 pillar damaged
  // Life = 1: 2 pillars damaged
  // Life = 0: 3 pillars fallen (defeated)

  return (
    <div
      className={`relative p-3.5 sm:p-4 rounded-2xl border ${
        isTurn
          ? "border-amber-400/80 bg-[#121927]/90 shadow-[0_0_20px_rgba(251,191,36,0.25)]"
          : "border-slate-700/60 bg-[#0f141f]/70"
      } backdrop-blur-md transition-all duration-300 w-full max-w-xs`}
    >
      {/* Header with Name and Turn indicator */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 truncate">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isTurn ? "bg-amber-400 animate-ping" : "bg-slate-600"
            }`}
          />
          <h3 className="font-['Cinzel'] font-bold text-base sm:text-lg text-slate-100 tracking-wide truncate">
            {playerName}
          </h3>
        </div>
        {isTurn && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse font-['JetBrains_Mono']">
            En Turno
          </span>
        )}
      </div>

      {/* Hearts (Vidas) */}
      <div className="flex items-center justify-between bg-black/30 px-3 py-1.5 rounded-lg border border-white/5 mb-3">
        <span className="text-xs font-['Outfit'] font-semibold text-slate-400">
          Activos de Seguridad:
        </span>
        <div className="flex items-center gap-1">
          {[1, 2, 3].map((val) => {
            const isAlive = val <= lives;
            return (
              <Heart
                key={val}
                className={`w-5 h-5 transition-all duration-300 ${
                  isAlive
                    ? "text-rose-500 fill-rose-500 scale-100 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                    : "text-slate-700 fill-slate-900/40 scale-90"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Tríada CIA (Confidencialidad, Integridad, Disponibilidad) */}
      <div className="grid grid-cols-3 gap-1.5 text-center font-['JetBrains_Mono']">
        {/* Confidencialidad */}
        <div
          className={`p-1.5 rounded-lg border text-[11px] transition-all duration-200 ${
            lives >= 1
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
              : "bg-rose-950/40 border-rose-600/40 text-rose-300/80"
          }`}
          title="Confidencialidad: Antivirus vs Phishing"
        >
          <div className="flex items-center justify-center mb-0.5">
            <Lock className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold block text-[10px]">[C]</span>
          <span className="text-[9px] opacity-80 truncate block">Confid.</span>
        </div>

        {/* Integridad */}
        <div
          className={`p-1.5 rounded-lg border text-[11px] transition-all duration-200 ${
            lives >= 2
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
              : "bg-rose-950/40 border-rose-600/40 text-rose-300/80"
          }`}
          title="Integridad: 2FA vs Malware"
        >
          <div className="flex items-center justify-center mb-0.5">
            <Database className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold block text-[10px]">[I]</span>
          <span className="text-[9px] opacity-80 truncate block">Integ.</span>
        </div>

        {/* Disponibilidad */}
        <div
          className={`p-1.5 rounded-lg border text-[11px] transition-all duration-200 ${
            lives >= 3
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
              : "bg-rose-950/40 border-rose-600/40 text-rose-300/80"
          }`}
          title="Disponibilidad: Firewall vs DDoS"
        >
          <div className="flex items-center justify-center mb-0.5">
            <ShieldAlert className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold block text-[10px]">[D]</span>
          <span className="text-[9px] opacity-80 truncate block">Dispon.</span>
        </div>
      </div>
    </div>
  );
};
