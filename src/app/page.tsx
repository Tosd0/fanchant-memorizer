'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { LyricsView } from '@/components/LyricsView';
import { ScoreBoard } from '@/components/ScoreBoard';
import { useAudioSync } from '@/hooks/useAudioSync';
import { parseId3Tags } from '@/lib/audio/id3';
import { parseLrc } from '@/lib/lrc/parseLrc';
import type { LyricLine } from '@/lib/lrc/types';
import { useAudioStore } from '@/stores/audioStore';
import { useGameStore, type GameMode } from '@/stores/gameStore';

const sampleLrc = `[00:07.50] One look give'em whiplash
[00:07.50] [tt] <0,0> <300,2> <600,4> <900,6> <1200,8>
[00:07.50] [fc] <repeat, yeah!, 1500>`;

const formatMs = (ms: number) => (ms / 1000).toFixed(2);

const fallbackTrackInfo = {
  title: '未选择音频',
  artist: '—',
  album: '—',
};

const modeLabels: Record<GameMode, string> = {
  memory: '记忆',
  recite: '跟唱',
};

export default function Home() {
  const [lrcText, setLrcText] = useState(sampleLrc);
  const [lines, setLines] = useState<LyricLine[]>(() => parseLrc(sampleLrc));
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [trackInfo, setTrackInfo] = useState(fallbackTrackInfo);
  const [showIntro, setShowIntro] = useState(false);
  const [rememberIntro, setRememberIntro] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const progressLabelRef = useRef<HTMLSpanElement | null>(null);
  const mode = useGameStore((state) => state.mode);
  const setMode = useGameStore((state) => state.setMode);
  const resetScore = useGameStore((state) => state.resetScore);
  const audioElement = useAudioStore((state) => state.audioRef);
  const isPlaying = useAudioStore((state) => state.isPlaying);

  const handleFrame = useCallback(
    (timeMs: number) => {
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent = `${formatMs(timeMs)}s`;
      }
      const durationMs = audioElement?.duration ? audioElement.duration * 1000 : 0;
      if (progressLabelRef.current) {
        progressLabelRef.current.textContent = durationMs
          ? `${formatMs(timeMs)} / ${formatMs(durationMs)}`
          : `${formatMs(timeMs)} / --`;
      }
      if (progressBarRef.current) {
        const percent = durationMs > 0 ? Math.min((timeMs / durationMs) * 100, 100) : 0;
        progressBarRef.current.style.width = `${percent}%`;
      }
    },
    [audioElement]
  );

  const { audioRef, timeRef, seek } = useAudioSync({ onFrame: handleFrame });

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
      file
        .arrayBuffer()
        .then((buffer) => {
          const tags = parseId3Tags(buffer);
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          setTrackInfo({
            title: tags.title || baseName || fallbackTrackInfo.title,
            artist: tags.artist || fallbackTrackInfo.artist,
            album: tags.album || fallbackTrackInfo.album,
          });
        })
        .catch(() => {
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          setTrackInfo({
            title: baseName || fallbackTrackInfo.title,
            artist: fallbackTrackInfo.artist,
            album: fallbackTrackInfo.album,
          });
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedTheme = window.localStorage.getItem('fanchantTheme');
      if (storedTheme === 'light' || storedTheme === 'dark') {
        setTheme(storedTheme);
        return;
      }
    } catch {
      // Ignore storage failures.
    }
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('theme-dark', theme === 'dark');
  }, [theme]);

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

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('fanchantTheme', next);
        } catch {
          // Ignore storage failures.
        }
      }
      return next;
    });
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: 'var(--app-bg)' }}>
      <div
        className={`pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-[radial-gradient(circle,#ffd5b5_0%,transparent_70%)] blur-3xl animate-float-slow ${
          theme === 'dark' ? 'opacity-40' : 'opacity-70'
        }`}
      />
      <div
        className={`pointer-events-none absolute -right-32 top-32 h-80 w-80 rounded-full bg-[radial-gradient(circle,#baf1ea_0%,transparent_70%)] blur-3xl animate-float-slow ${
          theme === 'dark' ? 'opacity-35' : 'opacity-70'
        }`}
      />
      <div
        className={`pointer-events-none absolute bottom-[-200px] left-1/3 h-96 w-96 rounded-full bg-[radial-gradient(circle,#ffd1de_0%,transparent_70%)] blur-[120px] ${
          theme === 'dark' ? 'opacity-35' : 'opacity-60'
        }`}
      />

      <div className="fixed left-0 right-0 top-0 z-50">
        <div className="pt-[env(safe-area-inset-top)]">
          <div className="glass-panel mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-3">
            <div className="flex items-center gap-4">
              <span className="chip rounded-full px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.2em]">
                {isPlaying ? '播放中' : '暂停'}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-[color:var(--text-primary)]">
                  {trackInfo.title}
                </span>
                <span className="text-xs text-[color:var(--text-muted)]">
                  {trackInfo.artist} · {trackInfo.album}
                </span>
              </div>
            </div>
            <span ref={progressLabelRef} className="text-xs text-[color:var(--text-muted)]">
              0.00 / --
            </span>
          </div>
          <div className="h-1 w-full bg-[color:var(--panel-border-subtle)]">
            <div
              ref={progressBarRef}
              className="h-full w-0 bg-gradient-to-r from-[color:var(--sunset-500)] via-[color:var(--amber-400)] to-[color:var(--teal-500)] transition-[width] duration-150 ease-linear"
            />
          </div>
        </div>
      </div>

      <main className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-16 pt-[calc(96px+env(safe-area-inset-top))]">
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="glass-panel flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-semibold shadow-lg">
                FM
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--text-soft)]">
                  v 1.0.0
                </p>
                <h1 className="font-display text-3xl font-semibold md:text-4xl">
                  Fanchant Memorizer
                </h1>
                <p className="text-sm text-[color:var(--text-muted)]">
                  可交互的应援练习工具！
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowIntro(true)}
                className="glass-subtle rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[color:var(--text-primary)] transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                引导页
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="glass-subtle rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[color:var(--text-primary)] transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                {theme === 'dark' ? '白天模式' : '夜间模式'}
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
                      : 'text-[color:var(--text-soft)] hover:text-[color:var(--text-primary)]'
                  }`}
                >
                  {modeLabels[option]}
                </button>
              ))}
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="flex flex-col gap-4">
            <div className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '60ms' }}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">音频控台</h2>
                <span className="text-xs text-[color:var(--text-soft)]">
                  Current: <span ref={timeLabelRef}>0.00s</span>
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioChange}
                  className="text-xs text-[color:var(--text-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-slate-900 file:px-3 file:py-1 file:text-xs file:text-white hover:file:bg-slate-800"
                />
                <audio ref={audioRef} src={audioUrl ?? undefined} controls className="w-full" />
              </div>
            </div>

            <div className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '120ms' }}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">歌词编辑</h2>
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
                className="mt-3 h-44 w-full resize-none rounded-2xl border border-[color:var(--panel-border-subtle)] bg-[color:var(--panel-bg-subtle)] p-4 text-xs text-[color:var(--text-muted)] outline-none"
              />
            </div>

            <div className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '180ms' }}>
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">提示</h3>
              <ul className="mt-3 space-y-2 text-xs text-[color:var(--text-muted)]">
                <li>记忆模式：听到时间点时点击对应行。</li>
                <li>跟唱模式：长按拖拽选中应援词。</li>
                <li>解析后可立即切换模式练习。</li>
              </ul>
            </div>
          </div>

          <div className="glass-panel animate-fade-up flex h-[420px] flex-col overflow-hidden rounded-[32px] sm:h-[480px] lg:h-[520px]">
            <div className="flex items-center justify-between border-b border-[color:var(--panel-border)] px-6 py-4">
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">歌词</h2>
              <span className="text-xs text-[color:var(--text-soft)]">
                {mode === 'memory'
                  ? '点击歌词定位节奏'
                  : '拖拽选中歌词以显示应援'}
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <LyricsView lines={lines} timeRef={timeRef} onSeek={seek} mode={mode} />
            </div>
          </div>
        </section>
      </main>

      {showIntro ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--overlay-bg)] px-6 py-10 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-panel animate-fade-up w-full max-w-3xl rounded-[32px] p-8 shadow-2xl">
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-[color:var(--text-soft)]">
                  Welcome
                </p>
                <h2 className="font-display text-3xl font-semibold">
                  把应援练到肌肉记忆
                </h2>
                <p className="mt-2 text-sm text-[color:var(--text-muted)]">
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
                    className="glass-subtle animate-fade-up rounded-2xl p-4 text-left text-sm text-[color:var(--text-muted)]"
                    style={{ animationDelay: `${120 + index * 80}ms` }}
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--text-soft)]">
                      Step {index + 1}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[color:var(--text-primary)]">{step.title}</p>
                    <p className="mt-1 text-xs text-[color:var(--text-muted)]">{step.desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <label className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={rememberIntro}
                    onChange={(event) => setRememberIntro(event.target.checked)}
                    className="h-4 w-4 rounded border-[color:var(--panel-border-subtle)] text-[color:var(--text-primary)] accent-amber-400"
                  />
                  下次直接进入练习
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => dismissIntro(false)}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-muted)] hover:border-slate-400"
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
