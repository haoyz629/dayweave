import { MutableRefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ReviewFlush } from "./review-page";

// Native CloseRequested cannot await JavaScript. The scoped native guard defers
// only the record view's close until the same queue used by navigation is flushed.
export function useReviewCloseGuard(enabled: boolean, flushRef: MutableRefObject<ReviewFlush | null>, onError: (message: string) => void) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const ready = useRef<Promise<void>>(Promise.resolve());
  const updates = useRef<Promise<void>>(Promise.resolve());
  const closing = useRef(false);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    ready.current = listen("review-close-requested", () => {
      if (closing.current) return;
      closing.current = true;
      void (async () => {
        try {
          if (flushRef.current && !await flushRef.current()) return;
          await invoke("finish_review_window_close");
        } catch (reason) { errorRef.current(`窗口尚未关闭：${String(reason)}`); }
        finally { closing.current = false; }
      })();
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      updates.current = updates.current.catch(() => {}).then(async () => { await ready.current; await invoke("set_review_close_guard", { enabled: false }); }).catch(() => {});
    };
  }, [flushRef]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    updates.current = updates.current.catch(() => {}).then(async () => {
      await ready.current;
      await invoke("set_review_close_guard", { enabled: enabledRef.current });
    }).catch((reason) => errorRef.current(`关闭保护暂不可用：${String(reason)}`));
  }, [enabled]);
}
