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
    
    // Text Editor & Actions (Editor View)
    const editor = document.getElementById('composition-text');
    const charCounter = document.getElementById('char-counter');
    const spaceBtn = document.getElementById('space-btn');
    const backspaceBtn = document.getElementById('backspace-btn');
    const speakBtn = document.getElementById('speak-btn');
    const copyBtn = document.getElementById('copy-btn');
    const clearTextBtn = document.getElementById('clear-text-btn');
    const saveHistoryBtn = document.getElementById('save-history-btn');
    const historyItemsContainer = document.getElementById('history-items');
    
    // Toasts
    const toastContainer = document.getElementById('toast-container');
    
    // App Tab Buttons & View Containers
    const tabEditor = document.getElementById('tab-editor');
    const tabQuiz = document.getElementById('tab-quiz');
    const editorView = document.getElementById('editor-view');
    const quizView = document.getElementById('quiz-view');
    
    // Globals for Handlers
    window.showToastNotification = (message, type = 'success') => {
        showToast(message, type);
    };

    // --- Instantiate Multi Drawing Canvases (Editor Tab) ---
    let activeCanvas = null; // Tracks last-focused canvas for keyboard shortcuts

    const canvas1 = new HandwritingCanvas({
        containerId: 'canvas-container-1',
        canvasId: 'drawing-canvas-1',
        statusId: 'canvas-status-1',
        candidatesBoxId: 'candidates-box-1',
        undoBtnId: 'undo-btn-1',
        redoBtnId: 'redo-btn-1',
        clearBtnId: 'clear-canvas-btn-1',
        penSizeBtnId: 'pen-size-btn-1',
        sizeDropdownId: 'size-dropdown-1',
        activeTheme: activeTheme,
        onTextInserted: (char) => insertText(char),
        onFocused: () => { activeCanvas = canvas1; }
    });

    const canvas2 = new HandwritingCanvas({
        containerId: 'canvas-container-2',
        canvasId: 'drawing-canvas-2',
        statusId: 'canvas-status-2',
        candidatesBoxId: 'candidates-box-2',
        undoBtnId: 'undo-btn-2',
        redoBtnId: 'redo-btn-2',
        clearBtnId: 'clear-canvas-btn-2',
        penSizeBtnId: 'pen-size-btn-2',
        sizeDropdownId: 'size-dropdown-2',
        activeTheme: activeTheme,
        onTextInserted: (char) => insertText(char),
        onFocused: () => { activeCanvas = canvas2; }
    });

    activeCanvas = canvas1; // Default active

    // --- Instantiate Handwriting Canvases (Quiz Tab) ---
    // Background evaluation: On stroke change, update the visual slot indicators
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

    // Window Resize event
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            canvas1.initCanvas();
            canvas2.initCanvas();
            quizCanvas1.initCanvas();
            quizCanvas2.initCanvas();
            quizCanvas3.initCanvas();
        }, 150);
    });

    // Tab Switching controller
    function switchTab(targetTab) {
        if (targetTab === 'editor-view') {
            tabQuiz.classList.remove('active');
            tabEditor.classList.add('active');
            quizView.classList.add('hidden');
            editorView.classList.remove('hidden');
            
            setTimeout(() => {
                canvas1.initCanvas();
                canvas2.initCanvas();
            }, 100);
            activeCanvas = canvas1;
        } else if (targetTab === 'quiz-view') {
            tabEditor.classList.remove('active');
            tabQuiz.classList.add('active');
            editorView.classList.add('hidden');
            quizView.classList.remove('hidden');
            
            setTimeout(() => {
                quizCanvas1.initCanvas();
                quizCanvas2.initCanvas();
                quizCanvas3.initCanvas();
            }, 100);
            activeCanvas = quizCanvas1;
        }
    }

    tabEditor.addEventListener('click', () => switchTab('editor-view'));
    tabQuiz.addEventListener('click', () => switchTab('quiz-view'));

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

    const QUIZ_STORAGE_KEY = 'tegaki_studio_quiz_questions';
    let quizQuestions = [];
    let currentQuizIndex = 0;
    let quizScore = 0;
    let quizAnswers = ['', '', '']; // Store 'filled' or '' representing stroke status
    let isQuizActive = false;

    // elements
    const quizManagePanel = document.getElementById('quiz-manage-panel');
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
    
    const startQuizBtn = document.getElementById('start-quiz-btn');
    const stopQuizBtn = document.getElementById('stop-quiz-btn');
    const addQuestionBtn = document.getElementById('add-question-btn');
    const newQuestionText = document.getElementById('new-question-text');
    const newQuestionAnswer = document.getElementById('new-question-answer');
    const totalQuestionsNum = document.getElementById('total-questions-num');
    const quizQuestionsList = document.getElementById('quiz-questions-list');

    const answerSlots = [
        document.getElementById('answer-slot-1'),
        document.getElementById('answer-slot-2'),
        document.getElementById('answer-slot-3')
    ];

    // Default questions
    const DEFAULT_QUESTIONS = [
        { text: '放課後に [としょしつ] で勉強する。', answer: '図書室' },
        { text: '爽やかな [しんかんせん] に乗る。', answer: '新幹線' },
        { text: '新しい [じどうしゃ] を運転する。', answer: '自動車' },
        { text: '日本の [かんじけん] 定を受ける。', answer: '漢字検' }
    ];

    function initQuizData() {
        const stored = localStorage.getItem(QUIZ_STORAGE_KEY);
        if (stored) {
            quizQuestions = JSON.parse(stored);
        } else {
            quizQuestions = [...DEFAULT_QUESTIONS];
            localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(quizQuestions));
        }
        updateQuizSettingsUI();
    }

    function updateQuizSettingsUI() {
        totalQuestionsNum.textContent = quizQuestions.length;
        renderQuestionsList();
    }

    function renderQuestionsList() {
        quizQuestionsList.innerHTML = '';
        if (quizQuestions.length === 0) {
            quizQuestionsList.innerHTML = '<span class="no-history-text">登録された問題はありません。</span>';
            return;
        }

        quizQuestions.forEach((q, idx) => {
            const div = document.createElement('div');
            div.className = 'history-item';

            const textSpan = document.createElement('span');
            textSpan.className = 'history-text';
            textSpan.innerHTML = `${idx + 1}. ${escapeHTML(q.text)} <strong>(${escapeHTML(q.answer)})</strong>`;

            const actionDiv = document.createElement('div');
            actionDiv.className = 'quiz-item-action';

            const delBtn = document.createElement('button');
            delBtn.className = 'history-item-btn delete-btn';
            delBtn.title = '問題を削除';
            delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>';
            delBtn.addEventListener('click', () => {
                deleteQuestion(idx);
            });

            actionDiv.appendChild(delBtn);
            div.appendChild(textSpan);
            div.appendChild(actionDiv);
            quizQuestionsList.appendChild(div);
        });
    }

    function addQuestion() {
        const text = newQuestionText.value.trim();
        const answer = newQuestionAnswer.value.trim();

        if (!text || !answer) {
            showToast('問題文と答えの両方を入力してください。', 'danger');
            return;
        }

        // Bracket check inside question text
        if (!text.includes('[') || !text.includes(']')) {
            showToast('問題文にはよみがなを [ ] で囲んで含めてください。 (例: [しんかんせん] に乗る)', 'danger');
            return;
        }

        if (answer.length !== 3) {
            showToast('答えは正確に「3文字」で入力してください。', 'danger');
            return;
        }

        quizQuestions.push({ text, answer });
        localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(quizQuestions));
        updateQuizSettingsUI();

        // Clear forms
        newQuestionText.value = '';
        newQuestionAnswer.value = '';
        showToast('問題を追加しました！', 'success');
    }

    function deleteQuestion(idx) {
        if (confirm('この問題を削除しますか？')) {
            quizQuestions.splice(idx, 1);
            localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(quizQuestions));
            updateQuizSettingsUI();
            showToast('問題を削除しました。');
        }
    }

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

        // Enable submit button only if all 3 slots have strokes
        const allFilled = quizAnswers.every(c => c !== '');
        submitAnswerBtn.disabled = !allFilled;
    }

    function startQuiz() {
        if (quizQuestions.length === 0) {
            showToast('テストを開始するには、問題を設定から追加してください。', 'danger');
            return;
        }

        isQuizActive = true;
        currentQuizIndex = 0;
        quizScore = 0;

        quizManagePanel.classList.add('hidden');
        quizRunningPanel.classList.remove('hidden');

        // Load first question
        loadQuizQuestion(currentQuizIndex);
        showToast('漢字テストを開始しました。頑張りましょう！');
    }

    function loadQuizQuestion(index) {
        if (index >= quizQuestions.length) {
            finishQuiz();
            return;
        }

        currentQuizIndex = index;
        const q = quizQuestions[index];

        // Format furigana tags in problem statement beautifully
        qnumBadge.textContent = `第 ${index + 1} 問`;
        
        let formattedText = escapeHTML(q.text);
        formattedText = formattedText.replace(/\[([^\]]+)\]/g, '<span class="furigana-target">$1</span>');
        qtextCard.innerHTML = formattedText;

        // Reset inputs
        quizAnswers = ['', '', ''];
        answerSlots.forEach(slot => {
            slot.textContent = '';
            slot.classList.remove('filled');
        });
        submitAnswerBtn.disabled = true;

        // Clear quiz canvases
        quizCanvas1.clearCanvas();
        quizCanvas2.clearCanvas();
        quizCanvas3.clearCanvas();

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
        
        // Evaluate background recognition results:
        // Check if the expected Kanji is present anywhere inside the Google suggestions lists.
        const correct1 = quizCanvas1.candidates && quizCanvas1.candidates.includes(q.answer[0]);
        const correct2 = quizCanvas2.candidates && quizCanvas2.candidates.includes(q.answer[1]);
        const correct3 = quizCanvas3.candidates && quizCanvas3.candidates.includes(q.answer[2]);
        const isCorrect = correct1 && correct2 && correct3;

        submitAnswerBtn.disabled = true;

        // Swap out visual "writing" stroke icons with the target actual Kanji answers instantly for review
        answerSlots[0].textContent = q.answer[0];
        answerSlots[1].textContent = q.answer[1];
        answerSlots[2].textContent = q.answer[2];

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

        // Render premium result inside question area
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

        // Clear slots and show "終了"
        answerSlots.forEach(slot => {
            slot.textContent = '-';
            slot.classList.remove('filled');
        });

        // Convert Submit button to Finish button
        submitAnswerBtn.disabled = false;
        submitAnswerBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></svg>
            <span>テストを終了する</span>
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
        quizRunningPanel.classList.add('hidden');
        quizManagePanel.classList.remove('hidden');

        qnumBadge.textContent = '第 1 問';
        qtextCard.textContent = '問題が読み込まれていません。「テストを開始」を押してください。';
        
        answerSlots.forEach(slot => {
            slot.textContent = '';
            slot.classList.remove('filled');
        });
        
        submitAnswerBtn.disabled = true;
        updateQuizSettingsUI();
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
    startQuizBtn.addEventListener('click', startQuiz);
    stopQuizBtn.addEventListener('click', stopQuiz);
    addQuestionBtn.addEventListener('click', addQuestion);
    submitAnswerBtn.addEventListener('click', checkQuizAnswer);

    // Initial load
    initQuizData();


    // ==========================================
    // ===       EDITOR FUNCTIONS (ORIGINAL)  ===
    // ==========================================

    function insertText(text) {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const currentVal = editor.value;
        
        editor.value = currentVal.substring(0, start) + text + currentVal.substring(end);
        
        // Reposition cursor right after inserted text
        const cursorPosition = start + text.length;
        editor.setSelectionRange(cursorPosition, cursorPosition);
        editor.focus();
        
        updateCharCount();
    }

    function updateCharCount() {
        const text = editor.value;
        charCounter.textContent = `${text.length} 文字`;
    }

    editor.addEventListener('input', updateCharCount);

    // Control Buttons
    spaceBtn.addEventListener('click', () => {
        insertText(' ');
    });

    backspaceBtn.addEventListener('click', () => {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const currentVal = editor.value;
        
        if (start === end) {
            if (start > 0) {
                // Delete one char before the cursor
                editor.value = currentVal.substring(0, start - 1) + currentVal.substring(start);
                editor.setSelectionRange(start - 1, start - 1);
            }
        } else {
            // Delete highlighted range
            editor.value = currentVal.substring(0, start) + currentVal.substring(end);
            editor.setSelectionRange(start, start);
        }
        
        editor.focus();
        updateCharCount();
    });

    clearTextBtn.addEventListener('click', () => {
        if (editor.value.length === 0) return;
        
        if (confirm('テキストエディタの文章をすべて消去しますか？')) {
            editor.value = '';
            updateCharCount();
            editor.focus();
            showToast('テキストを消去しました。');
        }
    });

    // --- Web Speech API (Text to Speech) ---
    speakBtn.addEventListener('click', () => {
        const text = editor.value;
        if (!text) {
            showToast('読み上げるテキストを入力してください。', 'danger');
            return;
        }
        
        if ('speechSynthesis' in window) {
            // Cancel any current speaking
            window.speechSynthesis.cancel();
            
            const utterance = new SpeechSynthesisUtterance(text);
            
            // Set Japanese speech voice language
            utterance.lang = 'ja-JP';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            
            // Button feedback loading state
            speakBtn.classList.add('secondary');
            
            utterance.onend = () => {
                speakBtn.classList.remove('secondary');
            };
            
            utterance.onerror = (e) => {
                speakBtn.classList.remove('secondary');
                console.error('Speech error:', e);
                showToast('音声の読み上げ中にエラーが発生しました。', 'danger');
            };
            
            window.speechSynthesis.speak(utterance);
        } else {
            showToast('お使いのブラウザは音声合成に対応していません。', 'danger');
        }
    });

    // --- Copy to Clipboard ---
    copyBtn.addEventListener('click', async () => {
        const text = editor.value;
        if (!text) {
            showToast('コピーするテキストがありません。', 'danger');
            return;
        }
        
        try {
            await navigator.clipboard.writeText(text);
            showToast('クリップボードにコピーしました！', 'success');
        } catch (err) {
            console.error('Failed to copy:', err);
            // Fallback for older browsers
            editor.select();
            document.execCommand('copy');
            showToast('クリップボードにコピーしました！ (Fallback)', 'success');
        }
    });

    // --- Toast Notification System ---
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        // Icon based on type
        let icon = '';
        if (type === 'success') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
        } else if (type === 'danger') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';
        }
        
        toast.innerHTML = `${icon}<span>${message}</span>`;
        toastContainer.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('fade-out');
            toast.addEventListener('transitionend', () => {
                toast.remove();
            });
        }, 3000);
    }

    // --- History System (LocalStorage) ---
    const HISTORY_KEY = 'tegaki_studio_history';
    
    function loadHistory() {
        const historyData = localStorage.getItem(HISTORY_KEY);
        const history = historyData ? JSON.parse(historyData) : [];
        renderHistoryList(history);
    }

    function saveToHistory() {
        const text = editor.value.trim();
        if (!text) {
            showToast('保存するテキストが空です。', 'danger');
            return;
        }
        
        const historyData = localStorage.getItem(HISTORY_KEY);
        const history = historyData ? JSON.parse(historyData) : [];
        
        // Prevent duplicate consecutive items
        if (history.length > 0 && history[0].text === text) {
            showToast('すでに同じ文章が直近に保存されています。');
            return;
        }
        
        // Prepend new entry
        history.unshift({
            id: Date.now(),
            text: text,
            date: new Date().toLocaleDateString('ja-JP', { hour: '2-digit', minute: '2-digit' })
        });
        
        // Limit to 5 entries
        if (history.length > 5) {
            history.pop();
        }
        
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        renderHistoryList(history);
        showToast('履歴に保存しました！', 'success');
    }

    function deleteHistoryItem(id) {
        const historyData = localStorage.getItem(HISTORY_KEY);
        if (!historyData) return;
        
        let history = JSON.parse(historyData);
        history = history.filter(item => item.id !== id);
        
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        renderHistoryList(history);
        showToast('履歴を削除しました。');
    }

    function renderHistoryList(history) {
        historyItemsContainer.innerHTML = '';
        
        if (history.length === 0) {
            historyItemsContainer.innerHTML = '<span class="no-history-text">保存された履歴はありません</span>';
            return;
        }
        
        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            
            const textSpan = document.createElement('span');
            textSpan.className = 'history-text';
            textSpan.textContent = item.text;
            textSpan.title = 'エディタに復元する';
            textSpan.addEventListener('click', () => {
                editor.value = item.text;
                updateCharCount();
                editor.focus();
                showToast('テキストを復元しました。');
            });
            
            const actionDiv = document.createElement('div');
            actionDiv.className = 'history-item-actions';
            
            // Speak history item
            const speakHistoryBtn = document.createElement('button');
            speakHistoryBtn.className = 'history-item-btn';
            speakHistoryBtn.title = 'このテキストを読み上げる';
            speakHistoryBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>';
            speakHistoryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(item.text);
                    window.speechSynthesis.speak(utterance);
                }
            });

            // Delete item
            const delBtn = document.createElement('button');
            delBtn.className = 'history-item-btn delete-btn';
            delBtn.title = '履歴から削除';
            delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHistoryItem(item.id);
            });
            
            actionDiv.appendChild(speakHistoryBtn);
            actionDiv.appendChild(delBtn);
            
            div.appendChild(textSpan);
            div.appendChild(actionDiv);
            
            historyItemsContainer.appendChild(div);
        });
    }

    saveHistoryBtn.addEventListener('click', saveToHistory);
    loadHistory(); // Load initially

    // --- Help Modal Logic ---
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
        
        // Notify all 5 canvas instances of the theme change
        canvas1.setTheme(activeTheme);
        canvas2.setTheme(activeTheme);
        quizCanvas1.setTheme(activeTheme);
        quizCanvas2.setTheme(activeTheme);
        quizCanvas3.setTheme(activeTheme);
    }

    themeToggleBtn.addEventListener('click', toggleTheme);

    // Load initial theme choice
    const savedTheme = localStorage.getItem('tegaki_studio_theme');
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        activeTheme = 'light';
        canvas1.setTheme(activeTheme);
        canvas2.setTheme(activeTheme);
        quizCanvas1.setTheme(activeTheme);
        quizCanvas2.setTheme(activeTheme);
        quizCanvas3.setTheme(activeTheme);
    }
});
