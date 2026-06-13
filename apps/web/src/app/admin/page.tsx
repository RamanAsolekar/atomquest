'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Radio, Users, Clock, Circle, PhoneOff, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Api } from '@/lib/api';
import { useLiveStream } from '@/hooks/use-live-stream';
import { formatDuration, initials } from '@/lib/utils';

export default function AdminPage() {
  const router = useRouter();
  const qc = useQueryClient();
  // Live via SSE (with a slow 10s safety refetch for running-duration ticks).
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'live'], queryFn: () => Api.liveSessions(), refetchInterval: 10000 });
  useLiveStream('admin', () => qc.invalidateQueries({ queryKey: ['admin', 'live'] }));

  const forceEnd = useMutation({
    mutationFn: (id: string) => Api.forceEnd(id),
    onSuccess: () => { toast.success('Session ended'); qc.invalidateQueries({ queryKey: ['admin', 'live'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const live = data ?? [];

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-6xl py-8">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Admin — Live Operations</h1>
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" /></span>
          </div>
          <p className="text-sm text-muted-foreground">Live sessions with participant details and duration. End any session, inspect, or monitor.</p>

          {isLoading ? <Loader2 className="mt-8 h-6 w-6 animate-spin" /> : live.length === 0 ? (
            <Card className="mt-6"><CardContent className="flex flex-col items-center py-16 text-center"><Radio className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">No live sessions right now.</p></CardContent></Card>
          ) : (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {live.map((s: any) => (
                <Card key={s.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">agent {s.agentName} · code {s.code}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {s.recordingStatus === 'RECORDING' && <Badge variant="live"><Circle className="mr-1 h-2 w-2 animate-pulse fill-current" />REC</Badge>}
                        <Badge variant={s.status === 'ACTIVE' ? 'success' : 'warning'}>{s.status}</Badge>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatDuration(s.runningSeconds)}</span>
                      <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{s.connectedCount} connected</span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {s.participants.map((p: any) => (
                        <div key={p.id} className="flex items-center gap-1.5 rounded-full border bg-secondary/40 py-0.5 pl-0.5 pr-2.5">
                          <Avatar className="h-5 w-5"><AvatarFallback className="text-[8px]">{initials(p.displayName)}</AvatarFallback></Avatar>
                          <span className="text-xs">{p.displayName}</span>
                          <span className={`h-1.5 w-1.5 rounded-full ${p.status === 'CONNECTED' ? 'bg-success' : p.status === 'RECONNECTING' ? 'bg-warning' : 'bg-muted-foreground'}`} />
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => router.push(`/room/${s.id}`)}><Eye />Monitor</Button>
                      <Button size="sm" variant="destructive" onClick={() => forceEnd.mutate(s.id)} disabled={forceEnd.isPending}><PhoneOff />Force end</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
