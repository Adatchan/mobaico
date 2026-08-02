/**
 * 実ブラウザでの動作確認。
 * content_scripts と同じ順序でスクリプトを読み込み、
 * 「CSV出力」ボタンの設置位置・ダウンロード内容・フォーム誤送信の有無を確かめる。
 *
 * 実行: node test/e2e.mjs   （Playwright が必要）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(REPO, 'test/fixtures/meisai.html');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('SKIP: playwright が見つかりません (npm i -D playwright)');
  process.exit(0);
}

const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

try {
  await page.goto(pathToFileURL(FIXTURE).href);

  for (const file of ['src/parser.js', 'src/content.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, file), 'utf8') });
  }
  await page.addStyleTag({ content: fs.readFileSync(path.join(REPO, 'src/content.css'), 'utf8') });

  const buttons = page.locator('.icoca-csv-export > button');
  assert.equal(await buttons.count(), 2, '印刷ボタンの数だけ CSV 出力ボタンが並ぶ');
  assert.equal(await buttons.first().textContent(), 'CSV出力');
  assert.equal(await buttons.first().getAttribute('type'), 'button', 'form を submit しない');

  const placedAfterPrint = await page.evaluate(() => {
    const wrapper = document.querySelector('button[name="PRINT"]').closest('.button');
    return wrapper.nextElementSibling?.classList.contains('icoca-csv-export');
  });
  assert.equal(placedAfterPrint, true, '印刷ボタンの直後に置かれる');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    buttons.first().click()
  ]);

  assert.equal(download.suggestedFilename(), 'icoca_meisai_20251228-20260110.csv');

  const saved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icoca-e2e-')), 'out.csv');
  await download.saveAs(saved);
  const buffer = fs.readFileSync(saved);

  assert.equal(buffer.subarray(0, 3).toString('hex'), 'efbbbf', 'Excel 用に BOM を付ける');
  assert.deepEqual(buffer.toString('utf8').replace(/^﻿/, '').split('\r\n'), [
    '日付,月/日,種別1,利用場所1,種別2,利用場所2,残額,差額',
    '2026-01-10,01/10,物販,,利用,,589,-160',
    '2026-01-08,01/08,入場,ダミー西,出場,ダミー東,749,-1110',
    '2026-01-05,01/05,入金,モバイル,クレ,,1859,2000',
    '2025-12-28,12/28,乗車,ダミー交,ﾊﾞｽ等,,2000,',
    ''
  ]);

  assert.match(await page.locator('.icoca-csv-export-toast').textContent(), /4件/);

  console.log('E2E OK');
} finally {
  await browser.close();
}
