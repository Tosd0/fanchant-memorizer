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
    <div className="flex flex-wrap items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/70 px-4 py-2 text-xs text-zinc-200">
      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
        Combo {combo}
      </span>
      <span className="text-zinc-400">
        Hit {correctCount} / {totalCount}
      </span>
      <span className="text-zinc-400">{accuracy}%</span>
    </div>
  );
};
