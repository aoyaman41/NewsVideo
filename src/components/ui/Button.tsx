import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../../utils/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--nv-color-accent)] text-white hover:bg-[#114f88] active:bg-[#0f4679]',
  secondary:
    'bg-white text-[var(--nv-color-text)] border border-[var(--nv-color-border)] hover:bg-[var(--nv-color-canvas)] active:bg-[var(--nv-color-border)]/60',
  ghost:
    'bg-transparent text-[var(--nv-color-muted)] hover:bg-[var(--nv-color-canvas)] hover:text-[var(--nv-color-text)] active:bg-[var(--nv-color-border)]/60',
  danger: 'bg-[var(--nv-color-danger)] text-white hover:bg-[#9b1b1b] active:bg-[#861717]',
  success: 'bg-[var(--nv-color-success)] text-white hover:bg-[#0d6660] active:bg-[#0b5a54]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-[var(--nv-radius-sm)]',
  md: 'h-10 px-4 text-sm rounded-[var(--nv-radius-sm)]',
  lg: 'h-11 px-5 text-sm rounded-[var(--nv-radius-md)]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  disabled,
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx(
        'titlebar-no-drag inline-flex shrink-0 whitespace-nowrap items-center justify-center gap-2 font-semibold transition-colors',
        'duration-[var(--nv-duration-fast)] nv-focus-ring disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        block && 'w-full',
        className
      )}
      disabled={disabled}
      {...props}
    />
  );
}
