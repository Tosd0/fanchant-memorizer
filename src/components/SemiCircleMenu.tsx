'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { FanchantType } from '@/lib/lrc/types';

interface SemiCircleMenuProps {
  open: boolean;
  prompt?: string;
  onSelect: (type: FanchantType) => void;
  onClose: () => void;
}

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const panelVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1 },
};

export const SemiCircleMenu = ({ open, prompt, onSelect, onClose }: SemiCircleMenuProps) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center pb-6"
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={overlayVariants}
        >
          <motion.button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 cursor-pointer bg-black/60"
            onClick={onClose}
            variants={overlayVariants}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative h-36 w-72 rounded-t-full border border-zinc-700/80 bg-zinc-950/95 shadow-[0_0_40px_rgba(0,0,0,0.4)] backdrop-blur"
            variants={panelVariants}
          >
            <div className="absolute inset-x-0 top-4 text-center text-xs uppercase tracking-[0.3em] text-zinc-400">
              {prompt ?? 'Choose your response'}
            </div>
            <div className="absolute bottom-4 left-0 right-0 flex items-center justify-between px-5">
              <button
                type="button"
                onClick={() => onSelect('repeat')}
                className="rounded-full border border-emerald-400/50 bg-emerald-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-emerald-500/30"
              >
                Repeat
              </button>
              <button
                type="button"
                onClick={() => onSelect('cheer')}
                className="rounded-full border border-amber-400/60 bg-amber-400/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200 transition hover:bg-amber-400/30"
              >
                Cheer
              </button>
              <button
                type="button"
                onClick={() => onSelect('diff')}
                className="rounded-full border border-sky-400/50 bg-sky-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-sky-200 transition hover:bg-sky-500/30"
              >
                Diff
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
