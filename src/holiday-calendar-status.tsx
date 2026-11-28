import { useEffect, useRef, useState } from "react";
import { requestHolidayUpdate, useHolidayCalendar } from "./holiday-calendar-sync";
import { getHolidayCalendarSnapshot, holidayYearMessage, missingHolidayYears } from "./official-holiday-calendar";
import "./holiday-calendar.css";

export function HolidayCalendarSettings({ compact = false, onResult }: { compact?: boolean; onResult?: (message: string, error?: boolean) => void } = {}) {
  const snapshot = useHolidayCalendar();
  const [manualBusy, setManualBusy] = useState(false);
  const [message, setMessage] = useState("");
  const savingRef = useRef(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const busy = manualBusy || snapshot.checking;
  async function check() {
    if (savingRef.current || snapshot.checking) return;
    savingRef.current = true;
    setManualBusy(true);
    setMessage("");
    try {
      await requestHolidayUpdate([], true);
      const error = getHolidayCalendarSnapshot().lastError;
      const result = error || "检查完成，已有任务和执行记录不受节假日更新影响。";
      if (onResult) onResult(result, Boolean(error));
      else setMessage(result);
    } finally { savingRef.current = false; setManualBusy(false); }
  }
  const checkedAt = snapshot.lastSuccessAt ? new Date(snapshot.lastSuccessAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未成功检查";
  const details = <>
    <p>已覆盖 {snapshot.years.map((data) => data.year).join("、")} 年；最近成功检查：{checkedAt}</p>
    <ul>
      <li>自动检查更新，已下载日历可离线使用。</li>
      <li>缺失年份不显示法定休/班标记，也不推测调休。</li>
      <li>未收录年份的法定工作日重复任务，待数据更新后自动生成。</li>
    </ul>
    <small>日历仅供参考，以国务院公告为准；更新不影响已有任务和执行记录。</small>
  </>;
  const updateButton = <button type="button" className={compact ? "dw-btn-ghost" : "quiet-button"} disabled={busy} onClick={() => void check()}>{busy ? "正在检查…" : compact ? "检查更新" : "检查节假日更新"}</button>;
  return <div className={`holiday-calendar-settings${compact ? " is-compact" : ""}`} aria-label="法定节假日数据">
    {compact ? <>
      <div className="settings-dialog-row"><span className="settings-field-copy"><strong>已覆盖 {snapshot.years.map((data) => data.year).join("、")} 年法定节假日安排</strong><small>最近成功检查：{checkedAt}</small></span><div className="settings-holiday-actions"><button type="button" className="settings-text-button" aria-expanded={detailsOpen} aria-controls="settings-holiday-details" onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? "收起详情" : "查看详情"}</button>{updateButton}</div></div>
      {detailsOpen && <div id="settings-holiday-details" className="settings-holiday-details">{details}</div>}
    </> : <><div className="holiday-calendar-heading"><h3>法定节假日数据</h3>{updateButton}</div>{details}</>}
    {(busy || (!onResult && (snapshot.lastError || message))) && <p className={!busy && snapshot.lastError ? "holiday-update-error" : ""} role="status">{busy ? "正在获取已发布的年度安排，原有数据继续可用…" : snapshot.lastError || message}</p>}
  </div>;
}

export function HolidayCoverageNotice({ from, to = from, recurringStarts = [] }: { from: string; to?: string; recurringStarts?: string[] }) {
  const snapshot = useHolidayCalendar();
  const [retrying, setRetrying] = useState(false);
  const retryRef = useRef(false);
  const missing = [...new Set([
    ...missingHolidayYears(from, to),
    ...recurringStarts.flatMap((start) => start <= to ? missingHolidayYears(start, to) : [])
  ])];
  const missingKey = missing.join(",");
  useEffect(() => {
    if (missingKey) void requestHolidayUpdate(missingKey.split(",").map(Number));
  }, [missingKey]);
  if (!missing.length) return null;
  async function retry() {
    if (retryRef.current || snapshot.checking) return;
    retryRef.current = true; setRetrying(true);
    try { await requestHolidayUpdate(missing, true); }
    finally { retryRef.current = false; setRetrying(false); }
  }
  return <div className="holiday-coverage holiday-calendar-notice missing" role="status">
    <span>{missing.map((year) => holidayYearMessage(year, snapshot)).join(" ")} 未覆盖年份暂不推测法定休假与调休；法定工作日重复不作猜测。</span>
    <button type="button" className="quiet-button" disabled={snapshot.checking || retrying} onClick={() => void retry()}>{snapshot.checking || retrying ? "更新中…" : "检查更新"}</button>
  </div>;
}
