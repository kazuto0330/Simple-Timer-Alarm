// background.js

// (ファイルの先頭部分は変更なしのため省略)
let isSidePanelOpen = false;
chrome.runtime.onInstalled.addListener((details) => { if (details.reason === 'install') { chrome.storage.local.set({ timers: {}, alarms: {}, volume: 50, finishedTimers: [] }); addTimer({ minutes: 3 }); } });
chrome.action.onClicked.addListener((tab) => { chrome.sidePanel.open({ windowId: tab.windowId }); });
chrome.runtime.onConnect.addListener((port) => { if (port.name === "sidepanel") { isSidePanelOpen = true; port.onDisconnect.addListener(() => { isSidePanelOpen = false; }); } });

// --- メッセージング ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { command, data } = request;
  const actions = {
    addTimer, deleteTimer, updateTimerTime, updateTimerName, pauseTimer, resumeTimer, resetTimer,
    getTimers: sendDataToSidePanel,
    updateVolume,
    getFinishedTimers: (d, r) => chrome.storage.local.get('finishedTimers', (res) => r({ success: true, data: res.finishedTimers })),
    resetFinishedTimers,
    addAlarm, deleteAlarm, updateAlarmTime, updateAlarmName, toggleAlarm,
    resetFinishedAlarm, // ★ 追加
  };
  if (actions[command]) {
    actions[command](data, sendResponse);
    return true;
  }
  sendResponse({ success: false, message: "Unknown command" });
  return true;
});

const onFocusChanged = async (windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        try {
            const { finishedTimers } = await chrome.storage.local.get("finishedTimers");
            if (finishedTimers && finishedTimers.length > 0) {
                await chrome.action.setPopup({ popup: 'popup.html' });
                await chrome.action.openPopup();

                // ポップアップ表示に成功したらバッジを消してリスナーを削除
                await chrome.action.setBadgeText({ text: '' });
                chrome.windows.onFocusChanged.removeListener(onFocusChanged);
            } else {
                // 完了タイマーがないならリスナーを削除
                chrome.windows.onFocusChanged.removeListener(onFocusChanged);
            }
        } catch (e) {
            console.error("onFocusChanged: ポップアップの再表示に失敗しました。", e);
            // 再試行しても失敗する場合は、ループを防ぐためにリスナーを削除する。
            // バッジは残るのでユーザーは通知に気づける
            chrome.windows.onFocusChanged.removeListener(onFocusChanged);
        }
    }
};

async function clearFinishedState() {
    stopSound();
    await chrome.action.setPopup({ popup: '' });
    await chrome.action.setBadgeText({ text: '' });
    if (chrome.windows.onFocusChanged.hasListener(onFocusChanged)) {
        chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    }
}

// --- アラーム操作 ---
function addAlarm() {
  chrome.storage.local.get("alarms", ({ alarms = {} }) => {
    const newId = `alarm_${Date.now()}`;
    const alarmCount = Object.keys(alarms).length;
    alarms[newId] = {
      id: newId,
      name: `アラーム ${alarmCount + 1}`,
      time: "00:00",
      isActive: false,
    };
    chrome.storage.local.set({ alarms }, sendDataToSidePanel);
  });
}

async function deleteAlarm({ id }) {
  const { alarms, finishedTimers } = await chrome.storage.local.get(["alarms", "finishedTimers"]);
  delete alarms[id];
  const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);
  
  await chrome.storage.local.set({ alarms, finishedTimers: updatedFinished });
  sendDataToSidePanel();
  chrome.alarms.clear(id);

  if (updatedFinished.length === 0 && (finishedTimers || []).length > 0) {
    await clearFinishedState();
  }
}

function updateAlarmTime({ id, time }) {
    chrome.storage.local.get("alarms", ({ alarms = {} }) => {
        if (alarms[id]) {
            alarms[id].time = time;
            chrome.storage.local.set({ alarms }, () => {
                if (alarms[id].isActive) {
                    toggleAlarm({ id, isActive: true });
                } else {
                    sendDataToSidePanel();
                }
            });
        }
    });
}

function updateAlarmName({ id, newName }) {
  chrome.storage.local.get("alarms", ({ alarms = {} }) => {
    if (alarms[id]) {
      alarms[id].name = newName;
      chrome.storage.local.set({ alarms }, sendDataToSidePanel);
    }
  });
}

function toggleAlarm({ id, isActive }) {
    chrome.storage.local.get("alarms", ({ alarms = {} }) => {
        const alarm = alarms[id];
        if (alarm) {
            alarm.isActive = isActive;
            chrome.storage.local.set({ alarms }, sendDataToSidePanel);

            chrome.alarms.clear(id); 

            if (isActive) {
                const [hours, minutes] = alarm.time.split(':').map(Number);
                const now = new Date();
                const alarmTime = new Date();
                alarmTime.setHours(hours, minutes, 0, 0);

                if (alarmTime < now) {
                    alarmTime.setDate(alarmTime.getDate() + 1);
                }
                
                chrome.alarms.create(id, {
                    when: alarmTime.getTime(),
                    periodInMinutes: 24 * 60
                });
            }
        }
    });
}

// --- タイマー操作 ---
async function deleteTimer({ id }) {
  const { timers, finishedTimers } = await chrome.storage.local.get(["timers", "finishedTimers"]);
  delete timers[id];
  const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);
  await chrome.storage.local.set({ timers, finishedTimers: updatedFinished });
  sendDataToSidePanel();
  chrome.alarms.clear(id);
  if (updatedFinished.length === 0 && (finishedTimers || []).length > 0) {
    await clearFinishedState();
  }
}

async function resetTimer({ id }) {
    const { timers, finishedTimers } = await chrome.storage.local.get(["timers", "finishedTimers"]);
    if (timers[id]) {
        timers[id].remainingTime = timers[id].originalDuration;
        timers[id].isRunning = false;
        timers[id].endTime = null;
        const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);
        await chrome.storage.local.set({ timers, finishedTimers: updatedFinished });
        sendDataToSidePanel();
        if (updatedFinished.length === 0 && (finishedTimers || []).length > 0) {
            await clearFinishedState();
        }
    }
}

// --- アラームハンドラ ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
    const { timers, alarms, volume, finishedTimers } = await chrome.storage.local.get(["timers", "alarms", "volume", "finishedTimers"]);
    
    let finishedItem = null;
    let storageUpdates = {};

    if (alarm.name.startsWith('timer_')) {
        const timer = timers[alarm.name];
        if (timer) {
            timer.isRunning = false;
            timer.remainingTime = 0;
            timer.endTime = null;
            finishedItem = { id: timer.id, name: timer.name, type: 'timer' };
            storageUpdates.timers = timers;
        }
    } else if (alarm.name.startsWith('alarm_')) {
        const userAlarm = alarms[alarm.name];
        if (userAlarm && userAlarm.isActive) {
            finishedItem = { id: userAlarm.id, name: userAlarm.name, type: 'alarm' };
        }
    }

    if (finishedItem) {
        const isAlarm = finishedItem.type === 'alarm';
        if ((finishedTimers || []).length === 0) {
            playSound(volume, isAlarm);
        }
        const newFinishedList = [...(finishedTimers || []).filter(t => t.id !== finishedItem.id), finishedItem];
        storageUpdates.finishedTimers = newFinishedList;
        
        await chrome.storage.local.set(storageUpdates);
        
        sendDataToSidePanel();
        chrome.runtime.sendMessage({ command: "updateFinishedList", data: newFinishedList }).catch(e=>{});

        try {
            await chrome.action.setPopup({ popup: 'popup.html' });
            await chrome.action.openPopup();
        } catch (e) {
            if (e.message.includes("Could not find an active browser window")) {
                console.log("アクティブなウィンドウがないためポップアップを開けませんでした。フォーカス時に再試行します。");
                // 代替案としてバッジを表示
                await chrome.action.setBadgeText({ text: '!' });
                await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });

                if (!chrome.windows.onFocusChanged.hasListener(onFocusChanged)) {
                    chrome.windows.onFocusChanged.addListener(onFocusChanged);
                }
            } else {
                console.error("ポップアップを開けませんでした:", e);
            }
        }
    }
});


// --- ポップアップと音声関連 ---
async function resetFinishedTimers() {
    const { finishedTimers, timers, alarms } = await chrome.storage.local.get(["finishedTimers", "timers", "alarms"]);
    if (finishedTimers && finishedTimers.length > 0) {
        finishedTimers.forEach(finished => {
            if (finished.type === 'timer' && timers[finished.id]) {
                timers[finished.id].remainingTime = timers[finished.id].originalDuration;
            } else if (finished.type === 'alarm' && alarms[finished.id]) {
                alarms[finished.id].isActive = false;
                chrome.alarms.clear(finished.id);
            }
        });
        await chrome.storage.local.set({ timers, alarms, finishedTimers: [] });
        sendDataToSidePanel();
    }
    await clearFinishedState();
}

// ★ 新設
async function resetFinishedAlarm({ id }) {
    const { finishedTimers, alarms } = await chrome.storage.local.get(["finishedTimers", "alarms"]);
    const updatedFinished = (finishedTimers || []).filter(t => t.id !== id);

    if (alarms && alarms[id]) {
        alarms[id].isActive = false;
        chrome.alarms.clear(id);
    }

    await chrome.storage.local.set({ finishedTimers: updatedFinished, alarms });
    sendDataToSidePanel();

    if (updatedFinished.length === 0 && (finishedTimers || []).length > 0) {
        await clearFinishedState();
    }
}

function sendDataToSidePanel() {
  chrome.storage.local.get(["timers", "alarms", "finishedTimers"], ({ timers, alarms, finishedTimers }) => {
    chrome.runtime.sendMessage({ command: "updateData", data: { timers: timers || {}, alarms: alarms || {}, finishedTimers: finishedTimers || [] } })
    .catch(e => { if (!e.message.includes("Receiving end does not exist")) console.error(e); });
  });
}

// (省略された関数は変更なし)
function addTimer(data) { chrome.storage.local.get("timers", ({ timers = {} }) => { const newId = `timer_${Date.now()}`; const timerCount = Object.keys(timers).length; const durationMs = (data.minutes || 3) * 60 * 1000; timers[newId] = { id: newId, name: `タイマー ${timerCount + 1}`, originalDuration: durationMs, remainingTime: durationMs, isRunning: false, endTime: null, }; chrome.storage.local.set({ timers }, sendDataToSidePanel); }); }
function updateTimerTime({ id, totalSeconds }) { chrome.storage.local.get("timers", ({ timers = {} }) => { if (!timers[id]) return; const durationMs = totalSeconds * 1000; timers[id].originalDuration = durationMs; if (timers[id].isRunning) { const newEndTime = Date.now() + durationMs; timers[id].endTime = newEndTime; chrome.alarms.create(id, { when: newEndTime }); } else { timers[id].remainingTime = durationMs; } chrome.storage.local.set({ timers }, sendDataToSidePanel); }); }
function updateTimerName({ id, newName }) { chrome.storage.local.get("timers", ({ timers = {} }) => { if (timers[id]) { timers[id].name = newName; chrome.storage.local.set({ timers }, sendDataToSidePanel); } }); }
function pauseTimer({ id }) { chrome.storage.local.get("timers", ({ timers = {} }) => { const timer = timers[id]; if (timer && timer.isRunning) { const remaining = timer.endTime - Date.now(); timer.remainingTime = remaining > 0 ? remaining : 0; timer.isRunning = false; timer.endTime = null; chrome.alarms.clear(id); chrome.storage.local.set({ timers }, sendDataToSidePanel); } }); }
function resumeTimer({ id }) { chrome.storage.local.get("timers", ({ timers = {} }) => { const timer = timers[id]; if (timer && !timer.isRunning) { const newEndTime = Date.now() + timer.remainingTime; timer.endTime = newEndTime; timer.isRunning = true; chrome.alarms.create(id, { when: newEndTime }); chrome.storage.local.set({ timers }, sendDataToSidePanel); } }); }
function stopSound() { chrome.runtime.sendMessage({ command: 'stopSound' }).catch(e=>{}); }
function updateVolume({ volume }) { chrome.storage.local.set({ volume }); }
async function playSound(volume, loop = false) {
    const source = 'sounds/sound.mp3';
    const offscreenData = { command: 'playSound', source, volume, loop };
    if (await chrome.offscreen.hasDocument()) {
        chrome.runtime.sendMessage(offscreenData).catch(e=>{});
        return;
    }
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'タイマー終了を通知するため',
    });
    setTimeout(() => {
        chrome.runtime.sendMessage(offscreenData).catch(e=>{});
    }, 100);
}