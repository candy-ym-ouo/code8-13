import { test, expect } from '@playwright/test';

// 运行前需先注册一次测试账号 shelf-ui@example.com / shelf-ui-password。
// 注册接口有频率限制（5 次/小时），端到端测试不重复走注册流程。
const run = Date.now();
const locationName = `测试书架${run}`;
const bookTitle = `多册测试书${run}`;

test('shelf locations and copies UI flow', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill('shelf-ui@example.com');
  await page.getByLabel('密码', { exact: true }).fill('shelf-ui-password');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '我的书' })).toBeVisible();

  // create a shelf location
  await page.getByRole('link', { name: '书架' }).click();
  await expect(page.getByRole('heading', { name: '书架与位置' })).toBeVisible();
  await page.getByRole('button', { name: '添加位置' }).click();
  await page.getByLabel('位置名称').fill(locationName);
  await page.getByRole('button', { name: '保存位置' }).click();
  await expect(page.getByText(locationName)).toBeVisible();

  // create a book
  await page.getByRole('link', { name: '我的书', exact: true }).click();
  await page.getByRole('link', { name: '添加书', exact: true }).click();
  await page.getByLabel('书名').fill(bookTitle);
  await page.getByRole('button', { name: '保存书目' }).click();
  await expect(page.getByRole('heading', { name: bookTitle })).toBeVisible();

  // register two copies of the same book
  await page.getByRole('button', { name: '登记一册副本' }).click();
  await page.getByLabel('存放位置').selectOption({ label: locationName });
  await page.getByLabel('册标记（可选）').fill('签名本');
  await page.getByRole('button', { name: '保存副本' }).click();
  await expect(page.getByText('第 1 册（签名本）')).toBeVisible();
  await expect(page.getByText('当前位置：' + locationName)).toBeVisible();

  await page.getByRole('button', { name: '登记一册副本' }).click();
  await page.getByLabel('册标记（可选）').fill('普通本');
  await page.getByRole('button', { name: '保存副本' }).click();
  await expect(page.getByText('第 2 册（普通本）')).toBeVisible();

  // move copy 1 off the shelf with a reason
  const firstCopy = page.locator('.trace-card', { hasText: '第 1 册' });
  await firstCopy.getByRole('button', { name: '移动' }).click();
  await page.getByLabel('移动到').selectOption({ label: '未上架（不属于任何位置）' });
  await page.getByLabel('移动原因（可选）').fill('借给朋友');
  await page.getByRole('button', { name: '确认移动' }).click();
  await expect(firstCopy.getByText('当前位置：未上架')).toBeVisible();

  // movement history shows the initial placement and this move
  await firstCopy.getByRole('button', { name: '迁移历史' }).click();
  await expect(page.getByText(`${locationName} → 未上架`)).toBeVisible();
  await expect(page.getByText(`未上架 → ${locationName}`)).toBeVisible();

  // archive copy 1
  page.once('dialog', (dialog) => void dialog.accept());
  await firstCopy.getByRole('button', { name: '归档' }).click();
  await expect(firstCopy.getByText('已归档')).toBeVisible();

  // delete copy 2; copy 1 is unaffected
  const secondCopy = page.locator('.trace-card', { hasText: '第 2 册' });
  page.once('dialog', (dialog) => void dialog.accept());
  await secondCopy.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.trace-card', { hasText: '第 2 册' })).toHaveCount(0);
  await expect(page.locator('.trace-card', { hasText: '第 1 册' })).toHaveCount(1);

  // timeline records the audited events
  await page.getByRole('link', { name: '时间线' }).click();
  await expect(page.getByText('移动 · 实体副本').first()).toBeVisible();
  await expect(page.getByText('归档 · 实体副本').first()).toBeVisible();
});
