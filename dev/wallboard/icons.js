// =============================================================================
//  icons.js — inline SVG weather icons (no network, no font dependency)
// -----------------------------------------------------------------------------
//  Keyed by Home Assistant `weather.*` condition strings.
//  https://www.home-assistant.io/integrations/weather/#condition-mapping
//  Returns an SVG string sized to fit its container (width/height 100%).
// =============================================================================

const S = (inner) =>
  `<svg viewBox="0 0 64 64" width="100%" height="100%" fill="none"
        stroke="currentColor" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const SUN = `<circle cx="32" cy="32" r="12"/>
  <g stroke-width="3">
    <line x1="32" y1="6"  x2="32" y2="14"/><line x1="32" y1="50" x2="32" y2="58"/>
    <line x1="6"  y1="32" x2="14" y2="32"/><line x1="50" y1="32" x2="58" y2="32"/>
    <line x1="13" y1="13" x2="19" y2="19"/><line x1="45" y1="45" x2="51" y2="51"/>
    <line x1="51" y1="13" x2="45" y2="19"/><line x1="19" y1="45" x2="13" y2="51"/>
  </g>`;

const MOON = `<path d="M40 12a20 20 0 1 0 12 36 16 16 0 0 1-12-36z"/>`;

const CLOUD = `<path d="M20 46a10 10 0 0 1 0-20 14 14 0 0 1 27-3 9 9 0 0 1 1 23z"/>`;

const RAIN = `<line x1="22" y1="50" x2="19" y2="58"/>
  <line x1="32" y1="50" x2="29" y2="58"/><line x1="42" y1="50" x2="39" y2="58"/>`;

const SNOW = `<line x1="22" y1="52" x2="22" y2="58"/>
  <line x1="32" y1="52" x2="32" y2="58"/><line x1="42" y1="52" x2="42" y2="58"/>`;

const BOLT = `<path d="M34 44l-8 0 6-12-10 0 12-16 -4 12 10 0z" fill="currentColor" stroke="none"/>`;

const ICONS = {
  'clear-night':   S(MOON),
  'cloudy':        S(CLOUD),
  'fog':           S(`<line x1="14" y1="28" x2="50" y2="28"/><line x1="10" y1="38" x2="54" y2="38"/><line x1="16" y1="48" x2="48" y2="48"/>`),
  'hail':          S(CLOUD + SNOW),
  'lightning':     S(CLOUD + BOLT),
  'lightning-rainy': S(CLOUD + BOLT + RAIN),
  'partlycloudy':  S(`<g transform="translate(-4,-4) scale(0.8)">${SUN}</g>` + CLOUD),
  'pouring':       S(CLOUD + RAIN + `<line x1="27" y1="50" x2="24" y2="58"/><line x1="37" y1="50" x2="34" y2="58"/>`),
  'rainy':         S(CLOUD + RAIN),
  'snowy':         S(CLOUD + SNOW),
  'snowy-rainy':   S(CLOUD + RAIN + SNOW),
  'sunny':         S(SUN),
  'windy':         S(`<path d="M8 26h30a6 6 0 1 0-6-6"/><path d="M8 38h40a6 6 0 1 1-6 6"/>`),
  'windy-variant': S(`<path d="M8 26h30a6 6 0 1 0-6-6"/><path d="M8 38h40a6 6 0 1 1-6 6"/>`),
  'exceptional':   S(`<circle cx="32" cy="32" r="20"/><line x1="32" y1="22" x2="32" y2="36"/><circle cx="32" cy="44" r="1.5" fill="currentColor"/>`),
};

const UNKNOWN = S(`<circle cx="32" cy="32" r="20"/><line x1="32" y1="22" x2="32" y2="36"/><circle cx="32" cy="44" r="1.5" fill="currentColor"/>`);

export function weatherIcon(condition) {
  return ICONS[condition] || UNKNOWN;
}
