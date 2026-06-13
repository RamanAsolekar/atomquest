'use client';

import { use, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldX, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/logo';
import { Api } from '@/lib/api';
import { CustomerRoom } from '@/components/room/customer-room';

/**
 * Customer join portal. Validates the invite token, collects a display name,
 * then drops the customer into the call (no login, no app install).
 */
export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<'validating' | 'invalid' | 'ready' | 'joining'>('validating');
  const [error, setError] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    Api.validateInvite(token)
      .then((res) => { setInfo(res); setName(res.customerName ?? ''); setState('ready'); })
      .catch((e) => { setError(e.message ?? 'This invite is not valid'); setState('invalid'); });
  }, [token]);

  if (state === 'validating') {
    return <Center><Loader2 className="h-6 w-6 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Validating your invite…</p></Center>;
  }
  if (state === 'invalid') {
    return (
      <Center>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10"><ShieldX className="h-6 w-6 text-destructive" /></div>
        <h1 className="text-lg font-semibold">Invite not valid</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
        <p className="text-xs text-muted-foreground">Ask your support agent to send a fresh link.</p>
      </Center>
    );
  }
  if (state === 'joining') {
    return <CustomerRoom sessionId={info.sessionId} inviteToken={token} displayName={name} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mesh p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card/80 p-8 backdrop-blur">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success">
          <ShieldCheck className="h-4 w-4" />Valid invite
        </div>
        <h1 className="text-center text-lg font-semibold">{info.sessionTitle}</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">You&apos;ve been invited to a video support session.</p>
        <div className="mt-6 space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter your name" autoFocus />
          <Button variant="gradient" className="w-full" disabled={!name.trim()} onClick={() => setState('joining')}><Video />Join the call</Button>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">No installation required. Your camera & mic will be requested.</p>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-mesh p-4 text-center">{children}</div>;
}
