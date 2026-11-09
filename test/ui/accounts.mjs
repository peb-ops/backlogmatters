// Screens that exist only with accounts on: setup, administration, sharing, account, sign-in, and a viewer's read-only view.
import { assert } from './harness.mjs';

export async function accounts({ page, base, step }) {
  const modal = page.locator('.modal');
  const signIn = async (username, password) => {
    const fields = page.locator('input:not([type=checkbox])');
    await fields.nth(0).fill(username);
    await fields.nth(1).fill(password);
    await page.locator('button.primary').click();
  };
  page.on('dialog', (d) => d.accept());

  await step('first-run setup creates the administrator', async () => {
    await page.goto(base);
    await page.getByText('Create the administrator account').waitFor({ timeout: 5000 });
    const fields = page.locator('input');
    await fields.nth(0).fill('Admin Person');
    await fields.nth(1).fill('admin');
    await fields.nth(2).fill('correct-horse-1');
    await page.locator('button.primary').click();
    await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 5000 });
    assert(!(await page.getByRole('link', { name: 'Download backup' }).count()), 'projects page offers backup with accounts on');
  });

  await step('administration: add a viewer and a manager, backup link', async () => {
    await page.getByRole('link', { name: 'Administration' }).click();
    await page.getByRole('link', { name: 'Download backup' }).waitFor({ timeout: 3000 });
    for (const [username, role] of [['viewer1', 'viewer'], ['manager1', 'manager']]) {
      await page.getByRole('button', { name: 'Add person' }).click();
      const fields = modal.locator('input');
      await fields.nth(0).fill(`${username} Name`);
      await fields.nth(1).fill(username);
      await fields.nth(2).fill('password-123');
      await modal.locator('select').first().selectOption(role);
      await modal.locator('button.primary').click();
      await modal.waitFor({ state: 'detached', timeout: 3000 });
      await page.getByText(username, { exact: true }).first().waitFor({ timeout: 3000 });
    }
  });

  await step('create a project and share it with the viewer', async () => {
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('button', { name: 'New project' }).click();
    await modal.locator('input').first().fill('Shared Things');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.locator('.tabs').waitFor();
    await page.getByPlaceholder('Add an item and press Enter').fill('First item');
    await page.keyboard.press('Enter');
    await page.locator('ol.rows li').first().waitFor();
    await page.locator('.tabs a', { hasText: 'Settings' }).click();
    await page.getByText('Who has access').waitFor();
    assert(!(await page.locator('section.card', { hasText: /^Backup/ }).count()), 'project settings offer backup with accounts on');
    const add = page.getByLabel('Add a person');
    const option = (await add.locator('option').allInnerTexts()).find((t) => t.includes('viewer1'));
    await add.selectOption({ label: option });
    await page.getByLabel('Access for viewer1 Name').selectOption('viewer');
    await page.waitForTimeout(400);
  });

  await step('account page', async () => {
    await page.getByRole('link', { name: 'Admin Person' }).click();
    await page.getByText('Change password').first().waitFor({ timeout: 3000 });
  });

  await step(
    'sign out returns to the project list; a wrong password is refused',
    async () => {
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.waitForURL(/#\/$/, { timeout: 3000 });
      await signIn('viewer1', 'wrong-password');
      await page.locator('.error').waitFor({ timeout: 3000 });
      assert((await page.locator('.error').innerText()).includes('Incorrect username or password'), 'wrong password message');
    },
    { expectErrors: true },
  );

  await step('a viewer gets a read-only view', async () => {
    await signIn('viewer1', 'password-123');
    await page.locator('a.card').first().waitFor({ timeout: 5000 });
    assert(!(await page.getByRole('link', { name: 'Administration' }).count()), 'viewer sees Administration');
    assert(!(await page.getByRole('button', { name: 'New project' }).count()), 'viewer sees New project');
    await page.locator('a.card').first().click();
    await page.locator('.heading .chip', { hasText: 'Read only' }).waitFor({ timeout: 3000 });
    assert(!(await page.getByPlaceholder('Add an item and press Enter').count()), 'viewer sees quick add');
    assert(!(await page.locator('ol.rows button.handle').count()), 'viewer sees drag handles');
    await page.locator('ol.rows .title').first().click();
    assert(await modal.locator('input').first().isDisabled(), 'viewer can edit item fields');
    assert(!(await modal.getByRole('button', { name: 'Save' }).count()), 'viewer sees Save');
    await page.keyboard.press('Escape');
  });

  await step(
    'the server refuses a viewer’s edits and backup',
    async () => {
      const status = (url, init) => page.evaluate(([u, i]) => fetch(u, i).then((r) => r.status), [url, init]);
      const patch = { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-requested-with': 'bm' }, body: '{"title":"changed"}' };
      assert((await status('/api/items/1', patch)) === 403, 'viewer edit was not refused');
      assert((await status('/api/backup')) === 403, 'viewer backup was not refused');
    },
    { expectErrors: true },
  );

  await step('no sideways scrolling at phone width', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    for (const hash of ['#/', '#/p/1/backlog', '#/p/1/map']) {
      await page.goto(base + '/' + hash);
      await page.waitForTimeout(400);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(width <= 390, `${hash} is ${width}px wide at 390px`);
    }
  });
}
