import React from "react";
import { GameLogEntry } from "../types";
import { History, Shield, Flame, Zap, RefreshCw, Info } from "lucide-react";

interface CombatLogDrawerProps {
  logs: GameLogEntry[];
  isOpen: boolean;
  onToggle: () => void;
}

export const CombatLogDrawer: React.FC<CombatLogDrawerProps> = ({
  logs,
  isOpen,
  onToggle
}) => {
  const getLogIcon = (tipo: GameLogEntry["tipo"]) => {
    switch (tipo) {
      case "ataque-exito":
        return <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
      case "ataque-fallo":
        return <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
      case "defensa":
        return <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case "jolly":
        return <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
      case "ronda":
        return <RefreshCw className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
      default:
        return <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 hover:bg-black/70 border border-slate-700/80 text-xs font-['JetBrains_Mono'] text-slate-300 hover:text-white transition-all shadow"
      >
        <History className="w-3.5 h-3.5 text-amber-400" />
        <span>Historial ({logs.length})</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 bottom-12 w-80 sm:w-96 max-h-80 overflow-y-auto z-40 rounded-xl border border-slate-700 bg-[#0d1320]/95 backdrop-blur-md p-3 shadow-2xl space-y-1.5 font-['JetBrains_Mono'] text-xs">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="font-['Cinzel'] font-bold text-amber-300 text-xs">
              Registro de Operaciones
            </span>
            <button
              onClick={onToggle}
              className="text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>

          <div className="space-y-1 pt-1">
            {logs.length === 0 ? (
              <p className="text-slate-500 italic text-[11px] text-center py-4">
                No hay movimientos registrados aún.
              </p>
            ) : (
              [...logs].reverse().map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 p-1.5 rounded bg-black/40 border border-white/5 text-[11px] text-slate-300"
                >
                  <div className="mt-0.5">{getLogIcon(entry.tipo)}</div>
                  <div className="flex-1 leading-snug">
                    <span>{entry.texto}</span>
                    <span className="block text-[9px] text-slate-500 mt-0.5">
                      {entry.timestamp}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
