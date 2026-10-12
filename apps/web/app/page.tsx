import Link from 'next/link';

import { Hero } from '@/components/landing/Hero';
import { CoursePull, FlapField, PrivateNote, RevealMap, TryRead } from '@/components/landing/Islands';
import { StudioDemo } from '@/components/landing/StudioDemo';
import { mapScenes } from '@/components/landing/mapScene';
import {
  afterObject,
  beforeObject,
  courseScene,
  duringObject,
  sealedScene,
  soundingScene,
  strikeScene,
} from '@/components/landing/scenes';
import s from '@/components/landing/landing.module.css';
import { BANDS_COLD_TO_HOT, bandRange } from '@/lib/bands';
import { shortHash } from '@/lib/format';
import { K } from '@/lib/palette';
import { airship, cut, wave } from '@/lib/paper';
import { site } from '@/lib/site';

const edge = (kind: 'scallop' | 'wave' | 'pinked', fill: string) => (
  <div className={`edge edge-${kind}`} style={{ '--edge-fill': fill } as React.CSSProperties} aria-hidden="true" />
);

function Svg({ viewBox, label, html, className }: { viewBox: string; label?: string; html: string; className?: string }) {
  return (
    <svg
      viewBox={viewBox}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function footSea(): string {
  const W = 1440;
  return (
    airship(W * 0.82, 40, 0.3, 1, { shadow: 'rgba(0,0,0,.3)' }) +
    `<line x1="-20" y1="40" x2="${W * 0.82 - 33}" y2="40" stroke="${K.cream}" stroke-opacity=".45" stroke-width="1.3"/>` +
    cut(wave(0, W, 78, 14, 150, 0, 200), K.t4, { shadow: 'rgba(0,0,0,.3)' }) +
    cut(wave(0, W, 108, 16, 180, -40, 200), K.t3, { shadow: 'rgba(0,0,0,.3)' }) +
    cut(wave(0, W, 132, 12, 130, -20, 200), K.t6, { shadow: 'rgba(0,0,0,.3)' })
  );
}

export default function Home() {
  const fingerprint = shortHash('7f3a91c0d2e45b6a8c7d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2bc21e');
  const course = courseScene();
  const sounding = soundingScene();
  const maps = mapScenes();
  const pot = '2.4 SOL';
  const joinHref = '/hunt/demo';

  return (
    <div className={s.page}>
      <a className="skip" href="#hunt">Skip to how a hunt works</a>
      <Hero joinHref={joinHref} />

      <main>
        <section className={`${s.sheet} ${s.sHunt}`} id="hunt" aria-labelledby="hunt-h">
          <div className={s.wrap}>
            <h2 className={s.h2} id="hunt-h">How a hunt works</h2>
            <ol className={s.beats} style={{ listStyle: 'none' }}>
              <li className={s.beat}>
                <div className={s.scene}>
                  <Svg viewBox="0 0 520 380" html={sealedScene(fingerprint)} label={`A strongbox with a small globe inside, sealed in coral; a tag with the fingerprint ${fingerprint} is pinned to a chain of blocks.`} />
                </div>
                <div className={s.say}>
                  <span className={s.num} aria-hidden="true">1</span>
                  <h3 className={s.h3}>Sealed.</h3>
                  <p>A random point on the globe is drawn inside the enclave and locked away. A fingerprint of it is published on Solana before anyone moves.</p>
                </div>
              </li>

              <li className={`${s.beat} ${s.flip}`}>
                <div className={`${s.scene} ${s.clipBottom}`}>
                  <div className={s.courseBox}>
                    <Svg viewBox="0 0 520 360" html={course.svg} label="An airship flying a great-circle course over a paper globe while two rival airships watch from their own courses." />
                    <CoursePull track={course.track} km={course.km} secs={course.secs} />
                  </div>
                </div>
                <div className={s.say}>
                  <span className={s.num} aria-hidden="true">2</span>
                  <h3 className={s.h3}>Set a course.</h3>
                  <p>Fly your airship anywhere. Distance costs time, so every heading is a commitment your rivals can watch.</p>
                </div>
              </li>

              <li className={`${s.beat} ${s.wide}`}>
                <div className={s.say}>
                  <span className={s.num} aria-hidden="true">3</span>
                  <h3 className={s.h3}>Take a sounding.</h3>
                  <p>The enclave measures how far you are from the treasure and writes the answer where only you can read it: frozen, cold, cool, mild, warm, hot, scorching — or a strike.</p>
                </div>
                <div className={`${s.scene} ${s.clipBottom}`}>
                  <Svg viewBox="0 0 680 330" html={sounding.svg} label="An airship drops a lead line onto a paper globe covered in numbered flaps. Lift a flap to see the band printed underneath." />
                  <FlapField flaps={sounding.flaps} />
                </div>
                <ol className={s.scale} aria-label="The eight bands, coldest to hottest">
                  {BANDS_COLD_TO_HOT.map(({ band, name }, i) => (
                    <li key={name} data-band={name} style={{ '--i': i } as React.CSSProperties}>
                      <b>{name}</b>
                      <small>{bandRange(band)}</small>
                    </li>
                  ))}
                </ol>
                <div className={s.scaleFoot} aria-hidden="true">
                  <span>far away</span>
                  <span>within 50 km</span>
                </div>
              </li>

              <li className={`${s.beat} ${s.last}`}>
                <div className={s.scene}>
                  <Svg viewBox="0 0 520 380" html={strikeScene(pot)} label={`A flap thrown open on a coral starburst; coins fly up to a tag reading ${pot}; a paper clock stands by.`} />
                </div>
                <div className={s.say}>
                  <span className={s.num} aria-hidden="true">4</span>
                  <h3 className={s.h3}>Strike.</h3>
                  <p>First sounding within 50 km takes the pot, paid on Solana in the same breath. If the clock runs out, the closest sounding wins.</p>
                  <Link className={`btn ${s.beatCta}`} href={joinHref}>Join the hunt</Link>
                </div>
              </li>
            </ol>
          </div>
          {edge('wave', '#CFE6DC')}
        </section>

        <section className={`${s.sheet} ${s.sSecret}`} id="secret" aria-labelledby="secret-h">
          <div className={s.wrap}>
            <h2 className={s.h2} id="secret-h">You don't have to trust us. You can't even ask us.</h2>
            <div className={s.line}>
              <svg className={s.rope} viewBox="0 0 1240 120" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 18 Q620 120 1240 14" fill="none" stroke="#F6F1E3" strokeOpacity=".55" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
              <figure className={`${s.hang} ${s.before}`}>
                <span className={s.peg} style={{ left: '46%' }} />
                <Svg viewBox="0 0 280 260" html={beforeObject(fingerprint)} label={`A paper tag with the fingerprint ${fingerprint} pinned to a chain of blocks while an airship is still moored in port.`} />
                <h3 className={s.h3}>Before</h3>
                <p>The treasure's fingerprint is on Solana before the first ship leaves port.</p>
              </figure>
              <figure className={`${s.hang} ${s.during}`}>
                <span className={s.peg} style={{ left: '30%' }} />
                <span className={s.peg} style={{ left: '66%' }} />
                <TryRead envelope={<Svg viewBox="0 30 420 240" html={duringObject()} label="A sealed envelope. Its flap will not lift." />} />
                <h3 className={s.h3}>During</h3>
                <p>The coordinates sit in an account that refuses every reader — players, the organiser, us.</p>
              </figure>
              <figure className={`${s.hang} ${s.after}`}>
                <span className={s.peg} style={{ left: '52%' }} />
                <Svg viewBox="0 0 300 270" html={afterObject(fingerprint)} label="The envelope opened: a card with the coordinates, two fingerprints that match, and an open logbook." />
                <h3 className={s.h3}>After</h3>
                <p>The coordinates are revealed, the fingerprint is checked, and every logbook is opened so anyone can re-measure every answer the enclave ever gave.</p>
              </figure>
            </div>
            <div className={s.smallprint}>
              <p>
                <b>Trusted:</b> MagicBlock's enclave validator and randomness oracle. <b>Not trusted:</b> the organiser, the players, or us.
              </p>
              <Link className={s.proof} href="/proof/demo">Read the proof of the last hunt</Link>
            </div>
          </div>
          {edge('pinked', '#1B4F52')}
        </section>

        <section className={`${s.sheet} ${s.sSee}`} id="see" aria-labelledby="see-h">
          <div className={s.wrap}>
            <h2 className={s.h2} id="see-h">What everyone sees, what only you see</h2>
            <div className={s.legend}>
              <div>
                <h3>Public</h3>
                <ul>
                  <li><svg viewBox="-17 -17 34 34" aria-hidden="true"><g transform="scale(.15)"><path d="M-74 -10 L-122 -44 L-108 -4 Z M-74 10 L-122 44 L-108 4 Z" fill="#5FAF9F" /><path d="M-100 0 C-100 -22 -54 -35 0 -35 C56 -35 100 -20 110 0 C100 20 56 35 0 35 C-54 35 -100 22 -100 0 Z" fill="#F6F1E3" /><rect x="-24" y="38" width="52" height="15" rx="6" fill="#1B4F52" /></g><path d="M-16 13 H16" stroke="#2B2B2B" strokeWidth="1.6" strokeDasharray="2 4" /></svg>where every ship is heading,</li>
                  <li><svg viewBox="-17 -17 34 34" aria-hidden="true"><rect x="-11" y="-9" width="24" height="24" rx="4" fill="rgba(14,51,54,.45)" /><rect x="-14" y="-13" width="24" height="24" rx="4" fill="#F6F1E3" /></svg>where every sounding was taken,</li>
                  <li><svg viewBox="-17 -17 34 34" aria-hidden="true"><circle r="15" fill="#1B4F52" opacity=".55" /><circle r="10" fill="#2F7F78" /><circle r="10" fill="none" stroke="#F2734E" strokeWidth="2.5" strokeDasharray="3 3" /></svg>the shrinking search zone,</li>
                  <li><svg viewBox="-17 -17 34 34" aria-hidden="true"><circle cx="2" cy="3" r="13" fill="rgba(14,51,54,.4)" /><circle r="13" fill="#F6F1E3" /><circle r="8" fill="none" stroke="#F2734E" strokeWidth="3" /></svg>the pot.</li>
                </ul>
              </div>
              <PrivateNote />
            </div>
            <RevealMap wide={maps.wide} narrow={maps.narrow} />
            <p className={s.bigline}>
              <span>Watch where they dig.</span> <span>Guess what they know.</span>
            </p>
          </div>
          {edge('wave', '#9FCFC0')}
        </section>

        <section className={`${s.sheet} ${s.sHide}`} id="hide" aria-labelledby="hide-h">
          <div className={`${s.wrap} ${s.hide}`}>
            <div>
              <h2 className={s.h2} id="hide-h">Hide a treasure of your own.</h2>
              <p>Put up a prize, set the entry fee and the clock, and let the enclave pick the spot — or choose it yourself and write the riddle. You earn a share of every entry.</p>
              <Link className={`btn ${s.cta}`} href="/studio">Open the studio</Link>
            </div>
            <StudioDemo />
          </div>
          {edge('scallop', '#F6F1E3')}
        </section>
      </main>

      <footer className={s.foot}>
        <div className={`${s.wrap} ${s.footRow}`}>
          <div>
            <div className={s.wm}>TERRA INCOGNITA</div>
            <p>Built on Solana with MagicBlock Private Ephemeral Rollups, VRF and Magic Actions. Devnet.</p>
          </div>
          <nav aria-label="Footer">
            <Link href="/proof/demo">Proof</Link>
            {site.sourceUrl ? <a href={site.sourceUrl}>Source</a> : <Link href="/hunts">Hunts</Link>}
            {site.docsUrl ? <a href={site.docsUrl}>Docs</a> : <Link href="/studio">Studio</Link>}
          </nav>
        </div>
        <Svg viewBox="0 0 1440 150" className={s.sea} html={footSea()} />
      </footer>
    </div>
  );
}
