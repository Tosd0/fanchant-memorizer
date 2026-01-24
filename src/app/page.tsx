'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { LyricsView } from '@/components/LyricsView';
import { ScoreBoard } from '@/components/ScoreBoard';
import { useAudioSync } from '@/hooks/useAudioSync';
import { parseLrc } from '@/lib/lrc/parseLrc';
import type { LyricLine } from '@/lib/lrc/types';
import { useGameStore, type GameMode } from '@/stores/gameStore';

const sampleLrc = `[00:07.50] One look give'em whiplash
[00:07.50] [tt] <0,0> <300,2> <600,4> <900,6> <1200,8>
[00:07.50] [fc] <yeah!, 1500, repeat>`;

const formatMs = (ms: number) => (ms / 1000).toFixed(2);
const modeLabels: Record<GameMode, string> = {
  memory: 'Memory',
  recite: 'Recite',
  judge: 'Judge',
};

export default function Home() {
  const [lrcText, setLrcText] = useState(sampleLrc);
  const [lines, setLines] = useState<LyricLine[]>(() => parseLrc(sampleLrc));
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const mode = useGameStore((state) => state.mode);
  const setMode = useGameStore((state) => state.setMode);
  const resetScore = useGameStore((state) => state.resetScore);

  const { audioRef, timeRef, seek } = useAudioSync({
    onFrame: (timeMs) => {
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent = `${formatMs(timeMs)}s`;
      }
    },
  });

  const handleParse = useCallback(() => {
    const parsed = parseLrc(lrcText);
    setLines(parsed);
    resetScore();
    console.info('Parsed LRC', parsed);
  }, [lrcText, resetScore]);

  const handleModeChange = useCallback(
    (nextMode: GameMode) => {
      setMode(nextMode);
      resetScore();
    },
    [resetScore, setMode]
  );

  const handleAudioChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const nextUrl = URL.createObjectURL(file);
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    },
    []
  );

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const parsedPreview = useMemo(() => JSON.stringify(lines, null, 2), [lines]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-400">
            Phase 3 · Interaction & Gameplay
          </p>
          <h1 className="text-2xl font-semibold">Fanchant Memorizer · Karaoke View</h1>
          <p className="text-sm text-zinc-400">
            Word-by-word highlight with recite & judge interactions.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-zinc-800 bg-zinc-900/70 p-1 text-xs">
              {(['memory', 'recite', 'judge'] as GameMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleModeChange(option)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    mode === option
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {modeLabels[option]}
                </button>
              ))}
            </div>
            <ScoreBoard />
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Audio Sync</h2>
                <span className="text-xs text-zinc-400">
                  Current Time: <span ref={timeLabelRef}>0.00s</span>
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioChange}
                  className="text-xs text-zinc-300 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-700 file:px-3 file:py-1 file:text-xs file:text-white hover:file:bg-zinc-600"
                />
                <audio ref={audioRef} src={audioUrl ?? undefined} controls className="w-full" />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">LRC Input</h2>
                <button
                  type="button"
                  onClick={handleParse}
                  className="rounded-full bg-zinc-700 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-600"
                >
                  Parse
                </button>
              </div>
              <textarea
                value={lrcText}
                onChange={(event) => setLrcText(event.target.value)}
                className="mt-3 h-40 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-200 outline-none"
              />
            </div>

            <details className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-200">
                Parsed JSON
              </summary>
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-black/40 p-3 text-[11px] text-zinc-200">
                {parsedPreview}
              </pre>
            </details>
          </div>

          <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-200">Lyrics View</h2>
              <span className="text-xs text-zinc-400">
                {mode === 'memory'
                  ? 'Click a line to seek'
                  : mode === 'recite'
                    ? 'Tap fanchant lines to hit'
                    : 'Tap fanchant lines to choose'}
              </span>
            </div>
            <div className="flex-1">
              <LyricsView lines={lines} timeRef={timeRef} onSeek={seek} mode={mode} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
