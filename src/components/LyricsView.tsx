'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { LyricLine } from '@/lib/lrc/types';
import { useAudioStore } from '@/stores/audioStore';
import { useGameStore, type GameMode, type GameResult } from '@/stores/gameStore';
import { KaraokeLine, type KaraokeLineHandle, type ReciteProgress } from './KaraokeLine';

interface LyricsViewProps {
  lines: LyricLine[];
  timeRef: MutableRefObject<number>;
  onSeek: (timeMs: number) => void;
  mode: GameMode;
}

type LineResultState = GameResult;

const RECITE_BALL_RADIUS = 192;

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

const buildFanchantIndex = (lines: LyricLine[]) =>
  lines
    .map((line, index) => (line.fanchant ? { line, index } : null))
    .filter((entry): entry is { line: LyricLine; index: number } => Boolean(entry))
    .sort((a, b) => {
      const timeDiff = (a.line.fanchant?.startTime ?? a.line.startTime) -
        (b.line.fanchant?.startTime ?? b.line.startTime);
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

export const LyricsView = ({ lines, timeRef, onSeek, mode }: LyricsViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(KaraokeLineHandle | null)[]>([]);
  const activeIndexRef = useRef(0);
  const pendingIndexRef = useRef(0);
  const revealedRef = useRef<Set<string>>(new Set());
  const revealCursorRef = useRef(0);
  const lineResultsRef = useRef<Record<string, LineResultState>>({});
  const seekSyncTimeout = useRef<number | null>(null);
  const reciteProgressRef = useRef<Record<string, ReciteProgress>>({});
  const recitePressStartRef = useRef<number | null>(null);
  const dragStartYRef = useRef(0);
  const dragStartCenterYRef = useRef(0);
  const draggingRef = useRef(false);

  const audioRef = useAudioStore((state) => state.audioRef);
  const registerResult = useGameStore((state) => state.registerResult);
  const resetScore = useGameStore((state) => state.resetScore);

  const [activeIndex, setActiveIndex] = useState(0);
  const [lineResults, setLineResults] = useState<Record<string, LineResultState>>({});
  const [revealedFanchants, setRevealedFanchants] = useState<Record<string, boolean>>({});
  const [isRecitePressing, setIsRecitePressing] = useState(false);
  const [ballCenterY, setBallCenterY] = useState<number | null>(null);
  const [dragPointerId, setDragPointerId] = useState<number | null>(null);

  const lineMeta = useMemo(() => buildLineMeta(lines), [lines]);
  const fanchantIndex = useMemo(() => buildFanchantIndex(lines), [lines]);

  useEffect(() => {
    lineRefs.current = Array(lines.length).fill(null);
    activeIndexRef.current = 0;
    pendingIndexRef.current = 0;
    revealCursorRef.current = 0;
    revealedRef.current = new Set();
    lineResultsRef.current = {};
    reciteProgressRef.current = {};
    recitePressStartRef.current = null;
    draggingRef.current = false;
    setIsRecitePressing(false);
    setDragPointerId(null);
    setActiveIndex(0);
    setLineResults({});
    setRevealedFanchants({});
  }, [lines, mode]);

  const clampBallCenterY = useCallback((value: number) => {
    if (typeof window === 'undefined') return value;
    const min = RECITE_BALL_RADIUS;
    const max = window.innerHeight;
    return Math.min(Math.max(value, min), max);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateCenter = () => {
      setBallCenterY((prev) => clampBallCenterY(prev ?? window.innerHeight));
    };
    updateCenter();
    window.addEventListener('resize', updateCenter);
    return () => window.removeEventListener('resize', updateCenter);
  }, [clampBallCenterY]);

  const setResult = useCallback(
    (line: LyricLine, result: GameResult) => {
      if (lineResultsRef.current[line.id]) return;
      lineResultsRef.current[line.id] = result;
      setLineResults((prev) => ({ ...prev, [line.id]: result }));
      registerResult(result);
      if (result === 'miss' && typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    },
    [registerResult]
  );

  const updateRevealedUpTo = useCallback(
    (timeMs: number, forceReset: boolean) => {
      if (fanchantIndex.length === 0) return;
      if (forceReset) {
        const nextSet = new Set<string>();
        let cursor = 0;
        while (cursor < fanchantIndex.length) {
          const { line } = fanchantIndex[cursor];
          const revealAt = line.fanchant?.startTime ?? line.startTime;
          if (revealAt > timeMs) break;
          nextSet.add(line.id);
          cursor += 1;
        }
        revealedRef.current = nextSet;
        revealCursorRef.current = cursor;
        setRevealedFanchants(
          Array.from(nextSet).reduce<Record<string, boolean>>((acc, id) => {
            acc[id] = true;
            return acc;
          }, {})
        );
        return;
      }

      let cursor = revealCursorRef.current;
      const added: string[] = [];
      while (cursor < fanchantIndex.length) {
        const { line } = fanchantIndex[cursor];
        const revealAt = line.fanchant?.startTime ?? line.startTime;
        if (revealAt > timeMs) break;
        if (!revealedRef.current.has(line.id)) {
          revealedRef.current.add(line.id);
          added.push(line.id);
        }
        cursor += 1;
      }
      revealCursorRef.current = cursor;
      if (added.length > 0) {
        setRevealedFanchants((prev) => {
          const next = { ...prev };
          for (const id of added) next[id] = true;
          return next;
        });
      }
    },
    [fanchantIndex]
  );

  const handleReciteProgress = useCallback(
    (line: LyricLine, progress: ReciteProgress) => {
      const resolvedProgress =
        progress.isComplete &&
        progress.completedAt === null &&
        progress.timingStatus !== 'pending' &&
        progress.timingStatus !== 'miss'
          ? { ...progress, completedAt: timeRef.current }
          : progress;
      reciteProgressRef.current[line.id] = resolvedProgress;
      if (mode !== 'recite') return;
      if (lineResultsRef.current[line.id]) return;
      if (resolvedProgress.timingStatus === 'miss') {
        setResult(line, 'miss');
        return;
      }
      if (resolvedProgress.timingStatus === 'pending') return;
      if (!line.fanchant) {
        if (resolvedProgress.hasSelection) {
          setResult(line, 'miss');
        }
        return;
      }
      if (!resolvedProgress.isComplete) return;
      const now = timeRef.current;
      if (now < line.fanchant.startTime) return;
      if (now > line.fanchant.endTime) return;
      setResult(line, 'hit');
    },
    [mode, setResult, timeRef]
  );

  const handleReciteCheerMark = useCallback(
    (line: LyricLine) => {
      if (mode !== 'recite') return;
      if (lineResultsRef.current[line.id]) return;
      const isCheer = line.fanchant?.type === 'cheer';
      setResult(line, isCheer ? 'hit' : 'miss');
    },
    [mode, setResult]
  );

  const handleRecitePressStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (mode !== 'recite') return;
      event.preventDefault();
      event.stopPropagation();
      setIsRecitePressing(true);
      recitePressStartRef.current = timeRef.current;
      const isPlaying = audioRef ? !audioRef.paused : false;
      if (isPlaying) return;
      dragStartYRef.current = event.clientY;
      dragStartCenterYRef.current =
        ballCenterY ?? (typeof window !== 'undefined' ? window.innerHeight : RECITE_BALL_RADIUS);
      draggingRef.current = false;
      setDragPointerId(event.pointerId);
    },
    [audioRef, ballCenterY, mode, timeRef]
  );

  const syncAllLines = useCallback((timeMs: number) => {
    lineRefs.current.forEach((lineRef) => {
      lineRef?.update(timeMs);
    });
  }, []);

  const resetReciteState = useCallback(
    (timeMs: number) => {
      lineResultsRef.current = {};
      reciteProgressRef.current = {};
      recitePressStartRef.current = null;
      setIsRecitePressing(false);
      setLineResults({});
      resetScore();
      lineRefs.current.forEach((lineRef) => {
        lineRef?.reset();
      });
      if (fanchantIndex.length === 0) {
        pendingIndexRef.current = 0;
        return;
      }
      const nextPending = fanchantIndex.findIndex(
        ({ line }) => (line.fanchant?.endTime ?? line.startTime) >= timeMs
      );
      pendingIndexRef.current = nextPending === -1 ? fanchantIndex.length : nextPending;
    },
    [fanchantIndex, resetScore]
  );

  const applyRecitePressInterval = useCallback(
    (startAbs: number, endAbs: number, finalize: boolean) => {
      lineRefs.current.forEach((lineRef) => {
        lineRef?.applyPressInterval?.(startAbs, endAbs, finalize);
      });
    },
    []
  );

  const finalizeRecitePress = useCallback(() => {
    if (!isRecitePressing) return;
    setIsRecitePressing(false);
    const startAbs = recitePressStartRef.current;
    const endAbs = timeRef.current;
    recitePressStartRef.current = null;
    if (startAbs === null || Number.isNaN(startAbs)) return;
    applyRecitePressInterval(startAbs, endAbs, true);
  }, [applyRecitePressInterval, isRecitePressing, timeRef]);

  useEffect(() => {
    if (!isRecitePressing) return;
    const handlePointerUp = () => finalizeRecitePress();
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [finalizeRecitePress, isRecitePressing]);

  useEffect(() => {
    if (!isRecitePressing) return;
    let rafId = 0;
    const tick = () => {
      if (!isRecitePressing) return;
      const startAbs = recitePressStartRef.current;
      if (startAbs !== null) {
        applyRecitePressInterval(startAbs, timeRef.current, false);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [applyRecitePressInterval, isRecitePressing, timeRef]);

  useEffect(() => {
    if (dragPointerId === null) return;
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerId) return;
      const deltaY = event.clientY - dragStartYRef.current;
      if (!draggingRef.current && Math.abs(deltaY) > 6) {
        draggingRef.current = true;
        setIsRecitePressing(false);
        recitePressStartRef.current = null;
      }
      if (!draggingRef.current) return;
      const nextCenter = clampBallCenterY(dragStartCenterYRef.current + deltaY);
      setBallCenterY(nextCenter);
    };
    const handleUp = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerId) return;
      draggingRef.current = false;
      setDragPointerId(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [clampBallCenterY, dragPointerId]);

  const syncForTime = useCallback(
    (timeMs: number, shouldScroll: boolean, forceRevealReset = false) => {
      if (lines.length > 0) {
        const nextIndex = findActiveIndex(lineMeta.startTimes, timeMs);
        if (nextIndex !== activeIndexRef.current && nextIndex >= 0) {
          const previousIndex = activeIndexRef.current;
          activeIndexRef.current = nextIndex;
          setActiveIndex(nextIndex);
          lineRefs.current[previousIndex]?.update(timeMs);
          lineRefs.current[nextIndex]?.update(timeMs);

          if (shouldScroll) {
            const target = containerRef.current?.querySelector<HTMLElement>(
              `[data-line-index="${nextIndex}"]`
            );
            target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        } else if (nextIndex >= 0) {
          lineRefs.current[nextIndex]?.update(timeMs);
        }
      }

      updateRevealedUpTo(timeMs, forceRevealReset);

      if (mode !== 'memory' && fanchantIndex.length > 0) {
        let cursor = pendingIndexRef.current;
        while (cursor < fanchantIndex.length) {
          const { line } = fanchantIndex[cursor];
          if (lineResultsRef.current[line.id]) {
            cursor += 1;
            continue;
          }
          if (mode === 'recite') {
            const progress = reciteProgressRef.current[line.id];
            const timingStatus = progress?.timingStatus;
            if (timingStatus === 'miss') {
              setResult(line, 'miss');
              cursor += 1;
              continue;
            }
            if (timingStatus === 'pending') {
              break;
            }
            if (
              progress?.isComplete &&
              timeMs >= line.fanchant!.startTime &&
              timeMs <= line.fanchant!.endTime
            ) {
              setResult(line, 'hit');
              cursor += 1;
              continue;
            }
          }
          if (timeMs > line.fanchant!.endTime) {
            if (mode === 'recite') {
              const progress = reciteProgressRef.current[line.id];
              const timingStatus = progress?.timingStatus;
              const completedAt = progress?.completedAt;
              const allowedEnd = progress?.timingWindow?.end ?? line.fanchant!.endTime;
              const isCompletionValid =
                Boolean(progress?.isComplete) &&
                typeof completedAt === 'number' &&
                completedAt <= allowedEnd &&
                timingStatus !== 'miss' &&
                timingStatus !== 'pending';
              if (isCompletionValid) {
                setResult(line, 'hit');
              } else {
                setResult(line, 'miss');
              }
            } else {
              setResult(line, 'miss');
            }
            cursor += 1;
            continue;
          }
          if (timeMs < line.startTime) break;
          break;
        }
        pendingIndexRef.current = cursor;
      }
    },
    [fanchantIndex, lineMeta.startTimes, lines.length, mode, setResult, updateRevealedUpTo]
  );

  useEffect(() => {
    let rafId = 0;
    let active = true;

    const tick = () => {
      if (!active) return;
      const timeMs = timeRef.current;
      syncForTime(timeMs, true);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
    };
  }, [syncForTime, timeRef]);

  useEffect(() => {
    if (!audioRef) return;
    const handleSeeked = () => {
      if (seekSyncTimeout.current) {
        window.clearTimeout(seekSyncTimeout.current);
      }
      seekSyncTimeout.current = window.setTimeout(() => {
        const nextTimeMs = Number.isFinite(audioRef.currentTime)
          ? audioRef.currentTime * 1000
          : timeRef.current;
        resetReciteState(nextTimeMs);
        syncForTime(nextTimeMs, false, true);
        syncAllLines(nextTimeMs);
      }, 0);
    };
    audioRef.addEventListener('seeked', handleSeeked);
    return () => {
      if (seekSyncTimeout.current) {
        window.clearTimeout(seekSyncTimeout.current);
      }
      audioRef.removeEventListener('seeked', handleSeeked);
    };
  }, [audioRef, resetReciteState, syncAllLines, syncForTime, timeRef]);

  return (
    <div className="relative flex h-full flex-col">
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-10">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Paste LRC and press Parse to see karaoke lines.
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-16">
            {lines.map((line, index) => {
              const lineState = lineResults[line.id];
              const revealAnswer = mode !== 'memory' && Boolean(lineState);
              const showFanchant = mode === 'recite' ? false : Boolean(revealedFanchants[line.id]);

              return (
                <KaraokeLine
                  key={line.id}
                  ref={(node) => {
                    lineRefs.current[index] = node;
                  }}
                  line={line}
                  lineIndex={index}
                  mode={mode}
                  isActive={index === activeIndex}
                  endTime={lineMeta.endTimes[index] ?? line.startTime + 1500}
                  onSeek={onSeek}
                  onReciteProgress={handleReciteProgress}
                  onReciteCheerMark={handleReciteCheerMark}
                  timeRef={timeRef}
                  result={lineState ?? null}
                  revealAnswer={revealAnswer}
                  showFanchant={showFanchant}
                />
              );
            })}
          </div>
        )}
      </div>

      {mode === 'recite' ? (
        <button
          type="button"
          aria-label="Hold to select words across lines"
          aria-pressed={isRecitePressing}
          onPointerDown={handleRecitePressStart}
          className={`fixed right-0 z-50 rounded-full border shadow-lg transition touch-none ${
            isRecitePressing
              ? 'border-emerald-400 bg-emerald-300 text-emerald-900'
              : 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
          }`}
          style={{
            top: ballCenterY ?? '100%',
            transform: 'translate(50%, -50%)',
            width: RECITE_BALL_RADIUS * 2,
            height: RECITE_BALL_RADIUS * 2,
          }}
        />
      ) : null}
    </div>
  );
};
