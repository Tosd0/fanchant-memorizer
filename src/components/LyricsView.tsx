'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { FanchantType, LyricLine } from '@/lib/lrc/types';
import { useAudioStore } from '@/stores/audioStore';
import { useGameStore, type GameMode, type GameResult } from '@/stores/gameStore';
import { KaraokeLine, type KaraokeLineHandle } from './KaraokeLine';
import { SemiCircleMenu } from './SemiCircleMenu';

interface LyricsViewProps {
  lines: LyricLine[];
  timeRef: MutableRefObject<number>;
  onSeek: (timeMs: number) => void;
  mode: GameMode;
}

interface FanchantWindow {
  content: string;
  type: FanchantType;
  startTime: number;
  endTime: number;
}

interface LineJudgeState {
  result: GameResult;
  selectedType?: FanchantType;
}

const buildLineMeta = (lines: LyricLine[]) => {
  const startTimes = lines.map((line) => line.startTime);
  const endTimes = lines.map((line, index) => {
    const nextStart = lines[index + 1]?.startTime ?? line.startTime + 2000;
    const wordOffset = line.words.reduce((max, word) => Math.max(max, word.offset), -1);
    if (wordOffset >= 0) {
      return Math.max(line.startTime + wordOffset, line.startTime + 400);
    }
    const fanchantEnd = line.fanchant?.endTime ?? 0;
    const fallback = Math.max(nextStart, fanchantEnd, line.startTime + 400);
    return fallback;
  });
  return { startTimes, endTimes };
};

const buildFanchantWindows = (lines: LyricLine[]) =>
  lines
    .filter((line) => line.fanchant)
    .map((line) => ({
      content: line.fanchant!.content,
      type: line.fanchant!.type,
      startTime: line.startTime,
      endTime: line.fanchant!.endTime,
    }))
    .sort((a, b) => a.startTime - b.startTime);

const buildFanchantIndex = (lines: LyricLine[]) =>
  lines
    .map((line, index) => (line.fanchant ? { line, index } : null))
    .filter((entry): entry is { line: LyricLine; index: number } => Boolean(entry))
    .sort((a, b) => {
      const timeDiff = a.line.startTime - b.line.startTime;
      return timeDiff !== 0 ? timeDiff : a.index - b.index;
    });

const findActiveIndex = (startTimes: number[], timeMs: number) => {
  if (startTimes.length === 0) return -1;
  let left = 0;
  let right = startTimes.length - 1;
  let best = 0;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (startTimes[mid] <= timeMs) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return best;
};

const resolveFanchant = (windows: FanchantWindow[], timeMs: number) => {
  if (windows.length === 0) return null;
  let left = 0;
  let right = windows.length - 1;
  let best = -1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (windows[mid].startTime <= timeMs) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  if (best === -1) return null;
  const candidate = windows[best];
  return timeMs <= candidate.endTime ? candidate : null;
};

export const LyricsView = ({ lines, timeRef, onSeek, mode }: LyricsViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(KaraokeLineHandle | null)[]>([]);
  const activeIndexRef = useRef(0);
  const fanchantKeyRef = useRef<string | null>(null);
  const pendingIndexRef = useRef(0);
  const lineResultsRef = useRef<Record<string, LineJudgeState>>({});
  const menuLineRef = useRef<LyricLine | null>(null);
  const wasPlayingRef = useRef(false);

  const audioRef = useAudioStore((state) => state.audioRef);
  const registerResult = useGameStore((state) => state.registerResult);

  const [activeIndex, setActiveIndex] = useState(0);
  const [activeFanchant, setActiveFanchant] = useState<FanchantWindow | null>(null);
  const [lineResults, setLineResults] = useState<Record<string, LineJudgeState>>({});
  const [menuLineId, setMenuLineId] = useState<string | null>(null);

  const lineMeta = useMemo(() => buildLineMeta(lines), [lines]);
  const fanchantWindows = useMemo(() => buildFanchantWindows(lines), [lines]);
  const fanchantIndex = useMemo(() => buildFanchantIndex(lines), [lines]);

  useEffect(() => {
    lineRefs.current = Array(lines.length).fill(null);
    activeIndexRef.current = 0;
    pendingIndexRef.current = 0;
    lineResultsRef.current = {};
    menuLineRef.current = null;
    setActiveIndex(0);
    setActiveFanchant(null);
    setLineResults({});
    setMenuLineId(null);
  }, [lines, mode]);

  const setResult = useCallback(
    (line: LyricLine, result: GameResult, selectedType?: FanchantType) => {
      if (lineResultsRef.current[line.id]) return;
      const nextState: LineJudgeState = { result, selectedType };
      lineResultsRef.current[line.id] = nextState;
      setLineResults((prev) => ({ ...prev, [line.id]: nextState }));
      registerResult(result);
      if (result === 'miss' && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    },
    [registerResult]
  );

  const openMenu = useCallback(
    (line: LyricLine) => {
      menuLineRef.current = line;
      setMenuLineId(line.id);
      if (audioRef) {
        wasPlayingRef.current = !audioRef.paused;
        audioRef.pause();
      }
    },
    [audioRef]
  );

  const closeMenu = useCallback(
    (resume: boolean) => {
      setMenuLineId(null);
      menuLineRef.current = null;
      if (resume && audioRef && wasPlayingRef.current) {
        audioRef.play().catch(() => undefined);
      }
      wasPlayingRef.current = false;
    },
    [audioRef]
  );

  const handleLineInteract = useCallback(
    (line: LyricLine) => {
      if (!line.fanchant) return;
      if (mode === 'memory') return;
      if (lineResultsRef.current[line.id]) return;
      if (menuLineRef.current) return;

      const now = timeRef.current;
      if (now < line.startTime) return;
      if (now > line.fanchant.endTime) {
        setResult(line, 'miss');
        return;
      }

      if (mode === 'recite') {
        setResult(line, 'hit');
      } else if (mode === 'judge') {
        openMenu(line);
      }
    },
    [mode, openMenu, setResult, timeRef]
  );

  const handleMenuSelect = useCallback(
    (choice: FanchantType) => {
      const line = menuLineRef.current;
      if (!line || !line.fanchant) {
        closeMenu(true);
        return;
      }
      if (lineResultsRef.current[line.id]) {
        closeMenu(true);
        return;
      }
      const now = timeRef.current;
      if (now > line.fanchant.endTime) {
        setResult(line, 'miss', choice);
        closeMenu(true);
        return;
      }
      if (now < line.startTime) {
        closeMenu(true);
        return;
      }
      const isCorrect = choice === line.fanchant.type;
      setResult(line, isCorrect ? 'hit' : 'miss', choice);
      closeMenu(true);
    },
    [closeMenu, setResult, timeRef]
  );

  useEffect(() => {
    let rafId = 0;
    let active = true;

    const tick = () => {
      if (!active) return;
      const timeMs = timeRef.current;
      if (lines.length > 0) {
        const nextIndex = findActiveIndex(lineMeta.startTimes, timeMs);
        if (nextIndex !== activeIndexRef.current && nextIndex >= 0) {
          const previousIndex = activeIndexRef.current;
          activeIndexRef.current = nextIndex;
          setActiveIndex(nextIndex);
          lineRefs.current[previousIndex]?.update(timeMs);
          lineRefs.current[nextIndex]?.update(timeMs);

          const target = containerRef.current?.querySelector<HTMLElement>(
            `[data-line-index="${nextIndex}"]`
          );
          target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else if (nextIndex >= 0) {
          lineRefs.current[nextIndex]?.update(timeMs);
        }
      }

      if (fanchantWindows.length > 0) {
        const fanchant = resolveFanchant(fanchantWindows, timeMs);
        const nextKey = fanchant ? `${fanchant.content}-${fanchant.type}` : null;
        if (nextKey !== fanchantKeyRef.current) {
          fanchantKeyRef.current = nextKey;
          setActiveFanchant(fanchant);
        }
      } else if (fanchantKeyRef.current !== null) {
        fanchantKeyRef.current = null;
        setActiveFanchant(null);
      }

      if (mode !== 'memory' && fanchantIndex.length > 0) {
        let cursor = pendingIndexRef.current;
        while (cursor < fanchantIndex.length) {
          const { line } = fanchantIndex[cursor];
          if (lineResultsRef.current[line.id]) {
            cursor += 1;
            continue;
          }
          if (timeMs > line.fanchant!.endTime) {
            setResult(line, 'miss');
            cursor += 1;
            continue;
          }
          if (timeMs < line.startTime) break;
          break;
        }
        pendingIndexRef.current = cursor;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [fanchantIndex, fanchantWindows, lineMeta.startTimes, lines.length, mode, setResult, timeRef]);

  const overlayText = activeFanchant
    ? mode === 'memory'
      ? activeFanchant.content
      : mode === 'recite'
        ? 'TAP TO CHANT'
        : 'CHOOSE RESPONSE'
    : 'FANCHANT READY';

  return (
    <div className="relative flex h-full flex-col">
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-10">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Paste LRC and press Parse to see karaoke lines.
          </div>
        ) : (
          <div className="flex flex-col gap-3 pb-20">
            {lines.map((line, index) => {
              const lineState = lineResults[line.id];
              const canInteract = mode !== 'memory' && Boolean(line.fanchant);
              const hintLabel =
                line.fanchant && !lineState && mode !== 'memory'
                  ? mode === 'judge'
                    ? 'CHOOSE'
                    : 'TAP'
                  : null;
              const revealAnswer = mode !== 'memory' && Boolean(lineState);

              return (
                <KaraokeLine
                  key={line.id}
                  ref={(node) => {
                    lineRefs.current[index] = node;
                  }}
                  line={line}
                  lineIndex={index}
                  isActive={index === activeIndex}
                  endTime={lineMeta.endTimes[index] ?? line.startTime + 1500}
                  onSeek={onSeek}
                  canInteract={canInteract}
                  onInteract={handleLineInteract}
                  result={lineState?.result ?? null}
                  hintLabel={hintLabel}
                  revealAnswer={revealAnswer}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <div
          className={`rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold tracking-wide text-emerald-200 shadow-[0_0_30px_rgba(16,185,129,0.35)] transition ${
            activeFanchant ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {overlayText}
        </div>
      </div>

      <SemiCircleMenu
        open={mode === 'judge' && Boolean(menuLineId)}
        prompt="Repeat or Diff?"
        onSelect={handleMenuSelect}
        onClose={() => closeMenu(true)}
      />
    </div>
  );
};
