import { useLayoutEffect, useRef } from 'react';
const positions = new Map<string, number>();
export function useScrollMemory(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollTop = positions.get(key) ?? 0;
    const remember = () => positions.set(key, element.scrollTop);
    element.addEventListener('scroll', remember, { passive: true });
    return () => {
      remember();
      element.removeEventListener('scroll', remember);
    };
  }, [key]);
  return ref;
}
