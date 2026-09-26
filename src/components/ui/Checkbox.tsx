import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../../utils/cx';

/** ラベルと説明つきのチェックボックス */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  indeterminate = false,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** 一部だけ選ばれている状態 */
  indeterminate?: boolean;
  className?: string;
}) {
  const id = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className={cx('flex items-start gap-2', className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="nv-checkbox mt-0.5"
        checked={checked}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cx(
            'text-sm font-medium text-[var(--nv-color-text)]',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          )}
        >
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="nv-help mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
