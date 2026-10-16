"use client";
// Client-side primitives: Modal, Popover, Toaster, Combobox.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, description, children, footer, width = 520, className }: {
  open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-start sm:p-4 sm:pt-[10vh]">
      <div className="fixed inset-0 bg-ink/30 animate-fade-in" onClick={onClose} />
      <div role="dialog" aria-modal className={cn("pb-safe relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface animate-rise sm:max-h-none sm:overflow-visible sm:rounded-xl", className)} style={{ maxWidth: width, boxShadow: "var(--shadow-pop)" }}>
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
            <div>
              {title && <h2 className="text-[14px] font-semibold text-ink">{title}</h2>}
              {description && <p className="mt-0.5 text-[12.5px] text-ink-3">{description}</p>}
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-subtle hover:text-ink" aria-label="Close"><X size={16} /></button>
          </div>
        )}
        <div className="px-5 pb-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle/50 px-5 py-3 sm:rounded-b-xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Popover ---------- */
export function Popover({ trigger, children, align = "start", className, open: openProp, onOpenChange }: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end"; className?: string; open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  const [inner, setInner] = useState(false);
  const open = openProp ?? inner;
  const setOpen = useCallback((o: boolean) => { setInner(o); onOpenChange?.(o); }, [onOpenChange]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div className={cn("absolute z-40 mt-1.5 min-w-[200px] rounded-xl border border-line bg-surface p-1 animate-rise", align === "end" ? "right-0" : "left-0", className)} style={{ boxShadow: "var(--shadow-pop)" }}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ children, onClick, icon, danger, active, className }: { children: ReactNode; onClick?: () => void; icon?: ReactNode; danger?: boolean; active?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors", danger ? "text-bad hover:bg-bad-soft" : "text-ink-2 hover:bg-subtle hover:text-ink", active && "bg-subtle text-ink", className)}>
      {icon && <span className="text-ink-3">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {active && <Check size={14} className="text-ink-2" />}
    </button>
  );
}

/* ---------- Combobox (searchable single select) ---------- */
export interface Option { value: string; label: string; hint?: string; icon?: ReactNode }
export function Combobox({ options, value, onChange, placeholder = "Select…", name, className, allowClear = true, size = "md", renderValue }: {
  options: Option[]; value: string | null; onChange?: (v: string | null) => void; placeholder?: string; name?: string; className?: string; allowClear?: boolean; size?: "sm" | "md";
  renderValue?: (o: Option | undefined) => ReactNode;
}) {
  const [val, setVal] = useState<string | null>(value);
  useEffect(() => setVal(value), [value]);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const selected = options.find((o) => o.value === val);
  const pick = (v: string | null, close: () => void) => { setVal(v); onChange?.(v); setQuery(""); close(); };
  const id = useId();
  return (
    <>
      {name && <input type="hidden" name={name} value={val ?? ""} />}
      <Popover className="w-[260px]" trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-controls={id}
          className={cn("field flex items-center justify-between gap-2 text-left", size === "sm" && "h-8 py-1 text-[12.5px]", open && "border-ink-3 ring-4 ring-ink/5", className)}>
          <span className={cn("flex min-w-0 items-center gap-2 truncate", !selected && "text-ink-4")}>
            {renderValue ? renderValue(selected) : selected ? <>{selected.icon}{selected.label}</> : placeholder}
          </span>
          <ChevronDown size={14} className="shrink-0 text-ink-4" />
        </button>
      )}>
        {(close) => (
          <div id={id}>
            <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setHi(0); }} placeholder="Search…"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                if (e.key === "Enter") { e.preventDefault(); const o = filtered[hi]; if (o) pick(o.value, close); }
              }}
              className="mb-1 w-full rounded-lg border-0 bg-subtle px-2.5 py-1.5 text-[13px] outline-none placeholder:text-ink-4" />
            <div className="max-h-64 overflow-y-auto scroll-thin">
              {allowClear && val && <MenuItem onClick={() => pick(null, close)} className="text-ink-3">Clear</MenuItem>}
              {filtered.map((o, i) => (
                <button key={o.value} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o.value, close)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]", i === hi ? "bg-subtle text-ink" : "text-ink-2")}>
                  {o.icon}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="truncate text-[11.5px] text-ink-4">{o.hint}</span>}
                  {o.value === val && <Check size={14} />}
                </button>
              ))}
              {!filtered.length && <div className="px-2 py-3 text-center text-[12.5px] text-ink-4">No matches</div>}
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}

/* ---------- Toaster ---------- */
type Toast = { id: number; text: ReactNode; tone: "default" | "error" | "success" };
const ToastCtx = createContext<(text: ReactNode, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: ReactNode, tone: Toast["tone"] = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] animate-rise",
            t.tone === "error" ? "bg-bad text-white" : "bg-ink text-canvas")} style={{ boxShadow: "var(--shadow-pop)" }}>
            {t.tone === "success" && <Check size={14} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
