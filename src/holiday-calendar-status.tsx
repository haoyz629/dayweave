import { useEffect, useRef, useState } from "react";
import { requestHolidayUpdate, useHolidayCalendar } from "./holiday-calendar-sync";
import { holidayYearMessage, missingHolidayYears } from "./official-holiday-calendar";
import "./holiday-calendar.css";

export function HolidayCalendarSettings() {
  const snapshot = useHolidayCalendar();
  const [manualBusy, setManualBusy] = useState(false);
  const [message, setMessage] = useState("");
  const savingRef = useRef(false);
  const busy = manualBusy || snapshot.checking;
  async function check() {
    if (savingRef.current || snapshot.checking) return;
    savingRef.current = true;
    setManualBusy(true);
    setMessage("");
    try {
      await requestHolidayUpdate([], true);
      setMessage("检查已结束；已保存的任务与执行记录不会随节假日更新而移动。");
    } finally { savingRef.current = false; setManualBusy(false); }
  }
  const checkedAt = snapshot.lastSuccessAt ? new Date(snapshot.lastSuccessAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "尚未成功检查";
  return <div className="holiday-calendar-settings" aria-label="法定节假日数据">
    <div className="holiday-calendar-heading"><div><h3>法定节假日数据</h3><p>已覆盖 {snapshot.years.map((data) => data.year).join("、")} 年；最近成功检查：{checkedAt}</p></div>
      <button type="button" className="quiet-button" disabled={busy} onClick={() => void check()}>{busy ? "正在检查…" : "检查节假日更新"}</button>
    </div>
    <p>启动后后台检查，自动检查间隔至少 24 小时；已下载数据可离线使用。尚未收录的年份不会预测调休。</p>
    <p>数据源：NateScarlet/holiday-cn（经 jsDelivr 分发）。这是第三方整理数据，正式安排以国务院公告为准。</p>
    <p>缺失年份的工作时间暂按每周设置；按法定工作日重复的事项将在相关年份补齐后恢复推演。</p>
    {(snapshot.lastError || message || busy) && <p className={snapshot.lastError ? "holiday-update-error" : ""} role="status">{busy ? "正在获取已发布的年度安排，原有数据继续可用…" : snapshot.lastError || message}</p>}
    <small>只下载公共日历文件，不上传任务、日程或个人设置。</small>
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
    <span>{missing.map((year) => holidayYearMessage(year, snapshot)).join(" ")} 工作时间暂按每周设置；法定工作日重复不作猜测。</span>
    <button type="button" className="quiet-button" disabled={snapshot.checking || retrying} onClick={() => void retry()}>{snapshot.checking || retrying ? "更新中…" : "检查更新"}</button>
  </div>;
}
