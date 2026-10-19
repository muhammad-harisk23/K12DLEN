import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-xl',
};

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-strong focus-visible:outline-accent shadow-sm',
  secondary:
    'bg-raised text-ink border border-line hover:border-line-strong hover:bg-sunken focus-visible:outline-accent',
  ghost:
    'bg-transparent text-ink-soft hover:bg-sunken hover:text-ink focus-visible:outline-accent',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-touch items-center justify-center gap-2 ${sizeClasses[size]} font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
