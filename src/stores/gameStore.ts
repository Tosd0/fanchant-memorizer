import { create } from 'zustand';

export type GameMode = 'memory' | 'recite' | 'judge';
export type GameResult = 'hit' | 'miss';

interface GameStore {
  mode: GameMode;
  combo: number;
  correctCount: number;
  totalCount: number;
  lastResult: GameResult | null;
  setMode: (mode: GameMode) => void;
  registerResult: (result: GameResult) => void;
  resetScore: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  mode: 'memory',
  combo: 0,
  correctCount: 0,
  totalCount: 0,
  lastResult: null,
  setMode: (mode) => set({ mode }),
  registerResult: (result) =>
    set((state) => {
      const correct = result === 'hit';
      return {
        combo: correct ? state.combo + 1 : 0,
        correctCount: state.correctCount + (correct ? 1 : 0),
        totalCount: state.totalCount + 1,
        lastResult: result,
      };
    }),
  resetScore: () => set({ combo: 0, correctCount: 0, totalCount: 0, lastResult: null }),
}));
