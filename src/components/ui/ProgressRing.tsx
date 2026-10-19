import { useEffect, useRef, useState } from 'react';

interface ProgressRingProps {
  /** 0..1. Clamped; never visually exceeds 1. */
  value: number;
  size?: number;
  stroke?: number;
  /** Optional center content (e.g. the count). */
  children?: React.ReactNode;
  label?: string;
  /** Accessible summary announced once on mount/stop. */
  accessibleLabel: string;
}

/**
 * Animated SVG progress ring. Animates only when `value` changes (not
 * continuously), honors prefers-reduced-motion (renders at final value
 * immediately), and never exceeds 100%.
 */
export function ProgressRing({
  value,
  size = 132,
  stroke = 10,
  children,
  label,
  accessibleLabel,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetOffset = circumference * (1 - clamped);

  const [animatedOffset, setAnimatedOffset] = useState(circumference);
  const [animatedValue, setAnimatedValue] = useState(0);
  const reducedMotionRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = mq.matches;
    };
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (reducedMotionRef.current) {
      setAnimatedOffset(targetOffset);
      setAnimatedValue(clamped);
      return;
    }
    const startOffset = animatedOffset;
    const startValue = animatedValue;
    const startTime = performance.now();
    const duration = 700;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeOut(t);
      setAnimatedOffset(startOffset + (targetOffset - startOffset) * eased);
      setAnimatedValue(startValue + (clamped - startValue) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetOffset, clamped]);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={accessibleLabel}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={animatedOffset}
          style={{ transition: reducedMotionRef.current ? 'none' : undefined }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
        {label && <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">{label}</span>}
      </div>
    </div>
  );
}
