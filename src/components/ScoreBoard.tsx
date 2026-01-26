'use client';

import { useMemo } from 'react';
import { useGameStore } from '@/stores/gameStore';

export const ScoreBoard = () => {
  const combo = useGameStore((state) => state.combo);
  const correctCount = useGameStore((state) => state.correctCount);
  const totalCount = useGameStore((state) => state.totalCount);

  const accuracy = useMemo(() => {
    if (totalCount === 0) return 0;
    return Math.round((correctCount / totalCount) * 100);
  }, [correctCount, totalCount]);

  return (
    <div className="glass-subtle flex flex-wrap items-center gap-3 rounded-full px-4 py-2 text-xs text-slate-700">
      <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
        Combo {combo}
      </span>
      <span className="text-slate-600">
        Hit {correctCount} / {totalCount}
      </span>
      <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
        {accuracy}% Accuracy
      </span>
    </div>
  );
};
