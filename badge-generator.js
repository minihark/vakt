// Dynamic SVG Status Shield Badge Generator for Harkco Vakt

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function renderSvgBadge({
  leftText = 'Vakt',
  rightText = 'OPERATIONAL',
  status = 'up',
  showDot = true,
}) {
  const safeLeft = escapeXml(leftText);
  const safeRight = escapeXml(rightText);

  // Status color definitions
  let rightBg = '#064e3b';
  let textColor = '#a7f3d0';
  let dotColor = '#10b981';

  if (status === 'degraded') {
    rightBg = '#78350f';
    textColor = '#fde68a';
    dotColor = '#f59e0b';
  } else if (status === 'down') {
    rightBg = '#7f1d1d';
    textColor = '#fecaca';
    dotColor = '#ef4444';
  } else if (status === 'neutral') {
    rightBg = '#1f2937';
    textColor = '#e5e7eb';
    dotColor = '#9ca3af';
  }

  // Width approximations (in pixels for 11px system sans font)
  // Average char width ~ 6.8px
  const leftCharWidth = 6.8;
  const rightCharWidth = 6.8;

  const leftTextWidth = Math.round(leftText.length * leftCharWidth);
  const leftWidth = leftTextWidth + 18; // 9px padding each side

  const dotSpacing = showDot ? 14 : 0;
  const rightTextWidth = Math.round(rightText.length * rightCharWidth);
  const rightWidth = rightTextWidth + (showDot ? 24 : 18);

  const totalWidth = leftWidth + rightWidth;

  const leftCenter = Math.round(leftWidth / 2);
  const dotX = leftWidth + 12;
  const rightCenter = showDot ? leftWidth + 14 + Math.round((rightWidth - 14) / 2) : leftWidth + Math.round(rightWidth / 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${safeLeft}: ${safeRight}">
  <title>${safeLeft}: ${safeRight}</title>
  <linearGradient id="gloss" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".12"/>
    <stop offset="100%" stop-color="#000" stop-opacity=".18"/>
  </linearGradient>
  <clipPath id="clip-rounded">
    <rect width="${totalWidth}" height="20" rx="4" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#clip-rounded)">
    <!-- Left label background -->
    <rect width="${leftWidth}" height="20" fill="#0d1117"/>
    <!-- Right status background -->
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${rightBg}"/>
    <!-- Subtle overlay gloss -->
    <rect width="${totalWidth}" height="20" fill="url(#gloss)"/>
  </g>
  ${showDot ? `
  <!-- Radar Pulse Ring & Dot -->
  <circle cx="${dotX}" cy="10" r="4.5" fill="none" stroke="${dotColor}" stroke-opacity="0.3" stroke-width="1"/>
  <circle cx="${dotX}" cy="10" r="2.5" fill="${dotColor}"/>
  ` : ''}
  <!-- Typography with drop shadow -->
  <g text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" font-size="11" font-weight="600" letter-spacing="-0.01em">
    <!-- Left label shadow & text -->
    <text x="${leftCenter}" y="14" fill="#010101" fill-opacity=".3">${safeLeft}</text>
    <text x="${leftCenter}" y="13.5" fill="#e2e8f0">${safeLeft}</text>
    <!-- Right status shadow & text -->
    <text x="${rightCenter}" y="14" fill="#010101" fill-opacity=".3">${safeRight}</text>
    <text x="${rightCenter}" y="13.5" fill="${textColor}">${safeRight}</text>
  </g>
</svg>`.trim();
}
