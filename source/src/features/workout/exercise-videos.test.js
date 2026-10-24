// «فيديو الأداء»: every item of the active plan has a curated video; everything else falls back to a YouTube search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMS, LIBRARY } from './exercises.js';
import { VIDEOS, VERIFIED, videoFor, videoSource, searchUrl } from './exercise-videos.js';

const ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;
const SEARCH = /^https:\/\/www\.youtube\.com\/results\?search_query=[^\s]+$/;

test('every ul4c item resolves to a curated video with a valid 11-character id', () => {
  const items = Object.values(PROGRAMS.ul4c.days).flatMap((d) => d.items);
  assert.ok(items.length >= 30);
  for (const it of items) {
    const r = videoFor(it);
    assert.ok(r, `${it.id} resolves`);
    assert.equal(r.kind, 'video', `${it.id} (${it.en}) has a curated video`);
    const m = r.url.match(WATCH);
    assert.ok(m, `${it.id} url ${r.url}`);
    assert.equal(m[1], r.id);
    assert.ok(r.channel && r.title, `${it.id} channel + title`);
  }
});

test('curated entries: valid ids, channel, title, verification date; no duplicates per key', () => {
  assert.match(VERIFIED, /^\d{4}-\d{2}-\d{2}$/);
  for (const [k, c] of Object.entries(VIDEOS)) {
    assert.match(c.id, ID, k);
    assert.ok(c.channel.length > 1 && c.title.length > 1, k);
    assert.match(c.verified, /^\d{4}-\d{2}-\d{2}$/, k);
  }
  assert.equal(videoFor('wallsit').kind, 'video');
  assert.equal(videoFor('kegel').kind, 'video');
});

test('every library exercise gets a youtube.com link: curated, or a URL-encoded search', () => {
  for (const e of LIBRARY) {
    const r = videoFor(e);
    assert.ok(r, e.id);
    if (r.kind === 'video') assert.match(r.url, WATCH, e.id);
    else {
      assert.equal(r.kind, 'search');
      assert.match(r.url, SEARCH, e.id);
      assert.equal(r.url, searchUrl(e.en));
      assert.equal(decodeURIComponent(r.url.split('=')[1]), `${e.en} proper form`);
      assert.equal(videoSource(e), 'بحث يوتيوب');
    }
  }
  assert.equal(videoFor({ lib: 'ex11' }).kind, 'search');
  assert.equal(searchUrl('Low-Incline DB Press 15°'), 'https://www.youtube.com/results?search_query=Low-Incline%20DB%20Press%2015%C2%B0%20proper%20form');
});

test('legacy / session names resolve through the library; unknown names still search', () => {
  assert.equal(videoFor({ name: 'Flat Barbell Bench Press · 4×5' }).id, VIDEOS.ex1.id);
  assert.equal(videoFor({ name: 'بنش بريس بالبار' }).id, VIDEOS.ex1.id);
  const r = videoFor({ name: 'Zercher Squat' });
  assert.equal(r.kind, 'search');
  assert.match(r.url, SEARCH);
  assert.equal(videoFor({}), null);
});
