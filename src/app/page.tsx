'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useAudioSync } from '@/hooks/useAudioSync';
import { parseLrc } from '@/lib/lrc/parseLrc';
import type { LyricLine } from '@/lib/lrc/types';

const sampleLrc = `[00:14.50] 向着明天大声尖叫
[00:14.50] [tt] <0,0> <300,2> <600,4> <900,6> <1200,8>
[00:14.50] [fc] <TWICE!, 1500, repeat>`;

const formatMs = (ms: number) => (ms / 1000).toFixed(2);

export default function Home() {
  const [lrcText, setLrcText] = useState(sampleLrc);
  const [lines, setLines] = useState<LyricLine[]>(() => parseLrc(sampleLrc));
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);

  const { audioRef } = useAudioSync({
    onFrame: (timeMs) => {
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent = `${formatMs(timeMs)}s`;
      }
    },
  });

  const handleParse = useCallback(() => {
    const parsed = parseLrc(lrcText);
    setLines(parsed);
    console.info('Parsed LRC', parsed);
  }, [lrcText]);

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
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-400">
            Phase 1 · Core Engine & Parser
          </p>
          <h1 className="text-2xl font-semibold">Fanchant Memorizer · Core Debug</h1>
          <p className="text-sm text-zinc-400">
            Upload audio, paste LRC, parse, and inspect the runtime structure.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
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

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">Parsed JSON</h2>
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-zinc-800 bg-black/40 p-3 text-[11px] text-zinc-200">
                {parsedPreview}
              </pre>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
            <h2 className="text-sm font-semibold text-zinc-200">Lyric Lines</h2>
            <div className="mt-4 space-y-3">
              {lines.length === 0 ? (
                <p className="text-xs text-zinc-500">No parsed lines yet.</p>
              ) : (
                lines.map((line) => (
                  <div
                    key={line.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3"
                  >
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>{formatMs(line.startTime)}s</span>
                      <span>{line.words.length} word tags</span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-100">{line.text}</p>
                    {line.fanchant ? (
                      <p className="mt-2 text-xs text-emerald-300">
                        Fanchant: {line.fanchant.content} · {line.fanchant.duration}ms · {line.fanchant.type}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
