import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../utils/cx';

export type MoreMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * 「…」メニュー。あまり使わない操作をまとめる。キーボード(Enter / 上下キー / Esc)でも操作できる。
 */
export function MoreMenu({
  label,
  items,
  buttonText = '…',
}: {
  /** 読み上げ用の名前(例:「〇〇のその他の操作」) */
  label: string;
  items: MoreMenuItem[];
  buttonText?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])'
      ) ?? []),
    ];
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % buttons.length
            : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div className="titlebar-no-drag relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        className="nv-focus-ring flex h-10 min-w-10 items-center justify-center rounded-[var(--nv-radius-sm)] border border-[var(--nv-color-border)] bg-[var(--nv-color-surface)] px-3 text-sm font-semibold text-[var(--nv-color-muted)] transition-colors duration-[var(--nv-duration-fast)] hover:bg-[var(--nv-color-canvas)]"
      >
        {buttonText}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={moveFocus}
          className="nv-surface absolute right-0 z-30 mt-1 min-w-52 py-1 shadow-[var(--nv-shadow-md)]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cx(
                'block w-full px-4 py-2 text-left text-sm outline-none transition-colors duration-[var(--nv-duration-fast)] hover:bg-[var(--nv-color-canvas)] focus-visible:bg-[var(--nv-color-canvas)] disabled:cursor-not-allowed disabled:opacity-50',
                item.danger ? 'text-[var(--nv-color-danger)]' : 'text-[var(--nv-color-text)]'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
