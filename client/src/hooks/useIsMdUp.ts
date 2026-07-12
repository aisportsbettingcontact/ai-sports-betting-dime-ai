/**
 * useIsMdUp — Singleton matchMedia hook for the ≥768px (Tailwind `md`) band.
 *
 * Same singleton pattern as useIsDesktop (one listener regardless of how many
 * components subscribe). 768px is the Dime shell boundary: at and above it the
 * sidebar shell owns navigation and the splits surface shows all three markets
 * together; below it the compact single-market layout applies.
 */
import { useState, useEffect } from 'react';
import { DIME_SHELL_MIN_WIDTH_PX } from '@/pages/dime-shell/breakpoints';

let listeners: ((v: boolean) => void)[] = [];
let currentValue =
  typeof window !== 'undefined'
    ? window.innerWidth >= DIME_SHELL_MIN_WIDTH_PX
    : false;

if (typeof window !== 'undefined') {
  const mql = window.matchMedia(`(min-width: ${DIME_SHELL_MIN_WIDTH_PX}px)`);
  mql.addEventListener('change', (e) => {
    currentValue = e.matches;
    listeners.forEach((fn) => fn(currentValue));
  });
}

export function useIsMdUp(): boolean {
  const [isMdUp, setIsMdUp] = useState(currentValue);

  useEffect(() => {
    setIsMdUp(currentValue);
    listeners.push(setIsMdUp);
    return () => {
      listeners = listeners.filter((fn) => fn !== setIsMdUp);
    };
  }, []);

  return isMdUp;
}
