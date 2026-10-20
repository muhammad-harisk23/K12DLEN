import { useRef } from 'react';
import type { ReactNode } from 'react';

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Disable tilt (e.g. for locked cards). */
  disabled?: boolean;
}

/**
 * A restrained tactile 3D tilt card. On desktop, the surface tilts slightly
 * toward the pointer using CSS transforms. On touch, no hover dependency —
 * a clean press response is provided by the parent. Honors reduced motion.
 */
export function TiltCard({ children, className = '', disabled = false }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMove(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    if (!e.isPrimary || e.pointerType === 'touch') return;

    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotX = (0.5 - py) * 6;
    const rotY = (px - 0.5) * 6;
    el.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(0)`;
  }

  function handleLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
  }

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={`tilt-card ${disabled ? '' : 'cursor-default'} ${className}`}
    >
      {children}
    </div>
  );
}
