'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Video, MessageSquare, ShieldCheck, Sparkles, BarChart3,
  PencilRuler, Radio, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';

const features = [
  { icon: Video, title: 'Self-hosted SFU video', desc: 'mediasoup-powered, server-routed media. No third-party video API — your infrastructure, your data.' },
  { icon: MessageSquare, title: 'Live chat & file sharing', desc: 'Real-time messaging with persistence and secure in-call file transfer.' },
  { icon: Radio, title: 'One-click recording', desc: 'Start/stop server-side recording; downloadable when processing completes.' },
  { icon: Sparkles, title: 'AI Session Assistant', desc: 'Auto summaries, sentiment, action items, issue tagging & KB suggestions.' },
  { icon: PencilRuler, title: 'Visual assistance', desc: 'Draw on the screen, share a pointer, capture screenshots together.' },
  { icon: BarChart3, title: 'Operational intelligence', desc: 'Live admin dashboard, analytics, heatmaps, agent productivity & quality scoring.' },
];

const stack = ['Next.js 15', 'NestJS', 'mediasoup', 'PostgreSQL', 'Redis', 'S3', 'Prometheus', 'Grafana', 'Docker'];

export default function Landing() {
  return (
    <div className="min-h-screen bg-mesh">
      <header className="container flex h-16 items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-3">
          <Link href="/login"><Button variant="ghost" size="sm">Agent sign in</Button></Link>
          <Link href="/login"><Button variant="gradient" size="sm">Open dashboard <ArrowRight /></Button></Link>
        </nav>
      </header>

      <main className="container">
        {/* Hero */}
        <section className="mx-auto max-w-4xl py-20 text-center md:py-28">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-success" /></span>
              Self-hosted · No third-party video APIs
            </span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }}
            className="mt-6 text-balance text-5xl font-bold tracking-tight md:text-7xl"
          >
            Video support that<br /><span className="text-gradient">sees the problem.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground"
          >
            Atom Support Vision is an AI-powered, fully self-hosted real-time video support platform.
            Agents create a session, customers join from any browser — video, chat, recording and
            analytics, all routed through your own SFU.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link href="/login"><Button variant="gradient" size="lg">Start a support session <ArrowRight /></Button></Link>
            <Link href="#features"><Button variant="outline" size="lg">Explore features</Button></Link>
          </motion.div>
          <p className="mt-5 text-xs text-muted-foreground">
            Demo: <code className="rounded bg-muted px-1.5 py-0.5">agent@atomvision.dev</code> / <code className="rounded bg-muted px-1.5 py-0.5">Agent@123</code>
          </p>
        </section>

        {/* Feature grid */}
        <section id="features" className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="group rounded-xl border bg-card/60 p-6 transition-colors hover:border-primary/40"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </section>

        {/* Security strip */}
        <section className="mb-20 rounded-2xl border bg-card/60 p-8 md:p-12">
          <div className="flex items-center gap-2 text-primary"><ShieldCheck className="h-5 w-5" /><span className="text-sm font-medium uppercase tracking-wider">Enterprise-grade security</span></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {['JWT + rotating refresh tokens', 'Role-based access control', 'Signed single-use invites', 'Encryption in transit (DTLS/SRTP)', 'Rate limiting & input validation', 'Secure file validation', 'Full audit logging', 'Self-hosted media (no P2P)'].map((s) => (
              <div key={s} className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" />{s}</div>
            ))}
          </div>
        </section>

        {/* Stack */}
        <section className="mb-24 text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Built on a production stack</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {stack.map((s) => (
              <span key={s} className="rounded-full border bg-card/60 px-3.5 py-1.5 text-sm font-medium">{s}</span>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="container flex h-16 items-center justify-between text-sm text-muted-foreground">
          <Logo showText={false} />
          <span>AtomQuest Hackathon 1.0 — Atom Support Vision</span>
        </div>
      </footer>
    </div>
  );
}
