import { FormEvent, useEffect, useRef, useState } from "react";
import { HolidayCalendarSettings } from "../holiday-calendar-status";
import { getAutostartEnabled, sendTestNotification, setAutostartEnabled } from "../tauri";
import { TAG_COLOR_HEX, TAG_COLOR_LABELS } from "../types/dayweave";
import type { AppSettings, Tag, TagColor, Task } from "../types/dayweave";
import { useSaveAttempt } from "../utils/useSaveAttempt";
import { FluentSelect } from "./FluentSelect";

interface SettingsViewProps {
  settings: AppSettings;
  savingSettings: boolean;
  tags: Tag[];
  tasks: Task[];
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onCreateTag: (name: string, color: TagColor) => Promise<boolean>;
  onDeleteTag: (tagId: string) => Promise<boolean>;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function SettingsView({
  settings,
  savingSettings,
  tags,
  tasks,
  onUpdateSetting,
  onCreateTag,
  onDeleteTag,
  onNotify,
}: SettingsViewProps) {
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<TagColor>("blue");
  const [autostart, setAutostart] = useState(false);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [deleteTagTarget, setDeleteTagTarget] = useState<{ tag: Tag; count: number } | null>(null);
  const [deleteTagFailed, setDeleteTagFailed] = useState(false);
  const createTagAttempt = useSaveAttempt();
  const deleteTagAttempt = useSaveAttempt();

  useEffect(() => {
    void getAutostartEnabled()
      .then(setAutostart)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!deleteTagTarget) return;
    const dlg = deleteDialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
    }
  }, [deleteTagTarget]);

  async function handleAddTag(e: FormEvent) {
    e.preventDefault();
    if (createTagAttempt.pending.current) return;
    const clean = newTagName.trim().replace(/^#/, "");
    if (!clean) return;
    const created = await createTagAttempt.save(() => onCreateTag(clean, newTagColor));
    if (created) {
      setNewTagName("");
    }
  }

  async function handleToggleAutostart() {
    const next = !autostart;
    try {
      const actual = await setAutostartEnabled(next);
      setAutostart(actual);
      onNotify(actual ? "已开启开机自启" : "已关闭开机自启");
    } catch (error) {
      onNotify(`开机启动设置失败：${String(error)}`, true);
    }
  }

  async function handleTestNotification() {
    try {
      await sendTestNotification();
      onNotify("测试通知已发送");
    } catch (error) {
      onNotify(`发送测试通知失败：${String(error)}`, true);
    }
  }

  return (
    <main className="dw-module" aria-label="偏好设置">
      <div className="dw-module-header">
        <div>
          <h2 className="dw-module-title">偏好设置</h2>
          <p className="dw-module-desc">设置与标签修改后自动保存</p>
        </div>
      </div>

      <div className="dw-module-body win-scroll">
        <div className="dw-settings-stack">
          {/* 1. Calendar Display */}
          <div className="dw-settings-card">
            <div className="dw-settings-card-title">日历显示</div>
            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">显示农历与二十四节气</div>
                <div className="dw-settings-row-sub">在日视图标题、月视图左栏与日期格中展示农历和节气</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.showLunar}
                disabled={savingSettings}
                onClick={() => onUpdateSetting("showLunar", !settings.showLunar)}
                className={`sw-track${settings.showLunar ? " on" : ""}`}
              >
                <div className="sw-thumb" />
              </button>
            </div>
          </div>

          {/* 2. Task Tag Management */}
          <div className="dw-settings-card">
            <div>
              <div className="dw-settings-card-title">任务标签</div>
              <div className="dw-settings-row-sub">
                每个任务可绑定 1 个标签，时间块与月历卡片颜色自动同步
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tags.map((tg) => {
                const count = tasks.filter((t) => t.tagId === tg.id).length;
                return (
                  <div key={tg.id} className="dw-tag-mgmt-row">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: TAG_COLOR_HEX[tg.color] ?? TAG_COLOR_HEX.blue,
                          flexShrink: 0,
                        }}
                        aria-hidden="true"
                      />
                      <span style={{ fontWeight: 500 }}>#{tg.name}</span>
                      <span style={{ fontSize: 12, color: "var(--w-text-3)" }} className="tabular-nums">
                        {TAG_COLOR_LABELS[tg.color]} · {count} 项任务
                      </span>
                    </div>
                    <button
                      type="button"
                      className="dw-btn-text-danger"
                      disabled={deleteTagAttempt.saving}
                      onClick={() => {
                        if (deleteTagAttempt.pending.current) return;
                        setDeleteTagFailed(false);
                        setDeleteTagTarget({ tag: tg, count });
                      }}
                    >
                      删除
                    </button>
                  </div>
                );
              })}
            </div>

            <form
              onSubmit={handleAddTag}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingTop: 10,
                borderTop: "1px solid var(--w-border)",
              }}
            >
              <input
                type="text"
                className="dw-input"
                style={{ flex: 1, height: 32, padding: "0 10px" }}
                value={newTagName}
                disabled={createTagAttempt.saving}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="新标签名（如：副业）"
              />
              <FluentSelect<TagColor>
                ariaLabel="选择标签颜色"
                style={{ width: 108 }}
                value={newTagColor}
                disabled={createTagAttempt.saving}
                onChange={setNewTagColor}
                options={[
                  { value: "blue", label: "蓝色", dotColor: TAG_COLOR_HEX.blue },
                  { value: "indigo", label: "靛紫", dotColor: TAG_COLOR_HEX.indigo },
                  { value: "emerald", label: "翠绿", dotColor: TAG_COLOR_HEX.emerald },
                  { value: "amber", label: "琥珀", dotColor: TAG_COLOR_HEX.amber },
                  { value: "rose", label: "玫红", dotColor: TAG_COLOR_HEX.rose },
                ]}
              />
              <button type="submit" className="dw-btn-primary" disabled={createTagAttempt.saving}>
                + 新增标签
              </button>
            </form>
          </div>

          {/* 3. Timeline Interaction */}
          <div className="dw-settings-card">
            <div className="dw-settings-card-title">时间轴操作</div>

            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">拖动时间间隔</div>
                <div className="dw-settings-row-sub">拖动或调整时长时的步进（按住 Alt 可 5 分钟微调）</div>
              </div>
              <FluentSelect<15 | 30>
                ariaLabel="拖动时间间隔"
                style={{ width: 148 }}
                value={settings.snapStep}
                disabled={savingSettings}
                onChange={(v) => onUpdateSetting("snapStep", v)}
                options={[
                  { value: 15, label: "15 分钟（推荐）" },
                  { value: 30, label: "30 分钟" },
                ]}
              />
            </div>

            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">新建任务默认预计耗时</div>
                <div className="dw-settings-row-sub">快速创建或双击空白处新建时的默认持续时长</div>
              </div>
              <FluentSelect<number>
                ariaLabel="新建任务默认预计耗时"
                style={{ width: 148 }}
                value={settings.defaultDuration}
                disabled={savingSettings}
                onChange={(v) => onUpdateSetting("defaultDuration", v)}
                options={[
                  { value: 30, label: "30 分钟" },
                  { value: 45, label: "45 分钟" },
                  { value: 60, label: "1 小时（推荐）" },
                  { value: 90, label: "1.5 小时" },
                  { value: 120, label: "2 小时" },
                ]}
              />
            </div>

            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">空白处拖动新建</div>
                <div className="dw-settings-row-sub">在时间轴空白处上下拖动即可新建；关闭后仍可双击空白处新建</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.enableDragCreate}
                disabled={savingSettings}
                onClick={() => onUpdateSetting("enableDragCreate", !settings.enableDragCreate)}
                className={`sw-track${settings.enableDragCreate ? " on" : ""}`}
              >
                <div className="sw-thumb" />
              </button>
            </div>

            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">弹窗关闭自动暂存草稿</div>
                <div className="dw-settings-row-sub">新建弹窗未提交关闭时，自动存入草稿箱</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.autoDraft}
                disabled={savingSettings}
                onClick={() => onUpdateSetting("autoDraft", !settings.autoDraft)}
                className={`sw-track${settings.autoDraft ? " on" : ""}`}
              >
                <div className="sw-thumb" />
              </button>
            </div>
          </div>

          {/* 4. Official Holiday Calendar */}
          <div className="dw-settings-card">
            <div className="dw-settings-card-title">法定节假日数据</div>
            <HolidayCalendarSettings compact onResult={(msg, err) => onNotify(msg, err)} />
          </div>

          {/* 5. Desktop Reminders & System */}
          <div className="dw-settings-card">
            <div className="dw-settings-card-title">提醒与系统</div>

            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">日程提前提醒</div>
                <div className="dw-settings-row-sub">
                  开始前和结束前触发 Windows 通知
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <FluentSelect<number>
                  ariaLabel="日程提前提醒"
                  style={{ width: 156 }}
                  value={settings.taskLeadMinutes}
                  disabled={savingSettings}
                  onChange={(v) => onUpdateSetting("taskLeadMinutes", v)}
                  options={[
                    { value: 0, label: "关闭提醒" },
                    { value: 5, label: "提前 5 分钟（推荐）" },
                    { value: 10, label: "提前 10 分钟" },
                    { value: 15, label: "提前 15 分钟" },
                    { value: 30, label: "提前 30 分钟" },
                    { value: 60, label: "提前 60 分钟" },
                    ...([0, 5, 10, 15, 30, 60].includes(settings.taskLeadMinutes)
                      ? []
                      : [{ value: settings.taskLeadMinutes, label: `提前 ${settings.taskLeadMinutes} 分钟` }]),
                  ]}
                />
                <button type="button" className="dw-btn-ghost" onClick={() => void handleTestNotification()}>
                  测试通知
                </button>
              </div>
            </div>

            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">开机启动</div>
                <div className="dw-settings-row-sub">登录 Windows 后自动在后台运行</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autostart}
                onClick={() => void handleToggleAutostart()}
                className={`sw-track${autostart ? " on" : ""}`}
              >
                <div className="sw-thumb" />
              </button>
            </div>

            <div className="dw-settings-row">
              <div>
                <div className="dw-settings-row-title">关闭窗口时最小化到托盘</div>
                <div className="dw-settings-row-sub">点击右上角关闭后驻留系统托盘以保持定时提醒</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.closeToTray}
                disabled={savingSettings}
                onClick={() => onUpdateSetting("closeToTray", !settings.closeToTray)}
                className={`sw-track${settings.closeToTray ? " on" : ""}`}
              >
                <div className="sw-thumb" />
              </button>
            </div>
          </div>

          {/* 6. About */}
          <div className="dw-settings-card">
            <div className="dw-settings-card-title">关于 今序 · Dayweave</div>
            <dl className="dw-about-facts">
              <div>
                <dt>版本</dt>
                <dd className="font-mono">0.1.0</dd>
              </div>
              <div>
                <dt>数据存储</dt>
                <dd className="font-mono">dayweave.sqlite3（本机离线）</dd>
              </div>
              <div>
                <dt>语言与时区</dt>
                <dd>简体中文 · 北京时间 (+08:00)</dd>
              </div>
              <div>
                <dt>隐私原则</dt>
                <dd>任务与偏好完全存于本机，仅节假日检查访问网络</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {deleteTagTarget && (
        <dialog
          ref={deleteDialogRef}
          className="dw-modal"
          aria-labelledby="dw-delete-tag-title"
          aria-describedby="dw-delete-tag-desc"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.stopPropagation();
          }}
          onCancel={(e) => {
            if (deleteTagAttempt.pending.current) e.preventDefault();
          }}
          onClose={() => {
            if (deleteTagAttempt.pending.current) return;
            setDeleteTagTarget(null);
            setDeleteTagFailed(false);
          }}
        >
          <div className="dw-modal-header">
            <span className="dw-modal-title" id="dw-delete-tag-title">
              删除标签？
            </span>
          </div>
          <div className="dw-modal-form">
            <p id="dw-delete-tag-desc" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {deleteTagTarget.count > 0
                ? `将删除标签「#${deleteTagTarget.tag.name}」，关联的 ${deleteTagTarget.count} 项任务及对应草稿、重复规则将变为无标签。此操作无法撤销。`
                : `将删除标签「#${deleteTagTarget.tag.name}」，对应草稿和重复规则中的该标签也会一并清除。此操作无法撤销。`}
            </p>
            {deleteTagFailed && (
              <p role="alert" style={{ margin: 0, color: "var(--w-rose-text)" }}>
                删除未完成，请重试或取消。
              </p>
            )}
            <div className="dw-modal-footer">
              <button
                type="button"
                className="dw-btn-ghost"
                autoFocus
                disabled={deleteTagAttempt.saving}
                onClick={() => {
                  deleteDialogRef.current?.close();
                  setDeleteTagTarget(null);
                  setDeleteTagFailed(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="dw-btn-danger-outline"
                disabled={deleteTagAttempt.saving}
                onClick={async () => {
                  if (!deleteTagTarget || deleteTagAttempt.pending.current) return;
                  setDeleteTagFailed(false);
                  if (await deleteTagAttempt.save(() => onDeleteTag(deleteTagTarget.tag.id))) {
                    deleteDialogRef.current?.close();
                    setDeleteTagTarget(null);
                    setDeleteTagFailed(false);
                  } else {
                    setDeleteTagFailed(true);
                  }
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </dialog>
      )}
    </main>
  );
}
