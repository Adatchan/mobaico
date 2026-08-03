/**
 * 実ブラウザでの動作確認。
 * content_scripts と同じ順序でスクリプトを読み込み、
 * ボタンの設置位置・ダイアログの表示・出力されるファイルを確かめる。
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
// フィクスチャの明細は 2025-12〜2026-01。当月/前月が動かないよう時計を固定する。
const TODAY = new Date('2026-01-15T09:00:00');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('SKIP: playwright が見つかりません (npm i -D playwright)');
  process.exit(0);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icoca-e2e-'));
const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();

/** 出力実行を押し、落ちてきたファイルを名前 → 中身の Map で返す。 */
async function runExport(expectedFiles) {
  const downloads = [];
  const collected = new Promise((resolve) => {
    const onDownload = (download) => {
      downloads.push(download);
      if (downloads.length === expectedFiles) {
        page.off('download', onDownload);
        resolve();
      }
    };
    page.on('download', onDownload);
  });

  await page.locator('.submit').click();
  await collected;

  const result = new Map();
  for (const download of downloads) {
    const saved = path.join(outDir, download.suggestedFilename());
    await download.saveAs(saved);
    result.set(download.suggestedFilename(), fs.readFileSync(saved));
  }
  return result;
}

try {
  await page.clock.install({ time: TODAY });
  await page.goto(pathToFileURL(FIXTURE).href);

  for (const file of ['src/parser.js', 'src/ui.js', 'src/content.js']) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, file), 'utf8') });
  }
  await page.addStyleTag({ content: fs.readFileSync(path.join(REPO, 'src/content.css'), 'utf8') });

  /* ---- ボタンの設置 ---- */

  const buttons = page.locator('.icoca-csv-export > button');
  assert.equal(await buttons.count(), 2, '印刷ボタンの数だけ CSV 出力ボタンが並ぶ');
  assert.equal(await buttons.first().textContent(), 'CSV出力');
  assert.equal(await buttons.first().getAttribute('type'), 'button', 'form を submit しない');

  const placedAfterPrint = await page.evaluate(() => {
    const wrapper = document.querySelector('button[name="PRINT"]').closest('.button');
    return wrapper.nextElementSibling?.classList.contains('icoca-csv-export');
  });
  assert.equal(placedAfterPrint, true, '印刷ボタンの直後に置かれる');

  /* ---- ダイアログの初期表示（当月 × １ヶ月ごと） ---- */

  await buttons.first().click();
  await page.locator('.panel').waitFor();

  assert.equal(await page.locator('input[value="monthly"]').isChecked(), true, '既定は１ヶ月ごと');
  assert.equal(await page.locator('input[value="current"]').isChecked(), true, '既定は当月');
  assert.match(await page.locator('#preview').textContent(), /1ファイル・合計3件/);
  assert.match(await page.locator('#preview').textContent(), /icoca_meisai_2026-01\.csv（3件）/);

  /* ---- 直近3ヶ月 × １ヶ月ごと → 月ごとに別ファイル ---- */

  await page.locator('input[value="last3"]').check();
  const preview = await page.locator('#preview').textContent();
  assert.match(preview, /2ファイル・合計4件/);
  assert.match(preview, /icoca_meisai_2026-01\.csv（3件）/);
  assert.match(preview, /icoca_meisai_2025-12\.csv（1件）/);
  // 2025/11 は表示中の明細に無いので、出せないことを伝える
  assert.match(preview, /2025\/11 の明細はありません/);

  const monthly = await runExport(2);
  assert.deepEqual([...monthly.keys()].sort(), ['icoca_meisai_2025-12.csv', 'icoca_meisai_2026-01.csv']);

  const january = monthly.get('icoca_meisai_2026-01.csv');
  assert.equal(january.subarray(0, 3).toString('hex'), 'efbbbf', 'Excel 用に BOM を付ける');
  assert.deepEqual(january.toString('utf8').replace(/^﻿/, '').split('\r\n'), [
    '日付,月/日,種別1,利用場所1,種別2,利用場所2,差額',
    '2026-01-10,01/10,物販,,利用,,-160',
    '2026-01-08,01/08,入場,ダミー西,出場,ダミー東,-1110',
    '2026-01-05,01/05,入金,モバイル,クレ,,2000',
    ''
  ]);

  assert.deepEqual(
    monthly.get('icoca_meisai_2025-12.csv').toString('utf8').replace(/^﻿/, '').split('\r\n'),
    [
      '日付,月/日,種別1,利用場所1,種別2,利用場所2,差額',
      '2025-12-28,12/28,乗車,ダミー交,ﾊﾞｽ等,,',
      ''
    ]
  );

  assert.match(await page.locator('.icoca-csv-export-toast').textContent(), /2ファイル（合計4件）/);
  assert.equal(await page.locator('.panel').count(), 0, '出力後はダイアログを閉じる');

  /* ---- 直近3ヶ月 × 直近100件 → 1ファイルにまとまる ---- */

  await buttons.first().click();
  await page.locator('.panel').waitFor();
  await page.locator('input[value="last3"]').check();
  await page.locator('input[value="single"]').check();
  assert.match(await page.locator('#preview').textContent(), /1ファイル・合計4件/);

  const single = await runExport(1);
  assert.deepEqual([...single.keys()], ['icoca_meisai_20251228-20260110.csv']);
  assert.equal(
    single.get('icoca_meisai_20251228-20260110.csv').toString('utf8').replace(/^﻿/, '').trimEnd().split('\r\n').length,
    5,
    '見出し + 4件'
  );

  /* ---- 全て × １ヶ月ごと → 明細のある月すべてを別ファイルに ---- */

  await buttons.first().click();
  await page.locator('.panel').waitFor();

  assert.match(
    await page.locator('label:has(input[value="all"])').textContent(),
    /表示中の4件すべて（2025\/12\/28〜2026\/01\/10）/,
    '「全て」には表示中の明細の実際の範囲を出す'
  );

  await page.locator('input[value="all"]').check();
  await page.locator('input[value="monthly"]').check();
  const allPreview = await page.locator('#preview').textContent();
  assert.match(allPreview, /2ファイル・合計4件/);
  assert.doesNotMatch(allPreview, /明細はありません/, '「全て」で月の抜けは知らせない');

  const all = await runExport(2);
  assert.deepEqual([...all.keys()].sort(), ['icoca_meisai_2025-12.csv', 'icoca_meisai_2026-01.csv']);

  /* ---- 全て × 直近100件 → 1ファイル ---- */

  await buttons.first().click();
  await page.locator('.panel').waitFor();
  await page.locator('input[value="all"]').check();
  await page.locator('input[value="single"]').check();
  assert.match(await page.locator('#preview').textContent(), /1ファイル・合計4件/);
  assert.deepEqual([...(await runExport(1)).keys()], ['icoca_meisai_20251228-20260110.csv']);

  /* ---- 明細が無い範囲では出力実行を押せない ---- */

  await buttons.first().click();
  await page.locator('.panel').waitFor();

  await page.locator('input[value="previous"]').check(); // 2025-12 は1件ある
  assert.match(await page.locator('#preview').textContent(), /1ファイル・合計1件/);
  assert.equal(await page.locator('.submit').isDisabled(), false);

  // 基準日を明細より後ろへ動かし、開き直す
  await page.keyboard.press('Escape');
  await page.clock.setFixedTime(new Date('2026-04-15T09:00:00'));
  await buttons.first().click();
  await page.locator('.panel').waitFor();
  await page.locator('input[value="current"]').check(); // 2026-04 の明細は無い
  assert.match(await page.locator('#preview').textContent(), /出力できる明細がありません/);
  assert.equal(await page.locator('.submit').isDisabled(), true, '出力できないときは押せない');

  /* ---- Esc で閉じる ---- */

  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.panel').count(), 0, 'Esc でダイアログを閉じる');
  assert.equal(page.url().startsWith('file://'), true, 'フォームが submit されていない');

  console.log('E2E OK');
} finally {
  await browser.close();
}
