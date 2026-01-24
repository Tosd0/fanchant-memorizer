'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioStore } from '@/stores/audioStore';

interface UseAudioSyncOptions {
  onFrame?: (timeMs: number) => void;
}

export const useAudioSync = (options: UseAudioSyncOptions = {}) => {
  const { onFrame } = options;
  const onFrameRef = useRef<UseAudioSyncOptions['onFrame']>(onFrame);
  const timeRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [element, setElement] = useState<HTMLAudioElement | null>(null);

  const setAudioRef = useAudioStore((state) => state.setAudioRef);
  const setIsPlaying = useAudioStore((state) => state.setIsPlaying);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const attachRef = useCallback(
    (node: HTMLAudioElement | null) => {
      audioRef.current = node;
      setElement(node);
      setAudioRef(node);
    },
    [setAudioRef]
  );

  useEffect(() => {
    if (!element) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    element.addEventListener('play', handlePlay);
    element.addEventListener('pause', handlePause);
    element.addEventListener('ended', handlePause);

    return () => {
      element.removeEventListener('play', handlePlay);
      element.removeEventListener('pause', handlePause);
      element.removeEventListener('ended', handlePause);
    };
  }, [element, setIsPlaying]);

  useEffect(() => {
    if (!element) return;

    let rafId = 0;
    let active = true;

    const tick = () => {
      if (!active) return;
      timeRef.current = element.currentTime * 1000;
      onFrameRef.current?.(timeRef.current);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [element]);

  const seek = useCallback((timeMs: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = timeMs / 1000;
  }, []);

  return {
    audioRef: attachRef,
    timeRef,
    seek,
  };
};
