import { useEffect, useRef, useState } from 'react';

// Reusable BeeMascot component
// Props:
// - watching: boolean (eyes visible)
// - coverEyes: boolean (cover eyes with wings)
// - lookRatio: number (0..1, target direction)
// - blink: boolean (force blink)
// - flap: boolean (wing flap pulse)
// - isIdle: boolean (apply subtle bob when idle)
// - colors: { primary, dark, wing }
export default function BeeMascot({
  watching = true,
  coverEyes = false,
  lookRatio = 0.5,
  blink = false,
  flap = false,
  isIdle = false,
  colors = { primary: '#10b981', dark: '#0b0f19', wing: '#e6fff6' },
  eyeSpeed = 3, // lower = slower easing, typical 2-6
  className = ''
}) {
  // eased look to smooth eye movement
  const [eased, setEased] = useState(lookRatio);
  const rafRef = useRef();
  const targetRef = useRef(lookRatio);
  useEffect(() => { targetRef.current = lookRatio; }, [lookRatio]);
  useEffect(() => {
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(1, (now - last) / 1000);
      last = now;
      // lerp toward target with adjustable speed
      setEased((prev) => prev + (targetRef.current - prev) * Math.min(1, eyeSpeed * dt));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [eyeSpeed]);

  // idle bob animation (small vertical sine wave)
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!isIdle) return;
    const id = setInterval(() => setT((x) => x + 1), 80);
    return () => clearInterval(id);
  }, [isIdle]);
  const bobY = isIdle ? Math.sin(t / 6) * 0.8 : 0;

  const dx = Math.round((eased - 0.5) * 10); // -5..5 px range
  const eyeVisible = watching && !blink;
  const { primary, dark, wing } = colors;

  return (
    <svg className={`w-20 h-20 ${className}`} viewBox='0 0 64 64' aria-hidden='true'>
      <defs>
        <linearGradient id='login-bee-g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stopColor={primary} />
          <stop offset='100%' stopColor='#065f46' />
        </linearGradient>
      </defs>
      <g transform={`translate(0, ${bobY.toFixed(2)})`}>
        {/* wings */}
        <g transform={`translate(${flap ? -1 : 0}, ${coverEyes ? -4 : 0})`}>
          <ellipse cx='20' cy='20' rx='10' ry='6' fill={wing} stroke='#064e3b' strokeWidth='1' opacity='0.9' />
        </g>
        <g transform={`translate(${flap ? 1 : 0}, ${coverEyes ? -4 : 0})`}>
          <ellipse cx='44' cy='20' rx='10' ry='6' fill={wing} stroke='#064e3b' strokeWidth='1' opacity='0.9' />
        </g>
        {/* body */}
        <ellipse cx='32' cy='36' rx='18' ry='12' fill='url(#login-bee-g)' stroke={dark} strokeWidth='2' />
        {/* stripes */}
        <rect x='18' y='30' width='28' height='4' fill={dark} opacity='0.95' />
        <rect x='18' y='38' width='28' height='4' fill={dark} opacity='0.95' />
        {/* head */}
        <circle cx='18' cy='34' r='6' fill={dark} />
        {/* eyes */}
        <g>
          <rect x='15.5' y='32' width='2.4' height={eyeVisible ? 2.4 : 0.2} rx='1' fill='#e2fdf4' transform={`translate(${dx*0.15},0)`} />
          <rect x='19' y='32' width='2.4' height={eyeVisible ? 2.4 : 0.2} rx='1' fill='#e2fdf4' transform={`translate(${dx*0.3},0)`} />
        </g>
        {/* stinger */}
        <path d='M50 36l8 4-8 4' fill={dark} />
        {/* antennae */}
        <path d='M14 29c-2-4-6-5-8-4' stroke={dark} strokeWidth='2' fill='none' strokeLinecap='round' />
        <path d='M20 29c0-4 4-5 6-4' stroke={dark} strokeWidth='2' fill='none' strokeLinecap='round' />
      </g>
    </svg>
  );
}
