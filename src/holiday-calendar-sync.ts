import { useEffect, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { checkHolidayUpdates, getHolidayCalendar } from "./tauri";
import {
  getHolidayCalendarSnapshot, holidayDataKey, installHolidayCalendarSnapshot,
  subscribeHolidayCalendar
} from "./official-holiday-calendar";
import type { HolidayCalendarSnapshot } from "./official-holiday-calendar";

// IPC replies and events can arrive out of order; an older reply must not undo an event.
let updateEventVersion = 0;

export const useHolidayCalendar = () => useSyncExternalStore(subscribeHolidayCalendar, getHolidayCalendarSnapshot, getHolidayCalendarSnapshot);

export async function requestHolidayUpdate(years: number[] = [], force = false) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const eventVersion = updateEventVersion;
  try {
    const loaded = await checkHolidayUpdates(years.filter((year) => year >= 1900 && year <= 2200), force);
    if (eventVersion === updateEventVersion) installHolidayCalendarSnapshot(loaded);
  } catch (reason) {
    if (eventVersion !== updateEventVersion) return;
    const previous = getHolidayCalendarSnapshot();
    installHolidayCalendarSnapshot({ ...previous, checking: false, lastError: `节假日更新未完成：${String(reason)}` });
  }
}

export function useHolidayCalendarSync() {
  const snapshot = useHolidayCalendar();
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let readEventVersion = updateEventVersion;
    let unlisten: (() => void) | undefined;
    // Subscribe before reading to avoid missing a commit between the two operations.
    void listen<HolidayCalendarSnapshot>("holiday-calendar-updated", (event) => {
      if (!disposed) {
        installHolidayCalendarSnapshot(event.payload);
        updateEventVersion += 1;
      }
    }).then(async (stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      readEventVersion = updateEventVersion;
      const loaded = await getHolidayCalendar();
      if (!disposed && readEventVersion === updateEventVersion) installHolidayCalendarSnapshot(loaded);
    }).catch((reason) => {
      if (!disposed && readEventVersion === updateEventVersion) installHolidayCalendarSnapshot({ ...getHolidayCalendarSnapshot(), checking: false, lastError: `节假日状态未载入：${String(reason)}` });
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  return holidayDataKey(snapshot);
}
