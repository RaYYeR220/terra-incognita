import Link from 'next/link';

import s from './frame.module.css';

/** The valance and the paper sheet that the secondary pages sit on. */
export function PageFrame({ children, current }: { children: React.ReactNode; current?: 'hunts' | 'studio' | 'proof' }) {
  return (
    <div className={s.frame}>
      <a className="skip" href="#main">Skip to content</a>
      <header className={s.bar}>
        <Link className={s.wm} href="/">TERRA INCOGNITA</Link>
        <nav aria-label="Main" className={s.nav}>
          <Link href="/hunts" aria-current={current === 'hunts' ? 'page' : undefined}>Hunts</Link>
          <Link href="/studio" aria-current={current === 'studio' ? 'page' : undefined}>Studio</Link>
          <Link href="/hunt/demo" className={s.play}>Join the hunt</Link>
        </nav>
      </header>
      <main id="main" className={s.main}>
        {children}
      </main>
    </div>
  );
}
