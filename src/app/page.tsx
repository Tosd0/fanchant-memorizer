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
  memory: '记忆',
  recite: '跟唱',
};

export default function Home() {
  const [lrcText, setLrcText] = useState(sampleLrc);
  const [lines, setLines] = useState<LyricLine[]>(() => parseLrc(sampleLrc));
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [rememberIntro, setRememberIntro] = useState(true);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seen = window.localStorage.getItem('fanchantIntroSeen');
      setShowIntro(seen !== '1');
    } catch {
      setShowIntro(true);
    }
  }, []);

  const dismissIntro = useCallback(
    (persist: boolean) => {
      setShowIntro(false);
      if (!persist || typeof window === 'undefined') return;
      try {
        window.localStorage.setItem('fanchantIntroSeen', '1');
      } catch {
        // Ignore storage failures.
      }
    },
    []
  );

  const parsedPreview = useMemo(() => JSON.stringify(lines, null, 2), [lines]);

  return (
    <div className="relative min-h-screen overflow-hidden text-slate-900">
      <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-[radial-gradient(circle,#ffd5b5_0%,transparent_70%)] opacity-70 blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute -right-32 top-32 h-80 w-80 rounded-full bg-[radial-gradient(circle,#baf1ea_0%,transparent_70%)] opacity-70 blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute bottom-[-200px] left-1/3 h-96 w-96 rounded-full bg-[radial-gradient(circle,#ffd1de_0%,transparent_70%)] opacity-60 blur-[120px]" />

      <main className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-16 pt-10">
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="glass-panel flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-semibold text-slate-800 shadow-lg">
                FM
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Live Session
                </p>
                <h1 className="font-display text-3xl font-semibold text-slate-900 md:text-4xl">
                  Fanchant Memorizer
                </h1>
                <p className="text-sm text-slate-600">
                  把应援、节奏和歌词放在同一舞台：边听边记边练。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowIntro(true)}
                className="glass-subtle rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-700 transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                引导页
              </button>
              <ScoreBoard />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="glass-subtle inline-flex items-center gap-1 rounded-full p-1 text-xs">
              {(['memory', 'recite'] as GameMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleModeChange(option)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    mode === option
                      ? 'bg-slate-900 text-white shadow-lg'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {modeLabels[option]}
                </button>
              ))}
            </div>
            <div className="glass-subtle flex items-center gap-2 rounded-full px-4 py-2 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              节奏同步中 · 可点击歌词跳转
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="flex flex-col gap-4">
            <div className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '60ms' }}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">音频控台</h2>
                <span className="text-xs text-slate-500">
                  Current: <span ref={timeLabelRef}>0.00s</span>
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioChange}
                  className="text-xs text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-slate-900 file:px-3 file:py-1 file:text-xs file:text-white hover:file:bg-slate-800"
                />
                <audio ref={audioRef} src={audioUrl ?? undefined} controls className="w-full" />
              </div>
            </div>

            <div className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '120ms' }}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">歌词编辑</h2>
                <button
                  type="button"
                  onClick={handleParse}
                  className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white hover:bg-slate-800"
                >
                  Parse
                </button>
              </div>
              <textarea
                value={lrcText}
                onChange={(event) => setLrcText(event.target.value)}
                className="mt-3 h-44 w-full resize-none rounded-2xl border border-white/70 bg-white/80 p-4 text-xs text-slate-700 outline-none"
              />
            </div>

            <details className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '180ms' }}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                解析预览
              </summary>
              <pre className="mt-3 max-h-64 overflow-auto rounded-2xl border border-white/70 bg-white/70 p-3 text-[11px] text-slate-700">
                {parsedPreview}
              </pre>
            </details>

            <div className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '240ms' }}>
              <h3 className="text-sm font-semibold text-slate-800">本场提示</h3>
              <ul className="mt-3 space-y-2 text-xs text-slate-600">
                <li>记忆模式：听到时间点时点击对应行。</li>
                <li>跟唱模式：长按拖拽选中应援词。</li>
                <li>解析后可立即切换模式练习。</li>
              </ul>
            </div>
          </div>

          <div className="glass-panel animate-fade-up flex min-h-[70vh] flex-col rounded-[32px]">
            <div className="flex items-center justify-between border-b border-white/60 px-6 py-4">
              <h2 className="text-sm font-semibold text-slate-800">舞台视图</h2>
              <span className="text-xs text-slate-500">
                {mode === 'memory'
                  ? '点击歌词定位节奏'
                  : '拖拽选中歌词以显示应援'}
              </span>
            </div>
            <div className="flex-1">
              <LyricsView lines={lines} timeRef={timeRef} onSeek={seek} mode={mode} />
            </div>
          </div>
        </section>
      </main>

      {showIntro ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-6 py-10 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-panel animate-fade-up w-full max-w-3xl rounded-[32px] p-8 shadow-2xl">
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
                  Welcome
                </p>
                <h2 className="font-display text-3xl font-semibold text-slate-900">
                  把应援练到肌肉记忆
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  三步开始：导入音频、粘贴 LRC、选择练习模式。所有进度都会在右侧舞台同步显示。
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {[
                  { title: '导入音频', desc: '上传歌曲或练习片段，立刻同步时间轴。' },
                  { title: '粘贴 LRC', desc: '支持时间戳 + 应援标记，解析后可即时预览。' },
                  { title: '切换模式', desc: '记忆点击 / 跟唱拖选，两种练习节奏。' },
                ].map((step, index) => (
                  <div
                    key={step.title}
                    className="glass-subtle animate-fade-up rounded-2xl p-4 text-left text-sm text-slate-700"
                    style={{ animationDelay: `${120 + index * 80}ms` }}
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Step {index + 1}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{step.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{step.desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberIntro}
                    onChange={(event) => setRememberIntro(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 accent-slate-900"
                  />
                  下次直接进入练习
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => dismissIntro(false)}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 hover:border-slate-400"
                  >
                    先看看界面
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissIntro(rememberIntro)}
                    className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white hover:bg-slate-800"
                  >
                    进入练习
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
