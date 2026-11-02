import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProductBrand } from "./logo";

type WindowAction = "minimize" | "toggleMaximize" | "close" | "startDragging";

export function AppTitlebar({ viewSlotRef, onError, weekLabel }: {
  viewSlotRef: (node: HTMLDivElement | null) => void;
  onError: (message: string) => void;
  weekLabel: string;
}) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      const value = await appWindow.isMaximized();
      if (!disposed) setMaximized(value);
    };
    void refresh().catch((error) => onError(`窗口状态读取失败：${String(error)}`));
    void appWindow.onResized(() => { void refresh().catch((error) => onError(`窗口状态读取失败：${String(error)}`)); })
      .then((stop) => { if (disposed) stop(); else unlisten = stop; })
      .catch((error) => onError(`窗口状态监听失败：${String(error)}`));
    return () => { disposed = true; unlisten?.(); };
  }, [onError]);

  async function act(action: WindowAction) {
    if (!isTauri()) return;
    try {
      const appWindow = getCurrentWindow();
      // close() sends CloseRequested, preserving review protection and close-to-tray.
      await appWindow[action]();
      if (action === "toggleMaximize") setMaximized(await appWindow.isMaximized());
    } catch (error) { onError(`窗口操作失败：${String(error)}`); }
  }

  return <header className="app-titlebar" aria-label="应用顶栏" onMouseDown={(event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, a, [role='group']")) return;
    event.preventDefault();
    void act(event.detail === 2 ? "toggleMaximize" : "startDragging");
  }}>
    <ProductBrand weekLabel={weekLabel} />
    <div ref={viewSlotRef} className="app-view-slot" />
    <div className="app-titlebar-actions">
      <span className="app-window-divider" aria-hidden="true" />
      <div className="app-window-controls" role="group" aria-label="窗口控制">
        <button type="button" aria-label="最小化" title="最小化" onClick={() => void act("minimize")}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" /></svg></button>
        <button type="button" aria-label={maximized ? "还原窗口" : "最大化"} title={maximized ? "还原窗口" : "最大化"} onClick={() => void act("toggleMaximize")}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">{maximized ? <path d="M4 2h6v6M2 4h6v6H2z" /> : <path d="M2 2h8v8H2z" />}</svg></button>
        <button type="button" className="app-window-close" aria-label="关闭窗口" title="关闭窗口" onClick={() => void act("close")}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 8 8m0-8-8 8" /></svg></button>
      </div>
    </div>
  </header>;
}
