document.addEventListener('DOMContentLoaded', () => {
    const listElement = document.getElementById('finished-list');
    const stopBtn = document.getElementById('stop-sound-btn');

    const renderList = (items) => {
        listElement.innerHTML = ''; // リストをクリア
        if (items && items.length > 0) {
            items.forEach(item => {
                const el = document.createElement('div');
                el.className = 'finished-item';
                if (item.type === 'alarm') {
                    el.textContent = `「${item.name}」の時間です`;
                } else {
                    el.textContent = `「${item.name}」が終了しました`;
                }
                listElement.appendChild(el);
            });
            stopBtn.disabled = false;
        } else {
            const item = document.createElement('div');
            item.className = 'finished-item';
            item.textContent = "終了したタイマーやアラームはありません";
            listElement.appendChild(item);
            stopBtn.disabled = true;
        }
    };

    // ★ 動的更新のためのリスナーを追加
    chrome.runtime.onMessage.addListener((request) => {
        if (request.command === 'updateFinishedList') {
            renderList(request.data);
        }
    });

    // 初期表示
    chrome.runtime.sendMessage({ command: "getFinishedItems" }, (response) => {
        if (response && response.success) {
            renderList(response.data);
        }
    });

    // ボタンのクリックイベント
    stopBtn.addEventListener('click', () => {
        // ★ resetFinishedItemsが音の停止も管理する
        chrome.runtime.sendMessage({ command: "resetFinishedItems" });
        window.close();
    });
});