'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Plus, Video, Clock, Users, Radio, Loader2, Copy, Link2, ArrowRight,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import { Api } from '@/lib/api';
import { useLiveStream } from '@/hooks/use-live-stream';
import { formatDuration, timeAgo } from '@/lib/utils';

const statusVariant: Record<string, any> = {
  ACTIVE: 'success', WAITING: 'warning', ENDED: 'secondary', SCHEDULED: 'default', CANCELLED: 'destructive',
};

export default function DashboardPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['sessions'], queryFn: () => Api.listSessions('?take=50') });

  // Live: any session lifecycle event refetches the list (no polling, no manual refresh).
  useLiveStream('dashboard', () => qc.invalidateQueries({ queryKey: ['sessions'] }));

  const sessions = data?.items ?? [];
  const active = sessions.filter((s: any) => s.status === 'ACTIVE' || s.status === 'WAITING');
  const recent = sessions.filter((s: any) => s.status === 'ENDED').slice(0, 8);

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-6xl py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Support Dashboard</h1>
              <p className="text-sm text-muted-foreground">Create sessions and invite customers to a video support call.</p>
            </div>
            <CreateSessionDialog onCreated={() => qc.invalidateQueries({ queryKey: ['sessions'] })} />
          </div>

          {/* Stats */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatCard icon={Radio} label="Active now" value={active.length} accent="text-success" />
            <StatCard icon={Video} label="Total sessions" value={sessions.length} />
            <StatCard icon={Clock} label="Avg duration" value={formatDuration(avg(sessions))} />
          </div>

          {/* Active sessions */}
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Active & waiting</h2>
            {isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>
            ) : active.length === 0 ? (
              <Card><CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Video className="mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No active sessions. Create one to get started.</p>
              </CardContent></Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((s: any, i: number) => (
                  <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                    <SessionCard session={s} onJoin={() => router.push(`/room/${s.id}`)} onInvite={() => {}} />
                  </motion.div>
                ))}
              </div>
            )}
          </section>

          {/* Recent */}
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent sessions</h2>
            <Card>
              <CardContent className="p-0">
                {recent.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No past sessions yet.</p>
                ) : (
                  <div className="divide-y">
                    {recent.map((s: any) => (
                      <button key={s.id} onClick={() => router.push(`/history/${s.id}`)} className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/50">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary"><Video className="h-4 w-4 text-muted-foreground" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{s.title}</p>
                          <p className="text-xs text-muted-foreground">{s.customerName ?? 'Customer'} · {timeAgo(s.createdAt)}</p>
                        </div>
                        <Badge variant={statusVariant[s.status]}>{s.status}</Badge>
                        <span className="w-16 text-right text-xs text-muted-foreground">{formatDuration(s.durationSeconds)}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function avg(sessions: any[]) {
  const d = sessions.filter((s) => s.durationSeconds).map((s) => s.durationSeconds);
  return d.length ? Math.round(d.reduce((a: number, b: number) => a + b, 0) / d.length) : 0;
}

function StatCard({ icon: Icon, label, value, accent }: any) {
  return (
    <Card><CardContent className="flex items-center gap-4 py-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10"><Icon className={`h-5 w-5 ${accent ?? 'text-primary'}`} /></div>
      <div><p className="text-2xl font-bold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
    </CardContent></Card>
  );
}

function SessionCard({ session, onJoin }: { session: any; onJoin: () => void; onInvite: () => void }) {
  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="truncate font-medium">{session.title}</p>
            <p className="text-xs text-muted-foreground">{session.customerName ?? 'Customer'} · code {session.code}</p>
          </div>
          <Badge variant={statusVariant[session.status]}>{session.status === 'ACTIVE' && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}{session.status}</Badge>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {session.participantCount} participant(s)
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="gradient" className="flex-1" onClick={onJoin}><Video />Join room</Button>
          <InviteButton sessionId={session.id} />
        </div>
      </CardContent>
    </Card>
  );
}

function InviteButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState('');

  async function generate() {
    setLoading(true);
    try {
      const res = await Api.createInvite(sessionId, customerName ? { customerName } : {});
      setInvite(res);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setInvite(null); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Link2 />Invite</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite a customer</DialogTitle><DialogDescription>Generate a secure, single-use invite link to share.</DialogDescription></DialogHeader>
        {!invite ? (
          <div className="space-y-3">
            <div className="space-y-2"><Label>Customer name (optional)</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Jane from Acme" /></div>
            <Button onClick={generate} disabled={loading} variant="gradient" className="w-full">{loading && <Loader2 className="animate-spin" />}Generate invite link</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border bg-secondary/50 p-2">
              <code className="flex-1 truncate text-xs">{invite.url}</code>
              <Button size="icon" variant="ghost" onClick={() => { navigator.clipboard.writeText(invite.url); toast.success('Copied'); }}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">Expires {new Date(invite.expiresAt).toLocaleString()}. The link works once and only for this session.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateSessionDialog({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [loading, setLoading] = useState(false);

  async function create() {
    if (!title.trim()) return toast.error('Title is required');
    setLoading(true);
    try {
      const s: any = await Api.createSession({ title, customerName: customerName || undefined });
      toast.success('Session created');
      setOpen(false);
      onCreated();
      router.push(`/room/${s.id}`);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="gradient"><Plus />New session</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create support session</DialogTitle><DialogDescription>You&apos;ll enter the room and can invite the customer from there.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2"><Label>Session title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Router setup — Acme Corp" autoFocus /></div>
          <div className="space-y-2"><Label>Customer name (optional)</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Jane Doe" /></div>
          <Button onClick={create} disabled={loading} variant="gradient" className="w-full">{loading && <Loader2 className="animate-spin" />}Create & enter room</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
