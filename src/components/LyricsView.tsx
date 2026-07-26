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
import { createPortal } from 'react-dom';
import type { LyricLine } from '@/lib/lrc/types';
import { useAudioStore } from '@/stores/audioStore';
import { useGameStore, type GameMode, type GameResult } from '@/stores/gameStore';
import {
  KaraokeLine,
  type CreateSelection,
  type KaraokeLineHandle,
  type ReciteProgress,
} from './KaraokeLine';

interface LyricsViewProps {
  lines: LyricLine[];
  timeRef: MutableRefObject<number>;
  onSeek: (timeMs: number) => void;
  mode: GameMode;
  onCreateSelection?: (selection: CreateSelection) => void;
}

type LineResultState = GameResult;

const RECITE_BALL_RADIUS = 192;

const buildLineMeta = (lines: LyricLine[]) => {
  const startTimes = lines.map((line) => line.startTime);
  const endTimes = lines.map((line, index) => {
    const nextStart = lines[index + 1]?.startTime ?? line.startTime + 2000;
    const wordOffset = line.words.reduce((max, word) => Math.max(max, word.offset), -1);
    const measuredEnd = line.wordsEnd ?? (wordOffset >= 0 ? wordOffset : -1);
    if (measuredEnd >= 0) {
      return Math.max(line.startTime + measuredEnd, line.startTime + 400);
    }
    const fanchantEnd = line.fanchants.reduce((max, fc) => Math.max(max, fc.endTime), 0);
    const fallback = Math.max(nextStart, fanchantEnd, line.startTime + 400);
    return fallback;
  });
  return { startTimes, endTimes };
};

const fanchantKey = (lineId: string, fanchantIndex: number) => `${lineId}:${fanchantIndex}`;

interface FanchantRevealEntry {
  key: string;
  revealAt: number;
}

// One entry per [fc] tag, so each fanchant reveals at its own start time.
const buildRevealIndex = (lines: LyricLine[]): FanchantRevealEntry[] =>
  lines
    .flatMap((line) =>
      line.fanchants.map((fc, fanchantIndex) => ({
        key: fanchantKey(line.id, fanchantIndex),
        revealAt: fc.startTime,
      }))
    )
    .sort((a, b) => a.revealAt - b.revealAt);

interface FanchantScoreEntry {
  line: LyricLine;
  index: number;
  start: number; // earliest fanchant start on the line
  end: number; // latest fanchant end on the line
}

// One entry per line with fanchants; recite results are scored per line.
const buildScoreIndex = (lines: LyricLine[]): FanchantScoreEntry[] =>
  lines
    .map((line, index) => {
      if (line.fanchants.length === 0) return null;
      const start = Math.min(...line.fanchants.map((fc) => fc.startTime));
      const end = Math.max(...line.fanchants.map((fc) => fc.endTime));
      return { line, index, start, end };
    })
    .filter((entry): entry is FanchantScoreEntry => Boolean(entry))
    .sort((a, b) => {
      const timeDiff = a.start - b.start;
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

export const LyricsView = ({ lines, timeRef, onSeek, mode, onCreateSelection }: LyricsViewProps) => {
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
  const manualScrollUntilRef = useRef(0);
  const autoScrollRef = useRef(false);
  const autoScrollTimeoutRef = useRef<number | null>(null);

  const audioRef = useAudioStore((state) => state.audioRef);
  const registerResult = useGameStore((state) => state.registerResult);
  const resetScore = useGameStore((state) => state.resetScore);

  const [activeIndex, setActiveIndex] = useState(0);
  const [lineResults, setLineResults] = useState<Record<string, LineResultState>>({});
  const [revealedFanchants, setRevealedFanchants] = useState<Record<string, boolean>>({});
  const [isRecitePressing, setIsRecitePressing] = useState(false);
  const [ballCenterY, setBallCenterY] = useState<number | null>(null);
  const [dragPointerId, setDragPointerId] = useState<number | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const lineMeta = useMemo(() => buildLineMeta(lines), [lines]);
  const revealIndex = useMemo(() => buildRevealIndex(lines), [lines]);
  const scoreIndex = useMemo(() => buildScoreIndex(lines), [lines]);

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

  useEffect(() => {
    if (typeof document === 'undefined') return;
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    return () => {
      if (autoScrollTimeoutRef.current) {
        window.clearTimeout(autoScrollTimeoutRef.current);
      }
    };
  }, []);

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
      if (revealIndex.length === 0) return;
      if (forceReset) {
        const nextSet = new Set<string>();
        let cursor = 0;
        while (cursor < revealIndex.length) {
          const entry = revealIndex[cursor];
          if (entry.revealAt > timeMs) break;
          nextSet.add(entry.key);
          cursor += 1;
        }
        revealedRef.current = nextSet;
        revealCursorRef.current = cursor;
        setRevealedFanchants(
          Array.from(nextSet).reduce<Record<string, boolean>>((acc, key) => {
            acc[key] = true;
            return acc;
          }, {})
        );
        return;
      }

      let cursor = revealCursorRef.current;
      const added: string[] = [];
      while (cursor < revealIndex.length) {
        const entry = revealIndex[cursor];
        if (entry.revealAt > timeMs) break;
        if (!revealedRef.current.has(entry.key)) {
          revealedRef.current.add(entry.key);
          added.push(entry.key);
        }
        cursor += 1;
      }
      revealCursorRef.current = cursor;
      if (added.length > 0) {
        setRevealedFanchants((prev) => {
          const next = { ...prev };
          for (const key of added) next[key] = true;
          return next;
        });
      }
    },
    [revealIndex]
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
      if (line.fanchants.length === 0) {
        if (resolvedProgress.hasSelection) {
          setResult(line, 'miss');
        }
        return;
      }
      if (!resolvedProgress.isComplete) return;
      const now = timeRef.current;
      const windowStart = Math.min(...line.fanchants.map((fc) => fc.startTime));
      const windowEnd = Math.max(...line.fanchants.map((fc) => fc.endTime));
      if (now < windowStart) return;
      if (now > windowEnd) return;
      setResult(line, 'hit');
    },
    [mode, setResult, timeRef]
  );

  const handleReciteCheerMark = useCallback(
    (line: LyricLine) => {
      if (mode !== 'recite') return;
      if (lineResultsRef.current[line.id]) return;
      const isCheer = line.fanchants.some((fc) => fc.type === 'cheer');
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

  const markManualScroll = useCallback(() => {
    manualScrollUntilRef.current = Date.now() + 2000;
  }, []);

  const handleScroll = useCallback(() => {
    if (autoScrollRef.current) return;
    markManualScroll();
  }, [markManualScroll]);

  const scrollToLine = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-line-index="${index}"]`);
    if (!target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const centerOffset = containerRect.height / 2 - targetRect.height / 2;
    const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - centerOffset;
    autoScrollRef.current = true;
    if (autoScrollTimeoutRef.current) {
      window.clearTimeout(autoScrollTimeoutRef.current);
    }
    autoScrollTimeoutRef.current = window.setTimeout(() => {
      autoScrollRef.current = false;
      autoScrollTimeoutRef.current = null;
    }, 500);
    container.scrollTo({ top: nextTop, behavior: 'smooth' });
  }, []);

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
      if (scoreIndex.length === 0) {
        pendingIndexRef.current = 0;
        return;
      }
      const nextPending = scoreIndex.findIndex((entry) => entry.end >= timeMs);
      pendingIndexRef.current = nextPending === -1 ? scoreIndex.length : nextPending;
    },
    [scoreIndex, resetScore]
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

          if (shouldScroll && Date.now() >= manualScrollUntilRef.current) {
            scrollToLine(nextIndex);
          }
        } else if (nextIndex >= 0) {
          lineRefs.current[nextIndex]?.update(timeMs);
        }
      }

      updateRevealedUpTo(timeMs, forceRevealReset);

      if (mode === 'recite' && scoreIndex.length > 0) {
        let cursor = pendingIndexRef.current;
        while (cursor < scoreIndex.length) {
          const { line, start, end } = scoreIndex[cursor];
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
            if (progress?.isComplete && timeMs >= start && timeMs <= end) {
              setResult(line, 'hit');
              cursor += 1;
              continue;
            }
          }
          if (timeMs > end) {
            if (mode === 'recite') {
              const progress = reciteProgressRef.current[line.id];
              const timingStatus = progress?.timingStatus;
              const completedAt = progress?.completedAt;
              const allowedEnd = progress?.timingWindow?.end ?? end;
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
    [
      lineMeta.startTimes,
      lines.length,
      mode,
      scoreIndex,
      scrollToLine,
      setResult,
      updateRevealedUpTo,
    ]
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
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overscroll-contain px-6 py-10"
        onScroll={handleScroll}
        onWheel={markManualScroll}
        onTouchMove={markManualScroll}
        onPointerDown={markManualScroll}
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Paste LRC and press Parse to see karaoke lines.
          </div>
        ) : (
          <div className="flex flex-col gap-4 pb-16">
            {lines.map((line, index) => {
              const lineState = lineResults[line.id];
              const revealAnswer = mode !== 'memory' && Boolean(lineState);
              const fanchantVisibility =
                mode === 'recite'
                  ? line.fanchants.map(() => false)
                  : mode === 'edit'
                    ? line.fanchants.map(() => true)
                    : line.fanchants.map((_, fanchantIndex) =>
                        Boolean(revealedFanchants[fanchantKey(line.id, fanchantIndex)])
                      );

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
                  onCreateSelection={onCreateSelection}
                  timeRef={timeRef}
                  result={lineState ?? null}
                  revealAnswer={revealAnswer}
                  fanchantVisibility={fanchantVisibility}
                />
              );
            })}
          </div>
        )}
      </div>

      {mode === 'recite' && portalTarget
        ? createPortal(
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
            />,
            portalTarget
          )
        : null}
    </div>
  );
};
