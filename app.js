/**
 * CatGo 主应用控制器 v2
 * 整合所有模块，管理页面切换和游戏流程
 * 新增：实时胜率评价、落子评价、终止棋局菜单、棋盘尺寸选择
 */

// ===== 全局游戏状态 =====
const Game = (() => {
  let board = null;
  let history = null;
  let renderer = null;
  let ai = null;
  let currentColor = GoEngine.BLACK;
  let gameActive = false;
  let difficulty = 'intermediate';
  let hintPos = null;
  let hoverPos = null;
  let boardSize = 19;
  let winRateUpdateTimer = null;
  let lastWinRate = 50;   // 上一次胜率，用于计算变化量

  function init(diff = 'intermediate', size = 19) {
    difficulty = diff;
    boardSize = size;
    board = new GoEngine.Board(size);
    history = new GoEngine.GameHistory();
    ai = new AIEngine.GoAI(diff);
    currentColor = GoEngine.BLACK;
    gameActive = true;
    hintPos = null;
    hoverPos = null;
    lastWinRate = 50;

    // 初始化渲染器
    const canvas = document.getElementById('game-canvas');

    // 动态计算棋盘尺寸：根据可用空间自适应
    function calcCanvasSize() {
      const boardArea = document.querySelector('.game-board-area');
      if (!boardArea) return size === 19 ? 540 : size === 13 ? 420 : 320;
      const areaW = boardArea.clientWidth - 24;  // 减去padding
      const areaH = boardArea.clientHeight - 110; // 减去胜率条+状态栏
      const maxByArea = Math.min(areaW, areaH);
      // 按棋盘路数设定最小/最大值
      // 9路棋盘提升最小尺寸，确保坐标标签可见且点击舒适
      const minSize = size === 9 ? 260 : size === 13 ? 300 : 360;
      const maxSize = size === 9 ? 360 : size === 13 ? 420 : 520;
      return Math.max(minSize, Math.min(maxSize, maxByArea));
    }

    const canvasSize = calcCanvasSize();
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    // CSS尺寸与逻辑尺寸一致（避免缩放模糊）
    canvas.style.width = canvasSize + 'px';
    canvas.style.height = canvasSize + 'px';

    renderer = new Renderer.BoardRenderer(canvas, size);
    const overlay = document.getElementById('game-cats-overlay');
    overlay.style.width = canvas.width + 'px';
    overlay.style.height = canvas.height + 'px';
    renderer.setCatOverlay(overlay);
    // 注册动画重绘回调（弹性落子/表情跳动/爪印粒子需要持续重绘）
    renderer.setRenderCallback(() => renderGame());

    // 绑定事件
    canvas.onclick = handleClick;
    canvas.onmousemove = handleMouseMove;
    canvas.onmouseleave = () => {
      hoverPos = null;
      renderGame();
    };

    // 清空棋谱
    const histEl = document.getElementById('move-history');
    if (histEl) histEl.innerHTML = '';

    // 清空提示
    const hintEl = document.getElementById('hint-text');
    if (hintEl) { hintEl.textContent = ''; hintEl.classList.add('hidden'); }

    // 重置胜率显示
    updateWinRateDisplay(50, 0);
    clearMoveEval('black');
    clearMoveEval('white');

    // 初始渲染
    renderGame();
    updateUI();
    updateTurnIndicator();
    showStatus('轮到黑方落子');

    // 开始定时更新形势（每4秒）
    if (winRateUpdateTimer) clearInterval(winRateUpdateTimer);
    winRateUpdateTimer = setInterval(() => {
      if (gameActive) updateWinRate();
    }, 4000);
  }

  function handleClick(e) {
    if (!gameActive || currentColor !== GoEngine.BLACK) return;

    const rect = e.target.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (e.target.width / rect.width);
    const py = (e.clientY - rect.top) * (e.target.height / rect.height);
    const pos = renderer.toBoard(px, py);

    if (!pos) return;
    const [r, c] = pos;
    placeStone(r, c, GoEngine.BLACK);
  }

  function handleMouseMove(e) {
    if (!gameActive || currentColor !== GoEngine.BLACK) return;

    const rect = e.target.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (e.target.width / rect.width);
    const py = (e.clientY - rect.top) * (e.target.height / rect.height);
    const pos = renderer.toBoard(px, py);

    hoverPos = pos || null;
    renderGame();
  }

  async function placeStone(r, c, color) {
    if (!gameActive) return;

    // 计算落子前胜率（用于评价）
    const winRateBefore = ai ? ai.getWinRate(board) : 50;

    // 保存历史（用于悔棋）
    history.save(board);

    const result = board.place(r, c, color);
    if (!result.valid) {
      showStatus(`无效落子：${result.reason}`);
      history.snapshots.pop();
      return;
    }

    // 落子动画（涟漪+粒子）+ 音效
    if (renderer) renderer.animatePlacement(r, c, color);
    if (window.Renderer?.SoundFX) Renderer.SoundFX.place(color === GoEngine.BLACK);

    // 连接合并特效：检测新落子与哪些已有棋子相邻
    if (renderer) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      const connected = [];
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
          if (board.get(nr, nc) === color) connected.push([nr, nc]);
        }
      }
      if (connected.length > 0) renderer.animateConnection(r, c, color, connected);
    }

    // 提子动画 + 音效
    if (result.capturedStones && result.capturedStones.length > 0) {
      renderer.animateCapture(result.capturedStones);
      if (window.Renderer?.SoundFX) Renderer.SoundFX.capture(result.capturedStones.length);
    }

    // 计算落子后胜率并评价
    const winRateAfter = ai ? ai.getWinRate(board) : 50;
    const delta = winRateAfter - winRateBefore;
    showMoveEval('black', delta);
    updateWinRateDisplay(winRateAfter, delta);
    lastWinRate = winRateAfter;

    // 记录棋谱
    const cols = 'ABCDEFGHJKLMNOPQRST';
    const posStr = `${cols[c]}${boardSize - r}`;
    addMoveToHistory('黑', posStr, delta);

    hintPos = null;
    renderGame();
    updateUI();

    // 检查游戏结束
    if (board.isGameOver()) {
      endGame();
      return;
    }

    // 切换到AI回合
    currentColor = GoEngine.WHITE;
    updateTurnIndicator();
    showStatus('AI思考中...');
    document.getElementById('ai-thinking').classList.remove('hidden');

    // AI落子
    await aiMove();
  }

  async function aiMove() {
    if (!gameActive) return;

    try {
      const winRateBefore = ai ? ai.getWinRate(board) : 50;

      const result = await ai.getMove(board, GoEngine.WHITE);
      // 兼容旧接口（直接返回move）和新接口（返回{move, commentary}）
      const move = (result && typeof result === 'object' && 'move' in result) ? result.move : result;
      const commentary = (result && typeof result === 'object' && 'commentary' in result) ? result.commentary : '';

      document.getElementById('ai-thinking').classList.add('hidden');

      if (move === null) {
        // AI虚手
        board.pass(GoEngine.WHITE);
        showStatus('AI虚手');
        addMoveToHistory('白', '虚手', 0);
        showAICommentary(commentary || '虚手，暂时没有好的落子点。');
      } else {
        const [r, c] = move;
        history.save(board);
        const placeResult = board.place(r, c, GoEngine.WHITE);

        if (placeResult.valid) {
          // AI落子动画 + 音效
          if (renderer) renderer.animatePlacement(r, c, GoEngine.WHITE);
          if (window.Renderer?.SoundFX) Renderer.SoundFX.place(false);

          // AI连接合并特效
          if (renderer) {
            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            const connected = [];
            for (const [dr, dc] of dirs) {
              const nr = r + dr, nc = c + dc;
              if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
                if (board.get(nr, nc) === GoEngine.WHITE) connected.push([nr, nc]);
              }
            }
            if (connected.length > 0) renderer.animateConnection(r, c, GoEngine.WHITE, connected);
          }

          if (placeResult.capturedStones && placeResult.capturedStones.length > 0) {
            renderer.animateCapture(placeResult.capturedStones);
            if (window.Renderer?.SoundFX) Renderer.SoundFX.capture(placeResult.capturedStones.length);
          }
          const cols = 'ABCDEFGHJKLMNOPQRST';
          const posStr = `${cols[c]}${boardSize - r}`;

          // AI落子后胜率变化（对白方来说，胜率下降=好棋）
          const winRateAfter = ai ? ai.getWinRate(board) : 50;
          const delta = winRateBefore - winRateAfter; // 白方视角：黑棋胜率下降=白棋好棋
          showMoveEval('white', delta);
          updateWinRateDisplay(winRateAfter, -(delta));
          lastWinRate = winRateAfter;

          addMoveToHistory('白', posStr, delta);
          // 显示AI解说
          showAICommentary(commentary);
        }
      }

      currentColor = GoEngine.BLACK;
      renderGame();
      updateUI();
      updateTurnIndicator();

      if (board.isGameOver()) {
        endGame();
      } else {
        showStatus('轮到黑方落子');
      }
    } catch (err) {
      console.error('AI error:', err);
      document.getElementById('ai-thinking').classList.add('hidden');
      currentColor = GoEngine.BLACK;
      updateTurnIndicator();
      showStatus('轮到黑方落子');
    }
  }

  // 显示AI指导面板
  function showAICommentary(text) {
    if (!text) return;
    const el = document.getElementById('ai-commentary');
    if (!el) return;
    const textEl = el.querySelector('.ai-commentary-text');
    if (!textEl) return;

    // 解析文本中的特殊标记，分段显示
    // 🔴 = 危险警告，🟢 = 机会提示，💡 = 建议，⚠️ = 注意
    let mainText = text;
    let adviceText = '';

    // 提取建议部分（💡/🔴/🟢/⚠️ 开头的句子）
    const adviceMatch = text.match(/(🔴[^。！]*[。！]?|🟢[^。！]*[。！]?|💡[^。！]*[。！]?|⚠️[^。！]*[。！]?)$/);
    if (adviceMatch) {
      adviceText = adviceMatch[1];
      mainText = text.slice(0, text.length - adviceText.length).trim();
    }

    // 构建 HTML
    let html = `<span class="commentary-main">${mainText}</span>`;
    if (adviceText) {
      const isWarning = adviceText.startsWith('🔴') || adviceText.startsWith('⚠️');
      const isOpportunity = adviceText.startsWith('🟢');
      const cls = isWarning ? 'commentary-warning' : isOpportunity ? 'commentary-opportunity' : 'commentary-advice';
      html += `<span class="${cls}">${adviceText}</span>`;
    }
    textEl.innerHTML = html;

    // 先清除所有状态类，再强制重排，再添加动画
    el.classList.remove('fade-in', 'fade-out', 'hidden');
    void el.offsetWidth;
    el.classList.add('fade-in');

    // 根据内容长度决定显示时间（有建议时显示更久）
    const displayTime = adviceText ? 14000 : 10000;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.classList.remove('fade-in');
      el.classList.add('fade-out');
      setTimeout(() => {
        el.classList.remove('fade-out');
        el.classList.add('hidden');
      }, 600);
    }, displayTime);
  }

  function pass() {
    if (!gameActive || currentColor !== GoEngine.BLACK) return;

    history.save(board);
    board.pass(GoEngine.BLACK);
    addMoveToHistory('黑', '虚手', 0);
    if (window.Renderer?.SoundFX) Renderer.SoundFX.pass();
    renderGame();
    updateUI();

    if (board.isGameOver()) {
      endGame();
      return;
    }

    currentColor = GoEngine.WHITE;
    updateTurnIndicator();
    showStatus('AI思考中...');
    document.getElementById('ai-thinking').classList.remove('hidden');

    setTimeout(() => aiMove(), 500);
  }

  function resign() {
    if (!gameActive) return;
    // 关闭结束菜单
    document.getElementById('end-game-menu').classList.add('hidden');
    gameActive = false;
    if (winRateUpdateTimer) clearInterval(winRateUpdateTimer);
    showResult('😿', '认输', '您选择了认输，白棋获胜', '白棋胜（认输）');
  }

  function requestCount() {
    if (!gameActive) return;
    document.getElementById('end-game-menu').classList.add('hidden');
    endGame();
  }

  function undo() {
    if (!gameActive) return;

    // 需要悔两步（黑棋和AI的白棋）
    let undone = 0;
    if (history.restore(board)) {
      undone++;
      if (history.restore(board)) {
        undone++;
      }
    }

    if (undone > 0) {
      currentColor = GoEngine.BLACK;
      hintPos = null;
      renderGame();
      updateUI();
      updateTurnIndicator();
      showStatus('已悔棋');

      // 移除棋谱最后几条
      const histEl = document.getElementById('move-history');
      for (let i = 0; i < undone; i++) {
        if (histEl.lastChild) histEl.removeChild(histEl.lastChild);
      }

      // 重新计算胜率
      if (ai) {
        const wr = ai.getWinRate(board);
        updateWinRateDisplay(wr, 0);
        lastWinRate = wr;
      }
    } else {
      showStatus('无法悔棋');
    }
  }

  async function requestHint() {
    if (!gameActive || currentColor !== GoEngine.BLACK) return;

    const hintEl = document.getElementById('hint-text');
    hintEl.textContent = '🐱 思考中...';
    hintEl.classList.remove('hidden');

    const hintResult = await ai.getHint(board, GoEngine.BLACK);
    // 兼容旧接口（直接返回move）和新接口（返回{move, commentary}）
    const move = (hintResult && typeof hintResult === 'object' && 'move' in hintResult) ? hintResult.move : hintResult;
    const commentary = (hintResult && typeof hintResult === 'object' && 'commentary' in hintResult) ? hintResult.commentary : '';

    if (move) {
      hintPos = move;
      const cols = 'ABCDEFGHJKLMNOPQRST';
      const posStr = `${cols[move[1]]}${boardSize - move[0]}`;
      hintEl.textContent = `💡 建议落子：${posStr}`;
      renderGame();

      // 生成更丰富的指导信息
      if (commentary) {
        // 获取局势分析作为补充
        let fullGuide = `💡 建议落子 ${posStr}：${commentary}`;
        showAICommentary(fullGuide);
      } else {
        // 即使没有 commentary 也生成基础指导
        const guide = _generateHintGuide(move, board);
        if (guide) showAICommentary(guide);
      }
    } else {
      hintEl.textContent = '💡 建议虚手（当前无好点）';
      showAICommentary('💡 当前局面建议虚手，等待对方出错或整理自身棋形。');
    }
  }

  // 为提示落子生成指导说明
  function _generateHintGuide(move, board) {
    if (!move || !board) return '';
    const cols = 'ABCDEFGHJKLMNOPQRST';
    const posStr = `${cols[move[1]]}${boardSize - move[0]}`;
    const [r, c] = move;
    const size = board.size || boardSize;
    const center = Math.floor(size / 2);

    // 判断落子区域
    let region = '';
    const isTop = r < size / 3;
    const isBottom = r > size * 2 / 3;
    const isLeft = c < size / 3;
    const isRight = c > size * 2 / 3;
    if (isTop && isLeft) region = '左上角';
    else if (isTop && isRight) region = '右上角';
    else if (isBottom && isLeft) region = '左下角';
    else if (isBottom && isRight) region = '右下角';
    else if (isTop) region = '上边';
    else if (isBottom) region = '下边';
    else if (isLeft) region = '左边';
    else if (isRight) region = '右边';
    else region = '中腹';

    // 检查周围是否有己方棋子（连接）
    const neighbors = [[-1,0],[1,0],[0,-1],[0,1]];
    let friendlyNearby = 0;
    let enemyNearby = 0;
    for (const [dr, dc] of neighbors) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
        const cell = board.grid[nr][nc];
        if (cell === GoEngine.BLACK) friendlyNearby++;
        else if (cell === GoEngine.WHITE) enemyNearby++;
      }
    }

    let reason = '';
    if (enemyNearby >= 2) reason = '此点可压制白棋，减少对方气数';
    else if (friendlyNearby >= 2) reason = '此点可加强己方棋形，增加连接';
    else if (friendlyNearby === 1 && enemyNearby === 1) reason = '此点是关键争夺点，先手占据有利';
    else if (region === '中腹') reason = '占据中腹要点，扩大势力范围';
    else reason = `占据${region}要点，布局有利`;

    return `💡 建议落子 ${posStr}（${region}）：${reason}。`;
  }

  function renderGame() {
    if (!renderer || !board) return;
    renderer.render(board, {
      hoverPos,
      hintPos,
      currentColor
    });
  }

  function updateUI() {
    if (!board) return;

    // 更新提子数
    document.getElementById('black-captures').textContent = board.captures[GoEngine.BLACK];
    document.getElementById('white-captures').textContent = board.captures[GoEngine.WHITE];

    // 更新猫咪气显示
    const blackGroups = board.getAllGroupsInfo(GoEngine.BLACK);
    const whiteGroups = board.getAllGroupsInfo(GoEngine.WHITE);

    Renderer.updateSidebarCats(blackGroups, 'black-cat-display');
    Renderer.updateSidebarCats(whiteGroups, 'white-cat-display');

    // 气=1时播放警告音（每次落子最多触发一次）
    const hasAtari = [...blackGroups, ...whiteGroups].some(g => g.libs === 1);
    if (window.Renderer?.SoundFX && hasAtari) Renderer.SoundFX.warning();

    // 通知渲染器是否有危险棋子（驱动虚线圆圈持续动画）
    if (renderer) renderer.setHasDangerStones(hasAtari);
  }

  function updateTurnIndicator() {
    const blackDot = document.getElementById('black-turn-dot');
    const whiteDot = document.getElementById('white-turn-dot');
    const blackCard = document.getElementById('black-player-card');
    const whiteCard = document.getElementById('white-player-card');

    if (currentColor === GoEngine.BLACK) {
      blackDot && blackDot.classList.add('active');
      whiteDot && whiteDot.classList.remove('active');
      blackCard && blackCard.classList.add('active');
      whiteCard && whiteCard.classList.remove('active');
    } else {
      blackDot && blackDot.classList.remove('active');
      whiteDot && whiteDot.classList.add('active');
      blackCard && blackCard.classList.remove('active');
      whiteCard && whiteCard.classList.add('active');
    }
  }

  function showStatus(msg) {
    const el = document.getElementById('game-status');
    if (el) el.textContent = msg;
  }

  function addMoveToHistory(color, pos, delta) {
    const histEl = document.getElementById('move-history');
    if (!histEl) return;

    const entry = document.createElement('div');
    const moveNum = board.moveHistory.length;

    let evalClass = '';
    let evalIcon = '';
    if (delta !== 0) {
      if (delta >= 8) { evalClass = 'great-move'; evalIcon = '⭐'; }
      else if (delta >= 3) { evalClass = 'good-move'; evalIcon = '✓'; }
      else if (delta <= -8) { evalClass = 'bad-move'; evalIcon = '✗'; }
      else if (delta <= -3) { evalClass = 'poor-move'; evalIcon = '△'; }
    }

    entry.className = `move-entry ${evalClass}`;
    entry.innerHTML = `<span class="move-num">${moveNum}</span><span>${color}: ${pos}</span>${evalIcon ? `<span class="move-eval-icon">${evalIcon}</span>` : ''}`;
    histEl.appendChild(entry);
    histEl.scrollTop = histEl.scrollHeight;
  }

  // ===== 胜率相关 =====

  function updateWinRate() {
    if (!board || !ai || !gameActive) return;
    const wr = ai.getWinRate(board);
    updateWinRateDisplay(wr, wr - lastWinRate);
    lastWinRate = wr;
  }

  function updateWinRateDisplay(blackWinRate, delta) {
    // 顶部胜率条
    const blackFill = document.getElementById('wr-black-fill');
    const blackPct = document.getElementById('wr-black-pct');
    const whitePct = document.getElementById('wr-white-pct');
    const deltaEl = document.getElementById('wr-delta');

    if (blackFill) blackFill.style.width = `${blackWinRate}%`;
    if (blackPct) blackPct.textContent = `${Math.round(blackWinRate)}%`;
    if (whitePct) whitePct.textContent = `${Math.round(100 - blackWinRate)}%`;

    // 变化量显示
    if (deltaEl && delta !== 0) {
      const absDelta = Math.abs(delta);
      if (absDelta >= 2) {
        const sign = delta > 0 ? '+' : '';
        const who = delta > 0 ? '黑' : '白';
        deltaEl.textContent = `${who}方 ${sign}${Math.round(delta)}%`;
        deltaEl.className = `wr-delta ${delta > 0 ? 'positive' : 'negative'}`;
        // 3秒后清除
        setTimeout(() => {
          if (deltaEl) deltaEl.textContent = '';
          if (deltaEl) deltaEl.className = 'wr-delta';
        }, 3000);
      }
    }

    // 侧边栏玩家卡片胜率
    const blackWrText = document.getElementById('black-winrate-text');
    const whiteWrText = document.getElementById('white-winrate-text');
    const blackWrBar = document.getElementById('black-winrate-bar');
    const whiteWrBar = document.getElementById('white-winrate-bar');

    if (blackWrText) blackWrText.textContent = `${Math.round(blackWinRate)}%`;
    if (whiteWrText) whiteWrText.textContent = `${Math.round(100 - blackWinRate)}%`;
    if (blackWrBar) blackWrBar.style.width = `${blackWinRate}%`;
    if (whiteWrBar) whiteWrBar.style.width = `${100 - blackWinRate}%`;
  }

  function showMoveEval(side, delta) {
    const evalEl = document.getElementById(`${side}-move-eval`);
    if (!evalEl) return;

    let text = '', cls = 'neutral';
    const absDelta = Math.abs(delta);

    if (absDelta < 2) {
      text = '平稳落子'; cls = 'neutral';
    } else if (delta >= 10) {
      text = '⭐ 绝妙好棋！'; cls = 'great';
    } else if (delta >= 5) {
      text = '✓ 好棋'; cls = 'good';
    } else if (delta >= 2) {
      text = '↑ 略有优势'; cls = 'good';
    } else if (delta <= -10) {
      text = '✗ 严重失误！'; cls = 'bad';
    } else if (delta <= -5) {
      text = '△ 明显失误'; cls = 'bad';
    } else if (delta <= -2) {
      text = '↓ 略有损失'; cls = 'bad';
    }

    evalEl.textContent = text;
    evalEl.className = `move-eval ${cls}`;

    // 4秒后淡出
    clearTimeout(evalEl._timer);
    evalEl._timer = setTimeout(() => {
      evalEl.textContent = '';
      evalEl.className = 'move-eval';
    }, 4000);
  }

  function clearMoveEval(side) {
    const evalEl = document.getElementById(`${side}-move-eval`);
    if (evalEl) { evalEl.textContent = ''; evalEl.className = 'move-eval'; }
  }

  // ===== 游戏结束 =====

  function endGame() {
    gameActive = false;
    if (winRateUpdateTimer) clearInterval(winRateUpdateTimer);

    const score = board.countScore();
    const blackTotal = score.black;
    const whiteTotal = score.white + score.komi;

    let winner, icon, message, winnerColor;
    if (blackTotal > whiteTotal) {
      winner = '黑棋';
      icon = '🎉';
      message = '恭喜您获胜！继续保持！';
      winnerColor = GoEngine.BLACK;
    } else {
      winner = '白棋';
      icon = '😿';
      message = '继续努力，下次一定能赢！';
      winnerColor = GoEngine.WHITE;
    }

    // 胜利庆祝动画
    if (renderer) {
      setTimeout(() => renderer.animateVictory(winnerColor), 300);
    }

    const diff = Math.abs(blackTotal - whiteTotal).toFixed(1);
    const scoreStr = `黑棋 ${blackTotal.toFixed(1)} 目 vs 白棋 ${whiteTotal.toFixed(1)} 目（含贴目${score.komi}）`;
    const winStr = `${winner}胜 ${diff} 目`;

    // 填充结果胜率回顾
    const finalWr = ai ? ai.getWinRate(board) : (blackTotal > whiteTotal ? 70 : 30);
    const resultWrEl = document.getElementById('result-winrate');
    if (resultWrEl) {
      resultWrEl.innerHTML = `
        <div style="font-size:.8rem;color:var(--text-secondary);margin-bottom:6px;">最终形势</div>
        <div class="result-winrate-bar">
          <div class="result-winrate-fill" style="--black-pct:${Math.round(finalWr)}%"></div>
        </div>
        <div class="result-winrate-labels">
          <span>黑 ${Math.round(finalWr)}%</span>
          <span>白 ${Math.round(100 - finalWr)}%</span>
        </div>`;
    }

    showResult(icon, winStr, message, scoreStr);
  }

  function showResult(icon, title, message, score) {
    document.getElementById('result-icon').textContent = icon;
    document.getElementById('result-title').textContent = title;
    document.getElementById('result-message').textContent = message;
    document.getElementById('result-score').textContent = score;
    document.getElementById('result-modal').classList.remove('hidden');
  }

  return {
    init,
    pass,
    resign,
    requestCount,
    undo,
    requestHint,
    renderGame
  };
})();

// ===== 水平测试控制器 =====
const AssessmentController = (() => {
  let assessment = null;
  let problemCanvas = null;
  let waitingForNext = false;
  let currentHover = null;   // 当前悬停坐标 [r,c]

  // 将 canvas 像素坐标转换为棋盘 [r,c]
  function _pixelToBoard(canvas, px, py, size) {
    const W = canvas.width;
    const COORD_MARGIN = Math.round(W * 0.072);
    const boardLeft = COORD_MARGIN;
    const boardTop  = COORD_MARGIN;
    const boardW    = W - COORD_MARGIN * 2;
    const cellSize  = boardW / (size - 1);

    const c = Math.round((px - boardLeft) / cellSize);
    const r = Math.round((py - boardTop)  / cellSize);

    if (r < 0 || r >= size || c < 0 || c >= size) return null;
    return [r, c];
  }

  function start() {
    assessment = new Problems.Assessment();
    waitingForNext = false;
    showProblem();
  }

  function showProblem() {
    if (assessment.isComplete()) {
      showResults();
      return;
    }

    const problem = assessment.getCurrentProblem();
    const total = assessment.getTotalProblems();
    const current = assessment.currentIndex + 1;

    document.getElementById('progress-fill').style.width = `${(current / total) * 100}%`;
    document.getElementById('progress-text').textContent = `第 ${current} / ${total} 题`;
    document.getElementById('assessment-title').textContent =
      problem.type === 'tsumego' ? '死活题' : '手筋题';

    const badge = document.getElementById('problem-type-badge');
    badge.textContent = problem.type === 'tsumego' ? '死活题' : '手筋题';
    badge.className = `problem-badge ${problem.type}`;

    document.getElementById('problem-description').textContent = problem.question;

    // 绘制棋盘（含坐标标注）
    problemCanvas = document.getElementById('problem-canvas');
    currentHover = null;
    Problems.drawProblemBoard(problemCanvas, problem);

    // 隐藏旧的文字按钮区域
    const optionsEl = document.getElementById('assessment-options');
    if (optionsEl) optionsEl.innerHTML = '';

    // 显示交互提示
    const hintEl = document.getElementById('board-click-hint');
    if (hintEl) {
      if (problem.isPassCorrect) {
        hintEl.textContent = '点击棋盘落子，或点击下方"虚手"按钮';
      } else {
        const colorText = problem.playerColor === 'W' ? '白棋' : '黑棋';
        hintEl.textContent = `请点击棋盘，落下${colorText}`;
      }
      hintEl.classList.remove('hidden');
    }

    // 显示/隐藏虚手按钮
    const passBtn = document.getElementById('assessment-pass-btn');
    if (passBtn) {
      passBtn.style.display = problem.isPassCorrect ? 'inline-flex' : 'none';
      passBtn.onclick = () => submitAnswer(null);
    }

    // 清空反馈
    const feedback = document.getElementById('assessment-feedback');
    feedback.className = 'assessment-feedback hidden';
    feedback.textContent = '';

    waitingForNext = false;

    // ── 绑定棋盘交互事件 ──
    // 先移除旧监听，避免重复绑定
    problemCanvas.onclick = null;
    problemCanvas.onmousemove = null;
    problemCanvas.onmouseleave = null;

    problemCanvas.onmousemove = (e) => {
      if (waitingForNext) return;
      const rect = problemCanvas.getBoundingClientRect();
      const scaleX = problemCanvas.width  / rect.width;
      const scaleY = problemCanvas.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top)  * scaleY;
      const pos = _pixelToBoard(problemCanvas, px, py, problem.boardSize);

      // 只在空点上显示预览（不覆盖已有棋子）
      const occupied = pos && problem.stones.some(s => s.r === pos[0] && s.c === pos[1]);
      currentHover = (pos && !occupied) ? pos : null;
      Problems.drawProblemBoard(problemCanvas, problem, { hoverStone: currentHover });
    };

    problemCanvas.onmouseleave = () => {
      currentHover = null;
      Problems.drawProblemBoard(problemCanvas, problem);
    };

    problemCanvas.onclick = (e) => {
      if (waitingForNext) return;
      const rect = problemCanvas.getBoundingClientRect();
      const scaleX = problemCanvas.width  / rect.width;
      const scaleY = problemCanvas.height / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top)  * scaleY;
      const pos = _pixelToBoard(problemCanvas, px, py, problem.boardSize);

      if (!pos) return;
      const [r, c] = pos;
      // 不允许落在已有棋子上
      if (problem.stones.some(s => s.r === r && s.c === c)) return;
      submitAnswer([r, c]);
    };

    // 触摸支持
    problemCanvas.ontouchend = (e) => {
      if (waitingForNext) return;
      e.preventDefault();
      const touch = e.changedTouches[0];
      const rect = problemCanvas.getBoundingClientRect();
      const scaleX = problemCanvas.width  / rect.width;
      const scaleY = problemCanvas.height / rect.height;
      const px = (touch.clientX - rect.left) * scaleX;
      const py = (touch.clientY - rect.top)  * scaleY;
      const pos = _pixelToBoard(problemCanvas, px, py, problem.boardSize);
      if (!pos) return;
      const [r, c] = pos;
      if (problem.stones.some(s => s.r === r && s.c === c)) return;
      submitAnswer([r, c]);
    };
  }

  /**
   * 提交答案
   * @param {number[]|null} clickedPos - 点击坐标 [r,c]，null 表示虚手
   */
  function submitAnswer(clickedPos) {
    if (waitingForNext) return;
    waitingForNext = true;

    // 解绑交互（防止重复点击）
    if (problemCanvas) {
      problemCanvas.onmousemove = null;
      problemCanvas.onmouseleave = null;
      problemCanvas.onclick = null;
      problemCanvas.ontouchend = null;
    }

    const result = assessment.submitAnswer(clickedPos);
    const problem = assessment.getCurrentProblem();

    // 在棋盘上绘制落子 + 答案高亮
    const answerStone = {
      pos: result.correctAnswer,
      correct: result.correct,
    };
    // 如果玩家点击了某个位置，先把玩家的落子画上去
    const playerStone = clickedPos ? {
      r: clickedPos[0], c: clickedPos[1],
      color: problem.playerColor || 'B'
    } : null;

    const displayProblem = playerStone
      ? { ...problem, stones: [...problem.stones, playerStone] }
      : problem;

    Problems.drawProblemBoard(problemCanvas, displayProblem, { answerStone });

    // 隐藏提示文字
    const hintEl = document.getElementById('board-click-hint');
    if (hintEl) hintEl.classList.add('hidden');

    // 隐藏虚手按钮
    const passBtn = document.getElementById('assessment-pass-btn');
    if (passBtn) passBtn.style.display = 'none';

    // 显示反馈
    const feedback = document.getElementById('assessment-feedback');
    feedback.className = `assessment-feedback ${result.correct ? 'correct' : 'wrong'}`;
    feedback.textContent = result.correct
      ? `✓ 正确！${result.explanation}`
      : `✗ 错误。${result.explanation}`;

    setTimeout(() => {
      if (assessment.nextProblem()) showProblem();
      else showResults();
    }, 2800);
  }

  function showResults() {
    const results = assessment.getResults();

    // 难度名称映射（新档位）
    const diffNameMap = {
      beginner:     '10级猫',
      elementary:   '7级猫',
      intermediate: '5级猫',
      advanced:     '3级猫',
      expert:       '1级猫',
      master:       '1段猫'
    };
    const recName = diffNameMap[results.recommendedDifficulty] || results.recommendedDifficulty;

    const content = document.getElementById('assessment-result-content');
    content.innerHTML = `
      <div class="assessment-score-display">${results.correctCount}/${results.totalProblems}</div>
      <div class="assessment-level-display">估计水平：${results.level}</div>
      <p style="color: var(--text-secondary); margin-bottom: 16px;">${results.levelDesc}</p>
      <div class="assessment-breakdown">
        <div class="breakdown-item">
          <div class="breakdown-label">死活题</div>
          <div class="breakdown-value">${results.tsumegoCorrect}/10</div>
        </div>
        <div class="breakdown-item">
          <div class="breakdown-label">手筋题</div>
          <div class="breakdown-value">${results.tesujiCorrect}/10</div>
        </div>
      </div>
      <p style="color: var(--accent-pink); font-size:.85rem; margin-top:8px;">推荐对手：${recName}</p>
    `;

    window._recommendedDifficulty = results.recommendedDifficulty;
    document.getElementById('assessment-result-modal').classList.remove('hidden');
  }

  return { start, showProblem };
})();

// ===== 主应用控制器 =====
const App = (() => {
  // 每个难度独立记忆棋盘尺寸
  const diffSizeMap = {
    beginner: 9,
    elementary: 19,
    intermediate: 19,
    advanced: 19,
    expert: 19,
    master: 19
  };

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
  }

  function goHome() {
    document.getElementById('result-modal').classList.add('hidden');
    document.getElementById('assessment-result-modal').classList.add('hidden');
    document.getElementById('end-game-menu').classList.add('hidden');
    showScreen('splash-screen');
  }

  function startGame() {
    document.getElementById('result-modal').classList.add('hidden');
    showScreen('difficulty-screen');
    if (window._recommendedDifficulty) {
      highlightRecommendedDifficulty(window._recommendedDifficulty);
    }
  }

  function highlightRecommendedDifficulty(diff) {
    document.querySelectorAll('.difficulty-card').forEach(card => {
      card.classList.remove('recommended');
      const badge = card.querySelector('.recommended-badge');
      if (badge) badge.remove();
    });
    const card = document.getElementById(`card-${diff}`);
    if (card) {
      card.classList.add('recommended');
      const badge = document.createElement('div');
      badge.className = 'recommended-badge';
      badge.style.cssText = `
        position:absolute;top:-8px;right:-8px;
        background:var(--accent-pink);color:white;
        font-size:.7rem;padding:2px 8px;border-radius:10px;
        font-weight:700;pointer-events:none;z-index:1;
      `;
      badge.textContent = '推荐';
      card.appendChild(badge);
    }
  }

  function startAssessment() {
    showScreen('assessment-screen');
    AssessmentController.start();
  }

  // 设置某难度的棋盘尺寸（通用）
  function setSize(diff, size, event) {
    if (event) event.stopPropagation();
    diffSizeMap[diff] = size;
    // 只更新该难度卡片内的按钮
    const card = document.getElementById(`card-${diff}`);
    if (card) {
      card.querySelectorAll('.size-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.size) === size);
      });
    }
  }

  // 统一入口：用该难度当前选中的棋盘尺寸开始游戏
  function startWithDiff(diff) {
    window._recommendedDifficulty = null;
    const size = diffSizeMap[diff] || 19;
    showScreen('game-screen');
    setTimeout(() => Game.init(diff, size), 100);
  }

  // 兼容旧调用
  function selectDifficulty(diff) { startWithDiff(diff); }
  function selectDifficultyDirect(diff) { startWithDiff(diff); }
  function setBoardSize(size, event) { setSize('beginner', size, event); }

  function goToDifficulty() {
    document.getElementById('assessment-result-modal').classList.add('hidden');
    showScreen('difficulty-screen');
    if (window._recommendedDifficulty) {
      highlightRecommendedDifficulty(window._recommendedDifficulty);
    }
  }

  function showRules() {
    showScreen('rules-screen');
    setTimeout(() => Renderer.drawDemoBoard('demo-canvas-1'), 100);
  }

  function showEndGameMenu() {
    document.getElementById('end-game-menu').classList.remove('hidden');
  }

  function hideEndGameMenu() {
    document.getElementById('end-game-menu').classList.add('hidden');
  }

  return {
    goHome, startGame, startAssessment,
    setSize, startWithDiff,
    selectDifficulty, selectDifficultyDirect, setBoardSize,
    goToDifficulty, showRules,
    showEndGameMenu, hideEndGameMenu
  };
})();

// ===== 启动屏 Canvas 特效 =====
const SplashScreen = (() => {
  let starsAnimId = null;
  let stars = [];

  /**
   * 绘制启动屏 Logo 猫咪（黑猫/白猫）
   * 使用 renderer.js 中的 _drawCatFace 函数（通过 Renderer 模块暴露）
   */
  function drawLogoCats() {
    const blackCanvas = document.getElementById('logo-cat-black');
    const whiteCanvas = document.getElementById('logo-cat-white');
    if (!blackCanvas || !whiteCanvas) return;

    // 绘制黑猫（relax 表情）
    _drawLogoCat(blackCanvas, true);
    // 绘制白猫（relax 表情）
    _drawLogoCat(whiteCanvas, false);
  }

  function _drawLogoCat(canvas, isBlack) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // 用切图绘制：black-relax / white-relax
    const key = (isBlack ? 'black' : 'white') + '-relax';
    const img = new Image();
    img.src = 'assets/stone-' + key + '.png';
    const doDraw = () => {
      ctx.clearRect(0, 0, W, H);
      // 切图是正方形，内容是宽扁猫头，居中绘制
      ctx.drawImage(img, 0, 0, W, H);
    };
    if (img.complete && img.naturalWidth > 0) {
      doDraw();
    } else {
      img.onload = doDraw;
    }
  }

  function _drawLogoEar(ctx, x1, y1, x2, y2, x3, y3, fill, stroke, innerFill) {
    const mx = (x2 + x3) / 2, my = (y2 + y3) / 2;
    const R  = Math.hypot(x3 - x2, y3 - y2) / 2;
    const outDx = mx - x1, outDy = my - y1;
    const outLen = Math.hypot(outDx, outDy) || 1;
    const nx = outDx / outLen, ny = outDy / outLen;
    const tipX = mx + nx * R * 1.6, tipY = my + ny * R * 1.6;
    const cp1x = x2 + (tipX - x2) * 0.75, cp1y = y2 + (tipY - y2) * 0.75;
    const cp2x = x3 + (tipX - x3) * 0.75, cp2y = y3 + (tipY - y3) * 0.75;
    ctx.save();
    ctx.fillStyle = fill; ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3);
    ctx.lineTo(x2, y2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (innerFill) {
      const bx = 0.125*x2 + 0.375*cp1x + 0.375*cp2x + 0.125*x3;
      const by = 0.125*y2 + 0.375*cp1y + 0.375*cp2y + 0.125*y3;
      ctx.fillStyle = innerFill;
      ctx.beginPath(); ctx.arc(bx, by, R * 0.42, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 降级猫脸（不依赖 renderer）
  function _drawSimpleCatFace(ctx, cx, cy, r, isBlack) {
    const mainColor = isBlack ? 'rgba(235,228,215,0.95)' : 'rgba(45,38,30,0.90)';
    const hlColor   = isBlack ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.90)';
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const eyeY = cy - r * 0.14, eyeXL = cx - r * 0.28, eyeXR = cx + r * 0.28, eyeR = r * 0.24;
    for (const ex of [eyeXL, eyeXR]) {
      ctx.fillStyle = mainColor;
      ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hlColor;
      ctx.beginPath(); ctx.arc(ex - eyeR*0.28, eyeY - eyeR*0.28, eyeR*0.32, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + eyeR*0.18, eyeY + eyeR*0.12, eyeR*0.14, 0, Math.PI*2); ctx.fill();
    }
    const noseY = cy + r * 0.06, noseSize = r * 0.08;
    ctx.fillStyle = isBlack ? 'rgba(255,160,180,0.85)' : 'rgba(220,80,120,0.80)';
    ctx.beginPath();
    ctx.moveTo(cx, noseY - noseSize*0.5);
    ctx.lineTo(cx - noseSize, noseY + noseSize*0.5);
    ctx.lineTo(cx + noseSize, noseY + noseSize*0.5);
    ctx.closePath(); ctx.fill();
    const mouthY = cy + r * 0.20;
    ctx.strokeStyle = mainColor; ctx.lineWidth = Math.max(r * 0.10, 1.0);
    ctx.beginPath();
    ctx.moveTo(cx - r*0.18, mouthY - r*0.01);
    ctx.quadraticCurveTo(cx - r*0.07, mouthY + r*0.12, cx, mouthY + r*0.02);
    ctx.quadraticCurveTo(cx + r*0.07, mouthY + r*0.12, cx + r*0.18, mouthY - r*0.01);
    ctx.stroke();
    if (r > 8) {
      ctx.strokeStyle = isBlack ? 'rgba(235,228,215,0.55)' : 'rgba(45,38,30,0.45)';
      ctx.lineWidth = Math.max(r * 0.055, 0.6);
      const whiskerY = cy + r * 0.10, whiskerLen = r * 0.38;
      const angs = [-0.15, 0, 0.15];
      for (const ang of angs) {
        ctx.beginPath(); ctx.moveTo(cx - r*0.12, whiskerY + ang*r*0.5); ctx.lineTo(cx - r*0.12 - whiskerLen, whiskerY + ang*r*0.5 + Math.sin(ang)*r*0.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + r*0.12, whiskerY + ang*r*0.5); ctx.lineTo(cx + r*0.12 + whiskerLen, whiskerY + ang*r*0.5 + Math.sin(ang)*r*0.1); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * 初始化星空粒子背景
   */
  function initStars() {
    const canvas = document.getElementById('splash-stars');
    if (!canvas) return;

    function resize() {
      canvas.width  = canvas.offsetWidth  || window.innerWidth;
      canvas.height = canvas.offsetHeight || window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // 生成星星
    stars = [];
    const count = 120;
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.5 + Math.random() * 1.8,
        alpha: 0.2 + Math.random() * 0.8,
        speed: 0.3 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
        // 少量彩色星星
        color: Math.random() < 0.15
          ? (Math.random() < 0.5 ? '#e2b96f' : '#ff6b9d')
          : '#ffffff',
      });
    }

    // 生成流星
    const meteors = [];
    function spawnMeteor() {
      if (meteors.length < 3) {
        meteors.push({
          x: Math.random() * 0.7 + 0.1,
          y: Math.random() * 0.3,
          len: 0.08 + Math.random() * 0.12,
          speed: 0.0008 + Math.random() * 0.0012,
          alpha: 0,
          phase: 0, // 0=淡入 1=移动 2=淡出
          t: 0,
        });
      }
      setTimeout(spawnMeteor, 2000 + Math.random() * 4000);
    }
    setTimeout(spawnMeteor, 1500);

    const ctx = canvas.getContext('2d');
    let lastTime = 0;

    function animate(ts) {
      starsAnimId = requestAnimationFrame(animate);
      const dt = Math.min(ts - lastTime, 50);
      lastTime = ts;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const W = canvas.width, H = canvas.height;

      // 绘制星星（闪烁）
      for (const s of stars) {
        const flicker = s.alpha * (0.6 + 0.4 * Math.sin(ts / (800 / s.speed) + s.phase));
        ctx.save();
        ctx.globalAlpha = flicker;
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = s.r > 1.2 ? 4 : 0;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 绘制流星
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.t += dt * m.speed;
        m.x += dt * m.speed * 0.8;
        m.y += dt * m.speed * 0.5;

        let alpha;
        if (m.t < 0.2) alpha = m.t / 0.2;
        else if (m.t < 0.7) alpha = 1;
        else if (m.t < 1.0) alpha = (1 - m.t) / 0.3;
        else { meteors.splice(i, 1); continue; }

        const x1 = m.x * W, y1 = m.y * H;
        const x2 = x1 - m.len * W * 0.7, y2 = y1 - m.len * H * 0.4;
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.9})`);
        grad.addColorStop(0.3, `rgba(226,185,111,${alpha * 0.5})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
      }
    }

    requestAnimationFrame(animate);
  }

  function stop() {
    if (starsAnimId) { cancelAnimationFrame(starsAnimId); starsAnimId = null; }
  }

  return { drawLogoCats, initStars, stop };
})();

// ===== 难度选择屏猫咪 Canvas =====
const DiffCats = (() => {
  /**
   * 每个难度的猫咪配置：
   * stoneColor: 棋子颜色（渐变起止）
   * eyeStyle: 'normal'|'wide'|'slit'|'star'|'fierce'|'glow'
   * accessory: null|'bow'|'glasses'|'crown'|'scarf'|'halo'
   * auraColor: 光晕颜色
   */
  const DIFF_CONFIG = {
    beginner:     { isBlack: false, eyeStyle: 'wide',   accessory: 'bow',     auraColor: 'rgba(100,220,180,0.25)', mood: 'relax' },
    elementary:   { isBlack: false, eyeStyle: 'normal', accessory: 'scarf',   auraColor: 'rgba(100,180,255,0.25)', mood: 'okay'  },
    intermediate: { isBlack: true,  eyeStyle: 'slit',   accessory: 'glasses', auraColor: 'rgba(200,160,255,0.25)', mood: 'okay'  },
    advanced:     { isBlack: true,  eyeStyle: 'fierce', accessory: null,      auraColor: 'rgba(255,180,80,0.30)',  mood: 'cry'   },
    expert:       { isBlack: true,  eyeStyle: 'fierce', accessory: 'crown',   auraColor: 'rgba(255,120,80,0.30)',  mood: 'panic' },
    master:       { isBlack: true,  eyeStyle: 'glow',   accessory: 'halo',    auraColor: 'rgba(255,220,60,0.40)',  mood: 'panic' },
  };

  function drawDiffCat(canvasId, diffKey) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const cfg = DIFF_CONFIG[diffKey];
    if (!cfg) return;

    ctx.clearRect(0, 0, W, H);

    // ── 用切图绘制猫咪主体 ──
    const mood = cfg.mood || 'relax';
    const colorKey = cfg.isBlack ? 'black' : 'white';
    const imgKey = colorKey + '-' + mood;
    const img = new Image();
    img.src = 'assets/stone-' + imgKey + '.png';

    const doDraw = () => {
      ctx.clearRect(0, 0, W, H);
      // 切图是正方形1024×1024，内容是宽扁猫头，居中绘制
      ctx.drawImage(img, 0, 0, W, H);
      // ── 配饰叠加在切图上方 ──
      const SW = W * 0.42;
      _drawAccessory(ctx, cx, cy, Math.min(SW, SW * 0.86), cfg.accessory, cfg.isBlack);
    };

    if (img.complete && img.naturalWidth > 0) {
      doDraw();
    } else {
      img.onload = doDraw;
    }
  }

  /** 扁平耳朵绘制（与 renderer.js 的 _drawEar 逻辑一致）*/
  function _drawDiffEar(ctx, x1, y1, x2, y2, x3, y3, fill, stroke, innerFill) {
    const mx = (x2 + x3) / 2, my = (y2 + y3) / 2;
    const R  = Math.hypot(x3 - x2, y3 - y2) / 2;
    const outDx = mx - x1, outDy = my - y1;
    const outLen = Math.hypot(outDx, outDy) || 1;
    const nx = outDx / outLen, ny = outDy / outLen;
    const tipX = mx + nx * R * 1.6, tipY = my + ny * R * 1.6;
    const cp1x = x2 + (tipX - x2) * 0.75, cp1y = y2 + (tipY - y2) * 0.75;
    const cp2x = x3 + (tipX - x3) * 0.75, cp2y = y3 + (tipY - y3) * 0.75;
    ctx.save();
    ctx.fillStyle = fill; ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3);
    ctx.lineTo(x2, y2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (innerFill) {
      const bx = 0.125*x2 + 0.375*cp1x + 0.375*cp2x + 0.125*x3;
      const by = 0.125*y2 + 0.375*cp1y + 0.375*cp2y + 0.125*y3;
      ctx.fillStyle = innerFill;
      ctx.beginPath(); ctx.arc(bx, by, R * 0.42, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** 扁平手绘风猫脸（难度选择页专用，与 renderer.js _drawCatFace 逻辑一致）*/
  function _drawDiffCatFaceFlat(ctx, cx, cy, r, mood, isBlack) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const lineColor  = isBlack ? 'rgba(240,232,218,0.95)' : 'rgba(55,45,35,0.92)';
    const fillColor  = isBlack ? 'rgba(240,232,218,0.95)' : 'rgba(55,45,35,0.92)';
    const tearColor  = isBlack ? 'rgba(180,220,255,0.90)' : 'rgba(100,160,220,0.90)';
    const noseColor  = isBlack ? 'rgba(255,150,170,0.90)' : 'rgba(210,70,110,0.88)';
    const whiskerCol = isBlack ? 'rgba(240,232,218,0.45)' : 'rgba(55,45,35,0.38)';

    const faceY = cy - r * 0.05;
    const eyeY  = faceY - r * 0.12;
    const eyeXL = cx - r * 0.26, eyeXR = cx + r * 0.26;
    const eyeR  = r * 0.20;

    ctx.strokeStyle = lineColor; ctx.fillStyle = fillColor;

    if (mood === 'dead') {
      ctx.lineWidth = Math.max(r * 0.12, 1.2);
      const d = r * 0.14;
      for (const ex of [eyeXL, eyeXR]) {
        ctx.beginPath(); ctx.moveTo(ex-d, eyeY-d); ctx.lineTo(ex+d, eyeY+d); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex+d, eyeY-d); ctx.lineTo(ex-d, eyeY+d); ctx.stroke();
      }
    } else if (mood === 'panic') {
      const bigR = eyeR * 1.35;
      ctx.lineWidth = Math.max(r * 0.10, 1.0);
      for (const ex of [eyeXL, eyeXR]) {
        ctx.beginPath(); ctx.arc(ex, eyeY, bigR, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, eyeY, bigR*0.55, 0, Math.PI*2); ctx.fill();
      }
    } else if (mood === 'cry') {
      ctx.lineWidth = Math.max(r * 0.13, 1.3);
      for (const ex of [eyeXL, eyeXR]) {
        ctx.beginPath();
        ctx.arc(ex, eyeY - eyeR*0.5, eyeR*0.85, Math.PI*0.1, Math.PI*0.9, false);
        ctx.stroke();
      }
      ctx.fillStyle = tearColor;
      ctx.beginPath();
      ctx.ellipse(eyeXL + eyeR*0.1, eyeY + eyeR*1.1, eyeR*0.22, eyeR*0.32, 0, 0, Math.PI*2);
      ctx.fill();
    } else if (mood === 'okay') {
      ctx.lineWidth = Math.max(r * 0.11, 1.0);
      for (const ex of [eyeXL, eyeXR]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ex - eyeR*1.5, eyeY - eyeR*1.5, eyeR*3, eyeR*1.5);
        ctx.clip();
        ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
    } else { // relax
      ctx.lineWidth = Math.max(r * 0.13, 1.3);
      for (const ex of [eyeXL, eyeXR]) {
        ctx.beginPath();
        ctx.arc(ex, eyeY + eyeR*0.5, eyeR*0.85, Math.PI*1.1, Math.PI*1.9, false);
        ctx.stroke();
      }
    }

    // 鼻子
    if (mood !== 'dead') {
      const noseY = faceY + r * 0.08, ns = r * 0.09;
      ctx.fillStyle = noseColor;
      ctx.beginPath();
      ctx.moveTo(cx, noseY + ns*0.6);
      ctx.lineTo(cx - ns, noseY - ns*0.4);
      ctx.lineTo(cx + ns, noseY - ns*0.4);
      ctx.closePath(); ctx.fill();
    }

    // 嘴巴
    const mouthY = faceY + r * 0.22;
    ctx.strokeStyle = lineColor; ctx.fillStyle = fillColor;
    if (mood === 'dead') {
      ctx.lineWidth = Math.max(r*0.10, 1.0);
      ctx.beginPath(); ctx.moveTo(cx - r*0.14, mouthY); ctx.lineTo(cx + r*0.14, mouthY); ctx.stroke();
    } else if (mood === 'panic') {
      ctx.lineWidth = Math.max(r*0.10, 1.0);
      const mw = r*0.18, mh = r*0.06;
      ctx.beginPath();
      ctx.moveTo(cx-mw, mouthY); ctx.lineTo(cx-mw*0.5, mouthY+mh);
      ctx.lineTo(cx, mouthY-mh); ctx.lineTo(cx+mw*0.5, mouthY+mh);
      ctx.lineTo(cx+mw, mouthY); ctx.stroke();
    } else if (mood === 'cry') {
      ctx.lineWidth = Math.max(r*0.11, 1.1);
      ctx.beginPath();
      ctx.arc(cx, mouthY - r*0.06, r*0.14, Math.PI*0.15, Math.PI*0.85, false);
      ctx.stroke();
    } else if (mood === 'okay') {
      ctx.lineWidth = Math.max(r*0.10, 1.0);
      ctx.beginPath(); ctx.moveTo(cx - r*0.13, mouthY); ctx.lineTo(cx + r*0.13, mouthY); ctx.stroke();
    } else {
      ctx.lineWidth = Math.max(r*0.11, 1.1);
      ctx.beginPath();
      ctx.moveTo(cx - r*0.17, mouthY - r*0.02);
      ctx.quadraticCurveTo(cx - r*0.06, mouthY + r*0.11, cx, mouthY + r*0.01);
      ctx.quadraticCurveTo(cx + r*0.06, mouthY + r*0.11, cx + r*0.17, mouthY - r*0.02);
      ctx.stroke();
    }

    // 胡须
    if (mood !== 'dead' && r > 9) {
      ctx.strokeStyle = whiskerCol;
      ctx.lineWidth = Math.max(r*0.05, 0.6);
      const wy = faceY + r*0.12, wLen = r*0.34;
      for (const dy of [-r*0.06, r*0.06]) {
        ctx.beginPath(); ctx.moveTo(cx - r*0.10, wy+dy); ctx.lineTo(cx - r*0.10 - wLen, wy+dy+dy*0.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + r*0.10, wy+dy); ctx.lineTo(cx + r*0.10 + wLen, wy+dy+dy*0.3); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** 独立猫脸绘制（不依赖 Renderer）*/
  function _drawDiffCatFace(ctx, cx, cy, S, cfg) {
    const isBlack = cfg.isBlack;
    const faceColor = isBlack ? 'rgba(255,255,255,0.88)' : 'rgba(40,30,20,0.82)';
    const eyeColor  = isBlack ? '#fff' : '#2a1a0a';

    // 耳朵
    const earW = S * 0.38, earH = S * 0.42;
    ctx.fillStyle = isBlack ? '#555' : '#ddd';
    ctx.beginPath();
    ctx.moveTo(cx - S*0.52, cy - S*0.55);
    ctx.lineTo(cx - S*0.52 - earW*0.5, cy - S*0.55 - earH);
    ctx.lineTo(cx - S*0.52 + earW*0.5, cy - S*0.55);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + S*0.52, cy - S*0.55);
    ctx.lineTo(cx + S*0.52 + earW*0.5, cy - S*0.55 - earH);
    ctx.lineTo(cx + S*0.52 - earW*0.5, cy - S*0.55);
    ctx.closePath(); ctx.fill();
    // 耳内粉
    ctx.fillStyle = isBlack ? 'rgba(255,160,180,0.5)' : 'rgba(255,140,160,0.6)';
    ctx.beginPath();
    ctx.moveTo(cx - S*0.52, cy - S*0.58);
    ctx.lineTo(cx - S*0.52 - earW*0.28, cy - S*0.58 - earH*0.6);
    ctx.lineTo(cx - S*0.52 + earW*0.28, cy - S*0.58);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + S*0.52, cy - S*0.58);
    ctx.lineTo(cx + S*0.52 + earW*0.28, cy - S*0.58 - earH*0.6);
    ctx.lineTo(cx + S*0.52 - earW*0.28, cy - S*0.58);
    ctx.closePath(); ctx.fill();

    // 眼睛
    const eyeY = cy - S * 0.10;
    const eyeR = S * 0.14;
    _drawEye(ctx, cx - S*0.28, eyeY, eyeR, cfg.eyeStyle, eyeColor, isBlack);
    _drawEye(ctx, cx + S*0.28, eyeY, eyeR, cfg.eyeStyle, eyeColor, isBlack);

    // 鼻子
    ctx.fillStyle = isBlack ? 'rgba(255,160,180,0.9)' : 'rgba(220,80,100,0.85)';
    ctx.beginPath();
    ctx.moveTo(cx, cy + S*0.08);
    ctx.lineTo(cx - S*0.07, cy + S*0.02);
    ctx.lineTo(cx + S*0.07, cy + S*0.02);
    ctx.closePath(); ctx.fill();

    // 嘴
    ctx.strokeStyle = faceColor; ctx.lineWidth = S * 0.045; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy + S*0.08); ctx.lineTo(cx - S*0.12, cy + S*0.18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + S*0.08); ctx.lineTo(cx + S*0.12, cy + S*0.18); ctx.stroke();

    // 胡须
    ctx.strokeStyle = faceColor; ctx.lineWidth = S * 0.03; ctx.globalAlpha = 0.7;
    [[-1,1],[-1,0],[-1,-1],[1,1],[1,0],[1,-1]].forEach(([sx, sy], i) => {
      const wx = cx + sx * S * 0.18;
      const wy = cy + S * 0.12 + sy * S * 0.08;
      ctx.beginPath(); ctx.moveTo(wx, wy);
      ctx.lineTo(wx + sx * S * 0.38, wy + sy * S * 0.04); ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  /** 眼睛绘制（支持多种风格）*/
  function _drawEye(ctx, x, y, r, style, color, isBlack) {
    ctx.save();
    switch (style) {
      case 'wide': // 大圆眼（入门）
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r * 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isBlack ? 'rgba(0,200,255,0.9)' : 'rgba(60,120,220,0.9)';
        ctx.beginPath(); ctx.arc(x, y, r * 0.65, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(x - r*0.3, y - r*0.3, r*0.28, 0, Math.PI*2); ctx.fill();
        break;
      case 'normal': // 普通眼（初级）
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(x - r*0.25, y - r*0.25, r*0.25, 0, Math.PI*2); ctx.fill();
        break;
      case 'slit': // 竖瞳（中级）
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r * 1.05, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isBlack ? 'rgba(180,100,255,0.9)' : 'rgba(100,50,150,0.9)';
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.28, r * 0.85, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(x - r*0.2, y - r*0.4, r*0.2, 0, Math.PI*2); ctx.fill();
        break;
      case 'fierce': // 凶狠眼（高级/专家）
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isBlack ? 'rgba(255,80,60,0.9)' : 'rgba(180,40,20,0.9)';
        ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
        // 眉毛（凶）
        ctx.strokeStyle = color; ctx.lineWidth = r * 0.35; ctx.lineCap = 'round';
        const bx = x > 36 ? 1 : -1; // 左右眉方向
        ctx.beginPath(); ctx.moveTo(x - r*0.7*bx, y - r*1.4); ctx.lineTo(x + r*0.5*bx, y - r*1.0); ctx.stroke();
        break;
      case 'glow': // 发光眼（宗师）
        ctx.shadowColor = isBlack ? 'rgba(255,220,60,0.9)' : 'rgba(255,180,0,0.9)';
        ctx.shadowBlur = r * 3;
        ctx.fillStyle = isBlack ? 'rgba(255,220,60,1)' : 'rgba(200,140,0,1)';
        ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(x - r*0.3, y - r*0.3, r*0.3, 0, Math.PI*2); ctx.fill();
        break;
    }
    ctx.restore();
  }

  /** 配饰绘制 */
  function _drawAccessory(ctx, cx, cy, S, type, isBlack) {
    if (!type) return;
    ctx.save();
    switch (type) {
      case 'bow': { // 蝴蝶结（入门）
        const bx = cx + S * 0.55, by = cy - S * 0.62;
        ctx.fillStyle = 'rgba(255,120,160,0.9)';
        ctx.beginPath(); ctx.ellipse(bx - S*0.14, by, S*0.14, S*0.09, -Math.PI/5, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(bx + S*0.14, by, S*0.14, S*0.09, Math.PI/5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(255,180,200,1)';
        ctx.beginPath(); ctx.arc(bx, by, S*0.06, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'scarf': { // 围巾（初级）
        const sy = cy + S * 0.72;
        const grad = ctx.createLinearGradient(cx - S, sy, cx + S, sy);
        grad.addColorStop(0, 'rgba(80,160,255,0.85)');
        grad.addColorStop(0.5, 'rgba(120,200,255,0.85)');
        grad.addColorStop(1, 'rgba(80,160,255,0.85)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(cx - S*0.75, sy - S*0.12, S*1.5, S*0.22, S*0.08); ctx.fill();
        // 围巾结
        ctx.fillStyle = 'rgba(60,140,240,0.9)';
        ctx.beginPath(); ctx.ellipse(cx - S*0.1, sy + S*0.18, S*0.12, S*0.16, -0.3, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + S*0.1, sy + S*0.18, S*0.12, S*0.16, 0.3, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(100,180,255,1)';
        ctx.beginPath(); ctx.arc(cx, sy + S*0.12, S*0.07, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'glasses': { // 眼镜（中级）
        const gy = cy - S * 0.10;
        ctx.strokeStyle = isBlack ? 'rgba(200,180,255,0.9)' : 'rgba(80,60,120,0.9)';
        ctx.lineWidth = S * 0.055;
        ctx.beginPath(); ctx.arc(cx - S*0.28, gy, S*0.18, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + S*0.28, gy, S*0.18, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - S*0.10, gy); ctx.lineTo(cx + S*0.10, gy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - S*0.46, gy - S*0.04); ctx.lineTo(cx - S*0.60, gy - S*0.10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + S*0.46, gy - S*0.04); ctx.lineTo(cx + S*0.60, gy - S*0.10); ctx.stroke();
        break;
      }
      case 'crown': { // 皇冠（专家）
        const ky = cy - S * 0.88;
        ctx.fillStyle = 'rgba(255,200,40,0.95)';
        ctx.beginPath();
        ctx.moveTo(cx - S*0.38, ky + S*0.22);
        ctx.lineTo(cx - S*0.38, ky);
        ctx.lineTo(cx - S*0.18, ky + S*0.14);
        ctx.lineTo(cx, ky - S*0.10);
        ctx.lineTo(cx + S*0.18, ky + S*0.14);
        ctx.lineTo(cx + S*0.38, ky);
        ctx.lineTo(cx + S*0.38, ky + S*0.22);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(200,140,0,0.8)'; ctx.lineWidth = S*0.04; ctx.stroke();
        // 宝石
        ['rgba(255,80,80,1)', 'rgba(80,180,255,1)', 'rgba(255,80,80,1)'].forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.arc(cx + (i-1)*S*0.18, ky + S*0.10, S*0.06, 0, Math.PI*2); ctx.fill();
        });
        break;
      }
      case 'halo': { // 光环（宗师）
        ctx.strokeStyle = 'rgba(255,220,60,0.85)';
        ctx.lineWidth = S * 0.08;
        ctx.shadowColor = 'rgba(255,220,60,0.7)';
        ctx.shadowBlur = S * 0.4;
        ctx.beginPath(); ctx.ellipse(cx, cy - S * 1.05, S * 0.45, S * 0.14, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
        break;
      }
    }
    ctx.restore();
  }

  function initAll() {
    Object.keys(DIFF_CONFIG).forEach(key => {
      drawDiffCat(`diff-cat-${key}`, key);
    });
  }

  return { initAll, drawDiffCat };
})();

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('splash-screen').classList.add('active');

  // 初始化启动屏特效
  SplashScreen.initStars();
  SplashScreen.drawLogoCats();

  // 初始化难度选择屏猫咪
  DiffCats.initAll();

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    const gameScreen = document.getElementById('game-screen');
    if (!gameScreen.classList.contains('active')) return;

    // ESC 关闭弹窗
    if (e.key === 'Escape') {
      App.hideEndGameMenu();
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'p': Game.pass(); break;
      case 'u': Game.undo(); break;
      case 'h': Game.requestHint(); break;
    }
  });

  // 点击弹窗背景关闭
  document.getElementById('end-game-menu').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) App.hideEndGameMenu();
  });

  // 触摸支持
  const gameCanvas = document.getElementById('game-canvas');
  if (gameCanvas) {
    gameCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const fakeEvent = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        target: gameCanvas
      };
      gameCanvas.onclick(fakeEvent);
    }, { passive: false });
  }
});
