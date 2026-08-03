const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAmount,
  parseMonthDay,
  rowsFromCellMatrix,
  escapeCsvField,
  buildCsv,
  buildFileName,
  monthKeysForRange,
  groupByMonth,
  buildExportPlan
} = require('../src/parser.js');

/** テスト用に、月日と差額だけ指定して明細行を作る。 */
function row(monthDay, delta) {
  return [monthDay, '物販', '', '利用', '', '¥1,000', String(delta)];
}

test('parseAmount は円記号・カンマ・符号を取り除いて数値にする', () => {
  assert.equal(parseAmount('¥1,039'), 1039);
  assert.equal(parseAmount('￥589'), 589);
  assert.equal(parseAmount('-160'), -160);
  assert.equal(parseAmount('+2,000'), 2000);
  assert.equal(parseAmount('−180'), -180); // 全角マイナス
  assert.equal(parseAmount('１２３'), 123); // 全角数字
});

test('parseAmount は空欄や解釈できない値を空文字にする', () => {
  assert.equal(parseAmount(''), '');
  assert.equal(parseAmount('   '), '');
  assert.equal(parseAmount(null), '');
  assert.equal(parseAmount('—'), '');
});

test('parseMonthDay は月日を取り出し、不正な値は null を返す', () => {
  assert.deepEqual(parseMonthDay('07/27'), { month: 7, day: 27 });
  assert.deepEqual(parseMonthDay(' 3/5 '), { month: 3, day: 5 });
  assert.equal(parseMonthDay('合計'), null);
  assert.equal(parseMonthDay('13/01'), null);
  assert.equal(parseMonthDay(''), null);
});

test('明細に印字されていない年を基準日から遡って補う', () => {
  const matrix = [
    ['01/10', '物販', '', '利用', '', '¥589', '-160'],
    ['01/05', '入金', 'モバイル', 'クレ', '', '¥749', '+2,000'],
    ['12/28', '乗車', 'ダミー交', 'ﾊﾞｽ等', '', '¥2,000', '-230'],
    ['12/20', '入場', 'ダミー西', '出場', 'ダミー東', '¥2,230', '-180']
  ];

  const records = rowsFromCellMatrix(matrix, new Date(2026, 0, 15));

  assert.deepEqual(records.map((r) => r.date), [
    '2026-01-10',
    '2026-01-05',
    '2025-12-28',
    '2025-12-20'
  ]);
});

test('同じ日付が続いても年を巻き戻さない', () => {
  const matrix = [
    ['07/25', '入場', 'A', '出場', 'B', '¥100', '-10'],
    ['07/25', '入場', 'B', '出場', 'C', '¥110', '-10'],
    ['07/25', '物販', '', '利用', '', '¥120', '-10']
  ];

  const records = rowsFromCellMatrix(matrix, new Date(2026, 7, 2));

  assert.deepEqual(records.map((r) => r.date), ['2026-07-25', '2026-07-25', '2026-07-25']);
});

test('基準日より新しい先頭行は前年として扱う', () => {
  const matrix = [['12/31', '物販', '', '利用', '', '¥100', '-10']];
  const records = rowsFromCellMatrix(matrix, new Date(2026, 0, 5));

  assert.equal(records[0].date, '2025-12-31');
});

test('列数が足りない行や見出し以外の行は読み飛ばす', () => {
  const matrix = [
    ['01/10', '物販', '', '利用', '', '¥589', '-160'],
    ['ご利用がありません'],
    ['合計', '', '', '', '', '', ''],
    ['01/09', '物販', '', '利用', '', '¥749', '-160']
  ];

  const records = rowsFromCellMatrix(matrix, new Date(2026, 0, 15));

  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.date), ['2026-01-10', '2026-01-09']);
});

test('駅名の前後の空白と全角空白を取り除く', () => {
  const matrix = [['01/10', '入場', '　新大阪　 ', '出場', '環）福島', '¥589', '-160']];
  const records = rowsFromCellMatrix(matrix, new Date(2026, 0, 15));

  assert.equal(records[0].place1, '新大阪');
  assert.equal(records[0].place2, '環）福島');
});

test('escapeCsvField はカンマ・引用符・改行を含む値だけを囲う', () => {
  assert.equal(escapeCsvField('物販'), '物販');
  assert.equal(escapeCsvField('あ,い'), '"あ,い"');
  assert.equal(escapeCsvField('あ"い'), '"あ""い"');
  assert.equal(escapeCsvField('あ\nい'), '"あ\nい"');
  assert.equal(escapeCsvField(''), '');
  assert.equal(escapeCsvField(0), '0');
});

test('buildCsv は見出し付きの CRLF 区切り CSV を返し、残額は含めない', () => {
  const matrix = [
    ['01/10', '物販', '', '利用', '', '¥589', '-160'],
    ['12/28', '乗車', 'ダミー交', 'ﾊﾞｽ等', '', '¥2,000', '']
  ];
  const csv = buildCsv(rowsFromCellMatrix(matrix, new Date(2026, 0, 15)));

  assert.deepEqual(csv.split('\r\n'), [
    '日付,月/日,種別1,利用場所1,種別2,利用場所2,差額',
    '2026-01-10,01/10,物販,,利用,,-160',
    '2025-12-28,12/28,乗車,ダミー交,ﾊﾞｽ等,,',
    ''
  ]);
});

test('buildFileName は明細の期間をファイル名に入れる', () => {
  const records = rowsFromCellMatrix(
    [
      ['01/10', '物販', '', '利用', '', '¥589', '-160'],
      ['12/28', '乗車', 'A', 'B', '', '¥2,000', '-230']
    ],
    new Date(2026, 0, 15)
  );

  assert.equal(buildFileName(records, new Date(2026, 0, 15)), 'icoca_meisai_20251228-20260110.csv');
});

test('buildFileName は1日分なら日付ひとつ、明細ゼロなら当日を使う', () => {
  const single = rowsFromCellMatrix([['01/10', '物販', '', '利用', '', '¥589', '-160']], new Date(2026, 0, 15));

  assert.equal(buildFileName(single, new Date(2026, 0, 15)), 'icoca_meisai_20260110.csv');
  assert.equal(buildFileName([], new Date(2026, 0, 5)), 'icoca_meisai_20260105.csv');
});

test('monthKeysForRange は当月・前月・直近3ヶ月を新しい順に返す', () => {
  const today = new Date(2026, 7, 2); // 2026/08/02

  assert.deepEqual(monthKeysForRange('current', today), ['2026-08']);
  assert.deepEqual(monthKeysForRange('previous', today), ['2026-07']);
  assert.deepEqual(monthKeysForRange('last3', today), ['2026-08', '2026-07', '2026-06']);
});

test('monthKeysForRange は年をまたいでも正しく遡る', () => {
  const today = new Date(2026, 0, 20); // 2026/01/20

  assert.deepEqual(monthKeysForRange('previous', today), ['2025-12']);
  assert.deepEqual(monthKeysForRange('last3', today), ['2026-01', '2025-12', '2025-11']);
});

test('monthKeysForRange は未知の範囲を拒む', () => {
  assert.throws(() => monthKeysForRange('last6', new Date(2026, 7, 2)), /未知の出力範囲/);
});

test('groupByMonth は新しい月から順にまとめる', () => {
  const records = rowsFromCellMatrix(
    [row('08/01', -100), row('07/20', -200), row('07/01', -300), row('06/30', -400)],
    new Date(2026, 7, 2)
  );

  assert.deepEqual(
    groupByMonth(records).map((g) => [g.month, g.records.length]),
    [['2026-08', 1], ['2026-07', 2], ['2026-06', 1]]
  );
});

test('直近3ヶ月 × １ヶ月ごと は月ごとに3ファイルへ分かれる', () => {
  const records = rowsFromCellMatrix(
    [row('08/01', -100), row('07/20', -200), row('07/01', -300), row('06/30', -400), row('05/31', -500)],
    new Date(2026, 7, 2)
  );

  const plan = buildExportPlan(records, { mode: 'monthly', range: 'last3', today: new Date(2026, 7, 2) });

  assert.deepEqual(plan.files.map((f) => f.name), [
    'icoca_meisai_2026-08.csv',
    'icoca_meisai_2026-07.csv',
    'icoca_meisai_2026-06.csv'
  ]);
  assert.deepEqual(plan.files.map((f) => f.records.length), [1, 2, 1]);
  // 範囲外の 05/31 は含めない
  assert.equal(plan.total, 4);
  assert.deepEqual(plan.emptyMonths, []);
});

test('直近3ヶ月 × 直近100件 は1ファイルにまとまる', () => {
  const records = rowsFromCellMatrix(
    [row('08/01', -100), row('07/20', -200), row('06/30', -400), row('05/31', -500)],
    new Date(2026, 7, 2)
  );

  const plan = buildExportPlan(records, { mode: 'single', range: 'last3', today: new Date(2026, 7, 2) });

  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].name, 'icoca_meisai_20260630-20260801.csv');
  assert.equal(plan.total, 3);
});

test('当月・前月はその月だけを出力する', () => {
  const records = rowsFromCellMatrix(
    [row('08/01', -100), row('07/20', -200), row('06/30', -400)],
    new Date(2026, 7, 2)
  );
  const today = new Date(2026, 7, 2);

  const current = buildExportPlan(records, { mode: 'monthly', range: 'current', today });
  assert.deepEqual(current.files.map((f) => f.name), ['icoca_meisai_2026-08.csv']);
  assert.equal(current.total, 1);

  const previous = buildExportPlan(records, { mode: 'monthly', range: 'previous', today });
  assert.deepEqual(previous.files.map((f) => f.name), ['icoca_meisai_2026-07.csv']);
  assert.equal(previous.total, 1);
});

test('直近100件は表示上限の100件で打ち切る', () => {
  const matrix = [];
  for (let i = 0; i < 120; i += 1) matrix.push(row('07/20', -100));
  const records = rowsFromCellMatrix(matrix, new Date(2026, 7, 2));

  const plan = buildExportPlan(records, { mode: 'single', range: 'previous', today: new Date(2026, 7, 2) });

  assert.equal(plan.files.length, 1);
  assert.equal(plan.total, 100);
});

test('表示中の明細に無い月は emptyMonths として知らせる', () => {
  const records = rowsFromCellMatrix([row('08/01', -100)], new Date(2026, 7, 2));

  const plan = buildExportPlan(records, { mode: 'monthly', range: 'last3', today: new Date(2026, 7, 2) });

  assert.deepEqual(plan.files.map((f) => f.name), ['icoca_meisai_2026-08.csv']);
  assert.deepEqual(plan.emptyMonths, ['2026-07', '2026-06']);
});

test('範囲内に明細が無ければファイルを作らない', () => {
  const records = rowsFromCellMatrix([row('08/01', -100)], new Date(2026, 7, 2));

  const plan = buildExportPlan(records, { mode: 'monthly', range: 'previous', today: new Date(2026, 7, 2) });

  assert.deepEqual(plan.files, []);
  assert.equal(plan.total, 0);
  assert.deepEqual(plan.emptyMonths, ['2026-07']);
});

test('buildExportPlan は未知の出力方法を拒む', () => {
  assert.throws(
    () => buildExportPlan([], { mode: 'weekly', range: 'current', today: new Date(2026, 7, 2) }),
    /未知の出力方法/
  );
});

test('monthKeysForRange の「全て」は絞り込みなしを表す null を返す', () => {
  assert.equal(monthKeysForRange('all', new Date(2026, 7, 2)), null);
});

test('全て × １ヶ月ごと は明細のある月すべてを別ファイルにする', () => {
  const records = rowsFromCellMatrix(
    [row('08/01', -100), row('07/20', -200), row('07/01', -300), row('05/31', -500), row('12/28', -600)],
    new Date(2026, 7, 2)
  );

  const plan = buildExportPlan(records, { mode: 'monthly', range: 'all', today: new Date(2026, 7, 2) });

  // 直近3ヶ月から外れる 2026-05 や、年をまたいだ 2025-12 も落ちる
  assert.deepEqual(plan.files.map((f) => f.name), [
    'icoca_meisai_2026-08.csv',
    'icoca_meisai_2026-07.csv',
    'icoca_meisai_2026-05.csv',
    'icoca_meisai_2025-12.csv'
  ]);
  assert.deepEqual(plan.files.map((f) => f.records.length), [1, 2, 1, 1]);
  assert.equal(plan.total, 5);
  assert.deepEqual(plan.months, ['2026-08', '2026-07', '2026-05', '2025-12']);
  assert.deepEqual(plan.emptyMonths, [], '表示中のものが全てなので抜けは起こらない');
});

test('全て × 直近100件 は表示中の明細を1ファイルにまとめる', () => {
  const records = rowsFromCellMatrix(
    [row('08/01', -100), row('07/20', -200), row('05/31', -500)],
    new Date(2026, 7, 2)
  );

  const plan = buildExportPlan(records, { mode: 'single', range: 'all', today: new Date(2026, 7, 2) });

  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].name, 'icoca_meisai_20260531-20260801.csv');
  assert.equal(plan.total, 3);
});

test('全て で明細が1件も無ければファイルを作らない', () => {
  const plan = buildExportPlan([], { mode: 'monthly', range: 'all', today: new Date(2026, 7, 2) });

  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.months, []);
  assert.equal(plan.total, 0);
});
