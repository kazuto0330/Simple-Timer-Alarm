document.addEventListener('DOMContentLoaded', () => {
    const listElement = document.getElementById('finished-list');
    const stopBtn = document.getElementById('stop-sound-btn');

    const renderList = (timers) => {
        listElement.innerHTML = ''; // リストをクリア
        if (timers && timers.length > 0) {
            timers.forEach(timer => {
                const item = document.createElement('div');
                item.className = 'finished-item';
                item.textContent = `「${timer.name}」`;
                listElement.appendChild(item);
            });
            stopBtn.disabled = false;
        } else {
            const item = document.createElement('div');
            item.className = 'finished-item';
            item.textContent = "終了したタイマーはありません";
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
    chrome.runtime.sendMessage({ command: "getFinishedTimers" }, (response) => {
        if (response && response.success) {
            renderList(response.data);
        }
    });

    // ボタンのクリックイベント
    stopBtn.addEventListener('click', () => {
        // ★ resetFinishedTimersが音の停止も管理する
        chrome.runtime.sendMessage({ command: "resetFinishedTimers" });
        window.close();
    });
});