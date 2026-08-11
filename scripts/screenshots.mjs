// Capture README screenshots into docs/images from a demo instance seeded by
// scripts/demo-seed.mjs (see that file's header for the full workflow).
//
// The browser is pinned to UTC so the naive times in the seed data are exactly
// what the calendar renders, regardless of the machine's timezone.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const { chromium } = require('playwright');

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3100';
const OUT = path.join(repoRoot, 'docs', 'images');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, timezoneId: 'UTC',
});
const page = await ctx.newPage();

async function shot(name) {
  await sleep(600); // let transitions/renders settle
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('captured', name);
}

// ── login page (logged out) ───────────────────────────────────────────────────
await page.goto(BASE + '/login');
await page.waitForSelector('#username');
await shot('login');

// ── sign in ───────────────────────────────────────────────────────────────────
await page.fill('#username', 'testuser');
await page.fill('#password', 'testpass');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'));

// ── contacts ──────────────────────────────────────────────────────────────────
await page.goto(BASE + '/contacts');
await page.waitForSelector('text=Amelia Hartley');
await page.click('text=Amelia Hartley');
await shot('contacts');

// ── calendar (month view) ─────────────────────────────────────────────────────
await page.goto(BASE + '/calendar');
await page.waitForSelector('.fc-daygrid-day');
await page.waitForSelector('text=Team standup');
await shot('calendar');

// ── tasks: list / kanban / gantt ──────────────────────────────────────────────
await page.goto(BASE + '/tasks');
await page.waitForSelector('text=Plan camping trip');
await shot('tasks-list');
await page.click('button[title="Kanban"]');
await page.waitForSelector('h3:has-text("In progress"), div:has-text("In progress") >> nth=0');
await sleep(400);
await shot('tasks-kanban');
await page.click('button[title="Gantt"]');
await page.waitForSelector('[data-testid="gantt-chart"]');
await shot('tasks-gantt');

// ── notes (rendered markdown detail) ──────────────────────────────────────────
await page.goto(BASE + '/notes');
await page.waitForSelector('text=Camping packing list');
await page.click('text=Camping packing list');
await shot('notes');

// ── journals (timeline) ───────────────────────────────────────────────────────
await page.goto(BASE + '/journals');
await page.waitForSelector('text=First tomato harvest');
await page.click('text=First tomato harvest');
await shot('journals');

// ── global search (from the calendar page) ────────────────────────────────────
await page.goto(BASE + '/calendar');
await page.waitForSelector('.fc-daygrid-day');
await sleep(500);
await page.keyboard.press('ControlOrMeta+k');
const searchInput = page.locator('[role="dialog"] input, input[placeholder*="earch"]').first();
await searchInput.waitFor();
await sleep(400);              // let the modal finish mounting/focusing
await searchInput.fill('camp'); // fill is atomic — typing can lose the first keystroke
await sleep(1200);             // debounce + cache/DAV queries
await shot('search');
await page.keyboard.press('Escape');

// ── mobile (bottom nav) ───────────────────────────────────────────────────────
const mctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, timezoneId: 'UTC',
  storageState: await ctx.storageState(),
});
const mpage = await mctx.newPage();
await mpage.goto(BASE + '/calendar');
await mpage.waitForSelector('.fc-daygrid-day');
await sleep(800);
await mpage.screenshot({ path: path.join(OUT, 'mobile-calendar.png') });
console.log('captured mobile-calendar');

await browser.close();
