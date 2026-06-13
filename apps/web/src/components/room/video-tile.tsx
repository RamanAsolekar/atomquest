'use client';

import { useEffect, useRef } from 'react';
import { MicOff, VideoOff, Monitor, Wifi } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn, initials } from '@/lib/utils';

interface Props {
  stream: MediaStream | null;
  name: string;
  muted?: boolean; // mute the <video> element (local tile to avoid echo)
  audioEnabled?: boolean;
  videoEnabled?: boolean;
  isScreen?: boolean;
  isLocal?: boolean;
  quality?: string;
  className?: string;
}

const qualityColor: Record<string, string> = {
  excellent: 'text-success', good: 'text-success', fair: 'text-warning', poor: 'text-destructive',
};

export function VideoTile({ stream, name, muted, audioEnabled = true, videoEnabled = true, isScreen, isLocal, quality, className }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);

  const showVideo = stream && (videoEnabled || isScreen);

  return (
    <div className={cn('group relative aspect-video overflow-hidden rounded-xl border bg-card', className)}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted || isLocal}
        className={cn('h-full w-full', isScreen ? 'object-contain bg-black' : 'object-cover', !showVideo && 'hidden')}
      />
      {!showVideo && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-secondary to-card">
          <Avatar className="h-16 w-16"><AvatarFallback className="text-xl">{initials(name)}</AvatarFallback></Avatar>
        </div>
      )}

      {/* overlay */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-black/40 px-2 py-0.5 text-xs font-medium text-white">
            {name}{isLocal && ' (You)'}{isScreen && ' · screen'}
          </span>
          {!audioEnabled && <span className="rounded-md bg-destructive/80 p-1"><MicOff className="h-3 w-3 text-white" /></span>}
          {!videoEnabled && !isScreen && <span className="rounded-md bg-black/40 p-1"><VideoOff className="h-3 w-3 text-white" /></span>}
          {isScreen && <span className="rounded-md bg-primary/80 p-1"><Monitor className="h-3 w-3 text-white" /></span>}
        </div>
        {quality && <Wifi className={cn('h-3.5 w-3.5', qualityColor[quality])} />}
      </div>
    </div>
  );
}
