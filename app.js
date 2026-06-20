/**
 * Tegaki Studio - Application Logic
 * Premium multilingual handwriting character recognition client with Kanji Quiz integration.
 */

// --- Handwriting Canvas Class Definition ---
class HandwritingCanvas {
    constructor(config) {
        this.container = document.getElementById(config.containerId);
        this.canvas = document.getElementById(config.canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.statusElement = document.getElementById(config.statusId);
        this.candidatesBox = document.getElementById(config.candidatesBoxId);
        
        this.undoBtn = document.getElementById(config.undoBtnId);
        this.redoBtn = document.getElementById(config.redoBtnId);
        this.clearBtn = document.getElementById(config.clearBtnId);
        this.penSizeBtn = document.getElementById(config.penSizeBtnId);
        this.sizeDropdown = document.getElementById(config.sizeDropdownId);
        this.sizeOptions = this.sizeDropdown.querySelectorAll('.size-option');
        
        this.onTextInserted = config.onTextInserted || null;
        this.onStrokeChanged = config.onStrokeChanged || null;
        this.onFocused = config.onFocused || (() => {});
        this.activeTheme = config.activeTheme || 'dark';
        
        // State Variables
        this.ink = []; // Current strokes: [[x_array, y_array, t_array], ...]
        this.currentStroke = [[], [], []]; // Current drawing stroke
        this.undoStack = []; // History of inks for Undo
        this.redoStack = []; // History of inks for Redo
        this.candidates = []; // Stores latest handwriting recognition candidates for quiz checks
        
        this.isDrawing = false;
        this.startTime = 0;
        this.recognitionTimeout = null;
        this.currentPenSize = 4;
        
        this.lastX = 0;
        this.lastY = 0;
        
        this.init();
    }
    
    init() {
        // Setup internal dimensions matching bounds scaled by DPR (for high DPI crisp lines)
        this.initCanvas();
        
        // Event Bindings for drawing
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        window.addEventListener('mouseup', (e) => this.stopDrawing(e));
        
        this.canvas.addEventListener('touchstart', (e) => this.startDrawing(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.draw(e), { passive: false });
        window.addEventListener('touchend', (e) => this.stopDrawing(e));
        window.addEventListener('touchcancel', (e) => this.stopDrawing(e));
        
        // Controls Bindings
        this.undoBtn.addEventListener('click', () => this.undo());
        this.redoBtn.addEventListener('click', () => this.redo());
        this.clearBtn.addEventListener('click', () => this.clearCanvas());
        
        // Pen size dropdown control
        this.penSizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sizeDropdown.classList.toggle('hidden');
        });
        
        document.addEventListener('click', () => {
            this.sizeDropdown.classList.add('hidden');
        });
        
        this.sizeOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                const size = parseInt(option.getAttribute('data-size'), 10);
                this.currentPenSize = size;
                
                // Update active state in UI
                this.sizeOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                
                // Update pen dot indicator
                const dot = this.penSizeBtn.querySelector('.pen-dot');
                dot.className = `pen-dot size-${size === 2 ? 'thin' : size === 4 ? 'medium' : 'thick'}`;
                this.penSizeBtn.setAttribute('data-size', size);
                
                // Redraw canvas
                this.redrawCanvas();
                
                if (typeof window.showToastNotification === 'function') {
                    window.showToastNotification(`ペンの太さを ${size}px に変更しました。`);
                }
            });
        });
    }
    
    initCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.container.getBoundingClientRect();
        
        // Prevent layout collapses (DPR check on zero height)
        if (rect.width === 0 || rect.height === 0) return;

        // Setup internal dimensions scaled by DPR
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        
        // Reset scale and apply dpr scale
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
        
        // Redraw content
        this.redrawCanvas();
    }
    
    getCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        let clientX, clientY;
        
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }
    
    startDrawing(e) {
        e.preventDefault();
        this.onFocused();
        this.isDrawing = true;
        this.startTime = Date.now();
        this.container.classList.add('active');
        this.setStatus('描画中', 'active');
        
        const coords = this.getCoords(e);
        this.lastX = coords.x;
        this.lastY = coords.y;
        
        // Initialize current stroke
        this.currentStroke = [[], [], []];
        this.addPointToStroke(coords.x, coords.y);
        
        // Clear any pending recognition calls
        if (this.recognitionTimeout) {
            clearTimeout(this.recognitionTimeout);
        }
        
        // Draw tiny dot
        this.drawDot(coords.x, coords.y);
    }
    
    drawDot(x, y) {
        this.ctx.beginPath();
        this.ctx.fillStyle = this.getStrokeColor();
        this.ctx.arc(x, y, this.currentPenSize / 2, 0, Math.PI * 2);
        this.ctx.fill();
    }
    
    draw(e) {
        if (!this.isDrawing) return;
        e.preventDefault();
        
        const coords = this.getCoords(e);
        
        this.ctx.beginPath();
        this.ctx.strokeStyle = this.getStrokeColor();
        this.ctx.lineWidth = this.currentPenSize;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        this.ctx.moveTo(this.lastX, this.lastY);
        this.ctx.lineTo(coords.x, coords.y);
        this.ctx.stroke();
        
        this.lastX = coords.x;
        this.lastY = coords.y;
        
        this.addPointToStroke(coords.x, coords.y);
    }
    
    stopDrawing(e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this.container.classList.remove('active');
        this.setStatus('待機中', 'normal');
        
        if (this.currentStroke[0].length > 0) {
            // Save the finished stroke
            this.ink.push(JSON.parse(JSON.stringify(this.currentStroke)));
            
            // Manage undo stack
            this.undoStack.push(JSON.parse(JSON.stringify(this.ink)));
            this.redoStack = []; // Clear redo
            
            this.updateUndoRedoButtons();
            
            // Notify stroke change
            if (this.onStrokeChanged) {
                this.onStrokeChanged(this.ink.length > 0);
            }
            
            // Queue debounced recognition
            this.queueRecognition();
        }
    }
    
    addPointToStroke(x, y) {
        const timeOffset = Date.now() - this.startTime;
        this.currentStroke[0].push(Math.round(x));
        this.currentStroke[1].push(Math.round(y));
        this.currentStroke[2].push(timeOffset);
    }
    
    getStrokeColor() {
        return this.activeTheme === 'dark' ? '#a5b4fc' : '#4f46e5';
    }
    
    setTheme(theme) {
        this.activeTheme = theme;
        this.redrawCanvas();
    }
    
    setStatus(text, type) {
        this.statusElement.textContent = text;
        this.statusElement.className = 'mode-badge';
        
        if (type === 'active') {
            this.statusElement.style.background = 'rgba(99, 102, 241, 0.15)';
            this.statusElement.style.color = '#818cf8';
        } else if (type === 'working') {
            this.statusElement.style.background = 'rgba(6, 182, 212, 0.15)';
            this.statusElement.style.color = '#06b6d4';
        } else {
            this.statusElement.style.background = '';
            this.statusElement.style.color = '';
        }
    }
    
    redrawCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ink.forEach(stroke => {
            const xs = stroke[0];
            const ys = stroke[1];
            
            if (xs.length === 0) return;
            
            this.ctx.beginPath();
            this.ctx.strokeStyle = this.getStrokeColor();
            this.ctx.lineWidth = this.currentPenSize;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            
            if (xs.length === 1) {
                this.ctx.fillStyle = this.getStrokeColor();
                this.ctx.arc(xs[0], ys[0], this.currentPenSize / 2, 0, Math.PI * 2);
                this.ctx.fill();
            } else {
                this.ctx.moveTo(xs[0], ys[0]);
                for (let i = 1; i < xs.length; i++) {
                    this.ctx.lineTo(xs[i], ys[i]);
                }
                this.ctx.stroke();
            }
        });
    }
    
    undo() {
        if (this.undoStack.length > 0) {
            const popped = this.undoStack.pop();
            this.redoStack.push(popped);
            
            this.ink = this.undoStack.length > 0 ? JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1])) : [];
            
            this.redrawCanvas();
            this.updateUndoRedoButtons();
            
            if (this.onStrokeChanged) {
                this.onStrokeChanged(this.ink.length > 0);
            }
            
            if (this.ink.length > 0) {
                this.queueRecognition();
            } else {
                this.clearCandidates();
            }
        }
    }
    
    redo() {
        if (this.redoStack.length > 0) {
            const popped = this.redoStack.pop();
            this.undoStack.push(popped);
            this.ink = JSON.parse(JSON.stringify(popped));
            
            this.redrawCanvas();
            this.updateUndoRedoButtons();
            
            if (this.onStrokeChanged) {
                this.onStrokeChanged(this.ink.length > 0);
            }
            
            this.queueRecognition();
        }
    }
    
    clearCanvas() {
        this.ink = [];
        this.undoStack = [];
        this.redoStack = [];
        this.candidates = [];
        this.redrawCanvas();
        this.updateUndoRedoButtons();
        this.clearCandidates();
        if (this.recognitionTimeout) {
            clearTimeout(this.recognitionTimeout);
        }
        this.setStatus('待機中', 'normal');
        
        if (this.onStrokeChanged) {
            this.onStrokeChanged(false);
        }
    }
    
    updateUndoRedoButtons() {
        this.undoBtn.disabled = this.undoStack.length === 0;
        this.redoBtn.disabled = this.redoStack.length === 0;
    }
    
    queueRecognition() {
        if (this.recognitionTimeout) {
            clearTimeout(this.recognitionTimeout);
        }
        this.recognitionTimeout = setTimeout(() => this.performRecognition(), 600);
    }
    
    async performRecognition() {
        if (this.ink.length === 0) return;
        
        this.setStatus('認識中...', 'working');
        
        const itcCode = 'ja-t-i0-handwrit';
        const langShort = 'ja';
        const rect = this.canvas.getBoundingClientRect();
        
        const requestBody = {
            app: 'translate',
            device: 'desktop',
            input_type: '0',
            languages: [langShort],
            requests: [
                {
                    writing_guide: {
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    },
                    ink: this.ink,
                    language: langShort
                }
            ]
        };
        
        try {
            const response = await fetch(`https://inputtools.google.com/request?itc=${itcCode}&app=translate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data && data[0] === 'SUCCESS') {
                const candidates = data[1][0][1];
                this.candidates = candidates || []; // Store candidates for quiz check
                this.renderCandidates(candidates);
            } else {
                this.candidates = [];
                this.renderCandidates([]);
            }
        } catch (error) {
            console.error('Recognition Error:', error);
            if (typeof window.showToastNotification === 'function') {
                window.showToastNotification('文字の認識に失敗しました。接続を確認してください。', 'danger');
            }
            this.setStatus('エラー', 'danger');
        } finally {
            if (this.statusElement.textContent === '認識中...') {
                this.setStatus('待機中', 'normal');
            }
        }
    }
    
    renderCandidates(candidates) {
        if (!this.candidatesBox) return;
        
        this.candidatesBox.innerHTML = '';
        
        if (!candidates || candidates.length === 0) {
            this.candidatesBox.innerHTML = '<span class="no-data-text">？</span>';
            return;
        }
        
        // Cap candidates to 8 for compact lists
        const list = candidates.slice(0, 8);
        list.forEach(candidate => {
            const btn = document.createElement('span');
            btn.className = 'candidate-item';
            btn.textContent = candidate;
            
            // Only trigger text insertion if callback is defined (editor view)
            if (this.onTextInserted) {
                btn.addEventListener('click', () => {
                    this.onTextInserted(candidate);
                    this.clearCanvas();
                });
            }
            this.candidatesBox.appendChild(btn);
        });
    }
    
    clearCandidates() {
        if (this.candidatesBox) {
            this.candidatesBox.innerHTML = '<span class="no-data-text">文字を描いてください</span>';
        }
    }
}


// --- Main Application Setup ---
document.addEventListener('DOMContentLoaded', () => {
    let activeTheme = 'dark';
    
    // --- Elements ---
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const helpBtn = document.getElementById('help-btn');
    const helpModal = document.getElementById('help-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const dismissHelpBtn = document.getElementById('dismiss-help-btn');
    
    // Toasts
    const toastContainer = document.getElementById('toast-container');
    
    // View Containers
    const gradeSelectionView = document.getElementById('grade-selection-view');
    const quizView = document.getElementById('quiz-view');
    
    // Globals for Handlers
    window.showToastNotification = (message, type = 'success') => {
        showToast(message, type);
    };

    let activeCanvas = null; // Tracks last-focused canvas for keyboard shortcuts

    // --- Instantiate Handwriting Canvases (Quiz View) ---
    const quizCanvas1 = new HandwritingCanvas({
        containerId: 'canvas-container-quiz-1',
        canvasId: 'drawing-canvas-quiz-1',
        statusId: 'canvas-status-quiz-1',
        candidatesBoxId: 'candidates-box-quiz-1',
        undoBtnId: 'undo-btn-quiz-1',
        redoBtnId: 'redo-btn-quiz-1',
        clearBtnId: 'clear-canvas-btn-quiz-1',
        penSizeBtnId: 'pen-size-btn-quiz-1',
        sizeDropdownId: 'size-dropdown-quiz-1',
        activeTheme: activeTheme,
        onStrokeChanged: (hasStroke) => updateQuizAnswerSlot(0, hasStroke),
        onFocused: () => { activeCanvas = quizCanvas1; }
    });

    const quizCanvas2 = new HandwritingCanvas({
        containerId: 'canvas-container-quiz-2',
        canvasId: 'drawing-canvas-quiz-2',
        statusId: 'canvas-status-quiz-2',
        candidatesBoxId: 'candidates-box-quiz-2',
        undoBtnId: 'undo-btn-quiz-2',
        redoBtnId: 'redo-btn-quiz-2',
        clearBtnId: 'clear-canvas-btn-quiz-2',
        penSizeBtnId: 'pen-size-btn-quiz-2',
        sizeDropdownId: 'size-dropdown-quiz-2',
        activeTheme: activeTheme,
        onStrokeChanged: (hasStroke) => updateQuizAnswerSlot(1, hasStroke),
        onFocused: () => { activeCanvas = quizCanvas2; }
    });

    const quizCanvas3 = new HandwritingCanvas({
        containerId: 'canvas-container-quiz-3',
        canvasId: 'drawing-canvas-quiz-3',
        statusId: 'canvas-status-quiz-3',
        candidatesBoxId: 'candidates-box-quiz-3',
        undoBtnId: 'undo-btn-quiz-3',
        redoBtnId: 'redo-btn-quiz-3',
        clearBtnId: 'clear-canvas-btn-quiz-3',
        penSizeBtnId: 'pen-size-btn-quiz-3',
        sizeDropdownId: 'size-dropdown-quiz-3',
        activeTheme: activeTheme,
        onStrokeChanged: (hasStroke) => updateQuizAnswerSlot(2, hasStroke),
        onFocused: () => { activeCanvas = quizCanvas3; }
    });

    const quizCanvas4 = new HandwritingCanvas({
        containerId: 'canvas-container-quiz-4',
        canvasId: 'drawing-canvas-quiz-4',
        statusId: 'canvas-status-quiz-4',
        candidatesBoxId: 'candidates-box-quiz-4',
        undoBtnId: 'undo-btn-quiz-4',
        redoBtnId: 'redo-btn-quiz-4',
        clearBtnId: 'clear-canvas-btn-quiz-4',
        penSizeBtnId: 'pen-size-btn-quiz-4',
        sizeDropdownId: 'size-dropdown-quiz-4',
        activeTheme: activeTheme,
        onStrokeChanged: (hasStroke) => updateQuizAnswerSlot(3, hasStroke),
        onFocused: () => { activeCanvas = quizCanvas4; }
    });

    activeCanvas = quizCanvas1; // Default active

    // Window Resize event
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            quizCanvas1.initCanvas();
            quizCanvas2.initCanvas();
            quizCanvas3.initCanvas();
            quizCanvas4.initCanvas();
        }, 150);
    });

    // Keyboard shortcuts for Undo/Redo (Applies to activeCanvas)
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (activeCanvas) activeCanvas.undo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            if (activeCanvas) activeCanvas.redo();
        }
    });


    // ==========================================
    // ===       KANJI QUIZ GAME SYSTEM      ===
    // ==========================================

    let quizQuestions = [];
    let currentQuizIndex = 0;
    let quizScore = 0;
    let quizAnswers = ['', '', '', '']; // Store stroke status for up to 4 canvases
    let isQuizActive = false;

    // elements
    const quizRunningPanel = document.getElementById('quiz-running-panel');
    const qnumBadge = document.getElementById('quiz-question-num');
    const qtextCard = document.getElementById('question-text-card');
    const submitAnswerBtn = document.getElementById('submit-answer-btn');
    const quizProgressText = document.getElementById('quiz-progress-text');
    const quizProgressBar = document.getElementById('quiz-progress-bar');
    const quizScoreText = document.getElementById('quiz-score-text');
    const quizFeedbackBox = document.getElementById('quiz-feedback-box');
    const feedbackIcon = document.getElementById('feedback-icon-container');
    const feedbackText = document.getElementById('feedback-text-container');
    
    const stopQuizBtn = document.getElementById('stop-quiz-btn');

    const answerSlots = [
        document.getElementById('answer-slot-1'),
        document.getElementById('answer-slot-2'),
        document.getElementById('answer-slot-3'),
        document.getElementById('answer-slot-4')
    ];

    const canvasBoxes = [
        document.getElementById('quiz-canvas-box-1'),
        document.getElementById('quiz-canvas-box-2'),
        document.getElementById('quiz-canvas-box-3'),
        document.getElementById('quiz-canvas-box-4')
    ];

    // Default categorized questions by Grade (小学1〜6年生)
    const ALL_GRADE_QUESTIONS = {
        1: [
            { text: "教室に [はいる]。", answer: "入る" },
            { text: "校門を [でる]。", answer: "出る" },
            { text: "黒板を [みる]。", answer: "見る" },
            { text: "背筋を [のばして] 立つ。", answer: "伸ばして" },
            { text: "外に [でていく]。", answer: "出て行く" }
        ],
        2: [
            { text: "運動場を [はしる]。", answer: "走る" },
            { text: "友達と [はなしあう]。", answer: "話し合う" },
            { text: "切手を [はる]。", answer: "貼る" },
            { text: "桜の花が [ちる]。", answer: "散る" },
            { text: "算数の問題を [とく]。", answer: "解く" }
        ],
        3: [
            { text: "本を [よみかえす]。", answer: "読み返す" },
            { text: "お小遣いを [つかいきる]。", answer: "使い切る" },
            { text: "宿題を [おえる]。", answer: "終える" },
            { text: "山を [のぼりきる]。", answer: "登り切る" },
            { text: "服を [きかえる]。", answer: "着替える" }
        ],
        4: [
            { text: "歌を [うたいだす]。", answer: "歌い出す" },
            { text: "絵を [かきなおす]。", answer: "書き直す" },
            { text: "鳥が空を [とぶ]。", answer: "飛ぶ" },
            { text: "川を [およぎわたる]。", answer: "泳ぎ渡る" },
            { text: "約束を [まもる]。", answer: "守る" }
        ],
        5: [
            { text: "新しい家を [たてる]。", answer: "建てる" },
            { text: "意見を [のべる]。", answer: "述べる" },
            { text: "事件を [ふせぐ]。", answer: "防ぐ" },
            { text: "危険を [さける]。", answer: "避ける" },
            { text: "テープを [はる]。", answer: "張る" }
        ],
        6: [
            { text: "下を [みおろす]。", answer: "見下ろす" },
            { text: "引き出しから [ひきだす]。", answer: "引き出す" },
            { text: "プールに [とびこむ]。", answer: "飛び込む" },
            { text: "友達と [はなしあう]。", answer: "話し合う" },
            { text: "活動を [うちきる]。", answer: "打ち切る" }
        ]
    };

    // Set up click listeners for grade cards
    const gradeCards = document.querySelectorAll('.grade-card');
    gradeCards.forEach(card => {
        card.addEventListener('click', () => {
            const grade = parseInt(card.getAttribute('data-grade'), 10);
            startQuiz(grade);
        });
    });

    // Update quiz slot display based on whether user has written stroke
    function updateQuizAnswerSlot(slotIdx, hasStroke) {
        if (!isQuizActive) return;
        
        if (hasStroke) {
            quizAnswers[slotIdx] = 'filled';
            answerSlots[slotIdx].textContent = '✍️';
            answerSlots[slotIdx].classList.add('filled');
        } else {
            quizAnswers[slotIdx] = '';
            answerSlots[slotIdx].textContent = '';
            answerSlots[slotIdx].classList.remove('filled');
        }

        // Enable submit button only if all active slots have strokes
        const q = quizQuestions[currentQuizIndex];
        const answerLength = q.answer.length;
        
        let allFilled = true;
        for (let i = 0; i < answerLength; i++) {
            if (quizAnswers[i] !== 'filled') {
                allFilled = false;
                break;
            }
        }
        submitAnswerBtn.disabled = !allFilled;
    }

    function startQuiz(grade) {
        isQuizActive = true;
        currentQuizIndex = 0;
        quizScore = 0;

        quizQuestions = ALL_GRADE_QUESTIONS[grade] || [];
        if (quizQuestions.length === 0) {
            showToast('テストを開始できませんでした。', 'danger');
            return;
        }

        // Shuffle questions
        quizQuestions = [...quizQuestions].sort(() => Math.random() - 0.5);

        gradeSelectionView.classList.add('hidden');
        quizView.classList.remove('hidden');

        // Load first question
        loadQuizQuestion(currentQuizIndex);
        showToast(`${grade}年生の漢字テストを開始しました。送り仮名も含めて解答してください！`);
    }

    function loadQuizQuestion(index) {
        if (index >= quizQuestions.length) {
            finishQuiz();
            return;
        }

        currentQuizIndex = index;
        const q = quizQuestions[index];
        const answerLength = q.answer.length; // e.g. 2, 3, or 4

        // Set question text
        qnumBadge.textContent = `第 ${index + 1} 問`;
        let formattedText = escapeHTML(q.text);
        formattedText = formattedText.replace(/\[([^\]]+)\]/g, '<span class="furigana-target">$1</span>');
        qtextCard.innerHTML = formattedText;

        // Reset inputs
        quizAnswers = ['', '', '', ''];
        answerSlots.forEach(slot => {
            slot.textContent = '';
            slot.classList.remove('filled');
        });
        submitAnswerBtn.disabled = true;

        // Clear all canvases
        quizCanvas1.clearCanvas();
        quizCanvas2.clearCanvas();
        quizCanvas3.clearCanvas();
        quizCanvas4.clearCanvas();

        // Show only the needed canvas boxes and answer slots
        const canvases = [quizCanvas1, quizCanvas2, quizCanvas3, quizCanvas4];
        for (let i = 0; i < 4; i++) {
            if (i < answerLength) {
                canvasBoxes[i].classList.remove('hidden');
                answerSlots[i].classList.remove('hidden');
                // Initialize canvas dimensions if displayed
                setTimeout(() => {
                    canvases[i].initCanvas();
                }, 50);
            } else {
                canvasBoxes[i].classList.add('hidden');
                answerSlots[i].classList.add('hidden');
            }
        }

        activeCanvas = quizCanvas1;

        // Update progress bar
        quizProgressText.textContent = `${index + 1} / ${quizQuestions.length}`;
        const pct = ((index) / quizQuestions.length) * 100;
        quizProgressBar.style.width = `${pct}%`;
        
        const accuracy = index === 0 ? 0 : Math.round((quizScore / index) * 100);
        quizScoreText.textContent = `${accuracy}% (${quizScore}/${index})`;

        // Restore feedback box default
        quizFeedbackBox.className = 'feedback-card';
        feedbackIcon.textContent = '';
        feedbackText.textContent = '決定ボタンを押して解答してください';
    }

    function checkQuizAnswer() {
        if (!isQuizActive) return;

        const q = quizQuestions[currentQuizIndex];
        const answerLength = q.answer.length;
        
        // Evaluate each character
        let isCorrect = true;
        const canvases = [quizCanvas1, quizCanvas2, quizCanvas3, quizCanvas4];
        
        for (let i = 0; i < answerLength; i++) {
            const correct = canvases[i].candidates && canvases[i].candidates.includes(q.answer[i]);
            if (!correct) {
                isCorrect = false;
            }
            // Instantly fill in the slots with target characters for review
            answerSlots[i].textContent = q.answer[i];
        }

        submitAnswerBtn.disabled = true;

        if (isCorrect) {
            quizScore++;
            quizFeedbackBox.className = 'feedback-card correct';
            feedbackIcon.textContent = '◯ 🎉';
            feedbackText.textContent = '正解です！素晴らしい！';
            triggerConfetti(quizFeedbackBox);
            
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const u = new SpeechSynthesisUtterance('正解です！');
                u.lang = 'ja-JP';
                window.speechSynthesis.speak(u);
            }
        } else {
            quizFeedbackBox.className = 'feedback-card incorrect';
            feedbackIcon.textContent = '✕ 😢';
            feedbackText.textContent = `残念！正解は【${q.answer}】です。`;
            
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const u = new SpeechSynthesisUtterance(`残念。正解は、${q.answer}、です。`);
                u.lang = 'ja-JP';
                window.speechSynthesis.speak(u);
            }
        }

        // Set short timeout before proceeding to next question
        setTimeout(() => {
            loadQuizQuestion(currentQuizIndex + 1);
        }, 2200);
    }

    function finishQuiz() {
        isQuizActive = false;
        
        quizProgressBar.style.width = '100%';
        quizProgressText.textContent = `${quizQuestions.length} / ${quizQuestions.length}`;
        
        const accuracy = Math.round((quizScore / quizQuestions.length) * 100);
        quizScoreText.textContent = `${accuracy}% (${quizScore}/${quizQuestions.length})`;

        // Render result inside question area
        qnumBadge.textContent = '結果発表';
        
        let message = '';
        if (accuracy === 100) {
            message = '満点！全問正解です！完璧ですね！🏆';
        } else if (accuracy >= 80) {
            message = '素晴らしい！合格ライン突破です！🌟';
        } else if (accuracy >= 50) {
            message = '半分以上正解です。この調子で復習しましょう！👍';
        } else {
            message = 'もう一度練習して、満点を目指しましょう！💪';
        }

        qtextCard.innerHTML = `
            <div style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 8px;">テスト終了！お疲れ様でした。</div>
            <div style="font-size: 2.2rem; font-weight: 800; background: var(--grad-primary); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 16px 0;">
                得点: ${quizScore} / ${quizQuestions.length} (${accuracy}点)
            </div>
            <div style="font-size: 1.25rem; font-weight: 600; color: var(--text-primary);">${message}</div>
        `;

        // Clear slots and show "-"
        answerSlots.forEach(slot => {
            slot.textContent = '-';
            slot.classList.remove('filled');
        });

        // Convert Submit button to Finish button
        submitAnswerBtn.disabled = false;
        submitAnswerBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
            <span>トップに戻る</span>
        `;

        // Remove listener and attach exit function for the button
        const exitHandler = () => {
            stopQuiz();
            submitAnswerBtn.removeEventListener('click', exitHandler);
            // Restore default submit behavior
            submitAnswerBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span>解答を決定する</span>
            `;
            submitAnswerBtn.addEventListener('click', checkQuizAnswer);
        };

        submitAnswerBtn.removeEventListener('click', checkQuizAnswer);
        submitAnswerBtn.addEventListener('click', exitHandler);
    }

    function stopQuiz() {
        isQuizActive = false;
        quizView.classList.add('hidden');
        gradeSelectionView.classList.remove('hidden');

        qnumBadge.textContent = '第 1 問';
        qtextCard.textContent = '問題が読み込まれていません。';
        
        answerSlots.forEach(slot => {
            slot.textContent = '';
            slot.classList.remove('filled');
            slot.classList.remove('hidden');
        });
        
        canvasBoxes.forEach(box => {
            box.classList.remove('hidden');
        });
        
        submitAnswerBtn.disabled = true;
    }

    // Helper for HTML escaping
    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // CSS Confetti implementation for correct feedback
    function triggerConfetti(container) {
        const oldConfetti = container.querySelectorAll('.confetti-piece');
        oldConfetti.forEach(c => c.remove());

        for (let i = 0; i < 20; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = `${Math.random() * 100}%`;
            piece.style.backgroundColor = ['#ffd300', '#ff5252', '#3498db', '#2ecc71', '#9b59b6'][Math.floor(Math.random() * 5)];
            piece.style.animationDelay = `${Math.random() * 0.5}s`;
            piece.style.transform = `rotate(${Math.random() * 360}deg)`;
            container.appendChild(piece);
        }
    }

    // Event connections
    stopQuizBtn.addEventListener('click', stopQuiz);
    submitAnswerBtn.addEventListener('click', checkQuizAnswer);


    // ==========================================
    // ===       HELP MODAL LOGIC            ===
    // ==========================================
    
    function toggleHelpModal() {
        helpModal.classList.toggle('hidden');
    }

    helpBtn.addEventListener('click', toggleHelpModal);
    closeModalBtn.addEventListener('click', toggleHelpModal);
    dismissHelpBtn.addEventListener('click', toggleHelpModal);

    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) {
            toggleHelpModal();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !helpModal.classList.contains('hidden')) {
            toggleHelpModal();
        }
    });

    // --- Dark / Light Theme Controller ---
    function toggleTheme() {
        const isDark = document.body.classList.contains('dark-theme');
        if (isDark) {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            activeTheme = 'light';
            localStorage.setItem('tegaki_studio_theme', 'light');
            showToast('ライトモードに切り替えました。');
        } else {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            activeTheme = 'dark';
            localStorage.setItem('tegaki_studio_theme', 'dark');
            showToast('ダークモードに切り替えました。');
        }
        
        // Notify all 4 quiz canvas instances of the theme change
        quizCanvas1.setTheme(activeTheme);
        quizCanvas2.setTheme(activeTheme);
        quizCanvas3.setTheme(activeTheme);
        quizCanvas4.setTheme(activeTheme);
    }

    themeToggleBtn.addEventListener('click', toggleTheme);

    // Load initial theme choice
    const savedTheme = localStorage.getItem('tegaki_studio_theme');
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        activeTheme = 'light';
        quizCanvas1.setTheme(activeTheme);
        quizCanvas2.setTheme(activeTheme);
        quizCanvas3.setTheme(activeTheme);
        quizCanvas4.setTheme(activeTheme);
    }
});
