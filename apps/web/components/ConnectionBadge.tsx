'use client';

import React from 'react';

interface ConnectionBadgeProps {
  signalingState: number;
  channelState: RTCDataChannelState;
  isRelayActive: boolean;
}

export default function ConnectionBadge({ signalingState, channelState, isRelayActive }: ConnectionBadgeProps) {
  let color = 'bg-zinc-400';
  let pulse = false;
  let label = 'Initializing...';
  let icon = '⏳';

  if (signalingState !== WebSocket.OPEN) {
    color = 'bg-amber-400';
    pulse = true;
    label = 'Connecting to server...';
    icon = '📡';
  } else if (channelState === 'open' && isRelayActive) {
    color = 'bg-orange-400';
    label = 'Connected — Relay Mode';
    icon = '🔄';
  } else if (channelState === 'open') {
    color = 'bg-emerald-400';
    label = 'Connected — P2P Direct';
    icon = '⚡';
  } else if (channelState === 'connecting') {
    color = 'bg-amber-400';
    pulse = true;
    label = 'Establishing P2P link...';
    icon = '🔗';
  } else if (channelState === 'closed') {
    color = 'bg-rose-400';
    label = 'Connection closed';
    icon = '❌';
  } else {
    // WebSocket open but no data channel yet
    color = 'bg-blue-400';
    pulse = true;
    label = 'Waiting for peer...';
    icon = '👀';
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 border-(--border) bg-(--surface) shadow-[2px_2px_0px_0px_var(--shadow)]">
      <div className="relative flex items-center justify-center">
        <div className={`w-3 h-3 rounded-full ${color}`} />
        {pulse && (
          <div className={`absolute w-3 h-3 rounded-full ${color} animate-ping opacity-75`} />
        )}
      </div>
      <span className="text-xs font-bold uppercase tracking-wider text-(--text-secondary)">
        {icon} {label}
      </span>
    </div>
  );
}

