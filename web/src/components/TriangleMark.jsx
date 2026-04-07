import { useId } from 'react';

export default function TriangleMark({ className = '' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const p = `tm${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      shapeRendering="geometricPrecision"
      className={className}
      aria-hidden>
      
      <defs>
        <linearGradient id={`${p}-l`} x1="16" y1="2.5" x2="4.5" y2="26.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5c5a6c" />
          <stop offset="0.65" stopColor="#454350" />
          <stop offset="1" stopColor="#32303d" />
        </linearGradient>
        <linearGradient id={`${p}-r`} x1="11" y1="2" x2="29" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8c8a9a" />
          <stop offset="0.4" stopColor="#6e6c7c" />
          <stop offset="1" stopColor="#4e4c5c" />
        </linearGradient>
        <linearGradient id={`${p}-b`} x1="16" y1="24.5" x2="16" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#24232e" />
          <stop offset="1" stopColor="#121118" />
        </linearGradient>
      </defs>
      <g transform="translate(0 -3.25)">
        <path fill={`url(#${p}-b)`} d="M4.6 25.5h22.8L16 28.3 4.6 25.5Z" />
        <path fill={`url(#${p}-l)`} d="M16 3.3 4.6 25.5 16 28.3 16 3.3Z" />
        <path fill={`url(#${p}-r)`} d="M16 3.3 27.4 25.5 16 28.3 16 3.3Z" />
        <path fill="#fff" fillOpacity="0.11" d="M16 5 26.1 25.1 16 19.8 16 5Z" />
      </g>
    </svg>);

}