// Idiomas da extensão: pt (padrão), en, ru, zh, es, fr, it.
// Cada frase é uma lista na ordem de LANGS. {nome} é trocado pelos valores passados a t().
// O português é o texto de referência; as outras línguas são adaptadas, não palavra por palavra.
(function (g) {
    'use strict';

    // Ordem da lista suspensa (não confundir com IDX, que é a posição de cada idioma nas frases abaixo)
    const LANGS = [
        { code: 'en', name: 'English' },
        { code: 'zh', name: '中文' },
        { code: 'ru', name: 'Русский' },
        { code: 'pt', name: 'Português (Brasil)' },
        { code: 'es', name: 'Español' },
        { code: 'fr', name: 'Français' },
        { code: 'it', name: 'Italiano' }
    ];
    const IDX = { pt: 0, en: 1, ru: 2, zh: 3, es: 4, fr: 5, it: 6 };
    const COMMA_DECIMAL = { pt: 1, ru: 1, es: 1, fr: 1, it: 1 };

    //            pt | en | ru | zh | es | fr | it
    const T = {
        // ---------- popup ----------
        'p.title': ['Analisador de Xadrez Pro', 'Chess Analyzer Pro', 'Шахматный анализатор Pro', '国际象棋分析器 Pro', 'Analizador de Ajedrez Pro', "Analyseur d'Échecs Pro", 'Analizzatore di Scacchi Pro'],
        'p.status': ['Status', 'Status', 'Статус', '状态', 'Estado', 'Statut', 'Stato'],
        'p.checking': ['Verificando...', 'Checking...', 'Проверка...', '检查中...', 'Comprobando...', 'Vérification...', 'Controllo...'],
        'p.outside': ['Fora do Chess.com', 'Not on Chess.com', 'Вне Chess.com', '不在 Chess.com', 'Fuera de Chess.com', 'Hors de Chess.com', 'Fuori da Chess.com'],
        'p.ready': ['Pronto', 'Ready', 'Готово', '就绪', 'Listo', 'Prêt', 'Pronto'],
        'p.reload': ['Recarregue a página', 'Reload the page', 'Перезагрузите страницу', '请刷新页面', 'Recarga la página', 'Rechargez la page', 'Ricarica la pagina'],
        'p.connError': ['Erro de conexão', 'Connection error', 'Ошибка соединения', '连接错误', 'Error de conexión', 'Erreur de connexion', 'Errore di connessione'],
        'p.powerOn': ['Extensão ligada', 'Extension on', 'Расширение включено', '扩展已开启', 'Extensión activada', 'Extension activée', 'Estensione attiva'],
        'p.powerOff': ['Extensão desligada', 'Extension off', 'Расширение выключено', '扩展已关闭', 'Extensión desactivada', 'Extension désactivée', 'Estensione disattivata'],
        'p.hintOn': [
            'Clique para desligar tudo (painel, motor e maratona).',
            'Click to turn everything off (panel, engine and marathon).',
            'Нажмите, чтобы выключить всё (панель, движок и марафон).',
            '点击关闭全部功能（面板、引擎和连续对局）。',
            'Haz clic para apagar todo (panel, motor y maratón).',
            'Cliquez pour tout désactiver (panneau, moteur et marathon).',
            'Clicca per spegnere tutto (pannello, motore e maratona).'],
        'p.hintOff': [
            'Desligada: nada roda nem clica no chess.com. Clique para ligar.',
            'Off: nothing runs or clicks on chess.com. Click to turn on.',
            'Выключено: на chess.com ничего не работает и не нажимается. Нажмите, чтобы включить.',
            '已关闭：不会在 chess.com 上运行或点击任何内容。点击开启。',
            'Desactivada: nada se ejecuta ni hace clic en chess.com. Haz clic para activar.',
            'Désactivée : rien ne tourne ni ne clique sur chess.com. Cliquez pour activer.',
            'Disattivata: nulla gira né clicca su chess.com. Clicca per attivare.'],
        'p.toggle': ['Mostrar/Ocultar Analisador', 'Show/Hide Analyzer', 'Показать/скрыть анализатор', '显示/隐藏分析器', 'Mostrar/Ocultar Analizador', "Afficher/Masquer l'analyseur", "Mostra/Nascondi l'analizzatore"],
        'p.language': ['Idioma', 'Language', 'Язык', '语言', 'Idioma', 'Langue', 'Lingua'],
        'p.coffee': ['Pague-me um café', 'Buy me a coffee', 'Угостите меня кофе', '请我喝杯咖啡', 'Invítame a un café', 'Offrez-moi un café', 'Offrimi un caffè'],

        // ---------- doação ----------
        'd.title': ['Pague-me um café', 'Buy me a coffee', 'Угостите меня кофе', '请我喝杯咖啡', 'Invítame a un café', 'Offrez-moi un café', 'Offrimi un caffè'],
        'd.text': [
            'Se a extensão te ajuda, uma doação voluntária em Bitcoin ajuda a mantê-la. Obrigado!',
            'If this extension helps you, a voluntary Bitcoin donation helps keep it going. Thank you!',
            'Если расширение вам полезно, добровольное пожертвование в Bitcoin поможет его развитию. Спасибо!',
            '如果这个扩展对你有帮助，欢迎自愿用比特币捐赠，支持它的维护。谢谢！',
            'Si la extensión te resulta útil, una donación voluntaria en Bitcoin ayuda a mantenerla. ¡Gracias!',
            "Si l'extension vous est utile, un don volontaire en Bitcoin aide à la maintenir. Merci !",
            "Se l'estensione ti è utile, una donazione volontaria in Bitcoin aiuta a mantenerla. Grazie!"],
        'd.address': ['Endereço Bitcoin (BTC)', 'Bitcoin (BTC) address', 'Адрес Bitcoin (BTC)', '比特币 (BTC) 地址', 'Dirección Bitcoin (BTC)', 'Adresse Bitcoin (BTC)', 'Indirizzo Bitcoin (BTC)'],
        'd.copy': ['Copiar', 'Copy', 'Копировать', '复制', 'Copiar', 'Copier', 'Copia'],
        'd.copied': ['Copiado!', 'Copied!', 'Скопировано!', '已复制！', '¡Copiado!', 'Copié !', 'Copiato!'],
        'd.soon': ['Endereço em breve.', 'Address coming soon.', 'Адрес скоро появится.', '地址即将提供。', 'Dirección próximamente.', 'Adresse bientôt disponible.', 'Indirizzo in arrivo.'],
        'd.warn': [
            'Confira o endereço antes de enviar. Transações em Bitcoin não podem ser desfeitas.',
            'Check the address before sending. Bitcoin transactions cannot be undone.',
            'Проверьте адрес перед отправкой. Транзакции Bitcoin нельзя отменить.',
            '发送前请核对地址。比特币交易无法撤销。',
            'Comprueba la dirección antes de enviar. Las transacciones de Bitcoin no se pueden deshacer.',
            "Vérifiez l'adresse avant d'envoyer. Les transactions Bitcoin sont irréversibles.",
            "Controlla l'indirizzo prima di inviare. Le transazioni Bitcoin non si possono annullare."],

        // ---------- painel ----------
        'u.minimize': ['Minimizar', 'Minimize', 'Свернуть', '最小化', 'Minimizar', 'Réduire', 'Riduci'],
        'u.close': ['Fechar', 'Close', 'Закрыть', '关闭', 'Cerrar', 'Fermer', 'Chiudi'],
        'u.waiting': ['Aguardando análise...', 'Waiting for analysis...', 'Ожидание анализа...', '等待分析...', 'Esperando el análisis...', "En attente de l'analyse...", "In attesa dell'analisi..."],
        'u.manual': ['Manual', 'Manual', 'Ручной', '手动', 'Manual', 'Manuel', 'Manuale'],
        'u.automatic': ['Automático', 'Automatic', 'Авто', '自动', 'Automático', 'Automatique', 'Automatico'],
        'u.miniAutoTitle': ['Alternar entre jogada automática e manual', 'Switch between automatic and manual play', 'Переключить автоматическую и ручную игру', '在自动走棋和手动之间切换', 'Alternar entre jugada automática y manual', 'Basculer entre jeu automatique et manuel', 'Passa tra mossa automatica e manuale'],
        'u.gamesCount': ['Quantidade de partidas', 'Number of games', 'Количество партий', '对局数量', 'Cantidad de partidas', 'Nombre de parties', 'Numero di partite'],
        'u.marStartTitle': ['Iniciar maratona', 'Start marathon', 'Начать марафон', '开始连续对局', 'Iniciar maratón', 'Lancer le marathon', 'Avvia la maratona'],
        'u.marStopTitle': ['Parar maratona', 'Stop marathon', 'Остановить марафон', '停止连续对局', 'Detener maratón', 'Arrêter le marathon', 'Ferma la maratona'],
        'u.starting': ['Iniciando...', 'Starting...', 'Запуск...', '启动中...', 'Iniciando...', 'Démarrage...', 'Avvio...'],
        'u.startingEngine': ['Iniciando o motor...', 'Starting the engine...', 'Запуск движка...', '正在启动引擎...', 'Iniciando el motor...', 'Démarrage du moteur...', 'Avvio del motore...'],
        'u.depth': ['Profundidade', 'Depth', 'Глубина', '搜索深度', 'Profundidad', 'Profondeur', 'Profondità'],
        'u.style': ['Agressividade', 'Aggressiveness', 'Агрессивность', '进攻倾向', 'Agresividad', 'Agressivité', 'Aggressività'],
        'u.pace': ['Ritmo da jogada', 'Move pace', 'Темп ходов', '走棋节奏', 'Ritmo de juego', 'Rythme de jeu', 'Ritmo di gioco'],
        'u.language': ['Idioma', 'Language', 'Язык', '语言', 'Idioma', 'Langue', 'Lingua'],
        'u.autoMove': ['Jogada automática', 'Auto-play', 'Автоход', '自动走棋', 'Jugada automática', 'Jeu automatique', 'Mossa automatica'],
        'u.human': ['Modo humano', 'Human mode', 'Режим «как человек»', '拟人模式', 'Modo humano', 'Mode humain', 'Modalità umana'],
        'u.humanHint': [
            'Modo humano: desiste quando a desvantagem passa de uns 5 peões (ex.: perdeu a dama).',
            'Human mode: resigns when you are about 5 pawns down (e.g. lost the queen).',
            'Режим «как человек»: сдаётся, когда отставание достигает примерно 5 пешек (например, потерян ферзь).',
            '拟人模式：劣势超过约 5 个兵（例如丢了后）时认输。',
            'Modo humano: se rinde cuando la desventaja pasa de unos 5 peones (p. ej., perdió la dama).',
            "Mode humain : abandonne quand le retard dépasse environ 5 pions (ex. : dame perdue).",
            "Modalità umana: abbandona quando lo svantaggio supera circa 5 pedoni (es.: persa la donna)."],
        'u.marTitle': ['Maratona de partidas', 'Game marathon', 'Марафон партий', '连续对局', 'Maratón de partidas', 'Marathon de parties', 'Maratona di partite'],
        'u.marQty': ['Quantidade', 'Amount', 'Количество', '数量', 'Cantidad', 'Nombre', 'Quantità'],
        'u.marStart': ['Iniciar maratona', 'Start marathon', 'Начать марафон', '开始连续对局', 'Iniciar maratón', 'Lancer le marathon', 'Avvia la maratona'],
        'u.marStop': ['Parar maratona', 'Stop marathon', 'Остановить марафон', '停止连续对局', 'Detener maratón', 'Arrêter le marathon', 'Ferma la maratona'],
        'u.accTitle': ['Precisão da partida', 'Game accuracy', 'Точность партии', '对局准确率', 'Precisión de la partida', 'Précision de la partie', 'Precisione della partita'],
        'u.accBtn': ['Calcular precisão desta partida', 'Calculate accuracy of this game', 'Рассчитать точность этой партии', '计算本局准确率', 'Calcular la precisión de esta partida', 'Calculer la précision de cette partie', 'Calcola la precisione di questa partita'],
        'u.accHint': [
            'Abra uma partida terminada. Ao fim de cada partida, calcula sozinho.',
            'Open a finished game. At the end of each game it calculates on its own.',
            'Откройте завершённую партию. По окончании каждой партии расчёт выполняется сам.',
            '请打开一局已结束的对局。每局结束后会自动计算。',
            'Abre una partida terminada. Al final de cada partida se calcula solo.',
            'Ouvrez une partie terminée. À la fin de chaque partie, le calcul se fait tout seul.',
            'Apri una partita terminata. Alla fine di ogni partita calcola da solo.'],
        'u.legend': ['Legenda', 'Legend', 'Легенда', '图例', 'Leyenda', 'Légende', 'Legenda'],
        'u.legArrows': [
            'Setas = lances que a jogada automática pode fazer: verde = melhor, laranja = intermediário, vermelho = ruim',
            'Arrows = moves auto-play may choose: green = best, orange = medium, red = poor',
            'Стрелки = ходы, которые может выбрать автоход: зелёная = лучший, оранжевая = средний, красная = плохой',
            '箭头 = 自动走棋可能选择的着法：绿色 = 最佳，橙色 = 中等，红色 = 较差',
            'Flechas = jugadas que puede hacer la jugada automática: verde = mejor, naranja = intermedia, roja = mala',
            'Flèches = coups que le jeu automatique peut jouer : vert = meilleur, orange = moyen, rouge = mauvais',
            'Frecce = mosse che la mossa automatica può fare: verde = migliore, arancione = intermedia, rossa = scarsa'],
        'u.legHanging': [
            'Vermelho = peça atacada e sem defesa',
            'Red = piece attacked and undefended',
            'Красный = фигура под ударом и без защиты',
            '红色 = 被攻击且无保护的棋子',
            'Rojo = pieza atacada y sin defensa',
            'Rouge = pièce attaquée et non défendue',
            'Rosso = pezzo attaccato e non difeso'],
        'u.legDefended': [
            'Laranja = peça atacada, mas defendida',
            'Orange = piece attacked but defended',
            'Оранжевый = фигура под ударом, но защищена',
            '橙色 = 被攻击但有保护的棋子',
            'Naranja = pieza atacada, pero defendida',
            'Orange = pièce attaquée mais défendue',
            'Arancione = pezzo attaccato ma difeso'],
        'u.legBar': [
            'Barra lateral = quem está na frente (número em peões)',
            'Side bar = who is ahead (number in pawns)',
            'Боковая шкала = кто впереди (число в пешках)',
            '侧边条 = 谁占优势（数字以兵为单位）',
            'Barra lateral = quién va por delante (número en peones)',
            'Barre latérale = qui est devant (nombre en pions)',
            'Barra laterale = chi è in vantaggio (numero in pedoni)'],

        // ---------- níveis, ritmo, estilo ----------
        'r.beginner': ['Iniciante', 'Beginner', 'Новичок', '初学者', 'Principiante', 'Débutant', 'Principiante'],
        'r.casual': ['Casual', 'Casual', 'Любитель', '休闲', 'Casual', 'Occasionnel', 'Occasionale'],
        'r.intermediate': ['Intermediário', 'Intermediate', 'Средний уровень', '中级', 'Intermedio', 'Intermédiaire', 'Intermedio'],
        'r.advanced': ['Avançado', 'Advanced', 'Продвинутый', '高级', 'Avanzado', 'Avancé', 'Avanzato'],
        'r.master': ['Mestre', 'Master', 'Мастер', '大师', 'Maestro', 'Maître', 'Maestro'],
        'r.gm': ['Grande Mestre', 'Grandmaster', 'Гроссмейстер', '特级大师', 'Gran Maestro', 'Grand Maître', 'Grande Maestro'],
        'r.engine': ['Nível de motor', 'Engine level', 'Уровень движка', '引擎水平', 'Nivel de motor', 'Niveau moteur', 'Livello da motore'],
        'pace.smart': ['Inteligente', 'Smart', 'Умный', '智能', 'Inteligente', 'Intelligent', 'Intelligente'],
        'pace.fast': ['Rápido', 'Fast', 'Быстрый', '快', 'Rápido', 'Rapide', 'Veloce'],
        'pace.normal': ['Normal', 'Normal', 'Обычный', '正常', 'Normal', 'Normal', 'Normale'],
        'pace.calm': ['Calmo', 'Calm', 'Спокойный', '慢', 'Calmado', 'Posé', 'Calmo'],
        'pace.hint.smart': [
            'Lê o tipo de partida (bullet, blitz, rápida). Lances simples e erros saem rápido; só um lance excelente demora mais.',
            'Reads the game type (bullet, blitz, rapid). Simple moves and mistakes come fast; only an excellent move takes longer.',
            'Определяет тип партии (пуля, блиц, рапид). Простые ходы и ошибки делаются быстро; дольше думает только над отличным ходом.',
            '识别对局类型（超快棋、闪电战、快棋）。简单着法和失误很快走出，只有绝佳着法才会多想一会儿。',
            'Lee el tipo de partida (bullet, blitz, rápida). Las jugadas simples y los errores salen rápido; solo una jugada excelente tarda más.',
            "Lit le type de partie (bullet, blitz, rapide). Les coups simples et les erreurs sortent vite ; seul un excellent coup prend plus de temps.",
            'Legge il tipo di partita (bullet, blitz, rapid). Le mosse semplici e gli errori escono in fretta; solo una mossa eccellente richiede più tempo.'],
        'pace.hint.fast': [
            'Mais rápido que o normal para o tipo de partida (bullet, blitz, rápida).',
            'Faster than normal for the game type (bullet, blitz, rapid).',
            'Быстрее обычного для данного типа партии (пуля, блиц, рапид).',
            '比该对局类型（超快棋、闪电战、快棋）的正常速度更快。',
            'Más rápido de lo normal para el tipo de partida (bullet, blitz, rápida).',
            'Plus rapide que la normale pour le type de partie (bullet, blitz, rapide).',
            'Più veloce del normale per il tipo di partita (bullet, blitz, rapid).'],
        'pace.hint.normal': [
            'Tempo normal para o tipo de partida (bullet, blitz, rápida), com variação aleatória.',
            'Normal time for the game type (bullet, blitz, rapid), with random variation.',
            'Обычное время для типа партии (пуля, блиц, рапид) со случайным разбросом.',
            '该对局类型（超快棋、闪电战、快棋）的正常用时，带随机浮动。',
            'Tiempo normal para el tipo de partida (bullet, blitz, rápida), con variación aleatoria.',
            'Temps normal pour le type de partie (bullet, blitz, rapide), avec une variation aléatoire.',
            'Tempo normale per il tipo di partita (bullet, blitz, rapid), con variazione casuale.'],
        'pace.hint.calm': [
            'Mais calmo que o normal para o tipo de partida (bullet, blitz, rápida).',
            'Calmer than normal for the game type (bullet, blitz, rapid).',
            'Спокойнее обычного для данного типа партии (пуля, блиц, рапид).',
            '比该对局类型（超快棋、闪电战、快棋）的正常速度更慢。',
            'Más calmado de lo normal para el tipo de partida (bullet, blitz, rápida).',
            'Plus posé que la normale pour le type de partie (bullet, blitz, rapide).',
            'Più calmo del normale per il tipo di partita (bullet, blitz, rapid).'],
        'pace.suffix': [' Com pouco tempo no relógio, acelera.', ' With little time on the clock, it speeds up.', ' Когда на часах мало времени, играет быстрее.', ' 剩余时间不多时会加快。', ' Con poco tiempo en el reloj, acelera.', " Avec peu de temps à la pendule, il accélère.", ' Con poco tempo sull\'orologio, accelera.'],
        'style.aggressive': ['Agressivo', 'Aggressive', 'Агрессивный', '进攻型', 'Agresivo', 'Agressif', 'Aggressivo'],
        'style.defensive': ['Defensivo', 'Defensive', 'Оборонительный', '防守型', 'Defensivo', 'Défensif', 'Difensivo'],
        'style.auto': ['Automático', 'Automatic', 'Автоматический', '自动', 'Automático', 'Automatique', 'Automatico'],
        'style.hint.aggressive': [
            'Foco em capturar (troca também vale) e atacar peças, entre os lances quase tão bons quanto o melhor.',
            'Focus on capturing (trades count too) and attacking pieces, among moves almost as good as the best.',
            'Упор на взятия (размены тоже) и атаку фигур среди ходов, почти не уступающих лучшему.',
            '在与最佳着法相差无几的着法中，优先吃子（交换也算）和攻击棋子。',
            'Prioriza capturar (el cambio también vale) y atacar piezas, entre las jugadas casi tan buenas como la mejor.',
            "Privilégie les captures (les échanges aussi) et l'attaque des pièces, parmi les coups presque aussi bons que le meilleur.",
            'Punta a catturare (anche gli scambi) e ad attaccare i pezzi, tra le mosse quasi buone quanto la migliore.'],
        'style.hint.defensive': [
            'Foco em não perder peça: protege, evita trocas, roca e busca casas seguras, entre os lances quase tão bons quanto o melhor.',
            'Focus on not losing material: protects, avoids trades, castles and seeks safe squares, among moves almost as good as the best.',
            'Упор на сохранение материала: защищает, избегает разменов, рокируется и ищет безопасные поля среди ходов, почти не уступающих лучшему.',
            '在与最佳着法相差无几的着法中，优先不丢子：保护棋子、避免交换、王车易位并寻找安全格。',
            'Prioriza no perder piezas: protege, evita cambios, enroca y busca casillas seguras, entre las jugadas casi tan buenas como la mejor.',
            'Privilégie de ne pas perdre de pièce : protège, évite les échanges, roque et cherche des cases sûres, parmi les coups presque aussi bons que le meilleur.',
            'Punta a non perdere pezzi: protegge, evita gli scambi, arrocca e cerca case sicure, tra le mosse quasi buone quanto la migliore.'],
        'style.hint.auto': [
            'Muda conforme a partida: à frente, ataca; atrás, defende; igualado, joga o melhor lance.',
            'Changes with the game: ahead, it attacks; behind, it defends; level, it plays the best move.',
            'Меняется по ходу партии: впереди — атакует, позади — защищается, при равенстве — играет лучший ход.',
            '随对局变化：占优时进攻，落后时防守，均势时走最佳着法。',
            'Cambia según la partida: si va por delante, ataca; por detrás, defiende; igualado, juega la mejor jugada.',
            'Change selon la partie : devant, il attaque ; derrière, il défend ; à égalité, il joue le meilleur coup.',
            'Cambia in base alla partita: in vantaggio attacca; in svantaggio difende; in parità gioca la mossa migliore.'],
        'u.depthOpt': ['Prof. {d}  ≈ {r}', 'Depth {d}  ≈ {r}', 'Глуб. {d}  ≈ {r}', '深度 {d}  ≈ {r}', 'Prof. {d}  ≈ {r}', 'Prof. {d}  ≈ {r}', 'Prof. {d}  ≈ {r}'],
        'u.depthAuto': ['Automática', 'Automatic', 'Автоматическая', '自动', 'Automática', 'Automatique', 'Automatica'],

        // ---------- profundidade automática ----------
        'dep.letters': ['V|E|D', 'W|D|L', 'В|Н|П', '胜|和|负', 'G|E|P', 'G|N|P', 'V|P|S'],
        'dep.none': ['sem partidas ainda', 'no games yet', 'партий пока нет', '暂无对局', 'aún sin partidas', 'pas encore de parties', 'ancora nessuna partita'],
        'dep.summary': [
            'Prof. {d} (≈ {r}) pelo histórico ({h}) e pela partida.',
            'Depth {d} (≈ {r}) from your history ({h}) and the game.',
            'Глубина {d} (≈ {r}) по вашей истории ({h}) и по ходу партии.',
            '深度 {d}（≈ {r}），依据你的历史战绩（{h}）和当前对局。',
            'Prof. {d} (≈ {r}) según el historial ({h}) y la partida.',
            "Prof. {d} (≈ {r}) selon l'historique ({h}) et la partie.",
            'Prof. {d} (≈ {r}) in base allo storico ({h}) e alla partita.'],
        'dep.noErr': ['Sem erros propositais.', 'No deliberate mistakes.', 'Без намеренных ошибок.', '不会故意失误。', 'Sin errores intencionados.', "Pas d'erreurs volontaires.", 'Nessun errore voluto.'],
        'dep.rarely': ['A jogada automática erra raramente.', 'Auto-play rarely makes mistakes.', 'Автоход редко ошибается.', '自动走棋很少失误。', 'La jugada automática rara vez se equivoca.', 'Le jeu automatique se trompe rarement.', 'La mossa automatica sbaglia raramente.'],
        'dep.likeLevel': ['A jogada automática erra como esse nível.', 'Auto-play makes mistakes like this level.', 'Автоход ошибается так же, как игрок этого уровня.', '自动走棋会像这个水平一样出现失误。', 'La jugada automática se equivoca como ese nivel.', 'Le jeu automatique se trompe comme ce niveau.', 'La mossa automatica sbaglia come questo livello.'],
        'dep.hint': ['≈ {r} de rating · {l}. {e}', '≈ {r} rating · {l}. {e}', '≈ {r} рейтинга · {l}. {e}', '约 {r} 等级分 · {l}。{e}', '≈ {r} de rating · {l}. {e}', '≈ {r} de classement · {l}. {e}', '≈ {r} di rating · {l}. {e}'],

        // ---------- estado do motor ----------
        'e.extUpdated': ['Extensão atualizada: recarregue a página (F5)', 'Extension updated: reload the page (F5)', 'Расширение обновлено: перезагрузите страницу (F5)', '扩展已更新：请刷新页面 (F5)', 'Extensión actualizada: recarga la página (F5)', 'Extension mise à jour : rechargez la page (F5)', 'Estensione aggiornata: ricarica la pagina (F5)'],
        'e.extUpdatedBox': ['Extensão atualizada.<br>Aperte F5 nesta página.', 'Extension updated.<br>Press F5 on this page.', 'Расширение обновлено.<br>Нажмите F5 на этой странице.', '扩展已更新。<br>请在此页面按 F5。', 'Extensión actualizada.<br>Pulsa F5 en esta página.', 'Extension mise à jour.<br>Appuyez sur F5 sur cette page.', 'Estensione aggiornata.<br>Premi F5 in questa pagina.'],
        'e.loading': ['Carregando motor...', 'Loading engine...', 'Загрузка движка...', '正在加载引擎...', 'Cargando el motor...', 'Chargement du moteur...', 'Caricamento del motore...'],
        'e.ready': ['Pronto', 'Ready', 'Готово', '就绪', 'Listo', 'Prêt', 'Pronto'],
        'e.done': ['Concluído', 'Done', 'Завершено', '完成', 'Concluido', 'Terminé', 'Completato'],
        'e.error': ['Erro', 'Error', 'Ошибка', '错误', 'Error', 'Erreur', 'Errore'],
        'e.errorMsg': ['Erro: {m}', 'Error: {m}', 'Ошибка: {m}', '错误：{m}', 'Error: {m}', 'Erreur : {m}', 'Errore: {m}'],
        'e.loadFail': ['Falha ao carregar o motor, tentando de novo...', 'Failed to load the engine, retrying...', 'Не удалось загрузить движок, повторная попытка...', '引擎加载失败，正在重试...', 'Error al cargar el motor, reintentando...', 'Échec du chargement du moteur, nouvel essai...', 'Caricamento del motore non riuscito, riprovo...'],
        'e.thinkingDepth': ['Pensando... prof. {d}/{m}', 'Thinking... depth {d}/{m}', 'Думаю... глубина {d}/{m}', '思考中... 深度 {d}/{m}', 'Pensando... prof. {d}/{m}', 'Réflexion... prof. {d}/{m}', 'Sto pensando... prof. {d}/{m}'],
        'e.thinking': ['Pensando...', 'Thinking...', 'Думаю...', '思考中...', 'Pensando...', 'Réflexion...', 'Sto pensando...'],
        'e.noResignBtn': ['Sem botão de abandonar', 'No resign button', 'Нет кнопки «Сдаться»', '找不到认输按钮', 'Sin botón de abandonar', "Pas de bouton d'abandon", 'Nessun pulsante di abbandono'],
        'e.resigning': ['Desistindo em {s} s', 'Resigning in {s} s', 'Сдаюсь через {s} с', '{s} 秒后认输', 'Abandonando en {s} s', 'Abandon dans {s} s', 'Abbandono tra {s} s'],
        'e.drawOffered': ['Empate oferecido, aguardando {s} s', 'Draw offered, waiting {s} s', 'Ничья предложена, жду {s} с', '已提和，等待 {s} 秒', 'Tablas ofrecidas, esperando {s} s', 'Nulle proposée, attente de {s} s', 'Patta offerta, attendo {s} s'],
        'e.acceptDraw': ['Aceitando empate em {s} s', 'Accepting draw in {s} s', 'Принимаю ничью через {s} с', '{s} 秒后接受和棋', 'Aceptando tablas en {s} s', 'Acceptation de la nulle dans {s} s', 'Accetto la patta tra {s} s'],
        'e.playingIn': ['Jogando em {s} s', 'Playing in {s} s', 'Хожу через {s} с', '{s} 秒后走棋', 'Jugando en {s} s', 'Je joue dans {s} s', 'Gioco tra {s} s'],
        'e.restarting': ['Reiniciando motor...', 'Restarting engine...', 'Перезапуск движка...', '正在重启引擎...', 'Reiniciando el motor...', 'Redémarrage du moteur...', 'Riavvio del motore...'],
        'e.noBoard': ['Sem tabuleiro', 'No board', 'Нет доски', '没有棋盘', 'Sin tablero', "Pas d'échiquier", 'Nessuna scacchiera'],
        'e.waitBoard': ['Aguardando o tabuleiro ({r})', 'Waiting for the board ({r})', 'Ожидание доски ({r})', '等待棋盘（{r}）', 'Esperando el tablero ({r})', "En attente de l'échiquier ({r})", 'In attesa della scacchiera ({r})'],
        'e.badPawn': ['peão na fileira {r}', 'pawn on rank {r}', 'пешка на горизонтали {r}', '兵在第 {r} 横线', 'peón en la fila {r}', 'pion sur la rangée {r}', 'pedone sulla traversa {r}'],
        'e.badKings': ['reis: {w} branco(s), {b} preto(s)', 'kings: {w} white, {b} black', 'короли: белых {w}, чёрных {b}', '国王：白方 {w} 个，黑方 {b} 个', 'reyes: {w} blanco(s), {b} negro(s)', 'rois : {w} blanc(s), {b} noir(s)', 're: {w} bianco/i, {b} nero/i'],
        'e.badMany': ['peças demais', 'too many pieces', 'слишком много фигур', '棋子过多', 'demasiadas piezas', 'trop de pièces', 'troppi pezzi'],
        'e.badCheck': ['rei em xeque fora da vez', 'king in check out of turn', 'король под шахом не в свой ход', '非走棋方的国王被将军', 'rey en jaque fuera de turno', 'roi en échec hors de son tour', 're sotto scacco fuori turno'],

        // ---------- análise e barra ----------
        'a.analyzing': ['Analisando a posição...', 'Analyzing the position...', 'Анализ позиции...', '正在分析局面...', 'Analizando la posición...', 'Analyse de la position...', 'Analisi della posizione...'],
        'a.newGame': ['Nova partida detectada, analisando...', 'New game detected, analyzing...', 'Обнаружена новая партия, анализ...', '检测到新对局，正在分析...', 'Nueva partida detectada, analizando...', 'Nouvelle partie détectée, analyse...', 'Nuova partita rilevata, analisi...'],
        'a.bestMove': ['Melhor lance:', 'Best move:', 'Лучший ход:', '最佳着法：', 'Mejor jugada:', 'Meilleur coup :', 'Mossa migliore:'],
        'a.mateFor': ['Mate a seu favor em {n}', 'Mate in {n} for you', 'Вы ставите мат в {n}', '你可在 {n} 步内将杀', 'Mate a tu favor en {n}', 'Mat en {n} pour vous', 'Matto a tuo favore in {n}'],
        'a.mateAgainst': ['Você leva mate em {n}', 'You get mated in {n}', 'Вам ставят мат в {n}', '你将在 {n} 步内被将杀', 'Te dan mate en {n}', 'Vous êtes maté en {n}', 'Subisci matto in {n}'],
        'a.equal': ['Posição igual', 'Equal position', 'Равная позиция', '局面均势', 'Posición igualada', 'Position égale', 'Posizione pari'],
        'a.ahead': ['Você está na frente', 'You are ahead', 'Вы впереди', '你占优势', 'Vas por delante', 'Vous êtes devant', 'Sei in vantaggio'],
        'a.behind': ['Adversário está na frente', 'Opponent is ahead', 'Соперник впереди', '对手占优势', 'El rival va por delante', "L'adversaire est devant", "L'avversario è in vantaggio"],
        'a.ev.winning': ['Ótima posição! Vantagem clara', 'Great position! Clear advantage', 'Отличная позиция! Явное преимущество', '局面极佳！优势明显', '¡Gran posición! Ventaja clara', 'Excellente position ! Avantage net', 'Ottima posizione! Vantaggio chiaro'],
        'a.ev.good': ['Boa posição, você está na frente', 'Good position, you are ahead', 'Хорошая позиция, вы впереди', '局面不错，你占优', 'Buena posición, vas por delante', 'Bonne position, vous êtes devant', 'Buona posizione, sei in vantaggio'],
        'a.ev.slight': ['Pequena vantagem para você', 'Slight advantage for you', 'Небольшое преимущество у вас', '你略占优势', 'Pequeña ventaja para ti', 'Léger avantage pour vous', 'Leggero vantaggio per te'],
        'a.ev.equal': ['Posição igual', 'Equal position', 'Равная позиция', '局面均势', 'Posición igualada', 'Position égale', 'Posizione pari'],
        'a.ev.oppSlight': ['Adversário com pequena vantagem', 'Opponent has a slight advantage', 'У соперника небольшое преимущество', '对手略占优势', 'El rival tiene una pequeña ventaja', "L'adversaire a un léger avantage", "L'avversario ha un leggero vantaggio"],
        'a.ev.opp': ['Adversário com vantagem', 'Opponent has the advantage', 'У соперника преимущество', '对手占优势', 'El rival tiene ventaja', "L'adversaire a l'avantage", "L'avversario è in vantaggio"],
        'a.ev.hard': ['Posição difícil', 'Difficult position', 'Трудная позиция', '局面困难', 'Posición difícil', 'Position difficile', 'Posizione difficile'],
        'a.ev.critical': ['Crítico! Grande desvantagem', 'Critical! Big disadvantage', 'Критично! Большой проигрыш', '危急！劣势很大', '¡Crítico! Gran desventaja', 'Critique ! Gros désavantage', 'Critico! Grande svantaggio'],
        'a.sugResign': ['Sugestão: desistir', 'Suggestion: resign', 'Совет: сдаться', '建议：认输', 'Sugerencia: abandonar', 'Suggestion : abandonner', 'Suggerimento: abbandonare'],
        'a.sugDraw': ['Sugestão: oferecer empate', 'Suggestion: offer a draw', 'Совет: предложить ничью', '建议：提和', 'Sugerencia: ofrecer tablas', 'Suggestion : proposer nulle', 'Suggerimento: offrire patta'],

        // ---------- maratona ----------
        'm.stopped': ['Maratona parada.', 'Marathon stopped.', 'Марафон остановлен.', '连续对局已停止。', 'Maratón detenida.', 'Marathon arrêté.', 'Maratona fermata.'],
        'm.stoppedManual': ['Maratona parada: modo manual.', 'Marathon stopped: manual mode.', 'Марафон остановлен: ручной режим.', '连续对局已停止：手动模式。', 'Maratón detenida: modo manual.', 'Marathon arrêté : mode manuel.', 'Maratona fermata: modalità manuale.'],
        'm.finished': ['Maratona concluída: {n} partidas.', 'Marathon finished: {n} games.', 'Марафон завершён: {n} партий.', '连续对局完成：共 {n} 局。', 'Maratón completada: {n} partidas.', 'Marathon terminé : {n} parties.', 'Maratona completata: {n} partite.'],
        'm.miniPending': ['Faltam {l}. Próxima partida...', '{l} left. Next game...', 'Осталось {l}. Следующая партия...', '还剩 {l} 局。即将开始下一局...', 'Faltan {l}. Próxima partida...', 'Il en reste {l}. Prochaine partie...', 'Ne mancano {l}. Prossima partita...'],
        'm.miniRunning': ['Faltam {l} (partida {c} de {n})', '{l} left (game {c} of {n})', 'Осталось {l} (партия {c} из {n})', '还剩 {l} 局（第 {c}/{n} 局）', 'Faltan {l} (partida {c} de {n})', 'Il en reste {l} (partie {c} sur {n})', 'Ne mancano {l} (partita {c} di {n})'],
        'm.pending': ['{d} de {n} concluídas. Começando a próxima partida...', '{d} of {n} done. Starting the next game...', 'Завершено {d} из {n}. Начинаю следующую партию...', '已完成 {d}/{n} 局。正在开始下一局...', '{d} de {n} completadas. Empezando la siguiente partida...', '{d} sur {n} terminées. Lancement de la partie suivante...', '{d} di {n} completate. Inizio la partita successiva...'],
        'm.playing': ['Jogando a partida {c} de {n}. Faltam {l} (contando esta).', 'Playing game {c} of {n}. {l} left (including this one).', 'Идёт партия {c} из {n}. Осталось {l} (включая эту).', '正在进行第 {c}/{n} 局。还剩 {l} 局（含本局）。', 'Jugando la partida {c} de {n}. Faltan {l} (contando esta).', 'Partie {c} sur {n} en cours. Il en reste {l} (celle-ci comprise).', 'Sto giocando la partita {c} di {n}. Ne mancano {l} (compresa questa).'],
        'm.intro': [
            'Escolha quantas partidas. Ao fim de cada uma, começa a próxima e ignora pedido de revanche. Deixe o computador ligado e a aba aberta.',
            'Choose how many games. When each one ends, the next one starts and rematch requests are ignored. Keep the computer on and the tab open.',
            'Выберите число партий. По окончании каждой начинается следующая, а предложения реванша игнорируются. Не выключайте компьютер и не закрывайте вкладку.',
            '选择对局数量。每局结束后会自动开始下一局，并忽略再来一局的邀请。请保持电脑开机、标签页打开。',
            'Elige cuántas partidas. Al terminar cada una empieza la siguiente y se ignoran las revanchas. Deja el ordenador encendido y la pestaña abierta.',
            "Choisissez le nombre de parties. À la fin de chacune, la suivante démarre et les demandes de revanche sont ignorées. Laissez l'ordinateur allumé et l'onglet ouvert.",
            "Scegli quante partite. Al termine di ognuna parte la successiva e le richieste di rivincita vengono ignorate. Lascia il computer acceso e la scheda aperta."],

        // ---------- precisão da partida ----------
        'v.white': ['Brancas', 'White', 'Белые', '白方', 'Blancas', 'Blancs', 'Bianco'],
        'v.black': ['Pretas', 'Black', 'Чёрные', '黑方', 'Negras', 'Noirs', 'Nero'],
        'v.counts': ['{b} gafes · {m} erros · {i} imprecisões', '{b} blunders · {m} mistakes · {i} inaccuracies', '{b} грубых ошибок · {m} ошибок · {i} неточностей', '{b} 次严重失误 · {m} 次失误 · {i} 次不精确', '{b} errores graves · {m} errores · {i} imprecisiones', '{b} gaffes · {m} erreurs · {i} imprécisions', '{b} gravi errori · {m} errori · {i} imprecisioni'],
        'v.line': ['Você: {a}%  ·  Adversário: {b}%', 'You: {a}%  ·  Opponent: {b}%', 'Вы: {a}%  ·  Соперник: {b}%', '你：{a}%  ·  对手：{b}%', 'Tú: {a}%  ·  Rival: {b}%', 'Vous : {a} %  ·  Adversaire : {b} %', 'Tu: {a}%  ·  Avversario: {b}%'],
        'v.mine': ['Seus lances: {c}', 'Your moves: {c}', 'Ваши ходы: {c}', '你的着法：{c}', 'Tus jugadas: {c}', 'Vos coups : {c}', 'Le tue mosse: {c}'],
        'v.theirs': ['Adversário: {c}', 'Opponent: {c}', 'Соперник: {c}', '对手：{c}', 'Rival: {c}', 'Adversaire : {c}', 'Avversario: {c}'],
        'v.site': ['Número do site: você {a}  ·  adversário {b}', 'Site figure: you {a}  ·  opponent {b}', 'Число с сайта: вы {a}  ·  соперник {b}', '网站数值：你 {a}  ·  对手 {b}', 'Cifra del sitio: tú {a}  ·  rival {b}', 'Valeur du site : vous {a}  ·  adversaire {b}', 'Dato del sito: tu {a}  ·  avversario {b}'],
        'v.summary': ['Precisão: você {a}% · adv. {b}%', 'Accuracy: you {a}% · opp. {b}%', 'Точность: вы {a}% · соперник {b}%', '准确率：你 {a}% · 对手 {b}%', 'Precisión: tú {a}% · rival {b}%', 'Précision : vous {a} % · adv. {b} %', 'Precisione: tu {a}% · avv. {b}%'],
        'v.done': ['Pronto. Calculado com o Stockfish (prof. {d}).', 'Done. Calculated with Stockfish (depth {d}).', 'Готово. Рассчитано Stockfish (глубина {d}).', '完成。由 Stockfish 计算（深度 {d}）。', 'Listo. Calculado con Stockfish (prof. {d}).', 'Terminé. Calculé avec Stockfish (prof. {d}).', 'Fatto. Calcolato con Stockfish (prof. {d}).'],
        'v.noRules': ['Módulo de regras indisponível', 'Rules module unavailable', 'Модуль правил недоступен', '规则模块不可用', 'Módulo de reglas no disponible', 'Module de règles indisponible', 'Modulo delle regole non disponibile'],
        'v.openFinished': ['Abra uma partida terminada para calcular.', 'Open a finished game to calculate.', 'Откройте завершённую партию для расчёта.', '请打开一局已结束的对局再计算。', 'Abre una partida terminada para calcular.', 'Ouvrez une partie terminée pour calculer.', 'Apri una partita terminata per calcolare.'],
        'v.noNames': ['Não achei nenhum nome de jogador na página. Abra a página da partida.', 'I could not find any player name on the page. Open the game page.', 'Не нашёл ни одного имени игрока на странице. Откройте страницу партии.', '页面上找不到任何玩家名称。请打开对局页面。', 'No encontré ningún nombre de jugador en la página. Abre la página de la partida.', "Je n'ai trouvé aucun nom de joueur sur la page. Ouvrez la page de la partie.", 'Non ho trovato nessun nome di giocatore nella pagina. Apri la pagina della partita.'],
        'v.searching': ['Buscando a partida...', 'Looking for the game...', 'Поиск партии...', '正在查找对局...', 'Buscando la partida...', 'Recherche de la partie...', 'Cerco la partita...'],
        'v.waitSite': ['Aguardando o site liberar a partida...', 'Waiting for the site to release the game...', 'Ожидание, пока сайт откроет партию...', '等待网站提供对局数据...', 'Esperando a que el sitio libere la partida...', 'En attente que le site libère la partie...', 'In attesa che il sito renda disponibile la partita...'],
        'v.notFound': ['Partida não encontrada no histórico do site (ainda).', 'Game not found in the site history (yet).', 'Партия пока не найдена в истории сайта.', '（暂时）在网站历史记录中找不到该对局。', 'Partida no encontrada en el historial del sitio (todavía).', "Partie introuvable dans l'historique du site (pour l'instant).", 'Partita non ancora trovata nella cronologia del sito.'],
        'v.onlyStd': ['Só calculo xadrez padrão.', 'I only calculate standard chess.', 'Считаю только стандартные шахматы.', '只能计算标准国际象棋。', 'Solo calculo ajedrez estándar.', "Je ne calcule que les échecs standard.", 'Calcolo solo gli scacchi standard.'],
        'v.inProgress': ['A partida ainda está em andamento.', 'The game is still in progress.', 'Партия ещё идёт.', '对局仍在进行中。', 'La partida sigue en curso.', 'La partie est encore en cours.', 'La partita è ancora in corso.'],
        'v.cantRead': ['Não consegui ler os lances ({r}).', 'I could not read the moves ({r}).', 'Не удалось прочитать ходы ({r}).', '无法读取着法（{r}）。', 'No pude leer las jugadas ({r}).', "Je n'ai pas pu lire les coups ({r}).", 'Non sono riuscito a leggere le mosse ({r}).'],
        'v.short': ['partida curta', 'short game', 'короткая партия', '对局太短', 'partida corta', 'partie courte', 'partita breve'],
        'v.analyzingMove': ['Analisando lance {i}/{n}...', 'Analyzing move {i}/{n}...', 'Анализ хода {i}/{n}...', '正在分析第 {i}/{n} 步...', 'Analizando jugada {i}/{n}...', 'Analyse du coup {i}/{n}...', 'Analisi della mossa {i}/{n}...'],
        'v.cantCalc': ['Não foi possível calcular agora.', 'It was not possible to calculate right now.', 'Сейчас рассчитать не удалось.', '目前无法计算。', 'No fue posible calcular ahora.', "Impossible de calculer pour l'instant.", 'Non è stato possibile calcolare ora.']
    };

    // Bandeiras desenhadas (o Windows não mostra emoji de bandeira, só as letras do país)
    const star = (cx, cy, r) => {
        let p = '';
        for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r;
            p += (cx + rr * Math.cos(a)).toFixed(2) + ',' + (cy + rr * Math.sin(a)).toFixed(2) + ' ';
        }
        return '<polygon points="' + p.trim() + '" fill="#FFDE00"/>';
    };
    function flagInner(code) {
        switch (code) {
            case 'en': {   // Estados Unidos
                let r = '<rect width="30" height="20" fill="#B22234"/>';
                for (let i = 0; i < 6; i++) r += '<rect y="' + (20 / 13 * (2 * i + 1)).toFixed(2) + '" width="30" height="' + (20 / 13).toFixed(2) + '" fill="#fff"/>';
                r += '<rect width="13" height="10.77" fill="#3C3B6E"/>';
                for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) r += '<circle cx="' + (1.4 + x * 2.4) + '" cy="' + (1.5 + y * 2.5) + '" r="0.55" fill="#fff"/>';
                return r;
            }
            case 'zh': return '<rect width="30" height="20" fill="#DE2910"/>' + star(5, 5, 3.2) + star(10, 2.2, 1) + star(12, 4.6, 1) + star(12, 7.6, 1) + star(10, 10, 1);
            case 'ru': return '<rect width="30" height="20" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039A6"/><rect y="13.33" width="30" height="6.67" fill="#D52B1E"/>';
            case 'pt': return '<rect width="30" height="20" fill="#009C3B"/><polygon points="15,2 27.5,10 15,18 2.5,10" fill="#FFDF00"/><circle cx="15" cy="10" r="4.4" fill="#002776"/><path d="M10.9 9 Q15 7.6 19.1 11" stroke="#fff" stroke-width="0.9" fill="none"/>';
            case 'es': return '<rect width="30" height="20" fill="#AA151B"/><rect y="5" width="30" height="10" fill="#F1BF00"/>';
            case 'fr': return '<rect width="10" height="20" fill="#0055A4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#EF4135"/>';
            case 'it': return '<rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#CE2B37"/>';
            default: return '<rect width="30" height="20" fill="#555"/>';
        }
    }
    function flagSvg(code) {
        return '<svg class="cpp-lp-flag" viewBox="0 0 30 20" width="22" height="15" aria-hidden="true">' + flagInner(code) + '</svg>';
    }

    const PICKER_CSS = '.cpp-lp{position:relative;width:100%;font:13px/1.2 "Segoe UI",system-ui,sans-serif;color:#fff}' +
        '.cpp-lp *{box-sizing:border-box}' +
        '.cpp-lp-btn,.cpp-lp-item{display:flex;align-items:center;gap:9px;width:100%;margin:0;padding:7px 10px;background:#242424;color:#fff;border:1px solid #3a3a3a;border-radius:6px;font:inherit;text-align:left;cursor:pointer}' +
        '.cpp-lp-btn:hover,.cpp-lp-item:hover{background:#2f2f2f}' +
        '.cpp-lp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.cpp-lp-caret{font-size:10px;color:#aaa}' +
        '.cpp-lp-flag{flex:none;border-radius:2px;box-shadow:0 0 0 1px rgba(255,255,255,.18)}' +
        '.cpp-lp-list{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}' +
        '.cpp-lp-list[hidden]{display:none}' +
        '.cpp-lp-overlay .cpp-lp-list{position:absolute;left:0;right:0;top:100%;z-index:9999;padding:4px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.55)}' +
        '.cpp-lp-item{border-color:transparent;background:#1f1f1f}' +
        '.cpp-lp-item.on{background:#2c3a2f;border-color:#2ea043}';

    // Troca um <select> de idiomas por uma lista com bandeira. O <select> continua existindo (escondido)
    // e é ele quem recebe o valor e o evento "change", então o resto do código não muda.
    function enhanceSelect(sel, opts) {
        if (!sel || sel.dataset.cppPicker) return;
        const doc = sel.ownerDocument;
        sel.dataset.cppPicker = '1';
        if (!doc.getElementById('cpp-lp-style')) {
            const st = doc.createElement('style');
            st.id = 'cpp-lp-style';
            st.textContent = PICKER_CSS;
            (doc.head || doc.documentElement).appendChild(st);
        }
        sel.style.display = 'none';
        const wrap = doc.createElement('div');
        wrap.className = 'cpp-lp' + (opts && opts.overlay ? ' cpp-lp-overlay' : '');
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'cpp-lp-btn';
        const list = doc.createElement('ul');
        list.className = 'cpp-lp-list';
        list.hidden = true;
        const nameOf = (c) => (LANGS.find(l => l.code === c) || LANGS[0]).name;
        function render() {
            const cur = sel.value || lang;
            btn.innerHTML = flagSvg(cur) + '<span class="cpp-lp-name"></span><span class="cpp-lp-caret">▾</span>';
            btn.querySelector('.cpp-lp-name').textContent = nameOf(cur);
            list.querySelectorAll('.cpp-lp-item').forEach(b => b.classList.toggle('on', b.dataset.code === cur));
        }
        LANGS.forEach(l => {
            const li = doc.createElement('li');
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'cpp-lp-item';
            b.dataset.code = l.code;
            b.innerHTML = flagSvg(l.code) + '<span class="cpp-lp-name"></span>';
            b.querySelector('.cpp-lp-name').textContent = l.name;
            b.addEventListener('click', () => {
                list.hidden = true;
                sel.value = l.code;
                render();
                sel.dispatchEvent(new (doc.defaultView || window).Event('change', { bubbles: true }));
            });
            li.appendChild(b);
            list.appendChild(li);
        });
        btn.addEventListener('click', (e) => { e.stopPropagation(); list.hidden = !list.hidden; });
        const outside = (e) => {
            if (!wrap.isConnected) { doc.removeEventListener('click', outside); return; }
            if (!wrap.contains(e.target)) list.hidden = true;
        };
        doc.addEventListener('click', outside);
        wrap.appendChild(btn);
        wrap.appendChild(list);
        sel.parentNode.insertBefore(wrap, sel.nextSibling);
        sel.addEventListener('change', render);
        onChange(() => { if (wrap.isConnected) { sel.value = lang; render(); } });
        render();
    }

    let lang = 'pt';
    const listeners = [];

    function norm(code) { return IDX[code] === undefined ? 'pt' : code; }

    function t(key, vars) {
        const e = T[key];
        if (!e) return key;
        let s = e[IDX[lang]];
        if (s === undefined || s === '') s = e[0];
        if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
        return s;
    }

    // Número com a vírgula ou o ponto decimal do idioma
    function num(x, digits) {
        const s = typeof digits === 'number' ? Number(x).toFixed(digits) : String(x);
        return COMMA_DECIMAL[lang] ? s.replace('.', ',') : s;
    }

    function apply(code, notify) {
        const next = norm(code);
        const changed = next !== lang;
        lang = next;
        try { if (g.document && g.document.documentElement) g.document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang; } catch (e) { /* ignora */ }
        if (changed && notify) listeners.forEach(fn => { try { fn(lang); } catch (e) { /* ignora */ } });
    }

    // Escolhe o idioma e guarda para as outras partes da extensão (popup, painel, abas)
    function setLang(code) {
        apply(code, true);
        try { chrome.storage.local.set({ cppLang: lang }); } catch (e) { /* sem persistência */ }
    }

    function onChange(fn) { listeners.push(fn); }

    // Lê o idioma salvo; ready() chama de volta quando a leitura terminou (ou falhou)
    const readyFns = [];
    let isReady = false;
    function ready(fn) { if (isReady) fn(lang); else readyFns.push(fn); }
    function markReady() { isReady = true; readyFns.splice(0).forEach(fn => { try { fn(lang); } catch (e) { /* ignora */ } }); }

    try {
        chrome.storage.local.get('cppLang', (res) => {
            if (!chrome.runtime.lastError && res && res.cppLang) apply(res.cppLang, true);
            markReady();
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.cppLang) apply(changes.cppLang.newValue, true);
        });
    } catch (e) { markReady(); }

    g.I18N = { LANGS, t, num, flagSvg, enhanceSelect, setLang, getLang: () => lang, onChange, ready, has: (k) => !!T[k] };
})(typeof window !== 'undefined' ? window : globalThis);
