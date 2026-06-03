/**
 * ai.js — 指导棋 AI 引擎 v3.0
 * 设计目标：
 * 1. AI 始终保持指导棋水平，玩家胜率不超过 45%
 * 2. 即使玩家赢棋，差距不超过 3 目（精准控分）
 * 3. 自适应：玩家连赢时 AI 自动加强，连输时适度放水
 * 4. 终局追分：检测到玩家领先 >3 目时触发强力收官
 */
class GoAI {
  constructor(difficulty = 5) {
    this.difficulty = Math.max(1, Math.min(10, difficulty));
    this._winHistory = [];    // 近期胜负记录
    this._adaptiveBoost = 1.5; // 初始加成（AI 默认比设定难度强 1.5 级）
    this._playerLeadHistory = []; // 玩家领先目数历史
  }

  setDifficulty(d) {
    this.difficulty = Math.max(1, Math.min(10, d));
    this._winHistory = [];
    this._adaptiveBoost = 1.5;
    this._playerLeadHistory = [];
  }

  // 记录胜负，用于自适应调整
  // 目标：AI 胜率维持在 55%~75%，玩家赢时差距 ≤3 目
  recordResult(aiWon, scoreDiff = 0) {
    this._winHistory.push(aiWon ? 1 : 0);
    if (this._winHistory.length > 8) this._winHistory.shift();
    const recentWinRate = this._winHistory.reduce((a, b) => a + b, 0) / this._winHistory.length;

    if (this._winHistory.length >= 2) {
      if (recentWinRate < 0.55) {
        // 玩家赢太多：大幅加强 AI
        this._adaptiveBoost = Math.min(4, this._adaptiveBoost + 0.8);
      } else if (recentWinRate < 0.65) {
        // 玩家胜率在 35%~45%：小幅加强
        this._adaptiveBoost = Math.min(4, this._adaptiveBoost + 0.3);
      } else if (recentWinRate > 0.85) {
        // AI 赢太多：稍微放水，让游戏有趣
        this._adaptiveBoost = Math.max(0.5, this._adaptiveBoost - 0.4);
      }
    }
  }

  // 主入口：返回 { move: [r,c]|null, comment: string, winRate: number }
  async getBestMove(engine) {
    const color = engine.turn;
    const legalMoves = engine.getLegalMoves(color);
    if (legalMoves.length === 0) {
      return { move: null, comment: '无合法落点，选择虚手', winRate: 0.5 };
    }

    const thinkTime = 200 + this.difficulty * 60;
    await this._sleep(thinkTime);

    // 有效难度 = 设定难度 + 自适应加成，最低保底 4（确保 AI 始终有基本策略）
    const effectiveDiff = Math.min(10, Math.max(4, this.difficulty + this._adaptiveBoost));

    // 检测玩家是否领先超过 3 目 → 触发追分模式（最强力落子）
    const playerColor = -color; // AI 的对手
    const currentScore = engine.score();
    const playerLead = playerColor === 1
      ? currentScore.black - currentScore.white
      : currentScore.white - currentScore.black;

    let move;
    if (playerLead > 3 && engine.moveCount > 20) {
      // 追分模式：忽略难度限制，全力以赴
      move = this._strongMove(engine, legalMoves, 10);
    } else if (effectiveDiff <= 3) {
      move = this._heuristicMove(engine, legalMoves, 0.6);
    } else {
      move = this._strongMove(engine, legalMoves, effectiveDiff);
    }

    const comment = this._generateAIComment(engine, move, color);
    const winRate = this._quickWinRate(engine, color);

    return { move, comment, winRate };
  }

  // ============================================================
  // 强力落子决策（难度 5+）
  // ============================================================
  _strongMove(engine, moves, difficulty) {
    const color = engine.turn;
    const n = engine.size;
    const moveNum = engine.moveCount;

    // === 第一优先：紧急救援（己方只剩1气）===
    const urgentSave = this._findUrgentSave(engine, color);
    if (urgentSave) return urgentSave;

    // === 第二优先：吃子（对方只剩1气）===
    const capture = this._findCapture(engine, color);
    if (capture) return capture;

    // === 第三优先：紧逼（对方只剩2气）===
    if (difficulty >= 5) {
      const atari = this._findAtari(engine, color);
      if (atari && Math.random() < 0.8) return atari;
    }

    // === 第四优先：布局阶段（前20手）用星位/天元 ===
    if (moveNum < 20 && difficulty >= 4) {
      const opening = this._openingMove(engine, color, moveNum);
      if (opening) return opening;
    }

    // === 第五优先：收官阶段地盘争夺 ===
    const boardSize = n * n;
    const fillRate = engine.moveCount / boardSize;
    if (fillRate > 0.4 && difficulty >= 5) {
      const endgame = this._endgameMove(engine, color, moves);
      if (endgame) return endgame;
    }

    // === 第六优先：MCTS + 强启发式 ===
    // 提升模拟次数，确保 AI 有足够搜索深度
    const simCount = 40 + difficulty * 15;
    return this._mctsMove(engine, moves, simCount, difficulty);
  }

  // 寻找紧急救援点（己方棋子只剩1气）
  _findUrgentSave(engine, color) {
    const n = engine.size;
    const checked = new Set();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (engine.board[r][c] !== color) continue;
        const key = r * n + c;
        if (checked.has(key)) continue;
        const grp = engine.getGroup(r, c);
        grp.stones.forEach(([sr, sc]) => checked.add(sr * n + sc));
        if (grp.liberties.length === 1) {
          // 尝试在气点落子
          const [lr, lc] = grp.liberties[0];
          const sim = engine.clone();
          const res = sim.place(lr, lc);
          if (res.ok && sim.getLibertyCount(lr, lc) > 1) return [lr, lc];
          // 尝试逃跑：找相邻空点
          for (const [sr, sc] of grp.stones) {
            for (const [nr, nc] of engine.neighbors(sr, sc)) {
              if (engine.board[nr][nc] === 0) {
                const sim2 = engine.clone();
                const res2 = sim2.place(nr, nc);
                if (res2.ok && sim2.getLibertyCount(nr, nc) > 2) return [nr, nc];
              }
            }
          }
        }
      }
    }
    return null;
  }

  // 寻找吃子点（对方只剩1气）
  _findCapture(engine, color) {
    const opp = -color;
    const n = engine.size;
    const checked = new Set();
    let bestCapture = null;
    let bestSize = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (engine.board[r][c] !== opp) continue;
        const key = r * n + c;
        if (checked.has(key)) continue;
        const grp = engine.getGroup(r, c);
        grp.stones.forEach(([sr, sc]) => checked.add(sr * n + sc));
        if (grp.liberties.length === 1) {
          const [lr, lc] = grp.liberties[0];
          if (engine.board[lr][lc] === 0) {
            const sim = engine.clone();
            const res = sim.place(lr, lc);
            if (res.ok && grp.stones.length > bestSize) {
              bestSize = grp.stones.length;
              bestCapture = [lr, lc];
            }
          }
        }
      }
    }
    return bestCapture;
  }

  // 寻找紧逼点（对方只剩2气）
  _findAtari(engine, color) {
    const opp = -color;
    const n = engine.size;
    const checked = new Set();
    let bestAtari = null;
    let bestSize = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (engine.board[r][c] !== opp) continue;
        const key = r * n + c;
        if (checked.has(key)) continue;
        const grp = engine.getGroup(r, c);
        grp.stones.forEach(([sr, sc]) => checked.add(sr * n + sc));
        if (grp.liberties.length === 2 && grp.stones.length >= 2) {
          // 选一个气点落子
          for (const [lr, lc] of grp.liberties) {
            if (engine.board[lr][lc] === 0) {
              const sim = engine.clone();
              const res = sim.place(lr, lc);
              if (res.ok && grp.stones.length > bestSize) {
                bestSize = grp.stones.length;
                bestAtari = [lr, lc];
              }
            }
          }
        }
      }
    }
    return bestAtari;
  }

  // ============================================================
  // 布局定式库（围棋常识：角→边→中）
  // ============================================================

  // 获取四个角的"占角点"（星位 + 小目 + 三三）
  _getCornerPoints(n) {
    // 9路：星位在(2,2)等，小目在(2,3)等，三三在(2,2)
    // 13路：星位(3,3)，小目(3,4)，三三(2,2)
    // 19路：星位(3,3)，小目(3,4)/(4,3)，三三(2,2)
    const k = n <= 9 ? 2 : 3; // 星位距边距离
    return [
      // 左上角
      { corner: 'TL', star: [k, k], komoku: [k, k+1], komoku2: [k+1, k], sansan: [k-1, k-1] },
      // 右上角
      { corner: 'TR', star: [k, n-1-k], komoku: [k, n-2-k], komoku2: [k+1, n-1-k], sansan: [k-1, n-k] },
      // 左下角
      { corner: 'BL', star: [n-1-k, k], komoku: [n-1-k, k+1], komoku2: [n-2-k, k], sansan: [n-k, k-1] },
      // 右下角
      { corner: 'BR', star: [n-1-k, n-1-k], komoku: [n-1-k, n-2-k], komoku2: [n-2-k, n-1-k], sansan: [n-k, n-k] },
    ];
  }

  // 判断某角是否已被占（有棋子在角部区域）
  _isCornerOccupied(engine, cornerDef, n) {
    const k = n <= 9 ? 2 : 3;
    const range = k + 2;
    const [cr, cc] = cornerDef.corner === 'TL' ? [0, 0]
      : cornerDef.corner === 'TR' ? [0, n-1]
      : cornerDef.corner === 'BL' ? [n-1, 0]
      : [n-1, n-1];
    const dr = cr === 0 ? 1 : -1;
    const dc = cc === 0 ? 1 : -1;
    for (let i = 0; i <= range; i++)
      for (let j = 0; j <= range; j++) {
        const r = cr + dr * i, c = cc + dc * j;
        if (engine.inBounds(r, c) && engine.board[r][c] !== 0) return true;
      }
    return false;
  }

  // 布局阶段主逻辑（严格遵循围棋常识）
  _openingMove(engine, color, moveNum) {
    const n = engine.size;
    const center = Math.floor(n / 2);
    const corners = this._getCornerPoints(n);

    // ── 阶段1：前8手，优先占角（角→角→角→角）──
    if (moveNum < 8) {
      // 找空角，按优先级：星位 > 小目（随机选一种）
      const emptyCorners = corners.filter(cd => !this._isCornerOccupied(engine, cd, n));

      if (emptyCorners.length > 0) {
        // 选择与对方棋子对角的空角（围棋常识：不要紧挨对方）
        const oppStones = [];
        for (let r = 0; r < n; r++)
          for (let c = 0; c < n; c++)
            if (engine.board[r][c] === -color) oppStones.push([r, c]);

        let targetCorner = emptyCorners[0];
        if (oppStones.length > 0) {
          // 选离对方最远的空角
          let maxDist = -1;
          for (const cd of emptyCorners) {
            const pt = cd.star;
            let minD = Infinity;
            for (const [or, oc] of oppStones)
              minD = Math.min(minD, Math.abs(pt[0]-or) + Math.abs(pt[1]-oc));
            if (minD > maxDist) { maxDist = minD; targetCorner = cd; }
          }
        }

        // 随机选星位或小目（星位概率60%，小目40%）
        const pts = Math.random() < 0.6
          ? [targetCorner.star, targetCorner.komoku, targetCorner.komoku2]
          : [targetCorner.komoku, targetCorner.komoku2, targetCorner.star];

        for (const pt of pts) {
          if (engine.inBounds(pt[0], pt[1]) && engine.board[pt[0]][pt[1]] === 0)
            return pt;
        }
      }

      // 四角都被占了，才考虑天元（moveNum>=4 且四角已满）
      if (emptyCorners.length === 0 && engine.board[center][center] === 0) {
        return [center, center];
      }
    }

    // ── 阶段2：8-16手，守角或挂角 ──
    if (moveNum >= 4 && moveNum < 16) {
      // 优先守角（己方占了角，对方还没挂）
      const guardMove = this._findGuardMove(engine, color, n, corners);
      if (guardMove) return guardMove;

      // 挂角（对方占了角，我方去挂）
      const approachMove = this._findApproachMove(engine, color, n);
      if (approachMove) return approachMove;
    }

    // ── 阶段3：16-25手，拆边 ──
    if (moveNum >= 8 && moveNum < 25) {
      const splitMove = this._findSplitMove(engine, color, n);
      if (splitMove) return splitMove;
    }

    return null;
  }

  // 守角：己方占了角，在旁边守（防止对方三三入侵）
  _findGuardMove(engine, color, n, corners) {
    const k = n <= 9 ? 2 : 3;
    for (const cd of corners) {
      if (engine.board[cd.star[0]][cd.star[1]] !== color) continue;
      // 己方占了星位，守角点（一间守/二间守）
      const guards = [
        [cd.star[0], cd.star[1] + (cd.corner === 'TL' || cd.corner === 'BL' ? 2 : -2)],
        [cd.star[0] + (cd.corner === 'TL' || cd.corner === 'TR' ? 2 : -2), cd.star[1]],
        [cd.star[0], cd.star[1] + (cd.corner === 'TL' || cd.corner === 'BL' ? 1 : -1)],
        [cd.star[0] + (cd.corner === 'TL' || cd.corner === 'TR' ? 1 : -1), cd.star[1]],
      ];
      for (const g of guards) {
        if (engine.inBounds(g[0], g[1]) && engine.board[g[0]][g[1]] === 0) {
          // 确认附近没有对方棋子（不是紧急应对）
          let hasOpp = false;
          for (const [nr, nc] of engine.neighbors(g[0], g[1]))
            if (engine.board[nr][nc] === -color) { hasOpp = true; break; }
          if (!hasOpp) return g;
        }
      }
    }
    return null;
  }

  // 拆边：在己方棋子之间的边上落子（拆二/拆三）
  _findSplitMove(engine, color, n) {
    const k = n <= 9 ? 2 : 3;
    // 扫描四条边，找己方棋子之间的空点
    const edges = [
      { row: k, colRange: [k, n-1-k] },       // 上边
      { row: n-1-k, colRange: [k, n-1-k] },   // 下边
      { col: k, rowRange: [k, n-1-k] },        // 左边
      { col: n-1-k, rowRange: [k, n-1-k] },   // 右边
    ];

    for (const edge of edges) {
      if (edge.row !== undefined) {
        const r = edge.row;
        const [cMin, cMax] = edge.colRange;
        for (let c = cMin + 2; c <= cMax - 2; c++) {
          if (engine.board[r][c] !== 0) continue;
          // 检查两侧是否有己方棋子（拆二/拆三）
          let leftOwn = false, rightOwn = false;
          for (let dc = 1; dc <= 3; dc++) {
            if (c - dc >= 0 && engine.board[r][c-dc] === color) leftOwn = true;
            if (c + dc < n && engine.board[r][c+dc] === color) rightOwn = true;
          }
          if (leftOwn && rightOwn) return [r, c];
        }
      } else {
        const col = edge.col;
        const [rMin, rMax] = edge.rowRange;
        for (let r = rMin + 2; r <= rMax - 2; r++) {
          if (engine.board[r][col] !== 0) continue;
          let topOwn = false, botOwn = false;
          for (let dr = 1; dr <= 3; dr++) {
            if (r - dr >= 0 && engine.board[r-dr][col] === color) topOwn = true;
            if (r + dr < n && engine.board[r+dr][col] === color) botOwn = true;
          }
          if (topOwn && botOwn) return [r, col];
        }
      }
    }
    return null;
  }

  // 收官阶段：寻找边界地盘争夺点（阻止玩家扩张）
  _endgameMove(engine, color, moves) {
    const opp = -color;
    const n = engine.size;
    let bestMove = null;
    let bestScore = 0;

    for (const [r, c] of moves) {
      let score = 0;
      // 检查此点是否能阻止对方扩张地盘
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!engine.inBounds(nr, nc)) continue;
          const dist = Math.abs(dr) + Math.abs(dc);
          if (dist === 0) continue;
          // 附近有对方棋子且周围有空点 → 高价值
          if (engine.board[nr][nc] === opp) {
            score += 3 / dist;
          }
          // 附近是空点且靠近对方势力 → 争夺价值
          if (engine.board[nr][nc] === 0) {
            score += 1 / (dist + 1);
          }
        }
      }
      // 模拟落子后的地盘变化
      const sim = engine.clone();
      const res = sim.place(r, c);
      if (!res.ok) continue;
      const before = engine.score();
      const after = sim.score();
      const aiColorName = color === 1 ? 'black' : 'white';
      const oppColorName = color === 1 ? 'white' : 'black';
      const gain = (after[aiColorName] - before[aiColorName]) - (after[oppColorName] - before[oppColorName]);
      score += gain * 4;

      if (score > bestScore) {
        bestScore = score;
        bestMove = [r, c];
      }
    }
    // 只有明显有价值时才返回（避免乱走）
    return bestScore > 3 ? bestMove : null;
  }

  _getStarPoints(n) {
    if (n === 9) return [[2,2],[2,6],[6,2],[6,6],[4,4]];
    if (n === 13) return [[3,3],[3,9],[9,3],[9,9],[3,6],[9,6],[6,3],[6,9],[6,6]];
    // 19路
    return [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
  }

  // 挂角：在对方星位附近落子
  _findApproachMove(engine, color, n) {
    const opp = -color;
    const starPoints = this._getStarPoints(n);
    for (const [sr, sc] of starPoints) {
      if (engine.board[sr][sc] !== opp) continue;
      // 挂角点（距离2-3格）
      const approaches = [
        [sr - 2, sc + 1], [sr - 1, sc + 2],
        [sr + 2, sc + 1], [sr + 1, sc + 2],
        [sr - 2, sc - 1], [sr - 1, sc - 2],
        [sr + 2, sc - 1], [sr + 1, sc - 2],
      ];
      for (const [ar, ac] of approaches) {
        if (engine.inBounds(ar, ac) && engine.board[ar][ac] === 0) {
          return [ar, ac];
        }
      }
    }
    return null;
  }

  // ============================================================
  // MCTS（蒙特卡洛树搜索）
  // ============================================================
  _mctsMove(engine, moves, simCount, difficulty) {
    const color = engine.turn;
    const scores = new Map();
    const visits = new Map();

    const candidates = this._filterCandidates(engine, moves, difficulty);

    for (const [r, c] of candidates) {
      scores.set(r * 100 + c, 0);
      visits.set(r * 100 + c, 0);
    }

    for (let i = 0; i < simCount; i++) {
      const move = this._ucbSelect(candidates, scores, visits, i + 1);
      const [r, c] = move;
      const key = r * 100 + c;

      const sim = engine.clone();
      const result = sim.place(r, c);
      if (!result.ok) { visits.set(key, (visits.get(key) || 0) + 1); continue; }

      const win = this._simulate(sim, color, difficulty);
      scores.set(key, (scores.get(key) || 0) + win);
      visits.set(key, (visits.get(key) || 0) + 1);
    }

    let bestMove = candidates[0];
    let bestRate = -1;
    for (const [r, c] of candidates) {
      const key = r * 100 + c;
      const v = visits.get(key) || 0;
      if (v === 0) continue;
      const rate = (scores.get(key) || 0) / v;
      if (rate > bestRate) { bestRate = rate; bestMove = [r, c]; }
    }
    return bestMove;
  }

  _ucbSelect(moves, scores, visits, total) {
    let best = moves[0], bestVal = -Infinity;
    for (const [r, c] of moves) {
      const key = r * 100 + c;
      const v = visits.get(key) || 0;
      const s = scores.get(key) || 0;
      const ucb = v === 0 ? Infinity : (s / v) + Math.sqrt(2 * Math.log(total) / v);
      if (ucb > bestVal) { bestVal = ucb; best = [r, c]; }
    }
    return best;
  }

  // 快速随机模拟（高难度时使用更强的智能选择）
  _simulate(engine, color, difficulty) {
    const maxMoves = engine.size * engine.size * 1.5;
    let moves = 0;
    // 难度越高，智能选择概率越高（难度10时接近100%智能）
    const smartProb = Math.min(0.95, 0.5 + difficulty * 0.05);
    while (!engine.gameOver && moves < maxMoves) {
      const lm = engine.getLegalMoves(engine.turn);
      if (lm.length === 0) { engine.pass(); continue; }

      let chosen;
      if (Math.random() < smartProb) {
        chosen = this._smartSimPick(engine, lm);
      } else {
        chosen = lm[Math.floor(Math.random() * lm.length)];
      }
      engine.place(chosen[0], chosen[1]);
      moves++;
    }
    const result = engine.score();
    return result.winner === (color === 1 ? 'black' : 'white') ? 1 : 0;
  }

  // 模拟中的智能选择
  _smartSimPick(engine, moves) {
    // 优先吃子
    for (const [r, c] of moves) {
      if (this._wouldCapture(engine, r, c)) return [r, c];
    }
    // 优先救援
    const color = engine.turn;
    for (const [r, c] of moves) {
      for (const [nr, nc] of engine.neighbors(r, c)) {
        if (engine.board[nr][nc] === color && engine.getLibertyCount(nr, nc) === 1) return [r, c];
      }
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // 过滤候选点
  _filterCandidates(engine, moves, difficulty) {
    if (moves.length <= 8) return moves;
    const scored = moves.map(([r, c]) => ({
      move: [r, c],
      score: this._evalMove(engine, r, c)
    }));
    scored.sort((a, b) => b.score - a.score);
    const keepN = Math.min(moves.length, 10 + Math.floor(difficulty * 2));
    return scored.slice(0, keepN).map(s => s.move);
  }

  // ============================================================
  // 综合启发式评分（核心）
  // ============================================================
  _evalMove(engine, r, c) {
    let score = 0;
    const color = engine.turn;
    const opp = -color;
    const n = engine.size;

    // 1. 吃子价值（最高优先）
    for (const [nr, nc] of engine.neighbors(r, c)) {
      if (engine.board[nr][nc] === opp) {
        const grp = engine.getGroup(nr, nc);
        const libs = grp.liberties.length;
        if (libs === 1) score += 20 + grp.stones.length * 5; // 可以吃子
        else if (libs === 2) score += 6 + grp.stones.length * 2; // 紧逼
        else if (libs === 3) score += 2;
      }
    }

    // 2. 救援己方棋子
    for (const [nr, nc] of engine.neighbors(r, c)) {
      if (engine.board[nr][nc] === color) {
        const grp = engine.getGroup(nr, nc);
        const libs = grp.liberties.length;
        if (libs === 1) score += 18 + grp.stones.length * 3; // 紧急救援
        else if (libs === 2) score += 5;
      }
    }

    // 3. 连接己方棋子（增强棋形）
    let ownNeighbors = 0;
    for (const [nr, nc] of engine.neighbors(r, c)) {
      if (engine.board[nr][nc] === color) ownNeighbors++;
    }
    if (ownNeighbors === 1) score += 3;
    else if (ownNeighbors === 2) score += 5; // 连接两块
    else if (ownNeighbors >= 3) score += 2; // 过于集中反而不好

    // 4. 地盘价值（影响范围）
    score += this._territoryValue(engine, r, c, color) * 0.8;

    // 5. 星位/天元加成
    const starBonus = this._starPointBonus(r, c, n);
    score += starBonus;

    // 6. 避免愚型（不要填自己的眼）
    if (this._isEyePoint(engine, r, c, color)) score -= 15;

    // 7. 边角惩罚（布局阶段）
    if (engine.moveCount < 30) {
      if (r === 0 || r === n - 1 || c === 0 || c === n - 1) score -= 4;
      if ((r === 0 || r === n - 1) && (c === 0 || c === n - 1)) score -= 6; // 角落更差
    }

    // 8. 随机扰动（根据难度，但最大扰动限制在 6，避免走出明显坏棋）
    const jitter = Math.max(0, Math.min(6, (5 - this.difficulty) * 1.5));
    score += (Math.random() - 0.5) * jitter;

    return score;
  }

  // 地盘影响力评估
  _territoryValue(engine, r, c, color) {
    const n = engine.size;
    let value = 0;
    // 检查周围3格范围内的棋子分布
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        const nr = r + dr, nc = c + dc;
        if (!engine.inBounds(nr, nc)) continue;
        const dist = Math.abs(dr) + Math.abs(dc);
        if (dist === 0) continue;
        const decay = 1 / (dist * dist);
        if (engine.board[nr][nc] === color) value += decay * 2;
        else if (engine.board[nr][nc] === -color) value -= decay * 1.5;
      }
    }
    return value;
  }

  // 星位加成
  _starPointBonus(r, c, n) {
    const stars = this._getStarPoints(n);
    for (const [sr, sc] of stars) {
      if (sr === r && sc === c) return 4;
      if (Math.abs(sr - r) + Math.abs(sc - c) <= 1) return 1;
    }
    return 0;
  }

  // 判断是否是己方的眼（不应填）
  _isEyePoint(engine, r, c, color) {
    const neighbors = engine.neighbors(r, c);
    if (neighbors.length < 3) return false; // 边角不算
    let ownCount = 0;
    for (const [nr, nc] of neighbors) {
      if (engine.board[nr][nc] === color) ownCount++;
    }
    return ownCount === neighbors.length; // 四周全是己方棋子
  }

  // ============================================================
  // 低难度策略
  // ============================================================
  _randomWithCapture(engine, moves, captureProb) {
    const captureMoves = moves.filter(([r, c]) => this._wouldCapture(engine, r, c));
    if (captureMoves.length > 0 && Math.random() < captureProb + 0.3) {
      return captureMoves[Math.floor(Math.random() * captureMoves.length)];
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  _heuristicMove(engine, moves, greediness) {
    const scored = moves.map(([r, c]) => ({
      move: [r, c],
      score: this._evalMove(engine, r, c)
    }));
    scored.sort((a, b) => b.score - a.score);
    const topK = Math.max(1, Math.floor(moves.length * (1 - greediness * 0.5)));
    const pool = scored.slice(0, topK);
    return pool[Math.floor(Math.random() * pool.length)].move;
  }

  // ============================================================
  // 快速胜率估算（供 UI 显示）
  // ============================================================
  estimateWinRate(engine, color, samples = 12) {
    let wins = 0;
    for (let i = 0; i < samples; i++) {
      const sim = engine.clone();
      let moves = 0;
      const maxMoves = sim.size * sim.size;
      while (!sim.gameOver && moves < maxMoves) {
        const lm = sim.getLegalMoves(sim.turn);
        if (lm.length === 0) { sim.pass(); continue; }
        const chosen = this._smartSimPick(sim, lm);
        sim.place(chosen[0], chosen[1]);
        moves++;
      }
      const result = sim.score();
      if (result.winner === (color === 1 ? 'black' : 'white')) wins++;
    }
    return wins / samples;
  }

  _quickWinRate(engine, color) {
    return this.estimateWinRate(engine, color, 8);
  }

  // ============================================================
  // AI 落子教学解说（指导棋：解释为什么走这里）
  // ============================================================
  _generateAIComment(engine, move, color) {
    if (!move) return '🤔 局面均衡，选择虚手，等待时机';

    const [r, c] = move;
    const opp = -color;
    const n = engine.size;
    const moveNum = engine.moveCount;
    const neighbors = engine.neighbors(r, c);

    // ── 吃子 ──
    let captureCount = 0;
    for (const [nr, nc] of neighbors) {
      if (engine.board[nr][nc] === opp) {
        const grp = engine.getGroup(nr, nc);
        if (grp.liberties.length === 1) captureCount += grp.stones.length;
      }
    }
    if (captureCount >= 3) return `😼 提子 ${captureCount} 子！对方棋子气数耗尽，必须提掉。提子后注意：你的棋子是否也有危险？`;
    if (captureCount >= 1) return `😸 提子！吃掉 ${captureCount} 颗。提子后原位置变成空点，注意是否形成劫争。`;

    // ── 紧急救援己方 ──
    for (const [nr, nc] of neighbors) {
      if (engine.board[nr][nc] === color) {
        const grp = engine.getGroup(nr, nc);
        if (grp.liberties.length === 1) {
          return `😤 紧急！我方棋子只剩一气，必须逃跑或补气。棋子的气是生命线，气尽即被提。`;
        }
      }
    }

    // ── 打吃（紧逼对方至1气）──
    let atariTarget = null;
    for (const [nr, nc] of neighbors) {
      if (engine.board[nr][nc] === opp) {
        const grp = engine.getGroup(nr, nc);
        if (grp.liberties.length === 2) { atariTarget = grp; break; }
      }
    }
    if (atariTarget) {
      return `😏 打吃！对方 ${atariTarget.stones.length} 子被压缩到只剩一气。下一手如果对方不逃，就可以提掉。`;
    }

    // ── 布局阶段解说 ──
    const corners = this._getCornerPoints(n);
    const center = Math.floor(n / 2);

    if (moveNum < 8) {
      // 占角
      for (const cd of corners) {
        if ((cd.star[0]===r && cd.star[1]===c)) {
          return `🐾 占星位！"金角银边草肚皮"——角部是最容易围地的地方。星位(${r},${c})控制角部，是布局要点。`;
        }
        if ((cd.komoku[0]===r && cd.komoku[1]===c) || (cd.komoku2[0]===r && cd.komoku2[1]===c)) {
          return `🏠 占小目！小目比星位更靠近角落，围角效率更高，但需要后续守角。`;
        }
      }
      if (r === center && c === center) {
        return `⭐ 天元！四角已满，天元是棋盘中心，影响全局势力。`;
      }
    }

    if (moveNum >= 4 && moveNum < 16) {
      // 守角
      for (const cd of corners) {
        if (engine.board[cd.star[0]][cd.star[1]] === color) {
          const guards = [
            [cd.star[0], cd.star[1] + (cd.corner==='TL'||cd.corner==='BL'?2:-2)],
            [cd.star[0] + (cd.corner==='TL'||cd.corner==='TR'?2:-2), cd.star[1]],
          ];
          for (const g of guards) {
            if (g[0]===r && g[1]===c) return `🛡️ 守角！己方占了角后，守角可以防止对方三三入侵，巩固角部地盘。`;
          }
        }
      }

      // 挂角
      for (const cd of corners) {
        if (engine.board[cd.star[0]][cd.star[1]] === opp) {
          const dist = Math.abs(cd.star[0]-r) + Math.abs(cd.star[1]-c);
          if (dist >= 2 && dist <= 4) {
            return `⚔️ 挂角！对方占了角，我方在旁边挂角，阻止对方扩大角部地盘。挂角是布局的重要手段。`;
          }
        }
      }

      // 拆边
      const k = n <= 9 ? 2 : 3;
      if (r === k || r === n-1-k || c === k || c === n-1-k) {
        return `📐 拆边！在边上拆开，连接两个角部棋子，同时扩大边部势力。拆二/拆三是布局常用手法。`;
      }
    }

    // ── 中盘解说 ──
    if (moveNum >= 16) {
      // 连接
      let ownNeighbors = 0;
      for (const [nr, nc] of neighbors) {
        if (engine.board[nr][nc] === color) ownNeighbors++;
      }
      if (ownNeighbors >= 2) return '🔗 连接！把分散的棋子连成一块，增加气数，棋形更稳固。';

      // 扩张
      if (ownNeighbors === 1) {
        const grp = engine.getGroup(r, c);
        if (grp.liberties.length >= 5) return '↗️ 延伸！向空旷地带发展，扩大势力范围，同时增加棋子的气。';
      }

      // 侵消
      let nearOpp = 0;
      for (let dr = -3; dr <= 3; dr++)
        for (let dc = -3; dc <= 3; dc++) {
          const nr = r+dr, nc = c+dc;
          if (engine.inBounds(nr,nc) && engine.board[nr][nc] === opp) nearOpp++;
        }
      if (nearOpp >= 4) return '🎯 侵消！深入对方势力范围，打乱对方的地盘计划。侵消要注意自身安全。';
    }

    // ── 收官阶段 ──
    if (moveNum > engine.size * engine.size * 0.4) {
      return '🏁 收官！争夺边界，每一目都很关键。收官要从大到小，先走价值高的地方。';
    }

    const fallback = [
      '💡 此处是双方必争的要点，先手占据更有利。',
      '🌊 扩张势力，同时限制对方发展空间。',
      '⚡ 抢占先机，保持主动权。',
      '🐱 稳步推进，积累优势。',
    ];
    return fallback[Math.floor(Math.random() * fallback.length)];
  }

  // ============================================================
  // 玩家落子评语（指导棋模式：分析好坏，给出建议）
  // ============================================================
  evaluatePlayerMove(engine, r, c, color, captureCount) {
    const opp = -color;
    const n = engine.size;
    const moveNum = engine.moveCount; // 落子后的手数

    // ── 严重错误：填了自己的眼 ──
    const neighbors = engine.neighbors(r, c);
    const ownNeighborCount = neighbors.filter(([nr,nc]) => engine.board[nr][nc] === color).length;
    if (ownNeighborCount === neighbors.length) {
      return '❌ 填眼！这手棋填了自己的眼，是严重失误。眼是棋子的生命，不能随意填掉。';
    }

    // ── 严重错误：布局阶段走天元（前4手）──
    const center = Math.floor(n / 2);
    if (r === center && c === center && moveNum <= 4) {
      return '⚠️ 天元过早！围棋有句话"金角银边草肚皮"，布局应先占角，天元价值不如角部。建议先走星位或小目。';
    }

    // ── 严重错误：布局阶段走边线第一二路 ──
    if (moveNum < 15 && (r <= 1 || r >= n-2 || c <= 1 || c >= n-2)) {
      return '⚠️ 一二路太低！布局阶段走一二路效率极低，棋子被压在边上发展受限。建议走三四路（星位/小目区域）。';
    }

    // ── 好棋：吃子 ──
    if (captureCount >= 3) return `🎉 精彩！一举吃掉 ${captureCount} 子！吃子后注意巩固棋形，防止对方反击。`;
    if (captureCount >= 1) return `👍 提子！吃掉 ${captureCount} 颗棋子。注意吃子后是否有后续手段。`;

    // ── 好棋：打吃（对方只剩1气）──
    let atariGroups = [];
    for (const [nr, nc] of neighbors) {
      if (engine.board[nr][nc] === opp) {
        const grp = engine.getGroup(nr, nc);
        if (grp.liberties.length === 1) atariGroups.push(grp);
      }
    }
    if (atariGroups.length >= 2) return `⚡ 双打吃！同时威胁两块棋，对方只能救一块，这是手筋！`;
    if (atariGroups.length === 1) {
      const sz = atariGroups[0].stones.length;
      return sz >= 3
        ? `🎯 打吃 ${sz} 子！对方大块棋只剩一气，下一手可以提掉。`
        : `🎯 打吃！对方棋子只剩一气，下一手记得提子。`;
    }

    // ── 好棋：布局阶段占角 ──
    const corners = this._getCornerPoints(n);
    for (const cd of corners) {
      if ((cd.star[0]===r && cd.star[1]===c) || (cd.komoku[0]===r && cd.komoku[1]===c) || (cd.komoku2[0]===r && cd.komoku2[1]===c)) {
        if (moveNum <= 12) return '⭐ 好棋！占角是布局的第一要务。"金角银边草肚皮"，角部效率最高。';
      }
    }

    // ── 提示：布局阶段还有空角 ──
    if (moveNum < 16) {
      const emptyCorners = corners.filter(cd => !this._isCornerOccupied(engine, cd, n));
      if (emptyCorners.length > 0) {
        return `💡 还有 ${emptyCorners.length} 个空角未占。布局阶段应优先占角，角部是最容易围地的地方。`;
      }
    }

    // ── 提示：愚型（棋形过重）──
    if (ownNeighborCount >= 3) {
      return '⚠️ 棋形偏重！四周都是自己的棋子，这手棋效率低。围棋讲究"棋形轻灵"，不要把棋子堆在一起。';
    }

    // ── 提示：紧逼对方（对方只剩2气）──
    let pressureCount = 0;
    for (const [nr, nc] of neighbors) {
      if (engine.board[nr][nc] === opp) {
        const grp = engine.getGroup(nr, nc);
        if (grp.liberties.length === 2) pressureCount += grp.stones.length;
      }
    }
    if (pressureCount >= 2) return `😏 施压！对方 ${pressureCount} 子只剩两气，继续追击可能吃掉。`;

    // ── 提示：连接己方棋子 ──
    if (ownNeighborCount === 2) return '🔗 连接！把两块棋连在一起，棋形更加稳固。连接是围棋的基本功。';

    // ── 提示：延伸发展 ──
    if (ownNeighborCount === 1) {
      const grp = engine.getGroup(r, c);
      if (grp.liberties.length >= 4) return '↗️ 延伸发展，棋形舒展，气多。继续扩大势力范围。';
    }

    // ── 中性评语（根据局面阶段）──
    if (moveNum < 20) {
      return '📍 布局阶段，重点是占角、守角、挂角，建立根据地。';
    } else if (moveNum < 50) {
      return '⚔️ 中盘战斗，注意棋子的气数，随时准备攻击或防守。';
    } else {
      return '🏁 收官阶段，每一目都很重要，注意边界的争夺。';
    }
  }

  _wouldCapture(engine, r, c) {
    const opp = -engine.turn;
    for (const [nr, nc] of engine.neighbors(r, c)) {
      if (engine.board[nr][nc] === opp && engine.getLibertyCount(nr, nc) === 1) return true;
    }
    return false;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ===== 棋力测试题库（专业版）=====
// 共 20 道题：前 10 道死活题，后 10 道手筋题
// 棋盘坐标：[行, 列]，0=空，1=黑，-1=白，行列均从0开始（左上角）
// 9路棋盘，参考聂卫平冲段题库风格，难度从入门到业余段位递进

const RANK_PROBLEMS = [

  // ══════════════════════════════════════════
  // 死活题 1-10（黑先活棋 / 黑先杀白）
  // ══════════════════════════════════════════

  // 死活-1【入门】角部直三，黑先活棋
  // 白棋包围角部黑棋，黑需在中间做眼
  {
    type: '死活', level: 1, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0,-1,-1,-1, 0, 0, 0, 0, 0],
      [ 0,-1, 1, 1,-1, 0, 0, 0, 0],
      [ 0,-1, 1, 0,-1, 0, 0, 0, 0],
    ],
    answer: [8, 3], color: 1,
    desc: '死活①：黑先活棋。角部黑棋被围，找到关键一手做出两眼。'
  },

  // 死活-2【入门】边部曲四，黑先活棋
  {
    type: '死活', level: 1, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [-1,-1,-1,-1,-1, 0, 0, 0, 0],
      [-1, 1, 1, 1,-1, 0, 0, 0, 0],
      [-1, 1, 0, 1,-1, 0, 0, 0, 0],
      [ 0,-1,-1,-1, 0, 0, 0, 0, 0],
    ],
    answer: [7, 2], color: 1,
    desc: '死活②：黑先活棋。边部黑棋被围，中间做眼是关键。'
  },

  // 死活-3【初级】角部方四，黑先杀白
  {
    type: '死活', level: 2, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 1, 1, 1, 1, 0, 0, 0, 0, 0],
      [ 1,-1,-1, 1, 0, 0, 0, 0, 0],
      [ 0, 1, 1, 0, 0, 0, 0, 0, 0],
    ],
    answer: [8, 0], altAnswers: [[8, 3]],  color: 1,
    desc: '死活③：黑先杀白。角部白棋被围，点入要害使其无法做两眼。'
  },

  // 死活-4【初级】直四，黑先杀白（点眼）
  {
    type: '死活', level: 2, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 1, 1, 1, 1, 1, 1, 0, 0, 0],
      [ 1,-1,-1,-1,-1, 1, 0, 0, 0],
      [ 1,-1, 0, 0,-1, 1, 0, 0, 0],
      [ 0, 1, 1, 1, 1, 0, 0, 0, 0],
    ],
    answer: [7, 2], altAnswers: [[7, 3]], color: 1,
    desc: '死活④：黑先杀白。白棋直四，找到中间要点使其变为假眼。'
  },

  // 死活-5【初级】角部刀五，黑先活棋
  {
    type: '死活', level: 3, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0,-1,-1,-1,-1, 0, 0, 0, 0],
      [ 0,-1, 1, 1,-1, 0, 0, 0, 0],
      [-1,-1, 1, 0,-1, 0, 0, 0, 0],
      [ 0, 0, 1, 1,-1, 0, 0, 0, 0],
    ],
    answer: [7, 3], color: 1,
    desc: '死活⑤：黑先活棋。黑棋刀五形，找到正确位置做出两眼。'
  },

  // 死活-6【中级】边部葡萄六，黑先杀白
  {
    type: '死活', level: 4, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 1, 1, 1, 1, 1, 0, 0, 0, 0],
      [ 1,-1,-1,-1, 1, 0, 0, 0, 0],
      [ 1,-1, 0,-1, 1, 0, 0, 0, 0],
      [ 1,-1,-1,-1, 1, 0, 0, 0, 0],
      [ 0, 1, 1, 1, 0, 0, 0, 0, 0],
    ],
    answer: [6, 2], color: 1,
    desc: '死活⑥：黑先杀白。白棋葡萄六形，找到唯一要点使其成为假眼。'
  },

  // 死活-7【中级】角部大猪嘴，黑先活棋
  {
    type: '死活', level: 4, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0,-1,-1,-1, 0, 0, 0, 0, 0],
      [-1,-1, 1, 1,-1, 0, 0, 0, 0],
      [-1, 1, 1, 0,-1, 0, 0, 0, 0],
      [ 0,-1, 1, 1,-1, 0, 0, 0, 0],
    ],
    answer: [7, 3], color: 1,
    desc: '死活⑦：黑先活棋。黑棋大猪嘴形，正确落点可做出两眼。'
  },

  // 死活-8【中级】倒脱靴，黑先提劫活棋
  {
    type: '死活', level: 5, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0,-1,-1,-1, 0, 0, 0, 0],
      [ 0,-1, 1, 1,-1, 0, 0, 0, 0],
      [-1, 1, 0, 1,-1, 0, 0, 0, 0],
      [ 0,-1,-1, 1,-1, 0, 0, 0, 0],
    ],
    answer: [7, 2], color: 1,
    desc: '死活⑧：黑先，倒脱靴手筋，提子后形成劫争或净活。'
  },

  // 死活-9【高级】角部万年劫，黑先做劫
  {
    type: '死活', level: 6, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0,-1,-1, 0, 0, 0, 0, 0],
      [ 0,-1, 1, 1,-1, 0, 0, 0, 0],
      [-1, 1, 0, 1,-1, 0, 0, 0, 0],
      [ 0,-1, 1,-1, 0, 0, 0, 0, 0],
    ],
    answer: [7, 2], color: 1,
    desc: '死活⑨：黑先，角部万年劫形，找到正确手段做出劫争。'
  },

  // 死活-10【高级】边部复杂死活，黑先净杀
  {
    type: '死活', level: 7, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 1, 1, 1, 1, 1, 1, 0, 0, 0],
      [ 1,-1, 1,-1,-1, 1, 0, 0, 0],
      [ 1,-1,-1, 0,-1, 1, 0, 0, 0],
      [ 1,-1, 0,-1,-1, 1, 0, 0, 0],
      [ 0, 1, 1, 1, 1, 0, 0, 0, 0],
    ],
    answer: [6, 3], altAnswers: [[7, 2]], color: 1,
    desc: '死活⑩：黑先净杀。白棋内部有两个空点，找到正确次序使其无法做活。'
  },

  // ══════════════════════════════════════════
  // 手筋题 11-20（黑先，利用手筋吃子/得利）
  // ══════════════════════════════════════════

  // 手筋-1【入门】打吃，黑先提子
  {
    type: '手筋', level: 1, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 1,-1, 1, 0, 0, 0, 0],
      [ 0, 0, 0, 1,-1, 0, 0, 0, 0],
      [ 0, 0, 0, 0,-1, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    answer: [7, 3], color: 1,
    desc: '手筋①：黑先，白棋只剩一气，找到正确位置提掉白子。'
  },

  // 手筋-2【入门】双吃（叫吃两块），黑先得子
  {
    type: '手筋', level: 1, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0,-1, 0,-1, 0, 0, 0, 0],
      [ 0, 0, 1,-1, 1, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    answer: [4, 3], color: 1,
    desc: '手筋②：黑先双吃。一手棋同时打吃两块白棋，必得其一。'
  },

  // 手筋-3【初级】征子，黑先征吃白棋
  {
    type: '手筋', level: 2, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 1,-1, 1, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    answer: [5, 4], altAnswers: [[7, 4]], color: 1,
    desc: '手筋③：黑先征子。白棋被围只剩两气，用征子手段吃掉白棋。'
  },

  // 手筋-4【初级】扑（入子），黑先扑入做劫或提子
  {
    type: '手筋', level: 2, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 1, 1, 1, 0, 0, 0, 0],
      [ 0, 0, 1,-1,-1, 1, 0, 0, 0],
      [ 0, 0, 1,-1, 0,-1, 0, 0, 0],
      [ 0, 0, 0, 1, 1, 0, 0, 0, 0],
    ],
    answer: [7, 4], color: 1,
    desc: '手筋④：黑先扑入。利用扑的手筋，破坏白棋眼位或提取白子。'
  },

  // 手筋-5【初级】接不归，黑先吃子
  {
    type: '手筋', level: 3, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 1,-1, 0, 0, 0, 0, 0],
      [ 0, 0, 1,-1,-1, 1, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 1, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    answer: [5, 4], color: 1,
    desc: '手筋⑤：黑先，接不归手筋。白棋无论如何接都会被吃，找到关键点。'
  },

  // 手筋-6【中级】门吃（枷），黑先枷住白棋
  {
    type: '手筋', level: 4, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 0,-1, 0, 0, 0, 0, 0],
      [ 0, 0, 1,-1, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    answer: [5, 4], color: 1,
    desc: '手筋⑥：黑先枷吃。用枷的手筋封锁白棋逃路，使其无处可逃。'
  },

  // 手筋-7【中级】滚打包收，黑先连续打吃
  {
    type: '手筋', level: 4, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 1, 1, 1, 0, 0, 0, 0],
      [ 0, 0, 1,-1,-1, 1, 0, 0, 0],
      [ 0, 0, 1,-1,-1, 1, 0, 0, 0],
      [ 0, 0, 0, 1, 1, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
    answer: [5, 2], altAnswers: [[6, 2]], color: 1,
    desc: '手筋⑦：黑先，滚打包收。连续打吃白棋，一网打尽。'
  },

  // 手筋-8【中级】倒扑，黑先倒扑吃子
  {
    type: '手筋', level: 5, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 1, 1, 1, 0, 0, 0, 0],
      [ 0, 0, 1,-1, 1, 0, 0, 0, 0],
      [ 0, 0,-1, 1,-1, 0, 0, 0, 0],
      [ 0, 0, 0,-1, 0, 0, 0, 0, 0],
    ],
    answer: [7, 2], altAnswers: [[7, 4]], color: 1,
    desc: '手筋⑧：黑先倒扑。先送入一子，再提取更多白子的高级手筋。'
  },

  // 手筋-9【高级】大头鬼，黑先吃角部白棋
  {
    type: '手筋', level: 6, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [ 0, 0, 1,-1, 1, 0, 0, 0, 0],
      [ 0, 1,-1,-1, 1, 0, 0, 0, 0],
      [ 0, 0, 1, 1, 0, 0, 0, 0, 0],
    ],
    answer: [7, 1], color: 1,
    desc: '手筋⑨：黑先，大头鬼手筋。利用特殊棋形一举吃掉白棋大块。'
  },

  // 手筋-10【高级】双倒扑，黑先连续手筋
  {
    type: '手筋', level: 7, size: 9,
    board: [
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [ 0, 0, 1, 1, 1, 0, 0, 0, 0],
      [ 0, 1,-1,-1,-1, 1, 0, 0, 0],
      [ 0, 1,-1, 1,-1, 1, 0, 0, 0],
      [ 0, 0, 1,-1, 1, 0, 0, 0, 0],
      [ 0, 0, 0, 1, 0, 0, 0, 0, 0],
    ],
    answer: [7, 3], color: 1,
    desc: '手筋⑩：黑先，双倒扑连续手筋。需要看清两步以上的变化，一举吃掉白棋。'
  },
];

class RankTestClass {
  constructor() {
    this.problems = RANK_PROBLEMS;
    this.currentIdx = 0;
    this.score = 0;
    this.timer = null;
    this.timeLeft = 30;
    this.renderer = null;
    this.engine = null;
    this.active = false;
  }

  start() {
this.currentIdx = 0;
this.score = 0;
this.scoreByType = { '死活': 0, '手筋': 0 };
this.active = true;
    document.getElementById('rank-intro-area').classList.add('hidden');
    document.getElementById('rank-result').classList.add('hidden');
    document.getElementById('rank-test-area').classList.remove('hidden');
    this._loadProblem();
  }

  _loadProblem() {
    const prob = this.problems[this.currentIdx];
const typeLabel = prob.type ? `【${prob.type}题】` : '';
document.getElementById('rank-q-num').textContent =
`第 ${this.currentIdx + 1} 题 / 共 ${this.problems.length} 题 ${typeLabel}`;
document.getElementById('rank-hint-text').textContent = prob.desc;
    this.engine = new GoEngine(prob.size, 6.5);
    this.engine.board = prob.board.map(r => [...r]);
    this.engine.turn = prob.color;
    const canvas = document.getElementById('rank-canvas');
    this.renderer = new GoRenderer(canvas, prob.size);
    this.renderer.drawBoard(this.engine, null, null);
    canvas.onclick = (e) => this._handleClick(e);
    this._startTimer();
  }

  _startTimer() {
    clearInterval(this.timer);
    this.timeLeft = 30;
    this._updateTimerUI();
    this.timer = setInterval(() => {
      this.timeLeft--;
      this._updateTimerUI();
      if (this.timeLeft <= 0) { clearInterval(this.timer); this._nextProblem(false); }
    }, 1000);
  }

  _updateTimerUI() {
    document.getElementById('rank-timer-text').textContent = `${this.timeLeft}s`;
    document.getElementById('rank-timer-fill').style.width = `${(this.timeLeft / 30) * 100}%`;
  }

  _handleClick(e) {
    if (!this.active) return;
    const canvas = document.getElementById('rank-canvas');
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const [r, c] = this.renderer.toBoard(px, py);
    const prob = this.problems[this.currentIdx];
    const isCorrect = (r === prob.answer[0] && c === prob.answer[1]) ||
      (prob.altAnswers && prob.altAnswers.some(([ar, ac]) => ar === r && ac === c));
    clearInterval(this.timer);
    const result = this.engine.place(r, c);
    if (result.ok) this.renderer.drawBoard(this.engine, null, isCorrect ? null : prob.answer);
    const hint = document.getElementById('rank-hint-text');
    if (isCorrect) {
      hint.textContent = '✅ 正确！'; hint.style.color = '#4CAF50'; this.score++;
const t = this.problems[this.currentIdx].type;
if (t) this.scoreByType[t] = (this.scoreByType[t] || 0) + 1;
    } else {
      hint.textContent = `❌ 错误，正确答案已标出`; hint.style.color = '#FF5252';
      this.renderer.drawBoard(this.engine, null, prob.answer);
    }
    setTimeout(() => { hint.style.color = ''; this._nextProblem(isCorrect); }, 1500);
  }

  _nextProblem(correct) {
    this.currentIdx++;
    if (this.currentIdx >= this.problems.length) this._showResult();
    else this._loadProblem();
  }

  _showResult() {
    this.active = false;
    clearInterval(this.timer);
    document.getElementById('rank-test-area').classList.add('hidden');
    document.getElementById('rank-result').classList.remove('hidden');

    const total = this.problems.length; // 20
    const s = this.score;

    // 分别统计死活题和手筋题得分
    const lifeScore   = this.scoreByType['死活'] || 0;
    const tesujScore  = this.scoreByType['手筋'] || 0;

    // 参考聂卫平围棋道场级段位体系（20题满分）
    // 0-3题：入门（25-20级）  4-6题：初级（15-10级）
    // 7-9题：中级（5-3级）    10-12题：高级（2-1级）
    // 13-15题：业余1-2段      16-17题：业余3-4段
    // 18-19题：业余5-6段      20题：业余7段+
    let rank, icon, desc, difficulty;
    if (s <= 3) {
      rank = '入门（约25-20级）'; icon = '🐱'; difficulty = 2;
      desc = '刚接触围棋，建议先熟悉基本规则和吃子技巧，从入门难度开始练习。';
    } else if (s <= 6) {
      rank = '初级（约15-10级）'; icon = '😺'; difficulty = 3;
      desc = '已掌握基本规则，能看懂简单打吃，建议多练习基础死活和征子。';
    } else if (s <= 9) {
      rank = '中级（约5-3级）'; icon = '😸'; difficulty = 5;
      desc = '有一定基础，能解决常见死活形，建议系统学习手筋和对杀。';
    } else if (s <= 12) {
      rank = '高级（约2-1级）'; icon = '🎖️'; difficulty = 7;
      desc = '棋力扎实！能处理中级死活和手筋，冲段在望，推荐高难度对局。';
    } else if (s <= 15) {
      rank = '业余1-2段'; icon = '🏅'; difficulty = 8;
      desc = '段位水平！死活和手筋功底良好，建议研究布局定式和中盘战斗。';
    } else if (s <= 17) {
      rank = '业余3-4段'; icon = '🥇'; difficulty = 9;
      desc = '强段水平！解题能力出色，建议挑战高难度死活和复杂手筋。';
    } else if (s <= 19) {
      rank = '业余5-6段'; icon = '🏆'; difficulty = 9;
      desc = '高段水平！死活手筋功力深厚，推荐挑战最高难度，冲击职业！';
    } else {
      rank = '业余7段+'; icon = '👑'; difficulty = 9;
      desc = '满分！顶尖业余水平，死活手筋无懈可击，堪称高手！';
    }

    document.getElementById('rank-result-icon').textContent = icon;
    document.getElementById('rank-badge').textContent = rank;
    document.getElementById('rank-result-desc').textContent =
      `总分 ${s}/${total} 题（死活 ${lifeScore}/10，手筋 ${tesujScore}/10）。${desc}`;
    window._rankDifficulty = difficulty;
  }
}

const RankTest = new RankTestClass();
