"use client";

import { useCallback, useRef, useState } from "react";

interface Props {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  maxSizeMb?: number;
}

export default function FileDropzone({ accept, multiple = false, onFiles, maxSizeMb = 200 }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list);
      const tooBig = files.find((f) => f.size > maxSizeMb * 1024 * 1024);
      if (tooBig) {
        setError(`"${tooBig.name}" exceeds the ${maxSizeMb} MB limit.`);
        return;
      }
      setError(null);
      onFiles(multiple ? files : files.slice(0, 1));
    },
    [multiple, maxSizeMb, onFiles]
  );

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
        }`}
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700">
          Drag & drop {multiple ? "files" : "a file"} here, or <span className="text-brand-600 underline">browse</span>
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {accept} · up to {maxSizeMb} MB {multiple ? "per file" : ""}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
