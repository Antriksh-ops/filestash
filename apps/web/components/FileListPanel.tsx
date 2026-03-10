'use client';

import React from 'react';

interface FileInfo {
    name: string;
    size: number;
}

interface FileListPanelProps {
    files: File[] | FileInfo[];
    currentFileIndex: number;
    showFileList: boolean;
    onToggle: () => void;
}

export default function FileListPanel({ files, currentFileIndex, showFileList, onToggle }: FileListPanelProps) {
    const totalSize = files.reduce((a, b) => a + b.size, 0);

    return (
        <div className="relative">
            <div
                onClick={onToggle}
                className="flex items-center gap-6 p-6 border-4 border-black rounded-2xl bg-orange-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] cursor-pointer hover:bg-orange-100 transition-all select-none"
            >
                <div className="w-16 h-16 rounded-xl bg-emerald-300 border-4 border-black flex items-center justify-center text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                </div>
                <div className="flex-1 overflow-hidden">
                    <div className="flex items-center justify-between">
                        <p className="text-black font-black truncate uppercase text-lg leading-tight">
                            {files[currentFileIndex]?.name || 'Bridging...'}
                        </p>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24" height="24"
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                            className={`transition-transform duration-200 ${showFileList ? 'rotate-180' : ''}`}
                        >
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>
                    <p className="text-zinc-600 font-bold text-sm uppercase flex items-center gap-2 mt-1">
                        {files.length > 1 && (
                            <span className="bg-black text-white px-2 py-0.5 rounded text-[10px]">FILE {currentFileIndex + 1}/{files.length}</span>
                        )}
                        <span>{(totalSize / 1024 / 1024).toFixed(2)} MB</span>
                    </p>
                </div>
            </div>

            {showFileList && (
                <div className="absolute top-full left-0 right-0 mt-4 bg-white border-4 border-black rounded-2xl shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] z-10 max-h-60 overflow-y-auto p-2 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    {files.map((file, idx) => (
                        <div
                            key={idx}
                            className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all ${idx === currentFileIndex ? 'bg-yellow-100 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]' : 'bg-white border-zinc-200'}`}
                        >
                            <p className="text-black font-black text-xs truncate max-w-[70%] uppercase">{file.name}</p>
                            <p className="text-zinc-500 font-bold text-[10px] uppercase">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
