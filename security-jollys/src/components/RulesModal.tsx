import React from "react";
import { 
  BookOpen, 
  ShieldAlert, 
  ShieldCheck, 
  Sparkles, 
  Flame, 
  Lock, 
  Database, 
  Activity 
} from "lucide-react";
import { MAZO_BASE } from "../utils/gameData";

interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-3xl max-h-[calc(var(--vh)*90)] overflow-y-auto rounded-2xl border-2 border-amber-500/50 bg-[#0c1220] text-slate-100 shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-['Cinzel'] font-bold text-xl text-white">
                Reglas de Security Jollys
              </h3>
              <p className="text-xs text-slate-400 font-['Outfit']">
                Ciberseguridad por Cartas: Domina la Tríada CIA
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="my-5 space-y-5 text-xs text-slate-300">
          {/* Tríada CIA */}
          <div className="p-4 rounded-xl bg-[#11192b] border border-slate-700/80">
            <h4 className="font-['Cinzel'] font-bold text-sm text-amber-300 mb-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Objetivo: Proteger tus 3 Activos (Tríada CIA)
            </h4>
            <p className="mb-3 leading-relaxed">
              Cada empresa (Empresa A vs Empresa B) comienza con <strong>3 vidas (corazones ♥)</strong> que representan los tres pilares de la seguridad de la información. Si una empresa pierde sus 3 vidas, es derrotada.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-['JetBrains_Mono']">
              <div className="p-2 rounded bg-black/40 border border-rose-500/30">
                <strong className="text-rose-400 block mb-1">Confidencialidad [C]</strong>
                <p className="text-slate-400">
                  Vulnerable a <strong>Phishing</strong>. Protegido por <strong>2FA</strong>.
                </p>
              </div>
              <div className="p-2 rounded bg-black/40 border border-amber-500/30">
                <strong className="text-amber-400 block mb-1">Integridad [I]</strong>
                <p className="text-slate-400">
                  Vulnerable a <strong>Malware</strong>. Protegido por <strong>Antivirus</strong>.
                </p>
              </div>
              <div className="p-2 rounded bg-black/40 border border-sky-500/30">
                <strong className="text-sky-400 block mb-1">Disponibilidad [D]</strong>
                <p className="text-slate-400">
                  Vulnerable a <strong>DDoS</strong>. Protegido por <strong>Firewall</strong>.
                </p>
              </div>
            </div>
          </div>

          {/* Cartas del Mazo */}
          <div>
            <h4 className="font-['Cinzel'] font-bold text-sm text-amber-300 mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              Cartas del Mazo (8 Tipos)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {MAZO_BASE.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-xl bg-black/30 border border-white/5 flex items-start gap-2.5"
                >
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase font-['JetBrains_Mono'] shrink-0 ${
                      c.tipo === "ATAQUE"
                        ? "bg-rose-950/60 text-rose-300 border border-rose-600/40"
                        : c.tipo === "DEFENSA"
                        ? "bg-emerald-950/60 text-emerald-300 border border-emerald-600/40"
                        : "bg-amber-950/60 text-amber-300 border border-amber-600/40"
                    }`}
                  >
                    {c.tipo}
                  </span>
                  <div>
                    <div className="font-['Cinzel'] font-bold text-white text-xs flex items-center gap-1.5">
                      <span>{c.nombre}</span>
                      <span className="text-[10px] text-slate-400 font-['JetBrains_Mono']">
                        ({c.probBase}% prob.)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {c.descripcion}
                    </p>
                    <span className="text-[10px] text-amber-400/90 font-['JetBrains_Mono'] mt-1 block">
                      Efecto: {c.objetivo}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rondas y Mesa */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/5">
            <h4 className="font-['Cinzel'] font-bold text-xs text-amber-300 uppercase tracking-wider mb-1">
              Dinámica de Rondas y Mesa
            </h4>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
              <li>Cada jugador tiene 3 cartas en su mano y 3 cartas en su mesa.</li>
              <li>Al jugar una carta, se retira de la mano y se gasta 1 carta de la mesa.</li>
              <li>Cuando la mano se vacía, se reparten 3 nuevas cartas al azar del mazo.</li>
              <li>Cuando ambos jugadores agotan sus 3 cartas de mesa, comienza una <strong>Nueva Ronda</strong> y regresan las 6 cartas a la mesa.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-slate-700/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-['Cinzel'] transition-colors"
          >
            Cerrar Guía
          </button>
        </div>
      </div>
    </div>
  );
};
