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
[00:07.50] [fc] <repeat, yeah!, 1500>`;

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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Stage 3 · UI Draft</p>
          <h1 className="text-2xl font-semibold">Fanchant Memorizer · Minimal UI Pass</h1>
          <p className="text-sm text-slate-500">
            横版布局测试：左侧调试面板，右侧歌词居中 + 下划线进度。
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-xs">
              {(['memory', 'recite', 'judge'] as GameMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleModeChange(option)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    mode === option
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {modeLabels[option]}
                </button>
              ))}
            </div>
            <ScoreBoard />
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.4)]">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">Audio</h2>
                <span className="text-xs text-slate-500">
                  Current: <span ref={timeLabelRef}>0.00s</span>
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioChange}
                  className="text-xs text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-slate-900 file:px-3 file:py-1 file:text-xs file:text-white hover:file:bg-slate-800"
                />
                <audio ref={audioRef} src={audioUrl ?? undefined} controls className="w-full" />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.4)]">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">LRC</h2>
                <button
                  type="button"
                  onClick={handleParse}
                  className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Parse
                </button>
              </div>
              <textarea
                value={lrcText}
                onChange={(event) => setLrcText(event.target.value)}
                className="mt-3 h-40 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 outline-none"
              />
            </div>

            <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-20px_rgba(15,23,42,0.4)]">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                Parsed JSON
              </summary>
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700">
                {parsedPreview}
              </pre>
            </details>
          </div>

          <div className="flex min-h-[70vh] flex-col rounded-[32px] border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-slate-700">Lyrics View</h2>
              <span className="text-xs text-slate-400">
                {mode === 'memory'
                  ? 'Click a line to seek'
                  : mode === 'recite'
                    ? 'Drag-select lyric words to reveal fanchant'
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
