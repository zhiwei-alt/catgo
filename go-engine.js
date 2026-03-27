/**
 * go-engine.js — 围棋核心逻辑
 * 支持 9/13/19 路棋盘，完整实现落子、提子、气计算、劫争、虚手、胜负判定
 */
class GoEngine {
  constructor(size = 13, komi = 6.5) {
    this.size = size;
    this.komi = komi;
    this.reset();
  }

  reset() {
    const n = this.size;
    // 0=空, 1=黑, -1=白
    this.board = Array.from({ length: n }, () => new Array(n).fill(0));
    this.turn = 1;           // 1=黑先
    this.capturedBlack = 0;  // 白方提走的黑子数
    this.capturedWhite = 0;  // 黑方提走的白子数
    this.moveCount = 0;
    this.passCount = 0;
    this.koPoint = null;     // 劫点 [r,c]
    this.history = [];       // 棋盘历史（用于悔棋）
    this.gameOver = false;
    this.lastMove = null;
  }

  // ---- 工具 ----
  inBounds(r, c) { return r >= 0 && r < this.size && c >= 0 && c < this.size; }

  neighbors(r, c) {
    return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
      .filter(([nr,nc]) => this.inBounds(nr, nc));
  }

  // 获取连通块及其气
  getGroup(r, c) {
    const color = this.board[r][c];
    if (color === 0) return { stones: [], liberties: [] };
    const visited = new Set();
    const liberties = new Set();
    const stones = [];
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const key = cr * this.size + cc;
      if (visited.has(key)) continue;
      visited.add(key);
      stones.push([cr, cc]);
      for (const [nr, nc] of this.neighbors(cr, cc)) {
        const nkey = nr * this.size + nc;
        if (this.board[nr][nc] === 0) {
          liberties.add(nkey);
        } else if (this.board[nr][nc] === color && !visited.has(nkey)) {
          stack.push([nr, nc]);
        }
      }
    }
    return {
      stones,
      liberties: [...liberties].map(k => [Math.floor(k / this.size), k % this.size])
    };
  }

  getLibertyCount(r, c) {
    return this.getGroup(r, c).liberties.length;
  }

  // ---- 落子 ----
  // 返回 { ok, captures, koPoint, error }
  place(r, c) {
    if (this.gameOver) return { ok: false, error: 'game_over' };
    if (!this.inBounds(r, c)) return { ok: false, error: 'out_of_bounds' };
    if (this.board[r][c] !== 0) return { ok: false, error: 'occupied' };
    if (this.koPoint && this.koPoint[0] === r && this.koPoint[1] === c)
      return { ok: false, error: 'ko' };

    const color = this.turn;
    const opp = -color;

    // 保存历史
    this._saveHistory();

    // 临时落子
    this.board[r][c] = color;

    // 提对方子
    let totalCaptures = 0;
    let newKo = null;
    const capturedGroups = [];
    for (const [nr, nc] of this.neighbors(r, c)) {
      if (this.board[nr][nc] === opp) {
        const grp = this.getGroup(nr, nc);
        if (grp.liberties.length === 0) {
          capturedGroups.push(grp.stones);
          totalCaptures += grp.stones.length;
          for (const [sr, sc] of grp.stones) this.board[sr][sc] = 0;
        }
      }
    }

    // 检查自杀（落子后自己也没气）
    const selfGroup = this.getGroup(r, c);
    if (selfGroup.liberties.length === 0) {
      // 回滚
      this._restoreHistory();
      this.history.pop();
      return { ok: false, error: 'suicide' };
    }

    // 劫判断：提了恰好1子，且落子后自己只有1气
    if (totalCaptures === 1 && capturedGroups[0].length === 1 && selfGroup.liberties.length === 1) {
      newKo = capturedGroups[0][0];
    }

    // 更新提子数
    if (color === 1) this.capturedWhite += totalCaptures;
    else this.capturedBlack += totalCaptures;

    this.koPoint = newKo;
    this.turn = opp;
    this.moveCount++;
    this.passCount = 0;
    this.lastMove = [r, c];

    return { ok: true, captures: totalCaptures, koPoint: newKo };
  }

  // ---- 虚手 ----
  pass() {
    if (this.gameOver) return false;
    this._saveHistory();
    this.passCount++;
    this.koPoint = null;
    this.turn = -this.turn;
    this.moveCount++;
    this.lastMove = null;
    if (this.passCount >= 2) {
      this.gameOver = true;
    }
    return true;
  }

  // ---- 悔棋 ----
  undo() {
    if (this.history.length < 2) return false; // 至少退2步（撤销AI的一步+玩家的一步）
    this._restoreHistory(); // 撤销AI步
    this.history.pop();
    this._restoreHistory(); // 撤销玩家步
    this.history.pop();
    this.gameOver = false;
    return true;
  }

  _saveHistory() {
    this.history.push({
      board: this.board.map(r => [...r]),
      turn: this.turn,
      capturedBlack: this.capturedBlack,
      capturedWhite: this.capturedWhite,
      koPoint: this.koPoint ? [...this.koPoint] : null,
      moveCount: this.moveCount,
      passCount: this.passCount,
      lastMove: this.lastMove ? [...this.lastMove] : null,
    });
  }

  _restoreHistory() {
    if (!this.history.length) return;
    const h = this.history[this.history.length - 1];
    this.board = h.board.map(r => [...r]);
    this.turn = h.turn;
    this.capturedBlack = h.capturedBlack;
    this.capturedWhite = h.capturedWhite;
    this.koPoint = h.koPoint ? [...h.koPoint] : null;
    this.moveCount = h.moveCount;
    this.passCount = h.passCount;
    this.lastMove = h.lastMove ? [...h.lastMove] : null;
  }

  // ---- 死子识别（中国规则：被对方完全包围且无法做活的棋子）----
  // 返回死子坐标集合 Set<"r,c">
  _findDeadStones() {
    const n = this.size;
    const dead = new Set();

    // 对每个连通块判断是否为死子：
    // 简化判断：若一个连通块的所有气都在对方领地内（被对方包围），则视为死子
    const visited = new Set();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (this.board[r][c] === 0) continue;
        const key = `${r},${c}`;
        if (visited.has(key)) continue;

        const color = this.board[r][c];
        const opp = -color;
        const grp = this.getGroup(r, c);
        for (const [sr, sc] of grp.stones) visited.add(`${sr},${sc}`);

        // 检查该块的所有气是否都被对方包围
        // 方法：对每个气点做 BFS，看其连通空区域是否只接触对方棋子
        let allLibsEnclosed = grp.liberties.length > 0;
        for (const [lr, lc] of grp.liberties) {
          if (!this._isEnclosedBy(lr, lc, opp)) {
            allLibsEnclosed = false;
            break;
          }
        }
        if (allLibsEnclosed) {
          for (const [sr, sc] of grp.stones) dead.add(`${sr},${sc}`);
        }
      }
    }
    return dead;
  }

  // 判断空点 (r,c) 所在的连通空区域是否只被 color 方包围
  _isEnclosedBy(r, c, color) {
    const n = this.size;
    const visited = new Set();
    const queue = [[r, c]];
    visited.add(`${r},${c}`);
    let touchOther = false;
    while (queue.length) {
      const [cr, cc] = queue.shift();
      for (const [nr, nc] of this.neighbors(cr, cc)) {
        const nv = this.board[nr][nc];
        if (nv === -color) { touchOther = true; break; }
        if (nv === 0) {
          const nk = `${nr},${nc}`;
          if (!visited.has(nk)) { visited.add(nk); queue.push([nr, nc]); }
        }
      }
      if (touchOther) break;
    }
    return !touchOther;
  }

  // ---- 计分（中国规则：数子法）----
  // 步骤：① 识别死子 ② 从棋盘移除死子（计入对方提子）③ 数活子+围空 ④ 双活公气各半 ⑤ 加贴目
  score() {
    const n = this.size;

    // 1. 在克隆棋盘上操作，不影响实际对局
    const board = this.board.map(r => [...r]);

    // 2. 识别并清除死子（死子归对方所有，清除后变为空点）
    const dead = this._findDeadStones();
    let deadBlack = 0, deadWhite = 0;
    for (const key of dead) {
      const [r, c] = key.split(',').map(Number);
      if (board[r][c] === 1) { deadBlack++; board[r][c] = 0; }
      else if (board[r][c] === -1) { deadWhite++; board[r][c] = 0; }
    }

    // 3. 统计活子数
    let blackScore = 0, whiteScore = 0;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (board[r][c] === 1) blackScore++;
        else if (board[r][c] === -1) whiteScore++;
      }

    // 4. 统计空点归属（BFS 洪水填充）
    //    - 只接触黑子 → 黑方领地
    //    - 只接触白子 → 白方领地
    //    - 双方都接触（双活公气）→ 各得一半（奇数时黑多1）
    const visited = Array.from({ length: n }, () => new Array(n).fill(false));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[r][c] !== 0 || visited[r][c]) continue;
        const region = [];
        let touchBlack = false, touchWhite = false;
        const queue = [[r, c]];
        visited[r][c] = true;
        while (queue.length) {
          const [cr, cc] = queue.shift();
          region.push([cr, cc]);
          for (const [nr, nc] of this.neighbors(cr, cc)) {
            if (board[nr][nc] === 1) touchBlack = true;
            else if (board[nr][nc] === -1) touchWhite = true;
            else if (!visited[nr][nc]) {
              visited[nr][nc] = true;
              queue.push([nr, nc]);
            }
          }
        }
        if (touchBlack && !touchWhite) {
          blackScore += region.length;
        } else if (touchWhite && !touchBlack) {
          whiteScore += region.length;
        } else if (touchBlack && touchWhite) {
          // 双活公气：各得一半，奇数时黑多1（先手优势）
          const half = Math.floor(region.length / 2);
          blackScore += half + (region.length % 2);
          whiteScore += half;
        }
        // 无主空（既不接触黑也不接触白）：不计入任何一方（理论上终局不应存在）
      }
    }

    // 5. 贴目（白方加 komi）
    whiteScore += this.komi;

    // 6. 返回结果（数子法：子+空，单位"子"；diff 用目数表示更直观，除以2近似）
    const diff = Math.abs(blackScore - whiteScore);
    return {
      black: blackScore,
      white: whiteScore,
      deadBlack,   // 被提的黑死子数
      deadWhite,   // 被提的白死子数
      winner: blackScore > whiteScore ? 'black' : 'white',
      diff: diff.toFixed(1),          // 子数差
      diffMoku: (diff / 2).toFixed(1) // 近似目数差（供显示参考）
    };
  }

  // ---- 获取所有合法落点 ----
  getLegalMoves(color) {
    const moves = [];
    const n = this.size;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (this.board[r][c] !== 0) continue;
        if (this.koPoint && this.koPoint[0] === r && this.koPoint[1] === c) continue;
        if (this._isLegal(r, c, color)) moves.push([r, c]);
      }
    }
    return moves;
  }

  _isLegal(r, c, color) {
    if (this.board[r][c] !== 0) return false;
    const opp = -color;
    // 临时落子测试
    this.board[r][c] = color;
    // 能提对方子 → 合法
    let canCapture = false;
    for (const [nr, nc] of this.neighbors(r, c)) {
      if (this.board[nr][nc] === opp && this.getLibertyCount(nr, nc) === 0) {
        canCapture = true; break;
      }
    }
    // 自己有气 → 合法
    const hasLiberty = this.getLibertyCount(r, c) > 0;
    this.board[r][c] = 0;
    return canCapture || hasLiberty;
  }

  // ---- 棋子状态（用于表情）----
  // 返回每个棋子的气数
  getBoardLiberties() {
    const n = this.size;
    const result = Array.from({ length: n }, () => new Array(n).fill(0));
    const computed = new Set();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (this.board[r][c] === 0) continue;
        const key = r * n + c;
        if (computed.has(key)) continue;
        const grp = this.getGroup(r, c);
        const libs = grp.liberties.length;
        for (const [sr, sc] of grp.stones) {
          result[sr][sc] = libs;
          computed.add(sr * n + sc);
        }
      }
    }
    return result;
  }

  // 克隆引擎（供AI使用）
  clone() {
    const e = new GoEngine(this.size, this.komi);
    e.board = this.board.map(r => [...r]);
    e.turn = this.turn;
    e.capturedBlack = this.capturedBlack;
    e.capturedWhite = this.capturedWhite;
    e.koPoint = this.koPoint ? [...this.koPoint] : null;
    e.moveCount = this.moveCount;
    e.passCount = this.passCount;
    e.gameOver = this.gameOver;
    e.lastMove = this.lastMove ? [...this.lastMove] : null;
    return e;
  }
}
