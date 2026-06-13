'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, Video, ArrowRight } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Api } from '@/lib/api';
import { formatDuration, timeAgo } from '@/lib/utils';

const statusVariant: Record<string, any> = { ACTIVE: 'success', WAITING: 'warning', ENDED: 'secondary', SCHEDULED: 'default', CANCELLED: 'destructive' };

export default function HistoryPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['sessions', 'history', search], queryFn: () => Api.listSessions(`?take=100${search ? `&search=${encodeURIComponent(search)}` : ''}`) });
  const sessions = data?.items ?? [];

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-5xl py-8">
          <h1 className="text-2xl font-bold tracking-tight">Session History</h1>
          <p className="text-sm text-muted-foreground">Every session with who joined, when, and for how long — fully persisted & queryable.</p>

          <div className="relative mt-6">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, customer or code…" className="pl-9" />
          </div>

          <Card className="mt-4">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : sessions.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No sessions found.</p>
              ) : (
                <div className="divide-y">
                  {sessions.map((s: any) => (
                    <button key={s.id} onClick={() => router.push(`/history/${s.id}`)} className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-accent/50">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary"><Video className="h-4 w-4 text-muted-foreground" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.customerName ?? 'Customer'} · {s.agentName} · {timeAgo(s.createdAt)}</p>
                      </div>
                      {s.tags?.slice(0, 2).map((t: string) => <Badge key={t} variant="outline" className="hidden sm:inline-flex">{t}</Badge>)}
                      <Badge variant={statusVariant[s.status]}>{s.status}</Badge>
                      <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{formatDuration(s.durationSeconds)}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
