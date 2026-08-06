/* global React */
const { useEffect, useRef, useState } = React;

/* =============== Icons =============== */
const Icon = {
  Bee: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="14" rx="5" ry="6"/>
      <path d="M12 8 L12 20 M9 10 L15 10 M8.5 14 L15.5 14 M9 18 L15 18"/>
      <path d="M7 9 Q3 6 5 4 Q7 4 9 7"/>
      <path d="M17 9 Q21 6 19 4 Q17 4 15 7"/>
      <circle cx="10.5" cy="7" r="0.5" fill="currentColor"/>
      <circle cx="13.5" cy="7" r="0.5" fill="currentColor"/>
      <path d="M10 4 Q11 2 12 4 M14 4 Q13 2 12 4"/>
    </svg>
  ),
  Hive: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 L20 8 L20 19 L12 21 L4 19 L4 8 Z"/>
      <path d="M12 3 L12 21"/>
      <path d="M4 8 L20 8 M4 13 L20 13 M4 18 L20 18"/>
      <circle cx="8" cy="10.5" r="0.6" fill="currentColor"/>
      <circle cx="16" cy="15.5" r="0.6" fill="currentColor"/>
    </svg>
  ),
  Leaf: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20 Q4 8 12 4 Q20 4 20 12 Q20 20 12 20 Q8 20 4 20Z"/>
      <path d="M4 20 Q12 14 18 6"/>
      <path d="M9 16 Q11 14 13 13 M11 18 Q14 16 16 14"/>
    </svg>
  ),
  Sun: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2 L12 4 M12 20 L12 22 M2 12 L4 12 M20 12 L22 12 M4.9 4.9 L6.3 6.3 M17.7 17.7 L19.1 19.1 M4.9 19.1 L6.3 17.7 M17.7 6.3 L19.1 4.9"/>
    </svg>
  ),
  Drop: ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 C8 9 5 13 5 16 A7 7 0 0 0 19 16 C19 13 16 9 12 3Z"/>
      <path d="M9 16 Q10 18 12 18"/>
    </svg>
  ),
  Cart: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4 L6 4 L8 16 L19 16 L21 7 L7 7"/>
      <circle cx="9" cy="20" r="1.4"/>
      <circle cx="17" cy="20" r="1.4"/>
    </svg>
  ),
  Plus: ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M12 5 L12 19 M5 12 L19 12"/>
    </svg>
  ),
  Arrow: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12 L19 12 M13 6 L19 12 L13 18"/>
    </svg>
  ),
  Star: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 L15 9 L22 10 L17 15 L18 22 L12 18.5 L6 22 L7 15 L2 10 L9 9 Z"/>
    </svg>
  ),
  Check: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12 L10 17 L20 7"/>
    </svg>
  ),
  Hexagon: ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z"/>
    </svg>
  ),
};

/* =============== Bee with flapping wings =============== */
const Bee = ({ size = 32 }) => (
  <svg width={size} height={size * 0.7} viewBox="0 0 50 35">
    <g className="bee-wings">
      <ellipse cx="18" cy="10" rx="8" ry="5" fill="rgba(245,237,220,0.7)" stroke="rgba(245,237,220,0.9)" strokeWidth="0.5"/>
      <ellipse cx="32" cy="10" rx="8" ry="5" fill="rgba(245,237,220,0.7)" stroke="rgba(245,237,220,0.9)" strokeWidth="0.5"/>
    </g>
    <ellipse cx="25" cy="20" rx="11" ry="7" fill="#1A1108"/>
    <path d="M18 15 Q18 25 18 25" stroke="#F4CA53" strokeWidth="3.5" fill="none"/>
    <path d="M25 14 Q25 26 25 26" stroke="#F4CA53" strokeWidth="3.5" fill="none"/>
    <path d="M32 15 Q32 25 32 25" stroke="#F4CA53" strokeWidth="3.5" fill="none"/>
    <ellipse cx="36" cy="20" rx="3.5" ry="3" fill="#1A1108"/>
    <circle cx="37.5" cy="19" r="0.8" fill="#F4CA53"/>
  </svg>
);

/* =============== Honey Jar SVG =============== */
const HoneyJar = ({ tone = "wildflower" }) => {
  const tones = {
    wildflower: { top: "#F4CA53", mid: "#E8A33D", bot: "#B87914", label: "WILDFLOWER" },
    acacia:     { top: "#FFE9A0", mid: "#F4CA53", bot: "#D4AF37", label: "ACACIA" },
    forest:     { top: "#D4AF37", mid: "#9C6A1F", bot: "#5A3A0C", label: "FOREST" },
  };
  const t = tones[tone];
  const id = `g-${tone}`;
  return (
    <svg viewBox="0 0 200 320" width="100%" height="100%" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={t.top}/>
          <stop offset="50%" stopColor={t.mid}/>
          <stop offset="100%" stopColor={t.bot}/>
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={t.top} stopOpacity="0.6"/>
          <stop offset="100%" stopColor={t.bot} stopOpacity="0"/>
        </radialGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.5)"/>
          <stop offset="20%" stopColor="rgba(255,255,255,0.05)"/>
          <stop offset="80%" stopColor="rgba(255,255,255,0.05)"/>
          <stop offset="100%" stopColor="rgba(255,255,255,0.3)"/>
        </linearGradient>
      </defs>

      {/* Glow */}
      <ellipse cx="100" cy="180" rx="120" ry="100" fill={`url(#${id}-glow)`}/>

      {/* Lid */}
      <rect x="55" y="20" width="90" height="22" rx="3" fill="#1A1108" stroke="#3A2A14" strokeWidth="1"/>
      <rect x="55" y="20" width="90" height="6" fill="#2A1B0A"/>
      <rect x="55" y="38" width="90" height="4" fill="#0B0905"/>

      {/* Jar body */}
      <path
        d="M 50 50 L 50 60 Q 50 70 55 75 L 55 280 Q 55 300 75 300 L 125 300 Q 145 300 145 280 L 145 75 Q 150 70 150 60 L 150 50 Z"
        fill={`url(#${id})`}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="1"
      />
      {/* Liquid surface highlight */}
      <ellipse cx="100" cy="78" rx="42" ry="4" fill="rgba(255,255,255,0.25)"/>

      {/* Glass shine overlay */}
      <path
        d="M 50 50 L 50 60 Q 50 70 55 75 L 55 280 Q 55 300 75 300 L 125 300 Q 145 300 145 280 L 145 75 Q 150 70 150 60 L 150 50 Z"
        fill={`url(#${id}-glass)`}
        opacity="0.5"
      />

      {/* Left highlight */}
      <path d="M 60 90 Q 58 100 62 280" stroke="rgba(255,255,255,0.4)" strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Right shadow */}
      <path d="M 138 90 Q 140 100 138 280" stroke="rgba(0,0,0,0.25)" strokeWidth="4" fill="none" strokeLinecap="round"/>

      {/* Label */}
      <rect x="68" y="160" width="64" height="86" fill="#F5EDDC" stroke="#D4AF37" strokeWidth="0.5"/>
      <line x1="74" y1="170" x2="126" y2="170" stroke="#D4AF37" strokeWidth="0.5"/>
      <line x1="74" y1="236" x2="126" y2="236" stroke="#D4AF37" strokeWidth="0.5"/>

      {/* Hexagon mark */}
      <polygon points="100,178 110,184 110,196 100,202 90,196 90,184" fill="none" stroke="#7A4E0F" strokeWidth="1"/>
      <text x="100" y="194" textAnchor="middle" fontSize="6" fontFamily="serif" fill="#7A4E0F" fontWeight="600">G</text>

      <text x="100" y="216" textAnchor="middle" fontSize="9" fontFamily="serif" fill="#1A1108" fontStyle="italic">Goldhive</text>
      <text x="100" y="228" textAnchor="middle" fontSize="5.5" fontFamily="monospace" fill="#7A4E0F" letterSpacing="1.2">{t.label}</text>

      {/* Shadow under jar */}
      <ellipse cx="100" cy="312" rx="55" ry="6" fill="rgba(0,0,0,0.5)" filter="blur(4px)"/>
    </svg>
  );
};

window.Icon = Icon;
window.Bee = Bee;
window.HoneyJar = HoneyJar;
