/**
 * CatGo 围棋核心引擎
 * 实现围棋基本规则：落子、提子、气的计算、劫争检测
 */

const GoEngine = (() => {
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;

  class Board {
    constructor(size = 19) {
      this.size = size;
      this.grid = Array.from({ length: size }, () => new Array(size).fill(EMPTY));
      this.captures = { [BLACK]: 0, [WHITE]: 0 };
      this.history = []; // 用于劫争检测
      this.moveHistory = []; // 棋谱
      this.koPoint = null; // 劫争点
      this.lastMove = null;
      this.passCount = 0;
    }

    clone() {
      const b = new Board(this.size);
      b.grid = this.grid.map(row => [...row]);
      b.captures = { ...this.captures };
      b.history = [...this.history];
      b.moveHistory = [...this.moveHistory];
      b.koPoint = this.koPoint;
      b.lastMove = this.lastMove;
      b.passCount = this.passCount;
      return b;
    }

    // 获取某点的颜色
    get(r, c) {
      if (r < 0 || r >= this.size || c < 0 || c >= this.size) return -1;
      return this.grid[r][c];
    }

    // 获取相邻点
    neighbors(r, c) {
      const result = [];
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
          result.push([nr, nc]);
        }
      }
      return result;
    }

    // 获取一块棋子的所有成员（flood fill）
    getGroup(r, c) {
      const color = this.get(r, c);
      if (color === EMPTY) return { stones: [], liberties: new Set() };

      const stones = [];
      const liberties = new Set();
      const visited = new Set();
      const queue = [[r, c]];

      while (queue.length > 0) {
        const [cr, cc] = queue.shift();
        const key = `${cr},${cc}`;
        if (visited.has(key)) continue;
        visited.add(key);

        if (this.get(cr, cc) === color) {
          stones.push([cr, cc]);
          for (const [nr, nc] of this.neighbors(cr, cc)) {
            const nColor = this.get(nr, nc);
            if (nColor === EMPTY) {
              liberties.add(`${nr},${nc}`);
            } else if (nColor === color && !visited.has(`${nr},${nc}`)) {
              queue.push([nr, nc]);
            }
          }
        }
      }

      return { stones, liberties };
    }

    // 计算某点落子后的气数（用于AI评估）
    getLibertyCount(r, c) {
      const { liberties } = this.getGroup(r, c);
      return liberties.size;
    }

    // 获取所有棋块的气信息（用于猫咪显示）
    getAllGroupsInfo(color) {
      const visited = new Set();
      const groups = [];

      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (this.get(r, c) === color && !visited.has(`${r},${c}`)) {
            const { stones, liberties } = this.getGroup(r, c);
            stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
            groups.push({
              stones,
              liberties: liberties.size,
              color,
              center: this._groupCenter(stones)
            });
          }
        }
      }

      return groups;
    }

    _groupCenter(stones) {
      const r = Math.round(stones.reduce((s, [r]) => s + r, 0) / stones.length);
      const c = Math.round(stones.reduce((s, [, c]) => s + c, 0) / stones.length);
      return [r, c];
    }

    // 尝试落子，返回结果
    tryPlace(r, c, color) {
      if (this.get(r, c) !== EMPTY) return { valid: false, reason: '该位置已有棋子' };

      // 检查劫争
      if (this.koPoint && this.koPoint[0] === r && this.koPoint[1] === c) {
        return { valid: false, reason: '劫争，不能立即回提' };
      }

      // 模拟落子
      const testBoard = this.clone();
      testBoard.grid[r][c] = color;

      // 提取对方被围的棋子
      const opponent = color === BLACK ? WHITE : BLACK;
      let capturedCount = 0;
      const capturedStones = [];

      for (const [nr, nc] of testBoard.neighbors(r, c)) {
        if (testBoard.get(nr, nc) === opponent) {
          const { stones, liberties } = testBoard.getGroup(nr, nc);
          if (liberties.size === 0) {
            // 提子
            for (const [sr, sc] of stones) {
              testBoard.grid[sr][sc] = EMPTY;
              capturedStones.push([sr, sc]);
              capturedCount++;
            }
          }
        }
      }

      // 检查自杀（落子后自己的气为0且没有提子）
      const { liberties: selfLiberties } = testBoard.getGroup(r, c);
      if (selfLiberties.size === 0 && capturedCount === 0) {
        return { valid: false, reason: '禁止自杀' };
      }

      // 检查劫争（提了一个子，且落子后自己只有一口气）
      let newKoPoint = null;
      if (capturedCount === 1 && selfLiberties.size === 1) {
        const [capturedR, capturedC] = capturedStones[0];
        newKoPoint = [capturedR, capturedC];
      }

      // 检查全局同形（简化：只检查上一步）
      const boardHash = testBoard.getBoardHash();
      if (this.history.includes(boardHash)) {
        return { valid: false, reason: '全局同形（劫争）' };
      }

      return {
        valid: true,
        capturedStones,
        capturedCount,
        newKoPoint,
        boardHash,
        testBoard
      };
    }

    // 执行落子
    place(r, c, color) {
      const result = this.tryPlace(r, c, color);
      if (!result.valid) return result;

      // 保存历史（用于悔棋）
      this.history.push(this.getBoardHash());

      // 应用落子
      this.grid = result.testBoard.grid;
      this.captures[color] += result.capturedCount;
      this.koPoint = result.newKoPoint;
      this.lastMove = [r, c, color];
      this.passCount = 0;

      // 记录棋谱
      const colLabel = 'ABCDEFGHJKLMNOPQRST'[c];
      const rowLabel = this.size - r;
      this.moveHistory.push({
        move: this.moveHistory.length + 1,
        color,
        pos: `${colLabel}${rowLabel}`,
        r, c,
        captured: result.capturedCount
      });

      return { ...result, valid: true };
    }

    // 虚手
    pass(color) {
      this.passCount++;
      this.koPoint = null;
      this.lastMove = null;
      this.moveHistory.push({
        move: this.moveHistory.length + 1,
        color,
        pos: '虚手',
        r: -1, c: -1,
        captured: 0
      });
      return { valid: true, pass: true };
    }

    // 悔棋（需要保存完整历史）
    undo() {
      if (this.moveHistory.length === 0) return false;
      // 简化实现：重新从头播放
      return true;
    }

    // 获取棋盘哈希（用于劫争检测）
    getBoardHash() {
      return this.grid.map(row => row.join('')).join('|');
    }

    // 计算领地（中国规则：数子法）
    countScore() {
      const territory = { [BLACK]: 0, [WHITE]: 0 };
      const visited = new Set();

      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (this.get(r, c) === EMPTY && !visited.has(`${r},${c}`)) {
            // flood fill 找到这片空地
            const region = [];
            const borders = new Set();
            const queue = [[r, c]];

            while (queue.length > 0) {
              const [cr, cc] = queue.shift();
              const key = `${cr},${cc}`;
              if (visited.has(key)) continue;
              visited.add(key);

              if (this.get(cr, cc) === EMPTY) {
                region.push([cr, cc]);
                for (const [nr, nc] of this.neighbors(cr, cc)) {
                  const nColor = this.get(nr, nc);
                  if (nColor === EMPTY) {
                    queue.push([nr, nc]);
                  } else {
                    borders.add(nColor);
                  }
                }
              }
            }

            // 如果只被一种颜色包围，算该颜色的领地
            if (borders.size === 1) {
              const owner = [...borders][0];
              territory[owner] += region.length;
            }
          }
        }
      }

      // 加上棋盘上的棋子（中国规则）
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          const color = this.get(r, c);
          if (color !== EMPTY) territory[color]++;
        }
      }

      // 贴目规则（中国规则）：
      // 19路 → 7.5目，13路 → 7.5目，9路 → 6.5目
      // 9路棋盘因为总目数少（81目），贴目6.5更平衡
      const komi = this.size === 9 ? 6.5 : 7.5;

      return {
        black: territory[BLACK] + this.captures[BLACK],
        white: territory[WHITE] + this.captures[WHITE],
        komi
      };
    }

    // 获取合法落子点列表
    getLegalMoves(color) {
      const moves = [];
      for (let r = 0; r < this.size; r++) {
        for (let c = 0; c < this.size; c++) {
          if (this.tryPlace(r, c, color).valid) {
            moves.push([r, c]);
          }
        }
      }
      return moves;
    }

    // 检查游戏是否结束
    isGameOver() {
      return this.passCount >= 2;
    }
  }

  // 棋盘历史管理（用于悔棋）
  class GameHistory {
    constructor() {
      this.snapshots = [];
    }

    save(board) {
      this.snapshots.push({
        grid: board.grid.map(row => [...row]),
        captures: { ...board.captures },
        koPoint: board.koPoint,
        lastMove: board.lastMove,
        moveHistory: [...board.moveHistory],
        passCount: board.passCount
      });
    }

    restore(board) {
      if (this.snapshots.length === 0) return false;
      const snap = this.snapshots.pop();
      board.grid = snap.grid;
      board.captures = snap.captures;
      board.koPoint = snap.koPoint;
      board.lastMove = snap.lastMove;
      board.moveHistory = snap.moveHistory;
      board.passCount = snap.passCount;
      return true;
    }

    canUndo() {
      return this.snapshots.length > 0;
    }
  }

  return { Board, GameHistory, EMPTY, BLACK, WHITE };
})();
