import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { createTag, listTagCatalog, type TaskTagDefinition } from "./tauri";
import { addTaskTag, matchesTag, MAX_GLOBAL_TAGS, MAX_TASK_TAGS, tagKey, uniqueTags } from "./task-tags";
import "./task-tags.css";

// One catalog request for all task rows; opening a picker explicitly refreshes it.
let catalog = { definitions: [] as TaskTagDefinition[], loaded: false, loading: false, error: "" };
let catalogRequest: Promise<void> | undefined;
let catalogRequested = false;
const catalogListeners = new Set<() => void>();
function updateCatalog(update: Partial<typeof catalog>) {
  catalog = { ...catalog, ...update };
  catalogListeners.forEach((listener) => listener());
}
function mergeCatalog(definitions: TaskTagDefinition[]) {
  // Keep creations that completed while an older list request was in flight.
  const byName = new Map(catalog.definitions.map((tag) => [tagKey(tag.name), tag]));
  definitions.forEach((tag) => byName.set(tagKey(tag.name), tag));
  updateCatalog({ definitions: [...byName.values()] });
}
function refreshCatalog(force = false): Promise<void> {
  if (catalogRequest) return catalogRequest;
  if (catalogRequested && !force) return Promise.resolve();
  catalogRequested = true;
  updateCatalog({ loading: true, error: "" });
  catalogRequest = listTagCatalog().then((definitions) => {
    mergeCatalog(definitions);
    updateCatalog({ loaded: true });
  }).catch((reason: unknown) => {
    updateCatalog({ error: String(reason instanceof Error ? reason.message : reason) });
  }).finally(() => {
    catalogRequest = undefined;
    updateCatalog({ loading: false });
  });
  return catalogRequest;
}
function subscribeCatalog(listener: () => void) {
  catalogListeners.add(listener);
  return () => { catalogListeners.delete(listener); };
}
function getCatalog() { return catalog; }
function useTagCatalog() {
  const snapshot = useSyncExternalStore(subscribeCatalog, getCatalog, getCatalog);
  useEffect(() => { void refreshCatalog(); }, []);
  return snapshot;
}
function colorFor(definitions: TaskTagDefinition[], name: string) {
  const color = definitions.find((tag) => tagKey(tag.name) === tagKey(name))?.color;
  return color !== undefined && Number.isInteger(color) && color >= 0 && color < 8 ? color : undefined;
}

export function TaskTagEditor({ tags, suggestions = [], disabled, id, inlineChips = false, onChange }: {
  tags: string[];
  suggestions?: string[];
  disabled: boolean;
  id: string;
  dropdown?: boolean; // Compatibility only: every editor now uses the same dropdown.
  inlineChips?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const { definitions, loaded, loading, error: catalogError } = useTagCatalog();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ left: 0, top: 0, width: 300, maxHeight: 400 });
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const latest = useRef({ tags, disabled, onChange });
  latest.current = { tags, disabled, onChange };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { if (disabled) close(); }, [disabled]);

  function close(restoreFocus = false) {
    setOpen(false);
    setInput("");
    setError("");
    composingRef.current = false;
    if (restoreFocus) triggerRef.current?.focus();
  }
  function show() {
    if (latest.current.disabled) return;
    setOpen(true);
    void refreshCatalog(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(320, window.innerWidth - 24);
      const below = window.innerHeight - trigger.bottom - 16;
      const above = trigger.top - 16;
      const placeAbove = below < 280 && above > below;
      const maxHeight = Math.max(80, Math.min(500, placeAbove ? above : below));
      const height = Math.min(panelRef.current?.scrollHeight ?? 400, maxHeight);
      const preferredLeft = inlineChips ? trigger.left : trigger.right - width;
      setPlacement({
        left: Math.max(12, Math.min(preferredLeft, window.innerWidth - width - 12)),
        top: placeAbove ? Math.max(12, trigger.top - height - 6) : trigger.bottom + 6,
        width, maxHeight
      });
    }
    position();
    inputRef.current?.focus();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = new ResizeObserver(position);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer.disconnect();
    };
  }, [open, inlineChips, tags.length]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent | FocusEvent) {
      if (!triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) close();
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || composingRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  const selected = uniqueTags(tags);
  const knownTags = uniqueTags([...definitions.map((tag) => tag.name), ...tags, ...suggestions]);
  const available = knownTags.filter((tag) => !input.trim() || tagKey(tag).includes(tagKey(input)));
  const exact = input.trim() ? knownTags.find((tag) => tagKey(tag) === tagKey(input)) : undefined;
  const taskFull = selected.length >= MAX_TASK_TAGS;
  const globalFull = definitions.length >= MAX_GLOBAL_TAGS;
  const busy = disabled || pending;
  const message = error || catalogError;

  function select(value: string) {
    if (latest.current.disabled || pendingRef.current) return;
    try {
      const next = addTaskTag(latest.current.tags, value);
      if (JSON.stringify(next) !== JSON.stringify(latest.current.tags)) latest.current.onChange(next);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  function remove(tag: string) {
    if (latest.current.disabled || pendingRef.current) return;
    latest.current.onChange(latest.current.tags.filter((value) => tagKey(value) !== tagKey(tag)));
    setError("");
  }
  async function create() {
    if (latest.current.disabled || pendingRef.current || !input.trim()) return;
    const name = input.trim();
    try {
      // Validate before persisting a new global definition.
      addTaskTag(latest.current.tags, name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await refreshCatalog();
      if (!catalog.loaded || catalog.error) throw new Error(catalog.error || "标签目录加载失败，请重新打开后重试");
      if (!mountedRef.current || latest.current.disabled) return;
      addTaskTag(latest.current.tags, name);
      let definition = catalog.definitions.find((tag) => tagKey(tag.name) === tagKey(name));
      if (!definition) {
        if (catalog.definitions.length >= MAX_GLOBAL_TAGS) throw new Error(`全局最多创建 ${MAX_GLOBAL_TAGS} 种标签`);
        definition = await createTag(name);
        mergeCatalog([definition]);
      }
      if (!mountedRef.current || latest.current.disabled) return;
      const next = addTaskTag(latest.current.tags, definition.name);
      latest.current.onChange(next);
      setInput("");
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }
  function optionInputs() {
    return Array.from(panelRef.current?.querySelectorAll<HTMLInputElement>('.task-tag-option input:not(:disabled)') ?? []);
  }

  return <div className={`task-tag-select-control${inlineChips ? " is-inline-chips" : ""}`}>
    {inlineChips && selected.map((tag) => <span key={tagKey(tag)} className="task-tag-chip" data-tag-color={colorFor(definitions, tag)} title={tag}>
      <span>#{tag}</span>
      <button type="button" disabled={busy} aria-label={`移除标签 ${tag}`} onClick={() => remove(tag)}>×</button>
    </span>)}
    <button ref={triggerRef} type="button" className={`task-tag-dropdown-trigger${inlineChips ? " is-add-chip" : ""}${open ? " is-open" : ""}`} disabled={disabled}
      aria-label={`选择标签${tags.length ? `，已选 ${tags.length} 个` : ""}`} title={tags.length ? tags.join("、") : "选择或新建标签"}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined}
      onClick={() => open ? close() : show()} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
      }}>
      {inlineChips ? <span>＋ 标签</span> : <>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 4h8l10 10-7 7L3 10Z" /><circle cx="7.5" cy="8" r="1" /></svg>
        <span>标签</span>{tags.length > 0 && <em>{tags.length}</em>}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </>}
    </button>
    {open && createPortal(<div ref={panelRef} id={`${id}-panel`} className="task-tag-editor task-tag-dropdown-panel" role="dialog" aria-label="选择任务标签" aria-busy={pending || loading} style={placement}
      onKeyDown={(event) => {
        if (!event.target || !(event.target as HTMLElement).matches('.task-tag-option input')) return;
        if (event.key === "Enter") { event.preventDefault(); (event.target as HTMLInputElement).click(); return; }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const options = optionInputs();
        const index = options.indexOf(event.target as HTMLInputElement);
        if (event.key === "Home") options[0]?.focus();
        else if (event.key === "End") options[options.length - 1]?.focus();
        else if (event.key === "ArrowUp" && index === 0) inputRef.current?.focus();
        else options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
      }}>
      <div className="task-tag-search-header">
        <header><strong>任务标签</strong><button type="button" aria-label="关闭标签选择" onClick={() => close(true)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button></header>
        <label className="sr-only" htmlFor={id}>搜索或新建标签</label>
        <div className="task-tag-entry">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
          <input ref={inputRef} id={id} value={input} disabled={busy} placeholder="搜索或新建标签" autoComplete="off" aria-invalid={Boolean(message)} aria-describedby={message ? `${id}-error` : undefined}
            onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
            onChange={(event) => { setInput(event.target.value); setError(""); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.stopPropagation();
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composingRef.current) return;
                event.preventDefault();
                if (exact) select(exact); else void create();
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (event.nativeEvent.isComposing || composingRef.current) return;
                event.preventDefault();
                const options = optionInputs();
                options[event.key === "ArrowDown" ? 0 : options.length - 1]?.focus();
              }
            }} />
        </div>
        {message && <p id={`${id}-error`} className="task-tag-error" role="alert">{message}</p>}
      </div>
      <div className="task-tag-scroll-area">
        <div className="task-tag-options" role="group" aria-label="已有标签">{available.map((tag) => {
          const checked = matchesTag(tags, tag);
          return <label key={tagKey(tag)} className="task-tag-option" data-tag-color={colorFor(definitions, tag)} title={tag}>
            <input type="checkbox" aria-label={tag} checked={checked} disabled={busy || (taskFull && !checked)} onChange={(event) => event.target.checked ? select(tag) : remove(tag)} />
            <span className="task-tag-swatch" aria-hidden="true" />
            <span className="task-tag-option-name" data-tag-color={colorFor(definitions, tag)} title={tag}>{tag}</span>
            <span className="task-tag-check" aria-hidden="true">{checked ? "✓" : ""}</span>
          </label>;
        })}{available.length === 0 && <p className="task-tag-empty">{loading ? "正在加载标签…" : input.trim() ? "没有匹配的已有标签" : "还没有标签，输入名称即可创建。"}</p>}</div>
        {input.trim() && !exact && <button type="button" className="task-tag-create" disabled={busy || loading || !loaded || taskFull || globalFull} onMouseDown={(event) => event.preventDefault()} onClick={() => void create()}><span aria-hidden="true">＋</span><span>{pending ? "添加中…" : `新建「${input.trim()}」`}</span></button>}
      </div>
      <footer>
        <div><strong className="task-tag-count">已选 {selected.length}/{MAX_TASK_TAGS}</strong><span className="task-tag-global-count">全局 {definitions.length}/{MAX_GLOBAL_TAGS}</span></div>
        {taskFull ? <span role="status">已达每项上限，仅可取消已选标签。</span> : globalFull ? <span role="status">已达全局上限，可选择已有标签。</span> : null}
      </footer>
    </div>, triggerRef.current?.closest("dialog") ?? document.body)}
  </div>;
}

export function TaskTagList({ tags, expanded = false, limit = 3 }: { tags: string[]; expanded?: boolean; limit?: number }) {
  const { definitions } = useTagCatalog();
  if (!tags.length) return null;
  const visible = expanded ? tags : tags.slice(0, limit);
  const overflow = expanded ? 0 : Math.max(0, tags.length - limit);
  return <span className="task-list-tags" aria-label="标签">{visible.map((tag) => <span key={tag} data-tag-color={colorFor(definitions, tag)} title={tag}>{tag}</span>)}{overflow > 0 && <span className="task-tag-overflow" aria-label={`还有 ${overflow} 个标签`} title={tags.slice(limit).join("、")}>+{overflow}</span>}</span>;
}

export function TaskTagFilter({ id, tags, counts, value, onChange }: {
  id: string;
  tags: string[];
  counts?: Record<string, number>;
  value: string;
  onChange: (tag: string) => void;
}) {
  const { definitions } = useTagCatalog();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const options = uniqueTags([...tags, ...(value ? [value] : [])]);
  const selectedTag = value ? (options.find((tag) => matchesTag([tag], value)) ?? value) : "";
  const active = Boolean(selectedTag);
  const activeTagColor = active ? colorFor(definitions, selectedTag) : undefined;
  const trimmedQuery = query.trim().toLowerCase();
  const filteredOptions = trimmedQuery ? options.filter((tag) => tag.toLowerCase().includes(trimmedQuery)) : options;

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    searchRef.current?.focus();
    function outside(event: PointerEvent | FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!options.length) return null;

  return <div ref={rootRef} className={`task-tag-filter task-filter-dropdown${open ? " is-open" : ""}`}>
    <div className={`task-filter-trigger-group${active ? " is-active" : ""}`} data-tag-color={activeTagColor}>
      <button
        ref={triggerRef}
        type="button"
        className={`task-filter-trigger${active ? " is-active" : ""}${open ? " is-open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-popover` : undefined}
        aria-label={active ? `标签筛选：${selectedTag}` : "标签筛选"}
        title={active ? `标签：${selectedTag}` : "按标签筛选"}
        onClick={() => setOpen((current) => !current)}
      >
        <svg className="task-filter-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 4h8l10 10-7 7L3 10Z" /><circle cx="7.5" cy="8" r="1" /></svg>
        <span className="task-filter-trigger-label">{active ? `#${selectedTag}` : "全部标签"}</span>
        {!active && <svg className="task-filter-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>}
      </button>
      {active && <button
        type="button"
        className="task-filter-clear"
        aria-label="清除标签筛选"
        title="清除标签筛选"
        onClick={() => { onChange(""); setOpen(false); }}
      ><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>}
    </div>
    {open && <div id={`${id}-popover`} className="task-filter-popover task-tag-filter-popover" role="dialog" aria-label="按标签筛选">
      <div className="task-filter-popover-search">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="m15.2 15.2 4.8 4.8" /></svg>
        <input
          ref={searchRef}
          id={`${id}-search`}
          type="search"
          value={query}
          placeholder="搜索标签…"
          aria-label="搜索标签"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div id={id} className="task-filter-popover-list" role="listbox" aria-label="标签选项">
        {(!trimmedQuery || "全部标签".includes(trimmedQuery)) && <button
          type="button"
          role="option"
          aria-selected={!active}
          className={`task-filter-option${!active ? " is-selected" : ""}`}
          onClick={() => { onChange(""); setOpen(false); }}
        >
          <span className="task-filter-option-name">全部标签</span>
          <span className="task-filter-option-meta">{!active && <span className="task-filter-check" aria-hidden="true">✓</span>}</span>
        </button>}
        {filteredOptions.length ? filteredOptions.map((tag) => {
          const selected = Boolean(active && matchesTag([tag], selectedTag));
          const count = counts?.[tagKey(tag)];
          return <button
            key={tagKey(tag)}
            type="button"
            role="option"
            aria-selected={selected}
            className={`task-filter-option${selected ? " is-selected" : ""}`}
            data-tag-color={colorFor(definitions, tag)}
            title={tag}
            onClick={() => { onChange(tag); setOpen(false); }}
          >
            <span className="task-filter-swatch" aria-hidden="true" />
            <span className="task-filter-option-name">#{tag}</span>
            <span className="task-filter-option-meta">
              {count !== undefined && <span className="task-filter-option-count">{count}</span>}
              {selected && <span className="task-filter-check" aria-hidden="true">✓</span>}
            </span>
          </button>;
        }) : <p className="task-filter-popover-empty">未找到匹配标签</p>}
      </div>
    </div>}
  </div>;
}
