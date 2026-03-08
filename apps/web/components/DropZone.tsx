'use client';

import React, { useState, useCallback } from 'react';

interface DropZoneProps {
    onFileSelect: (files: File[]) => void;
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

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFileSelect(Array.from(e.dataTransfer.files));
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
            className={`relative w-full p-8 py-10 border-4 border-black rounded-3xl transition-all duration-200 flex flex-col items-center justify-center gap-4 cursor-pointer
        ${isDragging
                    ? 'bg-blue-50 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] -translate-x-1 -translate-y-1'
                    : 'bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-1 hover:-translate-y-1'
                }`}
        >
            <input
                type="file"
                multiple
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
            />

            <div className="w-16 h-16 rounded-xl bg-yellow-300 border-2 border-black flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-black">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />
                </svg>
            </div>

            <div className="text-center">
                <h3 className="text-2xl font-black text-black mb-2 uppercase tracking-tight">
                    Drop files to bridge
                </h3>
                <p className="text-zinc-600 font-bold text-sm">
                    or click to browse your device
                </p>
            </div>

            <div className="flex gap-4 mt-4">
                <div className="px-4 py-2 border-2 border-black rounded-lg bg-emerald-300 text-black text-xs font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    Any size
                </div>
                <div className="px-4 py-2 border-2 border-black rounded-lg bg-violet-300 text-black text-xs font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    P2P Encrypted
                </div>
            </div>
        </div>
    );
}
