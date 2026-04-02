'use client';

import React, { useState, useCallback } from 'react';

interface DropZoneProps {
    onFileSelect: (files: File[]) => void;
}

/** Recursively read all files from a directory entry */
async function readDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<File[]> {
    const files: File[] = [];
    const reader = entry.createReader();

    const readEntries = (): Promise<FileSystemEntry[]> =>
        new Promise((resolve, reject) => reader.readEntries(resolve, reject));

    let batch = await readEntries();
    while (batch.length > 0) {
        for (const child of batch) {
            if (child.isFile) {
                const file = await new Promise<File>((resolve, reject) =>
                    (child as FileSystemFileEntry).file(resolve, reject)
                );
                // Preserve relative path in file name
                const relativePath = child.fullPath.startsWith('/') ? child.fullPath.slice(1) : child.fullPath;
                const renamedFile = new File([file], relativePath, { type: file.type, lastModified: file.lastModified });
                files.push(renamedFile);
            } else if (child.isDirectory) {
                const subFiles = await readDirectoryEntry(child as FileSystemDirectoryEntry);
                files.push(...subFiles);
            }
        }
        batch = await readEntries();
    }
    return files;
}

export default function DropZone({ onFileSelect }: DropZoneProps) {
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const items = e.dataTransfer.items;
        const allFiles: File[] = [];

        if (items && items.length > 0) {
            // Check for folder drops via webkitGetAsEntry
            const entries: FileSystemEntry[] = [];
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry?.();
                if (entry) entries.push(entry);
            }

            if (entries.length > 0) {
                for (const entry of entries) {
                    if (entry.isDirectory) {
                        const folderFiles = await readDirectoryEntry(entry as FileSystemDirectoryEntry);
                        allFiles.push(...folderFiles);
                    } else if (entry.isFile) {
                        const file = await new Promise<File>((resolve, reject) =>
                            (entry as FileSystemFileEntry).file(resolve, reject)
                        );
                        allFiles.push(file);
                    }
                }
            } else if (e.dataTransfer.files.length > 0) {
                allFiles.push(...Array.from(e.dataTransfer.files));
            }
        } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            allFiles.push(...Array.from(e.dataTransfer.files));
        }

        if (allFiles.length > 0) {
            onFileSelect(allFiles);
        }
    }, [onFileSelect]);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onFileSelect(Array.from(e.target.files));
        }
    }, [onFileSelect]);

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative w-full p-8 py-10 border-4 border-(--border) rounded-3xl transition-all duration-200 flex flex-col items-center justify-center gap-4 cursor-pointer
        ${isDragging
                    ? 'bg-blue-50 dark:bg-blue-950 shadow-[8px_8px_0px_0px_var(--shadow)] -translate-x-1 -translate-y-1'
                    : 'bg-(--surface) shadow-[4px_4px_0px_0px_var(--shadow)] hover:shadow-[8px_8px_0px_0px_var(--shadow)] hover:-translate-x-1 hover:-translate-y-1'
                }`}
        >
            <input
                type="file"
                multiple
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
            />

            <div className="w-16 h-16 rounded-xl bg-(--accent-yellow) border-2 border-(--border) flex items-center justify-center shadow-[2px_2px_0px_0px_var(--shadow)]">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />
                </svg>
            </div>

            <div className="text-center">
                <h3 className="text-2xl font-black text-(--text) mb-2 uppercase tracking-tight">
                    Drop files or folders
                </h3>
                <p className="text-(--text-secondary) font-bold text-sm">
                    or click to browse your device
                </p>
            </div>

            <div className="flex gap-4 mt-4 flex-wrap justify-center">
                <div className="px-4 py-2 border-2 border-(--border) rounded-lg bg-(--accent-emerald) text-black text-xs font-black uppercase shadow-[2px_2px_0px_0px_var(--shadow)]">
                    Any size
                </div>
                <div className="px-4 py-2 border-2 border-(--border) rounded-lg bg-(--accent-violet) text-black text-xs font-black uppercase shadow-[2px_2px_0px_0px_var(--shadow)]">
                    P2P Encrypted
                </div>
                <div className="px-4 py-2 border-2 border-(--border) rounded-lg bg-(--accent-yellow) text-black text-xs font-black uppercase shadow-[2px_2px_0px_0px_var(--shadow)]">
                    Folders OK
                </div>
            </div>
        </div>
    );
}

