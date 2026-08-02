/**
 * 利用明細ページに「CSV出力」ボタンを追加する。
 * 取得・変換・ダウンロードはすべてページ内で完結し、外部への送信は行わない。
 */
(function () {
  'use strict';

  var BUTTON_CLASS = 'icoca-csv-export';
  var TOAST_CLASS = 'icoca-csv-export-toast';
  /** 複数ファイルを一度に落とすとき、ブラウザが取りこぼさないよう間隔を空ける。 */
  var DOWNLOAD_INTERVAL_MS = 400;
  var api = globalThis.IcocaCsv;
  var ui = globalThis.IcocaCsvUi;

  function buildCsvButton() {
    // ページ既存のボタンと同じ見た目になるよう、サイト側のクラスに乗る。
    var wrapper = document.createElement('div');
    wrapper.className = 'button -small_ -blue ' + BUTTON_CLASS;

    var button = document.createElement('button');
    // 明細ページの各ボタンは form の中にあるため、submit させない。
    button.type = 'button';
    button.textContent = 'CSV出力';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openExportDialog();
    });

    wrapper.appendChild(button);
    return wrapper;
  }

  /** 「表示された履歴を印刷」ボタンを包む要素をすべて返す。 */
  function printButtonWrappers() {
    var buttons = document.querySelectorAll('button[name="PRINT"], input[name="PRINT"]');

    return Array.prototype.map.call(buttons, function (button) {
      return button.closest('.button') || button.parentElement;
    }).filter(Boolean);
  }

  function alreadyHasCsvButton(wrapper) {
    var next = wrapper.nextElementSibling;
    return !!next && next.classList.contains(BUTTON_CLASS);
  }

  /**
   * 印刷ボタンの隣に CSV 出力ボタンを差し込む。
   * 印刷ボタンが見つからないページ構成では、明細表の直前に置く。
   * @returns {number} 追加したボタンの数
   */
  function installButtons() {
    var wrappers = printButtonWrappers();
    var added = 0;

    wrappers.forEach(function (wrapper) {
      if (alreadyHasCsvButton(wrapper)) return;
      wrapper.insertAdjacentElement('afterend', buildCsvButton());
      added += 1;
    });

    if (wrappers.length === 0) {
      var table = api.findHistoryTable(document);
      if (table && !document.querySelector('.' + BUTTON_CLASS)) {
        var host = document.createElement('div');
        host.className = 'table-menu ' + BUTTON_CLASS + '-fallback';
        host.appendChild(buildCsvButton());
        (table.closest('.table-swipe') || table).insertAdjacentElement('beforebegin', host);
        added += 1;
      }
    }

    return added;
  }

  function showToast(message, isError) {
    var existing = document.querySelector('.' + TOAST_CLASS);
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = TOAST_CLASS + (isError ? ' -error' : '');
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.remove();
    }, 4000);
  }

  function downloadCsv(fileName, csvText) {
    // Excel が UTF-8 と判定できるよう BOM を付ける。
    var blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(function () {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /** 計画されたファイルを順に落とす。 */
  function runExport(plan) {
    plan.files.forEach(function (file, index) {
      setTimeout(function () {
        downloadCsv(file.name, api.buildCsv(file.records));
      }, index * DOWNLOAD_INTERVAL_MS);
    });

    var message = plan.files.length === 1
      ? plan.total + '件の明細をCSVに出力しました。'
      : plan.files.length + 'ファイル（合計' + plan.total + '件）をCSVに出力しました。';
    showToast(message);
  }

  /** 出力方法・出力範囲を選ぶダイアログを開く。 */
  function openExportDialog() {
    var today = new Date();
    var result = api.extractRows(document, { today: today });

    if (!result.table) {
      showToast('利用明細の表が見つかりませんでした。明細印刷画面で実行してください。', true);
      return false;
    }
    if (result.records.length === 0) {
      showToast('出力できる明細がありませんでした。', true);
      return false;
    }

    ui.openExportDialog({
      records: result.records,
      today: today,
      api: api,
      onSubmit: runExport
    });
    return true;
  }

  // ツールバーのアイコンから再注入されたときに二重登録しないようにする。
  globalThis.__icocaCsvExport = {
    installButtons: installButtons,
    openExportDialog: openExportDialog
  };

  installButtons();
})();
