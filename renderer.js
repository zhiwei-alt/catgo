/**
 * renderer.js — Canvas 绘制系统 v8
 *
 * 设计原则：
 *  - 手绘感：描边稍粗、轻微抖动、圆角柔和
 *  - 单颗棋子：圆形，有猫咪萌态表情（眼睛+嘴巴）
 *  - 连通群：圆角矩形整体，边缘显示猫咪表情
 *  - 无耳朵、无尾巴，简洁萌态
 *  - 桥宽略窄于棋子，保留棋盘线可见
 */
class GoRenderer {
  constructor(canvas, size) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.size   = size;
    this.resize();
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const maxW = wrap
      ? Math.min(wrap.clientWidth - 20, wrap.clientHeight - 20)
      : 600;
    const dim = Math.max(300, Math.min(maxW, 680));
    this.canvas.width  = dim;
    this.canvas.height = dim;
    this._calcLayout();
  }

  _calcLayout() {
    const n = this.size;
    const pad = this.canvas.width * 0.06;
    this.padding  = pad;
    this.cellSize = (this.canvas.width - pad * 2) / (n - 1);
    this.stoneR   = this.cellSize * 0.40;
  }

  toPixel(r, c) {
    return [
      this.padding + c * this.cellSize,
      this.padding + r * this.cellSize,
    ];
  }

  toBoard(px, py) {
    const r = Math.round((py - this.padding) / this.cellSize);
    const c = Math.round((px - this.padding) / this.cellSize);
    return [r, c];
  }

  // ============================================================
  //  主绘制入口
  // ============================================================
  drawBoard(engine, hoverPos, hintPos) {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const n   = this.size;

    ctx.clearRect(0, 0, W, W);
    this._drawBoardBg(ctx, W, n);

    if (hintPos) {
      const [hr, hc] = hintPos;
      if (engine.inBounds(hr, hc)) {
        const [hx, hy] = this.toPixel(hr, hc);
        ctx.save();
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth   = 2.5;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(hx, hy, this.stoneR * 0.92, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    const groups = this._computeGroups(engine);
    for (const grp of groups) {
      this._drawGroup(ctx, engine, grp);
    }

    if (hoverPos) {
      const [hr, hc] = hoverPos;
      if (engine.inBounds(hr, hc) && engine.board[hr][hc] === 0) {
        const [hx, hy] = this.toPixel(hr, hc);
        ctx.save();
        ctx.globalAlpha = 0.38;
        this._drawSingleCat(ctx, hx, hy, engine.turn, 1, this.stoneR);
        ctx.restore();
      }
    }

    if (engine.lastMove) {
      const [lr, lc] = engine.lastMove;
      if (engine.inBounds(lr, lc) && engine.board[lr][lc] !== 0) {
        const R = this.stoneR;
        const isBlack = engine.board[lr][lc] === 1;
        // 只在单颗棋子上显示落子标记（群形状本身已足够明显）
        const grp = groups.find(g => g.stones.some(([sr,sc]) => sr===lr && sc===lc));
        if (grp && grp.stones.length === 1) {
          const [mx, my] = this.toPixel(lr, lc);
          ctx.save();
          ctx.fillStyle = isBlack ? 'rgba(255,220,80,0.90)' : 'rgba(60,60,60,0.50)';
          ctx.beginPath();
          ctx.arc(mx, my, R * 0.14, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  render(engine) { this.drawBoard(engine, null, null); }

  // ============================================================
  //  计算连通群
  // ============================================================
  _computeGroups(engine) {
    const n = engine.size;
    const visited = Array.from({ length: n }, () => new Array(n).fill(false));
    const groups  = [];

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (engine.board[r][c] === 0 || visited[r][c]) continue;
        const color  = engine.board[r][c];
        const stones = [];
        const queue  = [[r, c]];
        visited[r][c] = true;
        while (queue.length) {
          const [cr, cc] = queue.shift();
          stones.push([cr, cc]);
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < n && nc >= 0 && nc < n
                && !visited[nr][nc] && engine.board[nr][nc] === color) {
              visited[nr][nc] = true;
              queue.push([nr, nc]);
            }
          }
        }
        // 计算气
        const stoneSet = new Set(stones.map(([sr, sc]) => sr * 1000 + sc));
        let libs = 0;
        const libSet = new Set();
        for (const [sr, sc] of stones) {
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = sr + dr, nc = sc + dc;
            if (nr >= 0 && nr < n && nc >= 0 && nc < n
                && engine.board[nr][nc] === 0) {
              const key = nr * 1000 + nc;
              if (!libSet.has(key)) { libSet.add(key); libs++; }
            }
          }
        }
        // 重心
        const cr2 = Math.round(stones.reduce((s, [r2]) => s + r2, 0) / stones.length);
        const cc2 = Math.round(stones.reduce((s, [, c2]) => s + c2, 0) / stones.length);
        // 找最近的实际棋子作为表情中心
        let best = stones[0], bestD = Infinity;
        for (const [sr, sc] of stones) {
          const d = Math.abs(sr - cr2) + Math.abs(sc - cc2);
          if (d < bestD) { bestD = d; best = [sr, sc]; }
        }
        groups.push({ color, stones, libs, centroid: best });
      }
    }
    return groups;
  }

  // ============================================================
  //  绘制一个连通群
  // ============================================================
  _drawGroup(ctx, engine, grp) {
    const { color, stones, libs, centroid } = grp;
    const stoneSet = new Set(stones.map(([r, c]) => r * 1000 + c));

    const emojiType = libs >= 3 ? 1 : libs === 2 ? 2 : 3;
    const isBlack   = color === 1;
    const bodyColor = isBlack ? '#2E2E30' : '#F8F8F6';
    const strokeCol = isBlack ? '#1A1A1C' : '#A0A0A0';

    const R  = this.stoneR;
    const cs = this.cellSize;

    if (stones.length === 1) {
      // ── 单颗棋子：圆形猫咪 ──
      const [r, c] = stones[0];
      const [px, py] = this.toPixel(r, c);
      this._drawSingleCat(ctx, px, py, color, emojiType, R);
      return;
    }

    // ── 多颗连通：精确形状（每颗棋子圆角方块 + 相邻桥接）──
    const cr = R * 0.28;  // 单颗方块圆角（较小，连接处更饱满）
    const bw = R;         // 桥接矩形的窄边半宽（= R，与棋子方块完全对齐）

    // 辅助：把群的完整形状（圆角方块+桥接）作为路径添加到 context
    // 使用 evenodd 填充规则，所有子路径叠加后形成联合区域
    const buildGroupPath = (c) => {
      c.beginPath();
      for (const [sr, sc] of stones) {
        const [px, py] = this.toPixel(sr, sc);
        // 每颗棋子的圆角方块路径
        const rr = Math.min(cr, R);
        c.moveTo(px - R + rr, py - R);
        c.lineTo(px + R - rr, py - R);
        c.quadraticCurveTo(px + R, py - R, px + R, py - R + rr);
        c.lineTo(px + R, py + R - rr);
        c.quadraticCurveTo(px + R, py + R, px + R - rr, py + R);
        c.lineTo(px - R + rr, py + R);
        c.quadraticCurveTo(px - R, py + R, px - R, py + R - rr);
        c.lineTo(px - R, py - R + rr);
        c.quadraticCurveTo(px - R, py - R, px - R + rr, py - R);
        c.closePath();
      }
      // 桥接矩形路径（覆盖两棋子之间的连接区域）
      for (const [sr, sc] of stones) {
        const [px, py] = this.toPixel(sr, sc);
        if (stoneSet.has(sr * 1000 + (sc + 1))) {
          const [nx] = this.toPixel(sr, sc + 1);
          c.rect(px, py - bw, nx - px, bw * 2);
        }
        if (stoneSet.has((sr + 1) * 1000 + sc)) {
          const [, ny] = this.toPixel(sr + 1, sc);
          c.rect(px - bw, py, bw * 2, ny - py);
        }
      }
    };

    // ── 步骤1：填充（带阴影）──
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur    = R * 0.55;
    ctx.shadowOffsetY = R * 0.14;
    ctx.fillStyle = bodyColor;
    buildGroupPath(ctx);
    ctx.fill('nonzero');
    ctx.restore();

    // ── 步骤2：描边外轮廓（offscreen：先描边整个群路径，再用填充区域 destination-out 擦掉内部）──
    // 原理：buildGroupPath 包含所有子路径（圆角方块+桥接矩形），stroke 会在每条子路径上画线
    // 用 clip 方案会在桥接区域内留下交叉线；改用 offscreen + destination-out 更干净
    const offW = this.canvas.width;
    const offH = this.canvas.height;
    const offStroke = document.createElement('canvas');
    offStroke.width = offW; offStroke.height = offH;
    const os = offStroke.getContext('2d');
    os.strokeStyle = strokeCol;
    os.lineWidth   = R * 0.13;
    os.lineCap     = 'round';
    os.lineJoin    = 'round';
    // 只描每颗棋子的圆角方块轮廓（不描桥接矩形，避免内部线）
    for (const [sr, sc] of stones) {
      const [px, py] = this.toPixel(sr, sc);
      this._sketchRoundRect(os, px - R, py - R, R * 2, R * 2, cr);
      os.stroke();
    }
    // 用填充区域擦掉内部描边，只保留外轮廓
    os.globalCompositeOperation = 'destination-out';
    os.fillStyle = '#000';
    buildGroupPath(os);
    os.fill('nonzero');
    ctx.drawImage(offStroke, 0, 0);

    // ── 步骤3：猫咪表情（在重心棋子位置）──
    const [cr2, cc2] = centroid;
    const [faceCX, faceCY] = this.toPixel(cr2, cc2);
    this._drawCatFace(ctx, faceCX, faceCY, isBlack, emojiType, R, false);
  }

  // ============================================================
  //  单颗圆形猫咪棋子
  // ============================================================
  _drawSingleCat(ctx, x, y, color, emojiType, R) {
    const isBlack   = color === 1;
    const bodyColor = isBlack ? '#2E2E30' : '#F8F8F6';
    const strokeCol = isBlack ? '#1A1A1C' : '#A0A0A0';

    ctx.save();

    // 阴影
    ctx.shadowColor   = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur    = R * 0.50;
    ctx.shadowOffsetY = R * 0.10;

    // 填充圆形
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = 'transparent';

    // 手绘描边（稍粗，圆润）
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth   = R * 0.13;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    // 轻微手绘感：用贝塞尔曲线近似圆
    this._sketchCircle(ctx, x, y, R);
    ctx.stroke();

    ctx.restore();

    // 猫咪表情
    this._drawCatFace(ctx, x, y, isBlack, emojiType, R, true);
  }

  // ============================================================
  //  圆形路径（标准圆，手绘感来自描边粗细）
  // ============================================================
  _sketchCircle(ctx, x, y, R) {
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.closePath();
  }

  // ============================================================
  //  手绘圆角矩形（干净版，手绘感来自描边粗细而非形状抖动）
  // ============================================================
  _sketchRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h,     x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y,         x + rr, y);
    ctx.closePath();
  }

  // ============================================================
  //  猫咪表情（萌态，无耳朵无尾巴）
  //  isSingle: 单颗棋子时表情稍大
  // ============================================================
  _drawCatFace(ctx, x, y, isBlack, type, R, isSingle) {
    const fc  = isBlack ? 'rgba(240,240,240,0.92)' : 'rgba(50,50,50,0.88)';
    const scale = isSingle ? 1.0 : 0.88;
    const ey  = y - R * 0.08 * scale;
    const ex  = R * 0.26 * scale;
    const lw  = R * 0.10 * scale;

    ctx.save();
    ctx.strokeStyle = fc;
    ctx.fillStyle   = fc;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (type === 1) {
      // 开心：弯弯眼（U形倒置）+ 小弧嘴
      this._catEyeHappy(ctx, x - ex, ey, R * scale, fc);
      this._catEyeHappy(ctx, x + ex, ey, R * scale, fc);
      // 嘴：小弧线
      ctx.beginPath();
      ctx.arc(x, y + R * 0.22 * scale, R * 0.14 * scale, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = lw;
      ctx.stroke();
    } else if (type === 2) {
      // 紧张：圆眼睛 + 直线嘴
      this._catEyeNormal(ctx, x - ex, ey, R * scale, fc);
      this._catEyeNormal(ctx, x + ex, ey, R * scale, fc);
      // 嘴：波浪线（紧张感）
      ctx.beginPath();
      ctx.moveTo(x - R * 0.18 * scale, y + R * 0.24 * scale);
      ctx.quadraticCurveTo(x - R * 0.06 * scale, y + R * 0.18 * scale, x, y + R * 0.26 * scale);
      ctx.quadraticCurveTo(x + R * 0.06 * scale, y + R * 0.34 * scale, x + R * 0.18 * scale, y + R * 0.24 * scale);
      ctx.lineWidth = lw;
      ctx.stroke();
    } else {
      // 危险：点状眼（泪眼）+ 下弧嘴
      ctx.beginPath();
      ctx.arc(x - ex, ey, R * 0.09 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + ex, ey, R * 0.09 * scale, 0, Math.PI * 2);
      ctx.fill();
      // 泪滴
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(x + ex + R * 0.04 * scale, ey + R * 0.14 * scale,
                  R * 0.04 * scale, R * 0.07 * scale, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // 嘴：倒弧（难过）
      ctx.beginPath();
      ctx.arc(x, y + R * 0.38 * scale, R * 0.13 * scale, Math.PI * 1.1, Math.PI * 1.9);
      ctx.lineWidth = lw;
      ctx.stroke();
    }

    ctx.restore();
  }

  // 开心眼：倒U弧线（弯弯眼）
  _catEyeHappy(ctx, x, y, R, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = R * 0.10;
    ctx.beginPath();
    ctx.arc(x, y + R * 0.06, R * 0.10, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 普通眼：实心小圆
  _catEyeNormal(ctx, x, y, R, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, R * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ============================================================
  //  棋盘背景
  // ============================================================
  _drawBoardBg(ctx, W, n) {
    const grad = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W * 0.72);
    grad.addColorStop(0, '#EAB96A');
    grad.addColorStop(1, '#C49050');
    ctx.fillStyle = grad;
    this._sketchRoundRect(ctx, 0, 0, W, W, 10);
    ctx.fill();

    // 木纹
    ctx.save();
    ctx.globalAlpha = 0.025;
    ctx.strokeStyle = '#5C3A1E';
    ctx.lineWidth   = 1;
    for (let i = 0; i < W; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i + Math.sin(i * 0.09) * 4, 0);
      ctx.lineTo(i + Math.sin(i * 0.09 + 2) * 4, W);
      ctx.stroke();
    }
    ctx.restore();

    // 棋盘线
    ctx.strokeStyle = '#3D2B1F';
    ctx.lineWidth   = 0.9;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = this.toPixel(0, i);
      const [x1, y1] = this.toPixel(n - 1, i);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const [x2, y2] = this.toPixel(i, 0);
      const [x3, y3] = this.toPixel(i, n - 1);
      ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
    }
    ctx.lineWidth = 2;
    const [bx, by] = this.toPixel(0, 0);
    const [ex, ey] = this.toPixel(n - 1, n - 1);
    ctx.strokeRect(bx, by, ex - bx, ey - by);

    // 星位
    ctx.fillStyle = '#3D2B1F';
    for (const [sr, sc] of this._starPoints(n)) {
      const [sx, sy] = this.toPixel(sr, sc);
      ctx.beginPath();
      ctx.arc(sx, sy, this.cellSize * 0.065, 0, Math.PI * 2);
      ctx.fill();
    }
    this._drawCoords(ctx, n);
  }

  _drawCoords(ctx, n) {
    const letters = 'ABCDEFGHJKLMNOPQRST';
    ctx.fillStyle    = 'rgba(61,43,31,0.42)';
    ctx.font         = `${Math.max(9, this.cellSize * 0.26)}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const [x,  y]  = this.toPixel(0, i);
      ctx.fillText(letters[i], x, y - this.padding * 0.58);
      const [x2, y2] = this.toPixel(n - 1, i);
      ctx.fillText(letters[i], x2, y2 + this.padding * 0.58);
      const [x3, y3] = this.toPixel(i, 0);
      ctx.fillText(n - i, x3 - this.padding * 0.58, y3);
      const [x4, y4] = this.toPixel(i, n - 1);
      ctx.fillText(n - i, x4 + this.padding * 0.58, y4);
    }
  }

  _starPoints(n) {
    if (n === 9)  return [[2,2],[2,6],[6,2],[6,6],[4,4]];
    if (n === 13) return [[3,3],[3,9],[9,3],[9,9],[6,6],[3,6],[6,3],[6,9],[9,6]];
    return [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h,     x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y,         x + rr, y);
    ctx.closePath();
  }

  // ============================================================
  //  图标绘制（侧边栏棋子图标）
  // ============================================================
  drawStoneIcon(canvas, color) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    this._drawSingleCat(ctx, w / 2, h / 2, color, 1, w * 0.38);
  }

  drawLogo(canvas) {
    const ctx = canvas.getContext('2d');
    const w   = canvas.width;
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = '#D4A96A';
    this._roundRect(ctx, 4, 4, w - 8, w - 8, 18);
    ctx.fill();
    ctx.strokeStyle = '#3D2B1F';
    ctx.lineWidth   = 1;
    const step = (w - 20) / 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(10 + i * step, 10); ctx.lineTo(10 + i * step, w - 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, 10 + i * step); ctx.lineTo(w - 10, 10 + i * step); ctx.stroke();
    }
    const R = w * 0.17;
    this._drawSingleCat(ctx, w * 0.35, w * 0.44, 1,  1, R);
    this._drawSingleCat(ctx, w * 0.65, w * 0.58, 2, 2, R);
  }

  render(engine) { this.drawBoard(engine, null, null); }
}
