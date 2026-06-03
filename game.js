/**
 * game.js — 游戏主控制器 v2.0
 * 新增：落子评语、实时胜率、自适应难度
 */

// ===== App：屏幕管理 & 设置 =====
const App = {
  settings: {
    size: 13,
    color: 'black',
    difficulty: 5,
    komi: 6.5,
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'flex';
      requestAnimationFrame(() => el.classList.add('active'));
    }
    if (id === 'screen-start') this._initStartScreen();
    if (id === 'screen-game') Game.onShow();
  },

  setSetting(key, val, btn) {
    this.settings[key] = val;
    if (btn) {
      const group = btn.closest('.btn-group');
      if (group) group.querySelectorAll('.btn-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  },

  setDifficulty(val) {
    this.settings.difficulty = parseInt(val);
    const labels = ['', '入门', '入门+', '初级', '初级+', '中级', '中级+', '高级', '高级+', '专家', '大师'];
    document.getElementById('difficulty-display').textContent =
      `难度 ${val} · ${labels[val] || ''}`;
  },

  startGame() {
    Game.init(this.settings);
    this.showScreen('screen-game');
  },

  applyRankToGame() {
    const d = window._rankDifficulty || 5;
    this.settings.difficulty = d;
    document.getElementById('difficulty-slider').value = d;
    this.setDifficulty(d);
    this.showScreen('screen-mode');
  },

  _initStartScreen() {
    const logo = document.getElementById('logo-canvas');
    if (logo) {
      const tmpR = new GoRenderer(logo, 5);
      tmpR.drawLogo(logo);
    }
  }
};

// ===== Game：游戏逻辑控制 =====
const Game = {
  engine: null,
  renderer: null,
  ai: null,
  playerColor: 1,
  aiColor: -1,
  isAITurn: false,
  hoverPos: null,
  hintPos: null,
  hintTimer: null,
  settings: null,

  // 胜率相关
  _winRateUpdateTimer: null,
  _lastWinRate: 0.5,   // 玩家胜率

  init(settings) {
    this.settings = { ...settings };
    const size = settings.size;
    this.playerColor = settings.color === 'black' ? 1 : -1;
    this.aiColor = -this.playerColor;
    this.isAITurn = false;
    this.hoverPos = null;
    this.hintPos = null;

    // 关闭上局结束弹窗
    document.getElementById('game-overlay').classList.add('hidden');

    this.engine = new GoEngine(size, settings.komi);
    this.ai = new GoAI(settings.difficulty);

    const canvas = document.getElementById('game-canvas');
    this.renderer = new GoRenderer(canvas, size);

    canvas.onclick = (e) => this._handleClick(e);
    canvas.onmousemove = (e) => this._handleHover(e);
    canvas.onmouseleave = () => { this.hoverPos = null; this._redraw(); };

    this._updateUI();
    this._redraw();
    this._clearComment();
    this._updateWinRateBar(0.5, '游戏开始，势均力敌');

    if (this.playerColor === -1) {
      setTimeout(() => this._aiMove(), 500);
    }
  },

  // 用当前设置直接重开一局（不经过设置页）
  restart() {
    this.init(this.settings);
    this._drawSideIcons();
  },

  onShow() {
    if (this.renderer) {
      this.renderer.resize();
      this._redraw();
    }
    this._drawSideIcons();
  },

  _drawSideIcons() {
    if (!this.renderer) return;
    const iconB = document.getElementById('icon-black');
    const iconW = document.getElementById('icon-white');
    if (iconB) this.renderer.drawStoneIcon(iconB, 1);
    if (iconW) this.renderer.drawStoneIcon(iconW, -1);
  },

  _handleClick(e) {
    if (this.isAITurn || this.engine.gameOver) return;
    const canvas = document.getElementById('game-canvas');
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const [r, c] = this.renderer.toBoard(px, py);

    if (!this.engine.inBounds(r, c)) return;
    if (this.engine.turn !== this.playerColor) return;

    const result = this.engine.place(r, c);
    if (!result.ok) {
      this._showMoveError(result.error);
      return;
    }

    // 玩家落子评语
    const playerComment = this.ai.evaluatePlayerMove(
      this.engine, r, c, this.playerColor, result.captures || 0
    );
    this._showComment(playerComment, 'player');

    this.hintPos = null;
    this._updateUI();
    this._redraw();

    if (this.engine.gameOver) {
      this._showGameOver();
      return;
    }

    // 异步更新胜率
    this._scheduleWinRateUpdate();

    setTimeout(() => this._aiMove(), 100);
  },

  _handleHover(e) {
    if (this.isAITurn || this.engine.gameOver) return;
    const canvas = document.getElementById('game-canvas');
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const [r, c] = this.renderer.toBoard(px, py);
    if (this.engine.inBounds(r, c) && this.engine.board[r][c] === 0) {
      this.hoverPos = [r, c];
    } else {
      this.hoverPos = null;
    }
    this._redraw();
  },

  async _aiMove() {
    if (this.engine.gameOver) return;
    if (this.engine.turn !== this.aiColor) return;

    this.isAITurn = true;
    document.getElementById('ai-thinking').classList.remove('hidden');
    this._updateTurnIndicator();

    try {
      const result = await this.ai.getBestMove(this.engine);
      const { move, comment, winRate } = result;

      if (move) {
        this.engine.place(move[0], move[1]);
      } else {
        this.engine.pass();
      }

      // 显示 AI 评语
      this._showComment(comment || '🐱 落子完毕', 'ai');

      // 更新胜率（AI 胜率 = 1 - 玩家胜率）
      // winRate 是 AI 颜色的胜率
      const playerWinRate = 1 - winRate;
      this._lastWinRate = playerWinRate;
      this._updateWinRateBar(playerWinRate, null);

    } catch (err) {
      console.error('AI error:', err);
      this.engine.pass();
    }

    document.getElementById('ai-thinking').classList.add('hidden');
    this.isAITurn = false;
    this._updateUI();
    this._redraw();

    if (this.engine.gameOver) {
      setTimeout(() => this._showGameOver(), 500);
    }
  },

  pass() {
    if (this.isAITurn || this.engine.gameOver) return;
    if (this.engine.turn !== this.playerColor) return;
    this.engine.pass();
    this._showComment('⏭️ 虚手，等待对方落子', 'player');
    this._updateUI();
    this._redraw();
    if (this.engine.gameOver) { this._showGameOver(); return; }
    setTimeout(() => this._aiMove(), 100);
  },

  undo() {
    if (this.isAITurn) return;
    const ok = this.engine.undo();
    if (ok) {
      this.hintPos = null;
      this._showComment('↩️ 悔棋，重新思考', 'player');
      this._updateUI();
      this._redraw();
      this._scheduleWinRateUpdate();
    }
  },

resign() {
if (this.engine.gameOver) return;
this.engine.gameOver = true;
// 记录 AI 获胜
this.ai.recordResult(true);
const winner = this.playerColor === 1 ? '白方 (AI)' : '黑方';
this._showOverlay(`${winner} 获胜`, '对方认输，游戏结束。');
},

endGame() {
if (this.engine.gameOver) return;
this.engine.gameOver = true;
this._showGameOver();
},

requestHint() {
if (this.isAITurn || this.engine.gameOver) return;
    if (this.engine.turn !== this.playerColor) return;

    const hintAI = new GoAI(Math.min(10, this.settings.difficulty + 2));
    hintAI.getBestMove(this.engine).then(result => {
      const move = result.move || result; // 兼容旧接口
      if (move && Array.isArray(move)) {
        this.hintPos = move;
        this._redraw();
        this._showComment('💡 建议落子位置已标出（黄色圆圈）', 'system');
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => {
          this.hintPos = null;
          this._redraw();
        }, 3000);
      }
    });
  },

  // ============================================================
  // 胜率更新
  // ============================================================
  _scheduleWinRateUpdate() {
    clearTimeout(this._winRateUpdateTimer);
    this._winRateUpdateTimer = setTimeout(() => {
      if (!this.engine || this.engine.gameOver) return;
      const wr = this.ai.estimateWinRate(this.engine, this.playerColor, 10);
      this._lastWinRate = wr;
      this._updateWinRateBar(wr, null);
    }, 300);
  },

  _updateWinRateBar(playerWinRate, customText) {
    const bar = document.getElementById('win-rate-bar-player');
    const barAI = document.getElementById('win-rate-bar-ai');
    const textEl = document.getElementById('win-rate-text');
    if (!bar || !barAI || !textEl) return;

    const pct = Math.round(playerWinRate * 100);
    const aiPct = 100 - pct;

    bar.style.width = pct + '%';
    barAI.style.width = aiPct + '%';

    // 颜色：玩家领先绿色，AI 领先红色
    if (playerWinRate > 0.6) {
      bar.style.background = 'linear-gradient(90deg, #4CAF50, #8BC34A)';
    } else if (playerWinRate < 0.4) {
      bar.style.background = 'linear-gradient(90deg, #FF6B6B, #FF8E53)';
    } else {
      bar.style.background = 'linear-gradient(90deg, #FFB347, #FFD700)';
    }

    if (customText) {
      textEl.textContent = customText;
    } else {
      const playerName = this.playerColor === 1 ? '黑' : '白';
      const aiName = this.playerColor === 1 ? '白' : '黑';
      if (playerWinRate > 0.65) {
        textEl.textContent = `${playerName}方领先 · 你 ${pct}% vs AI ${aiPct}%`;
      } else if (playerWinRate < 0.35) {
        textEl.textContent = `${aiName}方(AI)领先 · 你 ${pct}% vs AI ${aiPct}%`;
      } else {
        textEl.textContent = `势均力敌 · 你 ${pct}% vs AI ${aiPct}%`;
      }
    }
  },

  // ============================================================
  // 评语系统
  // ============================================================
  _showComment(text, type) {
    const el = document.getElementById('move-comment');
    const icon = document.getElementById('comment-icon');
    if (!el || !icon) return;

    // 图标
    const icons = { player: '🧑', ai: '🤖', system: '💡' };
    icon.textContent = icons[type] || '💬';

    el.textContent = text;
    el.className = 'move-comment-text comment-' + type;

    // 动画：淡入
    const wrap = document.getElementById('comment-wrap');
    if (wrap) {
      wrap.classList.remove('comment-anim');
      void wrap.offsetWidth; // 触发重排
      wrap.classList.add('comment-anim');
    }
  },

  _clearComment() {
    const el = document.getElementById('move-comment');
    const icon = document.getElementById('comment-icon');
    if (el) el.textContent = '落子后将显示评语...';
    if (icon) icon.textContent = '💬';
  },

  // ============================================================
  // UI 更新
  // ============================================================
  _redraw() {
    if (!this.renderer || !this.engine) return;
    this.renderer.drawBoard(this.engine, this.hoverPos, this.hintPos);
  },

  _updateUI() {
    if (!this.engine) return;
    document.getElementById('captures-black').textContent = `提子: ${this.engine.capturedWhite}`;
    document.getElementById('captures-white').textContent = `提子: ${this.engine.capturedBlack}`;
    document.getElementById('move-count').textContent = `第 ${this.engine.moveCount} 手`;
    const koHint = document.getElementById('ko-hint');
    if (this.engine.koPoint) koHint.classList.remove('hidden');
    else koHint.classList.add('hidden');
    document.getElementById('game-difficulty-badge').textContent =
      `难度 ${this.settings.difficulty}`;
    document.getElementById('player-black-name').textContent =
      this.playerColor === 1 ? '黑方 (你)' : '黑方 (AI)';
    this._updateTurnIndicator();
    if (this.engine.gameOver) {
      const s = this.engine.score();
      document.getElementById('score-black').textContent = s.black.toFixed(1);
      document.getElementById('score-white').textContent = s.white.toFixed(1);
    }
  },

  _updateTurnIndicator() {
    const isBlackTurn = this.engine.turn === 1;
    document.getElementById('turn-black').classList.toggle('active', isBlackTurn);
    document.getElementById('turn-white').classList.toggle('active', !isBlackTurn);
    document.getElementById('card-black').classList.toggle('active-turn', isBlackTurn);
    document.getElementById('card-white').classList.toggle('active-turn', !isBlackTurn);
    document.getElementById('turn-white').textContent = !isBlackTurn ? '▶' : '';
  },

  _showMoveError(error) {
    const msgs = {
      ko: '劫争！不能立即提回',
      suicide: '禁止自杀落子',
      occupied: '此处已有棋子',
    };
    this._showComment('⚠️ ' + (msgs[error] || '非法落子'), 'system');
    const hint = document.getElementById('ko-hint');
    hint.textContent = msgs[error] || '非法落子';
    hint.classList.remove('hidden');
    setTimeout(() => {
      hint.textContent = '劫争!';
      if (!this.engine.koPoint) hint.classList.add('hidden');
    }, 1500);
  },

  _showGameOver() {
    const s = this.engine.score();
    document.getElementById('score-black').textContent = s.black.toFixed(1);
    document.getElementById('score-white').textContent = s.white.toFixed(1);
    const winnerName = s.winner === 'black' ? '黑方' : '白方';
    const isPlayerWin = (s.winner === 'black' && this.playerColor === 1) ||
                        (s.winner === 'white' && this.playerColor === -1);

// 记录结果用于自适应（传入分差，让 AI 感知玩家赢了多少目）
const scoreDiff = isPlayerWin ? s.diff : -s.diff;
this.ai.recordResult(!isPlayerWin, scoreDiff);

    const title = isPlayerWin ? '🎉 你赢了！' : '😿 AI 获胜';
    const desc = `${winnerName}胜，差距 ${s.diff} 目（黑 ${s.black.toFixed(1)} : 白 ${s.white.toFixed(1)}，贴目 ${this.engine.komi}）`;
    this._showOverlay(title, desc);

    // 最终胜率
    const finalWR = isPlayerWin ? 1 : 0;
    this._updateWinRateBar(finalWR, isPlayerWin ? '🎉 你获胜！' : '😿 AI 获胜');
  },

  _showOverlay(title, desc) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-desc').textContent = desc;
    document.getElementById('game-overlay').classList.remove('hidden');
  }
};

// ===== 初始化 =====
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.screen').forEach(s => {
    s.style.display = 'none';
    s.classList.remove('active');
  });
  App.showScreen('screen-start');
  App.setDifficulty(5);
  window.addEventListener('resize', () => {
    if (Game.renderer) {
      Game.renderer.resize();
      Game.renderer._calcLayout();
      Game._redraw();
    }
  });
});
