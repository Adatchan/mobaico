/**
 * 「CSV出力」ボタンから開く設定ダイアログ。
 *
 * サイト側の CSS の影響を受けないよう Shadow DOM の中に組み立てる。
 * 出力方法と出力範囲を選ぶと、実際に落ちるファイル名と件数をその場に出す。
 */
(function (root) {
  'use strict';

  var HOST_CLASS = 'icoca-csv-export-dialog-host';

  var STYLE = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif; }',
    '.backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;',
    '  padding: 16px; background: rgba(0, 0, 0, 0.45); overflow: auto; }',
    '.panel { width: 100%; max-width: 420px; background: #fff; border-radius: 8px; color: #222;',
    '  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35); overflow: hidden; }',
    '.head { display: flex; align-items: center; justify-content: space-between; gap: 8px;',
    '  padding: 12px 16px; background: #0068b7; color: #fff; }',
    '.head h2 { font-size: 16px; font-weight: 700; line-height: 1.4; }',
    '.close { border: 0; background: transparent; color: #fff; font-size: 20px; line-height: 1;',
    '  padding: 4px 8px; cursor: pointer; border-radius: 4px; }',
    '.close:hover { background: rgba(255, 255, 255, 0.2); }',
    '.body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }',
    'fieldset { border: 0; }',
    'legend { font-size: 13px; font-weight: 700; color: #0068b7; margin-bottom: 6px; }',
    '.option { display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; border-radius: 4px;',
    '  cursor: pointer; font-size: 14px; line-height: 1.5; }',
    '.option:hover { background: #eef5fb; }',
    '.option input { margin-top: 3px; flex: none; accent-color: #0068b7; }',
    '.option .note { display: block; font-size: 12px; color: #666; }',
    '.preview { padding: 10px 12px; border-radius: 4px; background: #f2f5f8; font-size: 13px; line-height: 1.6; }',
    '.preview .files { margin-top: 4px; color: #444; font-size: 12px; word-break: break-all; }',
    '.preview.-warn { background: #fdf3e7; }',
    '.preview.-empty { background: #fbecea; }',
    '.warn { margin-top: 6px; color: #a4410f; font-size: 12px; line-height: 1.6; }',
    '.foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; background: #f7f9fb;',
    '  border-top: 1px solid #dde4ea; }',
    'button.action { min-width: 96px; padding: 8px 16px; border-radius: 4px; font-size: 14px; cursor: pointer; }',
    '.cancel { border: 1px solid #b9c4ce; background: #fff; color: #333; }',
    '.cancel:hover { background: #eef1f4; }',
    '.submit { border: 1px solid #0068b7; background: #0068b7; color: #fff; font-weight: 700; }',
    '.submit:hover:not(:disabled) { background: #00579a; }',
    '.submit:disabled { opacity: 0.5; cursor: not-allowed; }'
  ].join('\n');

  var MARKUP = [
    '<div class="backdrop" part="backdrop">',
    '  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="title">',
    '    <div class="head">',
    '      <h2 id="title">CSV出力</h2>',
    '      <button type="button" class="close" aria-label="閉じる">×</button>',
    '    </div>',
    '    <div class="body">',
    '      <fieldset id="mode-set"><legend>出力方法の指定</legend></fieldset>',
    '      <fieldset id="range-set"><legend>出力範囲の指定</legend></fieldset>',
    '      <div class="preview" id="preview" aria-live="polite"></div>',
    '    </div>',
    '    <div class="foot">',
    '      <button type="button" class="action cancel">キャンセル</button>',
    '      <button type="button" class="action submit">出力実行</button>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  /** 'YYYY-MM' を '2026/08' 表記にする。 */
  function displayMonth(monthKey) {
    return monthKey.replace('-', '/');
  }

  function buildRadio(group, value, label, note, checked) {
    return [
      '<label class="option">',
      '<input type="radio" name="' + group + '" value="' + value + '"' + (checked ? ' checked' : '') + '>',
      '<span>' + escapeHtml(label),
      note ? '<span class="note">' + escapeHtml(note) + '</span>' : '',
      '</span></label>'
    ].join('');
  }

  function modeOptions() {
    return [
      buildRadio('mode', 'monthly', '１ヶ月ごと', '月ごとに別のファイルで出力します', true),
      buildRadio('mode', 'single', '直近100件', '範囲内の明細をまとめて1ファイルで出力します', false)
    ].join('');
  }

  function rangeOptions(api, today) {
    var current = api.monthKeysForRange('current', today)[0];
    var previous = api.monthKeysForRange('previous', today)[0];
    var last3 = api.monthKeysForRange('last3', today);

    return [
      buildRadio('range', 'current', '当月', displayMonth(current), true),
      buildRadio('range', 'previous', '前月', displayMonth(previous), false),
      buildRadio('range', 'last3', '直近３ヶ月',
        displayMonth(last3[last3.length - 1]) + '〜' + displayMonth(last3[0]), false)
    ].join('');
  }

  function renderPreview(plan) {
    if (plan.files.length === 0) {
      return {
        className: 'preview -empty',
        html: '選択した範囲に出力できる明細がありません。' +
          '<div class="warn">その期間のご利用が無いか、表示中の100件に含まれていない可能性があります。' +
          '画面上部の「表示対象」を変えて検索し直すと表示されることがあります。</div>'
      };
    }

    var summary = plan.files.length + 'ファイル・合計' + plan.total + '件を出力します。';
    var list = plan.files.map(function (file) {
      return escapeHtml(file.name) + '（' + file.records.length + '件）';
    }).join('<br>');

    var warning = '';
    if (plan.emptyMonths.length > 0) {
      warning = '<div class="warn">' +
        escapeHtml(plan.emptyMonths.map(displayMonth).join('、')) +
        ' の明細はありません。ご利用が無いか、表示中の100件に含まれていない期間です。</div>';
    }

    return {
      className: 'preview' + (warning ? ' -warn' : ''),
      html: summary + '<div class="files">' + list + '</div>' + warning
    };
  }

  function closeExportDialog() {
    var existing = document.querySelector('.' + HOST_CLASS);
    if (existing) existing.remove();
  }

  /**
   * ダイアログを開く。
   * @param {{records: Array, today: Date, api: object, onSubmit: function}} config
   */
  function openExportDialog(config) {
    closeExportDialog();

    var host = document.createElement('div');
    host.className = HOST_CLASS;
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';

    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + STYLE + '</style>' + MARKUP;

    shadow.getElementById('mode-set').insertAdjacentHTML('beforeend', modeOptions());
    shadow.getElementById('range-set').insertAdjacentHTML('beforeend', rangeOptions(config.api, config.today));

    var preview = shadow.getElementById('preview');
    var submit = shadow.querySelector('.submit');
    var currentPlan = null;

    function selected(group) {
      return shadow.querySelector('input[name="' + group + '"]:checked').value;
    }

    function refresh() {
      currentPlan = config.api.buildExportPlan(config.records, {
        mode: selected('mode'),
        range: selected('range'),
        today: config.today
      });

      var rendered = renderPreview(currentPlan);
      preview.className = rendered.className;
      preview.innerHTML = rendered.html;
      submit.disabled = currentPlan.files.length === 0;
    }

    function close() {
      document.removeEventListener('keydown', onKeyDown, true);
      host.remove();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }

    shadow.querySelectorAll('input[type="radio"]').forEach(function (input) {
      input.addEventListener('change', refresh);
    });

    shadow.querySelector('.close').addEventListener('click', close);
    shadow.querySelector('.cancel').addEventListener('click', close);
    shadow.querySelector('.backdrop').addEventListener('mousedown', function (event) {
      if (event.target === event.currentTarget) close();
    });

    submit.addEventListener('click', function () {
      if (!currentPlan || currentPlan.files.length === 0) return;
      close();
      config.onSubmit(currentPlan);
    });

    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(host);

    refresh();
    submit.focus();

    return { close: close, shadow: shadow };
  }

  root.IcocaCsvUi = {
    openExportDialog: openExportDialog,
    closeExportDialog: closeExportDialog,
    renderPreview: renderPreview
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
