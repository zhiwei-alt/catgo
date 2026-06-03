/**
 * CatGo 死活题 & 手筋题库 v3
 * 目标用户：业余10级 ~ 1段
 * 10道死活题 + 10道手筋题，用于评估用户水平
 *
 * 交互方式：用户直接在棋盘上点击落子来提交答案
 * correctAnswer: [r, c]  — 正确落子坐标
 * wrongAnswers: [[r,c],...] — 常见错误落子坐标（可选，用于特殊提示）
 *
 * 坐标系：[row, col]，从左上角(0,0)开始
 * 棋盘标注：列用 A-I，行用 1-9（从上到下）
 * 难度：1=10级, 2=7级, 3=5级, 4=3级, 5=1段
 */

const Problems = (() => {

  // ===== 死活题（判断黑棋能否存活 / 如何做活）=====
  const TSUMEGO_PROBLEMS = [
    {
      id: 'ts1',
      type: 'tsumego',
      title: '角上直三',
      description: '白棋先手，点入要害杀死黑棋',
      difficulty: 1,
      boardSize: 9,
      playerColor: 'W',   // 本题玩家执白
      stones: [
        { r: 0, c: 3, color: 'B' },
        { r: 1, c: 0, color: 'B' },
        { r: 1, c: 1, color: 'B' },
        { r: 1, c: 2, color: 'B' },
        { r: 1, c: 3, color: 'B' },
        { r: 0, c: 4, color: 'W' },
        { r: 1, c: 4, color: 'W' },
        { r: 2, c: 0, color: 'W' },
        { r: 2, c: 1, color: 'W' },
        { r: 2, c: 2, color: 'W' },
        { r: 2, c: 3, color: 'W' },
      ],
      question: '黑棋内部有三个空点（角上直三），白棋先手，点入要害可以杀死黑棋。请点击正确位置。',
      correctAnswer: [0, 1],
      explanation: '白棋在 B1 点入中间，黑棋内部被分成两个单眼，无法做出两个真眼，黑棋死！角上直三是围棋基本死棋形状。',
    },
    {
      id: 'ts2',
      type: 'tsumego',
      title: '角上曲三做活',
      description: '黑棋先手，找到做活的关键点',
      difficulty: 1,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 0, c: 2, color: 'B' },
        { r: 1, c: 1, color: 'B' },
        { r: 1, c: 2, color: 'B' },
        { r: 2, c: 0, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 0, c: 3, color: 'W' },
        { r: 1, c: 3, color: 'W' },
        { r: 2, c: 2, color: 'W' },
        { r: 3, c: 0, color: 'W' },
        { r: 3, c: 1, color: 'W' },
      ],
      question: '黑棋内部有 A1、B1、A2 三个L形空点（曲三），黑棋先手，点击正确位置做活。',
      correctAnswer: [0, 1],
      explanation: '黑棋在 B1 落子，将三个空点分成 A1 和 A2 两个独立的眼，形成活棋！如果白棋先手在 B1 点入，黑棋就死了。',
    },
    {
      id: 'ts3',
      type: 'tsumego',
      title: '方四无条件活',
      description: '白棋先手，能杀死黑棋吗？',
      difficulty: 1,
      boardSize: 9,
      playerColor: 'W',
      stones: [
        { r: 1, c: 1, color: 'B' },
        { r: 1, c: 2, color: 'B' },
        { r: 1, c: 3, color: 'B' },
        { r: 1, c: 4, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 4, color: 'B' },
        { r: 3, c: 1, color: 'B' },
        { r: 3, c: 4, color: 'B' },
        { r: 4, c: 1, color: 'B' },
        { r: 4, c: 2, color: 'B' },
        { r: 4, c: 3, color: 'B' },
        { r: 4, c: 4, color: 'B' },
        { r: 0, c: 1, color: 'W' },
        { r: 0, c: 2, color: 'W' },
        { r: 0, c: 3, color: 'W' },
        { r: 0, c: 4, color: 'W' },
        { r: 1, c: 0, color: 'W' },
        { r: 2, c: 0, color: 'W' },
        { r: 3, c: 0, color: 'W' },
        { r: 4, c: 0, color: 'W' },
        { r: 5, c: 1, color: 'W' },
        { r: 5, c: 2, color: 'W' },
        { r: 5, c: 3, color: 'W' },
        { r: 5, c: 4, color: 'W' },
        { r: 1, c: 5, color: 'W' },
        { r: 2, c: 5, color: 'W' },
        { r: 3, c: 5, color: 'W' },
        { r: 4, c: 5, color: 'W' },
      ],
      question: '黑棋内部有 2×2 的四个空点（方四），白棋先手，请点击你认为能杀死黑棋的位置。',
      // 方四无条件活，白棋任何落子都无效——正确答案是"虚手"，用特殊坐标 [-1,-1] 表示
      correctAnswer: [-1, -1],
      isPassCorrect: true,   // 正确答案是虚手（不落子）
      explanation: '方四是无条件活棋！内部四个空点形成两个真眼，白棋无论落在哪里都无法破坏。正确答案是"虚手"——承认黑棋已经活了。',
    },
    {
      id: 'ts4',
      type: 'tsumego',
      title: '刀五死棋',
      description: '白棋先手，找到要害点杀棋',
      difficulty: 2,
      boardSize: 9,
      playerColor: 'W',
      stones: [
        { r: 1, c: 2, color: 'B' },
        { r: 1, c: 3, color: 'B' },
        { r: 1, c: 4, color: 'B' },
        { r: 1, c: 5, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 5, color: 'B' },
        { r: 3, c: 1, color: 'B' },
        { r: 3, c: 5, color: 'B' },
        { r: 4, c: 1, color: 'B' },
        { r: 4, c: 2, color: 'B' },
        { r: 4, c: 3, color: 'B' },
        { r: 4, c: 4, color: 'B' },
        { r: 4, c: 5, color: 'B' },
        { r: 0, c: 2, color: 'W' },
        { r: 0, c: 3, color: 'W' },
        { r: 0, c: 4, color: 'W' },
        { r: 0, c: 5, color: 'W' },
        { r: 1, c: 1, color: 'W' },
        { r: 1, c: 6, color: 'W' },
        { r: 2, c: 0, color: 'W' },
        { r: 2, c: 6, color: 'W' },
        { r: 3, c: 0, color: 'W' },
        { r: 3, c: 6, color: 'W' },
        { r: 4, c: 0, color: 'W' },
        { r: 4, c: 6, color: 'W' },
        { r: 5, c: 1, color: 'W' },
        { r: 5, c: 2, color: 'W' },
        { r: 5, c: 3, color: 'W' },
        { r: 5, c: 4, color: 'W' },
        { r: 5, c: 5, color: 'W' },
      ],
      question: '黑棋内部有5个空点（刀五形），白棋先手，点击要害点可以杀死黑棋。',
      correctAnswer: [2, 4],
      explanation: '白棋在 E3 落子是要害！黑棋内部无法分成两个真眼，黑棋死。刀五是围棋著名死棋形状，要害点在"刀柄"处。',
    },
    {
      id: 'ts5',
      type: 'tsumego',
      title: '大眼做活',
      description: '黑棋先手，找到做活的关键点',
      difficulty: 2,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 1, c: 2, color: 'B' },
        { r: 1, c: 3, color: 'B' },
        { r: 1, c: 4, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 4, color: 'B' },
        { r: 3, c: 1, color: 'B' },
        { r: 3, c: 4, color: 'B' },
        { r: 4, c: 2, color: 'B' },
        { r: 4, c: 3, color: 'B' },
        { r: 4, c: 4, color: 'B' },
        { r: 0, c: 2, color: 'W' },
        { r: 0, c: 3, color: 'W' },
        { r: 0, c: 4, color: 'W' },
        { r: 1, c: 1, color: 'W' },
        { r: 1, c: 5, color: 'W' },
        { r: 2, c: 0, color: 'W' },
        { r: 2, c: 5, color: 'W' },
        { r: 3, c: 0, color: 'W' },
        { r: 3, c: 5, color: 'W' },
        { r: 4, c: 1, color: 'W' },
        { r: 4, c: 5, color: 'W' },
        { r: 5, c: 2, color: 'W' },
        { r: 5, c: 3, color: 'W' },
        { r: 5, c: 4, color: 'W' },
      ],
      question: '黑棋内部有4个空点（田字形），黑棋先手，点击正确位置做活。',
      correctAnswer: [2, 2],
      explanation: '黑棋在 C3 落子，将4个空点分成两个眼做活！如果不落子，白棋在 C3 点入，黑棋就死了。这是"大眼做活"的基本手法。',
    },
    {
      id: 'ts6',
      type: 'tsumego',
      title: '双活识别',
      description: '黑棋先手，这里能杀死白棋吗？',
      difficulty: 2,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 2, c: 2, color: 'B' },
        { r: 2, c: 3, color: 'B' },
        { r: 3, c: 1, color: 'B' },
        { r: 3, c: 4, color: 'B' },
        { r: 4, c: 2, color: 'B' },
        { r: 4, c: 3, color: 'B' },
        { r: 1, c: 2, color: 'W' },
        { r: 1, c: 3, color: 'W' },
        { r: 2, c: 1, color: 'W' },
        { r: 2, c: 4, color: 'W' },
        { r: 3, c: 2, color: 'W' },
        { r: 3, c: 3, color: 'W' },
        { r: 4, c: 1, color: 'W' },
        { r: 4, c: 4, color: 'W' },
        { r: 5, c: 2, color: 'W' },
        { r: 5, c: 3, color: 'W' },
      ],
      question: '黑白双方共享 D4、D5 两口公气，这是"双活"局面。黑棋不能杀白，请点击"虚手"确认。',
      correctAnswer: [-1, -1],
      isPassCorrect: true,
      explanation: '这是"双活"！任何一方填入公气都会让自己被提走，所以双方都不能动。双活的棋子都算活棋，公气不计入任何一方的目数。',
    },
    {
      id: 'ts7',
      type: 'tsumego',
      title: '紧气杀棋',
      description: '黑棋先手，找到紧气杀棋的要点',
      difficulty: 3,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 2, c: 2, color: 'W' },
        { r: 2, c: 3, color: 'W' },
        { r: 2, c: 4, color: 'W' },
        { r: 3, c: 2, color: 'W' },
        { r: 3, c: 4, color: 'W' },
        { r: 4, c: 2, color: 'W' },
        { r: 4, c: 3, color: 'W' },
        { r: 4, c: 4, color: 'W' },
        { r: 1, c: 2, color: 'B' },
        { r: 1, c: 3, color: 'B' },
        { r: 1, c: 4, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 5, color: 'B' },
        { r: 3, c: 1, color: 'B' },
        { r: 3, c: 5, color: 'B' },
        { r: 4, c: 1, color: 'B' },
        { r: 4, c: 5, color: 'B' },
        { r: 5, c: 2, color: 'B' },
        { r: 5, c: 3, color: 'B' },
        { r: 5, c: 4, color: 'B' },
      ],
      question: '白棋内部只有 D4 一个空点，黑棋先手，点击正确位置一步杀死白棋。',
      correctAnswer: [3, 3],
      explanation: '黑棋在 D4 点眼！填掉白棋唯一的内部空点，白棋被提走。这是"点眼"手筋，直接填入对方的眼位来杀棋。',
    },
    {
      id: 'ts8',
      type: 'tsumego',
      title: '边上做活',
      description: '白棋先手，找到要害点杀棋',
      difficulty: 3,
      boardSize: 9,
      playerColor: 'W',
      stones: [
        { r: 0, c: 1, color: 'B' },
        { r: 0, c: 2, color: 'B' },
        { r: 0, c: 3, color: 'B' },
        { r: 0, c: 4, color: 'B' },
        { r: 0, c: 5, color: 'B' },
        { r: 1, c: 1, color: 'B' },
        { r: 1, c: 5, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 2, color: 'B' },
        { r: 2, c: 3, color: 'B' },
        { r: 2, c: 4, color: 'B' },
        { r: 2, c: 5, color: 'B' },
        { r: 0, c: 0, color: 'W' },
        { r: 0, c: 6, color: 'W' },
        { r: 1, c: 0, color: 'W' },
        { r: 1, c: 6, color: 'W' },
        { r: 2, c: 0, color: 'W' },
        { r: 2, c: 6, color: 'W' },
        { r: 3, c: 1, color: 'W' },
        { r: 3, c: 2, color: 'W' },
        { r: 3, c: 3, color: 'W' },
        { r: 3, c: 4, color: 'W' },
        { r: 3, c: 5, color: 'W' },
      ],
      question: '黑棋内部有 C2、D2、E2 三个空点（边上直三），白棋先手，点击要害点杀棋。',
      correctAnswer: [1, 3],
      explanation: '白棋在 D2 点入中间，黑棋内部三个空点变成两个单眼，无法做出两个真眼，黑棋死！边上直三和角上直三一样，要害点都在中间。',
    },
    {
      id: 'ts9',
      type: 'tsumego',
      title: '独眼死棋',
      description: '黑棋先手，能做出第二个眼吗？',
      difficulty: 4,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 0, c: 0, color: 'B' },
        { r: 0, c: 1, color: 'B' },
        { r: 0, c: 2, color: 'B' },
        { r: 1, c: 0, color: 'B' },
        { r: 1, c: 2, color: 'B' },
        { r: 2, c: 0, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 2, color: 'B' },
        { r: 0, c: 3, color: 'W' },
        { r: 1, c: 3, color: 'W' },
        { r: 2, c: 3, color: 'W' },
        { r: 3, c: 0, color: 'W' },
        { r: 3, c: 1, color: 'W' },
        { r: 3, c: 2, color: 'W' },
      ],
      question: '黑棋只有 B2 一个眼，被白棋完全包围，黑棋无法做出第二个眼。请点击"虚手"确认黑棋是死棋。',
      correctAnswer: [-1, -1],
      isPassCorrect: true,
      explanation: '黑棋只有一个眼，是死棋！围棋中活棋必须有两个真眼。这个形状叫"独眼"，无论黑棋怎么下都无法再做出第二个眼，白棋可以从外部逐步紧气提掉黑棋。',
    },
    {
      id: 'ts10',
      type: 'tsumego',
      title: '劫争识别',
      description: '黑棋先手，找到打劫的关键点',
      difficulty: 4,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 2, c: 3, color: 'B' },
        { r: 3, c: 2, color: 'B' },
        { r: 3, c: 4, color: 'B' },
        { r: 4, c: 3, color: 'B' },
        { r: 1, c: 3, color: 'W' },
        { r: 2, c: 2, color: 'W' },
        { r: 2, c: 4, color: 'W' },
        { r: 3, c: 3, color: 'W' },
        { r: 4, c: 2, color: 'W' },
        { r: 4, c: 4, color: 'W' },
        { r: 5, c: 3, color: 'W' },
      ],
      question: '黑棋可以在 D4 提掉白棋一子，形成劫争。请点击 D4 发起打劫。',
      correctAnswer: [3, 3],
      explanation: '黑棋在 D4 提掉白棋，形成劫争！白棋不能立即在 D4 打回来（劫规则），需要先在别处找"劫材"威胁黑棋，然后才能回来提劫。劫争是围棋中最激烈的战斗形式。',
    }
  ];

  // ===== 手筋题（寻找最佳手段）=====
  const TESUJI_PROBLEMS = [
    {
      id: 'tj1',
      type: 'tesuji',
      title: '征子手筋',
      description: '黑棋先手，用征子追击白棋',
      difficulty: 1,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 2, c: 2, color: 'B' },
        { r: 3, c: 3, color: 'B' },
        { r: 2, c: 4, color: 'W' },
        { r: 3, c: 4, color: 'W' },
        { r: 2, c: 3, color: 'W' },
      ],
      question: '白棋三子只有两口气，黑棋先手，点击正确位置用"征子"手段紧气追击。',
      correctAnswer: [1, 3],
      explanation: '黑棋在 D2 落子，白棋只剩一口气，被迫逃跑。黑棋可以一路追击，每次都让白棋只剩一口气，直到白棋无路可逃被提掉。这就是"征子"！',
    },
    {
      id: 'tj2',
      type: 'tesuji',
      title: '双吃手筋',
      description: '黑棋先手，一步同时威胁两块白棋',
      difficulty: 1,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 1, c: 3, color: 'B' },
        { r: 3, c: 1, color: 'B' },
        { r: 5, c: 3, color: 'B' },
        { r: 3, c: 5, color: 'B' },
        { r: 1, c: 4, color: 'W' },
        { r: 1, c: 5, color: 'W' },
        { r: 5, c: 4, color: 'W' },
        { r: 5, c: 5, color: 'W' },
      ],
      question: '黑棋在哪里落子可以同时威胁右上和右下两块白棋（双吃）？请点击正确位置。',
      correctAnswer: [3, 5],
      explanation: '黑棋在 F4 落子，同时让右上白棋和右下白棋都只剩一口气，白棋只能救一块，黑棋必得一块。这就是"双吃"（叉）手筋！',
    },
    {
      id: 'tj3',
      type: 'tesuji',
      title: '扑入手筋',
      description: '黑棋先手，用扑入提掉白棋',
      difficulty: 2,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 2, c: 2, color: 'B' },
        { r: 2, c: 4, color: 'B' },
        { r: 4, c: 2, color: 'B' },
        { r: 4, c: 4, color: 'B' },
        { r: 2, c: 3, color: 'W' },
        { r: 3, c: 2, color: 'W' },
        { r: 3, c: 4, color: 'W' },
        { r: 4, c: 3, color: 'W' },
      ],
      question: '白棋四子围住了 D4，黑棋在 D4 落子看似自杀，实则可以提掉白棋。请点击 D4。',
      correctAnswer: [3, 3],
      explanation: '黑棋在 D4 扑入！落子后白棋四子的气全部被占，黑棋可以提掉白棋四子。这是"扑入"手筋——利用提子规则，看似自杀实则吃棋。',
    },
    {
      id: 'tj4',
      type: 'tesuji',
      title: '切断手筋',
      description: '黑棋先手，切断白棋的联络',
      difficulty: 2,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 1, c: 1, color: 'B' },
        { r: 1, c: 5, color: 'B' },
        { r: 5, c: 1, color: 'B' },
        { r: 5, c: 5, color: 'B' },
        { r: 1, c: 3, color: 'W' },
        { r: 2, c: 2, color: 'W' },
        { r: 2, c: 4, color: 'W' },
        { r: 3, c: 3, color: 'W' },
        { r: 4, c: 2, color: 'W' },
        { r: 4, c: 4, color: 'W' },
        { r: 5, c: 3, color: 'W' },
      ],
      question: '白棋形成菱形连接，黑棋用"挖"的手段切断白棋联络。请点击正确位置。',
      correctAnswer: [3, 2],
      explanation: '黑棋在 C4 挖，切断了 C3 和 C5 的联络，同时威胁 D4。"挖"是围棋中切断对方连接的基本手筋，在对方两子的斜向空点落子，可以同时切断两个方向的联络。',
    },
    {
      id: 'tj5',
      type: 'tesuji',
      title: '点眼手筋',
      description: '黑棋先手，点入白棋的眼位',
      difficulty: 3,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 1, c: 3, color: 'W' },
        { r: 2, c: 2, color: 'W' },
        { r: 2, c: 4, color: 'W' },
        { r: 3, c: 1, color: 'W' },
        { r: 3, c: 5, color: 'W' },
        { r: 4, c: 2, color: 'W' },
        { r: 4, c: 4, color: 'W' },
        { r: 5, c: 3, color: 'W' },
        { r: 0, c: 3, color: 'B' },
        { r: 1, c: 2, color: 'B' },
        { r: 1, c: 4, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 5, color: 'B' },
        { r: 3, c: 0, color: 'B' },
        { r: 3, c: 6, color: 'B' },
        { r: 4, c: 1, color: 'B' },
        { r: 4, c: 5, color: 'B' },
        { r: 5, c: 2, color: 'B' },
        { r: 5, c: 4, color: 'B' },
        { r: 6, c: 3, color: 'B' },
      ],
      question: '白棋内部有 D4 一个假眼，黑棋先手，点入假眼位置可以破坏白棋的眼位。请点击正确位置。',
      correctAnswer: [3, 3],
      explanation: '黑棋在 D4 点眼！白棋内部的 D4 是假眼（周围有黑棋），黑棋点入后白棋无法做出两个真眼，黑棋可以逐步紧气杀死白棋。',
    },
    {
      id: 'tj6',
      type: 'tesuji',
      title: '接不归手筋',
      description: '黑棋先手，让白棋无法接回',
      difficulty: 3,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 2, c: 1, color: 'W' },
        { r: 2, c: 2, color: 'W' },
        { r: 3, c: 0, color: 'W' },
        { r: 1, c: 0, color: 'B' },
        { r: 1, c: 1, color: 'B' },
        { r: 1, c: 2, color: 'B' },
        { r: 2, c: 3, color: 'B' },
        { r: 3, c: 1, color: 'B' },
        { r: 3, c: 2, color: 'B' },
        { r: 4, c: 0, color: 'B' },
      ],
      question: '白棋三子被黑棋包围，黑棋先手，找到"接不归"的要点，让白棋无法逃脱。请点击正确位置。',
      correctAnswer: [3, 3],
      explanation: '黑棋在 D4 落子，形成"接不归"！白棋无论往哪里逃，黑棋都能追上并提掉。接不归是利用棋形特点，让对方棋子无论如何都无法与外部棋子相连的手筋。',
    },
    {
      id: 'tj7',
      type: 'tesuji',
      title: '倒扑手筋',
      description: '黑棋先手，用倒扑吃掉白棋',
      difficulty: 4,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 0, c: 0, color: 'W' },
        { r: 0, c: 1, color: 'W' },
        { r: 1, c: 0, color: 'W' },
        { r: 0, c: 2, color: 'B' },
        { r: 1, c: 1, color: 'B' },
        { r: 2, c: 0, color: 'B' },
      ],
      question: '角上白棋三子，黑棋先手，用"倒扑"手筋一步吃掉白棋。请点击正确位置。',
      correctAnswer: [1, 2],
      explanation: '黑棋在 C2 落子！这是"倒扑"手筋——黑棋落子后，白棋如果提掉黑棋，反而会让自己陷入被提的局面。白棋三子无法逃脱，黑棋可以全部提掉。',
    },
    {
      id: 'tj8',
      type: 'tesuji',
      title: '枷吃手筋',
      description: '黑棋先手，用枷吃困住白棋',
      difficulty: 4,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 2, c: 4, color: 'W' },
        { r: 3, c: 3, color: 'W' },
        { r: 1, c: 3, color: 'B' },
        { r: 2, c: 2, color: 'B' },
        { r: 4, c: 2, color: 'B' },
        { r: 4, c: 4, color: 'B' },
      ],
      question: '白棋两子试图逃跑，黑棋先手，用"枷吃"手筋困住白棋，让其无论往哪里逃都会被吃。请点击正确位置。',
      correctAnswer: [1, 5],
      explanation: '黑棋在 F2 落子，形成"枷吃"！白棋无论往哪个方向逃，都会进入黑棋的包围圈。枷吃是比征子更灵活的追击手段，不需要白棋一直只有一口气。',
    },
    {
      id: 'tj9',
      type: 'tesuji',
      title: '滚打包收',
      description: '黑棋先手，用连续手段吃掉白棋',
      difficulty: 5,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 1, c: 1, color: 'W' },
        { r: 1, c: 2, color: 'W' },
        { r: 1, c: 3, color: 'W' },
        { r: 2, c: 3, color: 'W' },
        { r: 0, c: 1, color: 'B' },
        { r: 0, c: 2, color: 'B' },
        { r: 0, c: 3, color: 'B' },
        { r: 0, c: 4, color: 'B' },
        { r: 1, c: 4, color: 'B' },
        { r: 2, c: 0, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 2, c: 2, color: 'B' },
        { r: 3, c: 3, color: 'B' },
      ],
      question: '白棋四子被黑棋包围，黑棋先手，找到"滚打包收"的第一手，连续紧气吃掉白棋。请点击正确位置。',
      correctAnswer: [2, 4],
      explanation: '黑棋在 E3 落子，开始"滚打包收"！通过连续的紧气手段，黑棋可以一步步压缩白棋的气，最终将白棋全部提掉。这是围棋中最精彩的连续手筋之一。',
    },
    {
      id: 'tj10',
      type: 'tesuji',
      title: '大头鬼手筋',
      description: '黑棋先手，找到最强手段',
      difficulty: 5,
      boardSize: 9,
      playerColor: 'B',
      stones: [
        { r: 0, c: 0, color: 'W' },
        { r: 0, c: 1, color: 'W' },
        { r: 0, c: 2, color: 'W' },
        { r: 1, c: 2, color: 'W' },
        { r: 2, c: 2, color: 'W' },
        { r: 0, c: 3, color: 'B' },
        { r: 1, c: 0, color: 'B' },
        { r: 1, c: 3, color: 'B' },
        { r: 2, c: 0, color: 'B' },
        { r: 2, c: 1, color: 'B' },
        { r: 3, c: 2, color: 'B' },
      ],
      question: '白棋五子形成"大头鬼"形状，黑棋先手，找到要害点一步杀死白棋。请点击正确位置。',
      correctAnswer: [1, 1],
      explanation: '黑棋在 B2 落子，点入"大头鬼"的要害！白棋内部无法形成两个真眼，黑棋可以逐步紧气将白棋全部提掉。大头鬼是围棋中著名的死棋形状，要害点在中心位置。',
    },
  ];

  // ===== 棋盘绘制（含坐标标注）=====
  /**
   * 在 canvas 上绘制题目棋盘
   * 特性：
   *   - 棋盘四周留出坐标标注区域
   *   - 列标注：A-I（从左到右）
   *   - 行标注：1-9（从上到下）
   *   - 玩家落子预览（hoverStone）
   *   - 正确答案高亮（answerStone）
   */
  function drawProblemBoard(canvas, problem, options = {}) {
    const ctx = canvas.getContext('2d');
    const size = problem.boardSize || 9;
    const W = canvas.width;
    const H = canvas.height;

    // 坐标标注区域宽度
    const COORD_MARGIN = Math.round(W * 0.072);
    // 棋盘实际绘制区域（去掉四周坐标区）
    const boardLeft   = COORD_MARGIN;
    const boardTop    = COORD_MARGIN;
    const boardRight  = W - COORD_MARGIN;
    const boardBottom = H - COORD_MARGIN;
    const boardW = boardRight - boardLeft;
    const boardH = boardBottom - boardTop;
    const cellSize = boardW / (size - 1);

    ctx.clearRect(0, 0, W, H);

    // ── 背景 ──
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#f0c060');
    bgGrad.addColorStop(1, '#d4a040');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ── 棋盘纹理（木纹线条）──
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = '#8B5E1A';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + W * 0.1, H); ctx.stroke();
    }
    ctx.restore();

    // ── 棋盘格线 ──
    ctx.strokeStyle = '#8B5E1A';
    ctx.lineWidth = 1;
    for (let i = 0; i < size; i++) {
      const x = boardLeft + i * cellSize;
      const y = boardTop  + i * cellSize;
      ctx.beginPath(); ctx.moveTo(x, boardTop);    ctx.lineTo(x, boardBottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(boardLeft, y);   ctx.lineTo(boardRight, y);  ctx.stroke();
    }

    // ── 星位 ──
    const starPoints = size === 9
      ? [[2,2],[2,6],[6,2],[6,6],[4,4]]
      : size === 13
        ? [[3,3],[3,9],[9,3],[9,9],[6,6]]
        : [];
    ctx.fillStyle = '#8B5E1A';
    for (const [sr, sc] of starPoints) {
      const sx = boardLeft + sc * cellSize;
      const sy = boardTop  + sr * cellSize;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2.5, cellSize * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 坐标标注 ──
    const COLS = 'ABCDEFGHI';
    const fontSize = Math.max(9, Math.round(COORD_MARGIN * 0.62));
    ctx.font = `bold ${fontSize}px "SF Pro Display", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(80, 40, 0, 0.85)';

    for (let i = 0; i < size; i++) {
      const x = boardLeft + i * cellSize;
      const y = boardTop  + i * cellSize;

      // 列标（上方）：A B C ...
      ctx.fillText(COLS[i], x, COORD_MARGIN * 0.45);
      // 列标（下方）
      ctx.fillText(COLS[i], x, H - COORD_MARGIN * 0.45);

      // 行标（左侧）：1 2 3 ...
      ctx.fillText(String(i + 1), COORD_MARGIN * 0.45, y);
      // 行标（右侧）
      ctx.fillText(String(i + 1), W - COORD_MARGIN * 0.45, y);
    }

    // ── 棋子 ──
    const stoneR = cellSize * 0.44;
    for (const stone of (problem.stones || [])) {
      const sx = boardLeft + stone.c * cellSize;
      const sy = boardTop  + stone.r * cellSize;
      _drawStone(ctx, sx, sy, stoneR, stone.color === 'B');
    }

    // ── 悬停预览（半透明落子）──
    if (options.hoverStone) {
      const [hr, hc] = options.hoverStone;
      const sx = boardLeft + hc * cellSize;
      const sy = boardTop  + hr * cellSize;
      const isBlack = problem.playerColor !== 'W';
      ctx.save();
      ctx.globalAlpha = 0.45;
      _drawStone(ctx, sx, sy, stoneR, isBlack);
      ctx.restore();
    }

    // ── 答案高亮（答题后显示）──
    if (options.answerStone) {
      const { pos, correct } = options.answerStone;
      if (pos && pos[0] >= 0) {
        const [ar, ac] = pos;
        const sx = boardLeft + ac * cellSize;
        const sy = boardTop  + ar * cellSize;
        ctx.strokeStyle = correct ? '#2ecc71' : '#e74c3c';
        ctx.lineWidth = Math.max(2.5, cellSize * 0.12);
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(sx, sy, stoneR * 1.15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  /** 绘制单颗棋子（黑/白渐变+高光）*/
  function _drawStone(ctx, x, y, r, isBlack) {
    const grad = ctx.createRadialGradient(
      x - r * 0.3, y - r * 0.3, r * 0.05,
      x, y, r
    );
    if (isBlack) {
      grad.addColorStop(0, '#6a6a6a');
      grad.addColorStop(0.4, '#2a2a2a');
      grad.addColorStop(1, '#000000');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#e8e8e8');
      grad.addColorStop(1, '#b0b0b0');
    }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = r * 0.6;
    ctx.shadowOffsetX = r * 0.15;
    ctx.shadowOffsetY = r * 0.2;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 高光
    ctx.save();
    ctx.globalAlpha = isBlack ? 0.55 : 0.75;
    const hlGrad = ctx.createRadialGradient(
      x - r * 0.28, y - r * 0.28, 0,
      x - r * 0.28, y - r * 0.28, r * 0.55
    );
    hlGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
    hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hlGrad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ===== 水平测试评估类 =====
  class Assessment {
    constructor() {
      // 随机抽取：死活题10道 + 手筋题10道
      this.problems = [
        ...this._shuffle(TSUMEGO_PROBLEMS).slice(0, 10),
        ...this._shuffle(TESUJI_PROBLEMS).slice(0, 10),
      ];
      this.currentIndex = 0;
      this.answers = [];   // { correct, problem }
    }

    _shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    getCurrentProblem() {
      return this.problems[this.currentIndex];
    }

    getTotalProblems() {
      return this.problems.length;
    }

    isComplete() {
      return this.currentIndex >= this.problems.length;
    }

    /**
     * 提交答案
     * @param {number[]|null} clickedPos  - 点击的棋盘坐标 [r,c]，null 表示虚手
     * @returns {{ correct, explanation, correctAnswer }}
     */
    submitAnswer(clickedPos) {
      const problem = this.getCurrentProblem();
      const [cr, cc] = problem.correctAnswer;

      let correct;
      if (clickedPos === null) {
        // 玩家选择虚手
        correct = problem.isPassCorrect === true;
      } else {
        const [pr, pc] = clickedPos;
        correct = (pr === cr && pc === cc);
      }

      this.answers.push({ correct, problem });
      return {
        correct,
        explanation: problem.explanation,
        correctAnswer: problem.correctAnswer,
      };
    }

    nextProblem() {
      this.currentIndex++;
      return !this.isComplete();
    }

    getResults() {
      const total = this.answers.length;
      const correct = this.answers.filter(a => a.correct).length;
      const tsumegoCorrect = this.answers.filter(a => a.correct && a.problem.type === 'tsumego').length;
      const tesujiCorrect  = this.answers.filter(a => a.correct && a.problem.type === 'tesuji').length;

      // 根据正确率推算水平
      const rate = correct / total;
      let level, levelDesc, recommendedDifficulty;

      if (rate >= 0.9) {
        level = '业余1段'; levelDesc = '基础扎实，手筋敏锐，可以挑战进阶对手！';
        recommendedDifficulty = 'master';
      } else if (rate >= 0.75) {
        level = '业余3级'; levelDesc = '死活和手筋都有不错的基础，继续加油！';
        recommendedDifficulty = 'expert';
      } else if (rate >= 0.6) {
        level = '业余5级'; levelDesc = '对基本棋形有一定了解，需要多练习死活题。';
        recommendedDifficulty = 'advanced';
      } else if (rate >= 0.4) {
        level = '业余7级'; levelDesc = '掌握了基本规则，建议多学习基础死活和手筋。';
        recommendedDifficulty = 'intermediate';
      } else if (rate >= 0.2) {
        level = '业余10级'; levelDesc = '围棋入门阶段，建议先熟悉基本规则和棋形。';
        recommendedDifficulty = 'elementary';
      } else {
        level = '围棋新手'; levelDesc = '刚开始接触围棋，建议从入门教程开始学习。';
        recommendedDifficulty = 'beginner';
      }

      return {
        correctCount: correct,
        totalProblems: total,
        tsumegoCorrect,
        tesujiCorrect,
        level,
        levelDesc,
        recommendedDifficulty,
      };
    }
  }

  return {
    TSUMEGO_PROBLEMS,
    TESUJI_PROBLEMS,
    drawProblemBoard,
    Assessment,
  };
})();