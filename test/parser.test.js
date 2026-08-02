const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAmount,
  parseMonthDay,
  rowsFromCellMatrix,
  escapeCsvField,
  buildCsv,
  buildFileName
} = require('../src/parser.js');

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

test('buildCsv は見出し付きの CRLF 区切り CSV を返す', () => {
  const matrix = [
    ['01/10', '物販', '', '利用', '', '¥589', '-160'],
    ['12/28', '乗車', 'ダミー交', 'ﾊﾞｽ等', '', '¥2,000', '']
  ];
  const csv = buildCsv(rowsFromCellMatrix(matrix, new Date(2026, 0, 15)));

  assert.deepEqual(csv.split('\r\n'), [
    '日付,月/日,種別1,利用場所1,種別2,利用場所2,残額,差額',
    '2026-01-10,01/10,物販,,利用,,589,-160',
    '2025-12-28,12/28,乗車,ダミー交,ﾊﾞｽ等,,2000,',
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
