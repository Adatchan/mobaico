/**
 * ツールバーのアイコンを押したときの動作。
 *
 * manifest の matches に載っていないホストで会員メニューが提供されていても
 * 使えるように、activeTab 権限でその場だけスクリプトを流し込む。
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== 'number') return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/parser.js', 'src/ui.js', 'src/content.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.__icocaCsvExport && globalThis.__icocaCsvExport.openExportDialog()
    });
  } catch (error) {
    console.error('[モバイルICOCA CSV出力] スクリプトを実行できませんでした:', error);
  }
});
