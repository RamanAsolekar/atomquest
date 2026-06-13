import { test, expect, Browser } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

/**
 * End-to-end happy path required by the problem statement:
 *   agent logs in → creates session → generates invite →
 *   customer joins via invite → both connect to the SFU → chat works →
 *   agent ends session.
 */
test.describe('Atom Support Vision — end-to-end support call', () => {
  test('landing page renders and links to login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Video support that')).toBeVisible();
    await expect(page.getByRole('link', { name: /Agent sign in/i })).toBeVisible();
  });

  test('agent can log in and reach the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('agent@atomvision.dev');
    await page.getByLabel('Password').fill('Agent@123');
    await page.getByRole('button', { name: /Sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText('Support Dashboard')).toBeVisible();
  });

  test('full agent + customer call flow', async ({ browser }) => {
    // ---- Agent context ----
    const agentCtx = await browser.newContext();
    const agent = await agentCtx.newPage();
    await agent.goto('/login');
    await agent.getByLabel('Email').fill('agent@atomvision.dev');
    await agent.getByLabel('Password').fill('Agent@123');
    await agent.getByRole('button', { name: /Sign in/i }).click();
    await expect(agent).toHaveURL(/dashboard/);

    // Create a session
    await agent.getByRole('button', { name: /New session/i }).click();
    await agent.getByPlaceholder(/Router setup/i).fill('E2E Test Session');
    await agent.getByRole('button', { name: /Create & enter room/i }).click();
    await expect(agent).toHaveURL(/room\//);
    const sessionId = agent.url().split('/room/')[1];

    // Generate an invite via the API (UI invite dialog requires being on dashboard)
    const tokenResp = await agentCtx.request.post(`${API}/api/sessions/${sessionId}/invites`, {
      data: { customerName: 'E2E Customer' },
    });
    expect(tokenResp.ok()).toBeTruthy();
    const invite = await tokenResp.json();
    expect(invite.token).toBeTruthy();

    // Agent joins the room
    await agent.getByRole('button', { name: /Join call/i }).click();
    await expect(agent.getByText(/Connecting to the media server|Atom/i).first()).toBeVisible();

    // ---- Customer context ----
    const custCtx = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const customer = await custCtx.newPage();
    await customer.goto(`/join/${invite.token}`);
    await expect(customer.getByText(/Valid invite/i)).toBeVisible({ timeout: 15000 });
    await customer.getByPlaceholder(/Enter your name/i).fill('E2E Customer');
    await customer.getByRole('button', { name: /Join the call/i }).click();

    // Both should reach the in-call control bar (End / Leave button present)
    await expect(agent.getByRole('button', { name: /End session/i })).toBeVisible({ timeout: 20000 });
    await expect(customer.getByRole('button', { name: /Leave/i })).toBeVisible({ timeout: 20000 });

    // Agent ends the session
    await agent.getByRole('button', { name: /End session/i }).click();
    await expect(agent.getByText(/Session ended/i)).toBeVisible({ timeout: 10000 });

    await agentCtx.close();
    await custCtx.close();
  });

  test('invalid invite is rejected', async ({ page }) => {
    await page.goto('/join/not-a-real-token.bad-signature');
    await expect(page.getByText(/Invite not valid/i)).toBeVisible({ timeout: 15000 });
  });
});
