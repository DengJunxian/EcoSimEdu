import { useCallback, useEffect, useRef, useState } from "react";

export function usePlaybackFocus(ready: boolean) {
  const playbackRef = useRef<HTMLInputElement>(null);
  const [trigger, setTrigger] = useState<Element | null>(null);
  const focusAfterSeek = useCallback(() => setTrigger(document.activeElement), []);
  const clearPlaybackFocus = useCallback(() => setTrigger(null), []);

  useEffect(() => {
    if (!ready || !trigger) return;
    const focused = document.activeElement;
    if (focused === trigger || (!trigger.isConnected && focused === document.body)) {
      playbackRef.current?.focus();
    }
    clearPlaybackFocus();
  }, [ready, trigger, clearPlaybackFocus]);

  return { playbackRef, focusAfterSeek, clearPlaybackFocus, evidenceSelected: trigger !== null };
}
