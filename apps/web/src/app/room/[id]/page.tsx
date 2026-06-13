'use client';

import { use, useEffect, useState } from 'react';
import { Loader2, Video as VideoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/logo';
import { CallRoom } from '@/components/room/call-room';
import { useAuth } from '@/store/auth-store';

/** Agent room entry. Agents are JWT-authenticated; pre-join confirms their name. */
export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [started, setStarted] = useState(false);

  useEffect(() => { if (user) setDisplayName(user.name); }, [user]);

  if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  if (!started) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mesh p-4">
        <div className="w-full max-w-sm rounded-2xl border bg-card/80 p-8 backdrop-blur">
          <div className="mb-6 flex justify-center"><Logo /></div>
          <h1 className="text-center text-lg font-semibold">Ready to join?</h1>
          <p className="mt-1 text-center text-sm text-muted-foreground">You&apos;re joining as the agent.</p>
          <div className="mt-6 space-y-3">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
            <Button variant="gradient" className="w-full" disabled={!displayName.trim()} onClick={() => setStarted(true)}><VideoIcon />Join call</Button>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">Your camera & mic will be requested next.</p>
        </div>
      </div>
    );
  }
  return <CallRoom sessionId={id} displayName={displayName} />;
}
