import { create } from 'zustand';

interface AudioStore {
  isPlaying: boolean;
  audioRef: HTMLAudioElement | null;
  setIsPlaying: (isPlaying: boolean) => void;
  setAudioRef: (audioRef: HTMLAudioElement | null) => void;
}

export const useAudioStore = create<AudioStore>((set) => ({
  isPlaying: false,
  audioRef: null,
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setAudioRef: (audioRef) => set({ audioRef }),
}));
