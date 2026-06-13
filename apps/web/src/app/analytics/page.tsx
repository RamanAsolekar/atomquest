'use client';

import { Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveStream } from '@/hooks/use-live-stream';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, CartesianGrid,
} from 'recharts';
import { Video, Clock, Gauge, CheckCircle2, Radio } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Api } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

const SENTIMENT_COLORS: Record<string, string> = { POSITIVE: '#22c55e', NEUTRAL: '#6b7280', NEGATIVE: '#f59e0b', FRUSTRATED: '#ef4444' };

export default function AnalyticsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['analytics'], queryFn: () => Api.analytics() });
  // Live: recompute analytics whenever a session ends or metrics tick.
  useLiveStream('dashboard', () => qc.invalidateQueries({ queryKey: ['analytics'] }));

  return (
    <AppShell>
      <div className="h-screen overflow-y-auto">
        <div className="container max-w-6xl py-8">
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Resolution analytics, sentiment, agent productivity & session heatmaps.</p>

          {isLoading || !data ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}</div>
          ) : (
            <>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Stat icon={Video} label="Total sessions" value={data.totalSessions} />
                <Stat icon={Radio} label="Active now" value={data.activeSessions} accent="text-success" />
                <Stat icon={Clock} label="Avg duration" value={formatDuration(data.avgDurationSeconds)} />
                <Stat icon={Gauge} label="Avg quality" value={`${data.avgQualityScore}/100`} />
                <Stat icon={CheckCircle2} label="Resolution" value={`${data.resolutionRate}%`} />
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <Card><CardHeader><CardTitle className="text-base">Sessions (last 14 days)</CardTitle></CardHeader><CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.sessionsByDay}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} fontSize={11} />
                      <YAxis allowDecimals={false} fontSize={11} />
                      <Tooltip contentStyle={{ background: 'hsl(240 10% 8%)', border: '1px solid hsl(240 6% 18%)', borderRadius: 8 }} />
                      <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent></Card>

                <Card><CardHeader><CardTitle className="text-base">Sentiment breakdown</CardTitle></CardHeader><CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={Object.entries(data.sentimentBreakdown).map(([name, value]) => ({ name, value }))} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                        {Object.keys(data.sentimentBreakdown).map((k) => <Cell key={k} fill={SENTIMENT_COLORS[k]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'hsl(240 10% 8%)', border: '1px solid hsl(240 6% 18%)', borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent></Card>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <Card><CardHeader><CardTitle className="text-base">Agent leaderboard</CardTitle></CardHeader><CardContent>
                  <div className="space-y-2">{data.agentLeaderboard.map((a: any, i: number) => (
                    <div key={a.agentId} className="flex items-center gap-3">
                      <span className="w-5 text-sm font-bold text-muted-foreground">{i + 1}</span>
                      <div className="flex-1"><p className="text-sm font-medium">{a.agentName}</p><p className="text-xs text-muted-foreground">{a.sessions} sessions · {formatDuration(a.avgDuration)} avg</p></div>
                      <span className="text-sm font-semibold tabular-nums">{a.avgQuality}/100</span>
                    </div>
                  ))}</div>
                </CardContent></Card>

                <Card><CardHeader><CardTitle className="text-base">Top issue categories</CardTitle></CardHeader><CardContent>
                  <div className="space-y-2">{data.topIssueCategories.length ? data.topIssueCategories.map((c: any) => (
                    <div key={c.category} className="flex items-center gap-3">
                      <span className="flex-1 text-sm">{c.category}</span>
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-brand-gradient" style={{ width: `${Math.min(100, (c.count / data.topIssueCategories[0].count) * 100)}%` }} /></div>
                      <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">{c.count}</span>
                    </div>
                  )) : <p className="text-sm text-muted-foreground">Generate AI summaries to populate categories.</p>}</div>
                </CardContent></Card>
              </div>

              <Card className="mt-6"><CardHeader><CardTitle className="text-base">Session heatmap (UTC day × hour)</CardTitle></CardHeader><CardContent><Heatmap data={data.heatmap} /></CardContent></Card>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ icon: Icon, label, value, accent }: any) {
  return <Card><CardContent className="flex items-center gap-3 py-5"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><Icon className={`h-5 w-5 ${accent ?? 'text-primary'}`} /></div><div><p className="text-xl font-bold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>;
}

function Heatmap({ data }: { data: { day: number; hour: number; count: number }[] }) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const max = Math.max(1, ...data.map((d) => d.count));
  const grid: Record<string, number> = {};
  data.forEach((d) => (grid[`${d.day}-${d.hour}`] = d.count));
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: 'auto repeat(24, 1fr)' }}>
        <div />
        {Array.from({ length: 24 }).map((_, h) => <div key={h} className="text-center text-[9px] text-muted-foreground">{h % 3 === 0 ? h : ''}</div>)}
        {days.map((d, di) => (
          <Fragment key={d}>
            <div className="pr-2 text-right text-[10px] text-muted-foreground">{d}</div>
            {Array.from({ length: 24 }).map((_, h) => {
              const c = grid[`${di}-${h}`] ?? 0;
              const intensity = c / max;
              return <div key={`${di}-${h}`} title={`${c} sessions`} className="aspect-square rounded-sm" style={{ background: c ? `rgba(99,102,241,${0.15 + intensity * 0.85})` : 'hsl(240 6% 14%)' }} />;
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
