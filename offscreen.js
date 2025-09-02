// offscreen.js
const audio = new Audio();

chrome.runtime.onMessage.addListener((request) => {
  switch (request.command) {
    case 'playSound':
      audio.src = request.source;
      audio.volume = (request.volume !== undefined) ? request.volume / 100 : 0.5;
      audio.loop = request.loop || false; // ループ設定を追加
      audio.play();
      break;
    case 'stopSound':
      audio.pause();
      audio.currentTime = 0;
      break;
  }
});
