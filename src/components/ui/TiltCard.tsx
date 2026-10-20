import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Disable tilt (e.g. for locked cards). */
  disabled?: boolean;
  /** Intensity of the tilt in degrees (default 6). */
  intensity?: number;
}

/**
 * A restrained tactile 3D tilt card. On desktop, the surface tilts slightly
 * toward the pointer using CSS transforms. On touch, a clean press response
 * is provided. Honors reduced motion.
 */
export function TiltCard({ children, className = '', disabled = false, intensity = 6 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState(false);

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
    const rotX = (0.5 - py) * intensity;
    const rotY = (px - 0.5) * intensity;
    el.style.transform = `perspective(700px) rotateX(${rotX}deg) rotateY(${rotY}deg) translateZ(0)`;

    // Dynamic highlight position
    el.style.setProperty('--tilt-x', `${px * 100}%`);
    el.style.setProperty('--tilt-y', `${py * 100}%`);
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
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      style={{
        // CSS custom properties for highlight position
        ['--tilt-x' as string]: '50%',
        ['--tilt-y' as string]: '50%',
      }}
      className={`tilt-card ${disabled ? '' : 'cursor-default'} ${pressed ? 'tilt-card-pressed' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
