'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { LyricsView } from '@/components/LyricsView';
import { ScoreBoard } from '@/components/ScoreBoard';
import type { CreateSelection } from '@/components/KaraokeLine';
import { useAudioSync } from '@/hooks/useAudioSync';
import { parseId3Tags } from '@/lib/audio/id3';
import { parseLrc } from '@/lib/lrc/parseLrc';
import { serializeLrc } from '@/lib/lrc/serializeLrc';
import type { FanchantTag, LyricLine } from '@/lib/lrc/types';
import { useAudioStore } from '@/stores/audioStore';
import { useGameStore, type GameMode } from '@/stores/gameStore';

const sampleLrc = `[00:07.50] One look give'em whiplash
[00:07.50] [tt] <0,0> <300,2> <600,4> <900,6> <1200,8>
[00:07.50] [fc] <repeat, yeah!, 1500>`;

const formatMs = (ms: number) => (ms / 1000).toFixed(2);

const initialLines = parseLrc(sampleLrc);

const fallbackTrackInfo = {
  title: '未选择音频',
  artist: '—',
  album: '—',
};

const modeLabels: Record<GameMode, string> = {
  memory: '记忆',
  recite: '跟唱',
  edit: '编辑',
};

export default function Home() {
  const [lrcText, setLrcText] = useState(sampleLrc);
  const [lines, setLines] = useState<LyricLine[]>(() => initialLines);
  const [hasWordTags, setHasWordTags] = useState(() =>
    initialLines.some((line) => line.words.length > 0)
  );
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [trackInfo, setTrackInfo] = useState(fallbackTrackInfo);
  const [showIntro, setShowIntro] = useState(false);
  const [rememberIntro, setRememberIntro] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [showWordTagNotice, setShowWordTagNotice] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateSelection | null>(null);
  const [createMode, setCreateMode] = useState<'repeat' | 'custom' | 'cheer'>('repeat');
  const [customFanchant, setCustomFanchant] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [lrcNotice, setLrcNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(
    null
  );
  const lrcFileInputRef = useRef<HTMLInputElement | null>(null);
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

  const applyParsedLines = useCallback(
    (parsed: LyricLine[]) => {
      setLines(parsed);
      resetScore();
      setCreateDraft(null);
      setCreateMode('repeat');
      setCustomFanchant('');
      setCreateError(null);
      const nextHasTags = parsed.some((line) => line.words.length > 0);
      setHasWordTags(nextHasTags);
      if (!nextHasTags) {
        setShowWordTagNotice(true);
        if (mode === 'edit') {
          setMode('memory');
        }
      } else {
        setShowWordTagNotice(false);
      }
      const fanchantCount = parsed.reduce((total, line) => total + line.fanchants.length, 0);
      const translationCount = parsed.filter((line) => line.translation).length;
      setLrcNotice(
        parsed.length === 0
          ? { tone: 'error', text: '未解析出歌词行，请检查 LRC 内容。' }
          : {
              tone: 'info',
              text: `已解析 ${parsed.length} 行歌词 · ${fanchantCount} 条应援${
                translationCount > 0 ? ` · ${translationCount} 条翻译` : ''
              }`,
            }
      );
      console.info('Parsed LRC', parsed);
    },
    [mode, resetScore, setMode]
  );

  const handleParse = useCallback(() => {
    applyParsedLines(parseLrc(lrcText));
  }, [applyParsedLines, lrcText]);

  const loadLrcText = useCallback(
    (text: string) => {
      setLrcText(text);
      applyParsedLines(parseLrc(text));
    },
    [applyParsedLines]
  );

  const handleLrcFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      file
        .text()
        .then((text) => loadLrcText(text))
        .catch(() => {
          setLrcNotice({ tone: 'error', text: '读取歌词文件失败，请重试。' });
        });
    },
    [loadLrcText]
  );

  const handleLoadSample = useCallback(() => {
    fetch('/whatislove.lrc')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => loadLrcText(text))
      .catch(() => {
        setLrcNotice({ tone: 'error', text: '示例歌词加载失败，请刷新后重试。' });
      });
  }, [loadLrcText]);

  const handleExportLrc = useCallback(() => {
    if (lines.length === 0) return;
    const content = `${serializeLrc(lines)}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeTitle = trackInfo.title
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
    anchor.href = url;
    anchor.download = `${
      safeTitle && trackInfo.title !== fallbackTrackInfo.title ? safeTitle : 'fanchant'
    }.lrc`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [lines, trackInfo.title]);

  const handleModeChange = useCallback(
    (nextMode: Exclude<GameMode, 'edit'>) => {
      setCreateDraft(null);
      setCreateError(null);
      setMode(nextMode);
      resetScore();
    },
    [resetScore, setMode]
  );

  const handleEditToggle = useCallback(() => {
    if (mode === 'edit') {
      setCreateDraft(null);
      setCreateError(null);
      setMode('memory');
      resetScore();
      return;
    }
    if (!hasWordTags) {
      setShowWordTagNotice(true);
      return;
    }
    setCreateDraft(null);
    setCreateError(null);
    setMode('edit');
    resetScore();
  }, [hasWordTags, mode, resetScore, setMode]);

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

  const handleCreateSelection = useCallback((selection: CreateSelection) => {
    setCreateDraft(selection);
    setCreateMode('repeat');
    setCustomFanchant('');
    setCreateError(null);
  }, []);

  const closeCreateModal = useCallback(() => {
    setCreateDraft(null);
    setCreateError(null);
  }, []);

  const applyCreateFanchant = useCallback(() => {
    if (!createDraft) return;
    const trimmedCustom = customFanchant.trim();
    if (createMode === 'custom' && trimmedCustom.length === 0) {
      setCreateError('请输入应援词。');
      return;
    }
    const startOffset = Math.max(createDraft.startOffset, 0);
    const endOffset = Math.max(createDraft.endOffset, startOffset + 1);
    const duration = Math.max(endOffset - startOffset, 1);
    const type = createMode === 'repeat' ? 'repeat' : createMode === 'custom' ? 'diff' : 'cheer';
    const content =
      createMode === 'custom'
        ? trimmedCustom
        : createMode === 'repeat'
          ? createDraft.selectedText
          : 'cheer';
    const isTailSelection = createDraft.selectedIndices.includes(createDraft.totalUnits - 1);
    const useAutoDuration =
      isTailSelection && (createMode === 'repeat' || createMode === 'custom');
    const startTime = createDraft.line.startTime + startOffset;
    const currentLineIndex = lines.findIndex((line) => line.id === createDraft.line.id);
    const nextLineStart =
      currentLineIndex >= 0
        ? lines[currentLineIndex + 1]?.startTime ?? createDraft.line.startTime + 2000
        : createDraft.line.startTime + 2000;
    const resolvedDuration = useAutoDuration
      ? Math.max(Math.max(nextLineStart, startTime + 400) - startTime, 1)
      : duration;
    const fanchant: FanchantTag = {
      content,
      duration: resolvedDuration,
      type,
      startTime,
      endTime: startTime + resolvedDuration,
      fullLine: createDraft.selectedIndices.length === createDraft.totalUnits,
      ...(useAutoDuration ? { autoDuration: true } : {}),
    };
    const nextLines = lines.map((line) => {
      if (line.id !== createDraft.line.id) return line;
      // Replace fanchants that overlap the new window; keep the rest of the line's chants.
      const kept = line.fanchants.filter(
        (existing) =>
          existing.endTime <= fanchant.startTime || existing.startTime >= fanchant.endTime
      );
      const nextFanchants = [...kept, fanchant].sort((a, b) => a.startTime - b.startTime);
      return { ...line, fanchants: nextFanchants };
    });
    setLines(nextLines);
    setLrcText(serializeLrc(nextLines));
    setCreateDraft(null);
    setCreateError(null);
  }, [createDraft, createMode, customFanchant, lines]);

  const selectionStartMs = createDraft
    ? createDraft.line.startTime + createDraft.startOffset
    : 0;
  const selectionDuration = createDraft
    ? Math.max(createDraft.endOffset - createDraft.startOffset, 1)
    : 0;
  const createConfirmDisabled = createMode === 'custom' && customFanchant.trim().length === 0;

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
          <div className="mx-auto w-full max-w-7xl px-6">
            <div className="glass-panel flex w-full items-center justify-between gap-4 px-6 py-3">
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
              {(['memory', 'recite'] as Exclude<GameMode, 'edit'>[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleModeChange(option)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    mode === option
                      ? 'bg-[color:var(--btn-solid-bg)] text-[color:var(--btn-solid-text)] shadow-lg'
                      : 'text-[color:var(--text-soft)] hover:text-[color:var(--text-primary)]'
                  }`}
                >
                  {modeLabels[option]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleEditToggle}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                mode === 'edit'
                  ? 'bg-[color:var(--accent-bg)] text-[color:var(--accent-text)] shadow-lg hover:bg-[color:var(--accent-bg-hover)]'
                  : 'glass-subtle text-[color:var(--text-primary)] hover:-translate-y-0.5 hover:shadow-lg'
              }`}
            >
              {mode === 'edit' ? '退出编辑' : '编辑'}
            </button>
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
                  className="text-xs text-[color:var(--text-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[color:var(--btn-solid-bg)] file:px-3 file:py-1 file:text-xs file:text-[color:var(--btn-solid-text)] hover:file:bg-[color:var(--btn-solid-bg-hover)]"
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
                  className="rounded-full bg-[color:var(--btn-solid-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--btn-solid-text)] hover:bg-[color:var(--btn-solid-bg-hover)]"
                >
                  Parse
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  ref={lrcFileInputRef}
                  type="file"
                  accept=".lrc,.txt,text/plain"
                  onChange={handleLrcFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => lrcFileInputRef.current?.click()}
                  className="rounded-full border border-[color:var(--btn-soft-border)] px-3 py-1 text-xs font-semibold text-[color:var(--text-muted)] transition hover:border-[color:var(--btn-soft-border-hover)] hover:text-[color:var(--text-primary)]"
                >
                  导入 .lrc
                </button>
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="rounded-full border border-[color:var(--btn-soft-border)] px-3 py-1 text-xs font-semibold text-[color:var(--text-muted)] transition hover:border-[color:var(--btn-soft-border-hover)] hover:text-[color:var(--text-primary)]"
                >
                  载入示例
                </button>
                <button
                  type="button"
                  onClick={handleExportLrc}
                  disabled={lines.length === 0}
                  className="rounded-full border border-[color:var(--btn-soft-border)] px-3 py-1 text-xs font-semibold text-[color:var(--text-muted)] transition hover:border-[color:var(--btn-soft-border-hover)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  导出 .lrc
                </button>
              </div>
              {lrcNotice ? (
                <p
                  className={`mt-2 text-xs font-semibold ${
                    lrcNotice.tone === 'error' ? 'text-rose-500' : 'text-emerald-600'
                  }`}
                >
                  {lrcNotice.text}
                </p>
              ) : null}
              <textarea
                value={lrcText}
                onChange={(event) => setLrcText(event.target.value)}
                className="mt-3 h-44 w-full resize-none rounded-2xl border border-[color:var(--panel-border-subtle)] bg-[color:var(--panel-bg-subtle)] p-4 text-xs text-[color:var(--text-muted)] outline-none"
              />
            </div>

            <div className="glass-panel animate-fade-up rounded-3xl p-5" style={{ animationDelay: '180ms' }}>
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">提示</h3>
              <ul className="mt-3 space-y-2 text-xs text-[color:var(--text-muted)]">
                <li>可导入原 .lrc 歌词文件，[fc] 应援标记自动解析。</li>
                <li>记忆模式：听到时间点时点击对应行。</li>
                <li>跟唱模式：长按拖拽选中应援词。</li>
                <li>编辑模式：可新增、覆盖、补全应援词。</li>
                <li>编辑完成后可导出 .lrc 保存应援标记。</li>
              </ul>
            </div>
          </div>

          <div className="glass-panel animate-fade-up flex h-[420px] flex-col overflow-hidden rounded-[32px] sm:h-[480px] lg:h-[520px]">
            <div className="flex items-center justify-between border-b border-[color:var(--panel-border)] px-6 py-4">
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">歌词</h2>
              <span className="text-xs text-[color:var(--text-soft)]">
                {mode === 'memory'
                  ? '点击歌词定位节奏'
                  : mode === 'recite'
                    ? '拖拽选中歌词以显示应援'
                    : '选中歌词并编辑应援词'}
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <LyricsView
                lines={lines}
                timeRef={timeRef}
                onSeek={seek}
                mode={mode}
                onCreateSelection={handleCreateSelection}
              />
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
                  三步开始：导入音频、粘贴 LRC、选择练习或编辑模式。所有进度都会在右侧舞台同步显示。
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {[
                  { title: '导入音频', desc: '上传歌曲或练习片段，立刻同步时间轴。' },
                  { title: '导入歌词', desc: '上传原 .lrc 文件或粘贴文本，[tt]/[fc]/[tr] 标记自动解析。' },
                  { title: '切换模式', desc: '记忆点击 / 跟唱拖选 / 编辑应援，改完可导出 .lrc。' },
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
                    className="rounded-full border border-[color:var(--btn-soft-border)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-muted)] hover:border-[color:var(--btn-soft-border-hover)]"
                  >
                    先看看界面
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissIntro(rememberIntro)}
                    className="rounded-full bg-[color:var(--btn-solid-bg)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--btn-solid-text)] hover:bg-[color:var(--btn-solid-bg-hover)]"
                  >
                    进入练习
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showWordTagNotice ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--overlay-bg)] px-6 py-10 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-panel w-full max-w-lg rounded-[28px] p-6 shadow-2xl">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--text-soft)]">
                  注意
                </p>
                <h3 className="mt-2 text-lg font-semibold">需要逐词歌词标签</h3>
                <p className="mt-2 text-sm text-[color:var(--text-muted)]">
                  当前 LRC 中未检测到 [tt] 逐词标记。请先找到带逐词时间的歌词，再进行应援编辑。
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowWordTagNotice(false)}
                  className="rounded-full bg-[color:var(--btn-solid-bg)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--btn-solid-text)] hover:bg-[color:var(--btn-solid-bg-hover)]"
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {createDraft ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--overlay-bg)] px-6 py-10 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="glass-panel w-full max-w-2xl rounded-[32px] p-7 shadow-2xl">
            <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--text-soft)]">
                    应援编辑
                  </p>
                  <h3 className="mt-2 text-xl font-semibold">填写应援词信息</h3>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-full border border-[color:var(--panel-border-subtle)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-muted)] hover:border-[color:var(--btn-soft-border-hover)]"
                >
                  关闭
                </button>
              </div>

              <div className="rounded-2xl border border-[color:var(--panel-border-subtle)] bg-[color:var(--panel-bg-subtle)] p-4 text-xs text-[color:var(--text-muted)]">
                <p>
                  歌词行：<span className="text-[color:var(--text-primary)]">{createDraft.line.text}</span>
                </p>
                <p className="mt-2">
                  已选词：<span className="text-[color:var(--text-primary)]">{createDraft.selectedText}</span>
                </p>
                <p className="mt-2">
                  起始时间：{formatMs(selectionStartMs)}s · 时长：{formatMs(selectionDuration)}s
                </p>
              </div>

              <div className="grid gap-3 text-xs">
                {[
                  { key: 'repeat', label: '重复', desc: '自动使用选中的歌词' },
                  { key: 'custom', label: '自定义', desc: '输入你想要的应援词' },
                  { key: 'cheer', label: '欢呼', desc: '标记为欢呼段落' },
                ].map((option) => (
                  <label
                    key={option.key}
                    className={`flex cursor-pointer items-center justify-between gap-4 rounded-2xl border px-4 py-3 transition ${
                      createMode === option.key
                        ? 'border-[color:var(--accent-soft-border)] bg-[color:var(--accent-soft-bg)]'
                        : 'border-[color:var(--panel-border-subtle)] bg-[color:var(--panel-bg-subtle)]'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                        {option.label}
                      </p>
                      <p
                        className={`mt-1 text-xs ${
                          createMode === option.key
                            ? 'text-[color:var(--accent-soft-text)]'
                            : 'text-[color:var(--text-muted)]'
                        }`}
                      >
                        {option.desc}
                      </p>
                    </div>
                    <input
                      type="radio"
                      name="createMode"
                      value={option.key}
                      checked={createMode === option.key}
                      onChange={() => {
                        setCreateMode(option.key as 'repeat' | 'custom' | 'cheer');
                        setCreateError(null);
                      }}
                      className="h-4 w-4 accent-emerald-500"
                    />
                  </label>
                ))}
              </div>

              {createMode === 'custom' ? (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-[color:var(--text-primary)]">
                    自定义应援词
                  </label>
                  <input
                    type="text"
                    value={customFanchant}
                    onChange={(event) => {
                      setCustomFanchant(event.target.value);
                      setCreateError(null);
                    }}
                    placeholder="如成员名、团名等"
                    className="rounded-2xl border border-[color:var(--panel-border-subtle)] bg-[color:var(--panel-bg-subtle)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none"
                  />
                </div>
              ) : null}

              {createError ? (
                <p className="text-xs font-semibold text-rose-500">{createError}</p>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-full border border-[color:var(--panel-border-subtle)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--text-muted)] hover:border-[color:var(--btn-soft-border-hover)]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={applyCreateFanchant}
                  disabled={createConfirmDisabled}
                  className="rounded-full bg-[color:var(--accent-bg)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--accent-text)] hover:bg-[color:var(--accent-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  保存修改
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
