'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/logo';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn, initials } from '@/lib/utils';

export interface PreJoinChoice {
  displayName: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

/**
 * Google-Meet-style green room. Before entering the call the participant sees a
 * live self-preview, can toggle camera/mic, and confirms their name. This is
 * also where camera/mic permission is requested — so by the time we connect to
 * the SFU, the local tracks already exist and "connecting" is fast and honest.
 *
 * The preview stream is the participant's own; it is stopped on submit and the
 * real call re-acquires media (kept simple — the preview is purely UX).
 */
export function PreJoin({
  title,
  subtitle,
  roleLabel,
  defaultName = '',
  nameEditable = true,
  onJoin,
}: {
  title: string;
  subtitle?: string;
  roleLabel?: string;
  defaultName?: string;
  nameEditable?: boolean;
  onJoin: (choice: PreJoinChoice) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [name, setName] = useState(defaultName);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [permission, setPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [ready, setReady] = useState(false);

  useEffect(() => setName(defaultName), [defaultName]);

  // Acquire a preview stream once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPermission('granted');
      } catch {
        // No camera/mic or blocked — let them join audio-less; the call retries.
        setPermission('denied');
        setVideoEnabled(false);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Reflect toggles onto the preview tracks so the green room feels live.
  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = videoEnabled));
  }, [videoEnabled]);
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = audioEnabled));
  }, [audioEnabled]);

  const submit = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onJoin({ displayName: name.trim(), audioEnabled, videoEnabled });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-mesh p-4">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[1.4fr_1fr]">
        {/* Live preview */}
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0f] shadow-xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn('h-full w-full object-cover [transform:scaleX(-1)]', !videoEnabled && 'hidden')}
          />
          {!videoEnabled && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white/70">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="bg-white/10 text-xl text-white">
                  {name ? initials(name) : '?'}
                </AvatarFallback>
              </Avatar>
              <p className="text-sm">Camera is off</p>
            </div>
          )}
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}

          {/* Device toggles overlaid on the preview, Meet-style */}
          <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setAudioEnabled((v) => !v)}
              title={audioEnabled ? 'Turn off microphone' : 'Turn on microphone'}
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full transition-colors',
                audioEnabled ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-destructive text-white',
              )}
            >
              {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setVideoEnabled((v) => !v)}
              title={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
              disabled={permission === 'denied'}
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:opacity-40',
                videoEnabled ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-destructive text-white',
              )}
            >
              {videoEnabled ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Join panel */}
        <div className="flex flex-col justify-center rounded-2xl border bg-card/80 p-8 backdrop-blur">
          <div className="mb-6 flex justify-center">
            <Logo />
          </div>
          <h1 className="text-center text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-center text-sm text-muted-foreground">{subtitle}</p>}
          {roleLabel && (
            <p className="mt-2 text-center text-xs font-medium uppercase tracking-wider text-primary">
              {roleLabel}
            </p>
          )}

          <div className="mt-6 space-y-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              disabled={!nameEditable}
              autoFocus={nameEditable}
            />
            <Button
              variant="gradient"
              className="w-full"
              disabled={!name.trim() || !ready}
              onClick={submit}
            >
              <VideoIcon />
              Join now
            </Button>
          </div>

          {permission === 'denied' && (
            <p className="mt-4 text-center text-xs text-warning">
              Camera/mic blocked. You can still join — enable them in your browser to share video.
            </p>
          )}
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Check your camera & mic above before joining.
          </p>
        </div>
      </div>
    </div>
  );
}
