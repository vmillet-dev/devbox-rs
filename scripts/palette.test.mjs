import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * ⚠️ `node --test` and not a `*.spec.ts`, for the same reason the release-notes tests are
 * here: this reads a shipped file off disk, and the Angular builder compiles its specs for
 * a browser, where `node:fs` does not exist and `?raw` has no loader. Both were tried.
 */
const STYLESHEET = readFileSync('src/styles/styles.scss', 'utf8');

/** WCAG 2.2 AA for text below 18.66px, which is what every one of these is drawn at. */
const AA = 4.5;

/**
 * The four plain surfaces. ⚠️ **Not** every background text lands on: the tint-badge mixin
 * draws a hue on an 8–12% tint of itself, which moves the background toward the text and
 * costs about a point of contrast. Those composites are measured in #191, not here.
 */
const SURFACES = ['--bg-0', '--bg-1', '--bg-2', '--bg-3'];

/** Drawn as text somewhere, so each has to clear AA on every plain surface above. */
const TEXT = ['--text-0', '--text-1', '--text-2', '--amber', '--green', '--blue', '--red', '--purple'];

/**
 * Never text: hairlines, the dimmed accent behind a ring, the ink drawn *on* the accent,
 * and the titlebar's decorative dots. ⚠️ Listed rather than skipped, so a colour added to
 * the palette fails the last test here until somebody says which of the three it is.
 */
const NOT_TEXT = [
  '--line',
  '--line-soft',
  '--line-no',
  '--amber-dim',
  '--amber-ink',
  '--dot-red',
  '--dot-yellow',
  '--dot-green',
];

/** The dark palette is the bare `:root`, deliberately — see the comment above it. */
function block(theme) {
  const opening = theme === 'dark' ? ':root {' : ":root[data-theme='light'] {";
  const start = STYLESHEET.indexOf(opening);
  assert.ok(start >= 0, `no ${theme} block in styles.scss`);

  const body = STYLESHEET.slice(start + opening.length, STYLESHEET.indexOf('\n}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/g)].map((m) => [m[1], m[2]]),
  );
}

function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((raw) => {
    const part = raw / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of ['dark', 'light']) {
  describe(`the ${theme} palette`, () => {
    const declared = block(theme);
    // ⚠️ The light block redefines only what changes, so what it does not name it inherits
    // from the dark one — reading it from the wrong block would test a colour twice and
    // check another never.
    const of = (name) => declared[name] ?? block('dark')[name];

    it('draws every text colour legibly on every plain surface', () => {
      for (const name of TEXT) {
        for (const surface of SURFACES) {
          const ratio = contrast(of(name), of(surface));

          assert.ok(
            ratio >= AA,
            `${name} (${of(name)}) on ${surface} (${of(surface)}) is ${ratio.toFixed(2)}:1, AA asks ${AA}:1`,
          );
        }
      }
    });

    /** The one pairing that is not text on a surface: the label inside the amber fill. */
    it('draws the ink legibly on solid amber', () => {
      const ratio = contrast(of('--amber-ink'), of('--amber'));

      assert.ok(ratio >= AA, `the ink on amber is ${ratio.toFixed(2)}:1`);
    });

    /**
     * ⚠️ What stops the two lists above going quietly out of date. `--text-2` was under AA
     * on all four surfaces for as long as it existed, across 129 declarations, and nothing
     * anywhere said so.
     */
    it('has a verdict on every colour it declares', () => {
      const classified = new Set([...SURFACES, ...TEXT, ...NOT_TEXT]);
      const unclassified = Object.keys(declared).filter((name) => !classified.has(name));

      assert.deepEqual(
        unclassified,
        [],
        'each of these is text or it is not — say which in palette.test.mjs',
      );
    });
  });
}
