icons.svg is a local SVG sprite (a single file holding several
<symbol> elements) referenced by every page like this:

  <svg class="icon"><use href="icons/icons.svg#plus"></use></svg>

It currently ships with a minimal placeholder set so the app works
out of the box:

  plus, edit, trash, eye, close,
  chevron-left, chevron-right, chevrons-left, chevrons-right

favicon.svg is a similarly simple placeholder used as the site icon.

If you'd rather use icons sourced from a favicon/icon site, either:
  a) replace the shapes inside the matching <symbol id="..."> in
     icons.svg (keep the same ids so the HTML references still work), or
  b) drop in your own individual SVG files and update the <use href>
     paths in the HTML/JS to point at them directly instead of the
     sprite.

Both approaches keep everything local — no external icon CDN.
