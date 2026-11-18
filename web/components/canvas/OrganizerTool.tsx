// OrganizerTool — routes the five Phase 1 tools to their canvases and
// owns the shared pick flow.
//
// Pick flow (two tracks in parallel, no quota consumed by either):
//   1. Local: the picked File objects load into pdf.js (usePdfFiles)
//      so thumbnails render immediately, in the browser only.
//   2. Server: the same files upload via api.upload so the job can be
//      created later.
// The workspace appears only once the local documents are ready; the
// Process button stays disabled until every file has an uploaded id.
// On "Start over" the session key bumps and the canvas remounts fresh.
//
// Lazy loading: each tool canvas is a separate chunk, loaded only when
// its tool page opens (next/dynamic). The shared shell/grid code stays
// in the tool page bundle; the five canvases never load together.
"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { usePdfFiles } from "../../hooks/usePdfDocument";
import { ORGANIZER_TOOL_SLUGS } from "../../lib/tools";
import { useOrganizerJob } from "./useOrganizerJob";

function CanvasLoading() {
  const t = useTranslations("runner");
  return <p className="py-16 text-center text-slate-500">{t("loading")}</p>;
}

const DeleteCanvas = dynamic(() => import("./tools/DeleteCanvas").then((m) => m.DeleteCanvas), {
  loading: () => <CanvasLoading />,
});
const MergeCanvas = dynamic(() => import("./tools/MergeCanvas").then((m) => m.MergeCanvas), {
  loading: () => <CanvasLoading />,
});
const ReorderCanvas = dynamic(() => import("./tools/ReorderCanvas").then((m) => m.ReorderCanvas), {
  loading: () => <CanvasLoading />,
});
const RotateCanvas = dynamic(() => import("./tools/RotateCanvas").then((m) => m.RotateCanvas), {
  loading: () => <CanvasLoading />,
});
const SplitCanvas = dynamic(() => import("./tools/SplitCanvas").then((m) => m.SplitCanvas), {
  loading: () => <CanvasLoading />,
});

const CANVASES = {
  merge: MergeCanvas,
  split: SplitCanvas,
  rotate_pages: RotateCanvas,
  delete_pages: DeleteCanvas,
  reorder_pages: ReorderCanvas,
} as const;

export const ORGANIZER_TOOLS: readonly string[] = ORGANIZER_TOOL_SLUGS;

export function OrganizerTool({ toolKey }: { toolKey: string }) {
  const tRunner = useTranslations("runner");
  const tErr = useTranslations("errors");
  const job = useOrganizerJob(toolKey);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [session, setSession] = useState(0);
  const { state: pdfsState } = usePdfFiles(localFiles);

  const handlePick = useCallback(
    (picked: File[]) => {
      const max = job.spec?.max_files ?? (toolKey === "merge" ? 20 : 1);
      const room = Math.max(0, max - localFiles.length);
      const accepted = picked.slice(0, room);
      if (accepted.length === 0) return;
      setLocalFiles([...localFiles, ...accepted]);
      // Upload in parallel with the local pdf.js load; errors surface
      // through the job hook's error state.
      void job.uploadFiles(accepted).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localFiles, job.spec?.max_files, toolKey],
  );

  // Promote to the workspace once local documents are ready; a failed
  // local load drops back to pick with an error.
  useEffect(() => {
    if (pdfsState.status === "ready" && job.phase === "uploading") {
      job.setPhase("organize");
    } else if (pdfsState.status === "error") {
      job.setError(pdfsState.message);
      job.setPhase("pick");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfsState.status]);

  const handleReset = useCallback(() => {
    setLocalFiles([]);
    job.reset();
    setSession((s) => s + 1);
  }, [job]);

  if (job.specError) {
    return <p className="text-red-600">{tRunner("loadFailed", { error: job.specError })}</p>;
  }
  if (!job.spec) return <p className="text-slate-500">{tRunner("loading")}</p>;

  const Canvas = CANVASES[toolKey as keyof typeof CANVASES];
  if (!Canvas) return <p className="text-red-600">{tErr("tool_error")}</p>;

  const pdfs = pdfsState.status === "ready" ? pdfsState.pdfs : [];
  const effectiveJob = {
    ...job,
    // Never show the workspace before the local documents are ready.
    phase: pdfsState.status === "ready" ? job.phase : job.phase === "organize" ? "uploading" : job.phase,
    reset: handleReset,
  };

  return (
    <Canvas
      key={session}
      job={effectiveJob}
      pdfs={pdfs}
      localFiles={localFiles}
      onPick={handlePick}
    />
  );
}
