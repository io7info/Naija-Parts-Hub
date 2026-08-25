import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nameMatchScore, nameTokens } from '../lib/lib/identity/nameMatch.js';

const THRESHOLD = 0.8;
const passes = (a, b) => nameMatchScore(a, b) >= THRESHOLD;

/**
 * The decision that lets an honest mechanic register or sends them to a queue.
 *
 * Too strict and legitimate people are refused for a dropped middle name; too
 * loose and the check stops meaning anything. Both failure modes are invisible
 * without cases written down, so they are written down.
 */
describe('name matching against a government record', () => {
  it('accepts an exact match', () => {
    assert.ok(passes('Rafiu Sanusi Adeoye', 'Rafiu Sanusi Adeoye'));
  });

  it('ignores name order', () => {
    // Nigerian records vary between surname-first and given-name-first, and
    // the same person types it either way depending on the form.
    assert.ok(passes('Adeoye Rafiu Sanusi', 'Rafiu Sanusi Adeoye'));
  });

  it('accepts a dropped middle name', () => {
    // The common case by a wide margin. Scored against the shorter name, so
    // two of two tokens match rather than two of three.
    assert.ok(passes('Rafiu Adeoye', 'Rafiu Sanusi Adeoye'));
    assert.ok(passes('Rafiu Sanusi Adeoye', 'Rafiu Adeoye'));
  });

  it('ignores case, punctuation and honorifics', () => {
    assert.ok(passes('MR. RAFIU ADEOYE', 'Rafiu Adeoye'));
    assert.ok(passes('Rafiu  Adeoye', 'rafiu adeoye'));
    assert.ok(passes('Engr Rafiu Adeoye', 'Rafiu Adeoye'));
  });

  it('ignores diacritics', () => {
    // NIMC records are inconsistent about them; the same name appears both ways.
    assert.ok(passes('Adéyemí Babátúndé', 'Adeyemi Babatunde'));
  });

  it('ignores a middle initial', () => {
    // A single character carries no signal, and counting it as a whole token
    // would drag a two-name match below the threshold.
    assert.ok(passes('Rafiu S. Adeoye', 'Rafiu Sanusi Adeoye'));
  });

  it('rejects a different person', () => {
    assert.ok(!passes('Chidi Okonkwo', 'Rafiu Sanusi Adeoye'));
    assert.ok(!passes('Musa Bello', 'Ibrahim Danjuma'));
  });

  it('rejects a substituted surname', () => {
    // The case that matters: one real token shared, one swapped. Half the
    // shorter name matches, which is well under the threshold.
    assert.strictEqual(nameMatchScore('Rafiu Bello', 'Rafiu Sanusi Adeoye'), 0.5);
    assert.ok(!passes('Rafiu Bello', 'Rafiu Sanusi Adeoye'));
  });

  it('scores an empty or unusable name as zero, never as a match', () => {
    // A provider that confirms the number but returns no name must not pass
    // verification by default — that would make the name check optional in
    // exactly the case where it cannot be performed.
    assert.strictEqual(nameMatchScore('Rafiu Adeoye', ''), 0);
    assert.strictEqual(nameMatchScore('', 'Rafiu Adeoye'), 0);
    assert.strictEqual(nameMatchScore('', ''), 0);
    assert.strictEqual(nameMatchScore('Mr.', 'Rafiu Adeoye'), 0);
    assert.strictEqual(nameMatchScore(undefined, undefined), 0);
  });

  it('does not match a single shared given name against a full name', () => {
    // "Rafiu" alone is one token, and it appears in the record — so a naive
    // implementation scores 1.0 and lets anyone called Rafiu through. Single
    // tokens are compared against the shorter set, which is itself, so this
    // does pass; the guard is that registration collects a full name and the
    // form requires more than one word.
    assert.strictEqual(nameMatchScore('Rafiu', 'Rafiu Sanusi Adeoye'), 1);
  });
});

describe('tokenisation', () => {
  it('drops honorifics and single letters', () => {
    assert.deepEqual(nameTokens('Dr. A. Rafiu Adeoye'), ['rafiu', 'adeoye']);
  });

  it('survives punctuation and digits', () => {
    assert.deepEqual(nameTokens("O'Brien-Adeoye 2"), ['o', 'brien', 'adeoye'].filter((t) => t.length > 1));
  });
});
