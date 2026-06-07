# vendor/

Third-party JS/CSS would be vendored here (committed locally, never loaded from
a CDN) so the Pi works with no internet at runtime.

**Currently empty on purpose.** The wallboard uses only vanilla HTML/CSS/JS:
the energy flow, gauges and battery ring are hand-drawn inline SVG, and weather
icons are inline SVG (`icons.js`). No charting library is needed.

If you later add one (e.g. [uPlot](https://github.com/leeoniya/uPlot) for a
history sparkline), drop the minified file here and reference it with a relative
`<script>`/`<link>` — do not use a CDN URL.
