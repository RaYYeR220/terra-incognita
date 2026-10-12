'use client';

import { HuntStatus, MAX_PROBES, PROBE_COOLDOWN_SECS, inZone, render, travelSecs } from '@terra-incognita/core';
import type { LogEntry, Pin } from '@terra-incognita/core';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { bandName } from '@/lib/bands';
import { clock, fmtKm, fmtSol, latLonText } from '@/lib/format';
import { lonLatToVec, vecText, vecToLonLat } from '@/lib/geo';
import type { LonLat } from '@/lib/geo';
import type { GlobeScene } from '@/lib/globe/engine';
import type { HuntSession, SessionSnapshot } from '@/lib/session/types';
import { EMPTY_ME } from '@/lib/session/types';
import { createSession } from '@/lib/session';
import { useBots } from '@/lib/bots/useBots';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { useReducedMotion } from '@/lib/useReducedMotion';

import { WalletButton, useWalletSigner } from '@/components/wallet/Wallets';

import { CourseByCoords, parseLatLon } from './CourseByCoords';
import { EndCard } from './EndCard';
import { EnclaveCard, Logbook, Readout, RivalsKey, ShipsAtSea } from './Panels';
import { Stage } from './Stage';
import type { OwnFlap, PinTip, Proposal, StageHandle } from './Stage';
import { ZoneSign } from './ZoneSign';
import s from './game.module.css';

const LOADING: SessionSnapshot = { phase: 'loading', info: null, view: null, me: EMPTY_ME, error: null };
const noop = () => () => undefined;
type Sheet = 'logbook' | 'rivals' | 'enclave' | null;

export function GameScreen({ huntId, sim, course }: { huntId: string; sim: boolean; course: string | null }) {
  const wallet = useWalletSigner();
  const walletKey = wallet?.publicKey.toBase58() ?? null;
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const [session, setSession] = useState<HuntSession | null>(null);
  useEffect(() => {
    const next = createSession(huntId, { sim, wallet: walletRef.current });
    setSession(next);
    return () => next.dispose();
  }, [huntId, sim, walletKey]);
  const onChain = !sim && huntId !== 'practice';
  const bots = useBots(onChain ? huntId : null);

  const snap = useSyncExternalStore(session?.subscribe ?? noop, session?.getSnapshot ?? (() => LOADING), () => LOADING);
  const { info, view, me } = snap;
  const reduceMotion = useReducedMotion();
  const stage = useRef<StageHandle>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const now = session ? session.now() : Date.now() / 1000;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tip, setTip] = useState<PinTip | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<number>>(() => new Set());
  const [fresh, setFresh] = useState(-1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [endDismissed, setEndDismissed] = useState(false);
  const [viewCentre, setViewCentre] = useState<LonLat | null>(null);

  const myShip = me.shipIndex;
  const ship = view && myShip >= 0 ? view.ships[myShip] : undefined;
  const live = view?.status === HuntStatus.Live;
  const flying = !!ship && now < ship.arriveTs;
  const readyAt = ship ? ship.lastProbeTs + PROBE_COOLDOWN_SECS : 0;
  const last = me.logbook.length ? (me.logbook[me.logbook.length - 1] as LogEntry) : null;
  const shipInZone = ship && view ? inZone(ship.to, view.zone) : true;

  const say = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 3200);
  }, []);

  useEffect(() => {
    if (me.error) say(me.error);
  }, [me.error, say]);

  // Open on the search zone, or on my ship once it is at sea.
  const centred = useRef(false);
  useEffect(() => {
    if (!view || centred.current) return;
    centred.current = true;
    const target = myShip >= 0 && view.ships[myShip] ? view.ships[myShip]!.to : view.zone.stage > 0 ? view.zone.center : null;
    if (target) stage.current?.centreOn(vecToLonLat(target), true);
  }, [view, myShip]);

  // Rival soundings drop their own lead lines.
  const seenPins = useRef<string>('');
  useEffect(() => {
    if (!view) return;
    const lastSeen = seenPins.current;
    const fresh = view.pins.filter((p) => `${p.ts}:${p.shipIndex}` > lastSeen && p.shipIndex !== myShip);
    const newest = view.pins.at(-1);
    if (newest) seenPins.current = `${newest.ts}:${newest.shipIndex}`;
    if (lastSeen) for (const p of fresh.slice(-4)) stage.current?.drop(vecToLonLat(p.pos), false);
  }, [view, myShip]);

  const scene = useMemo<GlobeScene | null>(
    () =>
      view
        ? {
            zone: view.zone,
            ships: view.ships,
            myShip,
            pins: view.pins,
            logbook: me.logbook,
            proposal: proposal?.at ?? null,
            revealed: view.revealed ? vecToLonLat(view.revealed) : null,
          }
        : null,
    [view, myShip, me.logbook, proposal],
  );

  const flaps = useMemo<OwnFlap[]>(
    () =>
      me.logbook.map((e, i) => {
        const band = bandName(e.band);
        const open = !closed.has(i);
        return {
          key: i,
          n: i + 1,
          band,
          at: vecToLonLat(e.pos),
          open,
          fresh: i === fresh,
          label: `Your sounding ${i + 1} at ${vecText(e.pos)}: ${open ? band : 'flap closed'}`,
        };
      }),
    [me.logbook, closed, fresh],
  );

  const onPick = useCallback(
    (at: LonLat) => {
      setTip(null);
      if (!view || !info || !live) return;
      if (me.pending) return;
      const dest = lonLatToVec(at);
      const ok = inZone(dest, view.zone);
      if (!ship && !me.joined && !view.joinable) {
        say('This hunt is not taking new ships. Open the list of hunts to find a live one.');
        return;
      }
      if (!ship) {
        setProposal({ at, kind: 'embark', ok, text: ok ? `Set off from ${vecText(dest)}` : 'Outside the search zone' });
        return;
      }
      if (session && session.now() < ship.arriveTs) {
        say('Your ship is still in the air.');
        return;
      }
      const km = render.distanceKm(ship.to, dest);
      const secs = travelSecs(ship.to, dest, info.speedKms);
      setProposal({ at, kind: 'course', ok, text: ok ? `${fmtKm(km)} · ${secs} s` : 'Outside the search zone' });
    },
    [view, info, live, me.pending, me.joined, ship, session, say],
  );

  const plot = useCallback(
    (at: LonLat) => {
      stage.current?.centreOn(at);
      onPick(at);
    },
    [onPick],
  );

  // A `?course=lat,lon` link proposes that course once the hunt is on screen; the player confirms it.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !course || !view || !live || me.pending) return;
    const at = parseLatLon(course);
    deepLinked.current = true;
    if (at) window.setTimeout(() => plot(at), 600);
  }, [course, view, live, me.pending, plot]);

  const onPin = useCallback((pin: Pin, at: LonLat) => {
    setTip({ at, ship: pin.shipIndex + 1 });
    window.setTimeout(() => setTip((t) => (t && t.at === at ? null : t)), 2600);
  }, []);

  const confirm = useCallback(async () => {
    if (!session || !proposal) return;
    const p = proposal;
    setProposal(null);
    try {
      if (p.kind === 'embark') await session.embark(lonLatToVec(p.at));
      else await session.setCourse(lonLatToVec(p.at));
    } catch {
      // The session reports the reason in its snapshot.
    }
  }, [session, proposal]);

  const probe = useCallback(async () => {
    if (!session || !ship) return;
    stage.current?.drop(vecToLonLat(ship.to), true);
    try {
      const entry = await session.probe();
      const index = session.getSnapshot().me.logbook.findIndex((e) => e.ts === entry.ts && e.band === entry.band);
      const i = index < 0 ? session.getSnapshot().me.logbook.length - 1 : index;
      setFresh(i);
      setClosed((c) => new Set(c).add(i));
      window.setTimeout(() => setClosed((c) => {
        const n = new Set(c);
        n.delete(i);
        return n;
      }), reduceMotion ? 0 : 420);
    } catch {
      // Reported through the snapshot.
    }
  }, [session, ship, reduceMotion]);

  const toggleFlap = useCallback((key: number) => {
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const showEntry = useCallback((entry: LogEntry) => {
    stage.current?.centreOn(vecToLonLat(entry.pos));
    setSheet(null);
  }, []);

  // The one action and its states.
  let act = 'Take a sounding';
  let actDisabled = false;
  if (!view || !info) [act, actDisabled] = ['Loading the hunt…', true];
  else if (!live) [act, actDisabled] = ['Hunt over', true];
  else if (me.strikeUnconfirmed) [act, actDisabled] = ['Strike! Confirming…', true];
  else if (me.pending === 'join') [act, actDisabled] = ['Joining the hunt…', true];
  else if (me.pending === 'embark') [act, actDisabled] = ['Setting off…', true];
  else if (me.pending === 'course') [act, actDisabled] = ['Setting course…', true];
  else if (me.pending === 'probe') [act, actDisabled] = ['Lowering the lead line…', true];
  else if (!ship && !me.joined && !view.joinable) [act, actDisabled] = ['Not taking new ships', true];
  else if (!ship) [act, actDisabled] = ['Choose where to set off', true];
  else if (flying) [act, actDisabled] = [`In flight · ${Math.max(1, Math.ceil(ship.arriveTs - now))} s`, true];
  else if (now < readyAt) [act, actDisabled] = [`Lead line drying · ${Math.max(1, Math.ceil(readyAt - now))} s`, true];
  else if (ship.probes >= MAX_PROBES) [act, actDisabled] = ['No soundings left', true];
  else if (!shipInZone) [act, actDisabled] = ['Outside the search zone', true];

  const ended = !!view && !live;
  const sheetRef = useRef<HTMLElement>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  useFocusTrap(sheetRef, sheet !== null, closeSheet);
  const leftOpen = sheet === 'logbook';
  const rightOpen = sheet === 'rivals' || sheet === 'enclave';
  useEffect(() => {
    if (sheet === 'enclave') document.getElementById('enclave')?.scrollIntoView({ block: 'nearest' });
  }, [sheet]);

  const rivalPins = view ? view.pins.filter((p) => p.shipIndex !== myShip).length : 0;
  const ships = view ? view.ships.filter((x) => x.embarked).length : 0;
  const description = describe(snap, viewCentre, now);

  if (snap.phase === 'error') {
    return (
      <div className={s.game}>
        <header className={s.bar}>
          <Link className={s.wm} href="/">TERRA INCOGNITA</Link>
        </header>
        <main className={s.stage} style={{ gridColumn: '1 / -1', display: 'grid', placeItems: 'center' }}>
          <div className={s.notice} role="alert" style={{ position: 'static', translate: 'none' }}>
            {snap.error}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={s.game}>
      <a className="skip" href="#main">Skip to the globe</a>
      <header className={s.bar}>
        <Link className={s.wm} href="/" aria-label="Terra Incognita, home">TERRA INCOGNITA</Link>
        <span className={s.huntName}>
          {info ? (
            <>
              {info.number !== null ? `Hunt No. ${info.number} ` : 'Hunt '}
              <b>“{info.title}”</b>
            </>
          ) : (
            'Opening the hunt…'
          )}
        </span>
        <div className={s.tags} aria-label="Hunt status">
          <span className="tag">Pot {view ? fmtSol(view.potSol) : '…'}</span>
          <span className="tag">{ships} {ships === 1 ? 'ship' : 'ships'}</span>
          <span className="tag">{info ? (live ? `ends in ${clock(info.deadline - now)}` : 'ended') : '…'}</span>
        </div>
      </header>

      <aside
        className={`${s.wing} ${s.wingLeft} ${leftOpen ? s.wingOpen : ''}`}
        aria-label="Your logbook"
        ref={leftOpen ? sheetRef : undefined}
        role={leftOpen ? 'dialog' : undefined}
        aria-modal={leftOpen || undefined}
      >
        <div className={s.sheetHead}>
          <h2>Your logbook</h2>
          <button type="button" onClick={closeSheet}>Close</button>
        </div>
        <Logbook logbook={me.logbook} shipIndex={myShip} freshIndex={fresh} onShow={showEntry} />
      </aside>

      <Stage
        ref={stage}
        scene={scene}
        flaps={flaps}
        proposal={proposal}
        tip={tip}
        zoneSign={view && info ? <ZoneSign zone={view.zone} info={info} now={now} live={live} /> : null}
        hint={
          live ? (
            <CourseByCoords
              initial={course}
              hint={!ship ? 'Click the globe to choose where your ship sets off.' : 'Drag to turn the globe. Click it to set a course.'}
              onPlot={plot}
            />
          ) : null
        }
        notice={notice ?? (me.strikeUnconfirmed ? 'Strike! Confirming on Solana…' : null)}
        description={description}
        now={() => (session ? session.now() : Date.now() / 1000)}
        reduceMotion={reduceMotion}
        onPick={onPick}
        onPin={onPin}
        onView={setViewCentre}
        onToggleFlap={toggleFlap}
        onConfirm={confirm}
        onCancel={() => setProposal(null)}
      >
        {ended && !endDismissed && info && view ? (
          <EndCard info={info} view={view} myShip={myShip} joined={me.joined} session={session} onClose={() => setEndDismissed(true)} />
        ) : null}
      </Stage>

      <aside
        className={`${s.wing} ${s.wingRight} ${rightOpen ? s.wingOpen : ''}`}
        aria-label="Rivals and enclave"
        ref={rightOpen ? sheetRef : undefined}
        role={rightOpen ? 'dialog' : undefined}
        aria-modal={rightOpen || undefined}
      >
        <div className={s.sheetHead}>
          <h2>{sheet === 'enclave' ? 'The enclave' : 'Rivals'}</h2>
          <button type="button" onClick={closeSheet}>Close</button>
        </div>
        <RivalsKey pins={rivalPins} />
        <ShipsAtSea ships={view?.ships ?? []} myShip={myShip} now={now} />
        <EnclaveCard fingerprint={info?.commitmentHex ?? ''} session={session} />
      </aside>

      <footer className={s.apron}>
        <div className={s.guest}>
          <p>
            <b>{me.identity?.kind === 'wallet' ? `Playing as ${me.identity.label}` : 'Playing as guest'}</b> ·{' '}
            {info?.network === 'simulator' ? 'practice hunt' : (info?.network ?? 'devnet')}
            {me.identity?.kind === 'wallet' ? '' : ' · no wallet needed'}
          </p>
          {onChain ? (
            <p className={s.guestActions}>
              {me.shipIndex < 0 ? <WalletButton className={s.botBtn} /> : null}
              {live || bots.state.phase !== 'idle' ? (
                <button type="button" className={s.botBtn} onClick={() => bots.start(3)} disabled={!live || (bots.state.phase !== 'idle' && bots.state.phase !== 'failed')}>
                  {botLabel(bots.state)}
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        <Readout last={last} count={me.logbook.length} />
        <button type="button" className={`btn ${s.act}`} onClick={probe} disabled={actDisabled} aria-live="polite" data-testid="take-sounding">
          {act}
        </button>
      </footer>

      <nav className={s.mtabs} aria-label="Panels">
        <button type="button" aria-expanded={leftOpen} onClick={() => setSheet(leftOpen ? null : 'logbook')}>
          Logbook <span className={s.cnt}>{me.logbook.length}/{MAX_PROBES}</span>
        </button>
        <button type="button" aria-expanded={sheet === 'rivals'} onClick={() => setSheet(sheet === 'rivals' ? null : 'rivals')}>
          Rivals
        </button>
        <button type="button" aria-expanded={sheet === 'enclave'} onClick={() => setSheet(sheet === 'enclave' ? null : 'enclave')}>
          Enclave
        </button>
      </nav>
      <div className={`${s.scrim} ${sheet ? s.scrimShow : ''}`} onClick={closeSheet} aria-hidden="true" />
    </div>
  );
}

function botLabel(state: ReturnType<typeof useBots>['state']): string {
  switch (state.phase) {
    case 'idle':
      return 'Add rival bots';
    case 'funding':
      return 'Funding three rival bots…';
    case 'racing':
      return `${state.names.length} rival bots at sea · ${state.soundings} ${state.soundings === 1 ? 'sounding' : 'soundings'}`;
    case 'finished':
      return `Bots done · ${state.sweptSol.toFixed(3)} SOL back to the treasury`;
    case 'failed':
      return `Bots failed: ${state.error}. Try again`;
  }
}

function describe(snap: SessionSnapshot, centre: LonLat | null, now: number): string {
  const { view, me } = snap;
  if (!view) return 'Loading the hunt.';
  const parts: string[] = [];
  if (centre) parts.push(`View centred on ${latLonText(centre[1], centre[0])}.`);
  parts.push(
    view.zone.stage > 0
      ? `Search zone ${render.zoneRadiusDeg(view.zone.stage)} degrees around ${vecText(view.zone.center)}.`
      : 'The search zone is the whole globe.',
  );
  const ship = me.shipIndex >= 0 ? view.ships[me.shipIndex] : undefined;
  if (ship) {
    parts.push(
      now < ship.arriveTs
        ? `Your ship is flying to ${vecText(ship.to)}, ${Math.ceil(ship.arriveTs - now)} seconds out.`
        : `Your ship is at ${vecText(ship.to)}.`,
    );
  } else parts.push('Your ship has not set off.');
  const rivals = view.ships.filter((x, i) => x.embarked && i !== me.shipIndex).length;
  const pins = view.pins.filter((p) => p.shipIndex !== me.shipIndex).length;
  parts.push(`${rivals} rival ${rivals === 1 ? 'ship' : 'ships'}, ${pins} sealed rival ${pins === 1 ? 'sounding' : 'soundings'}.`);
  if (view.revealed) parts.push(`The treasure was at ${vecText(view.revealed)}.`);
  return parts.join(' ');
}
