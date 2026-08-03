/**
 * モバイルICOCA 利用明細テーブルの解析と CSV 生成。
 *
 * DOM に依存しない純粋関数（セル文字列の配列を受け取る層）と、
 * ページから表を見つけてセル文字列を取り出す薄い DOM 層に分かれている。
 * 前者は Node からもテストできるよう module.exports でも公開する。
 */
(function (root) {
  'use strict';

  /** 明細テーブルのヘッダー行を見分けるための語。 */
  var HEADER_KEYWORDS = ['月/日', '残額', '差額'];

  /**
   * CSV の見出し行。
   * 実際に使われた金額は差額なので、残額は出力しない。
   */
  var CSV_HEADER = ['日付', '月/日', '種別1', '利用場所1', '種別2', '利用場所2', '差額'];

  /** 明細1件が持つ列数（表側の列数。残額を含む）。 */
  var COLUMN_COUNT = 7;

  /** 会員メニューが1画面に表示する明細の上限。 */
  var MAX_ROWS_PER_FILE = 100;

  /** 出力方法。monthly = 月ごとに別ファイル、single = まとめて1ファイル。 */
  var MODES = ['monthly', 'single'];

  /** 出力範囲。all は表示中の明細すべて。 */
  var RANGES = ['current', 'previous', 'last3', 'all'];

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/[ 　]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 金額欄にだけ使う正規化。全角数字・全角符号を半角に寄せる。 */
  function normalizeNumeric(text) {
    return normalizeText(text)
      .replace(/[０-９]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/[＋]/g, '+')
      .replace(/[－−―]/g, '-')
      .replace(/[，]/g, ',');
  }

  /**
   * 「¥1,039」「+2,000」「-160」を数値に変換する。
   * 空欄や解釈できない値は '' を返す（最古行の差額は空欄のため）。
   */
  function parseAmount(text) {
    var cleaned = normalizeNumeric(text).replace(/[¥￥,\s]/g, '');
    if (!/^[+-]?\d+$/.test(cleaned)) return '';
    return Number(cleaned);
  }

  /** 「07/27」を { month: 7, day: 27 } に変換する。解釈できなければ null。 */
  function parseMonthDay(text) {
    var matched = normalizeNumeric(text).match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
    if (!matched) return null;
    var month = Number(matched[1]);
    var day = Number(matched[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month: month, day: day };
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  /**
   * 明細には年が印字されていないため、基準日から遡って年を補う。
   * 表は新しい順に並んでおり、表示範囲は最大26週なので、
   * 「直前の行より日付が新しくなったら年が1つ古い」で復元できる。
   */
  function createYearResolver(anchor) {
    var year = anchor.getFullYear();
    var prevMonth = anchor.getMonth() + 1;
    var prevDay = anchor.getDate();

    return function resolve(monthDay) {
      if (monthDay.month > prevMonth ||
          (monthDay.month === prevMonth && monthDay.day > prevDay)) {
        year -= 1;
      }
      prevMonth = monthDay.month;
      prevDay = monthDay.day;
      return year;
    };
  }

  /**
   * セル文字列の二次元配列を明細レコードに変換する（DOM 非依存）。
   * @param {string[][]} matrix ヘッダー行を含まないデータ行
   * @param {Date} anchor 表示対象日（通常は今日）
   */
  function rowsFromCellMatrix(matrix, anchor) {
    var resolveYear = createYearResolver(anchor);
    var records = [];

    for (var i = 0; i < matrix.length; i += 1) {
      var cells = matrix[i];
      if (!cells || cells.length < COLUMN_COUNT) continue;

      var monthDay = parseMonthDay(cells[0]);
      if (!monthDay) continue;

      var year = resolveYear(monthDay);
      records.push({
        date: year + '-' + pad2(monthDay.month) + '-' + pad2(monthDay.day),
        monthDay: pad2(monthDay.month) + '/' + pad2(monthDay.day),
        type1: normalizeText(cells[1]),
        place1: normalizeText(cells[2]),
        type2: normalizeText(cells[3]),
        place2: normalizeText(cells[4]),
        balance: parseAmount(cells[5]),
        delta: parseAmount(cells[6])
      });
    }

    return records;
  }

  function escapeCsvField(value) {
    var text = value == null ? '' : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  /** レコード配列を CSV 本文（BOM なし・CRLF 区切り）にする。 */
  function buildCsv(records) {
    var lines = [CSV_HEADER.slice()];

    records.forEach(function (record) {
      lines.push([
        record.date,
        record.monthDay,
        record.type1,
        record.place1,
        record.type2,
        record.place2,
        record.delta
      ]);
    });

    return lines.map(function (columns) {
      return columns.map(escapeCsvField).join(',');
    }).join('\r\n') + '\r\n';
  }

  /** 例: icoca_meisai_20260327-20260727.csv */
  function buildFileName(records, today) {
    var stamp;

    if (records.length > 0) {
      var newest = records[0].date.replace(/-/g, '');
      var oldest = records[records.length - 1].date.replace(/-/g, '');
      stamp = oldest === newest ? newest : oldest + '-' + newest;
    } else {
      stamp = today.getFullYear() + pad2(today.getMonth() + 1) + pad2(today.getDate());
    }

    return 'icoca_meisai_' + stamp + '.csv';
  }

  /* ------------------------------------------------------------------ */
  /* 出力範囲と出力方法                                                   */
  /* ------------------------------------------------------------------ */

  function monthKeyOf(record) {
    return record.date.slice(0, 7);
  }

  /** 基準日の offset ヶ月前の 'YYYY-MM'。 */
  function monthKeyBefore(today, offset) {
    var shifted = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    return shifted.getFullYear() + '-' + pad2(shifted.getMonth() + 1);
  }

  /**
   * 出力範囲に含まれる月を新しい順に返す。
   * 「直近3ヶ月」は当月・前月・前々月の3暦月とする（月ごと出力なら3ファイル）。
   * 「全て」は暦月では決まらないため null（絞り込みなし）を返す。
   */
  function monthKeysForRange(range, today) {
    switch (range) {
      case 'current':
        return [monthKeyBefore(today, 0)];
      case 'previous':
        return [monthKeyBefore(today, 1)];
      case 'last3':
        return [monthKeyBefore(today, 0), monthKeyBefore(today, 1), monthKeyBefore(today, 2)];
      case 'all':
        return null;
      default:
        throw new Error('未知の出力範囲: ' + range);
    }
  }

  /** 明細を月ごとにまとめる。入力が新しい順なら、結果も新しい月から並ぶ。 */
  function groupByMonth(records) {
    var order = [];
    var buckets = Object.create(null);

    records.forEach(function (record) {
      var key = monthKeyOf(record);
      if (!buckets[key]) {
        buckets[key] = [];
        order.push(key);
      }
      buckets[key].push(record);
    });

    return order.map(function (key) {
      return { month: key, records: buckets[key] };
    });
  }

  /**
   * 出力範囲と出力方法から、実際に落とすファイルの一覧を組み立てる。
   *
   * @param {Array} records 画面に表示されている明細（新しい順）
   * @param {{mode: string, range: string, today: Date}} options
   * @returns {{months: string[], files: Array, total: number, emptyMonths: string[]}}
   */
  function buildExportPlan(records, options) {
    if (MODES.indexOf(options.mode) === -1) throw new Error('未知の出力方法: ' + options.mode);

    var wantedMonths = monthKeysForRange(options.range, options.today);
    var filtered;

    if (wantedMonths === null) {
      // 「全て」。表示中の明細をそのまま使う。
      filtered = records.slice();
    } else {
      var wanted = Object.create(null);
      wantedMonths.forEach(function (key) {
        wanted[key] = true;
      });
      filtered = records.filter(function (record) {
        return wanted[monthKeyOf(record)];
      });
    }

    var groups = groupByMonth(filtered);
    var files;

    if (options.mode === 'monthly') {
      files = groups.map(function (group) {
        return { name: 'icoca_meisai_' + group.month + '.csv', records: group.records };
      });
    } else {
      var limited = filtered.slice(0, MAX_ROWS_PER_FILE);
      files = limited.length === 0
        ? []
        : [{ name: buildFileName(limited, options.today), records: limited }];
    }

    var found = Object.create(null);
    groups.forEach(function (group) {
      found[group.month] = true;
    });

    return {
      // 「全て」のときは、実際に明細があった月を新しい順に並べたもの。
      months: wantedMonths === null
        ? groups.map(function (group) { return group.month; })
        : wantedMonths,
      files: files,
      total: files.reduce(function (sum, file) {
        return sum + file.records.length;
      }, 0),
      // 選んだ範囲のうち、表示中の100件に明細が無かった月。
      // 「全て」は表示中のものが全てなので、抜けは起こらない。
      emptyMonths: wantedMonths === null
        ? []
        : wantedMonths.filter(function (key) {
          return !found[key];
        })
    };
  }

  /* ------------------------------------------------------------------ */
  /* DOM 層                                                              */
  /* ------------------------------------------------------------------ */

  function rowCells(tr) {
    return Array.prototype.filter.call(tr.children, function (el) {
      return el.tagName === 'TD' || el.tagName === 'TH';
    });
  }

  function isHeaderRow(tr) {
    var text = normalizeText(tr.textContent);
    return HEADER_KEYWORDS.every(function (keyword) {
      return text.indexOf(keyword) !== -1;
    });
  }

  /** 「月/日 … 残額 … 差額」の見出しを持つ表を探す。 */
  function findHistoryTable(doc) {
    var tables = Array.prototype.slice.call(doc.querySelectorAll('table'));
    var sticky = tables.filter(function (table) {
      return table.classList.contains('sticky-table');
    });
    var candidates = sticky.length > 0 ? sticky.concat(tables) : tables;

    for (var i = 0; i < candidates.length; i += 1) {
      var rows = candidates[i].querySelectorAll('tr');
      if (rows.length > 0 && isHeaderRow(rows[0])) return candidates[i];
    }
    return null;
  }

  function cellMatrixFromTable(table) {
    var rows = Array.prototype.slice.call(table.querySelectorAll('tr'));
    var matrix = [];

    rows.forEach(function (tr) {
      if (isHeaderRow(tr)) return;
      matrix.push(rowCells(tr).map(function (cell) {
        return normalizeText(cell.textContent);
      }));
    });

    return matrix;
  }

  /**
   * ページ全体から明細を取り出す。
   * @param {Document} doc
   * @param {{today?: Date}} [options]
   */
  function extractRows(doc, options) {
    var settings = options || {};
    var anchor = settings.today || new Date();
    var table = findHistoryTable(doc);

    if (!table) return { table: null, records: [] };
    return { table: table, records: rowsFromCellMatrix(cellMatrixFromTable(table), anchor) };
  }

  var api = {
    CSV_HEADER: CSV_HEADER,
    MODES: MODES,
    RANGES: RANGES,
    MAX_ROWS_PER_FILE: MAX_ROWS_PER_FILE,
    normalizeText: normalizeText,
    parseAmount: parseAmount,
    parseMonthDay: parseMonthDay,
    rowsFromCellMatrix: rowsFromCellMatrix,
    escapeCsvField: escapeCsvField,
    buildCsv: buildCsv,
    buildFileName: buildFileName,
    monthKeyOf: monthKeyOf,
    monthKeysForRange: monthKeysForRange,
    groupByMonth: groupByMonth,
    buildExportPlan: buildExportPlan,
    findHistoryTable: findHistoryTable,
    cellMatrixFromTable: cellMatrixFromTable,
    extractRows: extractRows
  };

  root.IcocaCsv = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
