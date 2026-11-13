// Chess.com Position Analyzer - Content Script
// Full-featured chess analysis with Stockfish engine, multi-PV, and attack detection

(function () {
    'use strict';

    // ============= PIECE DEFINITIONS =============
    const PIECE_MAP = {
        'wp': '♙', 'wn': '♘', 'wb': '♗', 'wr': '♖', 'wq': '♕', 'wk': '♔',
        'bp': '♟', 'bn': '♞', 'bb': '♝', 'br': '♜', 'bq': '♛', 'bk': '♚',
    };

    const PIECE_NAMES = {
        'wp': 'Pawn', 'wn': 'Knight', 'wb': 'Bishop', 'wr': 'Rook', 'wq': 'Queen', 'wk': 'King',
        'bp': 'Pawn', 'bn': 'Knight', 'bb': 'Bishop', 'br': 'Rook', 'bq': 'Queen', 'bk': 'King',
    };

    const PIECE_TO_FEN = {
        'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K',
        'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k',
    };

    const FEN_TO_PIECE = {
        'P': 'wp', 'N': 'wn', 'B': 'wb', 'R': 'wr', 'Q': 'wq', 'K': 'wk',
        'p': 'bp', 'n': 'bn', 'b': 'bb', 'r': 'br', 'q': 'bq', 'k': 'bk',
    };

    const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

    // Analysis state
    let stockfishWorker = null;
    let isEngineReady = false;
    let isAnalyzing = false;
    let lastFEN = '';
    let multiPV = 3; // Show top 3 moves
    let analysisDepth = 12;
    let currentLines = [];
    let autoAnalyzeEnabled = false;
    let autoMoveEnabled = false;
    let autoAnalyzeInterval = null;
    let currentAnalysisFEN = '';
    let lastGameId = null;

    // ============= SQUARE UTILITIES =============
    function squareToNotation(squareNum) {
        const file = Math.floor(squareNum / 10) - 1;
        const rank = (squareNum % 10) - 1;
        return FILES[file] + RANKS[rank];
    }

    function notationToIndex(sq) {
        const file = sq.charCodeAt(0) - 97; // a=0
        const rank = parseInt(sq[1]) - 1;   // 1=0
        return { file, rank };
    }

    function indexToNotation(file, rank) {
        if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
        return FILES[file] + RANKS[rank];
    }

    function isBoardFlipped() {
        const board = document.querySelector('.board');
        return board && board.classList.contains('flipped');
    }

    // ============= GET BOARD POSITION =============
    function getBoardPosition() {
        const positions = {};
        const pieces = document.querySelectorAll('.piece');

        pieces.forEach(piece => {
            const classes = piece.className.split(' ');
            let pieceType = null;
            let square = null;

            classes.forEach(cls => {
                if (PIECE_MAP[cls]) pieceType = cls;
                if (cls.startsWith('square-')) square = parseInt(cls.replace('square-', ''));
            });

            if (pieceType && square) {
                const notation = squareToNotation(square);
                positions[notation] = {
                    type: pieceType,
                    symbol: PIECE_MAP[pieceType],
                    name: PIECE_NAMES[pieceType],
                    color: pieceType[0] // 'w' or 'b'
                };
            }
        });

        return positions;
    }

    // ============= ATTACK DETECTION =============
    // Get all squares a piece can attack
    function getAttackedSquares(positions, square, piece) {
        const { file, rank } = notationToIndex(square);
        const color = piece.color;
        const pieceType = piece.type[1]; // p, n, b, r, q, k
        const attacks = [];

        const addIfValid = (f, r) => {
            const sq = indexToNotation(f, r);
            if (sq) attacks.push(sq);
        };

        const addSlidingAttacks = (directions) => {
            for (const [df, dr] of directions) {
                for (let i = 1; i < 8; i++) {
                    const nf = file + df * i;
                    const nr = rank + dr * i;
                    const sq = indexToNotation(nf, nr);
                    if (!sq) break;
                    attacks.push(sq);
                    if (positions[sq]) break; // Blocked by piece
                }
            }
        };

        switch (pieceType) {
            case 'p': // Pawn attacks diagonally
                const dir = color === 'w' ? 1 : -1;
                addIfValid(file - 1, rank + dir);
                addIfValid(file + 1, rank + dir);
                break;

            case 'n': // Knight
                const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
                for (const [df, dr] of knightMoves) {
                    addIfValid(file + df, rank + dr);
                }
                break;

            case 'b': // Bishop
                addSlidingAttacks([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
                break;

            case 'r': // Rook
                addSlidingAttacks([[-1, 0], [1, 0], [0, -1], [0, 1]]);
                break;

            case 'q': // Queen
                addSlidingAttacks([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
                break;

            case 'k': // King
                const kingMoves = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
                for (const [df, dr] of kingMoves) {
                    addIfValid(file + df, rank + dr);
                }
                break;
        }

        return attacks;
    }

    // Analyze attacks and defenses for all pieces
    function analyzeAttacksDefenses(positions) {
        const analysis = {};

        // For each square, calculate who attacks it
        const attackedBy = {}; // square -> { w: [], b: [] }

        for (const [square, piece] of Object.entries(positions)) {
            const attacks = getAttackedSquares(positions, square, piece);
            for (const targetSq of attacks) {
                if (!attackedBy[targetSq]) {
                    attackedBy[targetSq] = { w: [], b: [] };
                }
                attackedBy[targetSq][piece.color].push({ square, piece });
            }
        }

        // Now analyze each piece
        for (const [square, piece] of Object.entries(positions)) {
            const attackers = attackedBy[square] || { w: [], b: [] };
            const enemyColor = piece.color === 'w' ? 'b' : 'w';
            const friendlyColor = piece.color;

            const isUnderAttack = attackers[enemyColor].length > 0;
            const isDefended = attackers[friendlyColor].length > 0;

            analysis[square] = {
                ...piece,
                isUnderAttack,
                isDefended,
                attackers: attackers[enemyColor],
                defenders: attackers[friendlyColor],
                status: isUnderAttack ? (isDefended ? 'defended' : 'hanging') : 'safe'
            };
        }

        return analysis;
    }

    // ============= FEN CONVERSION =============
    function positionToFEN(positions) {
        let fen = '';

        for (let rank = 8; rank >= 1; rank--) {
            let emptyCount = 0;
            for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
                const file = FILES[fileIdx];
                const square = file + rank;
                const piece = positions[square];

                if (piece) {
                    if (emptyCount > 0) {
                        fen += emptyCount;
                        emptyCount = 0;
                    }
                    fen += PIECE_TO_FEN[piece.type];
                } else {
                    emptyCount++;
                }
            }
            if (emptyCount > 0) fen += emptyCount;
            if (rank > 1) fen += '/';
        }

        const turn = detectTurn();
        const castling = detectCastlingRights(positions);
        fen += ` ${turn} ${castling || '-'} - 0 1`;

        return fen;
    }

    function detectCastlingRights(positions) {
        let rights = '';
        if (positions['e1']?.type === 'wk' && positions['h1']?.type === 'wr') rights += 'K';
        if (positions['e1']?.type === 'wk' && positions['a1']?.type === 'wr') rights += 'Q';
        if (positions['e8']?.type === 'bk' && positions['h8']?.type === 'br') rights += 'k';
        if (positions['e8']?.type === 'bk' && positions['a8']?.type === 'br') rights += 'q';
        return rights || '-';
    }

    function detectTurn() {
        const clocks = document.querySelectorAll('.clock-component');
        for (const clock of clocks) {
            if (clock.classList.contains('clock-player-turn')) {
                const isBottom = clock.closest('.clock-bottom') !== null;
                const flipped = isBoardFlipped();
                return flipped ? (isBottom ? 'b' : 'w') : (isBottom ? 'w' : 'b');
            }
        }
        return 'w';
    }

    // ============= STOCKFISH ENGINE =============
    // The stockfish.js file is a self-contained worker that speaks UCI protocol
    async function initStockfish() {
        if (stockfishWorker) return;

        try {
            updateEngineStatus('Loading Engine...');

            // Fetch stockfish.js and create worker from it
            const engineUrl = chrome.runtime.getURL('stockfish.js');
            const response = await fetch(engineUrl);
            const engineCode = await response.text();

            const blob = new Blob([engineCode], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            stockfishWorker = new Worker(blobUrl);

            // The engine sends UCI responses as strings via postMessage
            stockfishWorker.onmessage = (e) => {
                const msg = e.data;
                if (typeof msg !== 'string') return;

                // Debug: log engine output (uncomment to debug)
                // console.log('Engine:', msg);

                if (msg === 'uciok') {
                    stockfishWorker.postMessage('setoption name MultiPV value 3');
                    stockfishWorker.postMessage('isready');
                } else if (msg === 'readyok') {
                    isEngineReady = true;
                    updateEngineStatus('Ready');
                } else if (msg.includes('info') && msg.includes('depth') && msg.includes('pv')) {
                    // Parse info lines that contain principal variation
                    parseEngineInfo(msg);
                } else if (msg.startsWith('bestmove')) {
                    isAnalyzing = false;
                    updateEngineStatus('Done');
                    displayAnalysisLines();
                    if (currentLines.length > 0) {
                        highlightAnalysisMoves(currentLines);
                    }

                    // Auto Move Logic
                    const moveMatch = msg.match(/bestmove\s+(\S+)/);
                    if (moveMatch && autoMoveEnabled) {
                        const bestMove = moveMatch[1];
                        const currentFEN = positionToFEN(getBoardPosition());
                        if (currentFEN === currentAnalysisFEN) {
                            executeMove(bestMove);
                        }
                    }
                }
            };

            stockfishWorker.onerror = (e) => {
                console.error('Stockfish worker error:', e);
                updateEngineStatus('Error');
            };

            // Start UCI handshake
            stockfishWorker.postMessage('uci');

        } catch (error) {
            console.error('Stockfish init error:', error);
            updateEngineStatus('Failed to load');
        }
    }


    function parseEngineInfo(info) {
        // Parse: info depth 15 multipv 1 score cp 45 nodes 234567 pv e2e4 e7e5 ...
        const depthMatch = info.match(/depth (\d+)/);
        const multiPvMatch = info.match(/multipv (\d+)/);
        const scoreMatch = info.match(/score (cp|mate) (-?\d+)/);
        const pvMatch = info.match(/ pv (.+)/);

        // At minimum we need depth and pv
        if (!depthMatch || !pvMatch) return;

        const depth = parseInt(depthMatch[1]);
        const pvIndex = multiPvMatch ? parseInt(multiPvMatch[1]) - 1 : 0;
        const moves = pvMatch[1].trim().split(/\s+/);
        const score = scoreMatch ? {
            type: scoreMatch[1],
            value: parseInt(scoreMatch[2])
        } : { type: 'cp', value: 0 };

        // Store this line
        if (!currentLines[pvIndex] || currentLines[pvIndex].depth < depth) {
            currentLines[pvIndex] = {
                depth,
                score,
                moves,
                move: moves[0]
            };
        }

        // Update display LIVE on ANY variation update
        // We want to see moves immediately, even if they aren't the primary line yet
        if (depth > oldDepth) {
            oldDepth = depth;
            updateDepthDisplay(depth);
        }

        displayAnalysisLines();

        // Highlight all moves as they change
        if (currentLines.length > 0) {
            highlightAnalysisMoves(currentLines);
        }
    }

    let oldDepth = 0;

    function analyzePosition() {
        if (!isEngineReady) {
            // Try to init if not ready
            initStockfish();
            setTimeout(analyzePosition, 1000);
            return;
        }

        if (isAnalyzing) return;

        const positions = getBoardPosition();
        if (Object.keys(positions).length === 0) {
            updateEngineStatus('No board');
            return;
        }

        const fen = positionToFEN(positions);
        lastFEN = fen;
        currentAnalysisFEN = fen;
        isAnalyzing = true;
        currentLines = [];
        oldDepth = 0; // Reset depth tracker
        updateEngineStatus('Thinking...');

        // Send UCI commands
        stockfishWorker.postMessage('stop');
        stockfishWorker.postMessage('setoption name Threads value 4'); // Use 4 threads for speed
        stockfishWorker.postMessage('setoption name Hash value 64');   // Increase Hash
        stockfishWorker.postMessage('setoption name MultiPV value ' + multiPV);
        stockfishWorker.postMessage('position fen ' + fen);
        stockfishWorker.postMessage('go depth ' + analysisDepth);
    }

    // ============= DISPLAY FUNCTIONS =============
    function formatMove(move) {
        if (!move || move.length < 4) return move || '-';
        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        const promotion = move.length > 4 ? '=' + move[4].toUpperCase() : '';
        return `${from}→${to}${promotion}`;
    }

    function formatScore(score, forWhite = true) {
        if (!score) return '?';

        let value = score.value;
        // Adjust for perspective
        const turn = detectTurn();
        if (turn === 'b') value = -value;

        if (score.type === 'mate') {
            return value > 0 ? `#${value}` : `#${value}`;
        } else {
            const pawns = (value / 100).toFixed(1);
            return value >= 0 ? `+${pawns}` : pawns;
        }
    }

    function getEvaluationMessage(score) {
        if (!score) return { text: 'Analyzing...', icon: '', class: 'neutral' };

        const turn = detectTurn();
        const amPlayingWhite = !isBoardFlipped();

        let value = score.value;
        // Adjust for the side to move
        if (turn === 'b') value = -value;

        // Now adjust for user's perspective (positive = good for user)
        if (!amPlayingWhite) value = -value;

        if (score.type === 'mate') {
            if (value > 0) {
                return { text: `Mate in ${Math.abs(score.value)}`, icon: '💀', class: 'winning' };
            } else {
                return { text: `Getting mated in ${Math.abs(score.value)}`, icon: '💀', class: 'losing' };
            }
        }

        const pawns = value / 100;

        if (pawns >= 5) return { text: 'Winning! Huge advantage', icon: '', class: 'winning' };
        if (pawns >= 3) return { text: 'Great position! Clear advantage', icon: '', class: 'winning' };
        if (pawns >= 1.5) return { text: 'Good position, you\'re ahead', icon: '', class: 'good' };
        if (pawns >= 0.5) return { text: 'Slight advantage for you', icon: '', class: 'good' };
        if (pawns > -0.5) return { text: 'Equal position', icon: '', class: 'neutral' };
        if (pawns > -1.5) return { text: 'Opponent has slight edge', icon: '', class: 'bad' };
        if (pawns > -3) return { text: 'Opponent has advantage', icon: '', class: 'bad' };
        if (pawns > -5) return { text: 'Difficult position', icon: '', class: 'losing' };
        return { text: 'Critical! Major disadvantage', icon: '', class: 'losing' };
    }

    function updateEngineStatus(status) {
        const el = document.querySelector('.cpp-engine-status');
        if (el) el.textContent = status;
    }

    function updateDepthDisplay(depth) {
        const el = document.querySelector('.cpp-analysis-depth');
        if (el) el.textContent = `Depth: ${depth}/${analysisDepth}`;
    }

    function displayAnalysisLines() {
        const container = document.querySelector('.cpp-analysis-lines');
        if (!container) return;

        if (currentLines.length === 0) {
            container.innerHTML = '<div class="cpp-no-analysis">Analyzing position...</div>';
            return;
        }

        const bestLine = currentLines[0];
        const evalMsg = getEvaluationMessage(bestLine?.score);

        let html = `
            <div class="cpp-eval-message cpp-eval-${evalMsg.class}">
                <span class="cpp-eval-icon">${evalMsg.icon}</span>
                <span class="cpp-eval-text">${evalMsg.text}</span>
            </div>
        `;

        html += '<div class="cpp-best-move-display">';
        if (bestLine) {
            const scoreStr = formatScore(bestLine.score);
            html += `<span class="cpp-best-label">Best move:</span> <span class="cpp-best-move">${formatMove(bestLine.move)}</span> <span class="cpp-best-eval">(${scoreStr})</span>`;
        }
        html += '</div>';

        container.innerHTML = html;
    }

    function highlightAnalysisMoves(lines) {
        document.querySelectorAll('.cpp-best-move-arrow').forEach(el => el.remove());
        if (!lines || lines.length === 0) return;

        const board = document.querySelector('.board');
        if (!board) return;

        const boardRect = board.getBoundingClientRect();
        const squareSize = boardRect.width / 8;
        const isFlipped = isBoardFlipped();

        function getSquareCoords(sq) {
            const file = sq.charCodeAt(0) - 97;
            const rank = parseInt(sq[1]) - 1;

            let x, y;
            if (isFlipped) {
                x = (7 - file) * squareSize + squareSize / 2;
                y = rank * squareSize + squareSize / 2;
            } else {
                x = file * squareSize + squareSize / 2;
                y = (7 - rank) * squareSize + squareSize / 2;
            }
            return { x, y };
        }

        const arrowContainer = document.createElement('div');
        arrowContainer.className = 'cpp-best-move-arrow';
        arrowContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:90;';
        board.style.position = 'relative';

        const colors = ['#22c55e', '#f97316', '#ef4444']; // Green, Orange, Red
        let svgContent = `<defs>`;

        // Create markers for each color
        colors.forEach((color, i) => {
            svgContent += `
                <marker id="cpp-arrow-${i}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="${color}" />
                </marker>`;
        });
        svgContent += `</defs>`;

        // Draw arrows (reverse order so best is on top)
        for (let i = Math.min(lines.length, 3) - 1; i >= 0; i--) {
            const line = lines[i];
            if (!line || !line.move) continue;

            const from = line.move.substring(0, 2);
            const to = line.move.substring(2, 4);
            const fromCoords = getSquareCoords(from);
            const toCoords = getSquareCoords(to);
            const color = colors[i] || colors[0];
            const scoreStr = formatScore(line.score);

            svgContent += `
                <line x1="${fromCoords.x}" y1="${fromCoords.y}" x2="${toCoords.x}" y2="${toCoords.y}" 
                    stroke="${color}" stroke-width="${6 - i}" stroke-opacity="0.9" 
                    marker-end="url(#cpp-arrow-${i})" stroke-linecap="round"/>
                <circle cx="${fromCoords.x}" cy="${fromCoords.y}" r="${6 - i}" fill="${color}" fill-opacity="0.6"/>
            `;

            // Add score label HTML element (outside SVG for easier styling/layering)
            const label = document.createElement('div');
            label.className = 'cpp-score-label';
            label.textContent = scoreStr;
            label.style.cssText = `
                position: absolute;
                left: ${toCoords.x}px;
                top: ${toCoords.y}px;
                transform: translate(-50%, -150%);
                background: ${color};
                color: white;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: bold;
                pointer-events: none;
                z-index: 100;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            `;
            arrowContainer.appendChild(label);
        }

        const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgEl.setAttribute('width', '100%');
        svgEl.setAttribute('height', '100%');
        svgEl.style.position = 'absolute';
        svgEl.style.top = '0';
        svgEl.style.left = '0';
        svgEl.innerHTML = svgContent;

        arrowContainer.insertBefore(svgEl, arrowContainer.firstChild);
        board.appendChild(arrowContainer);
    }

    // ============= AUTO MOVE =============
    function executeMove(move) {
        if (!move || move.length < 4) return;

        // Debug
        console.log('[AutoMove] Attempting to move:', move);

        // Verify turn with a fallback
        const turn = detectTurn();
        const amPlayingWhite = !isBoardFlipped();

        console.log(`[AutoMove] Turn: ${turn}, AmIWhite: ${amPlayingWhite}`);

        // Only move if it's our turn
        if ((amPlayingWhite && turn !== 'w') || (!amPlayingWhite && turn !== 'b')) {
            console.log('[AutoMove] Not my turn, skipping.');
            return;
        }

        const from = move.substring(0, 2);
        const to = move.substring(2, 4);

        const board = document.querySelector('.board');
        if (!board) {
            console.log('[AutoMove] Board not found.');
            return;
        }

        const rect = board.getBoundingClientRect();
        const squareSize = rect.width / 8;
        const isFlipped = isBoardFlipped();

        const getViewportCoords = (sq) => {
            const file = sq.charCodeAt(0) - 97;
            const rank = parseInt(sq[1]) - 1;
            let x, y;
            if (isFlipped) {
                x = (7 - file) * squareSize + squareSize / 2;
                y = rank * squareSize + squareSize / 2;
            } else {
                x = file * squareSize + squareSize / 2;
                y = (7 - rank) * squareSize + squareSize / 2;
            }
            return {
                x: rect.left + x,
                y: rect.top + y
            };
        };

        const fromPos = getViewportCoords(from);
        const toPos = getViewportCoords(to);

        console.log('[AutoMove] Clicking from', from, 'to', to);

        // Click FROM
        clickAt(fromPos.x, fromPos.y);

        // Click TO (add delay to simulate human speed/ensure UI is ready)
        setTimeout(() => {
            clickAt(toPos.x, toPos.y);

            // Check for promotion (move has 5 characters like "e7e8q")
            if (move.length === 5) {
                const promotionPiece = move[4].toLowerCase(); // q, r, b, n
                handlePromotion(promotionPiece, amPlayingWhite);
            }
        }, 150);
    }

    function handlePromotion(piece, isWhite) {
        const pieceMap = {
            'q': 'queen',
            'r': 'rook',
            'b': 'bishop',
            'n': 'knight'
        };
        const pieceName = pieceMap[piece] || 'queen';
        const pieceClass = isWhite ? `w${piece}` : `b${piece}`;

        console.log('[AutoMove] Handling promotion to:', pieceName);

        // Try multiple times with increasing delays
        const tryPromotion = (attempt) => {
            if (attempt > 5) {
                console.log('[AutoMove] Promotion failed after 5 attempts');
                return;
            }

            // Try various promotion selectors used by Chess.com
            const promotionSelectors = [
                '.promotion-window',
                '.promotion-area',
                '[class*="promotion"]',
                '.board-modal-container'
            ];

            let promotionWindow = null;
            for (const selector of promotionSelectors) {
                promotionWindow = document.querySelector(selector);
                if (promotionWindow) break;
            }

            if (!promotionWindow) {
                console.log(`[AutoMove] Promotion window not found, retry ${attempt}`);
                setTimeout(() => tryPromotion(attempt + 1), 150);
                return;
            }

            console.log('[AutoMove] Found promotion window:', promotionWindow);

            // Try to find the piece to click
            const pieceSelectors = [
                `.${pieceClass}`,
                `[class*="${pieceClass}"]`,
                `[data-piece="${pieceClass}"]`,
                `.promotion-piece.${pieceName}`,
                `[class*="${pieceName}"]`
            ];

            let pieceElement = null;
            for (const selector of pieceSelectors) {
                pieceElement = promotionWindow.querySelector(selector);
                if (pieceElement) break;
            }

            // Fallback: just click the first piece (usually queen)
            if (!pieceElement) {
                const allPieces = promotionWindow.querySelectorAll('.piece, [class*="piece"]');
                if (allPieces.length > 0) {
                    pieceElement = allPieces[0]; // First option is usually queen
                    console.log('[AutoMove] Using first promotion piece as fallback');
                }
            }

            if (pieceElement) {
                console.log('[AutoMove] Clicking promotion piece:', pieceElement);
                pieceElement.click();

                // Also try dispatching events
                const rect = pieceElement.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                clickAt(x, y);
            } else {
                console.log(`[AutoMove] Promotion piece not found, retry ${attempt}`);
                setTimeout(() => tryPromotion(attempt + 1), 150);
            }
        };

        // Start trying after a short delay for the promotion UI to appear
        setTimeout(() => tryPromotion(1), 200);
    }

    function clickAt(x, y) {
        const element = document.elementFromPoint(x, y);
        if (!element) {
            console.log('[AutoMove] No element at coords:', x, y);
            return;
        }

        console.log('[AutoMove] Clicking on element:', element);

        const pointerOpts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            pointerId: 1,
            width: 1,
            height: 1,
            pressure: 0.5,
            isPrimary: true
        };

        const mouseOpts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            buttons: 1
        };

        element.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
        element.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
        element.dispatchEvent(new MouseEvent('mouseover', mouseOpts));

        element.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        element.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

        // Short delay between down and up/click often helps
        setTimeout(() => {
            element.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
            element.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
            element.dispatchEvent(new MouseEvent('click', mouseOpts));
        }, 50);
    }

    // ============= CREATE PANEL =============
    function createPanel() {
        const existingPanel = document.getElementById('chess-position-panel');
        if (existingPanel) existingPanel.remove();

        const panel = document.createElement('div');
        panel.id = 'chess-position-panel';
        panel.innerHTML = `
            <div class="cpp-header">
                <div class="cpp-title-wrapper">
                    <img src="${chrome.runtime.getURL('icons/crown.png')}" class="cpp-logo" alt="Logo">
                    <span class="cpp-title">Chess Analyzer Pro</span>
                </div>
                <div class="cpp-controls">
                    <button class="cpp-btn cpp-minimize" title="Minimize">−</button>
                    <button class="cpp-btn cpp-close" title="Close">×</button>
                </div>
            </div>
            <div class="cpp-content">
                <!-- Engine Analysis Section -->
                <div class="cpp-analysis-section">
                    <div class="cpp-analysis-lines">
                        <div class="cpp-no-analysis">Starting engine...</div>
                    </div>
                    <div class="cpp-auto-analyze">
                        <label><input type="checkbox" id="auto-move-cb"> Auto-move</label>
                    </div>
                </div>

                <!-- Legend/Help Section -->
                <div class="cpp-legend-section">
                    <div class="cpp-legend-title">Guide</div>
                    <div class="cpp-legend-items">
                        <div class="cpp-legend-item">
                            <span class="cpp-legend-icon cpp-legend-arrow"></span>
                            <span>Green arrows = Best moves</span>
                        </div>
                        <div class="cpp-legend-item">
                            <span class="cpp-legend-icon cpp-legend-hanging"></span>
                            <span>Red = Piece under attack (undefended)</span>
                        </div>
                        <div class="cpp-legend-item">
                            <span class="cpp-legend-icon cpp-legend-defended"></span>
                            <span>Orange = Piece under attack (defended)</span>
                        </div>
                    </div>
                </div>

                

            </div>
        `;
        document.body.appendChild(panel);

        makeDraggable(panel);

        // Event listeners
        panel.querySelector('.cpp-close').addEventListener('click', () => {
            if (autoAnalyzeInterval) clearInterval(autoAnalyzeInterval);
            panel.remove();
        });

        panel.querySelector('.cpp-minimize').addEventListener('click', () => {
            panel.classList.toggle('cpp-minimized');
            panel.querySelector('.cpp-minimize').textContent =
                panel.classList.contains('cpp-minimized') ? '+' : '−';
        });


        // Auto-analyze is enabled by default
        if (!autoAnalyzeEnabled) {
            autoAnalyzeEnabled = true;
            analyzePosition();
            autoAnalyzeInterval = setInterval(() => {
                const positions = getBoardPosition();
                const fen = positionToFEN(positions);
                if (fen !== lastFEN) {
                    analyzePosition();
                }
            }, 1500);
        }

        panel.querySelector('#auto-move-cb').addEventListener('change', (e) => {
            autoMoveEnabled = e.target.checked;
            if (autoMoveEnabled && !isAnalyzing) {
                analyzePosition();
            }
        });

        // Initialize
        initStockfish();
        updatePanel();
        setInterval(updatePanel, 2000);

        return panel;
    }

    function makeDraggable(element) {
        const header = element.querySelector('.cpp-header');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('cpp-btn')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = element.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            element.style.left = (initialX + e.clientX - startX) + 'px';
            element.style.top = (initialY + e.clientY - startY) + 'px';
            element.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => isDragging = false);
    }

    function highlightHangingPieces(attackAnalysis) {
        document.querySelectorAll('.cpp-hanging-overlay').forEach(el => el.remove());

        const board = document.querySelector('.board');
        if (!board) return;

        const boardRect = board.getBoundingClientRect();
        const squareSize = boardRect.width / 8;
        const isFlipped = isBoardFlipped();

        const overlay = document.createElement('div');
        overlay.className = 'cpp-hanging-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:95;';

        for (const [square, piece] of Object.entries(attackAnalysis)) {
            if (piece.status === 'hanging' || piece.status === 'defended') {
                const file = square.charCodeAt(0) - 97;
                const rank = parseInt(square[1]) - 1;

                let x, y;

                // Calculate top-left of square
                if (isFlipped) {
                    x = (7 - file) * squareSize;
                    y = rank * squareSize;
                } else {
                    x = file * squareSize;
                    y = (7 - rank) * squareSize;
                }

                const color = piece.status === 'hanging' ? '#ef4444' : '#f97316';

                const marker = document.createElement('div');
                marker.className = 'cpp-status-marker';
                marker.style.cssText = `
                     position: absolute;
                     left: ${x + squareSize * 0.7}px; 
                     top: ${y}px;
                     width: ${squareSize * 0.3}px;
                     height: ${squareSize * 0.3}px;
                     background: ${color};
                     clip-path: polygon(100% 0, 0 0, 100% 100%);
                     pointer-events: none;
                 `;

                overlay.appendChild(marker);
            }
        }
        board.appendChild(overlay);
    }

    // ============= UPDATE PANEL =============
    function updatePanel() {
        const panel = document.getElementById('chess-position-panel');
        if (!panel) return;

        const positions = getBoardPosition();
        const attackAnalysis = analyzeAttacksDefenses(positions);



        highlightHangingPieces(attackAnalysis);
    }





    // ============= MESSAGE HANDLING =============
    function togglePanel() {
        const panel = document.getElementById('chess-position-panel');
        if (panel) {
            if (autoAnalyzeInterval) clearInterval(autoAnalyzeInterval);
            panel.remove();
        } else {
            createPanel();
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getPosition') {
            const positions = getBoardPosition();
            const fen = positionToFEN(positions);
            sendResponse({ success: true, positions, fen });
        } else if (request.action === 'togglePanel') {
            togglePanel();
            sendResponse({ success: true });
        } else if (request.action === 'showPanel') {
            if (!document.getElementById('chess-position-panel')) createPanel();
            sendResponse({ success: true });
        } else if (request.action === 'analyze') {
            analyzePosition();
            sendResponse({ success: true });
        }
        return true;
    });

    // ============= AUTO-SHOW =============
    function checkAndShowPanel() {
        const isGamePage = window.location.href.includes('/game/') ||
            window.location.href.includes('/play/') ||
            document.querySelector('.board');

        if (isGamePage && !document.getElementById('chess-position-panel')) {
            setTimeout(() => {
                if (document.querySelector('.piece')) createPanel();
            }, 1500);
        }
    }

    // ============= GAME DETECTION =============
    function getCurrentGameId() {
        // Try to extract game ID from URL or board state
        const urlMatch = location.href.match(/\/game\/(live|daily)\/(\d+)/);
        if (urlMatch) return urlMatch[2];

        const playMatch = location.href.match(/\/play\/[^/]+/);
        if (playMatch) return playMatch[0];

        // Fallback: use piece count as a rough game identifier
        const pieces = document.querySelectorAll('.piece').length;
        return `game-${pieces}`;
    }

    function resetAnalysisState() {
        currentLines = [];
        lastFEN = '';
        currentAnalysisFEN = '';
        oldDepth = 0;
        isAnalyzing = false;

        // Clear arrows
        document.querySelectorAll('.cpp-best-move-arrow').forEach(el => el.remove());
        document.querySelectorAll('.cpp-hanging-overlay').forEach(el => el.remove());

        // Update display
        const container = document.querySelector('.cpp-analysis-lines');
        if (container) {
            container.innerHTML = '<div class="cpp-no-analysis">New game detected, analyzing...</div>';
        }
    }

    checkAndShowPanel();

    let lastUrl = location.href;
    new MutationObserver(() => {
        const currentGameId = getCurrentGameId();

        // Check if game changed
        if (currentGameId !== lastGameId) {
            lastGameId = currentGameId;
            resetAnalysisState();

            // Re-analyze the new position
            setTimeout(() => {
                if (isEngineReady) analyzePosition();
            }, 500);
        }

        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(checkAndShowPanel, 1500);
        }
    }).observe(document, { subtree: true, childList: true });

    console.log('Chess.com Position Analyzer Pro loaded!');
})();
