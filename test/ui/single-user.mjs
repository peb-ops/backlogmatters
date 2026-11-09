// Every screen with accounts off (the default): projects, backlog, item dialog, map, plan, epics, health, settings.
import fs from 'node:fs';
import path from 'node:path';
import { assert, drag } from './harness.mjs';

export async function singleUser({ page, base, step, outDir }) {
  const tab = (name) => page.locator('.tabs a', { hasText: name }).click();
  const rows = page.locator('ol.rows li');
  const rowTitles = () => page.locator('ol.rows li .title').allInnerTexts();
  const modal = page.locator('.modal');
  const toast = async () => ((await page.locator('.toast').count()) ? (await page.locator('.toast').innerText()).trim() : '');
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'WS' : undefined));

  await step('projects page shows the empty state and no account controls', async () => {
    await page.goto(base);
    await page.getByText('No projects yet').waitFor({ timeout: 5000 });
    for (const text of ['Sign out', 'Administration']) assert(!(await page.getByText(text).count()), `${text} is visible with accounts off`);
  });

  await step('backup downloads from the projects page', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download backup' }).click()]);
    assert(/^backlogmatters-backup-\d{4}-\d{2}-\d{2}\.db$/.test(download.suggestedFilename()), `file name ${download.suggestedFilename()}`);
    const file = path.join(outDir, 'backup.db');
    await download.saveAs(file);
    assert(fs.readFileSync(file).subarray(0, 15).toString() === 'SQLite format 3', 'backup is not a SQLite database');
  });

  await step(
    'a bad project key shows a readable error',
    async () => {
      await page.getByRole('button', { name: 'New project' }).click();
      await modal.locator('input').first().fill('Web Shop');
      assert((await modal.locator('input').nth(1).inputValue()) === 'WS', 'key was not suggested from the name');
      await modal.locator('input').nth(1).fill('1X');
      await page.getByRole('button', { name: 'Create project' }).click();
      await modal.locator('.error').waitFor({ timeout: 3000 });
      const text = await modal.locator('.error').innerText();
      assert(text.includes('starting with a letter'), `error text: ${text}`);
    },
    { expectErrors: true },
  );

  await step('create a project', async () => {
    await modal.locator('input').nth(1).fill('WS');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.locator('.tabs').waitFor({ timeout: 5000 });
  });

  const titles = ['Checkout page', 'Payment provider integration', 'Order emails', 'Wishlist', 'Dark mode', 'Gift cards'];
  await step('quick add items', async () => {
    for (const t of titles) {
      await page.getByPlaceholder('Add an item and press Enter').fill(t);
      await page.keyboard.press('Enter');
      await page.locator('ol.rows li', { hasText: t }).waitFor({ timeout: 3000 });
    }
    assert((await rows.count()) === titles.length, `expected ${titles.length} rows`);
  });

  await step('create an epic', async () => {
    await tab('Epics');
    await page.getByRole('button', { name: 'New epic' }).click();
    await modal.locator('input').first().fill('Checkout');
    await modal.locator('[role=radiogroup] button').nth(2).click();
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'detached', timeout: 3000 });
    await page.getByText('Checkout', { exact: true }).first().waitFor();
  });

  async function editItem(title, { moscow, urgency, size, epic, due }) {
    await page.locator('ol.rows li .title', { hasText: title }).click();
    await modal.waitFor();
    const group = (i) => modal.locator('[role=radiogroup]').nth(i);
    if (moscow) await group(0).getByRole('radio', { name: new RegExp(`^${moscow}`) }).click();
    if (urgency) await group(1).getByRole('radio', { name: new RegExp(`^${urgency}`) }).click();
    if (size) await group(2).getByRole('radio', { name: new RegExp(`^${size}\\b`) }).click();
    if (epic) await modal.locator('select').nth(2).selectOption({ label: epic });
    if (due) await modal.locator('input[type=date]').fill(due);
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'detached', timeout: 3000 });
  }

  await step('item dialog sets priority, urgency, size, epic and due date', async () => {
    await tab('Backlog');
    await rows.first().waitFor();
    const inThreeDays = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    await editItem('Checkout page', { moscow: 'Must', urgency: 'Soon', size: 'M', epic: 'Checkout', due: inThreeDays });
    await editItem('Payment provider', { moscow: 'Must', urgency: 'Now', size: 'XL', epic: 'Checkout' });
    await editItem('Order emails', { moscow: 'Should', urgency: 'Can wait', size: 'S' });
    await editItem('Wishlist', { moscow: 'Could', size: 'L' });
    await editItem('Dark mode', { moscow: 'Won', size: 'XS' });
    assert(!(await toast()), `error: ${await toast()}`);
    const row = (await page.locator('ol.rows li', { hasText: 'Checkout page' }).innerText()).replace(/\s+/g, ' ');
    // A due date three days away raises "Soon" to "Now".
    for (const part of ['Must', 'Checkout', 'Now', 'M']) assert(row.includes(part), `checkout row lacks ${part}: ${row}`);
  });

  await step('scoring help opens', async () => {
    await page.locator('details.help summary').first().click();
    await page.locator('details.help dl').first().waitFor();
    await page.locator('details.help summary').first().click();
  });

  await step('drag to reorder is saved', async () => {
    const before = await rowTitles();
    await drag(page, rows.nth(4).locator('.handle'), rows.nth(0));
    await page.waitForTimeout(500);
    const after = await rowTitles();
    assert(before.join() !== after.join(), 'order did not change');
    await page.reload();
    await rows.first().waitFor();
    assert((await rowTitles()).join() === after.join(), 'order was not saved');
  });

  await step('move to top', async () => {
    const last = rows.last();
    const title = await last.locator('.title').innerText();
    await last.getByRole('button', { name: 'Move to top' }).click();
    await page.waitForTimeout(600);
    assert((await page.locator('ol.rows li .title').first().innerText()) === title, 'item did not move to the top');
  });

  await step('filters, search and suggested order', async () => {
    await page.getByLabel('Filter by priority').selectOption('must');
    assert((await rows.count()) === 2, 'must filter should show 2 rows');
    await page.getByLabel('Filter by priority').selectOption('all');
    await page.getByLabel('Sort').selectOption('score');
    const suggested = await rowTitles();
    assert(suggested[0].includes('Checkout page') && suggested.at(-1).includes('Dark mode'), `suggested order: ${suggested.join(' | ')}`);
    assert(!(await page.locator('ol.rows button.handle').count()), 'drag handles shown in suggested order');
    await page.getByLabel('Sort').selectOption('rank');
    await page.getByPlaceholder('Search title or key').fill('wish');
    assert((await rows.count()) === 1, 'search did not narrow to one item');
    await page.getByPlaceholder('Search title or key').fill('');
  });

  await step('status change hides done items until "Show done"', async () => {
    await page.locator('ol.rows li', { hasText: 'Order emails' }).getByLabel('Status').selectOption('done');
    await page.waitForTimeout(500);
    assert(!(await page.locator('ol.rows li', { hasText: 'Order emails' }).count()), 'done item still visible');
    await page.getByLabel('Show done').check();
    await page.locator('ol.rows li', { hasText: 'Order emails' }).waitFor();
    await page.getByLabel('Show done').uncheck();
  });

  await step('add a blocker', async () => {
    await page.locator('ol.rows li .title', { hasText: 'Checkout page' }).click();
    await modal.getByLabel('Add a blocker').selectOption({ label: 'WS-2 Payment provider integration' });
    await modal.getByText('Nothing blocks this item.').waitFor({ state: 'detached', timeout: 3000 });
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await page.locator('ol.rows li', { hasText: 'Checkout page' }).getByText('Blocked').waitFor();
  });

  const cell = (row, col) => page.locator('.map-cell').nth(row * 5 + col); // rows Must..Won't, columns XS..XL
  await step('map: drag between squares and from the tray', async () => {
    await tab('Map');
    await page.locator('.map').waitFor();
    await drag(page, page.locator('.map .pill', { hasText: 'Wishlist' }), cell(1, 1));
    await cell(1, 1).locator('.pill', { hasText: 'Wishlist' }).waitFor({ timeout: 3000 });
    await drag(page, page.locator('.tray .pill', { hasText: 'Gift cards' }), cell(2, 0));
    await cell(2, 0).locator('.pill', { hasText: 'Gift cards' }).waitFor({ timeout: 3000 });
    assert(!(await page.locator('.tray').count()), 'tray still shown after placing the last item');
  });

  await step('map: clicking an item opens it', async () => {
    await page.locator('.map .pill', { hasText: 'Wishlist' }).click();
    await modal.waitFor({ timeout: 2000 });
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached', timeout: 2000 });
  });

  await step('plan: release capacity and must-have warning', async () => {
    await tab('Plan');
    await page.getByRole('button', { name: 'New release' }).click();
    await modal.locator('input').first().fill('Release 1');
    await modal.getByLabel('Capacity (points)').fill('10');
    await modal.getByRole('button', { name: 'Save' }).click();
    await modal.waitFor({ state: 'detached', timeout: 3000 });
    for (const title of ['Checkout page', 'Payment provider integration']) {
      await page.getByLabel(`Release for ${title}`).selectOption({ label: 'Release 1' });
      await page.waitForTimeout(400);
    }
    const column = page.locator('section.column').filter({ has: page.locator('h2', { hasText: /^Release 1$/ }) });
    const text = (await column.innerText()).replace(/\s+/g, ' ');
    assert(text.includes('11 pt of 10 capacity') && text.includes('over by 1'), `capacity: ${text}`);
    assert(text.includes('Must-haves take 110% of capacity'), `must warning: ${text}`);
  });

  await step('health lists issues', async () => {
    await tab('Health');
    await page.waitForTimeout(300);
    const headings = await page.locator('h2').allInnerTexts();
    assert(headings.includes('Ranked above its blocker'), `health headings: ${headings.join(' | ')}`);
  });

  await step(
    'settings: export, import, bad import, backup and rename',
    async () => {
      await tab('Settings');
      assert(!(await page.getByText('Who has access').count()), 'access list visible with accounts off');
      await page.locator('section.card', { hasText: 'Backup' }).getByRole('link', { name: 'Download backup' }).waitFor();
      const fetchText = (href) => page.evaluate((u) => fetch(u).then((r) => r.text()), href);
      const csv = await fetchText(await page.getByText('Export CSV').getAttribute('href'));
      assert(csv.startsWith('Key,Type,Title'), `CSV header: ${csv.split('\n')[0]}`);
      const json = path.join(outDir, 'export.json');
      fs.writeFileSync(json, await fetchText(await page.getByText('Export BacklogMatters file').getAttribute('href')));
      await page.locator('input[type=file]').setInputFiles(json);
      await page.locator('.ok').waitFor({ timeout: 4000 });
      assert((await page.locator('.ok').innerText()).includes('Imported 6 items'), 'import result');
      const bad = path.join(outDir, 'bad.json');
      fs.writeFileSync(bad, '{"hello":1}');
      await page.locator('input[type=file]').setInputFiles(bad);
      await page.locator('.toast').waitFor({ timeout: 3000 });
      assert((await toast()).includes('not a BacklogMatters export file'), `bad import message: ${await toast()}`);
      await page.locator('.toast button').click();
      const details = page.locator('section.card', { hasText: 'Project details' });
      await details.locator('input').first().fill('Web Shop 2');
      await details.getByRole('button', { name: 'Save' }).click();
      await page.locator('h1', { hasText: 'Web Shop 2' }).waitFor({ timeout: 3000 });
    },
    { expectErrors: true },
  );

  await step('out-of-date banner when the server is an older build', async () => {
    // Pretend the server is an older build by dropping its build id from every API response.
    await page.route('**/api/**', async (route) => {
      try {
        const res = await route.fetch();
        const headers = { ...res.headers() };
        delete headers['x-bm-build'];
        await route.fulfill({ response: res, headers });
      } catch {
        // The page navigated away while this request was in flight.
      }
    });
    await page.reload();
    await page.locator('.banner').waitFor({ timeout: 4000 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  await step(
    'archive and delete the project',
    async () => {
      await page.reload();
      await page.getByRole('button', { name: 'Archive' }).click();
      await page.locator('.heading .chip', { hasText: 'Archived' }).waitFor({ timeout: 3000 });
      await page.goto(base + '/#/');
      await page.getByText(/Show archived/).click();
      await page.locator('a.card').first().click();
      await tab('Settings');
      await page.getByRole('button', { name: 'Delete project' }).click();
      await page.waitForURL(/#\/$/, { timeout: 4000 });
      await page.getByText('No projects yet').waitFor({ timeout: 3000 });
    },
    // The open project page reloads once more after the delete and gets a 404.
    { expectErrors: true },
  );

  await step('no sideways scrolling at phone width', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(base + '/#/');
    await page.waitForTimeout(300);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(width <= 390, `page is ${width}px wide at 390px`);
  });
}
