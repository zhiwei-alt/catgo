/**
 * CatGo 渲染引擎 v6 — 精美猫咪形象升级版
 *
 * 核心设计：
 *  - 棋子上绘制精美 Canvas 猫咪（耳朵+脸+胡须+表情），替代 emoji
 *  - 棋盘上每个棋块 = 一只大猫，猫头显示在棋块"重心"位置
 *  - 气泡数字悬浮在猫头旁边，颜色随气数变化
 *  - 落子时：canvas 弹性缩放 + 涟漪 + 猫爪印粒子
 *  - 提子时：爆炸粒子 + 猫咪哭着飞走
 *  - 气数变化时：canvas 上表情实时切换 + 跳动动画
 */

const Renderer = (() => {

  // ===== 切图预加载系统 =====
  // 所有棋子切图，key = "black-relax" / "white-panic" 等
  const _stoneImages = {};
  const _stoneImageKeys = [
    'black-relax', 'black-okay', 'black-cry', 'black-panic', 'black-dead',
    'white-relax', 'white-okay', 'white-cry', 'white-panic', 'white-dead',
  ];
  let _imagesLoaded = false;
  let _imagesLoadedCount = 0;

  function _preloadStoneImages(basePath) {
    basePath = basePath || 'assets/';
    _stoneImageKeys.forEach(key => {
      const img = new Image();
      img.src = basePath + 'stone-' + key + '.png';
      img.onload = () => {
        _imagesLoadedCount++;
        if (_imagesLoadedCount >= _stoneImageKeys.length) _imagesLoaded = true;
      };
      img.onerror = () => {
        // 加载失败时标记为 null，回退到代码绘制
        _stoneImages[key] = null;
        _imagesLoadedCount++;
        if (_imagesLoadedCount >= _stoneImageKeys.length) _imagesLoaded = true;
      };
      _stoneImages[key] = img;
    });
  }

  // 立即开始预加载
  _preloadStoneImages('assets/');

  // ===== 切图元数据：猫头内容在1024×1024画布中的实际边界 =====
  // cw/ch = 猫头内容宽高(px)，cx/cy = 猫头内容中心(px)
  // 用于精确计算 drawImage 的缩放和偏移，让猫头填满棋子格子
  const SPRITE_META = {
    'black-cry':   { cw:645, ch:428, cx:514, cy:501 },
    'black-dead':  { cw:561, ch:640, cx:510, cy:476 },
    'black-okay':  { cw:587, ch:462, cx:512, cy:501 },
    'black-panic': { cw:697, ch:470, cx:512, cy:511 },
    'black-relax': { cw:527, ch:416, cx:510, cy:495 },
    'white-cry':   { cw:758, ch:497, cx:511, cy:500 },
    'white-dead':  { cw:539, ch:629, cx:512, cy:472 },
    'white-okay':  { cw:653, ch:412, cx:512, cy:500 },
    'white-panic': { cw:877, ch:528, cx:512, cy:502 },
    'white-relax': { cw:627, ch:410, cx:512, cy:510 },
  };

  // ===== 猫咪状态系统（按设计稿分级）=====
  // 档位设计（严格对标美镜设计稿）：
  //   0气 → dead   (×眼 + 直线嘴，灰化)
  //   1气 → panic  (大圆眼 + 抖动线，恐惧，虚线圆圈警示)
  //   2气 → cry    (下弯眼泪珠 + 倒弧嘴，哭泣委屈)
  //   3气 → okay   (半闭眼 + 平嘴，轻松)
  //   4气+ → relax  (弯眼 + w嘴，微笑开心)
  function getCatState(libs) {
    if (libs === 0) return {
      emoji: '💀', label: '已提', mood: 'dead',
      hpClass: 'hp-dead', countClass: 'lib-count-dead',
      avatarAnim: 'anim-dead', pct: 0,
      color: '#888', tip: '已被提走'
    };
    if (libs === 1) return {
      emoji: '🙀', label: '危险！', mood: 'panic',
      hpClass: 'hp-danger', countClass: 'lib-count-danger',
      avatarAnim: 'anim-panic', pct: 12,
      color: '#e74c3c', tip: '只剩1气，马上被提！'
    };
    if (libs === 2) return {
      emoji: '😿', label: '哭泣', mood: 'cry',
      hpClass: 'hp-warn', countClass: 'lib-count-warn',
      avatarAnim: 'anim-cry', pct: 30,
      color: '#e67e22', tip: '2气，气紧了！'
    };
    if (libs === 3) return {
      emoji: '😌', label: '轻松', mood: 'okay',
      hpClass: 'hp-okay', countClass: 'lib-count-okay',
      avatarAnim: 'anim-okay', pct: 60,
      color: '#f1c40f', tip: '3气，还好'
    };
    // 4气及以上：微笑开心
    return {
      emoji: '😺', label: '开心', mood: 'relax',
      hpClass: 'hp-safe', countClass: 'lib-count-safe',
      avatarAnim: 'anim-relax', pct: 100,
      color: '#2ecc71', tip: `${libs}气，安全`
    };
  }

  function getStoneEmoji(libs) {
    if (libs === 0) return 'dead';
    if (libs === 1) return 'panic';
    if (libs === 2) return 'cry';
    if (libs === 3) return 'okay';
    return 'relax'; // 4气+
  }

  // ===== Canvas 猫咪脸绘制函数（扁平手绘风，严格对标美镜设计稿）=====
  /**
   * 在 Canvas 上绘制扁平手绘风猫咪脸
   *
   * 设计规范（来自美镜设计稿）：
   *   - 无渐变光泽，纯色填充，手绘线稿感
   *   - relax(4气+)：弯弧眼(^_^) + w形嘴，微笑开心
   *   - okay(3气)：半圆眼 + 平嘴，轻松
   *   - cry(2气)：下弯眼(><) + 倒弧嘴 + 泪珠，哭泣委屈
   *   - panic(1气)：大圆眼(OO) + 抖动嘴线，恐惧
   *   - dead(0气)：×眼 + 直线嘴，灰化
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cx  中心x
   * @param {number} cy  中心y（棋子中心，脸在棋子中央偏上）
   * @param {number} r   棋子半径（脸的绘制范围参考）
   * @param {string} mood  'relax'|'okay'|'cry'|'panic'|'dead'
   * @param {boolean} isBlack  是否黑棋
   */
  function _drawCatFace(ctx, cx, cy, r, mood, isBlack) {
    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // 规范化 mood（兼容旧 emoji 字符串）
    if (mood === '🙀' || mood === 'panic') mood = 'panic';
    else if (mood === '😿' || mood === 'cry') mood = 'cry';
    else if (mood === '😌' || mood === 'okay' || mood === 'alert' || mood === '😼') mood = 'okay';
    else if (mood === '💀' || mood === 'dead') mood = 'dead';
    else mood = 'relax';

    const isPanic = mood === 'panic';
    const isCry   = mood === 'cry';
    const isOkay  = mood === 'okay';
    const isDead  = mood === 'dead';
    const isRelax = mood === 'relax';

    // 颜色：黑棋用浅色线条，白棋用深色线条（扁平风，无渐变）
    const lineColor   = isBlack ? 'rgba(240,232,218,0.95)' : 'rgba(55,45,35,0.92)';
    const fillColor   = isBlack ? 'rgba(240,232,218,0.95)' : 'rgba(55,45,35,0.92)';
    const tearColor   = isBlack ? 'rgba(180,220,255,0.90)' : 'rgba(100,160,220,0.90)';
    const noseColor   = isBlack ? 'rgba(255,150,170,0.90)' : 'rgba(210,70,110,0.88)';
    const whiskerCol  = isBlack ? 'rgba(240,232,218,0.45)' : 'rgba(55,45,35,0.38)';

    // 脸部区域：棋子中央偏上（给嘴巴留空间）
    const faceY = cy - r * 0.05;

    // ── 眼睛位置 ──
    const eyeY  = faceY - r * 0.12;
    const eyeXL = cx - r * 0.26;
    const eyeXR = cx + r * 0.26;
    const eyeR  = r * 0.20;

    ctx.strokeStyle = lineColor;
    ctx.fillStyle   = fillColor;

    if (isDead) {
      // ×眼（两条交叉线）
      ctx.lineWidth = Math.max(r * 0.12, 1.2);
      const d = r * 0.14;
      for (const ex of [eyeXL, eyeXR]) {
        ctx.beginPath(); ctx.moveTo(ex - d, eyeY - d); ctx.lineTo(ex + d, eyeY + d); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ex + d, eyeY - d); ctx.lineTo(ex - d, eyeY + d); ctx.stroke();
      }

    } else if (isPanic) {
      // 大圆眼（恐惧，睁大，实心圆）
      const bigR = eyeR * 1.35;
      ctx.lineWidth = Math.max(r * 0.10, 1.0);
      for (const ex of [eyeXL, eyeXR]) {
        // 外圈描边
        ctx.beginPath(); ctx.arc(ex, eyeY, bigR, 0, Math.PI * 2);
        ctx.stroke();
        // 内部实心（小瞳孔）
        ctx.beginPath(); ctx.arc(ex, eyeY, bigR * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }

    } else if (isCry) {
      // 下弯弧眼（><，哭泣，弧线向下弯）
      ctx.lineWidth = Math.max(r * 0.13, 1.3);
      for (const ex of [eyeXL, eyeXR]) {
        ctx.beginPath();
        // 从左到右画一条向下弯的弧（像 ∪ 倒过来的 ∩）
        ctx.arc(ex, eyeY - eyeR * 0.5, eyeR * 0.85, Math.PI * 0.1, Math.PI * 0.9, false);
        ctx.stroke();
      }
      // 泪珠（左眼下方）
      if (r > 10) {
        ctx.fillStyle = tearColor;
        ctx.beginPath();
        ctx.ellipse(eyeXL + eyeR * 0.1, eyeY + eyeR * 1.1, eyeR * 0.22, eyeR * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }

    } else if (isOkay) {
      // 半圆眼（轻松，上半圆实心）
      ctx.lineWidth = Math.max(r * 0.11, 1.0);
      for (const ex of [eyeXL, eyeXR]) {
        ctx.save();
        // 只画上半圆（clip 下半部分）
        ctx.beginPath();
        ctx.rect(ex - eyeR * 1.5, eyeY - eyeR * 1.5, eyeR * 3, eyeR * 1.5);
        ctx.clip();
        ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

    } else {
      // relax：弯弧眼（^形，微笑，弧线向上弯）
      ctx.lineWidth = Math.max(r * 0.13, 1.3);
      for (const ex of [eyeXL, eyeXR]) {
        ctx.beginPath();
        // 向上弯的弧（像 ∩）
        ctx.arc(ex, eyeY + eyeR * 0.5, eyeR * 0.85, Math.PI * 1.1, Math.PI * 1.9, false);
        ctx.stroke();
      }
    }

    // ── 鼻子（小倒三角，猫咪特征）──
    if (!isDead) {
      const noseY = faceY + r * 0.08;
      const ns = r * 0.09;
      ctx.fillStyle = noseColor;
      ctx.beginPath();
      ctx.moveTo(cx, noseY + ns * 0.6);
      ctx.lineTo(cx - ns, noseY - ns * 0.4);
      ctx.lineTo(cx + ns, noseY - ns * 0.4);
      ctx.closePath();
      ctx.fill();
    }

    // ── 嘴巴 ──
    const mouthY = faceY + r * 0.22;
    ctx.strokeStyle = lineColor;
    ctx.fillStyle   = fillColor;

    if (isDead) {
      // 直线嘴
      ctx.lineWidth = Math.max(r * 0.10, 1.0);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.14, mouthY);
      ctx.lineTo(cx + r * 0.14, mouthY);
      ctx.stroke();

    } else if (isPanic) {
      // 抖动嘴（锯齿线，恐惧）
      ctx.lineWidth = Math.max(r * 0.10, 1.0);
      ctx.beginPath();
      const mw = r * 0.18;
      const mh = r * 0.06;
      ctx.moveTo(cx - mw, mouthY);
      ctx.lineTo(cx - mw * 0.5, mouthY + mh);
      ctx.lineTo(cx, mouthY - mh);
      ctx.lineTo(cx + mw * 0.5, mouthY + mh);
      ctx.lineTo(cx + mw, mouthY);
      ctx.stroke();

    } else if (isCry) {
      // 倒弧嘴（∪形，哭泣）
      ctx.lineWidth = Math.max(r * 0.11, 1.1);
      ctx.beginPath();
      ctx.arc(cx, mouthY - r * 0.06, r * 0.14, Math.PI * 0.15, Math.PI * 0.85, false);
      ctx.stroke();

    } else if (isOkay) {
      // 平直嘴（轻松）
      ctx.lineWidth = Math.max(r * 0.10, 1.0);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.13, mouthY);
      ctx.lineTo(cx + r * 0.13, mouthY);
      ctx.stroke();

    } else {
      // relax：w形嘴（微笑，猫咪特有）
      ctx.lineWidth = Math.max(r * 0.11, 1.1);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.17, mouthY - r * 0.02);
      ctx.quadraticCurveTo(cx - r * 0.06, mouthY + r * 0.11, cx, mouthY + r * 0.01);
      ctx.quadraticCurveTo(cx + r * 0.06, mouthY + r * 0.11, cx + r * 0.17, mouthY - r * 0.02);
      ctx.stroke();
    }

    // ── 胡须（只在非死亡状态、棋子足够大时显示）──
    if (!isDead && r > 9) {
      ctx.strokeStyle = whiskerCol;
      ctx.lineWidth = Math.max(r * 0.05, 0.6);
      const wy = faceY + r * 0.12;
      const wLen = r * 0.34;

      // 左侧2根胡须
      for (const dy of [-r * 0.06, r * 0.06]) {
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.10, wy + dy);
        ctx.lineTo(cx - r * 0.10 - wLen, wy + dy + dy * 0.3);
        ctx.stroke();
      }
      // 右侧2根胡须
      for (const dy of [-r * 0.06, r * 0.06]) {
        ctx.beginPath();
        ctx.moveTo(cx + r * 0.10, wy + dy);
        ctx.lineTo(cx + r * 0.10 + wLen, wy + dy + dy * 0.3);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // ===== 棋盘渲染器 =====
  class BoardRenderer {
    constructor(canvas, size = 19) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.size = size;
      this.padding = size === 9 ? 54 : size === 13 ? 42 : 34;
      this.cellSize = (canvas.width - this.padding * 2) / (size - 1);
      this.stoneRadius = this.cellSize * 0.46;
      this.catOverlay = null;
      this.showCatOverlay = true;
      // 记录上一帧的气数，用于检测变化
      this._prevLibCache = new Map();
      // 记录上一帧的棋块数，用于检测新落子
      this._prevStoneCount = 0;
      // 落子弹性动画状态：Map<'r,c', {t, color}>
      this._stoneAnimMap = new Map();
      // 表情跳动动画状态：Map<'r,c', {t, fromEmoji, toEmoji}>
      this._emojiAnimMap = new Map();
      // 猫爪印粒子列表
      this._pawPrints = [];
      // 外部注册的重绘回调（由 app.js 注入）
      this._renderCallback = null;
      // 动画循环是否运行中
      this._animLoopRunning = false;
    }

    setCatOverlay(el) { this.catOverlay = el; }

    /**
     * 注册外部重绘回调（app.js 调用：renderer.setRenderCallback(() => renderGame())）
     */
    setRenderCallback(fn) { this._renderCallback = fn; }

    /**
     * 启动动画循环（有动画时持续重绘，无动画时自动停止）
     */
    _startAnimLoop() {
      if (this._animLoopRunning) return;
      this._animLoopRunning = true;
      const loop = () => {
        const hasAnim = this._stoneAnimMap.size > 0 ||
                        this._emojiAnimMap.size > 0 ||
                        this._pawPrints.some(p => performance.now() - p.born < p.life) ||
                        this._hasDangerStones ||
                        !!this._lastHintPos;
        if (hasAnim) {
          if (this._renderCallback) this._renderCallback();
          requestAnimationFrame(loop);
        } else {
          this._animLoopRunning = false;
          // 最后再渲染一帧确保清干净
          if (this._renderCallback) this._renderCallback();
        }
      };
      requestAnimationFrame(loop);
    }

    /**
     * 通知渲染器当前是否有气=1的危险棋子（由外部调用）
     */
    setHasDangerStones(has) {
      const prev = this._hasDangerStones;
      this._hasDangerStones = has;
      if (has && !prev) this._startAnimLoop();
    }

    toPixel(r, c) {
      return {
        x: this.padding + c * this.cellSize,
        y: this.padding + r * this.cellSize
      };
    }

    toBoard(px, py) {
      const c = Math.round((px - this.padding) / this.cellSize);
      const r = Math.round((py - this.padding) / this.cellSize);
      if (r < 0 || r >= this.size || c < 0 || c >= this.size) return null;
      return [r, c];
    }

    drawBoard() {
      const ctx = this.ctx;
      const { width, height } = this.canvas;

      // ── 纯卡其色底色（严格对标美镜设计稿，无木纹/光晕/暗角）──
      // 设计稿颜色：#C8A96E（暖卡其色）
      ctx.fillStyle = '#C8A96E';
      ctx.beginPath();
      ctx.roundRect(0, 0, width, height, 12);
      ctx.fill();

      // ── 外边框（深棕色，手绘感）──
      ctx.strokeStyle = 'rgba(90,58,20,0.80)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(1.5, 1.5, width - 3, height - 3, 11);
      ctx.stroke();
    }

    drawGrid() {
      const ctx = this.ctx;
      // 网格线：深棕色细线，手绘感
      ctx.strokeStyle = 'rgba(80,52,18,0.68)';
      ctx.lineWidth = 0.9;
      ctx.lineCap = 'square';
      for (let i = 0; i < this.size; i++) {
        const { x: x1, y: y1 } = this.toPixel(0, i);
        const { x: x2, y: y2 } = this.toPixel(this.size - 1, i);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const { x: x3, y: y3 } = this.toPixel(i, 0);
        const { x: x4, y: y4 } = this.toPixel(i, this.size - 1);
        ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x4, y4); ctx.stroke();
      }

      // 外框（稍加粗）
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(75,48,14,0.85)';
      const { x: bx1, y: by1 } = this.toPixel(0, 0);
      const { x: bx2, y: by2 } = this.toPixel(this.size - 1, this.size - 1);
      ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);
    }

    drawStarPoints() {
      const ctx = this.ctx;
      let pts = [];
      if (this.size === 19) pts = [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]];
      else if (this.size === 13) pts = [[3,3],[3,9],[6,6],[9,3],[9,9]];
      else if (this.size === 9) pts = [[2,2],[2,6],[4,4],[6,2],[6,6]];

      // 星位点：简单实心圆点（对标设计稿）
      ctx.fillStyle = 'rgba(75,48,14,0.80)';
      for (const [r, c] of pts) {
        const { x, y } = this.toPixel(r, c);
        ctx.beginPath();
        ctx.arc(x, y, this.cellSize * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawCoordinates() {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(80,50,10,0.55)';
      // 字体大小：确保在padding内能完整显示，最大不超过cellSize*0.3
      const fontSize = Math.max(9, Math.min(this.cellSize * 0.30, this.padding * 0.45));
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cols = 'ABCDEFGHJKLMNOPQRST';
      const labelOffset = this.padding * 0.52; // 标签距边缘的偏移
      for (let i = 0; i < this.size; i++) {
        const { x } = this.toPixel(0, i);
        ctx.fillText(cols[i], x, labelOffset);
        ctx.fillText(cols[i], x, this.canvas.height - labelOffset);
        const { y } = this.toPixel(i, 0);
        ctx.fillText(this.size - i, labelOffset, y);
        ctx.fillText(this.size - i, this.canvas.width - labelOffset, y);
      }
    }

    /**
     * 绘制扁平手绘风猫头棋子（严格对标美镜设计稿）
     *
     * 设计规范：
     *   - 宽扁圆角矩形（宽度 > 高度，像猫头）
     *   - 纯色填充，无渐变光泽
     *   - 黑棋：深灰 #4a4a4a，白棋：米白 #f0ede6
     *   - 连子融合：相邻方向延伸，圆角变小，形成一整只猫轮廓
     *   - 描边：深色细线，手绘感
     *
     * @param {number} r, c  棋盘坐标
     * @param {string} color  GoEngine.BLACK | GoEngine.WHITE
     * @param {boolean} isLastMove  是否最后落子
     * @param {number} alpha  透明度
     * @param {string|null} catEmoji  猫咪表情 mood 字符串
     * @param {object} neighbors  {up,down,left,right}
     * @param {number} animScale  弹性缩放
     */
    /**
     * 只绘制棋子融合底色（圆角矩形），不画猫脸。
     * 猫脸由 drawGroupCat() 统一在棋块包围盒中心绘制。
     */
    drawStone(r, c, color, isLastMove = false, alpha = 1, _unused = null, neighbors = {}, animScale = 1) {
      const ctx = this.ctx;
      const { x, y } = this.toPixel(r, c);
      const S = this.cellSize;

      ctx.save();
      ctx.globalAlpha = alpha;

      if (animScale !== 1) {
        ctx.translate(x, y);
        ctx.scale(animScale, animScale);
        ctx.translate(-x, -y);
      }

      const isBlack = color === GoEngine.BLACK;

      // ── 融合底色：相邻同色方向延伸，圆角随连接变小 ──
      const SW   = S * 0.46;
      const SH   = S * 0.40;
      const extW = SW * 0.24;
      const { up = false, down = false, left = false, right = false } = neighbors;

      const x0 = x - SW - (left  ? extW : 0);
      const x1 = x + SW + (right ? extW : 0);
      const y0 = y - SH - (up    ? extW : 0);
      const y1 = y + SH + (down  ? extW : 0);

      const CR  = SH * 0.85;
      const tlR = (up   || left)  ? CR * 0.18 : CR;
      const trR = (up   || right) ? CR * 0.18 : CR;
      const brR = (down || right) ? CR * 0.18 : CR;
      const blR = (down || left)  ? CR * 0.18 : CR;

      ctx.fillStyle   = isBlack ? '#3d3d3d' : '#f0ede6';
      ctx.strokeStyle = isBlack ? 'rgba(20,15,10,0.75)' : 'rgba(60,42,18,0.80)';
      ctx.lineWidth   = 1.5;
      this._drawRoundRect(ctx, x0, y0, x1, y1, tlR, trR, brR, blR);
      ctx.fill();
      ctx.stroke();

      // ── 最后落子标记（小红点）──
      if (isLastMove) {
        const dotR = S * 0.08;
        ctx.fillStyle = isBlack ? 'rgba(255,80,80,0.90)' : 'rgba(200,50,50,0.85)';
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    /**
     * 在棋块包围盒中心绘制一只猫头切图。
     * 大小 = min(包围盒宽, 包围盒高) * 0.82，但不超过 cellSize * 0.88（单子时正常大小）。
     *
     * @param {Array} stones  棋块所有棋子坐标 [[r,c], ...]
     * @param {string} color  GoEngine.BLACK | GoEngine.WHITE
     * @param {string} mood   'relax'|'okay'|'cry'|'panic'|'dead'
     * @param {number} alpha  透明度
     * @param {number} animScale  弹性缩放（落子动画）
     */
    drawGroupCat(stones, color, mood, alpha = 1, animScale = 1) {
      if (!stones || stones.length === 0) return;
      const ctx  = this.ctx;
      const S    = this.cellSize;
      const isBlack = color === GoEngine.BLACK;
      const imgKey  = (isBlack ? 'black' : 'white') + '-' + (mood || 'relax');
      const img     = _stoneImages[imgKey];
      const meta    = SPRITE_META[imgKey];
      if (!img || !img.complete || !img.naturalWidth || !meta) return;

      // 计算棋块像素包围盒
      const SW = S * 0.46;
      const SH = S * 0.40;
      let minPx = Infinity, maxPx = -Infinity;
      let minPy = Infinity, maxPy = -Infinity;
      for (const [sr, sc] of stones) {
        const { x, y } = this.toPixel(sr, sc);
        if (x - SW < minPx) minPx = x - SW;
        if (x + SW > maxPx) maxPx = x + SW;
        if (y - SH < minPy) minPy = y - SH;
        if (y + SH > maxPy) maxPy = y + SH;
      }
      const boxW = maxPx - minPx;
      const boxH = maxPy - minPy;
      const cx   = (minPx + maxPx) / 2;
      const cy   = (minPy + maxPy) / 2;

      // 猫头目标宽 = min(包围盒短边, cellSize) * 0.82
      // 单子时 boxW≈boxH≈SW*2，结果约等于 cellSize*0.88，与之前一致
      const targetCatW = Math.min(boxW, boxH, S) * 0.82;
      const scale  = targetCatW / meta.cw;
      const drawW  = 1024 * scale;
      const drawH  = 1024 * scale;
      const catCX  = meta.cx * scale;
      const catCY  = meta.cy * scale;

      ctx.save();
      ctx.globalAlpha = alpha;
      if (animScale !== 1) {
        ctx.translate(cx, cy);
        ctx.scale(animScale, animScale);
        ctx.translate(-cx, -cy);
      }
      ctx.drawImage(img, cx - catCX, cy - catCY, drawW, drawH);
      ctx.restore();
    }

    /**
     * 辅助：绘制四角独立圆角的矩形路径
     */
    _drawRoundRect(ctx, x0, y0, x1, y1, tlR, trR, brR, blR) {
      ctx.beginPath();
      ctx.moveTo(x0 + tlR, y0);
      ctx.lineTo(x1 - trR, y0);
      if (trR > 0) ctx.arcTo(x1, y0, x1, y0 + trR, trR);
      else ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y1 - brR);
      if (brR > 0) ctx.arcTo(x1, y1, x1 - brR, y1, brR);
      else ctx.lineTo(x1, y1);
      ctx.lineTo(x0 + blR, y1);
      if (blR > 0) ctx.arcTo(x0, y1, x0, y1 - blR, blR);
      else ctx.lineTo(x0, y1);
      ctx.lineTo(x0, y0 + tlR);
      if (tlR > 0) ctx.arcTo(x0, y0, x0 + tlR, y0, tlR);
      else ctx.lineTo(x0, y0);
      ctx.closePath();
    }

    /**
     * 绘制猫耳朵 v12 —— 精确复刻原版 CatGo
     *
     * 核心规则：耳朵只在棋块外轮廓的"外凸角"处生长。
     *
     * 外凸角的定义（以右上角为例）：
     *   该角的两个方向（右、上）中，至少一个方向无同色邻居，
     *   且不是内凹角（对角有邻居时为内凹）。
     *
     * 具体触发条件（右上角）：
     *   1. !R && !U  → 两方向都无邻居（孤立棋子角 / 端点角）
     *   2. R && !U && !dRU  → 右有邻居，上无邻居，对角无邻居（横排端点上侧）
     *   3. !R && U && !dRU  → 上有邻居，右无邻居，对角无邻居（竖排端点右侧）
     *   4. R && U && !dRU   → 两方向都有邻居，但对角无邻居（L形外凸角）
     *
     *   简化：只要 !dRU（对角无邻居），且 R 或 U 至少一个为真，或两者都为假
     *   → 等价于：!dRU && !(R && U && dRU) = !dRU（因为 dRU=false 已排除内凹）
     *   → 但还需排除"两方向都有邻居且对角也有邻居"的内凹角（已由 !dRU 排除）
     *
     *   最终简化：!dRU 时触发（对角无邻居 = 外凸角或自由角）
     *   但这会在直线段中间也触发（如横排中间棋子的上下角）
     *
     *   正确条件：!dRU && (!R || !U)
     *   即：对角无邻居，且该角的两个方向中至少一个无邻居
     *   这排除了 R && U && !dRU 的 L 形情况... 不对，L 形也需要触发
     *
     *   最终正确条件：!dRU（对角无邻居即可，包含所有外凸情况）
     *   但需要排除直线段中间：横排中间棋子(L=true, R=true)的上角，上无邻居时会触发
     *   这其实是正确的！横排中间棋子的上下角确实是外轮廓的凸角。
     *
     * 结论：条件就是 !dRU（对角无邻居），无需其他限制。
     * 这与原版 CatGo 完全一致。
     */
    drawCatEars(board, animatingKeys = null) {
      const ctx = this.ctx;
      const SW  = this.cellSize * 0.46;  // 棋子半宽（与drawStone一致）
      const SH  = this.cellSize * 0.40;  // 棋子半高（与drawStone一致）
      const extW = SW * 0.24;            // 水平延伸量（与drawStone一致）
      const E   = this.cellSize * 0.32;  // 耳朵腰长（稍小，更精致）

      const same = (r, c, color) => {
        if (r < 0 || r >= board.size || c < 0 || c >= board.size) return false;
        return board.get(r, c) === color;
      };

      const isAnimating = (r, c) => {
        if (!animatingKeys || animatingKeys.size === 0) return false;
        if (animatingKeys.has(`${r},${c}`)) return true;
        return animatingKeys.has(`${r-1},${c}`) || animatingKeys.has(`${r+1},${c}`) ||
               animatingKeys.has(`${r},${c-1}`) || animatingKeys.has(`${r},${c+1}`);
      };

      ctx.save();

      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          const color = board.get(r, c);
          if (color === GoEngine.EMPTY) continue;
          if (isAnimating(r, c)) continue;

          const isBlack = color === GoEngine.BLACK;
          // 耳朵颜色与切图风格一致
          const earFill   = isBlack ? '#3d3d3d' : '#f0f0f0';
          const earStroke = isBlack ? 'rgba(30,25,20,0.80)' : 'rgba(30,25,20,0.80)';
          const innerFill = isBlack ? 'rgba(255,130,160,0.92)' : 'rgba(255,100,140,0.95)';

          const { x, y } = this.toPixel(r, c);

          // 直线邻居
          const hasR = same(r,   c+1, color);
          const hasL = same(r,   c-1, color);
          const hasU = same(r-1, c,   color);

          // 对角邻居（只需要上方两个）
          const dRU = same(r-1, c+1, color);
          const dLU = same(r-1, c-1, color);

          // 耳朵只在棋块顶部外轮廓的外凸角生长
          // 右上角
          if (!hasU && !dRU) {
            const ex = x + SW + (hasR ? extW : 0);  // 右边界
            const ey = y - SH;                        // 上边界
            this._drawEar(ctx, ex, ey, ex + E, ey, ex, ey - E, earFill, earStroke, innerFill);
          }
          // 左上角
          if (!hasU && !dLU) {
            const ex = x - SW - (hasL ? extW : 0);  // 左边界
            const ey = y - SH;                        // 上边界
            this._drawEar(ctx, ex, ey, ex - E, ey, ex, ey - E, earFill, earStroke, innerFill);
          }
          // 下方不长耳朵（参考图风格）
        }
      }

      ctx.restore();
    }

    /**
     * 绘制圆弧形猫耳朵（参考图风格：饱满半圆突起）
     *
     * 参数：
     *   (x1, y1) = 棋子角点（右上/左上角，耳朵根部顶点）
     *   (x2, y2) = 水平根部端点（沿棋子顶边向外 E）
     *   (x3, y3) = 垂直根部端点（沿棋子侧边向上 E）
     *
     * 耳朵形状：
     *   以 x2,y2 → x3,y3 为底边，以底边中点为圆心，
     *   向外（远离棋子中心）画半圆，形成饱满的圆弧猫耳。
     */
    _drawEar(ctx, x1, y1, x2, y2, x3, y3, fill, stroke, innerFill) {
      // 耳朵形状：以 x2,y2 和 x3,y3 为底边两端，向外突出形成猫耳
      //
      // 外侧方向：从角点 x1,y1 向外（x1 是棋子角点，x2/x3 是底边端点）
      // 外侧 = 从棋子中心远离的方向 = 从 x1 指向底边中点的方向
      const mx = (x2 + x3) / 2;
      const my = (y2 + y3) / 2;
      const R  = Math.hypot(x3 - x2, y3 - y2) / 2;

      // 外侧方向（从角点指向底边中点）
      const outDx = mx - x1, outDy = my - y1;
      const outLen = Math.hypot(outDx, outDy) || 1;
      const nx = outDx / outLen, ny = outDy / outLen;

      // 耳尖：底边中点沿外侧方向延伸 R*1.6（高挑猫耳）
      const tipX = mx + nx * R * 1.6;
      const tipY = my + ny * R * 1.6;

      // 用三次贝塞尔：x2 → cp1 → cp2 → x3
      // cp1 靠近 x2 侧的耳尖方向，cp2 靠近 x3 侧的耳尖方向
      // 这样弧从底边两端平滑拉向耳尖，形成圆润的猫耳形状
      const cp1x = x2 + (tipX - x2) * 0.75;
      const cp1y = y2 + (tipY - y2) * 0.75;
      const cp2x = x3 + (tipX - x3) * 0.75;
      const cp2y = y3 + (tipY - y3) * 0.75;

      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';

      // 外耳：x2 → 三次贝塞尔 → x3 → 直线 → x2
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 内耳粉色：在耳尖附近画小圆
      if (innerFill) {
        // 贝塞尔 t=0.5 处（弧顶）
        const bx = 0.125*x2 + 0.375*cp1x + 0.375*cp2x + 0.125*x3;
        const by = 0.125*y2 + 0.375*cp1y + 0.375*cp2y + 0.125*y3;
        const ir = R * 0.42;
        ctx.fillStyle = innerFill;
        ctx.beginPath();
        ctx.arc(bx, by, ir, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    drawHoverPreview(r, c, color) {
      if (r < 0 || r >= this.size || c < 0 || c >= this.size) return;
      this.drawStone(r, c, color, false, 0.35, null, {});
    }

    drawHintMarker(r, c) {
      const ctx = this.ctx;
      const { x, y } = this.toPixel(r, c);
      const S = this.cellSize * 0.46;
      const now = performance.now();
      // 脉冲动画：0.8s周期
      const pulse = 0.5 + 0.5 * Math.sin(now / 400);

      ctx.save();

      // 外圈：脉冲光晕
      ctx.strokeStyle = `rgba(78,205,196,${0.3 + pulse * 0.4})`;
      ctx.lineWidth = 2 + pulse * 2;
      ctx.shadowColor = '#4ecdc4';
      ctx.shadowBlur = 12 + pulse * 8;
      ctx.beginPath();
      ctx.arc(x, y, S * (1.1 + pulse * 0.15), 0, Math.PI * 2);
      ctx.stroke();

      // 内圈：实线
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#4ecdc4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, S * 0.88, 0, Math.PI * 2);
      ctx.stroke();

      // 四个方向箭头（指向落点）
      const arrowDist = S * 1.65;
      const arrowSize = S * 0.32;
      const arrowAlpha = 0.6 + pulse * 0.4;
      ctx.fillStyle = `rgba(78,205,196,${arrowAlpha})`;
      ctx.shadowColor = '#4ecdc4';
      ctx.shadowBlur = 6;

      const dirs = [
        { angle: -Math.PI / 2 }, // 上
        { angle: Math.PI / 2 },  // 下
        { angle: -Math.PI },     // 左
        { angle: 0 },            // 右
      ];
      for (const { angle } of dirs) {
        const ax = x + Math.cos(angle) * arrowDist;
        const ay = y + Math.sin(angle) * arrowDist;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle + Math.PI); // 箭头指向中心
        ctx.beginPath();
        ctx.moveTo(0, -arrowSize * 0.5);
        ctx.lineTo(arrowSize * 0.5, arrowSize * 0.5);
        ctx.lineTo(0, arrowSize * 0.2);
        ctx.lineTo(-arrowSize * 0.5, arrowSize * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();

      // 提示标记需要持续动画，启动动画循环
      if (!this._hintAnimRunning) {
        this._hintAnimRunning = true;
        const loop = () => {
          if (this._renderCallback && this._lastHintPos) {
            this._renderCallback();
            requestAnimationFrame(loop);
          } else {
            this._hintAnimRunning = false;
          }
        };
        requestAnimationFrame(loop);
      }
    }

    render(board, options = {}) {
      const { hoverPos, hintPos, currentColor } = options;
      this._lastBoard = board; // 供 _drawAnimEmoji 使用
      this._lastHintPos = hintPos || null; // 供提示动画循环使用
      this.drawBoard();
      this.drawGrid();
      this.drawStarPoints();
      this.drawCoordinates();

      // 预先计算每颗棋子的气数（用于气数变化检测）
      const stoneLibMap = new Map(); // `r,c` -> libs
      {
        const visited = new Set();
        for (let r = 0; r < board.size; r++) {
          for (let c = 0; c < board.size; c++) {
            const color = board.get(r, c);
            if (color === GoEngine.EMPTY) continue;
            const key = `${r},${c}`;
            if (visited.has(key)) continue;
            const { stones, liberties } = board.getGroup(r, c);
            const libs = liberties.size;
            stones.forEach(([sr, sc]) => {
              const k = `${sr},${sc}`;
              visited.add(k);
              stoneLibMap.set(k, libs);
            });
          }
        }
      }

      // 检测气数变化 -> 触发表情跳动动画（棋块整体）
      if (this.showCatOverlay) {
        let hasNewEmojiAnim = false;
        for (const [key, libs] of stoneLibMap) {
          const prev = this._prevLibCache.get(key);
          if (prev !== undefined && prev !== libs) {
            const newMood = getStoneEmoji(libs);
            const oldMood = getStoneEmoji(prev);
            if (oldMood !== newMood && !this._emojiAnimMap.has(key)) {
              this._emojiAnimMap.set(key, { t: 0, fromEmoji: oldMood, toEmoji: newMood });
              hasNewEmojiAnim = true;
            }
          }
        }
        this._prevLibCache.clear();
        for (const [k, v] of stoneLibMap) this._prevLibCache.set(k, v);
        if (hasNewEmojiAnim) this._startAnimLoop();
      }

      // 更新弹性动画进度
      const nowMs = performance.now();
      for (const [k, anim] of this._stoneAnimMap) {
        const elapsed = nowMs - anim.startTime;
        anim.t = Math.min(elapsed / anim.duration, 1);
        if (anim.t >= 1) this._stoneAnimMap.delete(k);
      }
      // 更新表情跳动动画进度（持续 350ms）
      for (const [k, ea] of this._emojiAnimMap) {
        if (!ea.startTime) ea.startTime = nowMs;
        ea.t = Math.min((nowMs - ea.startTime) / 350, 1);
        if (ea.t >= 1) this._emojiAnimMap.delete(k);
      }

      // 先绘制猫爪印粒子（最底层）
      this._drawPawPrints();

      // ── 第一遍：所有棋子只画融合底色 ──
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          const color = board.get(r, c);
          if (color === GoEngine.EMPTY) continue;
          const isLast = board.lastMove && board.lastMove[0] === r && board.lastMove[1] === c;
          const key = `${r},${c}`;
          const neighbors = {
            up:    r > 0            && board.get(r-1, c) === color,
            down:  r < board.size-1 && board.get(r+1, c) === color,
            left:  c > 0            && board.get(r, c-1) === color,
            right: c < board.size-1 && board.get(r, c+1) === color,
          };
          const anim = this._stoneAnimMap.get(key);
          const animScale = anim ? this._springScale(anim.t) : 1;
          this.drawStone(r, c, color, isLast, 1, null, neighbors, animScale);
        }
      }

      // ── 第二遍：每个棋块在包围盒中心画一只大猫 ──
      if (this.showCatOverlay) {
        const drawnGroups = new Set();
        for (let r = 0; r < board.size; r++) {
          for (let c = 0; c < board.size; c++) {
            const color = board.get(r, c);
            if (color === GoEngine.EMPTY) continue;
            const key = `${r},${c}`;
            if (drawnGroups.has(key)) continue;

            const { stones, liberties } = board.getGroup(r, c);
            stones.forEach(([sr, sc]) => drawnGroups.add(`${sr},${sc}`));

            const libs = liberties.size;
            const mood = getStoneEmoji(libs); // 返回 mood 字符串

            // 棋块重心棋子的动画缩放（取第一颗有动画的棋子）
            let groupAnimScale = 1;
            for (const [sr, sc] of stones) {
              const anim = this._stoneAnimMap.get(`${sr},${sc}`);
              if (anim) { groupAnimScale = this._springScale(anim.t); break; }
            }

            this.drawGroupCat(stones, color, mood, 1, groupAnimScale);
          }
        }
      }


      if (hoverPos && currentColor) {
        const [hr, hc] = hoverPos;
        if (board.get(hr, hc) === GoEngine.EMPTY) this.drawHoverPreview(hr, hc, currentColor);
      }
      if (hintPos) this.drawHintMarker(hintPos[0], hintPos[1]);
      // 气=1通过棋子表情(panic切图)展示，无需额外虚线警告圈
      // if (this.showCatOverlay) this._drawDangerCircles(board);
      // 覆盖层只负责：气泡提示
      if (this.catOverlay && this.showCatOverlay) this._updateCatOverlay(board);
    }

    /**
     * 弹性缩放曲线：t in [0,1] -> scale
     * 模拟弹性落子：先压扁再弹起
     */
    _springScale(t) {
      if (t < 0.25) {
        // 落下阶段：从1.3压缩到0.75（squash）
        const p = t / 0.25;
        return 1.3 - p * 0.55;
      } else if (t < 0.55) {
        // 弹起阶段：从0.75弹到1.18（stretch）
        const p = (t - 0.25) / 0.30;
        return 0.75 + p * 0.43;
      } else if (t < 0.75) {
        // 回落阶段：从1.18回到0.95
        const p = (t - 0.55) / 0.20;
        return 1.18 - p * 0.23;
      } else {
        // 稳定阶段：从0.95弹到1.0
        const p = (t - 0.75) / 0.25;
        return 0.95 + p * 0.05;
      }
    }

    /**
     * 表情跳动缩放曲线
     */
    _emojiSpringScale(t) {
      if (t < 0.3) {
        const p = t / 0.3;
        return 1.0 + p * 0.5; // 放大到1.5
      } else if (t < 0.6) {
        const p = (t - 0.3) / 0.3;
        return 1.5 - p * 0.6; // 缩小到0.9
      } else {
        const p = (t - 0.6) / 0.4;
        return 0.9 + p * 0.1; // 回到1.0
      }
    }

    /**
     * 在 canvas 上绘制带缩放的猫咪脸（动画版）
     */
    _drawAnimEmoji(r, c, emoji, scale) {
      const ctx = this.ctx;
      const { x, y } = this.toPixel(r, c);
      const SW = this.cellSize * 0.46;
      const SH = this.cellSize * 0.40;
      // 获取该位置棋子颜色
      const color = this._lastBoard ? this._lastBoard.get(r, c) : GoEngine.BLACK;
      const isBlack = color === GoEngine.BLACK;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      _drawCatFace(ctx, 0, 0, Math.min(SW, SH) * 0.88, emoji, isBlack);
      ctx.restore();
    }

    /**
     * 绘制猫爪印粒子（canvas 层）
     * 用手绘图形代替 emoji，避免 canvas emoji 渲染退化
     */
    _drawPawPrints() {
      const ctx = this.ctx;
      const now = performance.now();
      this._pawPrints = this._pawPrints.filter(p => now - p.born < p.life);
      for (const p of this._pawPrints) {
        const age = (now - p.born) / p.life;
        if (age < 0) continue;
        const alpha = (1 - age) * 0.75;
        const sc = (0.4 + age * 0.6) * (p.size / 14);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.scale(sc, sc);
        // 爪印颜色：粉色
        ctx.fillStyle = p.color || 'rgba(255,140,160,0.9)';
        // 主掌垫（椭圆）
        ctx.beginPath();
        ctx.ellipse(0, 3, 4.5, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 四个趾垫（小圆）
        const toes = [[-4,-3],[-1.5,-5],[1.5,-5],[4,-3]];
        for (const [tx, ty] of toes) {
          ctx.beginPath();
          ctx.arc(tx, ty, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    /**
     * 棋盘覆盖层 v4：
     * - 每个棋块只显示一只"大猫"（在棋块重心位置）
     * - 猫头旁边有气泡显示气数
     * - 棋块内棋子之间用半透明连线连接（同块感知）
     * - 气数变化时气泡跳动
     */
    _updateCatOverlay(board) {
      if (!this.catOverlay) return;

      // 构建棋块信息
      const groups = []; // [{stones, libs, color, centroid}]
      const stoneGroupMap = new Map(); // `r,c` → groupIndex
      const visited = new Set();

      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          const color = board.get(r, c);
          if (color === GoEngine.EMPTY) continue;
          const key = `${r},${c}`;
          if (visited.has(key)) continue;

          const { stones, liberties } = board.getGroup(r, c);
          const libs = liberties.size;
          // 计算棋块重心
          const sumR = stones.reduce((s, [sr]) => s + sr, 0);
          const sumC = stones.reduce((s, [, sc]) => s + sc, 0);
          const centroid = { r: sumR / stones.length, c: sumC / stones.length };

          const idx = groups.length;
          groups.push({ stones, libs, color, centroid });
          stones.forEach(([sr, sc]) => {
            const k = `${sr},${sc}`;
            visited.add(k);
            stoneGroupMap.set(k, idx);
          });
        }
      }

      // 检测气数变化（用于触发跳动动画）
      const libChanged = new Set();
      for (const g of groups) {
        for (const [sr, sc] of g.stones) {
          const k = `${sr},${sc}`;
          const prev = this._prevLibCache.get(k);
          if (prev !== undefined && prev !== g.libs) {
            libChanged.add(groups.indexOf(g));
          }
        }
      }

      // 更新缓存
      this._prevLibCache.clear();
      for (const g of groups) {
        for (const [sr, sc] of g.stones) {
          this._prevLibCache.set(`${sr},${sc}`, g.libs);
        }
      }

      // 清空覆盖层
      this.catOverlay.innerHTML = '';

      const R = this.stoneRadius;
      const CS = this.cellSize;

      // 气数通过棋子表情切图（panic/cry/dead）展示，不再显示悬浮气泡标签

      // ── 3. 最后落子的涟漪效果（由 animatePlacement 触发，这里不重复）──
    }

    /**
     * 绘制气=1时的虚线矩形警示（对标美镜设计稿第3格）
     * 在棋盘canvas上直接绘制，随时间脉冲
     */
    _drawDangerCircles(board) {
      const ctx = this.ctx;
      const now = performance.now();
      const visited = new Set();
      const SW = this.cellSize * 0.46;
      const SH = this.cellSize * 0.40;

      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          const color = board.get(r, c);
          if (color === GoEngine.EMPTY) continue;
          const key = `${r},${c}`;
          if (visited.has(key)) continue;

          const { stones, liberties } = board.getGroup(r, c);
          const libs = liberties.size;
          stones.forEach(([sr, sc]) => visited.add(`${sr},${sc}`));

          if (libs !== 1) continue;

          // 气=1：在每颗棋子周围绘制虚线矩形（对标设计稿）
          const pulse = 0.5 + 0.5 * Math.sin(now / 220);
          const alpha = 0.55 + pulse * 0.45;
          const pad = SW * (0.12 + pulse * 0.06);

          ctx.save();
          ctx.strokeStyle = `rgba(220,60,50,${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);

          for (const [sr, sc] of stones) {
            const { x, y } = this.toPixel(sr, sc);
            ctx.beginPath();
            ctx.roundRect(x - SW - pad, y - SH - pad, (SW + pad) * 2, (SH + pad) * 2, SH * 0.5);
            ctx.stroke();
          }

          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }

    /**
     * 棋子连接合并特效（对标交互稿第5格）
     * 当新落子与已有棋子连接时，在连接线上产生闪光
     */
    animateConnection(r, c, color, connectedStones) {
      if (!this.catOverlay || !connectedStones || connectedStones.length === 0) return;
      const { x: cx, y: cy } = this.toPixel(r, c);

      for (const [nr, nc] of connectedStones) {
        const { x: nx, y: ny } = this.toPixel(nr, nc);
        // 在连接线中点产生星光粒子
        const mx = (cx + nx) / 2;
        const my = (cy + ny) / 2;

        const spark = document.createElement('div');
        spark.style.cssText = `
          position:absolute;
          left:${mx}px; top:${my}px;
          width:${this.cellSize * 0.3}px; height:${this.cellSize * 0.3}px;
          transform:translate(-50%,-50%);
          pointer-events:none; z-index:22;
          animation: connectionSpark 0.5s ease-out forwards;
          background: radial-gradient(circle, ${color === GoEngine.BLACK ? 'rgba(200,200,255,0.9)' : 'rgba(255,220,100,0.9)'} 0%, transparent 70%);
          border-radius: 50%;
        `;
        this.catOverlay.appendChild(spark);
        setTimeout(() => spark.remove(), 550);
      }
    }

    /**
     * 胜利庆祝动画（对标交互稿第12格）
     * 胜利方棋子全部跳动，并产生星星粒子
     */
    animateVictory(winnerColor) {
      if (!this.catOverlay || !this._lastBoard) return;
      const board = this._lastBoard;

      // 收集胜利方所有棋子位置
      const winnerStones = [];
      for (let r = 0; r < board.size; r++) {
        for (let c = 0; c < board.size; c++) {
          if (board.get(r, c) === winnerColor) {
            winnerStones.push([r, c]);
          }
        }
      }

      // 错开时间，逐个跳动
      winnerStones.forEach(([r, c], idx) => {
        const { x, y } = this.toPixel(r, c);
        const delay = (idx % 8) * 80; // 最多8个错开，循环

        // 跳动光晕
        const glow = document.createElement('div');
        glow.style.cssText = `
          position:absolute;
          left:${x}px; top:${y}px;
          width:${this.stoneRadius * 2.5}px; height:${this.stoneRadius * 2.5}px;
          border-radius:50%;
          transform:translate(-50%,-50%) scale(0);
          pointer-events:none; z-index:18;
          background: radial-gradient(circle, ${winnerColor === GoEngine.BLACK ? 'rgba(150,150,255,0.6)' : 'rgba(255,220,80,0.6)'} 0%, transparent 70%);
          animation: victoryGlow 1.2s ease-out ${delay}ms forwards;
        `;
        this.catOverlay.appendChild(glow);
        setTimeout(() => glow.remove(), 1400 + delay);
      });

      // 全屏星星粒子雨
      const stars = ['⭐','✨','🌟','💫','🎉','🎊'];
      const boardW = this.canvas.width;
      const boardH = this.canvas.height;
      for (let i = 0; i < 20; i++) {
        const star = document.createElement('div');
        const sx = Math.random() * boardW;
        const sy = Math.random() * boardH;
        const delay2 = Math.random() * 800;
        star.style.cssText = `
          position:absolute;
          left:${sx}px; top:${sy}px;
          font-size:${this.cellSize * (0.4 + Math.random() * 0.4)}px;
          transform:translate(-50%,-50%) scale(0);
          pointer-events:none; z-index:30;
          animation: victoryStar 1.0s ease-out ${delay2}ms forwards;
        `;
        star.textContent = stars[Math.floor(Math.random() * stars.length)];
        this.catOverlay.appendChild(star);
        setTimeout(() => star.remove(), 1200 + delay2);
      }
    }

    /**
     * 落子动画 v5：canvas 弹性缩放 + 涟漪 + 猫爪印粒子
     */
    animatePlacement(r, c, color) {
      const key = `${r},${c}`;
      const { x, y } = this.toPixel(r, c);

      // ── 1. canvas 弹性落子动画 ──
      const startTime = performance.now();
      const duration = 480; // ms
      this._stoneAnimMap.set(key, { t: 0, color, startTime, duration });
      // 启动动画循环（统一由 _startAnimLoop 驱动重绘）
      this._startAnimLoop();

      // ── 2. 猫爪印粒子（canvas 层）──
      const pawCount = 3;
      const now = performance.now();
      for (let i = 0; i < pawCount; i++) {
        const angle = (i / pawCount) * Math.PI * 2 + Math.random() * 0.6;
        const dist = this.cellSize * (0.6 + Math.random() * 0.35);
        this._pawPrints.push({
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist,
          angle: Math.random() * Math.PI * 2,
          size: this.cellSize * (0.22 + Math.random() * 0.12),
          born: now + i * 60,
          life: 380 + Math.random() * 120,  // 更短，最长500ms即消散
          color: color === GoEngine.BLACK ? 'rgba(255,140,170,0.85)' : 'rgba(200,100,130,0.85)',
        });
      }

      // ── 3. 涟漪（DOM 层，宽扁矩形适配新棋子形状）──
      if (!this.catOverlay) return;
      const SW = this.cellSize * 0.46;
      const SH = this.cellSize * 0.40;
      for (let i = 0; i < 2; i++) {
        const ripple = document.createElement('div');
        ripple.className = 'place-ripple';
        const scaleW = SW * (2.2 + i * 0.8);
        const scaleH = SH * (2.2 + i * 0.8);
        ripple.style.cssText = `
          position:absolute;
          left:${x}px; top:${y}px;
          width:${scaleW}px; height:${scaleH}px;
          border-radius: ${SH * 0.85}px;
          transform:translate(-50%,-50%) scale(0);
          border: 1.5px solid ${color === GoEngine.BLACK ? 'rgba(200,200,200,0.5)' : 'rgba(50,50,50,0.35)'};
          animation: rippleOut ${0.45 + i * 0.18}s ease-out ${i * 0.1}s forwards;
          pointer-events:none; z-index:20;
        `;
        this.catOverlay.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700 + i * 200);
      }
    }

    /**
     * 提子动画 v2：随机飞行 + 丰富粒子 + 震屏
     */
    animateCapture(stones) {
      if (!this.catOverlay) return;

      // 多颗同时被提时，震屏一次
      if (stones.length >= 2) {
        this.catOverlay.style.animation = 'none';
        this.catOverlay.offsetHeight; // reflow
        this.catOverlay.style.animation = 'boardShake 0.35s ease-out';
        setTimeout(() => { this.catOverlay.style.animation = ''; }, 380);
      }

      stones.forEach(([r, c], idx) => {
        const { x, y } = this.toPixel(r, c);
        const delay = idx * 55; // 多颗错开时间

        // ── 主猫咪飞走（随机方向）──
        const flyAngle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.8;
        const flyDx = Math.cos(flyAngle) * this.cellSize * 2.5;
        const flyDy = Math.sin(flyAngle) * this.cellSize * 2.5 - this.cellSize;
        const cat = document.createElement('div');
        cat.className = 'captured-cat';
        cat.style.cssText = `
          position:absolute;
          left:${x}px; top:${y}px;
          font-size:${this.stoneRadius * 2.0}px;
          transform:translate(-50%,-50%);
          pointer-events:none; z-index:25;
          --fly-dx:${flyDx}px; --fly-dy:${flyDy}px;
          animation: capturedFly 0.65s cubic-bezier(.2,.8,.4,1) ${delay}ms forwards;
        `;
        // 用 offscreen canvas 绘制猫咪脸
        const offC = document.createElement('canvas');
        const sz = Math.round(this.stoneRadius * 2.2);
        offC.width = sz; offC.height = sz;
        const offCtx = offC.getContext('2d');
        _drawCatFace(offCtx, sz / 2, sz / 2, sz * 0.42, 'panic', false);
        cat.appendChild(offC);
        this.catOverlay.appendChild(cat);
        setTimeout(() => cat.remove(), 700 + delay);

        // ── 爆炸粒子（泪珠+星星+爱心碎片）──
        const particles = ['💧','💧','💧','⭐','✨','💔','💫','🌟'];
        const count = 6 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
          const dist = this.stoneRadius * (1.2 + Math.random() * 1.4);
          const p = document.createElement('div');
          p.className = 'capture-particle';
          const pDelay = delay + i * 30;
          p.style.cssText = `
            position:absolute;
            left:${x}px; top:${y}px;
            font-size:${this.stoneRadius * (0.55 + Math.random() * 0.35)}px;
            transform:translate(-50%,-50%);
            pointer-events:none; z-index:24;
            animation: particleExplode ${0.45 + Math.random() * 0.2}s ease-out ${pDelay}ms forwards;
            --dx:${Math.cos(angle) * dist}px;
            --dy:${Math.sin(angle) * dist}px;
          `;
          p.textContent = particles[i % particles.length];
          this.catOverlay.appendChild(p);
          setTimeout(() => p.remove(), 700 + pDelay);
        }

        // ── 冲击波圆环 ──
        const shockwave = document.createElement('div');
        shockwave.style.cssText = `
          position:absolute;
          left:${x}px; top:${y}px;
          width:${this.stoneRadius * 2}px; height:${this.stoneRadius * 2}px;
          border-radius:20%;
          border: 2px solid rgba(231,76,60,0.7);
          transform:translate(-50%,-50%) scale(0);
          pointer-events:none; z-index:23;
          animation: shockwaveOut 0.4s ease-out ${delay}ms forwards;
        `;
        this.catOverlay.appendChild(shockwave);
        setTimeout(() => shockwave.remove(), 450 + delay);
      });
    }
  }

  // ===== 侧边栏猫咪气面板 v4 =====
  /**
   * 全新设计：
   * - 每个棋块 = 一张大卡片，猫咪头像更大
   * - 气数用"心形血条"展示（满血=绿心，危险=红心）
   * - 气=1时整张卡片红色闪烁
   * - 气=2时橙色脉冲
   * - 显示棋块大小（子数）
   */
  function updateSidebarCats(groups, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (groups.length === 0) {
      container.innerHTML = `
        <div class="cat-empty-state">
          <div class="empty-cat">🐾</div>
          <div>暂无棋子</div>
        </div>`;
      return;
    }

    // 按气数升序排列（危险的优先展示）
    const sorted = [...groups].sort((a, b) => a.liberties - b.liberties);
    const display = sorted.slice(0, 10);

    // 复用已有卡片（避免闪烁）
    const existingCards = Array.from(container.querySelectorAll('.cat-group-card'));
    const newCards = [];

    for (let i = 0; i < display.length; i++) {
      const group = display[i];
      const libs = group.liberties;
      const state = getCatState(libs);
      const stoneCount = group.stones.length;

      let card = existingCards[i];
      const isNew = !card;
      if (isNew) {
        card = document.createElement('div');
        card.className = `cat-group-card mood-${state.mood}`;
      } else {
        const prevMood = card.dataset.mood;
        if (prevMood !== state.mood) {
          card.className = `cat-group-card mood-${state.mood}`;
          if (libs < parseInt(card.dataset.libs || '99')) {
            card.classList.add('lib-decrease');
            setTimeout(() => card.classList.remove('lib-decrease'), 600);
          }
        }
      }
      card.dataset.mood = state.mood;
      card.dataset.libs = libs;
      card.title = state.tip;

      // 气数进度条宽度（最多8气=100%）
      const barPct = Math.min(libs / 8, 1) * 100;
      const barColor = libs === 0 ? '#666' : libs === 1 ? '#e74c3c' : libs === 2 ? '#e67e22' : libs === 3 ? '#f1c40f' : '#2ecc71';

      card.innerHTML = `
        <div class="cat-card-main">
          <div class="cat-avatar-wrap">
            <canvas class="cat-avatar-canvas ${state.avatarAnim}" width="52" height="52"></canvas>
            <div class="cat-size-badge">${stoneCount}子</div>
          </div>
          <div class="cat-card-body">
            <div class="cat-card-top">
              <span class="cat-lib-label">${state.label}</span>
              <span class="cat-lib-count ${state.countClass}">${libs === 0 ? '已提' : `${libs}气`}</span>
            </div>
            <div class="cat-lib-bar-wrap">
              <div class="cat-lib-bar" style="width:${barPct}%;background:${barColor};"></div>
            </div>
            ${libs <= 2 && libs > 0 ? `<div class="cat-warn-text">${libs === 1 ? '⚠ 即将被提！' : '⚠ 气紧'}</div>` : ''}
          </div>
        </div>
      `;
      // 绘制猫咪头像到 canvas（52x52，扁平手绘风）
      const avatarCanvas = card.querySelector('.cat-avatar-canvas');
      if (avatarCanvas) {
        const isBlackGroup = containerId.includes('black');
        const aCtx = avatarCanvas.getContext('2d');
        const sz = 52;
        const cx = sz / 2, cy = sz / 2;
        const SW = sz * 0.42; // 半宽
        const SH = sz * 0.36; // 半高（宽扁）
        const CR = SH * 0.85;

        // 绘制棋子主体（扁平纯色）
        aCtx.save();
        aCtx.fillStyle = isBlackGroup ? '#4a4a4a' : '#f0ede6';
        // 白棋加投影增加对比
        if (!isBlackGroup) {
          aCtx.shadowColor = 'rgba(80,55,20,0.30)';
          aCtx.shadowBlur = 3;
          aCtx.shadowOffsetY = 1;
        }
        aCtx.beginPath();
        aCtx.roundRect(cx - SW, cy - SH, SW*2, SH*2, CR);
        aCtx.fill();
        aCtx.shadowBlur = 0; aCtx.shadowOffsetY = 0;
        aCtx.strokeStyle = isBlackGroup ? 'rgba(30,25,20,0.65)' : 'rgba(70,50,25,0.80)';
        aCtx.lineWidth = isBlackGroup ? 1.0 : 1.5;
        aCtx.stroke();
        aCtx.restore();
        // 绘制猫咪脸
        _drawCatFace(aCtx, cx, cy, Math.min(SW, SH) * 0.90, state.mood, isBlackGroup);
      }

      if (isNew) {
        card.classList.add('card-enter');
        setTimeout(() => card.classList.remove('card-enter'), 400);
      }

      newCards.push(card);
    }

    // 移除多余的旧卡片
    container.innerHTML = '';
    for (const card of newCards) container.appendChild(card);

    if (sorted.length > 10) {
      const more = document.createElement('div');
      more.className = 'cat-more-hint';
      more.textContent = `还有 ${sorted.length - 10} 块…`;
      container.appendChild(more);
    }
  }

  /**
   * 渲染心形血条
   * 最多显示8颗心，根据气数填充
   */
  function _renderHearts(libs) {
    const maxHearts = 8;
    const filled = Math.min(libs, maxHearts);
    let html = '';
    for (let i = 0; i < maxHearts; i++) {
      if (i < filled) {
        // 填充的心
        let heartClass = 'heart-full';
        if (libs === 1) heartClass = 'heart-danger';
        else if (libs === 2) heartClass = 'heart-warn';
        else if (libs === 3) heartClass = 'heart-okay';
        html += `<span class="heart ${heartClass}">♥</span>`;
      } else {
        html += `<span class="heart heart-empty">♡</span>`;
      }
    }
    return html;
  }

  // ===== 规则演示棋盘 =====
  function drawDemoBoard(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 5, padding = 22;
    const cellSize = (canvas.width - padding * 2) / (size - 1);
    ctx.fillStyle = '#DCB468';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(80,50,10,0.7)'; ctx.lineWidth = 1;
    for (let i = 0; i < size; i++) {
      const x = padding + i * cellSize, y = padding + i * cellSize;
      ctx.beginPath(); ctx.moveTo(x, padding); ctx.lineTo(x, canvas.height - padding); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(canvas.width - padding, y); ctx.stroke();
    }
    const stones = [[0,0,GoEngine.BLACK],[0,2,GoEngine.BLACK],[2,2,GoEngine.BLACK]];
    for (const [r, c, color] of stones) {
      const x = padding + c * cellSize, y = padding + r * cellSize;
      const radius = cellSize * 0.4;
      const g = ctx.createRadialGradient(x-radius*.3, y-radius*.3, radius*.1, x, y, radius);
      if (color === GoEngine.BLACK) { g.addColorStop(0,'#555'); g.addColorStop(1,'#000'); }
      else { g.addColorStop(0,'#fff'); g.addColorStop(1,'#d8d8d0'); }
      ctx.fillStyle = g;
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
      const libs = (r===0&&c===0)?2:(r===0&&c===2)?3:4;
      const emoji = getStoneEmoji(libs);
      ctx.font = `${radius * 1.1}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(emoji, x, y);
    }
  }

  // ===== 音效系统（Web Audio API，无需外部文件）=====
  const SoundFX = (() => {
    let ctx = null;
    function getCtx() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
      }
      return ctx;
    }

    // 通用音符播放
    function playTone(freq, type, duration, gain, attack = 0.005, decay = 0.1) {
      const ac = getCtx(); if (!ac) return;
      const osc = ac.createOscillator();
      const gainNode = ac.createGain();
      osc.connect(gainNode); gainNode.connect(ac.destination);
      osc.type = type; osc.frequency.value = freq;
      const now = ac.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(gain, now + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.start(now); osc.stop(now + duration + 0.05);
    }

    // 噪声生成（用于打击音）
    function playNoise(duration, gain, filterFreq = 2000) {
      const ac = getCtx(); if (!ac) return;
      const bufSize = ac.sampleRate * duration;
      const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filter = ac.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = filterFreq; filter.Q.value = 0.5;
      const gainNode = ac.createGain();
      src.connect(filter); filter.connect(gainNode); gainNode.connect(ac.destination);
      const now = ac.currentTime;
      gainNode.gain.setValueAtTime(gain, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
      src.start(now); src.stop(now + duration + 0.05);
    }

    return {
      // 落子音：清脆的"啪"声（噪声+短音调）
      place(isBlack) {
        playNoise(0.06, isBlack ? 0.18 : 0.12, isBlack ? 1800 : 2400);
        playTone(isBlack ? 320 : 480, 'sine', 0.12, isBlack ? 0.08 : 0.06);
      },
      // 提子音：低沉的"咚"声
      capture(count) {
        playNoise(0.12, 0.22, 800);
        playTone(180, 'sine', 0.25, 0.12);
        if (count >= 3) {
          setTimeout(() => playTone(140, 'sine', 0.3, 0.1), 80);
        }
      },
      // 警告音：轻柔的"叮"声（气=1时）
      warning() {
        playTone(880, 'sine', 0.18, 0.06);
        setTimeout(() => playTone(660, 'sine', 0.15, 0.04), 120);
      },
      // 虚手音
      pass() {
        playTone(440, 'sine', 0.2, 0.05);
        setTimeout(() => playTone(330, 'sine', 0.2, 0.04), 150);
      },
    };
  })();

  return { BoardRenderer, updateSidebarCats, drawDemoBoard, getCatState, getStoneEmoji, SoundFX };
})();
