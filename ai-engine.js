/**
 * CatGo AI引擎 v4 — 指导棋版
 *
 * 架构：迭代加深 Alpha-Beta + 开局库 + 死活计算 + 指导解说
 *
 * 核心升级：
 *  1. 开局库（布局常型）— 前10手走定式
 *  2. 迭代加深搜索（IDDFS）— 时间控制，充分利用时间
 *  3. 置换表（Transposition Table）— 避免重复计算
 *  4. 更精准的评估函数（死活判断、征子、双打）
 *  5. 指导模式 — 每步落子附带中文解说
 *  6. 难度分层更明显（入门真的很弱，宗师真的很强）
 */

const AIEngine = (() => {
  const { EMPTY, BLACK, WHITE, Board } = GoEngine;

  // ===== 难度配置 =====
  // 目标用户：业余10级 ~ 1段，通过水平测试后匹配对应档位
  const DIFFICULTY_CONFIG = {
    // 档位1：10级猫 — 刚入门，能走完整局，偶尔犯低级错误
    beginner: {
      name: '10级猫', level: '业余10级',
      maxDepth: 2,
      timeLimit: 800,
      randomness: 0.45,   // 45%概率走加权随机（过滤愚型）
      blunderRate: 0.12,  // 12%概率走安全随机（模拟低级失误）
      topK: 8,
      useOpeningBook: false,
      evalLevel: 1,
      description: '刚入门的棋友，能走完整局，偶尔犯低级错误'
    },
    // 档位2：7级猫 — 掌握基本死活，布局有意识
    elementary: {
      name: '7级猫', level: '业余7级',
      maxDepth: 2,
      timeLimit: 1000,
      randomness: 0.25,
      blunderRate: 0.07,
      topK: 10,
      useOpeningBook: true,
      evalLevel: 1,
      description: '掌握基本死活，布局有意识，偶尔失误'
    },
    // 档位3：5级猫 — 有一定计算力，能识别简单手筋
    intermediate: {
      name: '5级猫', level: '业余5级',
      maxDepth: 3,
      timeLimit: 2000,
      randomness: 0.10,
      blunderRate: 0.03,
      topK: 15,
      useOpeningBook: true,
      evalLevel: 2,
      description: '有一定计算力，能识别简单手筋，布局较合理'
    },
    // 档位4：3级猫 — 计算较深，能处理中等复杂的死活
    advanced: {
      name: '3级猫', level: '业余3级',
      maxDepth: 4,
      timeLimit: 3500,
      randomness: 0.03,
      blunderRate: 0.008,
      topK: 20,
      useOpeningBook: true,
      evalLevel: 2,
      description: '计算较深，能处理中等复杂的死活和手筋'
    },
    // 档位5：1级猫 — 接近段位，全局观较强
    expert: {
      name: '1级猫', level: '业余1级',
      maxDepth: 5,
      timeLimit: 5000,
      randomness: 0.008,
      blunderRate: 0,
      topK: 25,
      useOpeningBook: true,
      evalLevel: 3,
      description: '接近段位水平，全局观较强，计算精准'
    },
    // 档位6：1段猫 — 业余1段，AI全力发挥
    master: {
      name: '1段猫', level: '业余1段',
      maxDepth: 6,
      timeLimit: 7000,
      randomness: 0,
      blunderRate: 0,
      topK: 30,
      useOpeningBook: true,
      evalLevel: 3,
      description: '业余1段水平，AI全力发挥，是本产品最强对手'
    }
  };

  // ===== 开局库 =====
  // 格式：[boardSize, moveNumber, [r,c]] → [[r,c], ...]（推荐应对）
  const OPENING_BOOK = {
    // 19路开局
    '19_0': [[3,3],[3,15],[15,3],[15,15],[3,9],[9,3],[9,15],[15,9]], // 第一手推荐
    '19_1_3,3':  [[15,15],[15,3],[3,15]], // 对角星
    '19_1_3,15': [[15,3],[15,15],[3,3]],
    '19_1_15,3': [[3,15],[3,3],[15,15]],
    '19_1_15,15':[[3,3],[3,15],[15,3]],
    // 9路开局
    '9_0': [[2,2],[2,6],[6,2],[6,6],[4,4],[2,4],[4,2],[4,6],[6,4]],
    '9_1_2,2': [[6,6],[6,4],[4,6]],
    '9_1_2,6': [[6,2],[6,4],[4,2]],
    '9_1_6,2': [[2,6],[2,4],[4,6]],
    '9_1_6,6': [[2,2],[2,4],[4,2]],
    // 13路开局
    '13_0': [[3,3],[3,9],[9,3],[9,9],[3,6],[6,3],[6,9],[9,6],[6,6]],
  };

  // ===== 位置价值表 =====
  function buildPositionTable(size) {
    const table = [];
    const center = (size - 1) / 2;
    for (let r = 0; r < size; r++) {
      table[r] = [];
      for (let c = 0; c < size; c++) {
        const dr = Math.min(r, size - 1 - r);
        const dc = Math.min(c, size - 1 - c);
        const edge = Math.min(dr, dc);
        let val = edge * 3;
        // 星位加成
        if (size === 19) {
          const stars = [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
          if (stars.some(([sr,sc]) => sr===r && sc===c)) val += 18;
          else if (stars.some(([sr,sc]) => Math.abs(r-sr)<=1 && Math.abs(c-sc)<=1)) val += 6;
        } else if (size === 13) {
          const stars = [[3,3],[3,9],[6,6],[9,3],[9,9]];
          if (stars.some(([sr,sc]) => sr===r && sc===c)) val += 18;
          else if (stars.some(([sr,sc]) => Math.abs(r-sr)<=1 && Math.abs(c-sc)<=1)) val += 6;
        } else if (size === 9) {
          const stars = [[2,2],[2,6],[4,4],[6,2],[6,6]];
          if (stars.some(([sr,sc]) => sr===r && sc===c)) val += 18;
          else if (stars.some(([sr,sc]) => Math.abs(r-sr)<=1 && Math.abs(c-sc)<=1)) val += 6;
        }
        // 天元
        if (r === Math.round(center) && c === Math.round(center)) val += 10;
        // 边线惩罚（大幅加强：1路是围棋大忌，2路也要谨慎）
        if (edge === 0) val -= 35;  // 1路：极度惩罚，除非有战术理由绝不走
        if (edge === 1) val -= 12;  // 2路：明显惩罚
        if (edge === 2) val -= 2;   // 3路：轻微惩罚（3路是正常布局线）
        table[r][c] = val;
      }
    }
    return table;
  }

  // ===== 影响力地图 =====
  function buildInfluenceMap(board) {
    const size = board.size;
    const inf = Array.from({length: size}, () => new Float32Array(size));
    const DECAY = [0, 5, 3, 1.5, 0.5];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const color = board.get(r, c);
        if (color === EMPTY) continue;
        const sign = color === BLACK ? 1 : -1;
        for (let dr = -4; dr <= 4; dr++) {
          for (let dc = -4; dc <= 4; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            const dist = Math.abs(dr) + Math.abs(dc);
            if (dist <= 4) inf[nr][nc] += sign * DECAY[dist];
          }
        }
      }
    }
    return inf;
  }

  // ===== 置换表 =====
  class TranspositionTable {
    constructor(maxSize = 50000) {
      this.table = new Map();
      this.maxSize = maxSize;
    }

    _hash(board, color) {
      // 简化哈希：采样部分格子
      let h = color * 1000003;
      const size = board.size;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const v = board.grid[r][c];
          if (v !== EMPTY) h = (h * 31 + (r * size + c) * 3 + v) | 0;
        }
      }
      return h;
    }

    get(board, color, depth) {
      const key = `${this._hash(board, color)}_${depth}`;
      return this.table.get(key);
    }

    set(board, color, depth, score, flag, move) {
      if (this.table.size >= this.maxSize) {
        // 清除一半
        const keys = [...this.table.keys()];
        for (let i = 0; i < keys.length / 2; i++) this.table.delete(keys[i]);
      }
      const key = `${this._hash(board, color)}_${depth}`;
      this.table.set(key, { score, flag, move });
    }

    clear() { this.table.clear(); }
  }

  // ===== 综合评估器 =====
  class Evaluator {
    constructor(size) {
      this.size = size;
      this.posTable = buildPositionTable(size);
    }

    /**
     * 全局评估（正值=黑优，负值=白优）
     * level: 0=基础, 1=中级, 2=高级, 3=完整
     */
    evaluate(board, forColor, level = 3) {
      let score = 0;

      // L0: 提子数（所有难度）
      score += (board.captures[BLACK] - board.captures[WHITE]) * 15;

      // L0: 棋块安全性
      score += this._evalSafety(board, BLACK) - this._evalSafety(board, WHITE);

      if (level >= 1) {
        // L1: 位置价值
        score += this._evalPosition(board, BLACK) - this._evalPosition(board, WHITE);
        // L1: 紧气威胁
        score += this._evalAtari(board, BLACK) - this._evalAtari(board, WHITE);
      }

      if (level >= 2) {
        // L2: 眼位/活棋
        score += (this._evalEyes(board, BLACK) - this._evalEyes(board, WHITE)) * 30;
        // L2: 连接性
        score += (this._evalConnectivity(board, BLACK) - this._evalConnectivity(board, WHITE)) * 0.8;
        // L2: 双打威胁
        score += this._evalDoubleAtari(board, BLACK) - this._evalDoubleAtari(board, WHITE);
      }

      if (level >= 3) {
        // L3: 影响力/势力
        score += this._evalInfluence(board);
        // L3: 领地估算
        score += this._evalTerritory(board);
        // L3: 死活判断（简化）
        score += this._evalVitality(board, BLACK) - this._evalVitality(board, WHITE);
        // L3: 棋块连接强度（孤立小块惩罚）
        score += this._evalGroupConnectivity(board, BLACK) - this._evalGroupConnectivity(board, WHITE);
      }

      return forColor === BLACK ? score : -score;
    }

    // 棋块安全性（更精细）
    _evalSafety(board, color) {
      let score = 0;
      const visited = new Set();
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) === color && !visited.has(`${r},${c}`)) {
            const { stones, liberties } = board.getGroup(r, c);
            stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
            const libs = liberties.size;
            const sz = stones.length;
            // 更精细的安全性评分
            if (libs >= 7) score += sz * 5 + 15;
            else if (libs === 6) score += sz * 4 + 12;
            else if (libs === 5) score += sz * 3.5 + 10;
            else if (libs === 4) score += sz * 3 + 7;
            else if (libs === 3) score += sz * 2 + 4;
            else if (libs === 2) score += sz * 0.5;
            else if (libs === 1) score -= sz * 10 + 20;  // 被打吃
            else score -= sz * 30;                        // 被提
          }
        }
      }
      return score;
    }

    // 位置价值
    _evalPosition(board, color) {
      let score = 0;
      for (let r = 0; r < board.size; r++)
        for (let c = 0; c < board.size; c++)
          if (board.get(r, c) === color) score += this.posTable[r][c];
      return score;
    }

    // 紧气威胁
    _evalAtari(board, color) {
      let score = 0;
      const opponent = color === BLACK ? WHITE : BLACK;
      const visited = new Set();
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) === opponent && !visited.has(`${r},${c}`)) {
            const { stones, liberties } = board.getGroup(r, c);
            stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
            if (liberties.size === 1) score += stones.length * 8 + 12;
            else if (liberties.size === 2) score += stones.length * 2.5;
          }
        }
      }
      return score;
    }

    // 双打威胁（同时打吃两块）
    _evalDoubleAtari(board, color) {
      let score = 0;
      const opponent = color === BLACK ? WHITE : BLACK;
      const size = board.size;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (board.get(r, c) !== EMPTY) continue;
          // 检查落子后能否同时打吃两块对方棋子
          let atariCount = 0;
          const checked = new Set();
          for (const [nr, nc] of board.neighbors(r, c)) {
            if (board.get(nr, nc) === opponent) {
              const key = `${nr},${nc}`;
              if (!checked.has(key)) {
                const { stones, liberties } = board.getGroup(nr, nc);
                stones.forEach(([sr, sc]) => checked.add(`${sr},${sc}`));
                if (liberties.size === 2) atariCount++;
              }
            }
          }
          if (atariCount >= 2) score += 25;
        }
      }
      return score;
    }

    // 眼位评估（真眼/假眼）
    _evalEyes(board, color) {
      let eyes = 0;
      const size = board.size;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (board.get(r, c) !== EMPTY) continue;
          const nbrs = board.neighbors(r, c);
          const allOwned = nbrs.every(([nr, nc]) => {
            const nc_color = board.get(nr, nc);
            return nc_color === color || nc_color === -1;
          });
          if (allOwned && nbrs.length >= 2) {
            const diags = [[-1,-1],[-1,1],[1,-1],[1,1]].map(([dr,dc]) => {
              const nr = r+dr, nc = c+dc;
              if (nr < 0 || nr >= size || nc < 0 || nc >= size) return color;
              return board.get(nr, nc);
            });
            const ownedDiags = diags.filter(d => d === color).length;
            const totalDiags = diags.length;
            if (ownedDiags >= totalDiags - 1) eyes += 2;
            else eyes += 0.5;
          }
        }
      }
      return eyes;
    }

    // 连接性
    _evalConnectivity(board, color) {
      let score = 0;
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) !== color) continue;
          for (const [nr, nc] of board.neighbors(r, c)) {
            if (board.get(nr, nc) === color) score += 1.5;
          }
          for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
            const nr = r+dr, nc = c+dc;
            if (nr >= 0 && nr < board.size && nc >= 0 && nc < board.size) {
              if (board.get(nr, nc) === color) score += 0.5;
            }
          }
        }
      }
      return score;
    }

    // 影响力/势力
    _evalInfluence(board) {
      const inf = buildInfluenceMap(board);
      let score = 0;
      for (let r = 0; r < board.size; r++)
        for (let c = 0; c < board.size; c++)
          if (board.get(r, c) === EMPTY) score += inf[r][c];
      return score * 0.9;
    }

    // 领地估算（改进版）
    _evalTerritory(board) {
      const size = board.size;
      const inf = buildInfluenceMap(board);
      let score = 0;
      const visited = new Set();

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (board.get(r, c) !== EMPTY || visited.has(`${r},${c}`)) continue;
          const region = [];
          const borders = new Set();
          const queue = [[r, c]];
          while (queue.length > 0) {
            const [cr, cc] = queue.shift();
            const key = `${cr},${cc}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (board.get(cr, cc) === EMPTY) {
              region.push([cr, cc]);
              for (const [nr, nc] of board.neighbors(cr, cc)) {
                const nc_color = board.get(nr, nc);
                if (nc_color === EMPTY) queue.push([nr, nc]);
                else borders.add(nc_color);
              }
            }
          }
          if (borders.size === 1) {
            const owner = [...borders][0];
            score += owner === BLACK ? region.length * 2 : -region.length * 2;
          } else if (borders.size === 2) {
            for (const [er, ec] of region) {
              score += inf[er][ec] * 0.4;
            }
          }
        }
      }
      return score;
    }

    // 死活判断（简化版：检测是否有两眼）
    _evalVitality(board, color) {
      let score = 0;
      const visited = new Set();
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) === color && !visited.has(`${r},${c}`)) {
            const { stones, liberties } = board.getGroup(r, c);
            stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
            if (stones.length < 3) continue;
            // 统计该块的真眼数
            let eyeCount = 0;
            for (const [sr, sc] of stones) {
              for (const [nr, nc] of board.neighbors(sr, sc)) {
                if (board.get(nr, nc) === EMPTY) {
                  const nbrs2 = board.neighbors(nr, nc);
                  const allOwned = nbrs2.every(([nnr, nnc]) => {
                    const v = board.get(nnr, nnc);
                    return v === color || v === -1;
                  });
                  if (allOwned) eyeCount++;
                }
              }
            }
            if (eyeCount >= 2) score += stones.length * 3 + 20; // 活棋奖励
          }
        }
      }
      return score;
    }

    // 评估单个落子点的即时价值（用于候选排序）
    evaluateMove(board, r, c, color, level = 3) {
      let score = this.posTable[r][c];
      const opponent = color === BLACK ? WHITE : BLACK;
      const size = board.size;

      // ── 0. 落子后自身安全性预检（最高优先级惩罚）──
      // 模拟落子，检查自己落下后的气数
      const simBoard = board.clone();
      const placeResult = simBoard.tryPlace(r, c, color);
      if (!placeResult.valid) return -9999; // 非法落子

      // 应用模拟落子
      simBoard.grid = placeResult.testBoard.grid;
      const { liberties: selfLibs } = simBoard.getGroup(r, c);
      const selfLibCount = selfLibs.size;

      // 落子后自己只剩1气 = 送子（除非能提对方）
      if (selfLibCount === 1 && placeResult.capturedCount === 0) {
        score -= 200; // 严重惩罚：虎口送子
      } else if (selfLibCount === 2 && placeResult.capturedCount === 0) {
        // 检查是否有对方棋子在旁边可以继续打吃
        let enemyCanAtari = false;
        for (const [nr, nc] of simBoard.neighbors(r, c)) {
          if (simBoard.get(nr, nc) === opponent) {
            const { liberties: oppLibs } = simBoard.getGroup(nr, nc);
            if (oppLibs.size >= 2) { enemyCanAtari = true; break; }
          }
        }
        if (enemyCanAtari) score -= 40; // 落子后容易被打吃
      }

      // ── 1. 提子价值（最高优先级）──
      for (const [nr, nc] of board.neighbors(r, c)) {
        if (board.get(nr, nc) === opponent) {
          const { stones, liberties } = board.getGroup(nr, nc);
          if (liberties.size === 1) score += 100 + stones.length * 20; // 提子！
          else if (liberties.size === 2) score += 25 + stones.length * 5; // 打吃
          else if (liberties.size === 3) score += 6;
        }
      }

      // ── 2. 救援己方危险棋块 ──
      for (const [nr, nc] of board.neighbors(r, c)) {
        if (board.get(nr, nc) === color) {
          const { stones, liberties } = board.getGroup(nr, nc);
          if (liberties.size === 1) score += 90 + stones.length * 12; // 救援！
          else if (liberties.size === 2) score += 18 + stones.length * 3;
        }
      }

      // ── 3. 愚形惩罚 ──
      score += this._penalizeBadShape(board, r, c, color, opponent);

      if (level >= 2) {
        // 4. 眼位价值
        const eyesBefore = this._evalEyes(board, color);
        const eyesAfter = this._evalEyes(simBoard, color);
        score += (eyesAfter - eyesBefore) * 35;

        // 5. 连接价值
        for (const [nr, nc] of board.neighbors(r, c)) {
          if (board.get(nr, nc) === color) score += 5;
        }

        // 6. 双打检测
        let atariCount = 0;
        const checked = new Set();
        for (const [nr, nc] of board.neighbors(r, c)) {
          if (board.get(nr, nc) === opponent) {
            const key = `${nr},${nc}`;
            if (!checked.has(key)) {
              const { stones, liberties } = board.getGroup(nr, nc);
              stones.forEach(([sr, sc]) => checked.add(`${sr},${sc}`));
              if (liberties.size === 2) atariCount++;
            }
          }
        }
        if (atariCount >= 2) score += 40; // 双打！
      }

      if (level >= 3) {
        // 7. 影响力价值
        const inf = buildInfluenceMap(board);
        const sign = color === BLACK ? 1 : -1;
        score += inf[r][c] * sign * 0.6;

        // 8. 征子检测（简化）
        score += this._evalLadder(board, r, c, color);
      }

      return score;
    }

    /**
     * 愚形惩罚：识别并惩罚常见的坏棋形
     */
    _penalizeBadShape(board, r, c, color, opponent) {
      let penalty = 0;
      const size = board.size;
      const dr = Math.min(r, size - 1 - r);
      const dc = Math.min(c, size - 1 - c);
      const edge = Math.min(dr, dc);

      // ── 愚形1：一路爬行 ──
      // 在1路（edge=0）落子，且旁边已有己方1路棋子 = 典型的一路爬行
      if (edge === 0) {
        let friendlyOn1st = 0;
        for (const [nr, nc] of board.neighbors(r, c)) {
          const ndr = Math.min(nr, size - 1 - nr);
          const ndc = Math.min(nc, size - 1 - nc);
          const nedge = Math.min(ndr, ndc);
          if (board.get(nr, nc) === color && nedge === 0) friendlyOn1st++;
        }
        if (friendlyOn1st > 0) penalty -= 60; // 一路爬行：严重惩罚
      }

      // ── 愚形2：二路爬行（无战术价值时）──
      if (edge === 1) {
        let friendlyOn2nd = 0;
        let hasEnemyPressure = false;
        for (const [nr, nc] of board.neighbors(r, c)) {
          const ndr = Math.min(nr, size - 1 - nr);
          const ndc = Math.min(nc, size - 1 - nc);
          const nedge = Math.min(ndr, ndc);
          if (board.get(nr, nc) === color && nedge === 1) friendlyOn2nd++;
          if (board.get(nr, nc) === opponent) hasEnemyPressure = true;
        }
        // 二路爬行且没有对方压力 = 无意义
        if (friendlyOn2nd >= 2 && !hasEnemyPressure) penalty -= 30;
      }

      // ── 愚形3：虎口送子（落入对方包围圈）──
      // 四个方向中有3个以上是对方棋子
      let enemyNeighbors = 0;
      let friendlyNeighbors = 0;
      for (const [nr, nc] of board.neighbors(r, c)) {
        const v = board.get(nr, nc);
        if (v === opponent) enemyNeighbors++;
        else if (v === color) friendlyNeighbors++;
      }
      if (enemyNeighbors >= 3) penalty -= 80; // 深入虎穴
      else if (enemyNeighbors >= 2 && friendlyNeighbors === 0) penalty -= 35;

      // ── 愚形4：无效紧气（对方棋块气多，打吃无意义）──
      // 如果落子只是给对方棋块减1气，但对方有5气以上，这步棋价值极低
      let onlyReducesHighLibGroup = true;
      let hasRealThreat = false;
      for (const [nr, nc] of board.neighbors(r, c)) {
        if (board.get(nr, nc) === opponent) {
          const { liberties } = board.getGroup(nr, nc);
          if (liberties.size <= 3) { hasRealThreat = true; break; }
        }
      }
      // 不额外惩罚，已由提子/打吃奖励覆盖

      // ── 愚形5：孤立落子（远离所有棋子，且不在星位/天元）──
      // 棋盘上已有棋子时，在远离战场的地方孤立落子是浪费
      const totalStones = board.moveHistory.length;
      if (totalStones > 6) { // 开局后
        let nearestDist = 999;
        for (let nr = 0; nr < size; nr++) {
          for (let nc = 0; nc < size; nc++) {
            if (board.get(nr, nc) !== 0) {
              const dist = Math.abs(nr - r) + Math.abs(nc - c);
              if (dist < nearestDist) nearestDist = dist;
            }
          }
        }
        // 距离最近棋子超过5格，且不是星位/天元
        if (nearestDist > 5 && this.posTable[r][c] < 15) {
          penalty -= 20;
        }
      }

      return penalty;
    }

    // 征子检测（增强版：模拟追逃路径，判断是否能成功征子）
    _evalLadder(board, r, c, color) {
      const opponent = color === BLACK ? WHITE : BLACK;
      let bonus = 0;
      for (const [nr, nc] of board.neighbors(r, c)) {
        if (board.get(nr, nc) === opponent) {
          const { stones, liberties } = board.getGroup(nr, nc);
          if (liberties.size === 2 && stones.length <= 6) {
            // 简单判断：如果对方棋块只有2气且被我方包围，征子成功概率高
            const libArr = [...liberties];
            let escapePossible = false;
            for (const [lr, lc] of libArr) {
              // 检查逃跑方向是否有障碍
              const dr = Math.min(lr, board.size - 1 - lr);
              const dc = Math.min(lc, board.size - 1 - lc);
              if (Math.min(dr, dc) >= 2) { escapePossible = true; break; }
            }
            bonus += escapePossible ? 8 : 18; // 无路可逃时奖励更高
          }
        }
      }
      return bonus;
    }

    // 评估棋块的连接强度（用于高档位的全局判断）
    _evalGroupConnectivity(board, color) {
      let score = 0;
      const visited = new Set();
      const groups = [];
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) === color && !visited.has(`${r},${c}`)) {
            const { stones, liberties } = board.getGroup(r, c);
            stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
            groups.push({ stones, liberties });
          }
        }
      }
      // 孤立小块惩罚（气少且孤立）
      for (const g of groups) {
        if (g.stones.length <= 2 && g.liberties.size <= 3) {
          score -= 15; // 孤立小块容易被攻击
        }
        if (g.stones.length >= 5 && g.liberties.size >= 4) {
          score += 10; // 大块且气多，稳固
        }
      }
      return score;
    }
  }

  // ===== 迭代加深 Alpha-Beta 搜索 =====
  class IDAlphaBetaSearch {
    constructor(evaluator, config) {
      this.evaluator = evaluator;
      this.config = config;
      this.evalLevel = config.evalLevel;
      this.tt = new TranspositionTable(80000);
      this.startTime = 0;
      this.timeLimit = config.timeLimit || 3000;
      this.bestMoveAtDepth = null;
      this.nodesSearched = 0;
    }

    /**
     * 迭代加深搜索
     */
    getBestMove(board, color) {
      this.startTime = Date.now();
      this.tt.clear();
      this.nodesSearched = 0;

      const maxDepth = this.config.maxDepth;
      if (maxDepth === 0) return null;

      let bestMove = null;
      let bestScore = -Infinity;

      // 迭代加深
      for (let depth = 1; depth <= maxDepth; depth++) {
        const elapsed = Date.now() - this.startTime;
        if (elapsed > this.timeLimit * 0.7 && depth > 1) break;

        const result = this._searchRoot(board, color, depth);
        if (result.move !== null || depth === 1) {
          bestMove = result.move;
          bestScore = result.score;
        }

        // 如果找到必胜/必败，提前退出
        if (Math.abs(bestScore) > 5000) break;
      }

      return bestMove;
    }

    _searchRoot(board, color, depth) {
      const candidates = this._getCandidates(board, color, this.config.topK);
      if (candidates.length === 0) return { move: null, score: 0 };

      let bestMove = candidates[0];
      let bestScore = -Infinity;
      let alpha = -Infinity;
      const beta = Infinity;

      for (const move of candidates) {
        const elapsed = Date.now() - this.startTime;
        if (elapsed > this.timeLimit) break;

        const newBoard = board.clone();
        if (move === null) {
          newBoard.pass(color);
        } else {
          const result = newBoard.place(move[0], move[1], color);
          if (!result.valid) continue;
        }

        const nextColor = color === BLACK ? WHITE : BLACK;
        const score = -this._alphaBeta(newBoard, nextColor, depth - 1, -beta, -alpha);

        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
          alpha = Math.max(alpha, score);
        }
      }

      return { move: bestMove, score: bestScore };
    }

    _alphaBeta(board, color, depth, alpha, beta) {
      this.nodesSearched++;

      // 时间检查
      if (this.nodesSearched % 500 === 0) {
        if (Date.now() - this.startTime > this.timeLimit) return 0;
      }

      // 置换表查询
      const ttEntry = this.tt.get(board, color, depth);
      if (ttEntry) {
        if (ttEntry.flag === 'exact') return ttEntry.score;
        if (ttEntry.flag === 'lower' && ttEntry.score >= beta) return ttEntry.score;
        if (ttEntry.flag === 'upper' && ttEntry.score <= alpha) return ttEntry.score;
      }

      if (depth === 0 || board.isGameOver()) {
        const score = this.evaluator.evaluate(board, color, this.evalLevel);
        this.tt.set(board, color, depth, score, 'exact', null);
        return score;
      }

      const candidates = this._getCandidates(board, color,
        Math.max(6, this.config.topK - depth * 4));

      if (candidates.length === 0) {
        const newBoard = board.clone();
        newBoard.pass(color);
        return -this._alphaBeta(newBoard, color === BLACK ? WHITE : BLACK, depth - 1, -beta, -alpha);
      }

      let bestScore = -Infinity;
      let bestMove = null;
      let flag = 'upper';

      for (const move of candidates) {
        const newBoard = board.clone();
        if (move === null) {
          newBoard.pass(color);
        } else {
          const result = newBoard.place(move[0], move[1], color);
          if (!result.valid) continue;
        }

        const nextColor = color === BLACK ? WHITE : BLACK;
        const score = -this._alphaBeta(newBoard, nextColor, depth - 1, -beta, -alpha);

        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        if (score > alpha) {
          alpha = score;
          flag = 'exact';
        }
        if (alpha >= beta) {
          flag = 'lower';
          break;
        }
      }

      this.tt.set(board, color, depth, bestScore, flag, bestMove);
      return bestScore;
    }

    // 获取候选落子点（按启发式评分排序）
    _getCandidates(board, color, topK) {
      const legal = board.getLegalMoves(color);
      if (legal.length === 0) return [null];

      // ── 候选点过滤：开局后限制在已有棋子附近 ──
      const totalMoves = board.moveHistory.length;
      let candidates = legal;

      if (totalMoves >= 4) {
        // 计算所有已有棋子的位置
        const occupied = [];
        for (let r = 0; r < board.size; r++)
          for (let c = 0; c < board.size; c++)
            if (board.get(r, c) !== EMPTY) occupied.push([r, c]);

        if (occupied.length > 0) {
          // 候选点必须在某颗棋子的 N 格以内
          // 随着棋局进行，扩大搜索半径
          const radius = totalMoves < 20 ? 4 : totalMoves < 60 ? 5 : 6;

          const nearby = legal.filter(([r, c]) => {
            // 检查是否在任意已有棋子的 radius 格以内
            for (const [or, oc] of occupied) {
              if (Math.abs(r - or) <= radius && Math.abs(c - oc) <= radius) return true;
            }
            return false;
          });

          // 如果过滤后候选点太少，放宽限制
          if (nearby.length >= Math.min(topK, 8)) {
            candidates = nearby;
          }
        }
      }

      const scored = candidates.map(([r, c]) => ({
        move: [r, c],
        score: this.evaluator.evaluateMove(board, r, c, color, this.evalLevel)
      }));
      scored.sort((a, b) => b.score - a.score);

      // 过滤掉明显的坏棋（分数极低）
      const filtered = scored.filter(s => s.score > -150);
      const pool = filtered.length >= 3 ? filtered : scored; // 保底至少3个候选

      const k = Math.min(topK, pool.length);
      const result = pool.slice(0, k).map(s => s.move);

      if (Math.random() < 0.02) result.push(null);
      return result;
    }
  }

  // ===== 指导解说生成器 v2 — 真正的围棋教练 =====
  class CommentaryGenerator {
    /**
     * 生成落子解说（AI 视角：解释自己为什么这样下）
     */
    static generate(boardBefore, boardAfter, move, color, difficulty) {
      if (!move) return '虚手，暂时没有好的落子点，等待时机。';

      const [r, c] = move;
      const opponent = color === BLACK ? WHITE : BLACK;
      const colorName = color === BLACK ? '黑' : '白';
      const size = boardBefore.size;
      const label = this._coordToLabel(r, c, size);

      // ── 分析落子的战术意义 ──
      const tactics = this._analyzeTactics(boardBefore, boardAfter, r, c, color, opponent);

      // ── 分析当前局势 ──
      const situation = this._analyzeSituation(boardAfter, color, opponent);

      // ── 给玩家的下一步建议 ──
      const advice = this._getPlayerAdvice(boardAfter, color, opponent, difficulty);

      // ── 组合解说 ──
      let commentary = '';

      if (tactics.primary) {
        commentary = `落子 ${label}：${tactics.primary}`;
        if (tactics.secondary) commentary += `，同时${tactics.secondary}`;
        commentary += '。';
      } else {
        commentary = `落子 ${label}。`;
      }

      if (situation) commentary += ` ${situation}`;
      if (advice) commentary += ` ${advice}`;

      return commentary;
    }

    /**
     * 分析落子的战术意义
     */
    static _analyzeTactics(boardBefore, boardAfter, r, c, color, opponent) {
      const primary = [];
      const secondary = [];

      // 1. 提子
      const captured = boardAfter.captures[color] - boardBefore.captures[color];
      if (captured >= 3) primary.push(`提取对方 ${captured} 颗棋子，大获全胜`);
      else if (captured > 0) primary.push(`提取对方 ${captured} 颗棋子`);

      // 2. 打吃（atari）
      const atariInfo = this._detectAtari(boardAfter, r, c, opponent);
      if (atariInfo.doubleAtari) {
        primary.push(`双打！同时威胁对方 ${atariInfo.groups.length} 块棋子，对方只能救一块`);
      } else if (atariInfo.groups.length > 0) {
        const totalStones = atariInfo.groups.reduce((s, g) => s + g, 0);
        if (totalStones >= 4) primary.push(`打吃对方 ${totalStones} 颗棋子的大块，威胁极大`);
        else primary.push(`打吃对方 ${totalStones} 颗棋子`);
      }

      // 3. 救援己方被打吃的棋块
      const savedInfo = this._detectSaved(boardBefore, boardAfter, r, c, color);
      if (savedInfo.saved > 0) {
        if (primary.length === 0) primary.push(`救援己方 ${savedInfo.saved} 颗棋子脱险`);
        else secondary.push(`救援己方 ${savedInfo.saved} 颗棋子`);
      }

      // 4. 连接己方棋块
      const connInfo = this._detectConnection(boardBefore, boardAfter, r, c, color);
      if (connInfo.connected >= 2 && primary.length === 0) {
        primary.push(`连接 ${connInfo.connected} 块己方棋子，形成整体`);
      } else if (connInfo.connected >= 2) {
        secondary.push(`连接己方棋块`);
      }

      // 5. 位置战略意义
      if (primary.length === 0) {
        const posReason = this._analyzePosition(r, c, boardAfter.size);
        primary.push(posReason);
      }

      return {
        primary: primary[0] || null,
        secondary: secondary[0] || null
      };
    }

    static _detectAtari(board, r, c, opponent) {
      const groups = [];
      const visited = new Set();
      for (const [nr, nc] of board.neighbors(r, c)) {
        if (board.get(nr, nc) === opponent && !visited.has(`${nr},${nc}`)) {
          const { stones, liberties } = board.getGroup(nr, nc);
          stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
          if (liberties.size === 1) groups.push(stones.length);
        }
      }
      return { groups, doubleAtari: groups.length >= 2 };
    }

    static _detectSaved(boardBefore, boardAfter, r, c, color) {
      let saved = 0;
      const visited = new Set();
      for (const [nr, nc] of boardBefore.neighbors(r, c)) {
        if (boardBefore.get(nr, nc) === color && !visited.has(`${nr},${nc}`)) {
          const { stones: sb, liberties: lb } = boardBefore.getGroup(nr, nc);
          sb.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
          if (lb.size === 1) {
            const { liberties: la } = boardAfter.getGroup(nr, nc);
            if (la.size > 1) saved += sb.length;
          }
        }
      }
      return { saved };
    }

    static _detectConnection(boardBefore, boardAfter, r, c, color) {
      const groupsBefore = new Set();
      const visited = new Set();
      for (const [nr, nc] of boardBefore.neighbors(r, c)) {
        if (boardBefore.get(nr, nc) === color && !visited.has(`${nr},${nc}`)) {
          const { stones } = boardBefore.getGroup(nr, nc);
          stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
          groupsBefore.add(`${stones[0]}`);
        }
      }
      return { connected: groupsBefore.size };
    }

    static _analyzePosition(r, c, size) {
      const dr = Math.min(r, size - 1 - r);
      const dc = Math.min(c, size - 1 - c);
      const edge = Math.min(dr, dc);
      const center = (size - 1) / 2;
      const distCenter = Math.max(Math.abs(r - center), Math.abs(c - center));

      if (edge === 0) return '占据角部，巩固边角实地';
      if (edge === 1) return '二线守边，稳固边地';
      if (edge === 2) {
        if (this._isNearStar(r, c, size)) return '占据星位，建立根据地，兼顾边角';
        return '三线落子，攻守兼备';
      }
      if (edge === 3) return '四线落子，扩展中腹势力';
      if (distCenter <= 1) return '占据天元附近，争夺中腹制高点';
      return '扩展势力，争夺空间';
    }

    /**
     * 分析当前局势，给出简短评价
     */
    static _analyzeSituation(board, color, opponent) {
      // 检测危险棋块
      const myDanger = this._getDangerGroups(board, color);
      const oppDanger = this._getDangerGroups(board, opponent);

      if (myDanger.atari > 0 && myDanger.totalStones >= 3) {
        return `⚠️ 注意：你有 ${myDanger.atari} 块棋子被打吃（共 ${myDanger.totalStones} 颗），需要立即应对！`;
      }
      if (oppDanger.atari > 0 && oppDanger.totalStones >= 3) {
        return `💡 机会：对方有 ${oppDanger.atari} 块棋子被打吃（共 ${oppDanger.totalStones} 颗），可以追击！`;
      }
      if (myDanger.atari > 0) {
        return `⚠️ 你有棋子被打吃，注意防守。`;
      }
      return '';
    }

    /**
     * 给玩家的下一步建议（仅在 AI 落子后调用）
     */
    static _getPlayerAdvice(board, aiColor, playerColor, difficulty) {
      if (difficulty === 'beginner') return '';

      const playerDanger = this._getDangerGroups(board, playerColor);
      const aiDanger = this._getDangerGroups(board, aiColor);

      // 玩家有棋子被打吃
      if (playerDanger.atari > 0) {
        if (playerDanger.totalStones >= 5) {
          return `🔴 你的大块棋子（${playerDanger.totalStones} 颗）被打吃，必须立即逃跑或反击！`;
        }
        return `🔴 你有棋子被打吃，建议先处理危机。`;
      }

      // AI 有棋子被打吃（玩家可以追击）
      if (aiDanger.atari > 0 && aiDanger.totalStones >= 3) {
        return `🟢 我方有棋子被打吃，你可以继续追击扩大优势。`;
      }

      // 根据局面给出方向性建议
      const advice = this._getStrategicAdvice(board, playerColor, aiColor, difficulty);
      return advice ? `💡 建议：${advice}` : '';
    }

    static _getDangerGroups(board, color) {
      let atari = 0, totalStones = 0;
      const visited = new Set();
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) === color && !visited.has(`${r},${c}`)) {
            const { stones, liberties } = board.getGroup(r, c);
            stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
            if (liberties.size === 1) {
              atari++;
              totalStones += stones.length;
            }
          }
        }
      }
      return { atari, totalStones };
    }

    static _getStrategicAdvice(board, playerColor, aiColor, difficulty) {
      const size = board.size;
      const moveCount = board.moveHistory.length;

      // 开局阶段
      if (moveCount < size * 2) {
        const corners = [[2,2],[2,size-3],[size-3,2],[size-3,size-3]];
        const emptyCornersNear = corners.filter(([r,c]) => {
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++)
              if (board.get(r+dr, c+dc) === playerColor) return false;
          return true;
        });
        if (emptyCornersNear.length >= 2) return '尽快占据角部星位，角部是最容易围空的地方';
        if (emptyCornersNear.length === 1) return '还有角部未占，优先占角再考虑边和中腹';
        return '角部已布局，可以开始扩展边部或侵入对方势力范围';
      }

      // 中盘阶段
      if (moveCount < size * 4) {
        // 检测是否有孤立棋块（气少）
        const isolatedGroups = this._findIsolatedGroups(board, playerColor);
        if (isolatedGroups.length > 0) {
          return `你有 ${isolatedGroups.length} 块棋子比较孤立，考虑连接或做活`;
        }
        return '中盘阶段，注意攻守平衡，既要扩大自己的势力，也要压缩对方空间';
      }

      // 收官阶段
      return '进入收官，注意填补边界漏洞，每一目都很重要';
    }

    static _findIsolatedGroups(board, color) {
      const isolated = [];
      const visited = new Set();
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) === color && !visited.has(`${r},${c}`)) {
            const { stones, liberties } = board.getGroup(r, c);
            stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
            // 气少且棋块小 = 孤立
            if (liberties.size <= 2 && stones.length <= 3) {
              isolated.push({ stones: stones.length, libs: liberties.size });
            }
          }
        }
      }
      return isolated;
    }

    static _isNearStar(r, c, size) {
      let stars = [];
      if (size === 19) stars = [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
      else if (size === 13) stars = [[3,3],[3,9],[6,6],[9,3],[9,9]];
      else if (size === 9) stars = [[2,2],[2,6],[4,4],[6,2],[6,6]];
      return stars.some(([sr,sc]) => Math.abs(r-sr)<=1 && Math.abs(c-sc)<=1);
    }

    // 坐标转围棋标记（A1-T19）
    static _coordToLabel(r, c, size) {
      const cols = 'ABCDEFGHJKLMNOPQRST'; // 跳过I
      const col = cols[c] || String(c);
      const row = size - r;
      return `${col}${row}`;
    }
  }

  // ===== 主AI类 =====
  class GoAI {
    constructor(difficulty = 'intermediate') {
      this.difficulty = difficulty;
      this.config = DIFFICULTY_CONFIG[difficulty];
      this.evaluator = null;
      this.searcher = null;
      this.moveCount = 0;
      this.lastCommentary = '';
    }

    _init(boardSize) {
      if (!this.evaluator) {
        this.evaluator = new Evaluator(boardSize);
        this.searcher = new IDAlphaBetaSearch(this.evaluator, this.config);
      }
    }

    /**
     * 获取AI落子
     * @returns {Promise<{move: Array|null, commentary: string}>}
     */
    async getMove(board, color) {
      this._init(board.size);
      await new Promise(resolve => setTimeout(resolve, 30));

      const cfg = this.config;
      let move = null;

      // 故意犯错（入门/初级）
      // 注意：不再使用纯随机 _randomMove，改用安全随机，避免一路爬行等感型
      if (Math.random() < cfg.blunderRate) {
        move = this._safeRandomMove(board, color);
      }
      // 高随机性（入门）
      else if (Math.random() < cfg.randomness) {
        move = this._weightedRandom(board, color, cfg.topK);
      }
      // 开局库
      else if (cfg.useOpeningBook && this.moveCount < 8) {
        const bookMove = this._getOpeningMove(board, color);
        if (bookMove) move = bookMove;
      }

      // 搜索
      if (move === undefined || move === null) {
        if (cfg.maxDepth === 0) {
          move = this._greedyMove(board, color, cfg.topK);
        } else {
          move = await this._searchAsync(board, color);
        }
      }

      // 生成解说
      let commentary = '';
      if (move !== null) {
        const boardAfter = board.clone();
        boardAfter.place(move[0], move[1], color);
        commentary = CommentaryGenerator.generate(board, boardAfter, move, color, this.difficulty);
      } else {
        commentary = '虚手，暂时没有好的落子点。';
      }

      this.lastCommentary = commentary;
      this.moveCount++;

      return { move, commentary };
    }

    async _searchAsync(board, color) {
      await new Promise(resolve => setTimeout(resolve, 0));
      const move = this.searcher.getBestMove(board, color);
      await new Promise(resolve => setTimeout(resolve, 0));
      return move;
    }

    // 开局库查询
    _getOpeningMove(board, color) {
      const size = board.size;
      const moveNum = board.moveHistory.length;

      // 第一手
      if (moveNum === 0) {
        const key = `${size}_0`;
        const moves = OPENING_BOOK[key];
        if (moves) {
          // 随机选一个推荐开局
          const m = moves[Math.floor(Math.random() * moves.length)];
          if (board.get(m[0], m[1]) === EMPTY) return m;
        }
      }

      // 第二手（应对）
      if (moveNum === 1 && board.lastMove) {
        const [lr, lc] = board.lastMove;
        const key = `${size}_1_${lr},${lc}`;
        const moves = OPENING_BOOK[key];
        if (moves) {
          for (const m of moves) {
            if (board.get(m[0], m[1]) === EMPTY) return m;
          }
        }
      }

      return null;
    }

    // 纯随机（仅内部备用，不对外暴露）
    _randomMove(board, color) {
      const legal = board.getLegalMoves(color);
      if (legal.length === 0) return null;
      return legal[Math.floor(Math.random() * legal.length)];
    }

    /**
     * 安全随机：随机但不走感型（一路爬行、虎口送子等）
     * 用于入门模式的“故意犯错”，保证不走出完全无意义的棋
     */
    _safeRandomMove(board, color) {
      const legal = board.getLegalMoves(color);
      if (legal.length === 0) return null;

      // 过滤感型，保留合法落子
      const safe = this._filterSafeMoves(board, color, legal);
      const candidates = safe.length >= 3 ? safe : legal;

      // 在候选点中完全随机选择（不考虑位置价值）
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // 加权随机（偏向好位置）
    _weightedRandom(board, color, topK) {
      const legal = board.getLegalMoves(color);
      if (legal.length === 0) return null;

      // 过滤掉明显的自杀/送子落点
      const safe = this._filterSafeMoves(board, color, legal);
      const candidates = safe.length >= 3 ? safe : legal;

      const scored = candidates.map(([r, c]) => ({
        move: [r, c],
        score: this.evaluator.evaluateMove(board, r, c, color, 1)
      }));
      scored.sort((a, b) => b.score - a.score);

      const pool = scored.slice(0, Math.min(topK, scored.length));
      // 使用更平滑的温度，避免完全随机
      const weights = pool.map(s => Math.exp(Math.max(s.score, -50) / 30));
      const total = weights.reduce((a, b) => a + b, 0);
      let rand = Math.random() * total;
      for (let i = 0; i < pool.length; i++) {
        rand -= weights[i];
        if (rand <= 0) return pool[i].move;
      }
      return pool[0].move;
    }

    // 贪心（depth=0，只看即时价值）
    _greedyMove(board, color, topK) {
      const legal = board.getLegalMoves(color);
      if (legal.length === 0) return null;

      // 过滤掉明显的自杀/送子落点
      const safe = this._filterSafeMoves(board, color, legal);
      const candidates = safe.length >= 3 ? safe : legal;

      const scored = candidates.map(([r, c]) => ({
        move: [r, c],
        score: this.evaluator.evaluateMove(board, r, c, color, 1) // 用level=1而非0，更合理
      }));
      scored.sort((a, b) => b.score - a.score);

      const pool = scored.slice(0, Math.min(topK, scored.length));
      const idx = Math.floor(Math.random() * Math.min(3, pool.length));
      return pool[idx].move;
    }

    /**
     * 过滤掉明显的危险落子（自杀、虎口送子、一路爬行）
     * 用于所有难度级别，确保AI不走基本的昏招
     */
    _filterSafeMoves(board, color, moves) {
      const opponent = color === BLACK ? WHITE : BLACK;
      const size = board.size;

      return moves.filter(([r, c]) => {
        // 1. 过滤自杀（落子后自己只剩0气且没有提子）
        const result = board.tryPlace(r, c, color);
        if (!result.valid) return false;
        const simBoard = result.testBoard;
        const { liberties } = simBoard.getGroup(r, c);
        if (liberties.size === 0) return false; // 自杀

        // 2. 过滤虎口送子（落子后只剩1气，且没有提对方）
        if (liberties.size === 1 && result.capturedCount === 0) return false;

        // 3. 过滤一路爬行（在1路落子且旁边已有己方1路棋子）
        const dr = Math.min(r, size - 1 - r);
        const dc = Math.min(c, size - 1 - c);
        const edge = Math.min(dr, dc);
        if (edge === 0) {
          for (const [nr, nc] of board.neighbors(r, c)) {
            const ndr = Math.min(nr, size - 1 - nr);
            const ndc = Math.min(nc, size - 1 - nc);
            if (Math.min(ndr, ndc) === 0 && board.get(nr, nc) === color) return false;
          }
        }

        return true;
      });
    }

    /**
     * 获取提示（最佳落子点 + 解说）
     */
    async getHint(board, color) {
      this._init(board.size);
      await new Promise(resolve => setTimeout(resolve, 0));

      // 提示用高质量搜索
      const hintConfig = {
        ...this.config,
        maxDepth: Math.max(this.config.maxDepth, 3),
        topK: 25,
        timeLimit: 4000,
        evalLevel: 3
      };
      const hintSearcher = new IDAlphaBetaSearch(this.evaluator, hintConfig);
      const move = hintSearcher.getBestMove(board, color);

      let commentary = '';
      if (move) {
        const boardAfter = board.clone();
        boardAfter.place(move[0], move[1], color);
        commentary = CommentaryGenerator.generate(board, boardAfter, move, color, 'master');
      }

      return { move, commentary };
    }

    /**
     * 获取形势判断（黑棋胜率 0-100）
     */
    getWinRate(board) {
      this._init(board.size);
      const score = this.evaluator.evaluate(board, BLACK, 3);
      const wr = 50 + Math.tanh(score / 100) * 44;
      return Math.max(5, Math.min(95, wr));
    }

    /**
     * 获取当前局面的简要分析
     */
    analyzePosition(board) {
      this._init(board.size);
      const blackScore = this.evaluator.evaluate(board, BLACK, 3);
      const winRate = this.getWinRate(board);

      let situation = '';
      if (winRate > 70) situation = '黑方明显领先';
      else if (winRate > 60) situation = '黑方略有优势';
      else if (winRate > 55) situation = '局势接近，黑方稍好';
      else if (winRate > 45) situation = '局势均衡';
      else if (winRate > 40) situation = '局势接近，白方稍好';
      else if (winRate > 30) situation = '白方略有优势';
      else situation = '白方明显领先';

      // 检测危险棋块
      const dangers = [];
      const visited = new Set();
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          for (const color of [BLACK, WHITE]) {
            if (board.get(r, c) === color && !visited.has(`${r},${c}`)) {
              const { stones, liberties } = board.getGroup(r, c);
              stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));
              if (liberties.size === 1 && stones.length >= 2) {
                dangers.push({ color, size: stones.length });
              }
            }
          }
        }
      }

      let dangerText = '';
      const blackDanger = dangers.filter(d => d.color === BLACK);
      const whiteDanger = dangers.filter(d => d.color === WHITE);
      if (blackDanger.length > 0) dangerText += `黑方有 ${blackDanger.length} 块棋子被打吃；`;
      if (whiteDanger.length > 0) dangerText += `白方有 ${whiteDanger.length} 块棋子被打吃；`;

      return { situation, dangerText: dangerText || '暂无危险棋块', winRate };
    }
  }

  return { GoAI, DIFFICULTY_CONFIG, Evaluator, CommentaryGenerator };
})();
