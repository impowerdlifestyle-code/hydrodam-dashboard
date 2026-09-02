"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Badge, buttonClass } from "@/components/ui";

type Doc = { id: string; kind: string; title: string; mime: string; size_bytes: number; visible_to_client: boolean; uploaded_by: string | null; created_at: string };

const KINDS = [
  ["project_plan", "Project plan"],
  ["itemized_estimate", "Itemized estimate"],
  ["website_estimate", "Website estimate"],
  ["agreement", "Agreement"],
  ["photo", "Photo"],
  ["other", "Document"],
] as const;

const fmtSize = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function DocumentUploader({ clientId, docs, kindLabels }: { clientId: string; docs: Doc[]; kindLabels: Record<string, string> }) {
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("project_plan");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upload() {
    if (!file) return;
    setBusy("upload"); setToast(null);
    try {
      const sign = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign", clientId, filename: file.name, mime: file.type || "application/pdf", size: file.size }) });
      const signed = (await sign.json()) as { uploadUrl?: string; path?: string; clientId?: string; error?: string };
      if (!sign.ok || !signed.uploadUrl || !signed.path) throw new Error(signed.error ?? "Could not start the upload.");
      const put = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/pdf" }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      const rec = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "record", clientId: signed.clientId ?? clientId, kind, title: title || file.name.replace(/\.[^.]+$/, ""), path: signed.path, mime: file.type || "application/pdf", size: file.size }) });
      if (!rec.ok) throw new Error("Uploaded, but could not record it.");
      setFile(null); setTitle(""); if (inputRef.current) inputRef.current.value = "";
      setToast({ ok: true, message: "Uploaded. It is on their portal now." });
      router.refresh();
    } catch (e) {
      setToast({ ok: false, message: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(null);
    }
  }

  const field = "w-full rounded-lg border border-line bg-abyss px-3 py-2 text-xs text-ink outline-none focus:border-teal disabled:opacity-60";

  return (
    <div className="flex flex-col gap-3">
      {docs.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border border-line/60 p-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal/15 text-teal"><Icon name={d.mime.startsWith("image/") ? "camera" : "file"} size={15} /></span>
              <span className="min-w-0 flex-1">
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm text-ink hover:text-teal">{d.title}</a>
                <span className="block truncate text-[11px] text-ink-faint">{kindLabels[d.kind] ?? d.kind} · {fmtSize(d.size_bytes)}{d.uploaded_by ? ` · ${d.uploaded_by}` : ""}</span>
              </span>
              <button
                type="button"
                disabled={pending}
                title={d.visible_to_client ? "Customer can see this. Click to hide." : "Hidden from the customer. Click to show."}
                onClick={() => start(async () => { await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "visibility", id: d.id, visible: !d.visible_to_client }) }); router.refresh(); })}
                className="shrink-0"
              >
                <Badge tone={d.visible_to_client ? "good" : "neutral"}>{d.visible_to_client ? "on portal" : "hidden"}</Badge>
              </button>
              <button
                type="button"
                disabled={pending}
                aria-label={`Delete ${d.title}`}
                onClick={() => { if (window.confirm(`Delete ${d.title}? The customer loses it too.`)) start(async () => { await fetch("/api/documents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) }); router.refresh(); }); }}
                className="shrink-0 rounded-lg border border-line/60 p-1.5 text-ink-faint transition-colors hover:border-bad/50 hover:text-bad"
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-5 text-center transition-colors ${drag ? "border-teal bg-teal/5" : "border-line hover:border-line-bright"}`}
      >
        <Icon name="download" size={18} className="text-ink-faint" />
        <p className="mt-2 text-xs text-ink-dim">{file ? file.name : "Drop a PDF or image here, or click to choose"}</p>
        <p className="text-[10px] text-ink-faint">Up to 25 MB. Shows on the customer's portal straight away.</p>
        <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>

      {file && (
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={field} aria-label="Document kind">
            {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={field} />
          <button type="button" disabled={busy === "upload"} onClick={upload} className={`${buttonClass("primary", "sm")} sm:col-span-2`}>
            <Icon name="send" size={13} /> {busy === "upload" ? "Uploading…" : "Upload to their portal"}
          </button>
        </div>
      )}

      {toast && <p className={`rounded-lg border px-3 py-2 text-xs ${toast.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>{toast.message}</p>}
    </div>
  );
}
