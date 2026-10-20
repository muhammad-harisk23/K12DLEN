import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface VideoSlotProps {
  children: ReactNode;
  className?: string;
}

/**
 * Measures its own box with a ResizeObserver and sizes a centered 16:9
 * child to the largest rectangle that fits within both width and height.
 *
 * Given slot width W and height H:
 *   playerWidth  = min(W, H * 16/9)
 *   playerHeight = playerWidth * 9/16
 *
 * The child is absolutely positioned and centered. The slot itself fills
 * its parent and must have a determined height (flex-1, h-full, etc.).
 */
export function VideoSlot({ children, className = '' }: VideoSlotProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width: W, height: H } = size;
  const playerWidth = W > 0 && H > 0 ? Math.min(W, H * 16 / 9) : 0;
  const playerHeight = playerWidth > 0 ? (playerWidth * 9) / 16 : 0;

  return (
    <div ref={slotRef} className={`relative flex items-center justify-center ${className}`}>
      {playerWidth > 0 && (
        <div style={{ width: playerWidth, height: playerHeight }} className="relative">
          {children}
        </div>
      )}
    </div>
  );
}
